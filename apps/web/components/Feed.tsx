'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FEED_AHEAD, curatedPalettes, generators, getGenerator, paletteAt, type FeedCard } from '@patternwall/core';
import { PatternImage } from './PatternImage';
import { PreviewSheets, type Sheet } from './PreviewSettings';
import { FALLBACK_SCREEN, useDeviceScreen } from '../lib/device-screen';
import { useFeed } from '../lib/use-feed';
import { cardKey, useCardRenders } from '../lib/use-card-renders';
import { useCardSwipe } from '../lib/use-card-swipe';
import { renderSpec } from '../lib/render';
import { downloadBlob, renderPngBlob, safeFilename, yieldToBrowser } from '../lib/export-png';
import { deliverWallpapers } from '../lib/export-collection';
import styles from './Feed.module.css';

/** How long each exit takes. Reduced motion shortens every one to a fade. */
const FLY_MS = { like: 340, skip: 280, back: 220, reduced: 140 };

/** How long the palette name stays up after the colours last changed. */
const PILL_MS = 1400;

/** After this many verdicts in a first session, one tip, once. */
const TIP_AFTER = 3;

type Share = { key: string; state: 'preparing' } | { key: string; state: 'ready'; blob: Blob; name: string } | null;

/**
 * `/t`: a feed of wallpapers, judged one at a time.
 *
 * Swipe right to keep one, left to pass; tap for a new wallpaper in the same
 * pattern, colours included; drag up or down to scrub through the colours. Every card is random, so the
 * whole design leans on one promise — nothing seen is lost by accident. Rewind
 * undoes every change of card, the feed survives the tab being killed, and a
 * card that has not finished drawing cannot be judged.
 *
 * The screen is four things and nothing else: the Gallery top-right, a verdict
 * row centred at the bottom, a "•••" menu bottom-right, and the picture. The
 * menu is bottom-right rather than top-left because that is where a thumb
 * reaches; the Gallery is up top because it is opened occasionally, and a
 * liked card flies into it, which is how a person learns where likes go.
 */
export function Feed() {
  const { feed, latestSaved, hints, markHint, skip, like, reroll, rewind, flickPalette, setPalette, setParam } = useFeed();
  const screen = useDeviceScreen(true);

  // Drawn at the phone's own resolution and shape, the way /m draws: the
  // picture is the wallpaper, so it is judged at the size it will be used.
  const size = useMemo(() => {
    if (!screen) return null;
    const w = Math.min(1400, Math.round(screen.w * screen.dpr));
    return { w, h: Math.round((w * screen.h) / screen.w) };
  }, [screen]);
  const box = screen ?? FALLBACK_SCREEN;

  const current = feed?.current ?? null;
  const ahead = useMemo(() => (feed ? feed.queue.slice(0, FEED_AHEAD) : []), [feed]);
  const { urlOf, errorOf } = useCardRenders(current, ahead, size);
  const currentUrl = urlOf(current);
  const ready = !!currentUrl;
  const generator = current ? getGenerator(current.generatorId) ?? generators[0]! : null;

  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pill, setPill] = useState<{ text: string; n: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ripple, setRipple] = useState<{ x: number; y: number; n: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [share, setShare] = useState<Share>(null);
  const [verdicts, setVerdicts] = useState(0);
  const [tipOn, setTipOn] = useState(false);
  const [entering, setEntering] = useState<'left' | 'grow' | null>(null);
  const [nudging, setNudging] = useState(false);

  /*
   * Which card slot is on screen. It moves on a verdict and on rewinding one,
   * and stays put through a tap, a flick or a slider — so within a slot the old
   * picture stays up until the new one is drawn and fades in over it, while a
   * new slot is a different card and starts from nothing.
   */
  const [slot, setSlot] = useState(0);
  const layers = useRef<{ slot: number; base?: string; top?: string }>({ slot: -1 });
  if (layers.current.slot !== slot) layers.current = { slot, ...(currentUrl ? { top: currentUrl } : {}) };
  else if (currentUrl && currentUrl !== layers.current.top) layers.current = { slot, ...(layers.current.top ? { base: layers.current.top } : {}), top: currentUrl };
  const { base, top } = layers.current;

  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLAnchorElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  const busy = useRef(false);

  const setProgress = (p: number): void => {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty('--like', String(Math.max(0, Math.min(1, p))));
    el.style.setProperty('--nope', String(Math.max(0, Math.min(1, -p))));
  };

  const place = (transform: string, ms: number, opacity = 1): void => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transition = ms > 0 ? `transform ${ms}ms cubic-bezier(.3,.7,.4,1), opacity ${ms}ms ease` : 'none';
    el.style.transform = transform;
    el.style.opacity = String(opacity);
  };

  const springBack = useCallback(() => {
    place('translate(0,0) rotate(0deg)', reduced ? 0 : FLY_MS.back);
    setProgress(0);
  }, [reduced]);

  const say = (text: string): void => setAnnounce(text);

  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 2400);
  }, []);

  /**
   * Send the card off and then change the feed.
   *
   * The state changes after the animation rather than before it, because the
   * card element belongs to the slot and changing the feed mid-flight would
   * swap the picture on the card that is leaving. A like is saved at the end
   * for the same reason; if the save fails the card comes back rather than
   * leaving a person believing it was kept.
   */
  const judge = useCallback(
    (kind: 'skip' | 'like', from = 0) => {
      if (busy.current) return;
      if (!ready) {
        springBack();
        return;
      }
      busy.current = true;
      const deck = rootRef.current?.getBoundingClientRect();
      let ms: number;
      if (reduced) {
        ms = FLY_MS.reduced;
        place('translate(0,0)', ms, 0);
      } else if (kind === 'like' && thumbRef.current && deck) {
        // Into the Gallery thumbnail: that one movement is how a person learns
        // where likes go, which a static icon never teaches.
        const t = thumbRef.current.getBoundingClientRect();
        const dx = t.left + t.width / 2 - (deck.left + deck.width / 2);
        const dy = t.top + t.height / 2 - (deck.top + deck.height / 2);
        ms = FLY_MS.like;
        place(`translate(${dx}px, ${dy}px) scale(${t.width / deck.width})`, ms, 0.6);
      } else {
        const w = window.innerWidth;
        const dir = kind === 'like' ? 1 : -1;
        ms = kind === 'like' ? FLY_MS.like : FLY_MS.skip;
        place(`translate(${dir * (w + Math.abs(from))}px, 0) rotate(${dir * 14}deg)`, ms);
      }
      setProgress(kind === 'like' ? 1 : -1);
      window.setTimeout(() => {
        let ok = true;
        if (kind === 'like') ok = like() === 'liked';
        else skip();
        if (!ok) {
          busy.current = false;
          springBack();
          flash("Couldn't save");
          return;
        }
        say(kind === 'like' ? 'Liked. Saved to your gallery.' : 'Skipped.');
        setVerdicts((n) => n + 1);
        setEntering(null);
        setSlot((n) => n + 1);
        setProgress(0);
        busy.current = false;
      }, ms);
    },
    [ready, reduced, like, skip, springBack, flash],
  );

  const doRewind = useCallback(() => {
    if (busy.current) return;
    const undone = rewind();
    if (!undone) return;
    if (undone.kind === 'reroll') {
      say('Previous settings brought back.');
      return;
    }
    // The card comes back the way it left: in from the left after a skip,
    // growing out of the Gallery after a like.
    setEntering(reduced ? null : undone.kind === 'skip' ? 'left' : 'grow');
    setSlot((n) => n + 1);
    say(undone.kind === 'like' ? 'Brought back, and removed from your gallery.' : 'Brought back.');
  }, [rewind, reduced]);

  const pillFor = (p: FeedCard['palette']): string => {
    const at = curatedPalettes.findIndex((c) => c.id === p.id);
    return at === -1 ? p.name : `${p.name} · ${at + 1}/${curatedPalettes.length}`;
  };

  /** One palette along — the arrow keys. */
  const doPalette = useCallback(
    (direction: 1 | -1) => {
      const p = flickPalette(direction);
      if (!p) return;
      setPill((prev) => ({ text: pillFor(p), n: (prev?.n ?? 0) + 1 }));
      say(`Colours: ${p.name}.`);
    },
    [flickPalette],
  );

  /*
   * A vertical drag scrubs: every step the finger crosses is another palette,
   * counted from the one the drag began on, so dragging back puts it back.
   *
   * Each step goes straight into the feed with no history, as a flick did —
   * rewind stays about cards. The renders are superseded on their channel, so
   * a fast drag draws only where the finger is, not every palette it passed.
   * The pill keeps one identity for the whole drag so it updates in place
   * rather than popping in again on every step, and the announcement waits
   * for the release: forty palette names read out in a second help nobody.
   */
  const scrubFrom = useRef<FeedCard | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const doScrub = useCallback(
    (steps: number) => {
      if (!current) return;
      if (!scrubFrom.current) {
        scrubFrom.current = current;
        setScrubbing(true);
        setPill((prev) => ({ text: '', n: (prev?.n ?? 0) + 1 }));
      }
      const p = paletteAt(scrubFrom.current, steps).palette;
      setPalette(p);
      setPill((prev) => ({ text: pillFor(p), n: prev?.n ?? 0 }));
    },
    [current, setPalette],
  );
  const endScrub = useCallback(
    (steps: number) => {
      const from = scrubFrom.current;
      scrubFrom.current = null;
      setScrubbing(false);
      if (from && steps !== 0) say(`Colours: ${paletteAt(from, steps).palette.name}.`);
    },
    [],
  );

  const doReroll = useCallback(
    (x?: number, y?: number) => {
      if (busy.current) return;
      reroll();
      if (x !== undefined && y !== undefined && rootRef.current) {
        const r = rootRef.current.getBoundingClientRect();
        setRipple((prev) => ({ x: x - r.left, y: y - r.top, n: (prev?.n ?? 0) + 1 }));
      }
      say('Reshuffled.');
    },
    [reroll],
  );

  useEffect(() => {
    if (!pill) return;
    const id = window.setTimeout(() => setPill(null), PILL_MS);
    return () => window.clearTimeout(id);
  }, [pill]);

  const swipe = useCardSwipe(
    {
      onDrag: (dx, progress, tilt) => {
        place(`translate(${dx}px, 0) rotate(${tilt}deg)`, 0);
        setProgress(progress);
      },
      onCancel: springBack,
      onVerdict: (kind, dx) => judge(kind, dx),
      onPaletteScrub: doScrub,
      onPaletteEnd: endScrub,
      onTap: (x, y) => doReroll(x, y),
    },
    !!feed && !menuOpen && !sheet,
    reduced,
    curatedPalettes.length,
  );

  /* ------------------------------------------------------------ first run */

  // One nudge, about a second in, so the card shows it moves. No text.
  useEffect(() => {
    if (hints.nudged || !ready || reduced) return;
    const id = window.setTimeout(() => {
      setNudging(true);
      markHint('nudged');
      window.setTimeout(() => setNudging(false), 900);
    }, 900);
    return () => window.clearTimeout(id);
  }, [hints.nudged, ready, reduced, markHint]);

  // One tip, after the third card, for the two gestures a card cannot show.
  useEffect(() => {
    if (!hints.tipped && verdicts >= TIP_AFTER) setTipOn(true);
  }, [hints.tipped, verdicts]);

  const dismissTip = useCallback(() => {
    if (!tipOn) return;
    setTipOn(false);
    markHint('tipped');
  }, [tipOn, markHint]);

  /* ---------------------------------------------------------------- menu */

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    moreRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    firstItemRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen, closeMenu]);

  /*
   * The share image is drawn when the menu opens, not when Share is pressed.
   * Safari only opens the share sheet while the press that asked for it is
   * still fresh, and a dense pattern can take longer than that to rasterise —
   * which would be a Share that silently does nothing.
   */
  const shareKey = current ? cardKey(current, { w: box.w * box.dpr, h: box.h * box.dpr }) : '';
  useEffect(() => {
    if (!menuOpen || !current || (share && share.key === shareKey)) return;
    let live = true;
    const card = current;
    const w = Math.round(box.w * box.dpr);
    const h = Math.round(box.h * box.dpr);
    setShare({ key: shareKey, state: 'preparing' });
    void (async () => {
      await yieldToBrowser();
      try {
        const svg = renderSpec({ generatorId: card.generatorId, seed: card.seed, params: card.params, palette: card.palette, width: w, height: h, bleed: 0 });
        const blob = await renderPngBlob(svg, w, h, { depth: 'png24', colors: 256 });
        if (live) setShare({ key: shareKey, state: 'ready', blob, name: `${safeFilename(['patternwall', card.generatorId, card.seed])}.png` });
      } catch {
        if (live) setShare(null);
      }
    })();
    return () => {
      live = false;
    };
    // `share` is read to skip a redraw, not to trigger one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, shareKey]);

  const doShare = useCallback(() => {
    if (!share || share.state !== 'ready' || share.key !== shareKey) return;
    const file = { name: share.name, blob: share.blob };
    setMenuOpen(false);
    // Nothing awaited before this: the share sheet needs the press to be fresh.
    void deliverWallpapers([file], async () => {}, (f) => downloadBlob(f.blob, f.name)).then((result) => {
      // Cancelled says nothing and a share says nothing — iOS has its own
      // feedback. Only the fallback needs words, and they say what happened.
      if (result === 'downloaded') flash('Downloaded');
    });
  }, [share, shareKey, flash]);

  /* ------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (menuOpen || sheet || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft') judge('skip');
      else if (e.key === 'ArrowRight') judge('like');
      else if (e.key === 'ArrowUp') doPalette(1);
      else if (e.key === 'ArrowDown') doPalette(-1);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen, sheet, judge, doPalette]);

  // Scrolling, rubber-banding and pull-to-refresh would each redraw or lose
  // the card, so none of them is available on this page at all.
  useEffect(() => {
    const html = document.documentElement;
    const prev = [html.style.overscrollBehavior, document.body.style.overscrollBehavior];
    html.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';
    return () => {
      html.style.overscrollBehavior = prev[0] ?? '';
      document.body.style.overscrollBehavior = prev[1] ?? '';
    };
  }, []);

  const next = ahead[0];
  const nextUrl = urlOf(next);
  const history = feed?.history.length ?? 0;
  const error = errorOf(current);

  const altOf = (c: FeedCard): string => `${getGenerator(c.generatorId)?.name ?? c.generatorId} with the ${c.palette.name} palette, seed ${c.seed}`;

  return (
    <main id="main" className={styles.stage} onPointerDownCapture={dismissTip}>
      <h1 className="pw-visually-hidden">Browse wallpapers</h1>
      <p className="pw-visually-hidden" aria-live="polite" data-testid="feed-announce">
        {announce}
      </p>

      <div
        ref={rootRef}
        className={styles.deck}
        style={{ aspectRatio: `${box.w} / ${box.h}` }}
        data-testid="feed-deck"
      >
        {/* The next card, already drawn, under the one being judged. */}
        {next ? (
          <div className={styles.card} style={{ background: next.palette.background }} aria-hidden="true">
            {nextUrl ? <img className={styles.picture} src={nextUrl} alt="" draggable={false} /> : null}
          </div>
        ) : null}

        {current ? (
          <div
            key={slot}
            ref={cardRef}
            className={[styles.card, styles.top, entering ? styles[`enter-${entering}`] : '', nudging ? styles.nudge : ''].join(' ')}
            style={{ background: current.palette.background }}
            onPointerDown={swipe.onPointerDown}
            data-testid="feed-card"
            data-generator={current.generatorId}
            data-seed={current.seed}
            data-palette={current.palette.id}
            data-ready={ready ? 'true' : 'false'}
          >
            {base ? <img className={styles.picture} src={base} alt="" draggable={false} /> : null}
            {top ? (
              <img key={top} className={`${styles.picture} ${base ? styles.fadeIn : ''}`} src={top} alt={altOf(current)} draggable={false} />
            ) : null}
            {/* Not while scrubbing: the last palette stays up until the next
                is drawn, and a spinner blinking on every step is noise. */}
            {!ready && !scrubbing ? (
              <span className={styles.spinner} role="status" aria-label={error ? 'This card could not be drawn' : 'Drawing'} />
            ) : null}
            <span className={`${styles.badge} ${styles.badgeLike}`} aria-hidden="true">
              <HeartGlyph />
            </span>
            <span className={`${styles.badge} ${styles.badgeNope}`} aria-hidden="true">
              <CrossGlyph />
            </span>
          </div>
        ) : null}

        {ripple ? <span key={ripple.n} className={styles.ripple} style={{ left: ripple.x, top: ripple.y }} aria-hidden="true" /> : null}

        {pill ? (
          <div key={pill.n} className={styles.pill} data-testid="feed-palette-pill">
            {pill.text}
          </div>
        ) : null}

        {/* The Gallery: the last wallpaper you liked, as the door to all of
            them. The Camera app taught everyone this one. */}
        <Link
          ref={thumbRef}
          href="/m/collected?from=t"
          className={styles.gallery}
          aria-label={latestSaved ? 'Open your liked wallpapers' : 'Open your liked wallpapers (none yet)'}
          data-testid="feed-gallery"
          data-empty={latestSaved ? undefined : 'true'}
          data-hidden={sheet ? 'true' : undefined}
        >
          {latestSaved && getGenerator(latestSaved.generatorId) ? (
            <PatternImage
              key={latestSaved.id}
              spec={{
                generatorId: latestSaved.generatorId,
                seed: latestSaved.seed,
                params: latestSaved.params,
                palette: latestSaved.palette,
                width: 72,
                height: Math.round((72 * box.h) / box.w),
                bleed: 0,
              }}
              alt=""
              className={styles.galleryImg}
              draggable={false}
              deferred
            />
          ) : null}
        </Link>

        {tipOn ? (
          <div className={styles.tip} role="status" data-testid="feed-tip">
            Tap to reshuffle · Swipe up or down for colours
          </div>
        ) : null}

        {toast ? (
          <div className={styles.toast} role="status" data-testid="feed-toast">
            {toast}
          </div>
        ) : null}

        {/* ✕ and ♥ sit on the sides their swipes go, so the buttons teach the
            gesture; rewind sits between them, the same distance from either
            mistake. They are also the only way in for anyone who cannot swipe
            a card, which is why they exist at all. */}
        <div className={styles.row} data-hidden={sheet ? 'true' : undefined}>
          <button
            type="button"
            className={`${styles.verdict} ${styles.nope}`}
            aria-label="Skip"
            data-testid="feed-skip"
            disabled={!ready}
            onClick={() => judge('skip')}
          >
            <CrossGlyph />
          </button>
          <button
            type="button"
            className={styles.rewind}
            aria-label="Bring back the last one"
            data-testid="feed-rewind"
            disabled={history === 0}
            onClick={doRewind}
          >
            <RewindGlyph />
          </button>
          <button
            type="button"
            className={`${styles.verdict} ${styles.yes}`}
            aria-label="Like"
            data-testid="feed-like"
            disabled={!ready}
            onClick={() => judge('like')}
          >
            <HeartGlyph />
          </button>
        </div>

        <button
          ref={moreRef}
          type="button"
          className={styles.more}
          aria-label="More"
          aria-expanded={menuOpen}
          aria-controls="feed-menu"
          data-testid="feed-more"
          data-hidden={sheet ? 'true' : undefined}
          onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
        >
          <DotsGlyph />
        </button>

        {menuOpen ? (
          <>
            {/* Tapping outside a menu closes it and does nothing else: the
                press is used up here and never reaches the card underneath,
                which would otherwise re-roll the thing being judged. */}
            <div
              className={styles.menuScrim}
              data-testid="feed-menu-scrim"
              aria-hidden="true"
              onPointerDown={(e) => {
                e.preventDefault();
                closeMenu();
              }}
            />
            <div id="feed-menu" className={styles.menu} role="group" aria-label="More" data-testid="feed-menu">
              <button
                ref={firstItemRef}
                type="button"
                className={styles.item}
                data-testid="feed-adjust"
                onClick={() => {
                  setMenuOpen(false);
                  setSheet('settings');
                }}
              >
                <span>Adjust</span>
                <SlidersGlyph />
              </button>
              <button
                type="button"
                className={styles.item}
                data-testid="feed-colours"
                onClick={() => {
                  setMenuOpen(false);
                  setSheet('palette');
                }}
              >
                <span>Colours</span>
                <PaletteGlyph />
              </button>
              <button
                type="button"
                className={styles.item}
                data-testid="feed-share"
                disabled={!share || share.key !== shareKey || share.state !== 'ready'}
                onClick={doShare}
              >
                <span>{share && share.key === shareKey && share.state === 'ready' ? 'Share Image' : 'Preparing image…'}</span>
                <ShareGlyph />
              </button>
            </div>
          </>
        ) : null}

        {current && generator ? (
          <PreviewSheets
            generator={generator}
            params={current.params}
            palette={current.palette}
            open={sheet}
            onOpen={(s) => {
              setSheet(s);
              if (!s) moreRef.current?.focus();
            }}
            onChange={setParam}
            onCommit={() => {}}
            onPalette={setPalette}
            showStamp
            every
            wide
            titles={{ settings: 'Adjust', palette: 'Colours' }}
            settingsTop={
              // The way to a re-roll that is not a tap, for anyone who cannot
              // tap the card — and a word for what a tap does, for anyone who
              // never found out.
              <button type="button" className={styles.shuffle} data-testid="feed-shuffle" onClick={() => doReroll()}>
                <DiceGlyph /> Shuffle
              </button>
            }
          />
        ) : null}
      </div>
    </main>
  );
}

/** Reads the setting once and follows it, so the animations can shorten. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/* ---------------------------------------------------------------- glyphs */

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function HeartGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 20.4C5.6 16.3 2.6 12.9 2.6 9.4A4.9 4.9 0 0 1 12 7.3a4.9 4.9 0 0 1 9.4 2.1c0 3.5-3 6.9-9.4 11Z" />
    </svg>
  );
}

function CrossGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path {...stroke} strokeWidth={2.4} d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

function RewindGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
      <path {...stroke} d="M4.6 9.2A8 8 0 1 1 4 13" />
      <path {...stroke} d="M4.2 4.6v4.8H9" />
    </svg>
  );
}

function DotsGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
      <circle cx="5.5" cy="12" r="1.9" fill="currentColor" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.9" fill="currentColor" />
    </svg>
  );
}

function SlidersGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
      <path {...stroke} d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle {...stroke} cx="15" cy="7" r="2.2" />
      <circle {...stroke} cx="9" cy="17" r="2.2" />
    </svg>
  );
}

function PaletteGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
      <path {...stroke} d="M12 3.2c-5 0-8.8 3.6-8.8 8.3 0 4.6 3.6 8.3 8.2 8.3 1.3 0 1.9-.8 1.9-1.7 0-1.4-1.2-1.6-1.2-2.8 0-1 .8-1.7 1.8-1.7h2.3c2.6 0 4.6-1.9 4.6-4.4 0-3.4-3.8-6-8.8-6Z" />
      <circle cx="7.6" cy="11.2" r="1.25" fill="currentColor" />
      <circle cx="10.6" cy="7.3" r="1.25" fill="currentColor" />
      <circle cx="15.2" cy="7.6" r="1.25" fill="currentColor" />
    </svg>
  );
}

function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
      <path {...stroke} d="M12 3.5v11M8 7.3l4-3.8 4 3.8" />
      <path {...stroke} d="M8.6 10.2H6.8a1.6 1.6 0 0 0-1.6 1.6v7.4a1.6 1.6 0 0 0 1.6 1.6h10.4a1.6 1.6 0 0 0 1.6-1.6v-7.4a1.6 1.6 0 0 0-1.6-1.6h-1.8" />
    </svg>
  );
}

function DiceGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
      <rect {...stroke} x="3.5" y="3.5" width="17" height="17" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" />
    </svg>
  );
}
