'use client';

import { coerceParams, defaultPalette, getGenerator, normalizePalette, type Palette, type PatternConfig } from '@patternwall/core';

/**
 * localStorage, wrapped so that a browser in private mode, a full quota or a
 * user who has blocked site data degrades to "nothing is saved" rather than to
 * a thrown exception in the middle of a render.
 */

const KEY_COLLECTED = 'patternwall.collected.v1';
const KEY_PALETTES = 'patternwall.palettes.v1';

export interface CollectedItem {
  id: string;
  generatorId: string;
  seed: string;
  params: Record<string, number | string | boolean>;
  palette: Palette;
  savedAt: number;
  note?: string;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Repair one stored item, or drop it.
 *
 * Everything here is data this build did not write: an older schema, a hand-
 * edited localStorage, a half-finished write. The previous check confirmed that
 * `id` and `generatorId` were strings and let everything else through, so a
 * single item missing its palette threw on the first `palette.background` and
 * took the whole Collected page down — valid items, batch export and all —
 * behind React's "Application error" screen. `coerceParams` and
 * `normalizePalette` exist in core for exactly this and had no callers.
 *
 * An item whose generator is not in this build keeps its params untouched:
 * there is no spec to coerce against, and the export already reports those as
 * skipped rather than pretending they rendered. Only an item with no usable
 * identity is dropped.
 */
function coerceCollected(raw: unknown, fallback: Palette): CollectedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const i = raw as Partial<CollectedItem>;
  if (typeof i.id !== 'string' || !i.id || typeof i.generatorId !== 'string' || !i.generatorId) return null;
  const g = getGenerator(i.generatorId);
  const params = g
    ? coerceParams(g, i.params as Record<string, unknown> | undefined)
    : ((i.params ?? {}) as CollectedItem['params']);
  return {
    id: i.id,
    generatorId: i.generatorId,
    seed: typeof i.seed === 'string' ? i.seed : '',
    params: params as CollectedItem['params'],
    palette: normalizePalette((i.palette ?? {}) as Partial<Palette>, fallback),
    savedAt: typeof i.savedAt === 'number' && Number.isFinite(i.savedAt) ? i.savedAt : 0,
    ...(typeof i.note === 'string' ? { note: i.note } : {}),
  };
}

export function loadCollected(): CollectedItem[] {
  const fallback = defaultPalette;
  return read<unknown[]>(KEY_COLLECTED, [])
    .map((raw) => coerceCollected(raw, fallback))
    .filter((i): i is CollectedItem => i !== null);
}

export function collectionKey(c: Pick<PatternConfig, 'generatorId' | 'seed' | 'params' | 'palette'>): string {
  const params = Object.keys(c.params)
    .sort()
    .map((k) => `${k}:${String(c.params[k])}`)
    .join(',');
  return `${c.generatorId}|${c.seed}|${params}|${c.palette.background}${c.palette.ink}${c.palette.accents.join('')}`;
}

export function saveCollected(config: PatternConfig): { ok: boolean; items: CollectedItem[] } {
  const items = loadCollected();
  const id = collectionKey(config);
  if (items.some((i) => i.id === id)) return { ok: true, items };
  const next: CollectedItem[] = [
    {
      id,
      generatorId: config.generatorId,
      seed: config.seed,
      params: config.params,
      palette: config.palette,
      savedAt: Date.now(),
    },
    ...items,
  ].slice(0, 200);
  return { ok: write(KEY_COLLECTED, next), items: next };
}

export function removeCollected(id: string): CollectedItem[] {
  const next = loadCollected().filter((i) => i.id !== id);
  write(KEY_COLLECTED, next);
  return next;
}

/**
 * Same treatment. The old check confirmed a `background` string and let a
 * palette with no `accents` through, which killed the whole editor page the
 * moment the Palette tab mapped over them.
 */
export function loadSavedPalettes(): Palette[] {
  const fallback = defaultPalette;
  return read<unknown[]>(KEY_PALETTES, [])
    .filter((p): p is Partial<Palette> => !!p && typeof p === 'object')
    .map((p) => normalizePalette(p, fallback));
}

export function writePaletteList(list: Palette[]): boolean {
  return write(KEY_PALETTES, list.slice(0, 120));
}

export function savePalette(p: Palette): { ok: boolean; items: Palette[] } {
  const list = loadSavedPalettes();
  const idx = list.findIndex((x) => x.id === p.id);
  const next = idx >= 0 ? list.map((x, i) => (i === idx ? p : x)) : [p, ...list];
  return { ok: writePaletteList(next), items: next };
}

export function removePalette(id: string): Palette[] {
  const next = loadSavedPalettes().filter((p) => p.id !== id);
  writePaletteList(next);
  return next;
}
