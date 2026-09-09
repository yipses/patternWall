// Dev-only: rasterise sample renders so we can actually look at them.
import { writeFileSync, mkdirSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { generators, getGenerator, getPalette, renderToSvg, defaultParams, curatedPalettes } from '../dist/index.js';

const out = process.argv[2] || '/tmp/samples';
mkdirSync(out, { recursive: true });
const which = process.argv[3] ? process.argv[3].split(',') : generators.map((g) => g.id);
const paletteIds = process.argv[4] ? process.argv[4].split(',') : ['obsidian', 'paper', 'riso-pink', 'crt-green'];
const W = 430, H = 932;

for (const id of which) {
  const g = getGenerator(id);
  if (!g) { console.error('no generator', id); process.exit(1); }
  for (const pid of paletteIds) {
    const p = getPalette(pid) ?? curatedPalettes[0];
    const svg = renderToSvg({ generator: g, width: W, height: H, palette: p, params: defaultParams(g), seed: 'sample-1', bleed: 0 });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
    writeFileSync(`${out}/${id}--${pid}.png`, png);
    console.error(`${id} ${pid}: svg ${(svg.length/1024).toFixed(0)}kB png ${(png.length/1024).toFixed(0)}kB`);
  }
}
