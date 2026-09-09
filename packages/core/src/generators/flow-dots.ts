import { accentAt } from '../palette.js';
import { hexToOklch, mixOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { clamp, quietFactor, smoothstep } from '../geometry.js';
import { el, num, points, svgRoot } from '../svg.js';
import { pBool, pNum, type Generator, type RenderContext } from '../types.js';

const description = `
A flow field is nothing more than a rule that says “if you are standing here, walk that way”. Give every point on the canvas an angle and you have a vector field; drop a particle onto it and follow the arrows and you get a streamline. Almost all of the character of the result comes from how you choose the angles, and almost none of it from the particle simulation, which is just Euler integration with a small step.

The angle here is a weighted sum of two noise fields sampled at deliberately non-harmonic frequencies — the second is about 2.7 times the first, not 2 or 4. Harmonic frequencies reinforce each other at regular intervals and the field develops a grid of eddies you can see; an irrational-ish ratio keeps the interference pattern from ever repeating inside the frame. The lower frequency sets the large sweeps that carry the eye down the canvas, and the higher one roughens them so the streamlines fray instead of running in parallel like combed hair. **Turbulence** is the weight between them, and it is the single control that most changes what the pattern feels like.

Particles are not drawn as lines. Each one is stamped with a dot every time it has travelled a fixed arc length, which is a different thing from stamping a dot every integration step. Speed varies across the field — the noise modulates it — so per-step stamping would bunch dots up in the slow regions and stretch them out in the fast ones, and you would read the artefact rather than the field. Fixed arc-length spacing means a dot is a unit of distance, not a unit of time, and the texture stays even everywhere while the *paths* still speed up and slow down.

Composition is handled by two biases rather than by cropping. Dot radius grows with height down the canvas, so the lower third carries the visual weight and the top stays airy; and **quiet top** scales both size and opacity down inside the region iOS reserves for the clock and the widget row. At the default of 0.6 the top is not empty — an empty top looks like a mistake — it is simply about half the density of the bottom, which is enough that white numerals sit on it cleanly.

**Trail length** and **density** trade against each other. Many short trails read as a texture or a grain; few long ones read as a diagram of the field itself. The default sits closer to the texture end because a wallpaper is looked at for a second at a time, and long legible streamlines start to feel like a screenshot of somebody’s data.
`.trim();

export const flowDots: Generator = {
  id: 'flow-dots',
  name: 'Flow Dots',
  tagline: 'Particles combed through a noise field, stamped at even intervals.',
  tags: ['flow', 'noise'],
  description,
  params: [
    { key: 'density', label: 'Density', type: 'number', min: 60, max: 900, step: 10, default: 280, description: 'How many particles are released. More particles means a denser weave, not longer paths.' },
    { key: 'trail', label: 'Trail length', type: 'number', min: 8, max: 220, step: 1, default: 96, description: 'Integration steps per particle. Short trails read as grain; long ones start to draw the field itself.' },
    { key: 'scale', label: 'Field scale', type: 'number', min: 0.3, max: 4, step: 0.05, default: 1.15, description: 'Size of the large sweeps. Low values give a few broad currents, high values a churn.' },
    { key: 'turbulence', label: 'Turbulence', type: 'number', min: 0, max: 1, step: 0.01, default: 0.42, description: 'Weight of the second, higher-frequency field. At zero the streamlines run smooth and parallel.' },
    { key: 'spacing', label: 'Dot spacing', type: 'number', min: 1, max: 7, step: 0.05, default: 2.4, description: 'Arc length between stamps, in dot diameters. Below about 1.6 the dots merge into a line.' },
    { key: 'dotSize', label: 'Dot size', type: 'number', min: 0.3, max: 3, step: 0.05, default: 1, description: 'Base radius, scaled to the canvas so it looks the same at any export size.' },
    { key: 'sweep', label: 'Sweep', type: 'number', min: -1, max: 1, step: 0.02, default: 0.22, description: 'A constant angle added to the whole field. Pushes the current toward the horizontal or the vertical.' },
    { key: 'colorSpread', label: 'Colour spread', type: 'number', min: 0, max: 1, step: 0.01, default: 0.7, description: 'How much of the accent ramp gets used. At zero every dot is the first accent.' },
    { key: 'quietTop', label: 'Quiet top', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6, description: 'Holds density and contrast back where iOS draws the clock and the widget row.' },
    { key: 'taper', label: 'Taper trails', type: 'boolean', default: true, description: 'Fade each trail in and out along its length, so paths dissolve rather than stopping dead.' },
  ],

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng, safeZones } = ctx;
    const minDim = Math.min(w, h);
    const noise = createNoise2D(rng);

    const density = Math.round(pNum(params, 'density', 280));
    const trail = Math.round(pNum(params, 'trail', 96));
    const scale = pNum(params, 'scale', 1.15);
    const turbulence = pNum(params, 'turbulence', 0.42);
    const spacing = pNum(params, 'spacing', 2.4);
    const dotSize = pNum(params, 'dotSize', 1);
    const sweep = pNum(params, 'sweep', 0.22);
    const colorSpread = pNum(params, 'colorSpread', 0.7);
    const quietTop = pNum(params, 'quietTop', 0.6);
    const taper = pBool(params, 'taper', true);

    const f1 = (scale * 2.1) / minDim;
    const f2 = f1 * 2.718; // non-harmonic on purpose
    const stepLen = minDim * 0.005;
    const rBase = minDim * 0.0039 * dotSize;
    const gap = Math.max(rBase * 1.2, rBase * 2 * spacing);

    const angleAt = (x: number, y: number): number => {
      const a = noise.fbm(x * f1, y * f1, 3, 2.03, 0.55);
      const b = noise.gradient(x * f2 + 31.7, y * f2 - 12.4);
      return (a * (1 - turbulence * 0.55) + b * turbulence) * Math.PI * 2.2 + sweep * Math.PI * 0.5;
    };
    const speedAt = (x: number, y: number): number => 0.55 + 0.9 * Math.abs(noise.value(x * f1 * 0.7, y * f1 * 0.7));

    // Faint marks read less on paper than they do on black, so light palettes
    // get a small opacity boost to land in the same perceptual place.
    const inkBoost = palette.mode === 'light' ? 1.18 : 1;
    const bg = hexToOklch(palette.background);
    const tint = mixOklch(bg, hexToOklch(accentAt(palette, 0.5)), palette.mode === 'dark' ? 0.14 : 0.1);
    const gradId = 'fd-bg';

    const defs = el(
      'defs',
      {},
      el(
        'linearGradient',
        { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' },
        el('stop', { offset: '0', 'stop-color': oklchToHex({ ...bg, l: clamp(bg.l + (palette.mode === 'dark' ? -0.012 : 0.012), 0, 1) }) }) +
          el('stop', { offset: '1', 'stop-color': oklchToHex(tint) }),
      ),
    );

    // Buckets keyed by fill colour keep the emitted SVG compact: one <g> with a
    // fill per colour band instead of a fill attribute on every circle.
    const bands = 12;
    const buckets: string[][] = [];
    const bandOpacity: number[][] = [];
    for (let i = 0; i < bands; i++) {
      buckets.push([]);
      bandOpacity.push([]);
    }

    let emitted = 0;
    const maxDots = 22000;

    for (let p = 0; p < density && emitted < maxDots; p++) {
      // Seed on a jittered stratified grid so particles cover the frame evenly
      // without the visible rows a plain grid would give.
      const cols = Math.max(1, Math.round(Math.sqrt((density * w) / h)));
      const rows = Math.max(1, Math.ceil(density / cols));
      const cx = p % cols;
      const cy = Math.floor(p / cols) % rows;
      let x = ((cx + rng.next()) / cols) * w;
      let y = ((cy + rng.next()) / rows) * h;

      const hueSeed = rng.next();
      let dist = gap * rng.next();

      for (let s = 0; s < trail && emitted < maxDots; s++) {
        const ang = angleAt(x, y);
        const spd = speedAt(x, y);
        const dx = Math.cos(ang) * stepLen * spd;
        const dy = Math.sin(ang) * stepLen * spd;
        const seg = Math.hypot(dx, dy);
        if (seg <= 0) break;

        let travelled = 0;
        dist += seg;
        while (dist >= gap && emitted < maxDots) {
          dist -= gap;
          travelled = seg - dist;
          const t = clamp(travelled / seg, 0, 1);
          const px = x + dx * t;
          const py = y + dy * t;
          if (px < -rBase * 4 || px > w + rBase * 4 || py < -rBase * 4 || py > h + rBase * 4) continue;

          const life = s / Math.max(1, trail - 1);
          const q = quietFactor(py, h, quietTop, safeZones);
          const depth = smoothstep(0.05, 0.95, py / h);
          let r = rBase * (0.48 + 1.05 * depth) * (0.55 + 0.45 * q);
          let o = (0.55 + 0.45 * depth) * (0.4 + 0.6 * q) * inkBoost;
          if (taper) {
            const env = Math.sin(Math.PI * clamp(life, 0, 1));
            r *= 0.4 + 0.6 * env;
            o *= 0.3 + 0.7 * env;
          }
          if (r < minDim * 0.0006) continue;

          const mix = clamp(hueSeed * colorSpread + depth * (1 - colorSpread * 0.4), 0, 1);
          const band = Math.min(bands - 1, Math.floor(mix * bands));
          (buckets[band] as string[]).push(`${num(px, 1)},${num(py, 1)},${num(r, 2)}`);
          (bandOpacity[band] as number[]).push(o);
          emitted++;
        }

        x += dx;
        y += dy;
        // Wrap generously so a particle leaving the frame re-enters elsewhere
        // rather than being wasted.
        if (x < -w * 0.1) x += w * 1.2;
        if (x > w * 1.1) x -= w * 1.2;
        if (y < -h * 0.1 || y > h * 1.1) break;
      }
    }

    let body = defs + el('rect', { x: 0, y: 0, width: w, height: h, fill: `url(#${gradId})` });

    for (let b = 0; b < bands; b++) {
      const items = buckets[b] as string[];
      if (items.length === 0) continue;
      const color = accentAt(palette, b / (bands - 1));
      // Opacity is quantised into a few groups so identical values share a <g>.
      const byOpacity = new Map<string, string[]>();
      const ops = bandOpacity[b] as number[];
      for (let i = 0; i < items.length; i++) {
        const key = num(clamp(ops[i] as number, 0.04, 1), 2);
        const arr = byOpacity.get(key);
        if (arr) arr.push(items[i] as string);
        else byOpacity.set(key, [items[i] as string]);
      }
      let inner = '';
      for (const [op, list] of byOpacity) {
        let circles = '';
        for (const item of list) {
          const parts = item.split(',');
          circles += el('circle', { cx: parts[0], cy: parts[1], r: parts[2] });
        }
        inner += el('g', { 'fill-opacity': op }, circles);
      }
      body += el('g', { fill: color }, inner);
    }

    // A very quiet horizon line keeps the bottom from reading as a void when
    // the palette has almost no chroma.
    if (palette.accents.length > 0) {
      const y0 = h * 0.985;
      body += el('polyline', {
        points: points([
          [w * 0.06, y0],
          [w * 0.94, y0],
        ]),
        stroke: accentAt(palette, 1),
        'stroke-width': num(Math.max(1, minDim * 0.0012)),
        'stroke-opacity': '0.25',
        fill: 'none',
        'stroke-linecap': 'round',
      });
    }

    return svgRoot(w, h, `${flowDots.name} wallpaper`, body);
  },
};
