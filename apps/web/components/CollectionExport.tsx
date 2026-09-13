'use client';

import { useRef, useState } from 'react';
import JSZip from 'jszip';
import { getGenerator } from '@patternwall/core';
import { Button, Notice, Progress, uiStyles as ui } from './ui';
import { ExportSettingsFields, useExportSettings } from './ExportSettings';
import { downloadBlob, formatBytes, renderPngBlob, safeFilename, yieldToBrowser } from '../lib/export-png';
import { boostForHomeScreen } from '../lib/harmony';
import { renderSpec } from '../lib/render';
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

  // Only what can actually be drawn. Counting items whose generator is missing
  // from this build put an "Export all 3" on a zip that would contain two.
  const exportable = items.filter((i) => getGenerator(i.generatorId));
  const total = exportable.length;

  const onExport = async () => {
    setRunning(true);
    setProgress(0);
    setNote(null);
    setError(null);
    cancelRef.current = false;
    let skipped = 0;
    try {
      const zip = new JSZip();
      // Filenames are numbered in collection order so the album has a stable,
      // readable sequence rather than whatever order Photos decides on import.
      const width = String(total).length;
      for (const [i, item] of exportable.entries()) {
        if (cancelRef.current) break;
        const g = getGenerator(item.generatorId);
        if (!g) {
          skipped += 1;
          continue;
        }
        const palette = s.homeVariant ? boostForHomeScreen(item.palette) : item.palette;
        const svg = renderSpec({
          generatorId: item.generatorId,
          seed: item.seed,
          params: item.params,
          palette,
          width: s.outWidth,
          height: s.outHeight,
          bleed: s.bleed,
        });
        const blob = await renderPngBlob(svg, s.outWidth, s.outHeight, { depth: s.depth, colors: s.colors });
        const index = String(i + 1).padStart(width, '0');
        zip.file(`${safeFilename([index, 'patternwall', item.generatorId, item.seed])}.png`, blob);
        setProgress((i + 1) / total);
        // Hand the frame back so scrolling and the thumbnails stay live.
        await yieldToBrowser();
      }
      if (cancelRef.current) {
        setNote('Export cancelled. Nothing was downloaded.');
        return;
      }
      const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
        setProgress(0.9 + (meta.percent / 100) * 0.1);
      });
      downloadBlob(out, `${safeFilename(['patternwall', 'collection', `${total - skipped}`])}.zip`);
      setNote(
        `${total - skipped} wallpaper${total - skipped === 1 ? '' : 's'} zipped — ${formatBytes(out.size)}.` +
          (skipped > 0 ? ` ${skipped} skipped: the pattern is no longer in this build.` : '') +
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
