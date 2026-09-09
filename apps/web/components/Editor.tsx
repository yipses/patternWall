'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_BLEED,
  decodeConfig,
  defaultParams,
  encodeConfig,
  generators,
  getGenerator,
  initialConfig,
  type Palette,
  type ParamValue,
} from '@patternwall/core';
import { PreviewFrame, PREVIEW_MODES, type PreviewMode } from './PreviewFrame';
import { PatternImage } from './PatternImage';
import { ParamControls } from './ParamControls';
import { PalettePanel } from './PalettePanel';
import { ExportPanel } from './ExportPanel';
import { Button, Notice, Switch, Tag, uiStyles as ui } from './ui';
import { renderProse } from '../lib/prose';
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

export function Editor({ generatorId }: { generatorId: string }) {
  const generator = getGenerator(generatorId) ?? generators[0]!;

  const [seed, setSeed] = useState(() => initialConfig(generator.id).seed);
  const [params, setParams] = useState<Record<string, ParamValue>>(() => defaultParams(generator));
  const [palette, setPalette] = useState<Palette>(() => initialConfig(generator.id).palette);
  const [notes, setNotes] = useState<string[]>([]);
  const [renderError, setRenderError] = useState<string | null>(null);

  const [mode, setMode] = useState<PreviewMode>('lock');
  const [showZones, setShowZones] = useState(false);
  const [panel, setPanel] = useState<PanelKey>('pattern');

  const [copied, setCopied] = useState(false);
  const [collectState, setCollectState] = useState<'idle' | 'saved' | 'already' | 'failed'>('idle');
  const [collectedCount, setCollectedCount] = useState(0);

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

  useEffect(() => {
    const decoded = decodeConfig(generator.id, typeof window === 'undefined' ? '' : window.location.search);
    setSeed(decoded.config.seed);
    setParams(decoded.config.params);
    setPalette(decoded.config.palette);
    setCommitted({ params: decoded.config.params, palette: decoded.config.palette, seed: decoded.config.seed });
    setNotes(decoded.notes);
    setCollectedCount(loadCollected().filter((c) => c.generatorId === generator.id).length);
  }, [generator.id]);

  const settle = useCallback(
    (next: { params?: Record<string, ParamValue>; palette?: Palette; seed?: string }, delay: number) => {
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(() => {
        setCommitted((prev) => ({
          params: next.params ?? prev.params,
          palette: next.palette ?? prev.palette,
          seed: next.seed ?? prev.seed,
        }));
        settleRef.current = null;
      }, delay);
    },
    [],
  );

  useEffect(() => () => {
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
  }, []);

  const dirty = committed.params !== params || committed.palette !== palette || committed.seed !== seed;

  const query = useMemo(
    () => encodeConfig({ generatorId: generator.id, seed: committed.seed, params: committed.params, palette: committed.palette }),
    [generator.id, committed],
  );

  // The URL is the document. Replace rather than push so the back button still
  // means "the page I came from", not "the last slider I touched".
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = window.setTimeout(() => {
      window.history.replaceState(null, '', `${window.location.pathname}?${query}`);
    }, 220);
    return () => window.clearTimeout(id);
  }, [query]);

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
  const spec: RenderSpec = useMemo(
    () => ({
      generatorId: generator.id,
      seed: committed.seed,
      params: committed.params,
      palette: committed.palette,
      width: previewWidth,
      height: Math.round((previewWidth * 19.5) / 9),
      bleed: DEFAULT_BLEED,
    }),
    [generator.id, committed, previewWidth],
  );

  const related = useMemo(
    () =>
      generators
        .filter((g) => g.id !== generator.id)
        .map((g) => ({ g, shared: g.tags.filter((t) => generator.tags.includes(t)).length }))
        .sort((a, b) => b.shared - a.shared || a.g.name.localeCompare(b.g.name))
        .filter((x) => x.shared > 0)
        .slice(0, 3),
    [generator],
  );

  const onCopyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?${query}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.history.replaceState(null, '', `${window.location.pathname}?${query}`);
      setNotes((n) => [...n, 'This browser blocked the clipboard. The address bar now holds the exact link — copy it from there.']);
    }
  };

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
              <Button key={m.value} size="small" onClick={() => setMode(m.value)} aria-pressed={mode === m.value} success={mode === m.value}>
                {m.label}
              </Button>
            ))}
          </div>
          <p className={styles.modeHint}>{PREVIEW_MODES.find((m) => m.value === mode)?.hint}</p>

          <PreviewFrame
            spec={spec}
            mode={mode}
            showZones={showZones}
            alt={`${generator.name} rendered with the ${palette.name} palette, seed ${committed.seed}`}
            caption={`Previewing with 8% bleed, as exported. Seed ${committed.seed}.`}
            onRenderError={setRenderError}
          />

          <div className={styles.underPreview}>
            <div className={ui.labelRow}>
              <span className={ui.label} id="zones-label">
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
                  setCommitted((prev) => ({ ...prev, seed: v }));
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
                onClick={() => {
                  const config = { generatorId: generator.id, seed: committed.seed, params: committed.params, palette: committed.palette };
                  const key = collectionKey(config);
                  const existing = loadCollected();
                  if (existing.some((c) => c.id === key)) {
                    setCollectState('already');
                    return;
                  }
                  const result = saveCollected(config);
                  setCollectedCount(result.items.filter((c) => c.generatorId === generator.id).length);
                  setCollectState(result.ok ? 'saved' : 'failed');
                }}
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
          <div className={styles.tabs} role="tablist" aria-label="Editor panels">
            {PANELS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="tab"
                id={`tab-${p.value}`}
                aria-selected={panel === p.value}
                aria-controls={`panel-${p.value}`}
                className={panel === p.value ? `${styles.tab} ${styles.tabOn}` : styles.tab}
                onClick={() => setPanel(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {panel === 'pattern' ? (
            <div role="tabpanel" id="panel-pattern" aria-labelledby="tab-pattern">
              <ParamControls
                generator={generator}
                params={params}
                onChange={(key, value) => {
                  const next = { ...params, [key]: value };
                  setParams(next);
                  settle({ params: next }, 110);
                }}
                onCommit={() => settle({ params }, 0)}
              />
              <Button
                size="small"
                onClick={() => {
                  const next = defaultParams(generator);
                  setParams(next);
                  setCommitted((prev) => ({ ...prev, params: next }));
                }}
              >
                Reset to defaults
              </Button>
            </div>
          ) : null}

          {panel === 'palette' ? (
            <div role="tabpanel" id="panel-palette" aria-labelledby="tab-palette">
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
            <div role="tabpanel" id="panel-export" aria-labelledby="tab-export">
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
      </div>

      <div className={styles.essay}>
        <div className={styles.prose}>
          <h2>How {generator.name} works</h2>
          {renderProse(generator.description)}
        </div>
        <div className={styles.related}>
          <h3>Related patterns</h3>
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
                        {shared === 1 ? 'Shares one tag' : `Shares ${shared} tags`} · {g.tags.join(', ')}
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
  );
}
