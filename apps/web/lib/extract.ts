'use client';

import { hexToOklch, oklchToHex, relativeLuminance, type Oklch, type Palette } from '@patternwall/core';

/**
 * Extract a palette from a photograph.
 *
 * The clustering happens in OKLCH, not in RGB. In RGB a bright sky and a pale
 * wall sit close together while two greens a person would call the same colour
 * sit far apart, and the resulting palette looks arbitrary. Clustering in a
 * perceptual space gives stops that match what someone would have picked with
 * an eyedropper.
 *
 * The image is downsampled to roughly 120x120 before anything else happens.
 * k-means over fifteen thousand samples converges in a few milliseconds; over
 * twelve million it does not converge at all on a phone.
 */

const SAMPLE_EDGE = 120;
const ITERATIONS = 12;

interface Lab {
  l: number;
  a: number;
  b: number;
}

function oklchToLab(c: Oklch): Lab {
  const rad = (c.h * Math.PI) / 180;
  return { l: c.l, a: Math.cos(rad) * c.c, b: Math.sin(rad) * c.c };
}

function labToOklch(v: Lab): Oklch {
  const c = Math.hypot(v.a, v.b);
  let h = (Math.atan2(v.b, v.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: v.l, c, h };
}

export async function loadImageFile(file: File): Promise<HTMLImageElement> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image. PNG, JPEG, HEIC or WebP will work.');
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('That image is larger than 25 MB. Try a smaller version of it.');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('This browser could not decode that image. JPEG or PNG is the safest bet.'));
      img.src = url;
    });
    return img;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function samplesFrom(img: HTMLImageElement): Lab[] {
  const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const w = Math.max(8, Math.round(ratio >= 1 ? SAMPLE_EDGE : SAMPLE_EDGE * ratio));
  const h = Math.max(8, Math.round(ratio >= 1 ? SAMPLE_EDGE / ratio : SAMPLE_EDGE));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser did not provide a 2D canvas context.');
  ctx.drawImage(img, 0, 0, w, h);
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    throw new Error('That image could not be read for colour extraction.');
  }
  const out: Lab[] = [];
  const px = data.data;
  for (let i = 0; i + 3 < px.length; i += 4) {
    if ((px[i + 3] as number) < 128) continue;
    const hex = `#${((1 << 24) + ((px[i] as number) << 16) + ((px[i + 1] as number) << 8) + (px[i + 2] as number)).toString(16).slice(1)}`;
    out.push(oklchToLab(hexToOklch(hex)));
  }
  return out;
}

function kmeans(samples: Lab[], k: number): { center: Lab; weight: number }[] {
  if (samples.length === 0) return [];
  const n = Math.min(k, samples.length);
  // k-means++ style seeding, but deterministic: take the sample furthest from
  // everything chosen so far. Random seeding would make the same photo produce
  // a different palette on every upload, which feels broken rather than lively.
  const centers: Lab[] = [samples[Math.floor(samples.length / 2)] as Lab];
  while (centers.length < n) {
    let best = samples[0] as Lab;
    let bestD = -1;
    for (let i = 0; i < samples.length; i += 3) {
      const s = samples[i] as Lab;
      let d = Infinity;
      for (const c of centers) d = Math.min(d, (s.l - c.l) ** 2 * 2.2 + (s.a - c.a) ** 2 + (s.b - c.b) ** 2);
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    centers.push(best);
  }

  const assign = new Int32Array(samples.length);
  for (let iter = 0; iter < ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i] as Lab;
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const cc = centers[c] as Lab;
        const d = (s.l - cc.l) ** 2 * 2.2 + (s.a - cc.a) ** 2 + (s.b - cc.b) ** 2;
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      if (assign[i] !== bi) moved = true;
      assign[i] = bi;
    }
    const sums = centers.map(() => ({ l: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i] as Lab;
      const t = sums[assign[i] as number] as { l: number; a: number; b: number; n: number };
      t.l += s.l;
      t.a += s.a;
      t.b += s.b;
      t.n++;
    }
    for (let c = 0; c < centers.length; c++) {
      const t = sums[c] as { l: number; a: number; b: number; n: number };
      if (t.n > 0) centers[c] = { l: t.l / t.n, a: t.a / t.n, b: t.b / t.n };
    }
    if (!moved) break;
  }

  const counts = new Array(centers.length).fill(0) as number[];
  for (let i = 0; i < samples.length; i++) counts[assign[i] as number]! += 1;
  return centers.map((center, i) => ({ center, weight: counts[i] as number })).filter((c) => c.weight > 0);
}

export interface ExtractedPalette {
  palette: Palette;
  stops: string[];
}

/**
 * Cluster to five stops and assign them by lightness: darkest and lightest
 * become background and ink (whichever way round the image leans), and the
 * three in the middle become accents, ordered by how much of the image they
 * account for.
 */
export function extractPalette(img: HTMLImageElement, name: string): ExtractedPalette {
  const samples = samplesFrom(img);
  if (samples.length < 16) throw new Error('That image did not contain enough opaque pixels to read a palette from.');
  const clusters = kmeans(samples, 5).sort((x, y) => x.center.l - y.center.l);
  const stops = clusters.map((c) => oklchToHex(labToOklch(c.center)));
  if (stops.length < 2) throw new Error('That image is almost a single flat colour; there is no palette to extract.');

  const darkest = stops[0] as string;
  const lightest = stops[stops.length - 1] as string;
  const meanLum = clusters.reduce((acc, c, i) => acc + relativeLuminance(stops[i] as string) * c.weight, 0) /
    Math.max(1, clusters.reduce((acc, c) => acc + c.weight, 0));
  const mode: 'light' | 'dark' = meanLum < 0.4 ? 'dark' : 'light';

  const middle = clusters
    .map((c, i) => ({ hex: stops[i] as string, weight: c.weight, l: c.center.l }))
    .slice(1, -1)
    .sort((a, b) => b.weight - a.weight)
    .map((c) => c.hex);

  const accents = (middle.length > 0 ? middle : [stops[Math.floor(stops.length / 2)] as string]).slice(0, 3);

  return {
    stops,
    palette: {
      id: 'extracted',
      name,
      background: mode === 'dark' ? darkest : lightest,
      ink: mode === 'dark' ? lightest : darkest,
      accents,
      mode,
      tags: ['custom'],
    },
  };
}
