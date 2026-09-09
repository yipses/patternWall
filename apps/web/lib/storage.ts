'use client';

import type { Palette, PatternConfig } from '@patternwall/core';

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

export function loadCollected(): CollectedItem[] {
  return read<CollectedItem[]>(KEY_COLLECTED, []).filter(
    (i) => i && typeof i.id === 'string' && typeof i.generatorId === 'string',
  );
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

export function loadSavedPalettes(): Palette[] {
  return read<Palette[]>(KEY_PALETTES, []).filter((p) => p && typeof p.background === 'string');
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
