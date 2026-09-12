# Working on PatternWall

Conventions and hard-won specifics for anyone — human or agent — picking this
repo up. The README explains *what the architecture is*; this file records
*what breaks if you ignore it*. Read both.

---

## The five gates

All five must pass before anything is pushed. They are cheap; run them.

```bash
npm run typecheck   # tsc --noEmit, strict, both workspaces
npm run lint        # eslint, --max-warnings=0
npm run test        # vitest in @patternwall/core
npm run build       # core, then a static Next.js export into apps/web/out
npm run test:e2e    # builds, serves the export, runs Playwright against it
```

`npm run dev` serves on **port 3100**. Node 18.18+, 19.8+ or 20+ (Next 15's
`engines`). Chromium for Playwright lives at `/opt/pw-browsers/chromium` —
never run `playwright install`; override with `PW_CHROMIUM` if needed.

A test that cannot fail is worse than no test. When you add a regression test,
**reintroduce the bug and watch it fail**, then restore the fix. Twice in this
repo a test was written that passed against the broken code; one was deleted
for it. Note also that `npm run test:e2e` serves the *built* export, so
reverting a source file without rebuilding proves nothing.

---

## Invariants

Break these and the product stops being coherent, usually silently.

**Generators are pure.** `(params, palette, width, height, rng) → SVG string`.
No DOM, no Node APIs, no `Math.random` anywhere in `packages/core`. Every
stochastic decision flows through the seeded `Rng`.

**One string is the source of truth.** The browser preview, the PNG export and
the Node test suite all consume the identical SVG string. `parity.spec.ts`
asserts the browser's output is byte-identical to Node's. If you find yourself
special-casing one consumer, stop.

**The SVG vocabulary is deliberately small.** Paths, basic shapes, groups,
gradients, clip paths. No `<style>`, no CSS classes, no `<filter>`, no
`foreignObject`, no `<text>`. This keeps the render path compatible with
resvg-js for when the server render service lands. `vocabulary.test.ts`
enforces it at default *and* extreme parameters. Generate noise procedurally in
geometry, never with filters.

**Renders are scale-invariant.** The same config must produce the same
*structure* at a 108px gallery thumbnail and a 1399px export, or the preview
stops being the thing you download. This is subtle: any decision derived from
pixel coordinates will differ between sizes. Key such decisions on **grid
indices**, never pixels. `determinism.test.ts` catches it — it already caught
one real regression where arcs were dropped by a pixel-keyed hash.

**Palettes are consumed through the interface.** `palette.background`,
`palette.ink`, `accent(palette, i)`. Never assume a colour count. Retrofitting
this across many generators later is miserable.

**Params are positional in the share URL.** `share.ts` packs them by index into
`q`. **Append new params to the end of a generator's `params` array** — inserting
in the middle silently reinterprets every existing link. Old links with fewer
values decode correctly and surface a note.

---

## Deployment

GitHub Pages, via `.github/workflows/pages.yml`, on push to `main`.

Settings that are load-bearing, each of which has already cost time:

- **Pages Source must be "GitHub Actions"**, not "Deploy from a branch". On
  branch mode, Pages serves the repo root through Jekyll — which publishes the
  README as the site and 404s everything else.
- **`main` must be the repository's default branch.** The `github-pages`
  environment would not promote deployments from a non-default branch, while
  still reporting the deploy job as successful. Green deploy, unchanged site,
  no error anywhere. This was the single hardest thing to diagnose in this
  repo's history.
- **`PATTERNWALL_BASE_PATH`** is set by the workflow from the repo name, because
  a project site serves from `/<repo>/` and Next bakes asset URLs in at build
  time. Leave it unset locally, for a custom domain, or for a user root site.
- **`trailingSlash`** is on so routes export as `p/<id>/index.html`, which
  resolves on every static host rather than only those doing extensionless
  lookup.
- **`.nojekyll`** is written by the workflow. Without it Pages refuses to serve
  the `_next` directory at all.

**Confirm before claiming.** After pushing, poll the workflow run and report
one of: *deployed* (both build and deploy jobs `success`, with run number and
commit), *failed* (which job, and what you're doing about it), or *pushed, not
deployed*. Never say "deploying" as a stand-in for "I pushed and assume it
worked" — that is how the default-branch bug stayed hidden through three
apparently-successful deploys.

Note the limit of that confirmation: a green run means GitHub accepted the
deployment, not that the served page changed. The footer build stamp
(`SiteFooter.tsx`, baked in by `next.config.mjs`) exists precisely to close
that gap — it shows the build time in the reader's timezone plus the short
commit, so the page can answer "am I current?" itself.

Debugging what is actually served: `curl -sSI` a file that only the new build
produces. `age: 0` with `x-cache: MISS` proves the response came from origin
rather than cache, which separates a stale CDN from a genuine deploy failure.
A query string is **not** a reliable cache-buster on Pages.

---

## Adding a generator

See the README for the walkthrough. In short: implement the `Generator`
interface, register it in `packages/core/src/generators/index.ts`, and write the
`description` as real prose — 3–5 paragraphs explaining the algorithm and why
the parameter choices were made. The writing is a deliverable, not filler; it
is the reason someone browses rather than bounces.

Portrait-first and composition-aware: tune for 9:19.5 rather than scaling a
landscape design, keep the clock zone quiet, and push detail and contrast into
the lower ~40% where iOS does not cover it.

Look at the output. `npm run samples <dir>` rasterises every generator; open the
PNGs. A generator that renders muddy or empty at some palettes is not done.

---

## Bugs worth not repeating

Four real ones from this repo, each of which looked like a design choice:

**The SVG arc sweep flag.** Two circles of a given radius pass through any two
points; the sweep flag picks which. Truchet's quarter arcs used sweep `1`, which
centred them on the cell's middle instead of its corner. The marks still met at
edge midpoints so the tiling looked plausible, but no arc was ever centred on a
grid vertex and no loop, half circle or full circle could form at any density or
seed. Probe geometry by rasterising and testing a pixel rather than reasoning
about flags.

**Per-element vs per-mark decisions.** The same generator's "open ends" control
dropped each concentric arc independently, which shredded ribbons into fragments
instead of making paths terminate. Ask what the *visual unit* is before applying
a probabilistic rule to it.

**Stale closures around React state.** Selects and switches fire `onChange` and
`onCommit` in the same event, before React re-renders. A commit reading the
state variable settles the value the control just replaced. Params flow through
`applyParams`, which writes a ref synchronously before `setState`.

**Sliders that reshuffle everything.** Controls whose decisions draw from the
seeded stream reorder every later draw, so nudging one slider changes the whole
image. Where a control should modify a pattern rather than replace it, derive
its decisions from a hash of position instead.

---

## Conventions

Develop on a feature branch; `main` is what deploys. End commit messages with
the attribution lines the session provides. Do not put model names anywhere in
the repo — commit messages, code comments, or UI.

Commit in logical increments, one concern per commit. Write commit bodies that
explain *why*, including what was ruled out; several in this history are the
only record of a subtle diagnosis.

Be accurate about uncertainty in user-facing copy. `/setup` documents an Apple
Shortcuts recipe and marks each label as either confirmed against Apple's
documentation or community-sourced, because `support.apple.com` is unreachable
from this build environment. Do not quietly upgrade a guess to a fact.

---

## Current state

Four generators: `flow-dots`, `truchet`, `phyllotaxis`, `ridgelines`. Three
taxonomy tags — `isometric`, `distortion`, `physics` — have no patterns yet.
Client-only: no server rendering, no database, no accounts. The render service,
short config IDs and per-config iCloud shortcuts are the next phase.

Known weak points are listed at the end of the README. The main ones: rendering
is synchronous on the main thread, and PNG quantisation works on pixels rather
than on the palette the generator used.
