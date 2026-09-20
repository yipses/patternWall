'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Button, Notice, Progress } from './ui';
import { DeviceList, ExportSettingsFields, useExportSettings } from './ExportSettings';
import { PatternImage } from './PatternImage';
import { DEVICE_PRESETS } from '../lib/devices';
import { downloadBlob, formatBytes, safeFilename } from '../lib/export-png';
import { deliverWallpapers, exportableItems, renderCollection, type RenderedWallpaper } from '../lib/export-collection';
import { useSheetDrag } from '../lib/use-sheet-drag';
import type { CollectedItem } from '../lib/storage';
import styles from './ExportSheet.module.css';

type Stage = 'summary' | 'settings' | 'devices' | 'running' | 'done';

/** What became of the files, in the words the app is entitled to use. */
type Outcome = 'shared' | 'dismissed' | 'downloaded' | 'zipped' | 'cancelled' | 'failed';

/**
 * Exporting a selection, as one sheet you move through.
 *
 * The sheet stages an action: nothing happens until Export is pressed. That
 * decides its whole layout, and it is why this differs from the gear and the
 * droplet rather than being inconsistent with them. A panel that edits live has
 * nothing to discard, so its escape *is* its completion and reads `Done` on the
 * right. A panel that stages one has something to discard, so its escape is
 * `Cancel` on the left and the commit moves to a full-width button at the
 * bottom — which is also the part of a bottom-anchored sheet a thumb can
 * actually reach.
 *
 * The one place the escape crosses over is the end: once the files exist there
 * is nothing left to discard, so the slot becomes `Done` on the right.
 */
export function ExportSheet({ items, onClose }: { items: CollectedItem[]; onClose: () => void }) {
  const s = useExportSettings();
  const [stage, setStage] = useState<Stage>('summary');
  const [advanced, setAdvanced] = useState(false);
  const [done, setDone] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<RenderedWallpaper[] | null>(null);
  const cancelRef = useRef(false);

  const drawable = exportableItems(items);
  const total = drawable.length;
  const deviceName = s.custom ? 'This screen' : (DEVICE_PRESETS.find((d) => d.id === s.presetId)?.label ?? 'Custom size');

  /*
   * Stable, so the key handler below can depend on it honestly rather than
   * being given an empty dependency array and a promise.
   *
   * `onClose` is a new function on every render of the parent, so a `dismiss`
   * that closed over it directly would either re-register the document
   * listener on every one of those renders or quietly hold the first. The ref
   * keeps the latest without either.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const dismiss = useCallback((): void => {
    cancelRef.current = true;
    onCloseRef.current();
  }, []);

  // Dragging it away is a cancel, mid-render included. A render is seconds and
  // re-runnable; a modal that traps you while a bar moves is the worse failure.
  const { sheetRef, gripProps, sheetStyle } = useSheetDrag(dismiss);

  /**
   * A dialog that behaves like one.
   *
   * It said `role="dialog"` and then left focus in the grid behind it, with no
   * Escape and nothing containing Tab — a screen reader announced a dialog and
   * put the user somewhere else. Escape is the key everybody tries on a sheet.
   */
  useEffect(() => {
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = sheetRef.current;
      if (!root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.hasAttribute('disabled'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismiss, sheetRef]);

  const zipUp = async (files: RenderedWallpaper[]): Promise<void> => {
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.blob);
    const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    downloadBlob(out, `${safeFilename(['patternwall', 'collection', `${files.length}`])}.zip`);
  };

  const deliver = async (files: RenderedWallpaper[], force?: 'share' | 'download'): Promise<void> => {
    const how = await deliverWallpapers(files, zipUp, (f) => downloadBlob(f.blob, f.name), force);
    setOutcome(how);
  };

  const run = async (): Promise<void> => {
    cancelRef.current = false;
    setStage('running');
    setDone(0);
    setOutcome(null);
    setError(null);
    try {
      const files = await renderCollection(items, s, {
        onProgress: (n) => setDone(n),
        cancelled: () => cancelRef.current,
      });
      if (cancelRef.current) {
        // Nothing half-finished is kept. Re-running costs seconds and a partial
        // album is worse than none.
        setStage('summary');
        setOutcome('cancelled');
        return;
      }
      setRendered(files);
      await deliver(files);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The export failed part way through. Try PNG-24, or a smaller size.');
      setOutcome('failed');
      setStage('summary');
    }
  };

  const outcomeLine =
    outcome === 'shared'
      ? `${rendered?.length ?? total} handed to your device.`
      : outcome === 'dismissed'
        ? 'Not saved — the share sheet was dismissed.'
        : outcome === 'downloaded' || outcome === 'zipped'
          ? 'Saved to your downloads.'
          : outcome === 'cancelled'
            ? 'Export cancelled. Nothing was saved.'
            : null;

  return (
    <>
      {/*
       * A scrim, which this did not have. `--bg-raised` over a grid of
       * generative wallpapers has no guaranteed contrast and fails worst on the
       * light-paper palettes, which are the good ones. It also answers whether
       * the grid behind is still live — it is not — and gives the second
       * standard way out.
       */}
      <div className={styles.scrim} onClick={dismiss} data-testid="export-scrim" aria-hidden="true" />

      <div
        className={`${styles.sheet} pw-sheet`}
        role="dialog"
        aria-modal="true"
        aria-label="Export the selection"
        data-testid="export-sheet"
        ref={sheetRef}
        tabIndex={-1}
        style={sheetStyle}
      >
        {/* The grip, and the grabber is drawn again because there is now
            something behind it. It was deleted when the drag was not
            implemented -- a glyph that means drag is either wired up or not
            drawn -- and the header is part of the grip so the whole top of the
            sheet pulls, not just four pixels of bar. */}
        <div className={styles.grip} {...gripProps} data-testid="export-grip">
          <span className={styles.grabber} aria-hidden="true" />
          <div className={styles.head}>
          <span className={styles.slot}>
            {stage === 'devices' ? (
              <Button size="small" variant="ghost" onClick={() => setStage('settings')} data-testid="export-back-devices">
                ‹ Size &amp; Format
              </Button>
            ) : stage === 'settings' ? (
              <Button size="small" variant="ghost" onClick={() => setStage('summary')} data-testid="export-back">
                ‹ Export
              </Button>
            ) : stage === 'done' ? null : (
              <Button size="small" variant="ghost" onClick={dismiss} data-testid="export-cancel">
                Cancel
              </Button>
            )}
          </span>

          {/* One title for summary, running and done: it is the same task
              throughout, and a title that changes under the finger flickers. */}
          <span className={styles.headTitle}>
            {stage === 'devices' ? 'Device' : stage === 'settings' ? 'Size & Format' : 'Export'}
          </span>

          <span className={`${styles.slot} ${styles.slotEnd}`}>
            {stage === 'done' ? (
              <Button size="small" onClick={onClose} data-testid="export-done">
                Done
              </Button>
            ) : null}
            </span>
          </div>
        </div>

        {stage === 'devices' ? (
          <div className={styles.body}>
            <DeviceList settings={s} onPick={() => setStage('settings')} />
          </div>
        ) : null}

        {stage === 'settings' ? (
          <div className={styles.body}>
            {/* A row that pushes, not a select that opens a wheel picker over
                a sheet over a scrim. */}
            <button type="button" className={styles.summary} onClick={() => setStage('devices')} data-testid="export-device">
              <span className={styles.summaryText}>
                <span className={styles.summaryTop}>{deviceName}</span>
                <span className={styles.summarySub}>
                  {s.base.width} × {s.base.height}
                </span>
              </span>
              <span className={styles.chev} aria-hidden="true">
                ›
              </span>
            </button>
            <ExportSettingsFields settings={s} onDetectFailed={setError} only="custom" />
            <Button
              size="small"
              variant="ghost"
              className={styles.advanced}
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
              data-testid="export-advanced"
            >
              {advanced ? 'Hide advanced' : 'Advanced'}
            </Button>
            {advanced ? <ExportSettingsFields settings={s} onDetectFailed={setError} only="rest" /> : null}
          </div>
        ) : null}

        {stage === 'summary' ? (
          <div className={styles.body}>
            <button type="button" className={styles.summary} onClick={() => setStage('settings')} data-testid="export-summary">
              <span className={styles.summaryText}>
                <span className={styles.summaryTop}>
                  {deviceName} · {s.outWidth} × {s.outHeight}
                </span>
                <span className={styles.summarySub}>
                  {s.depth === 'png8' ? `PNG-8 · ${s.colors} colours` : 'PNG-24'}
                  {s.bleed > 0 ? ' · 8% bleed' : ''}
                </span>
              </span>
              <span className={styles.chev} aria-hidden="true">
                ›
              </span>
            </button>

            {outcomeLine ? <p className={styles.outcome}>{outcomeLine}</p> : null}
            {/* No dismiss of its own -- one surface, one dismiss target. It
                clears when the next export starts, which is the only thing
                that can change the answer. */}
            {error ? <Notice level="error">{error}</Notice> : null}

            <Button variant="primary" className={styles.go} onClick={() => void run()} data-testid="export-run">
              Export {total}
            </Button>
          </div>
        ) : null}

        {stage === 'running' ? (
          <div className={styles.body}>
            <p className={styles.count} aria-live="polite">
              {done} of {total}
            </p>
            <Progress value={total === 0 ? 0 : done / total} label="Export progress" />
          </div>
        ) : null}

        {stage === 'done' ? (
          <div className={styles.body}>
            {/* The result as pictures. This is an app whose entire content is
                images; a line of text was wasting the one asset it has. */}
            <ul className={styles.strip}>
              {drawable.slice(0, 6).map((item) => (
                <li key={item.id}>
                  <PatternImage
                    spec={{ generatorId: item.generatorId, seed: item.seed, params: item.params, palette: item.palette, width: 90, height: 195, bleed: 0 }}
                    alt=""
                    className={styles.stripThumb}
                    deferred
                  />
                </li>
              ))}
            </ul>

            <p className={styles.outcomeHead}>
              {outcome === 'dismissed'
                ? 'Not saved'
                : `${rendered?.length ?? total} wallpaper${(rendered?.length ?? total) === 1 ? '' : 's'} exported`}
            </p>
            <p className={styles.outcomeSub}>
              {outcome === 'dismissed'
                ? 'The share sheet was dismissed, so nothing was kept.'
                : `${s.depth === 'png8' ? 'PNG-8' : 'PNG-24'} · ${s.outWidth} × ${s.outHeight}${
                    rendered ? ` · ${formatBytes(rendered.reduce((n, f) => n + f.blob.size, 0))}` : ''
                  }`}
            </p>

            {outcome === 'dismissed' ? (
              <Button
                variant="primary"
                className={styles.go}
                onClick={() => void (rendered ? deliver(rendered, 'share') : undefined)}
                data-testid="export-share-again"
              >
                Share again
              </Button>
            ) : (
              <Button
                size="small"
                variant="ghost"
                onClick={() => void (rendered ? deliver(rendered, 'download') : undefined)}
                data-testid="export-save-instead"
              >
                Also save as files
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
