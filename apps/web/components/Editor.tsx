'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_BLEED,
  decodeConfig,
  effectiveSpec,
  defaultParams,
  encodeConfig,
  generators,
  getGenerator,
  initialConfig,
  resolvePrimaries,
  retuneParams,
  type Palette,
  type ParamValue,
} from '@patternwall/core';
import { PreviewFrame, PREVIEW_MODES, type PreviewMode } from './PreviewFrame';
import { PatternImage } from './PatternImage';
import { ParamControls } from './ParamControls';
import { PreviewSettings, type Sheet } from './PreviewSettings';
import { PalettePanel } from './PalettePanel';
import { ExportPanel } from './ExportPanel';
import { Button, Notice, Switch, TabList, Tag, uiStyles as ui } from './ui';
import { renderProse } from '../lib/prose';
import { useScrub } from '../lib/use-scrub';
import { collectionKey, loadCollected, saveCollected } from '../lib/storage';
import type { RenderSpec } from '../lib/render';
import styles from './Editor.module.css';

type PanelKey = 'pattern' | 'palette' | 'export';

const PANELS: { value: PanelKey; label: string }[] = [
  { value: 'pattern', label: 'Pattern' },
  { value: 'palette', label: 'Palette' },
  { value: 'export', label: 'Export' },
];

const PREVIEW_FULL = 460;
const PREVIEW_DRAFT = 250;

function randomSeed(): string {
  const words = ['ash', 'bergamot', 'cinder', 'delta', 'ember', 'fenn', 'glass', 'hollow', 'iris', 'juniper', 'kelp', 'lumen', 'moss', 'nimbus', 'ochre', 'pewter', 'quill', 'reed', 'slate', 'tallow', 'umber', 'vellum', 'wick', 'yarrow'];
  const a = words[Math.floor(Math.random() * words.length)] as string;
  const n = Math.floor(Math.random() * 900 + 100);
  return `${a}-${n}`;
}

/** A phone-shaped canvas, for a device that is not one. */
const FALLBACK_SCREEN = { w: 390, h: 845, dpr: 2 };

/**
 * The canvas `/m` draws, taken from the device's own screen where there is one.
 *
 * `screen` rather than the viewport on purpose: the viewport is whatever
 * Safari has left after its address bar, and that slides around as you scroll,
 * which would re-render the pattern at a new aspect every time it moved. The
 * screen is the thing a wallpaper actually has to fit, it is what "detect the
 * phone resolution" means, and it does not move.
 *
 * A desktop has a screen too, and it is landscape, so taking it literally
 * turns this page into a very wide wallpaper — which is the one thing `/m` is
 * not. Anything that is not portrait, or is wider than a phone gets, falls
 * back to a phone shape and lets the black show around it.
 *
 * Null until the effect runs. The static export prerenders this page, so the
 * first client render has to match the HTML that was baked in -- reading the
 * screen during render would be a text hydration mismatch, the same class of
 * bug as the build stamp.
 */
function useDeviceScreen(enabled: boolean): { w: number; h: number; dpr: number } | null {
  const [box, setBox] = useState<{ w: number; h: number; dpr: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const read = (): void => {
      const sw = Math.max(1, Math.round(window.screen?.width ?? window.innerWidth));
      const sh = Math.max(1, Math.round(window.screen?.height ?? window.innerHeight));
      // Portrait, and no wider than a large phone. A tablet in portrait is
      // deliberately excluded: 4:3 of this pattern is not what anybody opened
      // `/m` to see.
      const isPhone = sh > sw && sw <= 600;
      const next = isPhone
        ? { w: sw, h: sh, dpr: Math.min(3, Math.max(1, window.devicePixelRatio || 1)) }
        : FALLBACK_SCREEN;
      setBox((prev) => (prev && prev.w === next.w && prev.h === next.h && prev.dpr === next.dpr ? prev : next));
    };
    read();
    window.addEventListener('orientationchange', read);
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('orientationchange', read);
      window.removeEventListener('resize', read);
    };
  }, [enabled]);
  return box;
}

export function Editor({ generatorId: initialId, bare = false }: { generatorId: string; bare?: boolean }) {
  /**
   * Which pattern is on screen, held here rather than read from the route.
   *
   * A tap on the preview moves to the next pattern, and doing that as a route
   * change would remount the whole editor and re-render the picture from
   * nothing on every tap — on the one interaction that has to feel immediate.
   * So the generator is state, the address bar is rewritten to match, and a
   * reload or a shared link still lands on the right static page. The prop is
   * the starting point and nothing more.
   */
  const [generatorId, setGeneratorId] = useState(initialId);
  const generator = getGenerator(generatorId) ?? generators[0]!;

  const [seed, setSeed] = useState(() => initialConfig(generator.id).seed);
  const [params, setParams] = useState<Record<string, ParamValue>>(() => defaultParams(generator));
  const [palette, setPalette] = useState<Palette>(() => initialConfig(generator.id).palette);
  const [notes, setNotes] = useState<string[]>([]);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Lock and Home draw a mock clock, date and dock. On `/m` the phone is
  // already drawing its own, so the only honest mode is the one with nothing
  // on top -- and the mode switcher lives in the panel, which `/m` has not got.
  const [mode, setMode] = useState<PreviewMode>(bare ? 'flat' : 'lock');
  const [showZones, setShowZones] = useState(false);
  const [panel, setPanel] = useState<PanelKey>('pattern');

  const [copied, setCopied] = useState(false);
  const [collectState, setCollectState] = useState<'idle' | 'saved' | 'already' | 'failed'>('idle');
  const [collectedCount, setCollectedCount] = useState(0);
  const [collectedIds, setCollectedIds] = useState<string[]>([]);

  // Committed values are what gets rendered. Slider drags update `params`
  // instantly so the control never lags the finger, and settle into
  // `committed` a beat later so we are not re-rendering a 20,000-circle scene
  // on every pointermove.
  const [committed, setCommitted] = useState<{ params: Record<string, ParamValue>; palette: Palette; seed: string }>(() => ({
    params: defaultParams(generator),
    palette: initialConfig(generator.id).palette,
    seed: initialConfig(generator.id).seed,
  }));
  const settleRef = useRef<number | null>(null);
  // What the pending commit will apply when its timer fires. Held separately
  // from the timer because a debounced commit must not throw away a change to a
  // *different* field: settle() used to keep only its latest argument, so
  // typing a seed and then touching a slider inside the seed's 260ms window
  // committed the slider and silently dropped the seed. The render, the share
  // link and Copy link then disagreed with the seed field on screen, and
  // because `dirty` never cleared the preview stayed at draft resolution until
  // the seed was touched again. Every commit path merges into this patch, so
  // the last write to each field wins rather than the last write to any field.
  const pendingRef = useRef<Partial<{ params: Record<string, ParamValue>; palette: Palette; seed: string }>>({});

  // `params` captured in a callback is the value from the render that created
  // that callback. Selects and switches fire onChange and onCommit in the same
  // event, before React has re-rendered, so a commit reading the state variable
  // would settle the value the control just replaced — the preview and the URL
  // would sit one change behind. This ref is written synchronously on every
  // change, so the commit always sees the newest params.
  const latestParams = useRef(params);
  // The same trap as `latestParams`, for the same reason: a tap fires from a
  // pointer handler that may run several times before React re-renders, and
  // reading `generator` from the closure would walk the registry from where it
  // was rather than from where it is.
  const screenBox = useDeviceScreen(bare);
  const latestGenerator = useRef(generatorId);

  type Patch = Partial<{ params: Record<string, ParamValue>; palette: Palette; seed: string }>;

  /** Drain the pending patch into `committed`. The only writer of committed state. */
  const flush = useCallback(() => {
    const patch = pendingRef.current;
    pendingRef.current = {};
    setCommitted((prev) => ({
      params: patch.params ?? prev.params,
      palette: patch.palette ?? prev.palette,
      seed: patch.seed ?? prev.seed,
    }));
  }, []);

  const settle = useCallback(
    (next: Patch, delay: number) => {
      pendingRef.current = { ...pendingRef.current, ...next };
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(() => {
        settleRef.current = null;
        flush();
      }, delay);
    },
    [flush],
  );

  /**
   * Commit without waiting. Shuffle, Reset and a decoded share link all want
   * this, and all three used to call setCommitted directly — which left any
   * pending patch alive to overwrite them a beat later. Shuffling the seed
   * mid-type would take, then be replaced by the half-typed seed.
   */
  const commitNow = useCallback(
    (next: Patch) => {
      pendingRef.current = { ...pendingRef.current, ...next };
      if (settleRef.current !== null) {
        window.clearTimeout(settleRef.current);
        settleRef.current = null;
      }
      flush();
    },
    [flush],
  );

  /**
   * Read the link, once.
   *
   * This used to depend on `generator.id`, which was safe while the id came
   * from the route and could only change by navigating. It is state now, so a
   * tap would re-run this and decode `window.location.search` — which still
   * holds the previous pattern's `q` until the 220ms URL debounce catches up,
   * and would be read against the new pattern's params anyway. It would undo
   * the tap with values that never meant anything. Mount only.
   */
  useEffect(() => {
    const search = typeof window === 'undefined' ? '' : window.location.search;
    // `/m` has no id in its path. Read it here rather than during render for
    // the same reason the params are read here: the export prerenders this
    // page against `initialId`, and disagreeing with that during the first
    // render is a text hydration mismatch.
    const asked = bare ? new URLSearchParams(search).get('g') : null;
    const id = asked && getGenerator(asked) ? asked : initialId;
    if (id !== initialId) {
      setGeneratorId(id);
      latestGenerator.current = id;
    }
    const decoded = decodeConfig(id, search);
    setSeed(decoded.config.seed);
    latestParams.current = decoded.config.params;
    setParams(decoded.config.params);
    setPalette(decoded.config.palette);
    commitNow({ params: decoded.config.params, palette: decoded.config.palette, seed: decoded.config.seed });
    setNotes(decoded.notes);
  }, []);

  // What is already kept, so the heart can say so. Refreshed per pattern
  // because the count beside the panel's Collect button is per pattern, and
  // re-read from storage rather than tracked, since another tab may have
  // written to it.
  useEffect(() => {
    const items = loadCollected();
    setCollectedCount(items.filter((c) => c.generatorId === generator.id).length);
    setCollectedIds(items.map((c) => c.id));
  }, [generator.id]);

  useEffect(() => () => {
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
  }, []);

  /** The only way params should change: keeps the ref, the state and the pending commit in step. */
  const applyParams = useCallback(
    (next: Record<string, ParamValue>, delay: number) => {
      latestParams.current = next;
      setParams(next);
      settle({ params: next }, delay);
    },
    [settle],
  );

  /**
   * Driving the two from the picture.
   *
   * Absent for a pattern that has not chosen its two, in which case the
   * preview is inert and every control is where it always was.
   */
  const bindings = useMemo(
    () =>
      resolvePrimaries(generator).map((b) => (b.spec ? { ...b, spec: effectiveSpec(generator, b.spec, params) } : b)),
    [generator, params],
  );

  /**
   * One parameter change, with anything whose range moved carried across.
   *
   * Every interactive path goes through here -- a slider, a select, the tap --
   * and nothing else does. A decoded share link deliberately does not: it
   * carries every value explicitly and rescaling one would rewrite what the
   * link says.
   */
  const changeParam = useCallback(
    (key: string, value: ParamValue): Record<string, ParamValue> =>
      retuneParams(generator, latestParams.current, { ...latestParams.current, [key]: value }),
    [generator],
  );
  const [scrubbing, setScrubbing] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);

  /**
   * The next pattern in the registry, wrapping.
   *
   * Seed and palette come with you and the params cannot — a pattern's
   * parameters are its own, so there is nothing to carry. Keeping the other
   * two is what makes a tap read as one idea drawn four ways rather than four
   * unrelated pictures, and it is the only reading under which tapping past
   * the one you wanted and coming round again gets you back what you had.
   *
   * Everything is written through `commitNow` in one go, because a tap changes
   * the generator and the params together and a render against the old params
   * with the new generator would be a picture neither of them describes.
   */
  const goToPattern = useCallback(
    (step: number) => {
      const at = generators.findIndex((g) => g.id === latestGenerator.current);
      const next = generators[(((at < 0 ? 0 : at) + step) % generators.length + generators.length) % generators.length]!;
      if (next.id === latestGenerator.current) return;
      const nextParams = defaultParams(next);
      latestGenerator.current = next.id;
      latestParams.current = nextParams;
      setGeneratorId(next.id);
      setParams(nextParams);
      setNotes([]);
      commitNow({ params: nextParams });
    },
    [commitNow],
  );

  /** The configuration on screen, as a collection item. */
  const config = useMemo(
    () => ({ generatorId: generator.id, seed: committed.seed, params: committed.params, palette: committed.palette }),
    [generator.id, committed],
  );
  const collectedKey = collectionKey(config);
  const collected = collectedIds.includes(collectedKey);

  /**
   * Keep this one. Shared by the heart on the preview and the Collect button
   * in the panel, because two copies of a storage write is two places for the
   * two to disagree about what is already saved.
   */
  const collect = useCallback(() => {
    if (collectedIds.includes(collectedKey)) {
      setCollectState('already');
      return;
    }
    const result = saveCollected(config);
    setCollectedCount(result.items.filter((c) => c.generatorId === generator.id).length);
    setCollectedIds(result.items.map((c) => c.id));
    setCollectState(result.ok ? 'saved' : 'failed');
  }, [collectedIds, collectedKey, config, generator.id]);

  /** A fresh seed, from the dice or from the sheet. */
  const newSeed = useCallback(() => {
    const next = randomSeed();
    setSeed(next);
    commitNow({ seed: next });
  }, [commitNow]);

  /**
   * A continuous gesture: the newest value, rendered now.
   *
   * Not `applyParams`, whose 110ms is a debounce that *restarts* on every
   * call — a stream of them never commits until the finger stops, which is no
   * live preview at all and the whole point of a scrub. Going through
   * `commitNow` rather than writing `committed` directly keeps the merge that
   * stops a pending seed being thrown away, which has two regression tests.
   */
  const scrubParams = useCallback(
    (next: Record<string, ParamValue>) => {
      latestParams.current = next;
      setParams(next);
      commitNow({ params: next });
    },
    [commitNow],
  );

  const { handlers: gestureHandlers, readout } = useScrub({
    bindings,
    read: (key) => {
      const v = latestParams.current[key];
      return typeof v === 'number' ? v : 0;
    },
    onScrub: (key, value) => scrubParams(changeParam(key, value)),
    onTap: () => goToPattern(1),
    onStart: () => setScrubbing(true),
    onEnd: () => setScrubbing(false),
  });

  /**
   * `scrubbing` is in here for a reason that is easy to miss. `dirty` is an
   * identity compare, and a gesture commits on every move — so the moment it
   * does, `committed.params` *is* `params` and `dirty` goes false, which sends
   * the preview back to full resolution for every frame of the drag. The
   * editor would get slower during the one interaction built for speed, with
   * nothing on screen to say why.
   */
  const dirty = scrubbing || committed.params !== params || committed.palette !== palette || committed.seed !== seed;

  const query = useMemo(
    () => encodeConfig({ generatorId: generator.id, seed: committed.seed, params: committed.params, palette: committed.palette }),
    [generator.id, committed],
  );

  /**
   * Where this document lives, less the pattern on the end.
   *
   * Captured once from the pathname the page was served at, so it carries
   * whatever base path the deploy is under — a project site serves from
   * `/<repo>/` and Next bakes that in at build time, which a hand-written path
   * would miss. Read at mount rather than per render because it cannot change
   * without a navigation, and a tap rewrites only the last segment.
   */
  const baseRef = useRef<string | null>(null);
  if (baseRef.current === null && typeof window !== 'undefined') {
    // `/m` carries the pattern in `?g=` rather than in the path, so there is
    // no last segment to strip and the path stays exactly where it is. The
    // editor's own route ends in `p/<id>/`, which a tap rewrites.
    baseRef.current = bare
      ? window.location.pathname
      : window.location.pathname.replace(/p\/[^/]*\/?$/, '');
  }

  // The URL is the document. Replace rather than push so the back button still
  // means "the page I came from", not "the last slider I touched" — and not
  // "the pattern before this one" either: a tap is a look around rather than a
  // place you came from, and a back button that undid taps one at a time would
  // make leaving the editor a matter of luck.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = window.setTimeout(() => {
      const path = bare ? (baseRef.current ?? '') : `${baseRef.current ?? ''}p/${generator.id}/`;
      const full = bare ? `g=${encodeURIComponent(generator.id)}&${query}` : query;
      window.history.replaceState(null, '', `${path}?${full}`);
    }, 220);
    return () => window.clearTimeout(id);
  }, [query, generator.id, bare]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(id);
  }, [copied]);

  useEffect(() => {
    if (collectState === 'idle') return;
    const id = window.setTimeout(() => setCollectState('idle'), 2600);
    return () => window.clearTimeout(id);
  }, [collectState]);

  const previewWidth = dirty ? PREVIEW_DRAFT : PREVIEW_FULL;
  // On `/m` the canvas is the device's screen rather than a 9:19.5 mock, so
  // the render is a true wallpaper for whatever phone is holding it -- and no
  // bleed, because nothing is going to crop this: the picture *is* the screen.
  // While scrubbing it still drops to the draft width; a settle then redraws
  // at the screen's real pixel count, which on a 3x phone is about 1,170.
  const barePx = screenBox ? Math.min(1400, Math.round(screenBox.w * screenBox.dpr)) : PREVIEW_FULL;
  const spec: RenderSpec = useMemo(
    () => {
      if (bare) {
        const width = dirty ? Math.min(PREVIEW_DRAFT, barePx) : barePx;
        const ratio = screenBox ? screenBox.h / screenBox.w : 19.5 / 9;
        return {
          generatorId: generator.id,
          seed: committed.seed,
          params: committed.params,
          palette: committed.palette,
          width,
          height: Math.round(width * ratio),
          bleed: 0,
        };
      }
      return {
        generatorId: generator.id,
        seed: committed.seed,
        params: committed.params,
        palette: committed.palette,
        width: previewWidth,
        height: Math.round((previewWidth * 19.5) / 9),
        bleed: DEFAULT_BLEED,
      };
    },
    [generator.id, committed, previewWidth, bare, barePx, dirty, screenBox],
  );

  // Shared tags first, then whatever else is in the registry. An empty column
  // is a dead end; three patterns with an honest label about why they are here
  // is not.
  const related = useMemo(
    () =>
      generators
        .filter((g) => g.id !== generator.id)
        .map((g) => ({ g, shared: g.tags.filter((t) => generator.tags.includes(t)).length }))
        .sort((a, b) => b.shared - a.shared || a.g.name.localeCompare(b.g.name))
        .slice(0, 3),
    [generator],
  );

  const onCopyLink = async () => {
    const url = `${window.location.origin}${baseRef.current ?? ''}p/${generator.id}/?${query}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.history.replaceState(null, '', `${baseRef.current ?? ''}p/${generator.id}/?${query}`);
      setNotes((n) => [...n, 'This browser blocked the clipboard. The address bar now holds the exact link — copy it from there.']);
    }
  };

  /**
   * The picture and the controls that sit on it. `/m` is this and nothing
   * else, so it is built once and used in both places rather than copied --
   * a second copy is a second set of gesture wiring to drift.
   */
  const previewEl = (
    <PreviewFrame
        fill={bare ? { w: (screenBox ?? FALLBACK_SCREEN).w, h: (screenBox ?? FALLBACK_SCREEN).h } : null}
        spec={spec}
        mode={mode}
        showZones={showZones}
        alt={`${generator.name} rendered with the ${palette.name} palette, seed ${committed.seed}`}
        {...(bare ? {} : { caption: `Previewing with 8% bleed, as exported. Seed ${committed.seed}.` })}
        onRenderError={setRenderError}
        channel="editor-preview"
        {...(bindings.length > 0 ? { gesture: { handlers: gestureHandlers, readout } } : {})}
        {...(bindings.length > 0
          ? {
              settings: (
                <PreviewSettings
                  generator={generator}
                  params={params}
                  palette={palette}
                  open={sheet}
                  onOpen={setSheet}
                  onChange={(key, value) => applyParams(changeParam(key, value), 110)}
                  onCommit={() => settle({ params: latestParams.current }, 0)}
                  onNewSeed={newSeed}
                  collected={collected}
                  onCollect={collect}
                  // Where the collection sends a tile back to. From `/m` the
                  // picture is the whole screen, so handing a tile to the
                  // editor route with no way back is a one-way door.
                  collectedHref={bare ? '/collected?from=m' : '/collected'}
                  showStamp={bare}
                  onPalette={(p) => {
                    setPalette(p);
                    commitNow({ palette: p });
                  }}
                />
              ),
            }
          : {})}
      />
  );

  // `/m`: the preview fills the screen and there is no page around it. Black
  // takes up whatever the device's aspect leaves over, which on a phone is
  // nothing and on a desktop is most of the window.
  if (bare) {
    return (
      <main id="main" className={styles.bare}>
        {/* A landmark and a heading, neither of them drawn.
            A page with no `main` and no `h1` is hostile to a screen reader
            however tidy it looks, and this one has no chrome to hang them on.
            It is also load-bearing for the suite: the preview helpers scope to
            `main`, which is how the missing landmark was found. */}
        <h1 className="pw-visually-hidden">{generator.name} — phone view</h1>
        <div className={styles.bareStage}>{previewEl}</div>
      </main>
    );
  }

  return (
    <div className={styles.page}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/">Gallery</Link>
        <span aria-hidden="true">/</span>
        <span>{generator.name}</span>
      </nav>

      <div className={styles.head}>
        <h1 className={styles.title}>{generator.name}</h1>
        <p className={styles.tagline}>{generator.tagline}</p>
        <div className={styles.tags}>
          {generator.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      </div>

      {notes.map((n, i) => (
        <Notice key={`${i}-${n.slice(0, 12)}`} level="warn" onDismiss={() => setNotes((all) => all.filter((_, j) => j !== i))}>
          {n}
        </Notice>
      ))}
      {renderError ? (
        <Notice level="error" onDismiss={() => setRenderError(null)}>
          {renderError}
        </Notice>
      ) : null}

      <div className={styles.layout}>
        <div className={styles.previewCol}>
          <div className={styles.modeRow} role="group" aria-label="Preview mode">
            {PREVIEW_MODES.map((m) => (
              <Button key={m.value} size="small" onClick={() => setMode(m.value)} aria-pressed={mode === m.value} selected={mode === m.value}>
                {m.label}
              </Button>
            ))}
          </div>
          <p className={styles.modeHint}>{PREVIEW_MODES.find((m) => m.value === mode)?.hint}</p>

          {previewEl}

          <div className={styles.underPreview}>
            <div className={ui.labelRow}>
              <span className={ui.label}>
                Safe zones
              </span>
              <Switch checked={showZones} onChange={setShowZones} label="Show the iOS safe zone outlines" />
            </div>

            <div className={styles.seedRow}>
              <div className={`${ui.field} ${styles.seedField}`} style={{ marginBottom: 0 }}>
                <label className={ui.label} htmlFor="seed-input">
                  Seed
                </label>
                <input
                  id="seed-input"
                  className={`${ui.input} ${ui.mono}`}
                  value={seed}
                  spellCheck={false}
                  data-testid="seed-input"
                  onChange={(e) => {
                    const v = e.target.value.slice(0, 64);
                    setSeed(v);
                    settle({ seed: v }, 260);
                  }}
                />
              </div>
              <Button
                onClick={() => {
                  const v = randomSeed();
                  setSeed(v);
                  commitNow({ seed: v });
                }}
                data-testid="shuffle-seed"
              >
                Shuffle
              </Button>
            </div>

            <div className={styles.linkRow}>
              <Button onClick={() => void onCopyLink()} success={copied} data-testid="copy-link">
                {copied ? 'Link copied' : 'Copy link'}
              </Button>
              <Button
                onClick={collect}
                success={collectState === 'saved'}
                data-testid="collect"
              >
                {collectState === 'saved' ? 'Collected' : collectState === 'already' ? 'Already collected' : 'Collect'}
              </Button>
              {collectedCount > 0 ? (
                <Link className={`${ui.btn} ${ui.small}`} href="/collected">
                  {collectedCount} saved
                </Link>
              ) : null}
            </div>
            {collectState === 'failed' ? (
              <Notice level="error">This browser would not let anything be stored, so the collection is empty by necessity.</Notice>
            ) : null}
          </div>
        </div>

        <div className={styles.controlsCol}>
          <TabList
            label="Editor panels"
            tabs={PANELS}
            value={panel}
            onChange={setPanel}
            idFor={(v) => `tab-${v}`}
            panelIdFor={(v) => `panel-${v}`}
            className={styles.tabs}
            tabClassName={(on) => (on ? `${styles.tab} ${styles.tabOn}` : styles.tab)}
          />

          {panel === 'pattern' ? (
            <div role="tabpanel" id="panel-pattern" aria-labelledby="tab-pattern" tabIndex={0}>
              <ParamControls
                generator={generator}
                params={params}
                onChange={(key, value) => applyParams(changeParam(key, value), 110)}
                onCommit={() => settle({ params: latestParams.current }, 0)}
                onPattern={(id) => goToPattern(generators.findIndex((g) => g.id === id) - generators.findIndex((g) => g.id === latestGenerator.current))}
              />
              <Button
                size="small"
                onClick={() => {
                  const next = defaultParams(generator);
                  latestParams.current = next;
                  setParams(next);
                  commitNow({ params: next });
                }}
              >
                Reset to defaults
              </Button>
            </div>
          ) : null}

          {panel === 'palette' ? (
            <div role="tabpanel" id="panel-palette" aria-labelledby="tab-palette" tabIndex={0}>
              <PalettePanel
                palette={palette}
                onChange={(p) => {
                  setPalette(p);
                  settle({ palette: p }, 90);
                }}
              />
            </div>
          ) : null}

          {panel === 'export' ? (
            <div role="tabpanel" id="panel-export" aria-labelledby="tab-export" tabIndex={0}>
              <ExportPanel
                subject={{
                  generatorId: generator.id,
                  generatorName: generator.name,
                  seed: committed.seed,
                  params: committed.params,
                  palette: committed.palette,
                }}
              />
            </div>
          ) : null}
        </div>
        <div className={styles.essay}>
        <div className={styles.prose}>
          <h2>How {generator.name} works</h2>
          {renderProse(generator.description)}
        </div>
        <div className={styles.related}>
          <h3>{related.some((r) => r.shared > 0) ? 'Related patterns' : 'Elsewhere in the gallery'}</h3>
          {related.length === 0 ? (
            <p className={styles.relatedEmpty}>
              Nothing else shares a tag with this one yet. <Link href="/">Back to the gallery</Link>.
            </p>
          ) : (
            <ul className={styles.relatedList}>
              {related.map(({ g, shared }) => (
                <li key={g.id} className={styles.relatedItem}>
                  <Link href={`/p/${g.id}`}>
                    <PatternImage
                      spec={{ generatorId: g.id, seed: `related-${g.id}`, params: defaultParams(g), palette: committed.palette, width: 108, height: 234, bleed: 0 }}
                      alt=""
                      className={styles.relatedThumb}
                    />
                    <span>
                      <span className={styles.relatedName}>{g.name}</span>
                      <span className={styles.relatedTag}>
                        {shared === 0 ? 'Nothing in common' : shared === 1 ? 'Shares one tag' : `Shares ${shared} tags`} ·{' '}
                        {g.tags.join(', ')}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
