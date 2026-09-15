import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { renderToSvg } from '../src/index.js';
import { ALL_GENERATORS, baseParams, TEST_PALETTES } from './helpers.js';

const contours = ALL_GENERATORS.find((g) => g.id === 'contours')!;

/**
 * The defaults as they stood when the numbers below were measured.
 *
 * Three tests here are about what happens to lines on *given* ground — a heavy
 * pen crowding, steep country dropping contours, flat country getting
 * supplementary ones — and every one of them took its ground from
 * `defaultParams`. That held until the defaults moved, and then all three
 * broke at once without a line of the code changing.
 *
 * Worth reading which ones actually mattered, because the obvious answer was
 * wrong. Pinning the terrain — scale and detail; grain and valley incision
 * were pinned here too until they were removed — moved
 * the numbers *further* out. The movers were `indexEvery`, which went from
 * every fifth line to every second and so made most of the map heavy index
 * strokes, and `weight`, which went to its minimum: a thinner pen leaves more
 * room, and "is there room for a supplementary line" is exactly what one of
 * these tests asks. Sixty levels went from 8 supplementary lines to 25.
 *
 * So this is the whole set, not a guess at the relevant half. A test
 * calibrated at an extreme has to pin whatever puts it there, or the next
 * change to a default silently moves it somewhere its bounds mean nothing —
 * which this file already records happening once, when the weight slider's
 * maximum came down and a bound went on passing with the mechanism deleted.
 */
const CALIBRATED = {
  levels: 14,
  scale: 1.5,
  detail: 3,
  resolution: 90,
  weight: 1,
  indexEvery: 5,
  supplementary: 0.5,
};

function render(over: Record<string, number | string | boolean>, size = 600): string {
  return renderToSvg({
    generator: contours,
    width: size,
    height: size,
    palette: TEST_PALETTES[0]!,
    params: { ...baseParams(contours), ...over },
    seed: 'survey',
    bleed: 0,
  });
}

/** Each subpath of the render: its first point, last point, and whether it closes. */
function subpaths(svg: string): { start: [number, number]; end: [number, number]; closed: boolean; points: number }[] {
  const out: { start: [number, number]; end: [number, number]; closed: boolean; points: number }[] = [];
  for (const chunk of svg.split(/M(?=[-\d])/).slice(1)) {
    const body = chunk.replace(/".*$/s, '');
    const nums = (body.match(/-?[\d.]+/g) ?? []).map(Number);
    if (nums.length < 4) continue;
    out.push({
      start: [nums[0] as number, nums[1] as number],
      end: [nums[nums.length - 2] as number, nums[nums.length - 1] as number],
      closed: body.trimEnd().endsWith('Z'),
      points: (body.match(/C/g) ?? []).length,
    });
  }
  return out;
}

/**
 * Only the contour lines, with the water fill and the background dropped.
 *
 * The sea is a run of straight-edged cell polygons by construction — it is a
 * filled region, not a traced curve — so anything asking a question about the
 * *lines* has to look at the line groups alone. Measured against the whole
 * document, the water's `L` commands read as un-smoothed contours and the
 * curve test failed on correct output.
 *
 * Depression ticks are dropped for the same reason and by the same rule: they
 * are straight marks, drawn butt-ended, and they are not contours.
 */
/**
 * The stroked groups of a render, sorted into the three kinds it draws.
 *
 * Every one of them is `fill="none"`, so a test asking about contours has to
 * say which it means. A supplementary line is dashed; a row of depression ticks
 * is butt-ended and solid; a contour is neither.
 */
function groupsOf(svg: string, kind: 'contour' | 'supplementary' | 'hachure'): string[] {
  return svg
    .split('<g fill="none"')
    .slice(1)
    .filter((g) => {
      const seen = g.includes('stroke-dasharray')
        ? 'supplementary'
        : g.includes('stroke-linecap="butt"')
          ? 'hachure'
          : 'contour';
      return seen === kind;
    });
}

/** The same groups in document order, each labelled, for tests that need both. */
function orderedGroups(svg: string): { kind: 'contour' | 'supplementary' | 'hachure'; body: string }[] {
  return svg
    .split('<g fill="none"')
    .slice(1)
    .map((body) => ({
      kind: body.includes('stroke-dasharray')
        ? ('supplementary' as const)
        : body.includes('stroke-linecap="butt"')
          ? ('hachure' as const)
          : ('contour' as const),
      body,
    }));
}

function lineGroups(svg: string): string[] {
  return groupsOf(svg, 'contour');
}

function lines(svg: string): string {
  return lineGroups(svg).join('');
}

describe('contours', () => {
  /**
   * A contour is a closed curve, or it runs off the canvas. It cannot stop in
   * the middle of the map.
   *
   * That is the one property marching squares can break silently, and since the
   * crossings are chained into whole curves it can now be asserted directly:
   * every subpath either closes with a Z or has both of its ends on the canvas
   * border. An earlier version of this test counted unpaired segment endpoints,
   * which said the same thing about the raw fragments; this says it about the
   * curves that actually get drawn, so it also covers the chaining.
   *
   * Run at two settings on purpose. The first is ordinary country; the second
   * is rough, finely sampled and small-scale, which is where the ambiguous
   * saddle cells occur — measured, they are a fraction of a percent of
   * crossings. Testing only the ordinary case once left the saddle handling
   * with no coverage at all: collapsing it to a single segment passed, which is
   * the "test that cannot fail" trap in its purest form.
   */
  it.each([
    ['ordinary country', { resolution: 60, levels: 18 }],
    ['rough country, where saddles occur', { resolution: 200, levels: 60, detail: 5, scale: 4 }],
  ])('leaves no contour stopping in the middle of the map: %s', (_label, over) => {
    const SIZE = 600;
    // Supplementary lines are contours as well — traced from the same
    // crossings, at a height halfway between two of them — so the invariant is
    // theirs too, and including them is the only coverage they have of it.
    const svg = render(over, SIZE);
    const paths = subpaths(lines(svg) + groupsOf(svg, 'supplementary').join(''));
    expect(paths.length, 'no contours to check').toBeGreaterThan(20);

    const onBorder = ([x, y]: [number, number]): boolean => {
      const eps = 0.3;
      return x <= eps || y <= eps || x >= SIZE - eps || y >= SIZE - eps;
    };

    const dangling = paths.filter((p) => !p.closed && !(onBorder(p.start) && onBorder(p.end)));
    expect(
      dangling.length,
      `${dangling.length} contours stop in the interior, e.g. ${dangling
        .slice(0, 3)
        .map((p) => `${p.start.map((n) => n.toFixed(1)).join(',')}->${p.end.map((n) => n.toFixed(1)).join(',')}`)
        .join(' ')}`,
    ).toBe(0);
  });

  /**
   * The curves are interpolated, so a coarse grid should cost small features
   * rather than smoothness. Every contour is drawn as cubic segments; a run of
   * straight hops would mean the chaining or the smoothing stopped happening,
   * which is the regression that would quietly put the faceting back.
   */
  it('draws curves rather than straight hops', () => {
    const ink = lines(render({ resolution: 60, levels: 18 }, 600));
    expect(ink).not.toMatch(/L-?[\d.]+ -?[\d.]+L/);
    const curvy = subpaths(ink).filter((p) => p.points > 0).length;
    expect(curvy / subpaths(ink).length, 'most contours should be curves').toBeGreaterThan(0.9);
  });

  /**
   * Every contour the count asks for should land inside the terrain.
   *
   * Fractal noise clusters hard around its middle — at the defaults the raw
   * field ran 0.337 to 0.695, barely a third of its nominal range — so heights
   * taken as fractions of 0..1 mostly fell outside the land entirely. Of
   * twenty-two lines, eight drew and fourteen drew nothing, which made the
   * control roughly a third as fine as it claimed and was invisible from the
   * outside: the map simply looked coarser than the number said.
   *
   * The field is stretched to its own range before any height is read off it,
   * so this asserts what that buys. Before, it scored 8 of 21.
   */
  it('draws a line for nearly every level asked for', () => {
    // Counted through `lines`, so the depression ticks do not pad the total —
    // they are `fill="none"` groups too, and counting them made this read 17
    // groups for 13 levels at the defaults.
    const svg = render({ levels: 22, resolution: 60 }, 600);
    const drawn = lineGroups(svg).length;
    expect(drawn, `only ${drawn} of 21 contour levels drew anything`).toBeGreaterThanOrEqual(18);
  });

  /**
   * Sea level has to reach the land it is meant to flood.
   *
   * Its first version took the height as a fraction of 0..1, and the default of
   * 0.32 sat below the lowest ground on the map — so no cell was ever
   * underwater, no water was drawn, and the slider did nothing whatsoever until
   * two-thirds of its travel. Nothing about the render looked broken; there was
   * simply never any water.
   *
   * Measured as area rather than presence, so it also catches a shoreline that
   * floods the wrong side or stops responding partway up.
   */
  it('floods more ground as the sea rises, and none at zero', () => {
    const area = (seaLevel: number): number => {
      // Tint off: its bands are filled paths of the same shape as the water,
      // and this is a question about the water alone.
      const svg = render({ seaLevel, resolution: 60, elevationTint: 0 }, 600);
      const fill = /<path d="([^"]+)" fill="#/.exec(svg);
      if (!fill) return 0;
      let total = 0;
      for (const poly of (fill[1] as string).split('M').slice(1)) {
        const nums = (poly.match(/-?[\d.]+/g) ?? []).map(Number);
        let acc = 0;
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const jx = (i + 2) % nums.length;
          acc += (nums[i] as number) * (nums[jx + 1] as number) - (nums[jx] as number) * (nums[i + 1] as number);
        }
        total += Math.abs(acc) / 2;
      }
      return total / (600 * 600);
    };

    expect(area(0), 'sea level zero should leave dry land').toBe(0);
    const low = area(0.25);
    const high = area(0.55);
    expect(low, `sea level 0.25 flooded ${(low * 100).toFixed(1)}% of the canvas`).toBeGreaterThan(0.02);
    expect(high, `sea level 0.55 flooded ${(high * 100).toFixed(1)}%, against ${(low * 100).toFixed(1)}% at 0.25`).toBeGreaterThan(low * 1.5);
  });

  /**
   * Ticks go on hollows, and they point into them.
   *
   * A closed contour is exactly the same mark around a summit and around a
   * basin, so the only thing distinguishing them on a printed sheet is which
   * side the ticks fall on. Getting that backwards is not a subtle defect —
   * it relabels every crater as a hill — and it is a one-character mistake,
   * because "inward" comes from the sign of the ring's shoelace area.
   *
   * Both halves are asserted, since the sign feeds the classification as well
   * as the direction and flipping it moves the ticks wholesale from the
   * hollows to the summits: measured, 104 ticks become 282 on different rings.
   *
   * The hollow test is topological rather than a height lookup, because the
   * field is not reachable from out here. Inside a depression at level L the
   * ground falls, so any contour nested within it is L-1; inside a hill it
   * rises, so any nested contour is L+1. A ring with the next level up inside
   * it is a hill that has been ticked.
   */
  it('ticks hollows on their downhill side, not summits', () => {
    const svg = render({ resolution: 60, levels: 18 }, 600);

    /** Closed rings of each level, as polygons of their on-path points. */
    const rings = new Map<number, [number, number][][]>();
    let level = 0;
    for (const { kind, body: g } of orderedGroups(svg)) {
      if (kind !== 'contour') continue;
      level += 1;
      const d = /<path d="([^"]+)"/.exec(g)?.[1];
      if (!d) continue;
      const polys: [number, number][][] = [];
      for (const sub of d.split('M').slice(1)) {
        if (!sub.trimEnd().endsWith('Z')) continue;
        const nums = (sub.match(/-?[\d.]+/g) ?? []).map(Number);
        const poly: [number, number][] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) poly.push([nums[i] as number, nums[i + 1] as number]);
        if (poly.length >= 3) polys.push(poly);
      }
      rings.set(level, polys);
    }

    const inside = (pt: [number, number], poly: [number, number][]): boolean => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i] as [number, number];
        const [xj, yj] = poly[j] as [number, number];
        if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi || 1e-9) + xi) hit = !hit;
      }
      return hit;
    };

    const perimeter = (poly: [number, number][]): number => {
      let total = 0;
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i] as [number, number];
        const [bx, by] = poly[(i + 1) % poly.length] as [number, number];
        total += Math.hypot(bx - ax, by - ay);
      }
      return total;
    };

    let ticks = 0;
    let pointingOut = 0;
    let hills = 0;
    let hollows = 0;
    let sparsest = 1;
    let sparsestAt = '';
    level = 0;
    for (const { kind, body: g } of orderedGroups(svg)) {
      if (kind === 'supplementary') continue;
      if (kind === 'contour') {
        level += 1;
        continue;
      }
      const d = /<path d="([^"]+)"/.exec(g)?.[1] ?? '';
      const own = rings.get(level) ?? [];
      const perRing = new Map<number, number>();
      for (const seg of d.split('M').slice(1)) {
        const n = (seg.match(/-?[\d.]+/g) ?? []).map(Number);
        if (n.length < 4) continue;
        ticks += 1;
        const tip: [number, number] = [n[2] as number, n[3] as number];
        const host = own.findIndex((poly) => inside(tip, poly));
        if (host < 0) {
          pointingOut += 1;
          continue;
        }
        perRing.set(host, (perRing.get(host) ?? 0) + 1);
        const ring = own[host] as [number, number][];
        const probe = (lv: number): boolean =>
          (rings.get(lv) ?? []).some((poly) => poly.every((pt) => inside(pt, ring)));
        if (probe(level + 1)) hills += 1;
        else if (probe(level - 1)) hollows += 1;
      }
      // Ticks sit one gap apart, so a ring that is a hollow carries very nearly
      // as many as its perimeter has room for. A ring carrying two or three is
      // not a hollow that was ticked; it is a hill with a few dimples in it.
      for (const [idx, drawn] of perRing) {
        const slots = perimeter(own[idx] as [number, number][]) / (2.6 * (600 / 60));
        if (slots >= 2 && drawn / slots < sparsest) {
          sparsest = drawn / slots;
          sparsestAt = `level ${level}, ${drawn} ticks in ${slots.toFixed(1)} slots`;
        }
      }
    }

    expect(ticks, 'no depression ticks were drawn to check').toBeGreaterThan(20);
    expect(pointingOut, `${pointingOut} of ${ticks} ticks point out of their ring instead of into it`).toBe(0);
    expect(hills, `${hills} ticked rings have the next contour up inside them, so they are summits`).toBe(0);
    expect(hollows, 'no ticked ring could be confirmed as a hollow').toBeGreaterThan(0);
    // A ticked ring carries a row of ticks all the way round, not a speck.
    //
    // This assertion used to be the only coverage of the per-ring vote: with
    // the vote in place the emptiest ticked ring filled 0.74 of its slots, and
    // without it a stray ring appeared at 0.23. That is no longer what it
    // catches. The generator now enforces the row directly — a ring whose ticks
    // mostly fail their own downhill and inward checks is dropped rather than
    // half-drawn — and measured with the vote deleted, across five seeds at two
    // settings, the emitted ticks are identical. So this guards the row rule,
    // and the vote is an optimisation that no test distinguishes. Said plainly
    // here because the previous wording would send the next person looking for
    // a guarantee that has moved.
    expect(sparsest, `the emptiest ticked ring is barely ticked at all — ${sparsestAt}`).toBeGreaterThan(0.5);
  });

  /**
   * The elevation tint has to be visible, and it has to be affordable.
   *
   * Two versions of it were not. Filling a band per contour is the obvious
   * construction and the arithmetic rules it out: at the default fourteen
   * levels the bands are about as far apart as the field moves across one
   * grid cell, so essentially every cell straddles a boundary — 16,438 of
   * 17,550 measured — and there is no interior to merge into runs. Nested
   * sub-level fills came to 692kB against 258kB untinted, and classifying
   * cells instead made it 995kB. Keying the wash to a derived, much coarser
   * interval is what makes it cheap, so the size is the assertion.
   *
   * The other end matters just as much: the first version that was cheap
   * enough was also invisible, because a constant mix against a near-black
   * background leaves every low band looking like the paper. So the distinct
   * fill colours are counted too — a tint that renders as one flat wash is a
   * tint that is not doing anything.
   */
  it('tints the elevation visibly without flooding the document', () => {
    // Sea level off: the water is a filled path of the same shape as a tint
    // band, and this is a question about the bands.
    const fills = (over: Record<string, number>): string[] => {
      const svg = render({ ...CALIBRATED, resolution: 90, seaLevel: 0, elevationTint: 0.65, ...over }, 600);
      return [...svg.matchAll(/<path d="[^"]+" fill="(#[0-9a-f]{6})" stroke="none"/g)].map((m) => m[1] as string);
    };
    const plain = render({ ...CALIBRATED, resolution: 90, elevationTint: 0 }, 600).length;
    const tinted = render({ ...CALIBRATED, resolution: 90, elevationTint: 0.65 }, 600).length;

    // Spread, not step count. The version of this that was cheap enough and
    // still useless had seven distinct shades and all of them within four
    // luminance units of the paper — counting them said the ramp was fine
    // while the picture showed nothing at all. Measured across eight palettes
    // the spread is 24 to 40 units now and 4 with the ramp flattened, so the
    // bound sits between the two with room either side.
    const lum = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const shades = fills({});
    expect(new Set(shades).size, `the tint renders in ${new Set(shades).size} distinct shades`).toBeGreaterThanOrEqual(5);
    const spread = Math.max(...shades.map(lum)) - Math.min(...shades.map(lum));
    expect(spread, `the tint's bands span ${spread.toFixed(1)} luminance units, so it is invisible`).toBeGreaterThan(12);
    expect(
      tinted / plain,
      `tinting grew the document ${(tinted / plain).toFixed(2)}x, from ${(plain / 1024).toFixed(0)}kB`,
    ).toBeLessThan(2);
    expect(fills({ elevationTint: 0 }), 'the tint still painted at zero').toHaveLength(0);
  });

  /**
   * Sixty contours across a scarp is more line than there is paper.
   *
   * Line density is how a contour map says "steep", so a steep enough slope at
   * a fine enough interval runs its lines together into a solid mass — and
   * measured, that is not a near miss: at sixty levels, 162 sixteen-pixel
   * windows of a phone-sized render were over 80% ink and some were completely
   * filled. The picture is a blob where the map is most interesting.
   *
   * Thinning the stroke is the obvious answer and it is only half of one. It
   * fixes crowding caused by a heavy pen — at sixty levels and weight 3 it
   * takes mean ink from 0.45 to 0.23 — and does almost nothing at weight 1,
   * because sixteen lines through sixteen pixels is solid at any width. The
   * other half is the printed convention: steep ground carries fewer contours,
   * keeping the index lines the eye counts by. Both are asserted here, since
   * either alone leaves one of the two cases broken.
   *
   * Measured in mean luminance over the render and the worst window of it,
   * which is linear in ink where a coverage count is not — a sub-pixel line
   * antialiases across two pixels and a threshold counts both as full.
   */
  it('keeps the lines apart where the interval will not fit', () => {
    const ink = (over: Record<string, number>): { mean: number; worst: number } => {
      const W = 430;
      const H = 932;
      const svg = renderToSvg({
        generator: contours,
        width: W,
        height: H,
        palette: TEST_PALETTES[0]!,
        params: { ...baseParams(contours), ...CALIBRATED, elevationTint: 0, seaLevel: 0, hachures: 0, ...over },
        seed: 'survey',
        bleed: 0,
      });
      const px = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().pixels;
      const WIN = 16;
      const windows: number[] = [];
      for (let y = 0; y + WIN <= H; y += WIN) {
        for (let x = 0; x + WIN <= W; x += WIN) {
          let sum = 0;
          for (let j = 0; j < WIN; j++) {
            for (let i = 0; i < WIN; i++) {
              const o = ((y + j) * W + (x + i)) * 4;
              sum += 0.2126 * (px[o] as number) + 0.7152 * (px[o + 1] as number) + 0.0722 * (px[o + 2] as number);
            }
          }
          windows.push(sum / (WIN * WIN * 255));
        }
      }
      return {
        mean: windows.reduce((a, b) => a + b, 0) / windows.length,
        worst: Math.max(...windows),
      };
    };

    // Sixty levels: the decimation case. Without it, 0.175 mean and 0.506 in
    // the worst window; with it, 0.107 and 0.295.
    const many = ink({ levels: 60 });
    expect(many.worst, `the worst window at sixty levels is ${(many.worst * 100).toFixed(0)}% ink`).toBeLessThan(0.4);
    expect(many.mean, `sixty levels averages ${many.mean.toFixed(3)} ink`).toBeLessThan(0.14);

    // Sixty levels at maximum weight: the thinning case. A fat pen cannot be
    // answered by dropping lines, because the lines that remain are still too
    // fat for the gap.
    //
    // These bounds were recalibrated when the weight slider's maximum came down
    // from 3 to 2, and the recalibration is the point. The old pair — 0.17 mean
    // and 0.55 worst — was measured at weight 3, where the thinner takes 0.229
    // to 0.110 and a bound between the two is easy. At weight 2 the same
    // mechanism only takes 0.165 to 0.116, and both of those sit under the old
    // bounds: the assertion went on passing with the thinner deleted entirely.
    // Lowering a slider's maximum can disarm a test calibrated at the old one
    // without touching a line of the test, so the numbers below come from
    // measuring the fixed and broken cases at weight 2 rather than from
    // narrowing the old ones by eye.
    const heavy = ink({ levels: 60, weight: 2 });
    expect(heavy.mean, `sixty levels at weight 2 averages ${heavy.mean.toFixed(3)} ink`).toBeLessThan(0.14);
    expect(heavy.worst, `its worst window is ${(heavy.worst * 100).toFixed(0)}% ink`).toBeLessThan(0.4);

    // And none of it touches a render that has room: at fourteen levels and a
    // weight of one, nothing is dropped and nothing is thinned. That was the
    // default configuration when this was measured and is now just a map with
    // room in it, which is what the claim was always about.
    const easy = ink({});
    expect(easy.mean, `a map with room averages ${easy.mean.toFixed(3)} ink`).toBeLessThan(0.06);
  });

  /**
   * Flat country is the one place a contour map says nothing.
   *
   * The lines are simply far apart, and the reader gets an expanse of paper
   * where the ground may well be doing something. The printed answer is a line
   * at half the interval, dashed so it cannot be counted as part of the real
   * one, drawn only where there is room for it — which makes it the same rule
   * as the thinning and dropping on steep ground, read from the other end.
   *
   * So the assertion is about where they land rather than that they exist. The
   * room test is what separates this from simply doubling the line count, and
   * without it the feature is not a supplementary contour at all: measured over
   * a 600px render, eight levels draw 12 of them and sixty levels draw 2,
   * because at sixty there is nowhere left to put one.
   */
  it('fills empty country with half-interval lines and crowded country with none', () => {
    const dashes = (over: Record<string, number>): number =>
      groupsOf(render({ ...CALIBRATED, resolution: 60, ...over }, 600), 'supplementary')
        .join('')
        .split('M').length - 1;

    const sparse = dashes({ levels: 8 });
    const crowded = dashes({ levels: 60 });
    expect(sparse, `only ${sparse} supplementary lines on an eight-level map`).toBeGreaterThanOrEqual(8);
    expect(
      crowded,
      `${crowded} supplementary lines went into a sixty-level map, which has no room for any`,
    ).toBeLessThanOrEqual(4);
    expect(crowded).toBeLessThan(sparse / 2);

    // The control reaches from the emptiest ground to most open ground: 12 at
    // the default against 33 at the top, on the same map.
    expect(dashes({ levels: 8, supplementary: 1 })).toBeGreaterThan(sparse * 1.5);
    expect(dashes({ supplementary: 0 }), 'the control does nothing at zero').toBe(0);

    // Dashed, and the only thing on the map that is. A reader counting index
    // contours must not pick one of these up, and neither must a test.
    const svg = render({ resolution: 60, levels: 8 }, 600);
    expect(groupsOf(svg, 'supplementary').length).toBeGreaterThan(0);
    for (const g of groupsOf(svg, 'contour')) expect(g).not.toMatch(/stroke-dasharray/);
  });

});

/**
 * The polyline each contour was drawn from.
 *
 * `smoothPath` interpolates every point it is given, so the endpoint of each
 * cubic is one of the traced points — reading them back gives the line itself
 * rather than an approximation of it.
 */
function drawnLines(svg: string): [number, number][][] {
  const out: [number, number][][] = [];
  for (const group of groupsOf(svg, 'contour')) {
    for (const m of group.matchAll(/ d="M([-\d.]+) ([-\d.]+)((?:C[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+)+)(Z?)"/g)) {
      const pts: [number, number][] = [[Number(m[1]), Number(m[2])]];
      for (const c of (m[3] as string).matchAll(/C[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+)/g)) {
        pts.push([Number(c[1]), Number(c[2])]);
      }
      if ((m[4] as string) === 'Z') pts.push(pts[0] as [number, number]);
      if (pts.length > 3) out.push(pts);
    }
  }
  return out;
}

/**
 * Extra length a line carries over the same line read coarsely.
 *
 * The obvious measure — total turning per short step — is confounded, and was
 * tried first: a contour sweeping round a hill turns just as much as a
 * crenulated one, so it reported 54.9° at the old maximum detail for lines
 * that are visibly smooth when you crop the render and look. This compares a
 * line against a coarse walk of *itself*, so the large-scale shape divides out
 * and what is left is the wobble riding on it.
 */
function fineness(lines: [number, number][][], coarse: number): number {
  let fine = 0;
  let sparse = 0;
  for (const pts of lines) {
    let acc = 0;
    let anchor = pts[0] as [number, number];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i] as [number, number];
      const q = pts[i - 1] as [number, number];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      fine += d;
      acc += d;
      if (acc >= coarse) {
        sparse += Math.hypot(p[0] - anchor[0], p[1] - anchor[1]);
        anchor = p;
        acc = 0;
      }
    }
  }
  return sparse > 0 ? fine / sparse : 1;
}

/** Do two segments cross? */
function crosses(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const side = (p: [number, number], q: [number, number], r: [number, number]): number =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const d1 = side(a, b, c);
  const d2 = side(a, b, d);
  const d3 = side(c, d, a);
  const d4 = side(c, d, b);
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

describe('contours roughness', () => {
  /**
   * The thing this exists for, and the reason it could not come from the
   * existing controls.
   *
   * A survey sheet carries texture at two scales: country sweeping across the
   * page, and a fine wobble on every line. Only the first was ever here, and
   * structurally so — the field is sampled onto a grid, so nothing finer than
   * a cell survives to be drawn, and `detail`'s finest octave at its ceiling
   * is about 3% of the width where the texture wanted is nearer 0.5%. The two
   * field warps that used to live here could not supply it either, which is
   * most of why they are gone: both worked at the landform scale, before the
   * field was ever sampled.
   *
   * So the assertion is that the lines gain length at a scale well below the
   * landforms while the landforms themselves do not move.
   */
  it('adds length at a fine scale without moving the landforms', () => {
    const plain = render({ roughness: 0 }, 600);
    const rough = render({ roughness: 1 }, 600);

    // The excess over a straight walk is what crenulation is, so compare the
    // excesses rather than the ratios: a smooth line is already a few percent
    // longer than the chords across it, and that few percent is the large-scale
    // curve rather than anything this control did. Measured, plain runs 1.032
    // and roughness 1 runs 1.129 — an excess of 0.032 against 0.129, four times
    // over. The bound is taken from those two numbers rather than from what
    // sounded reasonable, which is how the first version of this came to demand
    // 15% of a mechanism that delivers 9.4%.
    const fineP = fineness(drawnLines(plain), 24);
    const fineR = fineness(drawnLines(rough), 24);
    expect(
      fineR - 1,
      `roughness 1 reads ${fineR.toFixed(3)} against ${fineP.toFixed(3)} plain`,
    ).toBeGreaterThan((fineP - 1) * 2.5);

    // …and the same hills, in the same places. A ring count that moved would
    // mean the terrain had been rewritten, which is exactly what getting this
    // from the grid does — detail 8 at resolution 360 produces the texture and
    // 54 paths where the same map has 38.
    expect(drawnLines(rough).length, 'roughening changed how many contours there are').toBe(drawnLines(plain).length);
  });

  /**
   * A contour may never cross another one. It is the one rule a contour map
   * cannot break — two heights in the same place — and displacing lines is
   * exactly the operation that would break it.
   *
   * What keeps it true is the cap: the displacement is a fraction of the gap
   * the line has to live in, so two neighbours are moved by nearly the same
   * amount and crowded ground takes none of it.
   *
   * At sixty levels, which is where the lines crowd. The first version of this
   * ran at fourteen and passed with the gap term deleted from the cap, because
   * the other half of the cap — a flat fraction of the short edge — is the one
   * that binds on open ground. A guard has to be run where the thing it guards
   * against can actually happen, or it is a description.
   */
  it('never pushes one contour through another, on ground with no room', () => {
    const lines = drawnLines(render({ roughness: 1, levels: 60 }, 600));
    let hits = 0;
    for (let a = 0; a < lines.length; a++) {
      for (let b = a + 1; b < lines.length; b++) {
        const A = lines[a] as [number, number][];
        const B = lines[b] as [number, number][];
        for (let i = 1; i < A.length; i += 2) {
          for (let j = 1; j < B.length; j += 2) {
            if (crosses(A[i - 1] as [number, number], A[i] as [number, number], B[j - 1] as [number, number], B[j] as [number, number])) hits += 1;
          }
        }
      }
    }
    expect(hits, `${hits} contour crossings`).toBe(0);
  });

  /**
   * The same map at a thumbnail and at an export.
   *
   * Everything this does is in fractions of the canvas — the resample step,
   * the amplitude, and the coordinates the displacement field is read at — so
   * a 108px gallery card and a 1399px download resample to the same number of
   * points and are pushed about by the same field. Keying any of the three on
   * pixels would give the preview a different map from the thing you download,
   * which is the one promise this app makes about its renders.
   */
  it('roughens the same way at any canvas size', () => {
    const small = drawnLines(render({ roughness: 1 }, 220));
    const large = drawnLines(render({ roughness: 1 }, 1100));
    expect(large.length, 'a different number of contours at a different size').toBe(small.length);
    expect(large.map((l) => l.length), 'the lines resampled to different point counts').toEqual(
      small.map((l) => l.length),
    );
  });

  /** Off is off: the default render is the one it always was. */
  it('leaves a render without it exactly as it was', () => {
    expect(render({ roughness: 0 }, 600)).toBe(render({}, 600));
  });
});
