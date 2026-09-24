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

  /**
   * Where the back chevron goes.
   *
   * `/m` on its own is a *different* wallpaper: the configuration you were
   * looking at lives in that route's query, and leaving for the collection and
   * coming back handed you a fresh seed with the edits gone. Measured on a
   * round trip, the seed changed and the rendered `src` with it. The book
   * carries the query in, and this carries it out.
   *
   * Read at mount rather than during render, for the reason `?from=m` was
   * retired: this page is prerendered and a first render that depends on the
   * query string disagrees with the baked HTML.
   */
  const [backHref, setBackHref] = useState('/m');

  useEffect(() => {
    setItems(loadCollected());
    const q = window.location.search.replace(/^\?/, '');
    if (q) setBackHref(`/m?${q}`);
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
  /* Everything, rather than merely something: the toggle used to read the
     empty case only, so "Select all" stayed on offer once everything already
     was. */
  const allPicked = list.length > 0 && picked.length === list.length;

  const toggle = (id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  /**
   * Long-press to enter select mode, which is the gesture a phone already
   * teaches. The header's Select is the discoverable path and this is the fast
   * one.
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

  /**
   * Put focus where the mode went.
   *
   * Every one of these actions unmounts the control that triggered it —
   * Select becomes Done in the header slot, Done becomes Select, and opening
   * the export hides the bar — so a keyboard or switch user was dropped on
   * `body` and had to Tab from the top of the document to reach the mode they
   * had just entered. The sheet contains its own focus; this is the other
   * three.
   */
  const selectStartRef = useRef<HTMLButtonElement | null>(null);
  const selectDoneRef = useRef<HTMLButtonElement | null>(null);
  const exportOpenRef = useRef<HTMLButtonElement | null>(null);
  const wasSelecting = useRef(false);
  const wasExporting = useRef(false);

  useEffect(() => {
    if (selecting && !wasSelecting.current) selectDoneRef.current?.focus();
    else if (!selecting && wasSelecting.current) selectStartRef.current?.focus();
    wasSelecting.current = selecting;
  }, [selecting]);

  useEffect(() => {
    // Only on the way back. The sheet takes focus itself on the way in.
    if (!exportOpen && wasExporting.current) exportOpenRef.current?.focus();
    wasExporting.current = exportOpen;
  }, [exportOpen]);

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
      data-selecting={selecting ? 'true' : undefined}
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
                <Button size="small" variant="ghost" ref={selectStartRef} onClick={() => setSelecting(true)} data-testid="select-start">
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
            {/* Back to where you would press Collect. On the phone route that
                is the wallpaper you came from, not the site's gallery — the
                one action on an empty screen should not be the way out of the
                phone experience. */}
            <Link className={`${ui.btn} ${ui.primary}`} href={bare ? backHref : '/'}>
              {bare ? 'Back to the wallpaper' : 'Browse the gallery'}
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

        {/* Fixed in the bottom-left corner, and only while browsing. This
            route has no footer and no settings sheet, and the rule in
            CLAUDE.md is that every page can answer "am I current?" on its own
            -- a green deploy is not proof the served page changed. It comes
            off the screen the moment a bar is raised, because the bar owns
            that edge and two things at the bottom of a screen are one thing
            too many. See the stylesheet for why it is no longer the last item
            in the flow. */}
        {bare && !selecting ? (
          <p className={styles.stamp}>
            <BuildStamp />
          </p>
        ) : null}
      </div>

      {/*
       * The phone header: retreat, what the mode is, and the mode switch.
       *
       * Hidden while the export sheet is up, the way the bar is: the sheet is
       * the surface then, and it carries its own way out.
       */}
      {bare && items !== null && !exportOpen ? (
        <>
          <div className={styles.scrimTop} aria-hidden="true" />
          {!selecting ? <div className={styles.scrimBottom} aria-hidden="true" /> : null}
          <div className={styles.header} data-testid="collected-header">
            <span className={styles.headSlot}>
              {/*
               * Leaving is top-left, which is where every platform puts it,
               * and it is gone in select mode -- the way out of a mode is the
               * mode switch, not the way off the screen.
               */}
              {!selecting ? (
                <Link
                  className={styles.round}
                  href={backHref}
                  aria-label="Back to the wallpaper"
                  data-testid="collected-back"
                >
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
              ) : null}
            </span>

            <span className={styles.headTitle} data-testid="collected-title">
              {selecting ? (picked.length === 0 ? 'Select wallpapers' : `${picked.length} selected`) : ''}
            </span>

            <span className={`${styles.headSlot} ${styles.headEnd}`}>
              {/*
               * One slot, toggling Select and Done.
               *
               * Select mode is neither a screen nor a sheet -- it is a mode on
               * a screen, and a mode is entered and left from the same place.
               * It was entered from the bottom-right corner and left from the
               * bottom-left of the bar, which asks a person to remember two
               * places for one switch.
               */}
              {selecting ? (
                <button
                  type="button"
                  className={styles.capsule}
                  ref={selectDoneRef}
                  onClick={endSelect}
                  data-testid="select-done"
                >
                  Done
                </button>
              ) : items.length > 0 ? (
                <button
                  type="button"
                  className={styles.capsule}
                  ref={selectStartRef}
                  onClick={() => setSelecting(true)}
                  data-testid="select-start"
                >
                  Select
                </button>
              ) : null}
            </span>
          </div>
        </>
      ) : null}

      {selecting && exportOpen ? <ExportSheet items={pickedItems} onClose={() => setExportOpen(false)} /> : null}

      {selecting && !exportOpen && confirming ? (
        /* The confirm takes the bar over rather than opening a dialog on top
           of it, and keeps the bar's shape: the count is in the verb, so there
           is nothing to read twice, and the destructive button is the
           full-width one because it is the only thing this stage is for. */
        <div className={`${styles.bar} ${styles.barConfirm}`} data-testid="confirm-bar">
          <div className={styles.barRow}>
            <Button size="small" variant="ghost" onClick={() => setConfirming(false)} data-testid="confirm-cancel">
              Cancel
            </Button>
          </div>
          <Button
            className={`${styles.barPrimary} ${styles.danger}`}
            onClick={deletePicked}
            data-testid="confirm-delete"
          >
            Delete {picked.length} wallpapers
          </Button>
        </div>
      ) : null}

      {selecting && !exportOpen && !confirming ? (
        /*
         * Two tiers. Select all and Delete are the secondary row; Export is
         * the primary and takes the width, because it is the reason anything
         * is being selected. Done is not here any more -- it is the header,
         * in the slot that opened the mode.
         */
        <div className={styles.bar} data-testid="selection-bar">
          <div className={styles.barRow}>
            {/*
             * The way out of the mode, on the route whose header is not fixed.
             *
             * On the phone it is the header, in the slot that opened the mode.
             * The site route's header scrolls away after the first row, so a
             * Done up there would be gone by the time anyone wanted it, and
             * the bar is the one surface that stays. Same rule -- leave from
             * somewhere that is still on screen -- with two answers because
             * the two headers behave differently.
             */}
            {bare ? null : (
              <Button size="small" variant="ghost" ref={selectDoneRef} onClick={endSelect} data-testid="select-done">
                Done
              </Button>
            )}
            <Button
              size="small"
              variant="ghost"
              onClick={() => setPicked(allPicked ? [] : list.map((i) => i.id))}
              data-testid="select-toggle-all"
            >
              {allPicked ? 'Deselect all' : 'Select all'}
            </Button>
            {/* On the phone the count is the header title. Here there is no
                phone header to carry it, and the page's own heading is the
                route's, so the bar says it. */}
            {bare ? null : (
              <span className={styles.barCount} data-testid="selection-count">
                {picked.length} selected
              </span>
            )}
            <Button
              size="small"
              variant="ghost"
              className={styles.danger}
              disabled={picked.length === 0}
              onClick={askDelete}
              data-testid="delete-selected"
            >
              Delete
            </Button>
          </div>
          <Button
            variant="primary"
            className={styles.barPrimary}
            ref={exportOpenRef}
            disabled={pickedDrawable === 0}
            onClick={() => setExportOpen(true)}
            data-testid="export-selected"
          >
            {pickedDrawable === 0 ? 'Export' : `Export ${pickedDrawable}`}
          </Button>
        </div>
      ) : null}

      {storageFailed ? (
        <div className={`${styles.snack} ${selecting ? styles.snackHigh : ''}`} role="status">
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
