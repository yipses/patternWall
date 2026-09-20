'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { encodeConfig, getGenerator } from '@patternwall/core';
import { BuildStamp } from './BuildStamp';
import { PatternImage } from './PatternImage';
import type { RenderSpec } from '../lib/render';
import { CollectionExport } from './CollectionExport';
import { ExportSheet } from './ExportSheet';
import { Button, uiStyles as ui } from './ui';
import { FALLBACK_SCREEN, useDeviceScreen } from '../lib/device-screen';
import { loadCollected, removeManyCollected, writeCollected, type CollectedItem } from '../lib/storage';
import styles from './Collected.module.css';

/**
 * How long an undo stays on offer after a delete.
 *
 * Deleting from here is irreversible -- localStorage, no server, no history --
 * and the alternative was a confirm dialog on every removal, which is the
 * wrong trade on a phone: it taxes the common case to guard the rare one. An
 * undo taxes nothing and covers the same mistake.
 */
const UNDO_MS = 5000;

/**
 * How long a press has to hold before it means "select this" rather than "open
 * this".
 *
 * 450ms is the iOS context-menu feel. Much below it a slow tap starts selecting
 * things; much above it stops reading as a response to the finger at all.
 */
const LONG_PRESS_MS = 450;

/**
 * How far outside the viewport a tile starts drawing.
 *
 * About two rows at phone width, so a scroll meets pictures rather than
 * placeholders, and a collection you never scroll costs only what is on screen.
 */
const TILE_MARGIN = '600px 0px';

/** A press that travels this far was a scroll. */
const PRESS_SLOP = 10;

/**
 * A tile that does not draw until it is nearly on screen.
 *
 * Until then it is a rectangle of the wallpaper's own background colour, which
 * is the right placeholder for free: the grid has its layout and its palette
 * immediately, and the picture arrives into a box that was already the right
 * shape and roughly the right colour.
 *
 * The observer is disconnected as soon as it fires -- a tile that has been seen
 * stays drawn, because re-rendering it on scroll would cost more than keeping
 * it. Where there is no `IntersectionObserver` it draws at once, which is the
 * behaviour this replaces.
 */
function LazyTile({
  spec,
  className,
  placeholderClassName,
  background,
}: {
  spec: RenderSpec;
  className: string | undefined;
  placeholderClassName: string | undefined;
  background: string;
}) {
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: TILE_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  if (!seen) return <span ref={ref} className={placeholderClassName} style={{ background }} aria-hidden="true" />;
  // `alt` is empty and `deferred` is on: the link around this carries the name,
  // and the picture is drawn in the worker rather than inline. See PatternImage.
  return <PatternImage spec={spec} alt="" className={className} draggable={false} deferred />;
}

/**
 * The collection, browsable on a phone.
 *
 * Two modes rather than per-tile controls, which is what the arithmetic
 * forces. At 390px with a 12px gutter and 10px gaps a three-column tile is
 * 111px wide; a trash button and a tick are two 44px targets covering most of
 * it, sitting on top of the picture they are meant to be about. So browse mode
 * has no controls on a tile at all -- the tile is the link -- and select mode
 * turns every tile into a checkbox and puts the actions in one bar at the
 * bottom, where there is room for words.
 */
export function Collected({ bare = false }: { bare?: boolean }) {
  const [items, setItems] = useState<CollectedItem[] | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [undo, setUndo] = useState<{ before: CollectedItem[]; count: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);

  /**
   * A tile is the shape of the screen it was saved for.
   *
   * The same hook `/m` uses, and for the same reason: a wallpaper shown at any
   * other aspect is a picture of a different phone. It falls back to a phone
   * shape off a phone, so the desktop grid keeps the proportions it had.
   *
   * Reading it here costs no hydration risk, unlike on `/m`: the grid does not
   * exist during the prerender -- `items` is null until the effect below runs,
   * and the baked HTML says "Reading your collection".
   */
  const screen = useDeviceScreen(true) ?? FALLBACK_SCREEN;
  const thumbWidth = 220;
  const thumbHeight = Math.round((thumbWidth * screen.h) / screen.w);

  useEffect(() => {
    setItems(loadCollected());
  }, []);

  useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(id);
  }, [undo]);

  const list = items ?? [];
  const pickedSet = new Set(picked);
  const pickedItems = list.filter((i) => pickedSet.has(i.id));
  /*
   * How many of the selection can actually be drawn.
   *
   * Every tile is selectable in select mode, including the stand-in for an item
   * whose pattern is not in this build — which is right, because selecting it
   * is how you delete it. Exporting it is not: a selection of only those gave
   * "Export 0", an empty zip, and a note saying nought wallpapers were zipped.
   * Same shape as the "Export all 3" on a zip holding two.
   */
  const pickedDrawable = pickedItems.filter((i) => getGenerator(i.generatorId)).length;

  const toggle = (id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  /**
   * Long-press to enter select mode, which is the gesture a phone already
   * teaches. The rail's tick is the discoverable path and this is the fast one;
   * a labelled Select button was neither, and it was anchored to a heading that
   * no longer exists.
   *
   * A tile is a link, so the press that becomes a selection has to stop the
   * navigation that would otherwise follow it. `suppress` survives exactly one
   * click and is cleared on the next press either way, so a long-press that
   * somehow produces no click cannot swallow a later tap.
   */
  const press = useRef<{ id: string; timer: number; x: number; y: number } | null>(null);
  const suppress = useRef(false);

  const endPress = (): void => {
    if (!press.current) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const startPress = (id: string) => (e: React.PointerEvent) => {
    suppress.current = false;
    endPress();
    const timer = window.setTimeout(() => {
      press.current = null;
      suppress.current = true;
      setSelecting(true);
      setPicked([id]);
    }, LONG_PRESS_MS);
    press.current = { id, timer, x: e.clientX, y: e.clientY };
  };

  const movePress = (e: React.PointerEvent): void => {
    const p = press.current;
    if (!p) return;
    if (Math.abs(e.clientX - p.x) > PRESS_SLOP || Math.abs(e.clientY - p.y) > PRESS_SLOP) endPress();
  };

  const clickTile = (e: React.MouseEvent): void => {
    endPress();
    if (!suppress.current) return;
    suppress.current = false;
    e.preventDefault();
  };

  const endSelect = () => {
    setSelecting(false);
    setPicked([]);
    setExportOpen(false);
    setConfirming(false);
  };

  /**
   * One tile goes straight away and the undo covers it; more than one asks
   * first.
   *
   * They guard different mistakes. An undo covers a mistap, which is the whole
   * risk when the target is one picture. A confirm covers Select All followed
   * by the trash, which is the entire collection in two taps and is the only
   * genuinely destructive thing on this screen. Asking on every single delete
   * would tax the common case to guard the rare one.
   */
  const askDelete = () => {
    if (picked.length > 1) setConfirming(true);
    else deletePicked();
  };

  const deletePicked = () => {
    const before = list;
    const { ok, items: next } = removeManyCollected(picked);
    setItems(next);
    if (!ok) setStorageFailed(true);
    setUndo({ before, count: picked.length });
    setPicked([]);
    setExportOpen(false);
    setConfirming(false);
    if (next.length === 0) setSelecting(false);
  };

  const undoDelete = () => {
    if (!undo) return;
    if (!writeCollected(undo.before)) setStorageFailed(true);
    setItems(undo.before);
    setUndo(null);
  };

  /*
   * `main` on the bare route, the way `/m` does it.
   *
   * Both phone routes live outside the `(site)` group, so neither inherits
   * `SiteChrome`'s skip link and landmark. `Editor` grows its own and this did
   * not, which left a screen that is a wall of unlabelled pictures with
   * nothing to jump to. It is also load-bearing for the suite: `settled()`
   * scopes to `main img`, so every test on this route was falling into its
   * 400ms catch path instead of waiting for a render.
   */
  const Root = bare ? 'main' : 'div';

  return (
    <Root
      className={styles.page}
      data-phone={bare ? 'true' : undefined}
      {...(bare ? { id: 'main' } : {})}
      style={{ ['--pw-tile' as string]: `${screen.w} / ${screen.h}` }}
    >
      {/* The width the phone rules measure against. See the note in the
          stylesheet for why the container is here and not on the page. */}
      <div className={styles.inner}>
        {bare ? (
          /* No title, no explanation, no labelled buttons. The pictures are the
             screen and every word is a row of them not shown; what a heading
             would have said is in the rail, as the two things you can do. The
             landmark stays for anything reading the page, undrawn. */
          <h1 className="pw-visually-hidden">Your collection</h1>
        ) : (
          <div className={styles.head}>
            <h1 className={styles.title}>Collected</h1>
            <p className={styles.sub}>
              Configurations you saved, kept in this browser&rsquo;s local storage. Nothing here is uploaded anywhere, which
              also means it does not follow you to another device — copy a link if you want that.
            </p>
            {list.length > 0 && !selecting ? (
              /* Entering the mode only. Everything you do inside it -- select
                 all, clear, delete, export, leave -- is in the bar, which is
                 the one surface that does not scroll away after a row. */
              <div className={styles.actions}>
                <Button size="small" variant="ghost" onClick={() => setSelecting(true)} data-testid="select-start">
                  Select
                </Button>
              </div>
            ) : null}
          </div>
        )}

        {items === null ? (
          <p className={ui.help}>Reading your collection…</p>
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>Nothing collected yet.</div>
            <p className={styles.emptyBody}>
              Open a pattern, get it to a state you like, and press <strong>Collect</strong>. It will show up here with its seed
              and palette intact, ready to re-open or export again.
            </p>
            <Link className={`${ui.btn} ${ui.primary}`} href="/">
              Browse the gallery
            </Link>
          </div>
        ) : (
          <>
            <ul className={styles.grid} data-testid="collected-grid">
              {items.map((item) => {
                const g = getGenerator(item.generatorId);
                const on = pickedSet.has(item.id);
                const label = g
                  ? `${g.name} with the ${item.palette.name} palette, seed ${item.seed}`
                  : `${item.generatorId}, a pattern that is not in this build, seed ${item.seed}`;

                // The picture, or a stand-in for an item whose pattern this build
                // no longer has. Such an item is kept rather than dropped on load,
                // so it has to be visible: it is the only way to remove it, and
                // returning null once left it counted by the export button and
                // absent from the list.
                const face = g ? (
                  <LazyTile
                    spec={{ generatorId: g.id, seed: item.seed, params: item.params, palette: item.palette, width: thumbWidth, height: thumbHeight, bleed: 0 }}
                    className={styles.thumb}
                    placeholderClassName={styles.thumb}
                    background={item.palette.background}
                  />
                ) : (
                  <span className={styles.gone}>
                    <span className={styles.goneId}>{item.generatorId}</span>
                    <span className={styles.goneNote}>Not in this build. Seed {item.seed}.</span>
                  </span>
                );

                const query = g
                  ? encodeConfig({ generatorId: g.id, seed: item.seed, params: item.params, palette: item.palette })
                  : '';
                // Back where you came from. Opened from `/m` a tile returns to
                // `/m`, which carries its pattern in `?g=` rather than in the
                // path; otherwise it opens the full editor route.
                const href = bare ? `/m?g=${encodeURIComponent(g?.id ?? '')}&${query}` : `/p/${g?.id ?? ''}?${query}`;

                return (
                  <li key={item.id} className={styles.item}>
                    {selecting ? (
                      <button
                        type="button"
                        className={styles.tile}
                        aria-pressed={on}
                        aria-label={label}
                        onClick={() => toggle(item.id)}
                      >
                        {face}
                        <span className={`${styles.check} ${on ? styles.checkOn : ''}`} aria-hidden="true">
                          {on ? '✓' : ''}
                        </span>
                      </button>
                    ) : g ? (
                      <Link
                        className={styles.tile}
                        href={href}
                        // The name is on the link, not on the picture. A tile
                        // that has not drawn yet has no `alt` to borrow one
                        // from, and a link with no accessible name is both an
                        // accessibility fault and unaddressable by every
                        // locator in the suite.
                        aria-label={label}
                        // An anchor is draggable by default, and a native drag
                        // fires `pointercancel`, which ends the press this is
                        // timing. Without it the hold never becomes a
                        // selection the moment the finger moves at all.
                        draggable={false}
                        onPointerDown={startPress(item.id)}
                        onPointerMove={movePress}
                        onPointerUp={endPress}
                        onPointerCancel={endPress}
                        onClick={clickTile}
                      >
                        {face}
                      </Link>
                    ) : (
                      <div className={styles.tile}>{face}</div>
                    )}
                    {g ? (
                      <>
                        <div className={styles.meta}>
                          <span className={styles.name}>{g.name}</span>
                          <span className={styles.when}>{new Date(item.savedAt).toLocaleDateString()}</span>
                        </div>
                        <span className={styles.seed}>
                          {item.palette.name} · {item.seed}
                        </span>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {/* Everything, below the grid, for when nothing has been picked out.
                The selection has its own export, in the sheet. */}
            {bare || selecting ? null : <CollectionExport items={items} />}

          </>
        )}

        {/* Below the last row, in the space the fixed rail already reserves.
            This route has no footer and no settings sheet, and the rule in
            CLAUDE.md is that every page can answer "am I current?" on its own
            -- a green deploy is not proof the served page changed. Outside the
            list rather than after it, because an empty collection is a page
            too and the question is the same one there. It is the only text on
            the screen and you have to reach the end to see it, which is about
            the right price for it. */}
        {bare ? (
          <p className={styles.stamp}>
            <BuildStamp />
          </p>
        ) : null}
      </div>

      {bare && !selecting && items !== null ? (
        <>
          {/*
           * Leaving is top-left, which is where every platform puts it.
           *
           * It was at the bottom of the rail, on the argument that the way out
           * should be where the way in was — the book you pressed is in that
           * corner. That reasoning is about this app and the convention is
           * about every other one, and the convention wins: a person arriving
           * here looks top-left before they look anywhere else. The rail keeps
           * what it is for, which is acting on what is on screen.
           */}
          <Link className={`${styles.round} ${styles.back}`} href="/m" aria-label="Back to the wallpaper" data-testid="collected-back">
            <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.2 5.6 7.8 12l6.4 6.4"
              />
            </svg>
          </Link>

          {items.length > 0 ? (
            <div className={styles.rail} data-testid="collected-rail">
              <button
                type="button"
                className={styles.round}
                aria-label="Select wallpapers"
                onClick={() => setSelecting(true)}
                data-testid="select-start"
              >
                {/* A circled tick, the same mark the tiles take when picked. */}
                <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
                  <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.9" />
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.4 12.2 11 14.8l4.7-5"
                  />
                </svg>
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {selecting && exportOpen ? <ExportSheet items={pickedItems} onClose={() => setExportOpen(false)} /> : null}

      {selecting && !exportOpen && confirming ? (
        /* The confirm takes the bar over rather than opening a dialog on top
           of it. The count is in the verb, so there is nothing to read twice. */
        <div className={`${styles.bar} ${styles.barConfirm}`} data-testid="confirm-bar">
          <Button size="small" variant="ghost" onClick={() => setConfirming(false)} data-testid="confirm-cancel">
            Cancel
          </Button>
          <span className={styles.barCount} />
          <Button size="small" className={styles.danger} onClick={deletePicked} data-testid="confirm-delete">
            Delete {picked.length} wallpapers
          </Button>
        </div>
      ) : null}

      {selecting && !exportOpen && !confirming ? (
        <div className={styles.bar} data-testid="selection-bar">
          <Button size="small" variant="ghost" onClick={endSelect} data-testid="select-done">
            Done
          </Button>
          {/* One slot doing both jobs. At zero it offers the only thing worth
              offering; with a selection it says what you have and clears it. */}
          <button
            type="button"
            className={styles.barCount}
            onClick={() => setPicked(picked.length === 0 ? list.map((i) => i.id) : [])}
            data-testid="select-toggle-all"
          >
            {picked.length === 0 ? 'Select all' : `${picked.length} selected`}
          </button>
          <Button size="small" variant="ghost" disabled={picked.length === 0} onClick={askDelete} data-testid="delete-selected">
            Delete
          </Button>
          <Button
            size="small"
            variant="primary"
            disabled={pickedDrawable === 0}
            onClick={() => setExportOpen(true)}
            data-testid="export-selected"
          >
            Export
          </Button>
        </div>
      ) : null}

      {storageFailed ? (
        <div className={styles.snack} role="status">
          <span>This browser would not let anything be stored, so that change will not survive a reload.</span>
          <Button size="small" onClick={() => setStorageFailed(false)}>
            OK
          </Button>
        </div>
      ) : null}

      {undo ? (
        <div className={`${styles.snack} ${selecting ? styles.snackHigh : ''}`} role="status">
          <span>{undo.count} removed.</span>
          <Button size="small" onClick={undoDelete} data-testid="undo-delete">
            Undo
          </Button>
        </div>
      ) : null}
    </Root>
  );
}
