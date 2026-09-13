/**
 * The palette object.
 *
 * Generators never hard-code a colour and never assume how many accents they
 * have been given. They ask for `accent(palette, i)` and get something back,
 * always — which is the single reason a palette built by extracting three
 * colours from a photograph can be dropped into a generator written for four.
 */

import { contrastRatio, hexToOklch, mixOklab, oklchToHex, relativeLuminance, type Oklch } from './color.js';

export interface Palette {
  id: string;
  name: string;
  /** Hex. The field the whole canvas starts from. */
  background: string;
  /** Hex. The high-contrast mark colour: lines, strokes, text-weight detail. */
  ink: string;
  /** Hex, 1..4 entries. Everything colourful. */
  accents: string[];
  mode: 'light' | 'dark';
  tags?: string[];
  /** Optional counterpart for the other appearance; the editor can swap to it. */
  pair?: Omit<Palette, 'pair'>;
}

/** Accent `i`, wrapping. Never throws, never returns undefined. */
export function accent(p: Palette, i: number): string {
  const list = p.accents.length > 0 ? p.accents : [p.ink];
  const n = list.length;
  const idx = ((Math.floor(Number.isFinite(i) ? i : 0) % n) + n) % n;
  return list[idx] as string;
}

/** Accent `i` in OKLCH, wrapping. */
export function accentOklch(p: Palette, i: number): Oklch {
  return hexToOklch(accent(p, i));
}

/**
 * A continuous accent ramp: `t` in 0..1 walks the whole accent list in OKLCH.
 * Generators that colour by index or by depth use this instead of picking
 * discrete accents, so a two-colour palette still reads as a gradient.
 */
export function accentAt(p: Palette, t: number): string {
  const list = p.accents.length > 0 ? p.accents : [p.ink];
  if (list.length === 1) return list[0] as string;
  const k = Math.min(0.999999, Math.max(0, Number.isFinite(t) ? t : 0)) * (list.length - 1);
  const i = Math.floor(k);
  const a = hexToOklch(list[i] as string);
  const b = hexToOklch(list[Math.min(list.length - 1, i + 1)] as string);
  return oklchToHex(mixOklab(a, b, k - i));
}

/** Even ramp across the whole palette's accents, inclusive of both ends. */
export function accentRamp(p: Palette, steps: number): string[] {
  const n = Math.max(1, Math.floor(steps));
  if (n === 1) return [accent(p, 0)];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(accentAt(p, i / (n - 1)));
  return out;
}

export type WarningLevel = 'info' | 'warn';

export interface PaletteWarning {
  id: string;
  level: WarningLevel;
  message: string;
}

/**
 * Approximate deuteranopia (the common red–green deficiency), used only to
 * decide whether to leave a gentle note. It is the Viénot/Brettel style
 * projection onto the confusion plane, done in linear light.
 */
function simulateDeuteranopia(hex: string): { r: number; g: number; b: number } {
  const c = hexToOklch(hex);
  // Round-trip through hex keeps this on the same code path as everything else.
  const out = oklchToHex(c);
  const n = parseInt(out.slice(1, 7), 16);
  const to = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = to((n >> 16) & 255);
  const g = to((n >> 8) & 255);
  const b = to(n & 255);
  return {
    r: 0.625 * r + 0.375 * g + 0.0 * b,
    g: 0.7 * r + 0.3 * g + 0.0 * b,
    b: 0.0 * r + 0.3 * g + 0.7 * b,
  };
}

function deuteranopeDistance(a: string, b: string): number {
  const x = simulateDeuteranopia(a);
  const y = simulateDeuteranopia(b);
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
}

/**
 * Gentle, advisory palette checks. These never block a render — a wallpaper
 * that fails every rule can still be exactly what someone wanted. They exist
 * so the editor can say "the clock will be hard to read on this" once, quietly,
 * instead of the person discovering it on their phone at a bus stop.
 */
export function checkPalette(p: Palette): PaletteWarning[] {
  const out: PaletteWarning[] = [];
  const accents = p.accents.length > 0 ? p.accents : [];

  const inkContrast = contrastRatio(p.background, p.ink);
  if (inkContrast < 4.5) {
    out.push({
      id: 'ink-contrast',
      level: inkContrast < 3 ? 'warn' : 'info',
      message: `Ink sits at ${inkContrast.toFixed(1)}:1 against the background. Below 4.5:1, fine strokes start to disappear on a phone in daylight.`,
    });
  }

  const bg = hexToOklch(p.background);
  if (bg.c > 0.13) {
    out.push({
      id: 'clock-chroma',
      level: 'warn',
      message: `The background is highly saturated (chroma ${bg.c.toFixed(2)}). iOS draws the clock straight onto it, and a strong hue behind white numerals reads as glare.`,
    });
  }

  const brightForLightClock = accents.filter((a) => contrastRatio(a, '#ffffff') < 2.2);
  if (p.mode === 'dark' && brightForLightClock.length === accents.length && accents.length > 0) {
    out.push({
      id: 'clock-legibility',
      level: 'info',
      message: 'Every accent is close to white. If one of them lands under the clock, the time will fight with the pattern.',
    });
  }

  accents.forEach((a, i) => {
    const cr = contrastRatio(a, p.background);
    if (cr < 1.25) {
      out.push({
        id: `accent-invisible-${i}`,
        level: 'info',
        message: `Accent ${i + 1} (${a.toUpperCase()}) is nearly the same value as the background — expect it to vanish rather than to be subtle.`,
      });
    }
  });

  for (let i = 0; i < accents.length; i++) {
    for (let j = i + 1; j < accents.length; j++) {
      const ai = accents[i] as string;
      const aj = accents[j] as string;
      if (deuteranopeDistance(ai, aj) < 0.035 && contrastRatio(ai, aj) < 1.6) {
        out.push({
          id: `cvd-${i}-${j}`,
          level: 'info',
          message: `Accents ${i + 1} and ${j + 1} are hard to tell apart with red–green colour blindness. A small lightness gap between them fixes it.`,
        });
        break;
      }
    }
  }

  const lum = relativeLuminance(p.background);
  if (p.mode === 'dark' && lum > 0.35) {
    out.push({
      id: 'mode-mismatch',
      level: 'info',
      message: 'This palette is marked dark but has a light background; the Home Screen dim layer will make it flatter than you expect.',
    });
  }
  if (p.mode === 'light' && lum < 0.12) {
    out.push({
      id: 'mode-mismatch',
      level: 'info',
      message: 'This palette is marked light but has a very dark background.',
    });
  }

  return out;
}

/** A palette is valid enough to render if it has the three required fields. */
/**
 * Colours arriving from outside, made into colours this system can carry all
 * the way through.
 *
 * Alpha is dropped rather than kept. It used to be accepted here and then only
 * half-honoured: `mixOklch` preserves it so it reached two generators'
 * background gradients, `accentAt` and `mixOklab` discard it, and `packHex`
 * truncated it, so a palette with a transparent accent rendered one way and its
 * own share link rendered another. Half-support was the worst of the three
 * options. If alpha is ever wanted, it has to go through the whole chain —
 * ramp, mix and pack — not just the parts that happen to pass it along.
 */
export function normalizePalette(p: Partial<Palette> & { id?: string }, fallback: Palette): Palette {
  const hex = (v: unknown, d: string): string => {
    if (typeof v !== 'string') return d;
    const t = v.trim().toLowerCase();
    if (!/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(t)) return d;
    // Six digits, always, so one colour has exactly one spelling. #0af and
    // #00aaff are the same colour and used to survive as different strings,
    // which matters because collectionKey builds an item's identity out of
    // these — the same configuration could be collected twice under two names.
    if (t.length === 4 || t.length === 5) return `#${t[1]!}${t[1]!}${t[2]!}${t[2]!}${t[3]!}${t[3]!}`;
    return t.slice(0, 7);
  };
  const accents = Array.isArray(p.accents) && p.accents.length > 0
    ? p.accents.slice(0, 4).map((a, i) => hex(a, accent(fallback, i)))
    : fallback.accents.slice();
  return {
    id: typeof p.id === 'string' && p.id ? p.id : fallback.id,
    name: typeof p.name === 'string' && p.name ? p.name : fallback.name,
    background: hex(p.background, fallback.background),
    ink: hex(p.ink, fallback.ink),
    accents,
    mode: p.mode === 'light' || p.mode === 'dark' ? p.mode : fallback.mode,
    tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : fallback.tags,
  };
}
