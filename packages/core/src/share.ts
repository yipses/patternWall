/**
 * Share-link encoding.
 *
 * A PatternWall link has to survive a text message, so it is short: parameters
 * are positional rather than named, palettes collapse to a library slug when
 * they match one, and there is no JSON anywhere. It also has to be forgiving —
 * a truncated or hand-edited link recovers to defaults and tells the UI what
 * it had to drop, rather than rendering a blank screen.
 */

import { curatedPalettes, defaultPalette, getPalette } from './palettes.js';
import { getGenerator, generators } from './generators/index.js';
import { coerceParams, decimalsOf, defaultParams, type ParamValue } from './types.js';
import type { Palette } from './palette.js';

export interface PatternConfig {
  generatorId: string;
  seed: string;
  params: Record<string, ParamValue>;
  palette: Palette;
}

export interface DecodeResult {
  config: PatternConfig;
  /** Human-readable notes about anything that had to be repaired. */
  notes: string[];
}

const HEX6 = /^[0-9a-f]{6}$/;

/**
 * Six hex digits, always. The share encoding has no room for alpha and the
 * renderer does not carry it anyway, so it is dropped here as it is on the way
 * in — see `normalizePalette`.
 *
 * The four-digit case used to fall through to '000000', which turned a colour
 * into black in a share link rather than losing only its transparency. It could
 * not come from the UI, but a stored or hand-edited palette could hold one.
 */
function packHex(hex: string): string {
  const s = hex.trim().replace(/^#/, '').toLowerCase();
  // #rgb and #rgba both expand from their first three digits.
  if (s.length === 3 || s.length === 4) return s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]!;
  if (s.length >= 6) return s.slice(0, 6);
  return '000000';
}

export function packPalette(p: Palette): string {
  const match = curatedPalettes.find(
    (c) =>
      c.background.toLowerCase() === p.background.toLowerCase() &&
      c.ink.toLowerCase() === p.ink.toLowerCase() &&
      c.mode === p.mode &&
      c.accents.length === p.accents.length &&
      c.accents.every((a, i) => a.toLowerCase() === (p.accents[i] ?? '').toLowerCase()),
  );
  if (match) return match.id;
  const parts = [packHex(p.background), packHex(p.ink), ...p.accents.slice(0, 4).map(packHex)];
  return `~${p.mode === 'light' ? 'l' : 'd'}${parts.join('')}`;
}

export function unpackPalette(token: string): Palette | null {
  if (!token) return null;
  if (!token.startsWith('~')) return getPalette(token) ?? null;
  const mode = token[1] === 'l' ? 'light' : 'dark';
  const body = token.slice(2);
  if (body.length < 18 || body.length % 6 !== 0) return null;
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += 6) chunks.push(body.slice(i, i + 6));
  if (!chunks.every((c) => HEX6.test(c))) return null;
  const [bg, ink, ...accents] = chunks as [string, string, ...string[]];
  return {
    id: 'custom',
    name: 'Custom',
    background: `#${bg}`,
    ink: `#${ink}`,
    accents: accents.slice(0, 4).map((a) => `#${a}`),
    mode,
    tags: ['custom'],
  };
}

function packParams(generatorId: string, params: Record<string, ParamValue>): string {
  const g = getGenerator(generatorId);
  if (!g) return '';
  return g.params
    .map((spec) => {
      const v = params[spec.key];
      if (spec.type === 'number') {
        const n = typeof v === 'number' ? v : spec.default;
        // Trim to exactly the precision the control can produce, no more and
        // — this is the part that bites — no less.
        return Number(n.toFixed(decimalsOf(spec.step))).toString();
      }
      if (spec.type === 'boolean') return v === true ? '1' : '0';
      // A packed grid is already link-safe by construction: its alphabet
      // deliberately excludes the `_` this join uses, and `+`, `/` and `=`.
      if (spec.type === 'image') return typeof v === 'string' ? v : spec.default;
      const idx = spec.options.findIndex((o) => o.value === v);
      return String(idx < 0 ? spec.options.findIndex((o) => o.value === spec.default) : idx);
    })
    .join('_');
}

function unpackParams(generatorId: string, token: string, notes: string[]): Record<string, ParamValue> {
  const g = getGenerator(generatorId);
  if (!g) return {};
  const out = defaultParams(g);
  if (!token) return out;
  const parts = token.split('_');
  // Too many values and too few are different events, and saying "reset" about
  // both is a lie half the time. A link carrying more values than the pattern
  // has params really does have settings this build cannot place. A link
  // carrying fewer is simply older than a param that was appended since: every
  // value it does carry lands where it did, and the new one takes its default.
  // Nothing is reset, and telling somebody it was sends them looking for
  // damage that is not there. Appending a seventh param to truchet put that
  // message in front of every truchet link ever shared.
  if (parts.length > g.params.length) {
    notes.push('The link was written for a different version of this pattern; unrecognised settings were reset.');
  } else if (parts.length < g.params.length) {
    notes.push('This link predates some of the settings below, which are at their defaults.');
  }
  g.params.forEach((spec, i) => {
    const raw = parts[i];
    if (raw === undefined || raw === '') return;
    if (spec.type === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n)) out[spec.key] = Math.min(spec.max, Math.max(spec.min, n));
    } else if (spec.type === 'boolean') {
      out[spec.key] = raw === '1';
    } else if (spec.type === 'image') {
      out[spec.key] = raw;
    } else {
      const idx = Number(raw);
      const opt = Number.isInteger(idx) ? spec.options[idx] : undefined;
      if (opt) out[spec.key] = opt.value;
    }
  });
  return coerceParams(g, out);
}

/**
 * Minimal query-string handling.
 *
 * `URLSearchParams` is a host global, and this package is meant to run
 * anywhere — a browser, Node, a worker, eventually a render service — without
 * assuming any of them. Encoding three keys by hand is cheaper than the
 * assumption.
 */
function encodeComponent(v: string): string {
  return encodeURIComponent(v);
}

function parseQuery(search: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = search.startsWith('?') ? search.slice(1) : search;
  for (const chunk of body.split('&')) {
    if (!chunk) continue;
    const eq = chunk.indexOf('=');
    const rawKey = eq < 0 ? chunk : chunk.slice(0, eq);
    const rawVal = eq < 0 ? '' : chunk.slice(eq + 1);
    try {
      out.set(decodeURIComponent(rawKey.replace(/\+/g, ' ')), decodeURIComponent(rawVal.replace(/\+/g, ' ')));
    } catch {
      // A hand-mangled escape sequence should lose one key, not the whole link.
    }
  }
  return out;
}

/** Encode everything but the generator id, which lives in the path. */
export function encodeConfig(config: PatternConfig): string {
  return [
    `s=${encodeComponent(config.seed)}`,
    `q=${encodeComponent(packParams(config.generatorId, config.params))}`,
    `c=${encodeComponent(packPalette(config.palette))}`,
  ].join('&');
}

/**
 * Decode a query string against a generator id. Always returns a renderable
 * config; `notes` explains anything that had to be repaired.
 */
export function decodeConfig(generatorId: string, search: string): DecodeResult {
  const notes: string[] = [];
  let g = getGenerator(generatorId);
  if (!g) {
    notes.push(`There is no pattern called “${generatorId}”. Showing ${generators[0]!.name} instead.`);
    g = generators[0]!;
  }
  const q = parseQuery(search);

  const rawSeed = q.get('s') ?? null;
  const seed = rawSeed && rawSeed.length > 0 && rawSeed.length <= 64 ? rawSeed : defaultSeed(g.id);
  if (rawSeed !== null && seed !== rawSeed) notes.push('The seed in the link was unusable, so a default was used.');

  const params = unpackParams(g.id, q.get('q') ?? '', notes);

  const rawPalette = q.get('c') ?? null;
  let palette = rawPalette ? unpackPalette(rawPalette) : null;
  if (rawPalette && !palette) {
    notes.push('The palette in the link could not be read, so the default palette was used.');
  }
  if (!palette) palette = defaultPalette;

  return { config: { generatorId: g.id, seed, params, palette }, notes };
}

/** A stable, pronounceable-ish starting seed per generator. */
export function defaultSeed(generatorId: string): string {
  return `${generatorId.replace(/[^a-z0-9]/g, '')}-001`;
}

/** The configuration a pattern opens with when nothing is specified. */
export function initialConfig(generatorId: string): PatternConfig {
  const g = getGenerator(generatorId) ?? generators[0]!;
  return { generatorId: g.id, seed: defaultSeed(g.id), params: defaultParams(g), palette: defaultPalette };
}
