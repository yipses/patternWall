/**
 * Colour maths.
 *
 * PatternWall stores and displays colour as hex, because that is what people
 * paste around, but every *computation* — mixing, ramps, harmony, palette
 * extraction — happens in OKLCH. sRGB interpolation drags saturated hues
 * through grey and makes blue-to-yellow ramps look muddy; OKLCH keeps
 * perceived lightness monotonic, which is exactly what a wallpaper needs when
 * the clock has to stay readable across the whole gradient.
 */

export interface Oklch {
  /** Perceptual lightness, 0..1. */
  l: number;
  /** Chroma, 0..~0.4 in practice for sRGB. */
  c: number;
  /** Hue in degrees, 0..360. */
  h: number;
  /** Optional alpha, 0..1. Preserved through conversions. */
  alpha?: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function safe(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

function parseHex(hex: string): Rgb {
  const s = String(hex).trim().replace(/^#/, '');
  const bad: Rgb = { r: 0, g: 0, b: 0, a: 1 };
  const read = (i: number, len: number): number => {
    const chunk = s.slice(i, i + len);
    const n = parseInt(len === 1 ? chunk + chunk : chunk, 16);
    return Number.isNaN(n) ? 0 : n / 255;
  };
  if (!/^[0-9a-fA-F]+$/.test(s)) return bad;
  if (s.length === 3) return { r: read(0, 1), g: read(1, 1), b: read(2, 1), a: 1 };
  if (s.length === 4) return { r: read(0, 1), g: read(1, 1), b: read(2, 1), a: read(3, 1) };
  if (s.length === 6) return { r: read(0, 2), g: read(2, 2), b: read(4, 2), a: 1 };
  if (s.length === 8) return { r: read(0, 2), g: read(2, 2), b: read(4, 2), a: read(6, 2) };
  return bad;
}

/** True when the string is a syntactically valid #rgb/#rgba/#rrggbb/#rrggbbaa. */
export function isHex(hex: string): boolean {
  return /^#?([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(String(hex).trim());
}

function toHexPart(v: number): string {
  const n = Math.round(clamp01(safe(v, 0)) * 255);
  return n.toString(16).padStart(2, '0');
}

function rgbToHex(c: Rgb): string {
  const base = `#${toHexPart(c.r)}${toHexPart(c.g)}${toHexPart(c.b)}`;
  return c.a >= 1 ? base : `${base}${toHexPart(c.a)}`;
}

/** sRGB transfer function, encoded 0..1 -> linear light 0..1. */
function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function linearToOklab(r: number, g: number, b: number): { L: number; a: number; bb: number } {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    bb: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklabToLinear(L: number, a: number, b: number): { r: number; g: number; b: number } {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

export function hexToOklch(hex: string): Oklch {
  const rgb = parseHex(hex);
  const { L, a, bb } = linearToOklab(srgbToLinear(rgb.r), srgbToLinear(rgb.g), srgbToLinear(rgb.b));
  const c = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  // A neutral has no meaningful hue; pin it to 0 so round-trips are stable.
  const out: Oklch = { l: safe(L, 0), c: safe(c, 0), h: c < 1e-7 ? 0 : safe(h, 0) };
  if (rgb.a < 1) out.alpha = rgb.a;
  return out;
}

function oklchToLinearRgb(l: number, c: number, h: number): { r: number; g: number; b: number } {
  const rad = (h * Math.PI) / 180;
  return oklabToLinear(l, Math.cos(rad) * c, Math.sin(rad) * c);
}

const inGamut = (v: { r: number; g: number; b: number }, eps = 1e-4): boolean =>
  v.r >= -eps && v.r <= 1 + eps && v.g >= -eps && v.g <= 1 + eps && v.b >= -eps && v.b <= 1 + eps;

/**
 * OKLCH -> hex, gamut-mapped into sRGB.
 *
 * When a colour sits outside sRGB we hold lightness and hue and binary-search
 * chroma downwards until it fits. Holding L is the important part: clipping
 * channels instead (the naive approach) shifts both lightness and hue, and a
 * palette built that way stops obeying the contrast rules we just checked.
 */
export function oklchToHex(col: Oklch): string {
  const alpha = col.alpha === undefined ? 1 : clamp01(safe(col.alpha, 1));
  const L = clamp01(safe(col.l, 0));
  const h = safe(col.h, 0);
  let c = Math.max(0, safe(col.c, 0));

  // Degenerate ends of the lightness axis are always achromatic in sRGB.
  if (L <= 0) return rgbToHex({ r: 0, g: 0, b: 0, a: alpha });
  if (L >= 1) return rgbToHex({ r: 1, g: 1, b: 1, a: alpha });

  let lin = oklchToLinearRgb(L, c, h);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinearRgb(L, mid, h))) lo = mid;
      else hi = mid;
    }
    c = lo;
    lin = oklchToLinearRgb(L, c, h);
  }
  return rgbToHex({
    r: clamp01(linearToSrgb(clamp01(lin.r))),
    g: clamp01(linearToSrgb(clamp01(lin.g))),
    b: clamp01(linearToSrgb(clamp01(lin.b))),
    a: alpha,
  });
}

/** Shortest-arc hue interpolation, so 350° -> 10° goes through 0° not 180°. */
function mixHue(a: number, b: number, t: number): number {
  const d = ((b - a) % 360 + 540) % 360 - 180;
  return ((a + d * t) % 360 + 360) % 360;
}

export function mixOklch(a: Oklch, b: Oklch, t: number): Oklch {
  const k = safe(t, 0);
  const out: Oklch = {
    l: a.l + (b.l - a.l) * k,
    c: a.c + (b.c - a.c) * k,
    // Near-neutral endpoints have no hue to travel from; borrow the other end's.
    h: a.c < 1e-4 ? b.h : b.c < 1e-4 ? a.h : mixHue(a.h, b.h, k),
  };
  const aa = a.alpha === undefined ? 1 : a.alpha;
  const ba = b.alpha === undefined ? 1 : b.alpha;
  const alpha = aa + (ba - aa) * k;
  if (alpha < 1) out.alpha = alpha;
  return out;
}

/**
 * Blend two OKLCH colours through rectangular OKLab rather than around the hue
 * circle.
 *
 * `mixOklch` takes the short way round the wheel, which is right for tints and
 * shades of one colour. It is wrong for a palette ramp: orange to blue is
 * nearly half a turn, so the "short way" is a coin toss that lands on magenta
 * and quietly inserts a colour the palette does not contain. Straight-line
 * OKLab interpolation passes through a desaturated middle instead, which
 * preserves the identity of the two colours it is joining.
 */
export function mixOklab(a: Oklch, b: Oklch, t: number): Oklch {
  const k = safe(t, 0);
  const ar = (a.h * Math.PI) / 180;
  const br = (b.h * Math.PI) / 180;
  const ax = Math.cos(ar) * a.c;
  const ay = Math.sin(ar) * a.c;
  const bx = Math.cos(br) * b.c;
  const by = Math.sin(br) * b.c;
  const x = ax + (bx - ax) * k;
  const y = ay + (by - ay) * k;
  const c = Math.hypot(x, y);
  let h = (Math.atan2(y, x) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: a.l + (b.l - a.l) * k, c, h: c < 1e-7 ? 0 : h };
}

/** WCAG 2.x relative luminance of a hex colour (alpha ignored). */
export function relativeLuminance(hex: string): number {
  const c = parseHex(hex);
  const r = srgbToLinear(c.r);
  const g = srgbToLinear(c.g);
  const b = srgbToLinear(c.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** Even OKLCH ramp between two hex colours, inclusive of both ends. */
export function rampBetween(a: string, b: string, steps: number): string[] {
  const n = Math.max(1, Math.floor(steps));
  const ca = hexToOklch(a);
  const cb = hexToOklch(b);
  if (n === 1) return [oklchToHex(ca)];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(oklchToHex(mixOklch(ca, cb, i / (n - 1))));
  return out;
}

/** Convenience: nudge a colour's lightness while holding hue and chroma. */
export function withLightness(hex: string, l: number): string {
  const c = hexToOklch(hex);
  return oklchToHex({ ...c, l: clamp01(l) });
}

/** Convenience: scale a colour's chroma. */
export function withChroma(hex: string, c: number): string {
  const o = hexToOklch(hex);
  return oklchToHex({ ...o, c: Math.max(0, c) });
}

/** Alpha-composite `fg` over `bg` (both hex) and return an opaque hex. */
export function flatten(fg: string, bg: string): string {
  const f = parseHex(fg);
  const b = parseHex(bg);
  const a = f.a;
  return rgbToHex({
    r: f.r * a + b.r * (1 - a),
    g: f.g * a + b.g * (1 - a),
    b: f.b * a + b.b * (1 - a),
    a: 1,
  });
}
