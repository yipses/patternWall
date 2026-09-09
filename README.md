# PatternWall

A generative iPhone wallpaper studio. Browse a gallery of pattern families, open one, tune its
parameters and colours, preview it as an iOS Lock Screen or Home Screen, and export a PNG at your
phone's exact pixel size.

Everything runs in the browser. There is no server, no database and no account: a wallpaper is
fully described by a pattern id, a seed, a parameter set and a palette, all of which live in the URL.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:3100
```

Other scripts, all run from the repository root:

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit`, strict, across both workspaces |
| `npm run lint` | ESLint over the whole repo with `--max-warnings=0` |
| `npm run test` | Vitest unit tests in `@patternwall/core`, including resvg rasterisation |
| `npm run build` | Builds core, then a static Next.js export into `apps/web/out` |
| `npm run test:e2e` | Builds, serves the export, and runs Playwright against it |
| `npm run start` | Serves an existing build on port 3100 |
| `npm run samples <dir>` | Rasterises sample PNGs of every generator, for looking at |

The Playwright suite expects a Chromium binary at `/opt/pw-browsers/chromium`; override it with
`PW_CHROMIUM=/path/to/chrome`.

---

## Architecture

```
packages/core   @patternwall/core — pure, zero runtime dependencies, no DOM, no Node APIs
apps/web        Next.js App Router, static export, CSS Modules
```

### Generators are pure functions

A generator is `(params, palette, width, height, rng) -> SVG string`. It reads nothing from the
environment, allocates no state between calls, and touches neither the DOM nor the clock. There is
no `Math.random` anywhere in `packages/core`: every stochastic decision goes through a seeded
mulberry32 `Rng`. Identical inputs produce a byte-identical string, which is what makes a share link
a wallpaper rather than a suggestion.

### One string is the source of truth

The gallery card, the editor preview, the PNG export, the thirty-file batch and the Node test suite
all call the same `renderToSvg`. Nothing else builds a render. The preview is an `<img>` whose source
is that exact SVG as a data URL, and the exporter draws that same `<img>` to a canvas. There is no
second code path for the two to drift apart in, and `apps/web/e2e/parity.spec.ts` asserts the point
directly: for every generator, palette and seed it checks, the SVG the browser produces is compared
character for character against the SVG Node produces.

### The SVG vocabulary is deliberately small

Generators may emit only:

```
svg g defs rect circle ellipse line polyline polygon path
linearGradient radialGradient stop clipPath use mask title
```

Presentation attributes only. No `<style>` blocks, no CSS classes, no `<filter>` of any kind, no
`foreignObject`, no `<text>`, no external references.

The reason is portability. The render path has to mean the same thing to a browser today and to
[resvg](https://github.com/linebender/resvg) in Node, and to resvg again on a server when the render
service lands. Filters are the worst offender: `feTurbulence` produces visibly different noise in
different renderers and is only partially supported outside browsers. So PatternWall computes its
own value and gradient noise on the CPU (`packages/core/src/noise.ts`) and emits the result as
geometry. `validateSvgVocabulary` enforces the rule, and the test suite runs it over every
generator against six palettes, three seeds and both parameter extremes.

### Colour is stored as hex and computed in OKLCH

Hex is what people paste; OKLCH is what mixing, ramps, harmony and palette extraction actually need.
`oklchToHex` gamut-maps into sRGB by holding lightness and hue and binary-searching chroma down,
rather than clipping channels — clipping moves lightness and hue, and a palette mapped that way
stops obeying the contrast rules that were just checked against it.

One deliberate asymmetry: `mixOklch` interpolates around the hue circle (right for tints and shades
of one colour), while `accentAt` — the palette ramp every generator uses — interpolates through
rectangular OKLab. The short hue arc between two accents half a turn apart lands on a colour the
palette does not contain, which quietly replaces the chosen palette with a gradient.

### Composition awareness

`RenderContext` carries `safeZones` — the boxes iOS reserves for the clock, the widget row and the
bottom controls — already offset for the export bleed. Every generator takes a `quietTop` parameter
and multiplies its local density, weight or opacity by `quietFactor(...)`, so one honest control
governs how far the pattern gets out of the clock's way. Detail and contrast are pushed into the
lower canvas, where the app grid and dock live.

### Bleed

Exports are rendered 8% larger on every edge by default. iOS zooms the wallpaper as the phone tilts,
and without the margin the parallax eventually reveals an unpainted edge. The export panel states
both numbers — your panel size and the file size — and the bleed can be turned off.

---

## Adding a generator

1. Create `packages/core/src/generators/<id>.ts` exporting a `Generator`.
2. Import it in `packages/core/src/generators/index.ts` and add it to the `generators` array.

That is the whole registration step. The gallery, the router's static params, the related-patterns
list, the tag filter and every test read from that array.

What the contract asks of you:

- **Be pure.** Take everything from `RenderContext`. Use `ctx.rng`, never `Math.random`, never
  `Date`, never a module-level counter.
- **Consume the palette through helpers.** `accent(p, i)` wraps, `accentAt(p, t)` ramps,
  `accentRamp(p, n)` samples. Never index `palette.accents` directly — a palette extracted from a
  photograph may have one accent or four, and a generator that assumes three will break on both.
- **Scale everything to `Math.min(width, height)`,** so the render looks the same at a 240px preview
  and a 1496px export. Never gate a decision on an absolute pixel threshold — the thumbnail and the
  export would then be different pictures, and if the decision touches `ctx.rng` it desynchronises
  everything after it. `packages/core/test/determinism.test.ts` enforces this.
- **Compose portrait-first.** Tune for 9:19.5. Take a `quietTop` number param and apply
  `quietFactor(y, height, quietTop, ctx.safeZones)`.
- **Stay inside the vocabulary,** and emit numbers through `num()` so output stays byte-stable.
- **Write the `description`.** Three to five paragraphs of plain-language prose explaining how the
  algorithm works and why the parameters are the ones they are. It is rendered on the pattern page
  and it is a deliverable, not filler. Markdown, but only paragraphs, `**bold**` and `*italic*`.

The existing tests will pick the new generator up automatically and hold it to determinism, the SVG
vocabulary at default and extreme parameters, exact rasterised dimensions, byte-stable rasterisation,
a non-blank canvas on six palettes, share-link round-tripping, and browser/Node parity.

---

## Current limitations

- **The wallpaper cannot be set for you.** iOS exposes no public API for it. See `/setup` for the
  Shortcuts recipe, which is the sanctioned route, and for an honest account of how those
  instructions were verified.
- **The `/setup` instructions are partially verified.** The machine this was built on could not
  reach `support.apple.com` directly, so Apple's guide was consulted through search results quoting
  it. Labels confirmed against Apple's own wording are marked as such on the page; two toggle names
  that only community sources attest to are flagged as needing checking on your device.
- **Rendering is synchronous on the main thread.** A dense `flow-dots` configuration emits tens of
  thousands of circles, and while the preview is debounced and drops to a lower resolution during a
  drag, a very heavy configuration can still cost a frame. A worker would fix this properly.
- **Batch export is chunked, not parallel.** Thirty full-resolution renders take a while; the work
  yields a frame between each so the UI stays live, but it is one core doing one image at a time.
- **PNG quantisation happens after rasterisation.** UPNG's quantiser is good but it works on pixels,
  not on the palette the generator actually used, so a very smooth gradient can band at low colour
  counts. The PNG-24 toggle exists for that case.
- **Palette extraction is deterministic but naive.** k-means with a furthest-point seeding over a
  120px downsample. It reads a photograph well; it will not do anything clever about a photograph
  that is mostly sky.
- **Collected configurations and saved palettes live in `localStorage`,** so they do not follow you
  to another browser or device. Copy a link for that.
- **Safe zones are approximations.** Apple moves the clock and widget row a little between models;
  the boxes are fractions of the screen chosen to be close enough to compose against, not a spec.
- **Scale invariance is structural, not exact.** A dot that lands within a rounding error of the
  canvas edge can fall inside at one resolution and outside at another, so a 108px thumbnail and a
  1399px export can differ by a handful of shapes out of several thousand. The test suite holds this
  to half a percent per element type.
- **Four generators.** The taxonomy has eight tags; `isometric`, `distortion` and `physics` have no
  patterns yet.
