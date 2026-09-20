'use client';

import { useRef, useState } from 'react';
import JSZip from 'jszip';
import { Button, Notice, Progress, uiStyles as ui } from './ui';
import { ExportSettingsFields, useExportSettings } from './ExportSettings';
import { downloadBlob, formatBytes, safeFilename } from '../lib/export-png';
import { exportableItems, renderCollection } from '../lib/export-collection';
import type { CollectedItem } from '../lib/storage';
import styles from './ExportPanel.module.css';

/**
 * Batch export, driven by the collection rather than by a seed sweep.
 *
 * The earlier version rendered thirty random variations of whatever pattern you
 * happened to have open, which produced an album nobody had chosen. Exporting
 * what you actually collected gives the Shortcut a set you curated, and every
 * file keeps its own generator, seed, parameters and palette.
 */
export function CollectionExport({ items }: { items: CollectedItem[] }) {
  const s = useExportSettings();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const cancelRef = useRef(false);

  const total = exportableItems(items).length;

  const onExport = async () => {
    setRunning(true);
    setProgress(0);
    setNote(null);
    setError(null);
    cancelRef.current = false;
    try {
      // The same loop the phone's export sheet runs. It was a second copy of
      // it -- same palette boost, same numbering, same yield -- on the two
      // surfaces most likely to drift apart, so a change to progress,
      // cancellation or file naming reached one of them and not the other.
      const files = await renderCollection(items, s, {
        onProgress: (n) => setProgress(n / Math.max(1, total)),
        cancelled: () => cancelRef.current,
      });
      const zip = new JSZip();
      for (const f of files) zip.file(f.name, f.blob);
      if (cancelRef.current) {
        setNote('Export cancelled. Nothing was downloaded.');
        return;
      }
      const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
        setProgress(0.9 + (meta.percent / 100) * 0.1);
      });
      downloadBlob(out, `${safeFilename(['patternwall', 'collection', `${total}`])}.zip`);
      // No "N skipped" clause: `exportable` has already dropped every item
      // whose generator is missing from this build, so the loop cannot meet
      // one. The count and the sentence were kept for a while after that
      // filter arrived, which made the copy unreachable rather than merely
      // unused.
      setNote(
        `${total} wallpaper${total === 1 ? '' : 's'} zipped — ${formatBytes(out.size)}.` +
          ' Import them into a Photos album called PatternWall and see Automate.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The export failed part way through. Try PNG-24, or a smaller size.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className={styles.batch} aria-labelledby="collection-export-head">
      <div className={styles.batchHead} id="collection-export-head">
        Export the collection
      </div>
      <p className={styles.hint}>
        Every configuration above, rendered at one size and zipped together. Each file keeps its own pattern, seed and
        palette — this is the album a Shortcut picks from each morning.
      </p>

      <div className={styles.buttons}>
        <Button variant="primary" onClick={() => void onExport()} loading={running} data-testid="export-collection">
          {running ? `Rendering ${Math.min(total, Math.round(progress * total))} of ${total}…` : `Export all ${total} as a zip`}
        </Button>
        {running ? (
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              cancelRef.current = true;
            }}
          >
            Cancel
          </Button>
        ) : (
          <Button size="small" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Hide settings' : 'Export settings'}
          </Button>
        )}
      </div>

      {running ? (
        <div className={styles.progressWrap}>
          <Progress value={progress} label="Collection export progress" />
        </div>
      ) : null}

      {note ? <Notice onDismiss={() => setNote(null)}>{note}</Notice> : null}
      {error ? (
        <Notice level="error" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      ) : null}

      {open && !running ? (
        <div className={styles.settings}>
          <ExportSettingsFields settings={s} onDetectFailed={setError} />
          <p className={ui.help}>
            {s.outWidth}×{s.outHeight} per file · {s.depth === 'png8' ? `PNG-8 · ${s.colors} colours` : 'PNG-24'}
          </p>
        </div>
      ) : null}
    </section>
  );
}
