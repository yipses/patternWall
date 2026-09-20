'use client';

import { coerceParams, defaultPalette, getGenerator, normalizePalette, type Palette, type PatternConfig } from '@patternwall/core';

/**
 * localStorage, wrapped so that a browser in private mode, a full quota or a
 * user who has blocked site data degrades to "nothing is saved" rather than to
 * a thrown exception in the middle of a render.
 */

const KEY_COLLECTED = 'patternwall.collected.v1';
const KEY_PALETTES = 'patternwall.palettes.v1';
const KEY_EXPORT = 'patternwall.export.v1';

export interface CollectedItem {
  id: string;
  generatorId: string;
  seed: string;
  params: Record<string, number | string | boolean>;
  palette: Palette;
  savedAt: number;
}

export interface StoredExportSettings {
  presetId?: string;
  custom?: { width: number; height: number } | null;
  withBleed?: boolean;
  depth?: string;
  colors?: number;
  homeVariant?: boolean;
}

/**
 * What the export was last set to.
 *
 * Kept because the alternative is answering the same four questions every
 * time: the summary row is then right on the second export and the settings
 * level never has to be opened again. Read after mount, never during render —
 * this page is prerendered and a first render that depends on localStorage
 * disagrees with the baked HTML.
 */
export function loadExportSettings(): StoredExportSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY_EXPORT);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as StoredExportSettings) : null;
  } catch {
    return null;
  }
}

export function saveExportSettings(s: StoredExportSettings): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(KEY_EXPORT, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
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

/**
 * Both of these report whether the write landed, the way `saveCollected` does.
 *
 * This file exists so that a blocked or full localStorage degrades to "nothing
 * is saved" rather than to a thrown exception, and the editor already surfaces
 * that for a save. Removing dropped the boolean on the floor, so in private
 * mode a delete looked like it worked and the items were back on the next load
 * — and an undo looked like it worked and the items were gone on the next
 * load, after the undo had already expired.
 */
export function removeManyCollected(ids: string[]): { ok: boolean; items: CollectedItem[] } {
  const drop = new Set(ids);
  const next = loadCollected().filter((i) => !drop.has(i.id));
  return { ok: write(KEY_COLLECTED, next), items: next };
}

/**
 * Put a list back exactly as it was.
 *
 * This is what undo needs and what `removeManyCollected` cannot give it: the
 * order of the list is insertion order, newest first, and it is not recoverable
 * from the items themselves -- `savedAt` is a day-resolution display value that
 * several items collected in the same session will share. So an undo restores
 * the array it held rather than re-inserting the items it removed.
 */
export function writeCollected(items: CollectedItem[]): boolean {
  return write(KEY_COLLECTED, items.slice(0, 200));
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
