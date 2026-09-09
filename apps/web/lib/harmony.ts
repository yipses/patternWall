import { hexToOklch, oklchToHex, type Palette } from '@patternwall/core';

export type HarmonyScheme = 'analogous' | 'complementary' | 'triadic' | 'split' | 'monochrome';

export const HARMONY_SCHEMES: { value: HarmonyScheme; label: string; hint: string }[] = [
  { value: 'analogous', label: 'Analogous', hint: 'Three neighbouring hues. Calm, and hardest to get wrong.' },
  { value: 'complementary', label: 'Complementary', hint: 'The seed and its opposite. Maximum separation, minimum subtlety.' },
  { value: 'triadic', label: 'Triadic', hint: 'Three hues evenly spaced. Poster-like.' },
  { value: 'split', label: 'Split complementary', hint: 'The opposite, split in two. Complementary tension without the clash.' },
  { value: 'monochrome', label: 'Monochrome', hint: 'One hue at three chromas and lightnesses.' },
];

const OFFSETS: Record<HarmonyScheme, number[]> = {
  analogous: [0, 28, -28],
  complementary: [0, 180, 150],
  triadic: [0, 120, 240],
  split: [0, 150, 210],
  monochrome: [0, 0, 0],
};

/**
 * Build accents from a seed colour.
 *
 * Hue rotation alone gives three colours of identical lightness, which read as
 * one colour the moment a generator shrinks them. So each step also walks
 * lightness and chroma: the result stays distinguishable in greyscale, which is
 * roughly what a wallpaper looks like once iOS dims it behind the app grid.
 */
export function harmonyAccents(seedHex: string, scheme: HarmonyScheme, mode: 'light' | 'dark'): string[] {
  const base = hexToOklch(seedHex);
  const offsets = OFFSETS[scheme];
  const lSteps = mode === 'dark' ? [0, 0.1, -0.09] : [0, -0.11, 0.09];
  const cSteps = scheme === 'monochrome' ? [1, 0.55, 0.28] : [1, 0.85, 0.7];
  return offsets.map((deg, i) => {
    const l = Math.min(0.94, Math.max(0.16, base.l + (lSteps[i] ?? 0)));
    const c = Math.max(0.01, base.c * (cSteps[i] ?? 1));
    return oklchToHex({ l, c, h: (base.h + deg + 360) % 360 });
  });
}

/** A full palette derived from one seed colour, ready to preview. */
export function harmonyPalette(seedHex: string, scheme: HarmonyScheme, mode: 'light' | 'dark'): Palette {
  const base = hexToOklch(seedHex);
  const background = oklchToHex(
    mode === 'dark' ? { l: 0.09, c: Math.min(0.03, base.c * 0.25), h: base.h } : { l: 0.955, c: Math.min(0.02, base.c * 0.2), h: base.h },
  );
  const ink = oklchToHex(mode === 'dark' ? { l: 0.93, c: 0.012, h: base.h } : { l: 0.17, c: 0.015, h: base.h });
  return {
    id: 'harmony',
    name: `${scheme[0]!.toUpperCase()}${scheme.slice(1)} of ${seedHex.toUpperCase()}`,
    background,
    ink,
    accents: harmonyAccents(seedHex, scheme, mode),
    mode,
    tags: ['custom'],
  };
}

/**
 * Push a palette harder so it survives the Home Screen's blur and dim layer.
 * iOS flattens roughly a stop of contrast out of a wallpaper behind app icons;
 * this puts it back rather than asking the person to hand-tune a second config.
 */
export function boostForHomeScreen(p: Palette): Palette {
  const bg = hexToOklch(p.background);
  const dark = p.mode === 'dark';
  const background = oklchToHex({ l: Math.max(0, Math.min(1, bg.l + (dark ? -0.03 : 0.03))), c: bg.c * 0.85, h: bg.h });
  const push = (hex: string): string => {
    const c = hexToOklch(hex);
    const away = dark ? 1 : -1;
    return oklchToHex({ l: Math.max(0.05, Math.min(0.97, c.l + away * 0.09)), c: Math.min(0.4, c.c * 1.22), h: c.h });
  };
  return {
    ...p,
    id: `${p.id}-home`,
    name: `${p.name} (Home Screen)`,
    background,
    ink: push(p.ink),
    accents: p.accents.map(push),
  };
}
