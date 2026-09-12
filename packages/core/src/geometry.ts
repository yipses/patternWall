/** Rectangle in canvas pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The parts of an iPhone screen that are not really yours.
 *
 * iOS draws the clock, the date, a widget row and the two bottom controls
 * straight onto the wallpaper. A generator that puts its busiest passage at
 * 15% of the height is going to be read as "the one where you cannot see the
 * time". These boxes are approximate — Apple moves them a little between
 * models — but they are close enough to compose against.
 */
export interface SafeZones {
  /** Date line plus the large clock. */
  clock: Rect;
  /** The row of lock-screen widgets under the clock. */
  widgets: Rect;
  /** Flashlight / camera buttons and the home indicator. */
  controls: Rect;
  /** The area the Home Screen app grid covers. */
  iconGrid: Rect;
}

const rect = (w: number, h: number, x0: number, y0: number, x1: number, y1: number): Rect => ({
  x: x0 * w,
  y: y0 * h,
  w: (x1 - x0) * w,
  h: (y1 - y0) * h,
});

/**
 * Safe zones for a screen of the given pixel size, expressed as fractions of
 * that screen. Fractions rather than fixed points, because the same layout has
 * to hold from a 1179x2556 iPhone 15 Pro to a 1320x2868 Pro Max.
 */
export function safeZonesFor(width: number, height: number): SafeZones {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return {
    clock: rect(w, h, 0.08, 0.085, 0.92, 0.225),
    widgets: rect(w, h, 0.08, 0.235, 0.92, 0.3),
    controls: rect(w, h, 0.06, 0.855, 0.94, 0.985),
    iconGrid: rect(w, h, 0.04, 0.09, 0.96, 0.87),
  };
}

/**
 * The sub-rectangle of a bleed-padded canvas that will actually be visible.
 *
 * We render wallpapers larger than the screen so that iOS's perspective-zoom
 * parallax never slides an un-painted edge into view. `bleed` is the fraction
 * of each edge that may be cropped.
 */
export function visibleRect(width: number, height: number, bleed: number): Rect {
  const b = Math.min(0.15, Math.max(0, Number.isFinite(bleed) ? bleed : 0));
  return { x: width * b, y: height * b, w: width * (1 - 2 * b), h: height * (1 - 2 * b) };
}

/** Safe zones positioned inside a bleed-padded canvas. */
export function safeZonesForCanvas(width: number, height: number, bleed: number): SafeZones {
  const v = visibleRect(width, height, bleed);
  const z = safeZonesFor(v.w, v.h);
  const shift = (r: Rect): Rect => ({ x: r.x + v.x, y: r.y + v.y, w: r.w, h: r.h });
  return { clock: shift(z.clock), widgets: shift(z.widgets), controls: shift(z.controls), iconGrid: shift(z.iconGrid) };
}

/** Distance from a point to a rectangle; 0 when inside. */
export function distanceToRect(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/**
 * How strongly a generator should hold back at a given height.
 *
 * Returns 1 where the canvas is free and drops toward `1 - strength` inside
 * and just around the clock and widget boxes. Every generator multiplies its
 * local density, weight or opacity by this, which is what makes `quietTop` a
 * single honest control rather than four separate fudge factors.
 */
export function quietFactor(y: number, height: number, strength: number, zones: SafeZones): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0));
  if (s === 0) return 1;
  const top = zones.clock.y;
  const bottom = zones.widgets.y + zones.widgets.h;
  // 30% of the canvas, not 9%. The factor travels from 0.45 to 1 across this
  // distance, and over 9% that is steep enough to read as a horizontal seam
  // straight across the wallpaper — the pattern is plainly pale above the line
  // and saturated below it, with no visible gradient between. Widening the
  // feather is the only lever that removes it: sampling the factor per mark
  // rather than per tile and easing the curve both help the arithmetic and
  // neither changes what you see, because the ramp was already smooth to
  // within a third of a brightness level per row. What was wrong was that it
  // covered too little ground.
  const feather = Math.max(1, height * 0.3);
  // Smoothstep, not a straight line. The feather carries the factor from 0.45
  // to 1, so a linear ramp arrives at each end
  // with its slope still at full tilt: the eye reads those two corners as the
  // edges of a band, and the result is a horizontal seam across the wallpaper
  // rather than the easing this is meant to be. Measured on a nine-column
  // truchet, the linear version put a brightness step of 22 against a mean of
  // 1.3 at exactly the height where the lower feather began.
  //
  // smoothstep is zero-derivative at both ends, so the ramp leaves and arrives
  // without a corner. It is the same curve the generators already use to bias
  // detail down the canvas.
  let t: number;
  if (y <= top) {
    // Above the clock is quiet too, but eases back in at the very top edge.
    t = 1 - smoothstep(0, 1, Math.min(1, (top - y) / feather)) * 0.45;
  } else if (y <= bottom) {
    t = 1;
  } else {
    t = 1 - smoothstep(0, 1, Math.min(1, (y - bottom) / feather));
  }
  return 1 - s * t;
}

/** Smooth 0..1 ramp. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Clamp helper shared by generators. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
