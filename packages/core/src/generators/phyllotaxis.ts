import { accent, accentAt } from '../palette.js';
import { hexToOklch, mixOklch, oklchToHex } from '../color.js';
import { createNoise2D } from '../noise.js';
import { clamp, quietFactor, smoothstep } from '../geometry.js';
import { el, num, svgRoot } from '../svg.js';
import { pNum, pStr, type Generator, type RenderContext } from '../types.js';

const description = `
Put a seed at angle *n* × 137.507° and radius proportional to the square root of *n*, and you get the arrangement that sunflowers, pinecones and artichokes all arrive at independently. The angle is the golden angle: the full turn divided by the golden ratio. It matters because it is the *most* irrational number available — no rational approximation to it is any good — so successive seeds never line up into spokes, and every seed sits in the largest remaining gap. The square root on the radius is what keeps the packing even; without it the seeds crowd at the centre and thin out at the rim.

The **detune** control is the interesting one, and it is why this generator exists rather than just a picture of a sunflower. Move the divergence angle a fraction of a degree away from 137.507 and the pattern does not degrade gracefully — it snaps into a completely different structure. At about +0.1° a set of spiral arms appears where there were none; a little further and a different number of arms appears. Those arms are the Fibonacci numbers made visible: the packing is briefly commensurate with some rational approximation of the golden angle, and the seeds line up along it. A tenth of a degree is the whole difference between organic and mechanical, which is a satisfying amount of power to put behind a single slider.

**Radial falloff** generalises the square root into an arbitrary exponent. Below 1 the seeds pile up at the rim and leave a hole in the middle; above 1 they crowd the centre and spray outward. Neither is botanically correct and both are useful — the low end in particular gives a ring rather than a disc, which sits well behind a clock.

The origin does not have to be the centre of the canvas, and by default it is not. On a 9:19.5 screen a centred spiral leaves two large dead areas at top and bottom, and the top one is exactly where the clock goes. Dropping the origin to around three fifths of the height fills the lower canvas with the dense inner packing and lets the sparse outer rings run off the top edge, which is both a better composition and a more legible Lock Screen.

Dot size is tied to the local packing rather than being constant. Seeds near the rim have more room, so they are drawn larger; the result reads as a single surface rather than as a field of identical circles that happen to be further apart. **Dot scale** multiplies the whole thing, and past about 1.6 the dots begin to overlap into a continuous spiral ribbon, which is a different and also good-looking pattern.
`.trim();

const GOLDEN_ANGLE = 137.50776405003785;

/**
 * Both noise fields are sampled in canvas-relative units, never in pixels.
 *
 * They used to be keyed straight off pixel coordinates — `r * 0.01` and
 * `x * 0.004` — which meant a 108px thumbnail sampled a field thirteen times
 * coarser than a 1399px export and drew a different picture. Rasterised to a
 * common width, the two disagreed by 9.55 mean levels per channel against a
 * floor of 0.23 for the same render at two adjacent sizes.
 *
 * The constants are the old pixel rates times 430, the preview width, so a
 * 430px-wide render is unchanged and every other size now matches it rather
 * than drifting away from it.
 */
const JITTER_FIELD = 4.3;
const COLOR_FIELD = 1.72;

export const phyllotaxis: Generator = {
  id: 'phyllotaxis',
  name: 'Phyllotaxis',
  tagline: 'The golden angle, and what happens a tenth of a degree away from it.',
  tags: ['radial', 'organic'],
  description,
  params: [
    { key: 'count', label: 'Seed count', type: 'number', min: 150, max: 4200, step: 25, default: 1800, description: 'How many seeds are placed. The spiral grows outward, so more seeds means a wider disc, not a denser one.' },
    { key: 'detune', label: 'Angle detune', type: 'number', min: -1.2, max: 1.2, step: 0.005, default: 0, description: 'Degrees added to the golden angle. A tenth of a degree is enough to make spiral arms appear.' },
    { key: 'falloff', label: 'Radial falloff', type: 'number', min: 0.55, max: 1.6, step: 0.01, default: 1, description: 'Exponent on the radius. 1 is the botanical square-root packing; below 1 opens a hole in the middle.' },
    { key: 'dotScale', label: 'Dot scale', type: 'number', min: 0.25, max: 2.6, step: 0.05, default: 1, description: 'Multiplies every dot. Above about 1.6 the dots merge into a continuous ribbon.' },
    { key: 'originX', label: 'Origin across', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, description: 'Where the centre of the spiral sits horizontally, as a fraction of the canvas.' },
    { key: 'originY', label: 'Origin down', type: 'number', min: 0, max: 1, step: 0.01, default: 0.62, description: 'Where the centre sits vertically. Below halfway keeps the dense packing away from the clock.' },
    {
      key: 'shape',
      label: 'Seed shape',
      type: 'select',
      options: [
        { value: 'dot', label: 'Dots' },
        { value: 'ring', label: 'Rings' },
        { value: 'petal', label: 'Petals' },
      ],
      default: 'dot',
      description: 'Petals are ellipses turned to face the origin, which brings the spiral arms out much more strongly.',
    },
    { key: 'colorSpread', label: 'Colour spread', type: 'number', min: 0, max: 1, step: 0.01, default: 0.72, description: 'How far along the accent ramp the field travels. The first accent holds the dense lower canvas; later accents drift toward the sparse top.' },
    { key: 'jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01, default: 0.12, description: 'Noise added to each seed position, as a fraction of local spacing. A little breaks the machine-perfect look.' },
    { key: 'quietTop', label: 'Quiet top', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, description: 'Shrinks and fades seeds that land where iOS draws the clock and the widget row.' },
  ],

  render(ctx: RenderContext): string {
    const { width: w, height: h, palette, params, rng, safeZones } = ctx;
    const noise = createNoise2D(rng);
    const minDim = Math.min(w, h);
    const aspect = h / Math.max(1, w);

    const count = Math.round(pNum(params, 'count', 1800));
    const detune = pNum(params, 'detune', 0);
    const falloff = pNum(params, 'falloff', 1);
    const dotScale = pNum(params, 'dotScale', 1);
    const originX = pNum(params, 'originX', 0.5);
    const originY = pNum(params, 'originY', 0.62);
    const shape = pStr(params, 'shape', 'dot');
    const colorSpread = pNum(params, 'colorSpread', 0.72);
    const jitter = pNum(params, 'jitter', 0.12);
    const quietTop = pNum(params, 'quietTop', 0.5);

    const ox = originX * w;
    const oy = originY * h;
    const angleStep = ((GOLDEN_ANGLE + detune) * Math.PI) / 180;

    // Scale so the outermost seed clears the furthest corner: the spiral should
    // run off the canvas rather than sit on it like a plate.
    const corner = Math.max(
      Math.hypot(ox, oy),
      Math.hypot(w - ox, oy),
      Math.hypot(ox, h - oy),
      Math.hypot(w - ox, h - oy),
    );
    const exponent = falloff * 0.5;
    const c = (corner * 0.94) / Math.pow(Math.max(2, count), exponent);

    const bg = hexToOklch(palette.background);
    const tint = mixOklch(bg, hexToOklch(accent(palette, 0)), palette.mode === 'dark' ? 0.11 : 0.08);
    const defs = el(
      'defs',
      {},
      el(
        'radialGradient',
        { id: 'ph-bg', cx: num(originX, 3), cy: num(originY, 3), r: '0.85' },
        el('stop', { offset: '0', 'stop-color': oklchToHex(tint) }) +
          el('stop', { offset: '1', 'stop-color': oklchToHex({ ...bg, l: clamp(bg.l + (palette.mode === 'dark' ? -0.01 : 0.01), 0, 1) }) }),
      ),
    );

    const bands = 14;
    const buckets: string[][] = Array.from({ length: bands }, () => []);

    const margin = minDim * 0.08 * Math.max(1, dotScale);
    for (let i = 1; i <= count; i++) {
      const theta = i * angleStep;
      let r = c * Math.pow(i, exponent);
      const t = i / count;

      // Local spacing, derived from the area each seed owns: the disc out to
      // index i has area pi*r^2 and holds i seeds, so one seed occupies
      // pi*c^2*i^(2e-1) and sits about sqrt(pi)*c*i^(e-0.5) from its
      // neighbours. Dot size follows that, so the surface reads as evenly
      // covered instead of clotting at whichever end the exponent favours.
      const spacing = Math.max(minDim * 0.002, c * 1.7725 * Math.pow(Math.max(1, i), exponent - 0.5));

      if (jitter > 0) {
        const rn = (r / minDim) * JITTER_FIELD;
        const n = noise.gradient(Math.cos(theta) * rn + 5, Math.sin(theta) * rn - 2);
        r += n * spacing * jitter * 1.6;
      }

      const x = ox + Math.cos(theta) * r;
      const y = oy + Math.sin(theta) * r;
      if (x < -margin || x > w + margin || y < -margin || y > h + margin) continue;

      const q = quietFactor(y, h, quietTop, safeZones);
      const depth = smoothstep(0, 1, y / h);
      // Radius tracks local spacing, so the ratio of ink to gap is constant
      // wherever you look and the field reads as one surface. The only
      // deliberate unevenness is the gentle growth toward the bottom of the
      // canvas, which is the composition bias every generator here shares.
      const grow = 0.72 + 0.5 * depth;
      const rad = clamp(spacing * 0.42 * dotScale * grow * (0.34 + 0.66 * q), minDim * 0.0008, minDim * 0.07);

      const tone = clamp(
        colorSpread * (0.62 * (1 - depth) + 0.38 * (1 - t)) +
          (1 - colorSpread) * 0.35 +
          noise.value((x / w) * COLOR_FIELD, (y / h) * COLOR_FIELD * aspect) * 0.07,
        0,
        1,
      );
      const band = Math.min(bands - 1, Math.floor(tone * bands));
      const opacity = num(clamp(0.22 + 0.78 * q, 0.06, 1), 2);

      if (shape === 'ring') {
        (buckets[band] as string[]).push(
          // The floor is relative, like the radius clamp above it. An absolute
          // 0.35px put 100% of ring strokes on the floor at 108px and none at
          // 1399px, so the thumbnail drew its rings about four times heavier
          // than the export did.
          el('circle', { cx: num(x, 1), cy: num(y, 1), r: num(rad, 2), 'stroke-width': num(Math.max(minDim * 0.0008, rad * 0.42), 2), 'stroke-opacity': opacity }),
        );
      } else if (shape === 'petal') {
        const deg = (theta * 180) / Math.PI;
        (buckets[band] as string[]).push(
          el('ellipse', {
            cx: 0,
            cy: 0,
            rx: num(rad * 1.85, 2),
            ry: num(rad * 0.62, 2),
            'fill-opacity': opacity,
            transform: `translate(${num(x, 1)} ${num(y, 1)}) rotate(${num(deg, 1)})`,
          }),
        );
      } else {
        (buckets[band] as string[]).push(el('circle', { cx: num(x, 1), cy: num(y, 1), r: num(rad, 2), 'fill-opacity': opacity }));
      }
    }

    let body = defs + el('rect', { x: 0, y: 0, width: w, height: h, fill: 'url(#ph-bg)' });
    for (let b = 0; b < bands; b++) {
      const items = buckets[b] as string[];
      if (items.length === 0) continue;
      const color = accentAt(palette, b / (bands - 1));
      body +=
        shape === 'ring'
          ? el('g', { fill: 'none', stroke: color }, items.join(''))
          : el('g', { fill: color }, items.join(''));
    }

    return svgRoot(w, h, `${phyllotaxis.name} wallpaper`, body);
  },
};
