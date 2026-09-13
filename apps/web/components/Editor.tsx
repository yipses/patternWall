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
import { Button, Notice, Switch, TabList, Tag, uiStyles as ui } from './ui';
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

  useEffect(() => {
    const decoded = decodeConfig(generator.id, typeof window === 'undefined' ? '' : window.location.search);
    setSeed(decoded.config.seed);
    latestParams.current = decoded.config.params;
    setParams(decoded.config.params);
    setPalette(decoded.config.palette);
    commitNow({ params: decoded.config.params, palette: decoded.config.palette, seed: decoded.config.seed });
    setNotes(decoded.notes);
    setCollectedCount(loadCollected().filter((c) => c.generatorId === generator.id).length);
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
              <Button key={m.value} size="small" onClick={() => setMode(m.value)} aria-pressed={mode === m.value} selected={mode === m.value}>
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
                onChange={(key, value) => applyParams({ ...latestParams.current, [key]: value }, 110)}
                onCommit={() => settle({ params: latestParams.current }, 0)}
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
