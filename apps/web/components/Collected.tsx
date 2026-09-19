'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { encodeConfig, getGenerator } from '@patternwall/core';
import { PatternImage } from './PatternImage';
import { CollectionExport } from './CollectionExport';
import { Button, uiStyles as ui } from './ui';
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
const UNDO_MS = 9000;

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
export function Collected() {
  const [items, setItems] = useState<CollectedItem[] | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [undo, setUndo] = useState<{ before: CollectedItem[]; count: number } | null>(null);
  /**
   * Whether this page was opened from `/m`, which decides where a tile goes
   * back to. Read at mount and never during render: the static export
   * prerenders this page, so a first render that depends on the query string
   * disagrees with the baked HTML -- the hydration-mismatch class recorded in
   * `next.config.mjs`.
   */
  const [fromPhone, setFromPhone] = useState(false);

  useEffect(() => {
    setItems(loadCollected());
    setFromPhone(new URLSearchParams(window.location.search).get('from') === 'm');
  }, []);

  useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(id);
  }, [undo]);

  const list = items ?? [];
  const pickedSet = new Set(picked);
  const pickedItems = list.filter((i) => pickedSet.has(i.id));

  const toggle = (id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const endSelect = () => {
    setSelecting(false);
    setPicked([]);
    setExportOpen(false);
  };

  const deletePicked = () => {
    const before = list;
    const next = removeManyCollected(picked);
    setItems(next);
    setUndo({ before, count: picked.length });
    setPicked([]);
    setExportOpen(false);
    if (next.length === 0) setSelecting(false);
  };

  const undoDelete = () => {
    if (!undo) return;
    writeCollected(undo.before);
    setItems(undo.before);
    setUndo(null);
  };

  return (
    <div className={styles.page} data-phone={fromPhone ? 'true' : undefined}>
      {/* The width the phone rules measure against. See the note in the
          stylesheet for why the container is here and not on the page. */}
      <div className={styles.inner}>
        <div className={styles.head}>
          {fromPhone ? (
            <Link className={styles.back} href="/m" data-testid="collected-back">
              ← Back to the phone view
            </Link>
          ) : null}
          <h1 className={styles.title}>Collected</h1>
          <p className={styles.sub}>
            Configurations you saved, kept in this browser&rsquo;s local storage. Nothing here is uploaded anywhere, which also
            means it does not follow you to another device — copy a link if you want that.
          </p>
          {list.length > 0 ? (
            <div className={styles.actions}>
              {selecting ? (
                /* Leaving select mode is in the bar, not here: the header
                   scrolls away after the first row and a mode you cannot get out
                   of without scrolling back to the top is a trap. */
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => setPicked(picked.length === list.length ? [] : list.map((i) => i.id))}
                >
                  {picked.length === list.length ? 'Select none' : 'Select all'}
                </Button>
              ) : (
                <Button size="small" variant="ghost" onClick={() => setSelecting(true)} data-testid="select-start">
                  Select
                </Button>
              )}
            </div>
          ) : null}
        </div>

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
                  <PatternImage
                    spec={{ generatorId: g.id, seed: item.seed, params: item.params, palette: item.palette, width: 220, height: 477, bleed: 0 }}
                    alt={selecting ? '' : label}
                    className={styles.thumb}
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
                const href = fromPhone ? `/m?g=${encodeURIComponent(g?.id ?? '')}&${query}` : `/p/${g?.id ?? ''}?${query}`;

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
                      <Link className={styles.tile} href={href}>
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
            {selecting ? null : <CollectionExport items={items} />}
          </>
        )}
      </div>

      {selecting && exportOpen ? (
        <div className={styles.sheet} role="dialog" aria-label="Export the selection">
          <div className={styles.sheetHead}>
            <Button size="small" variant="ghost" onClick={() => setExportOpen(false)} data-testid="sheet-close">
              Close
            </Button>
          </div>
          <CollectionExport items={pickedItems} scope="selection" />
        </div>
      ) : null}

      {selecting && !exportOpen ? (
        <div className={styles.bar} data-testid="selection-bar">
          <Button size="small" variant="ghost" onClick={endSelect} data-testid="select-done">
            Done
          </Button>
          <span className={styles.barCount}>{picked.length === 0 ? 'None selected' : `${picked.length} selected`}</span>
          <Button size="small" variant="ghost" disabled={picked.length === 0} onClick={deletePicked} data-testid="delete-selected">
            Delete
          </Button>
          <Button
            size="small"
            variant="primary"
            disabled={picked.length === 0}
            onClick={() => setExportOpen(true)}
            data-testid="export-selected"
          >
            Export
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
    </div>
  );
}
