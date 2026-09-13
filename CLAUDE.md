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

## Verifying a visual change

Passing tests is not evidence that a visual change did what was asked. Four
consecutive fixes to the truchet arcs shipped green and wrong, because each was
checked by rendering the new version and looking at it alone.

**Render before and after, and compare them.** One image cannot tell you whether
anything changed. The A/B takes seconds; `npm run samples <dir>` or a short
script against `packages/core/dist` plus resvg will do it. Look at the PNGs.

**Check the symptom described, not the mechanism you built.** A colour-blend
control was added, verified to produce a smoother ramp, and shipped — while the
hard edges it was meant to remove were still there, because they were between
tiles rather than between accents. The right question is "is the thing they
pointed at gone", not "does my change work".

**Ask whether the structure can even produce the result.** Two quarter discs of
radius s/2 cover 39% of a cell; one of radius s covers 78%. No parameter was
ever going to close that gap. A minute of arithmetic beats three rounds of
tuning.

**A control that is inert in some mode is a smell.** It usually means the
mechanism does not match the thing being asked for. Twice here a knob was added
to manufacture an effect — path ends — that the tiling already produced
structurally, and each version of it broke something else: empty cells, then
unconnected edges.

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

Removing one is the same problem in reverse: everything after it shifts, so old
links misread from that slot on. Removing `mixed` from a select was safe, since
dropping the *last* option only makes a stale index fall back to the default;
removing the `rowVariation` param was not, and every truchet link made before it
now reads its values one slot out. Four more went the same way in one go —
`gap`, `subdivide`, `quietTop`, `openEnds` — knowingly, because nothing outside
this repo had links worth keeping yet. That window is closing: the moment
someone bookmarks a configuration, this stops being a free operation. If links
ever need to survive, the encoding needs a version or named keys — it has
neither today.

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

Real ones from this repo, each of which looked like a design choice:

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

**Varying what makes the tiling join.** In truchet the shared radii set is what
lets a mark meet its neighbour across an edge. Trimming it, or dropping a mark,
leaves arcs with no partner stopping at the cell boundary — a broken grid, not a
pattern. Before making something vary per cell, work out what the tiling relies
on being the same everywhere.

**What joins the arcs is that the radii set mirrors itself about s/2 — not that
it contains s/2.** This entry used to say the latter, and that cost a round of
shipped bugs, so here is the derivation. An arc meets the shared edge at its own
radius from the corner it is centred on. A cell with marks on corners 0 and 2
meets its right edge measuring from the bottom of that edge; a cell with marks
on 1 and 3 measures from the top. Where two neighbours disagree on rotation they
measure from the same end and every radius meets its twin whatever the set is.
Where they agree — half of all edges — one measures from each end, so an arc at
p can only meet an arc at s - p. Hence the mirror.

s/2 is merely the radius that is its own mirror, which is why anchoring on it
looked sufficient and is not. A set anchored on s/2 but asymmetric around it
(separate inward and outward steps) strands about two thirds of its arc ends;
one sharing a single step is symmetric only at odd counts, and strands its
outermost ring at every even one, because a set centred on s/2 that contains
s/2 must have an odd number of members. The set now used is n radii evenly
spaced and centred on s/2 without being anchored to it: `r + (j - (n-1)/2) *
step`. Odd counts include s/2, even counts straddle it, and both mirror
perfectly. Measured across a uniform grid, unpartnered arc ends go from 67% to
0%.

The test to keep is the behavioural one — no arc end left alone on an interior
cell edge — not a test that some particular radius is present.

**One mark per cell cannot tile.** A cell's mark touches only the edges it is
drawn against, so a single mark covers two of the four edge midpoints and the
other two have nothing on the far side to meet. The default render falls apart
into scattered arcs. This looked like the price of filling the cell better, and
it was not a price at all: two quarter discs of radius s/sqrt(2) cover the same
78% of a cell as one of radius s and cover all four midpoints doing it.
s/sqrt(2) is the ceiling because circles centred on opposite corners meet once
their radii sum past the diagonal.

**Growing a shape from the wrong anchor.** Arc count grew a fan outward from the
corner, so raising it replaced a mark that reached the edge with a smaller one.
A count control should add detail to a shape that keeps its size; anchor it at
the outer edge and nest inward.

**Two controls that fight.** Arc count and arc spacing were both free, so
asking for twelve arcs at a spacing that fitted eight silently dropped four, and
a stroke heavier than the spacing merged the rings into a block. Where one
quantity is implied by the others, derive it: spacing now comes from the count
and the room available, and the stroke thins to the gap rather than the gap
having to accommodate the stroke.

**Using all the room is not the same as spacing evenly, and only one of them
is visible.** The arc radii divided each side of `s/2` by its own step count, so
that the 0.207s above it and the 0.480s below it were both filled. The
arithmetic is sound and the result is wrong: every gap inward was 2.32x every
gap outward, at every count, so the rings bunched against the cell edge and
sprawled toward the corner. It shipped, and it was reported as "the divisions
don't distribute evenly" — which is exactly what it was. When a quantity is
lopsided, ask which of the two properties a person actually sees before
optimising the other. Evenness beats coverage here; the unused room near the
corner costs nothing anyone can point at.

**Where colour is sampled decides whether the blend control works, and adding
marks to a cell can break it retroactively.** Colour comes from a field across
the canvas, quantised into bands. Sample it once per tile and every mark in that
cell gets the same band, so colour can only change at a cell boundary and the
grid reads as flat blocks — and raising the blend just gives each block a finer
flat colour, which from the outside looks exactly like a broken control. The
arcs were fixed for this long ago, per arc at its own midpoint. The diagonals
and triangles still sampled per tile, which was *equivalent* while a cell held
one mark through its centre and became wrong the moment the division count
filled the cell with a family. Adding marks to a tile means revisiting where its
colour is sampled.

**A threshold picked by eye can sit on the wrong side of the bug.** The test for
the above first asserted a mean of more than 1.6 distinct colours per cell, and
passed against the broken code, which scores 1.73. It also first bucketed marks
by their endpoints, which lie on cell edges and land half of them in the
neighbour, mixing two cells' colours and making a flat tiling look resolved.
Key a mark on its own midpoint, and take the threshold from measuring both the
broken and fixed cases rather than from what sounds reasonable.

**A seam can be a ramp that is simply too short.** quietTop carries its factor
from 0.45 to 1, and it did that across a feather of 9% of the canvas. Nothing
about the curve was discontinuous — measured with the tiling's own stripes
averaged out, the ramp moved by a third of a brightness level per row — and it
still read as a hard horizontal line with the pattern pale above and saturated
below. Two plausible fixes changed nothing visible: sampling the factor per mark
instead of per tile, and easing the curve with smoothstep. Both are better
arithmetic; neither was the fault. The feather is now 30%.

Truchet no longer carries the control at all, and that is the honest end of the
story. A tiling is uniform by construction, so any factor keyed on height draws
a horizontal band across a regular grid — a wider feather makes the band softer,
not absent. The parameter survived three rounds of tuning because each round
improved the arithmetic; it did not survive the question of whether the
mechanism could produce the result. `quietFactor` stays, and the other three
generators still use it: their density genuinely varies across the canvas, so
thinning the top reads as composition rather than as a stripe.

The trap either side of that was measurement. A per-row brightness profile of a
tiling is dominated by the tiling's own periodic stripes, so its worst row-to-row
step sat at 20-30x the mean whatever was done to the ramp, and it moved in the
wrong direction for smoothstep, which deliberately steepens the middle. Average
over one cell before reading a profile, and when a metric and the picture
disagree, believe the picture: crop the region and look at it.

**Flat fills cannot blend at the scale of the shape — so shrink the shape.**
This entry used to end "continuous colour needs the paint to vary across the
canvas — a gradient — not more buckets", and the code says otherwise: truchet's
`colorBlend` is more buckets (3 distinct stroke colours at 0, 18 at 0.5, 31 at
1, measured) and it works. The gradient was tried and reverted; a comment
describing it survived in the source for a while afterwards, which is its own
lesson.

What was actually wrong was the *unit* being filled, not the number of steps.
Colour was sampled once per tile, so a whole cell was one flat colour and the
grid boundary showed as an edge however finely the ramp was resolved — that is
the case the original note was written from, and for that case it is right.
Sampling per mark, at each mark's own midpoint, makes the flat unit small
enough that quantising it stops being visible, and then more buckets is exactly
what helps. Both halves matter: per-mark sampling with three buckets still
bands, and 31 buckets sampled per tile still shows the grid.

So the question to ask is "how big is the area I am painting one colour", not
"how many colours have I got".

**One hash cannot be both an identity and a value — `hashSeed` was.** FNV-1a
ends on a multiply, so two strings differing only in their final character land
0.014 of the range apart and fall the same side of any threshold 98.7% of the
time. Salting one key per item is the obvious way to ask a hash for several
independent decisions, and it silently returns one decision for the group.
Truchet's removed `openEnds` relied on that accident without knowing it.

The same function also seeded every render, via `seedToInt`, which is the
identity of every saved wallpaper. So fixing it looked like it meant repainting
everything. It did not, and the measurement is the reason: mulberry32 avalanches
its own seed, so the clustering does not survive into the stream — across 2000
last-character pairs the first `next()` from each lands 0.337 apart, against
0.331 for unrelated seeds and 1/3 for uniform ones. The flaw was invisible in
the job that could not change and fatal in the job that had no callers.

They are now two functions. `seedHash` is bare FNV-1a, frozen, one caller
(`seedToInt`), named for what it is rather than for what to use. `hashSeed` is
that plus murmur3's finalising mix, for bits you read directly — the same pairs
now split 52.2%. Renders are byte-identical. Routing `seedToInt` back through
`hashSeed` fails a test that pins three known seeds, and takes a phyllotaxis
scale-invariance test and a truchet colour test down with it, which is roughly
the blast radius you would expect from changing every seed in the app.

The general lesson is the reusable part: before judging a hash, ask which of its
uses reads the bits and which only seeds with them. Those want different things,
and one function cannot be frozen and improvable at once.

**A comment can be the last surviving copy of a reverted design.** The arcs
branch carried four layers of commentary from successive attempts, two of them
describing code that had been reverted and contradicting the layer below. Each
was true when written. Prose near a change is part of the change: when you
revert, revert what explains it too, and when you read a comment as evidence,
check it against the code.

---

## Truchet, as settled

Most of this session went into this one generator, and the rules below are the
result. Each was arrived at by breaking it first.

- **Two marks per cell**, on opposite corners, chosen by rotation parity. Not
  one: see the coverage note above.
- **Radii centred on `s/2`**, reaching a ceiling of `s/sqrt(2)` outward and the
  same distance inward. Not anchored on `s/2`: see the mirror rule below.
- **`n` radii, evenly spaced, centred on `s/2` and reaching the ceiling** —
  `r + (j - (n-1)/2) * step`, with `step` set by the outward room. Even spacing
  because unevenly spaced concentric rings is the one fault nobody can miss;
  centred rather than anchored because the mirror about `s/2` is what makes them
  join, and only a centred set mirrors at even counts too. Both sets are
  identical in every cell, which is the rest of what the joining needs.
- **Spacing is derived**, not set: the room available divided by the steps
  needed, so every arc the count asks for fits. The stroke thins to the gap
  rather than the gap accommodating the stroke.
- **Sweep flag 0** on every arc, so each is centred on its corner.
- **Colour comes from a noise field** in normalised canvas coordinates
  (`COLOR_FIELD` cycles across the image), sampled **per arc at its own
  midpoint** — per tile gives every arc in a cell one step of the ramp and the
  cell boundary shows as an edge. `colorBlend` is the ramp's resolution.
- **Ends are structural.** They come from neighbours facing different corners,
  not from a probability knob. Three attempts to manufacture them each broke
  something else.

- **Diagonals tile at `s/n` and nothing else.** Arc count applies to this set
  too: the corner-to-corner line becomes a family of parallel chords. A chord
  offset by `k*(s/n)` crosses every edge at a multiple of `s/n` from the
  corner, and both rotations put their crossings on that same lattice, so
  every chord meets a partner across every edge — 0% of interior crossings go
  unpartnered on a uniform grid, against 49% for the arcs. Spread is
  deliberately *not* wired in: truncating the family to the chords nearest the
  diagonal leaves a cell crossing its right edge near one corner and its left
  edge near the other, so same-rotation neighbours miss each other entirely
  below half width and 62% of crossings stop dead along the boundary. The
  extent is not free — it is fixed by the lattice that makes the family join.
  The one thing that used to break this was subdivision, whose quartered cells
  drew at half the spacing so only every second crossing met a full-size
  neighbour; with it gone every cell is the same size and the lattice holds
  everywhere.

- **Triangles divide on that same lattice.** Every rotation lists its
  right-angle corner first, so scaling about that vertex sweeps the hypotenuse
  across the cell and a slice at `k/n` lands on the chord `k*(s/n)`. Fill every
  other band, counting down from the hypotenuse, and the mass becomes ribbons
  that continue through the grid: across interior cell edges the ink agrees
  with the neighbour more often than the solid tile manages (37% of samples
  disagree at three divisions, against 52% solid). Filling every band instead
  just reassembles the triangle. `weight` is still inert on this set — it has
  no stroke — which is the one remaining dead control in truchet.

Controls: density, tileSet, weight (no effect on triangles), colorSpread,
arcCount (labelled Divisions; governs all three tile sets), arcSpacing (spread;
quarter arcs only), colorBlend. Removed as not worth their slots: `mixed`, row
weight variation, `gap`, `subdivide`, `quietTop` and `openEnds`. The last four
went together and each had the same shape of problem — a knob whose effect was
either invisible (`gap`), a band across a uniform grid (`quietTop`), a patch
that broke the lattice it sat in (`subdivide`), or an effect the tiling already
produced structurally (`openEnds`). Every stroke is now one width and fully
opaque, and the triangles fill at a flat 0.9.

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
Truchet is by far the most worked over; the other three have had almost no
iteration and should be assumed rougher rather than better.
Client-only: no server rendering, no database, no accounts. The render service,
short config IDs and per-config iCloud shortcuts are the next phase.

Known weak points are listed at the end of the README. The main ones: rendering
is synchronous on the main thread, and PNG quantisation works on pixels rather
than on the palette the generator used.

One unresolved intermittent: `quality.spec.ts`'s "nothing is written to the
console" test has twice failed with React error #418, a text hydration
mismatch, and has not been reproducible since. The note on that test records
what was ruled out. Both sightings were during unrelated work, so do not assume
your change caused it — check the note before spending an afternoon on it.
