import { GRID_SIZE, packGrid } from '@patternwall/core';

/**
 * A photograph, reduced to what the string-art solver actually reads.
 *
 * The solver only ever asks the target how dark it is around a point, so
 * everything else about a picture — its colour, its resolution, its aspect —
 * is thrown away here rather than carried through the app. What comes out is
 * `size` squared darkness values, packed into a string short enough to travel
 * in a share link. The size is the caller's choice, because the whole picture
 * goes in that link and finer costs characters: 48 is about 1,500 of them and
 * 128 about 11,000.
 *
 * Three things happen on the way, and each of them is the difference between a
 * portrait and a smudge:
 *
 * **Square crop, centred.** The ring of nails is round, so a rectangular photo
 * has to lose its ends somewhere; taking it from the middle is what a person
 * framing a portrait would do anyway.
 *
 * **Box filter, not sampling.** Every output cell averages the whole block of
 * source pixels behind it. Point-sampling a 4000px photo down to a grid
 * lands on that many arbitrary pixels and reports whatever they happened to be —
 * which for anything with texture in it is noise, not tone.
 *
 * **Normalised to its own range.** A photograph rarely spans black to white,
 * and the solver's ink budget is derived from how much darkness the target
 * asks for, so a flat original would simply be under-drawn. Stretching to the
 * range actually present means an evenly-lit snapshot and a high-contrast
 * studio shot both arrive with something to work with.
 */
export function imageToGrid(img: HTMLImageElement | ImageBitmap, size: number = GRID_SIZE): string {
  const sw = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const sh = 'naturalHeight' in img ? img.naturalHeight : img.height;
  if (!sw || !sh) throw new Error('That image had no pixels in it.');

  const side = Math.min(sw, sh);
  // The working canvas is a whole multiple of the grid, so every cell averages
  // the same number of source pixels. Eight at the coarse sizes and four at the
  // fine ones keeps it around a thousand pixels either way.
  const work = size * (size >= 96 ? 4 : 8);
  const canvas = document.createElement('canvas');
  canvas.width = work;
  canvas.height = work;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser would not give us a canvas to read the image with.');
  ctx.drawImage(img, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, work, work);

  const { data } = ctx.getImageData(0, 0, work, work);
  const block = work / size;
  const cells = new Float32Array(size * size);
  let lo = 1;
  let hi = 0;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let y = j * block; y < (j + 1) * block; y++) {
        for (let x = i * block; x < (i + 1) * block; x++) {
          const o = (y * work + x) * 4;
          // Rec. 709 luminance, then inverted: the grid stores darkness,
          // because that is the quantity a thread supplies.
          const lum =
            (0.2126 * (data[o] as number) + 0.7152 * (data[o + 1] as number) + 0.0722 * (data[o + 2] as number)) / 255;
          sum += 1 - lum;
        }
      }
      const v = sum / (block * block);
      cells[j * size + i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }

  const span = hi - lo;
  if (span > 1e-4) {
    for (let k = 0; k < cells.length; k++) cells[k] = ((cells[k] as number) - lo) / span;
  }
  return packGrid(cells, size);
}
