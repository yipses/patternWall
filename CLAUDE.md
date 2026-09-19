# Working on PatternWall

Conventions and hard-won specifics for anyone — human or agent — picking this
repo up. The README explains *what the architecture is*; this file records
*what breaks if you ignore it*. Read both.

---

## The five gates

All five must pass before anything is pushed. They are cheap; run them.

They are necessary and they are not sufficient. Green gates say the code builds
and the assertions hold; they say nothing about whether the picture changed the
way somebody asked for. For anything that alters a render, the gates are step
zero and the procedure under **Verifying a visual change** is the rest.

```bash
npm run typecheck   # tsc --noEmit, strict, both workspaces
npm run lint        # eslint, --max-warnings=0
npm run test        # vitest in @patternwall/core
npm run build       # core, then a static Next.js export into apps/web/out
npm run test:e2e    # builds, serves the export, runs Playwright against it
```

Two more, neither a gate. `npm run check:stamp` asserts the built export
carries one build stamp rather than two that usually agree; it needs no browser
and the Pages workflow runs it after `npm run build`, because it is about the
artifact that gets published and the workflow deliberately does not run e2e.
`npm run shots` drives a running site and saves screenshots — it needs a server
up (`npm run dev`, port 3100) and it now fails on a 404 rather than
photographing the "no pattern here" page, which it did for ten of its thirteen
shots for a while after four generators were retired.

`npm run dev` serves on **port 3100**. Node 18.18+, 19.8+ or 20+ (Next 15's
`engines`). Chromium for Playwright lives at `/opt/pw-browsers/chromium` —
never run `playwright install`; override with `PW_CHROMIUM` if needed.

A test that cannot fail is worse than no test. When you add a regression test,
**reintroduce the bug and watch it fail**, then restore the fix. Twice in this
repo a test was written that passed against the broken code; one was deleted
for it. Note also that `npm run test:e2e` serves the *built* export, so
reverting a source file without rebuilding proves nothing.

**A test written as "the property is on" against a default that is already off
is `x === x`.** The roughness guard asserted `render({ roughness: 0 })` equals
`render({})`, presented as the strictly-additive check this section asks for.
Roughness defaults to 0, so both sides were the identical params bag through a
pure function and nothing could fail it — flooring the amplitude so every
default render is crenulated left it green, while the suite's own instrument
read the difference. It pins a byte length now. Before writing an assertion
about a control being off, check that the two sides differ in something.

**Watching it fail is necessary and not sufficient.** A test written as "the
property my change produces" fails against the old code by construction: that
proves it is sensitive to the change, not that the change is right. Before
writing the assertion, ask whether you could have written it from the design
rule *before* choosing the fix. If it only makes sense once you know the
implementation, it is a description, not a guard. A triangles change shipped
with "ink holds as the division count rises", which was the change restated; it
failed against the old code exactly as this section asks, and it destroyed the
pattern. The guard it needed — dividing mass into ribbons removes ink — was
available before a line was written.

**Prefer a fix that is strictly additive, and prove it with hashes.** Where a
change can leave every existing render byte-identical and move only the broken
range, write it that way and check it over a matrix of configs. Truchet's
stroke ceiling was fixed twice: the first reinterpreted the control and thinned
every divided render by 43%, the second scaled only the ceiling above the
default and is identical across 192 configs below it. The second needed no
opinion about which looked better.

---

## Verifying a visual change

Passing tests is not evidence that a visual change did what was asked. Four
consecutive fixes to the truchet arcs shipped green and wrong, because each was
checked by rendering the new version and looking at it alone.

### The procedure

Everything below this heading was already written down as principles, and a day
was still lost skipping them, because a list of principles is not a procedure.
So: **do these in order, and do not call a visual fix done until step 8.** Step
7 is the one that gets skipped, and it is the one that costs.

1. **Get the reporter's exact config — ask for the share URL.** It carries every
   parameter, the ones behind the gear included. Three diagnoses in one day were
   made against a config reconstructed from a screenshot; none of them was
   theirs, and one URL ended it. Guessing at `weight` and `colorSpread` is not a
   cheaper version of asking.

2. **Reproduce the fault before theorising.** Render their config and look for
   what they described. If it is not there, you do not have their config, their
   renderer, or their fault — establish which. A clean render of the *right*
   thing is a stop signal. Going off to find something that merely looks similar
   is how a whole turn went into fixing triangles for a report about diagonals.

3. **Validate the instrument before you trust it.** Five metrics were built in
   one day and five were confounded: one-sided seam samples reward a render for
   being empty, normalising them rewards thickness, a chord detector sampled
   rotations that were never drawn, a canvas model could not reproduce the bug it
   modelled, and a variety proxy returned 1 for every input. Before believing a
   number, run it against a known-broken case and a known-good one and check it
   separates them. If it cannot see the fault you can see, it is not measuring
   the fault.

4. **Check the tree and rebuild.** Scripts read `dist`; vitest reads `src`. A
   crashed helper once left a constant modified in the working tree, so a
   "before" comparison ran against neither the old nor the new value. `git
   status` and `git diff` against HEAD before measuring, and rebuild first.

5. **Render before and after, at the corners of the parameter space.** Not the
   middle, and not only the config you happen to be holding. Low and high
   density against low and high divisions, light palette and dark.

6. **Ask what the number is being compared against.** A metric that matches a
   baseline proves nothing if the baseline was never itself checked against a
   render. Every division count read "15.2%, the same as the odd counts" and was
   called fixed; the odd counts were broken too, and nobody had looked.

7. **Look at the final built version, at the reported config.** Not the metric —
   the picture. This is the step that was skipped most and cost the most.

8. **Watch the regression test fail.** Reintroduce the fault, confirm the test
   catches it, restore. A test that has never failed is a description.

If a fix makes the reported fault better without ending it, that is evidence of
a second cause, not of tuning left to do. Three separate causes sat under one
"swipe doesn't register" report, and the gaps in truchet's lines were two faults
in two tile sets that looked identical from outside.

### Why each of those exists

**Render before and after, and compare them.** One image cannot tell you whether
anything changed. The A/B takes seconds; `npm run samples <dir>` or a short
script against `packages/core/dist` plus resvg will do it. Look at the PNGs.

**Render the corner of the parameter space, not the middle.** Defaults are
where a change is least likely to show. Controls that add detail multiply:
truchet's density and divisions together turn a legible tiling into grey noise
long before either is extreme alone. Render low and high density against low
and high count, on a light palette as well as a dark one — a dark ground hides
ink a paper one shows. A triangles change was measured and eyeballed at five to
eight columns, looked plainly better, and was reported as "a lot worse" from
fourteen.

**Reproduce the reporter's exact config before diagnosing.** Two reports in a
row here were a stored parameter, not a fault in the code — a `weight` dragged
near its minimum and then hidden behind the gear. One render settles what
reasoning about the geometry will not.

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

**resvg and headless Chromium both composite exactly, and a real browser may
not.** Two shapes that share an edge come out seamless in both of the renderers
available here; in Safari the same document drew every line dashed, because two
antialiased edges at 50% coverage composite to 75% and the paper shows through.
So a fault that reproduces in neither is not thereby disproved — ask which
browser, and on which device. It took a day to ask, and the answer was one word.

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
this repo had links worth keeping yet. Contours' `relief` then went the same way
for the same reason, shifting the seven params after it, and then `grain` and
`incision` together — slots 7 and 8 of fourteen, shifting the six after them —
on the explicit word that nothing had been shared yet. Cutting the two in one
go rather than one at a time is the only part of that worth copying: two
removals are two shifts, and a link survives neither. That window is closing:
the moment someone bookmarks a configuration, this stops being a free operation.
If links ever need to survive, the encoding needs a version or named keys — it
has neither today.

**Narrowing a param's range is the quiet version of the same thing, and it can
also disarm a test.** Lowering a maximum does not shift any slot, so links keep
decoding — but `coerceParams` clamps, so every stored value above the new
ceiling silently becomes the ceiling, and any default above it has to move with
it. Contours' `grain` and `incision` defaults both sat above their new maxima
and were pinned down to them. (Both are gone now — see the entry on the sign
error below — but the lesson about the test is the same either way.)

The part worth remembering is what it did to a test. The crowding test asserts
that a heavy pen thins rather than blots, and it was calibrated at `weight` 3,
where the thinner takes mean ink from 0.229 to 0.110 and a bound between those
is comfortable. Clamping the slider to 2 moved the same test onto a case where
the mechanism only takes 0.165 to 0.116 — both under the old bounds of 0.17 and
0.55 — so the assertion went on passing with the thinner deleted outright. No
line of the test changed; its extreme did. When you narrow a range, re-run every
test that was calibrated at the old end of it against the bug it was written to
catch, because a test whose extreme has moved is a test that may no longer have
one.

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

**A stamped scratch array is only safe if the loop order matches what it is
stamped by.** Contours chains marching-squares fragments into whole curves, and
the first version held the per-level graph in arrays indexed by grid edge,
reusing them across levels with a level stamp instead of clearing them. The
outer loop is cells and the inner loop is levels, so by the time a level was
traced, every edge it shared with a later level had had its adjacency
overwritten — the state was stamped per level while the traversal that filled it
ran per cell.

It looked fine. An edge is usually crossed by only one height, because its two
corners rarely span more than one, so at the default settings the conflict
almost never arose and the map rendered correctly. In rough country at sixty
levels a single edge is crossed many times over, and there the contours
shattered into 28,319 two-point fragments. The test caught it at the extreme
setting and nowhere else, which is the argument for running that test at an
extreme at all. Keying the graph by (level, edge) instead costs a map lookup and
cannot go wrong.

**Fractal noise does not use its nominal range, so anything reading a height as a fraction of 0..1 reads mostly empty air.** Contours took its levels and its sea level as fractions of 0..1. Measured, the raw field ran 0.337 to 0.695 at the defaults — barely a third of that range — so of twenty-two contour lines, eight drew and fourteen fell outside the terrain entirely, and the sea level default of 0.32 sat below the lowest ground on the map. Neither looked broken from outside: the map simply came out about a third as fine as the number claimed, and the water slider did nothing at all until two thirds of its travel. The field is now stretched to its own range before any height is read off it. The general form: a control expressed as a fraction of a field's *possible* values is a different control from one expressed as a fraction of its *actual* ones, and fBm makes the gap large.

**A test asking a question about lines must not be shown the fills.** The contours curve test asserts no run of `L` commands survives, which is exactly right for a traced contour and exactly wrong for the water, which is a filled region built from straight-edged cell polygons by construction. Adding the water failed the test against correct output. The fix is to scope the assertion to the `<g fill="none">` groups rather than the whole document — the same care the truchet colour test needed about keying a mark on its own midpoint. When new output joins a document, check what the existing assertions think they are looking at.

**Work out the cell budget before choosing how to fill a region, not after.** The elevation tint was built twice on the assumption that a band per contour was the thing to make, and the arithmetic rules it out at a glance: at fourteen levels the bands are 0.071 of the field apart, which is about what the field moves across one grid cell, so essentially every cell straddles a boundary — 16,438 of 17,550, measured. Nested sub-level fills took the document from 258kB to 692kB, and classifying cells instead, which was supposed to be the optimisation, made it 995kB, because the uniform interiors it merges into runs did not exist. The fix was not a better fill; it was noticing that a printed atlas does not tint per contour either. A wash keyed to a much coarser derived interval — about six steps, always a whole number of contour intervals so its boundaries are lines the map already draws — is both the cartography and the cost. Filling a region is a question about how many cells are interior, and that is one division.

**Counting the steps in a ramp does not tell you the ramp is visible.** The first tint that was cheap enough rendered seven distinct shades, all within four luminance units of the background, because a constant mix against a near-black paper stays near-black. A test asserting five or more distinct fills passed it happily. The measure that matters is the spread — 24 to 40 units across the palettes once the mix deepens with height and pushes lightness away from the background — not how many values there are. This is the same fault as the truchet colour-blend note from the other side: there the flat *unit* was too big, here the flat *range* was too small, and in both cases the step count was the reassuring number that said nothing.

**A picture of the new thing at full strength is not an A/B of the default.** Having built the tint, it was rendered at 1.0, compared against an untinted render, and called done — while the shipping default of 0.65 had never been put next to anything. The rule in this file says render before and after; the version you are shipping is the one that has to be in the pair.

**Check the mark, not the construction that produces it.** Depression ticks point downhill, and which way that is came from the sign of the ring's shoelace area — right about the ring as a whole and wrong here and there along it, because at a tight kink the chord between a point's neighbours runs backwards against the local tangent. Two ticks in forty-four came out pointing uphill. No amount of care with the winding fixes that class of thing; sampling the field at the tick's own far end and dropping the mark if it is not lower does, in one line. When a mark makes a claim, test the claim at the mark.

**A check that subsumes another does not make the other redundant — measure before deleting it.** With every tick validated against the field, removing the per-ring vote that decides *whether* a ring is a hollow changed nothing the tests could see, which looked like proof the vote was dead. It is not: without it, summit rings pick up two or three stray ticks where a kink happens to face a local dip, and a scattering of ticks on a hill is exactly the error the convention exists to prevent. It showed up as the emptiest ticked ring filling 0.23 of its tick slots against 0.74 with the vote in place. The test that was passing against the bug was asking about direction; the fault was about density.

**`createRng` takes a number, and a string silently becomes seed 0.** It is
typed `seed: number`, so real code is safe — but a scratch `.mjs` script is not
typechecked, and `createRng('delta-631')` coerces to 0 without complaining. Four
renders at four different seeds therefore came out byte-identical, and that was
about to be reported as "the seed does nothing on triangles" before the rng was
tested on its own. Scripts want `renderToSvg({ seed })`, which converts the
string, or `seedToInt` first. The general form is the instrument rule again:
when a measurement says a control does nothing at all, test the control's own
input before the code it feeds.

**Test files import `src`, not `dist`.** Twice in one session a measurement script gave results that contradicted the arithmetic, because the script imports `packages/core/dist` and the last thing built there was a deliberately broken version from a bug injection. Vitest resolves the TypeScript directly, so tests are never stale this way and scripts always are. Rebuild before measuring, or read the number twice and believe neither.

**Past a point a quantity stops being the lever, and thinning a stroke is the usual way to find that out.** Contours crowd into a solid mass at high line counts, and the obvious fix — thin the stroke to the gap, which is the rule the truchet arcs settled on — moves almost nothing at default weight: sixteen lines through sixteen pixels is solid at any width, and measured, mean ink went 0.175 to 0.170. It is not a useless mechanism; it is the right answer to a different cause, and at weight 3 it takes 0.447 to 0.242. The lever that moves the real case is the interval, which is also what a printed sheet changes — steep ground carries fewer contours. The general form: when a fix barely moves the measurement, ask which cause it addresses rather than how to tune it, and check whether the thing you are varying has the range the problem needs.

**Measure the mechanisms separately and keep the ones that earn it.** Having built both the thinner and the decimator it would have been easy to keep whichever was written last, or both without asking. The four-way table settles it in one run: neither 0.175/0.447, thin only 0.170/0.242, drop only 0.102/0.229, both 0.099/0.107. Each covers a case the other leaves broken, so both stay — and that is a measured answer rather than a preference.

**An element's structure is a contract the tests read.** Contours were briefly emitted as one group per level *per width bucket*, which says there are six times as many contours as there are — to a reader and to the level-count test, which counts groups. Putting stroke-width on the path and keeping one group per level fixes both. The same test had already been inflated to 17 groups for 13 levels when depression ticks arrived, because those are `fill="none"` groups too, and it broke again when supplementary lines became a third kind that is butt-capped like a tick and dashed like nothing else. Every time a new kind of mark joins the document, the tests that classify marks need the new kind spelled out, or they quietly count the wrong thing.

**Which builtins are exactly specified matters wherever arithmetic feeds a decision rather than a coordinate.** Every other pattern here turns a float into a coordinate and rounds it for output, so a difference in the last bit disappears. String art's old greedy solver fed its arithmetic straight back into a choice — the best chord wins, and two engines disagreeing about one chord's length by an ULP pick different chords and share nothing from there. `Math.sqrt` is pinned exactly by IEEE-754; `Math.hypot`, `Math.pow`, `Math.cos` and `Math.sin` are all explicitly implementation-approximated.

That solver is gone, but the rule outlived it and the rebuild is held to it: thresholds come from a histogram walk, contour crossings from linear interpolation, and the nested tone fractions from repeated halving rather than `Math.pow`, because every one of those numbers decides something rather than merely positioning it. Sines and cosines appear only in the seeded stand-in subject, where they set a field value and no comparison reads them.

The honest footnote, kept because it was never resolved. `parity.spec.ts` failed once on the old string-art — browser and Node disagreeing on the rendered length — and passed after three changes. Each was then reverted on its own and parity passed every time, so **none of the three individually explained the failure and it never reproduced.** The hypothesis that fitted was JIT tiering: an approximated builtin can have different fast and slow paths, the solve ran 1,800 iterations and got hot partway through, and where that happens differs between runtimes. If something like it reappears, capture both strings and find the first difference rather than re-guessing which builtin it was.

**Measure a reduction against something that has the detail you are worried about losing.** The string-art grid was set at 48x48 on a measurement that showed quality plateauing by 64 — and the target it was measured against was a face built from a handful of Gaussians, which is low-frequency by construction. A coarse grid caught all of it because there was nothing else to catch, and the number said 96% of full quality for 3% of the bytes. Re-measured against a target carrying detail at several scales, the stored resolution kept paying well past 64: 0.727 at 48, 0.755 at 128. The reduction had looked free because the test image had already done the reducing.

Those correlation numbers belonged to the greedy solver and went with it. The grid is still adjustable and still the thing a link carries, and what reads it now is a blur and a set of quantile thresholds, which wants stored resolution for a different reason: an outline traced from a coarse grid is a smooth curve with the small features already gone, and no amount of tracing puts them back.

**Subpaths of one `<path>` do not composite with each other, and a medium made of overlap cannot survive that.** String art draws a winding of two thousand chords, and the first version drew it as a single path — because a wound board really is one continuous thread, and saying so in the drawing cost two thousand elements less. It also made the picture impossible. SVG strokes a path as one shape and *then* applies its opacity, so where the path crosses itself it does not accumulate: ten overlapping strokes at 30% render at 178 on a 0-255 scale against 179 for a single stroke, where ten separate elements give 8.

Tone in string art is made of crossings — a region is dark because forty threads went through it, not because those threads are darker. With one path, tone could only come from how much *area* was covered, which saturates almost at once, and every render came out one flat grey with a hint of a face in it. As separate elements the same solve went from 0.69 correlation with its target to 0.85. The generator emits one `<line>` per chord and costs a few hundred kilobytes for it, which is the right trade and was never a choice worth making the other way. It survived the rebuild unchanged and for the same reason: whatever chooses the chords, a shaded region is still a stack of overlapping strokes.

Worth noticing how long it hid: the test suite was green throughout, and one of the tests *asserted the bug* — "the whole winding is one continuous path", written approvingly, with a comment about how elegant it was. The replacement asserts the property the medium actually needs, that the darkest point of a render is several threads deep rather than one.

**A model of the paint and the paint have to agree, and alpha is not linear.** String art's solver subtracted a fixed ink per pass, so N passes over a cell meant N times the ink; paint leaves 1-(1-a)^N, which is always less. A thread drawn at exactly its budgeted worth therefore arrived lighter than the picture asked for — measured, mean darkness 0.686 against a target of 0.783, corrected to 0.814 by drawing at 1.4 times the budget.

No code holds that compensation any more, because nothing here keeps a running model of what it has already painted. It is recorded because the next thing that does will need it, and because the correction spent a while as a fudge factor before anybody worked out what it was compensating for.

**A palette's mid accent cannot carry a tonal medium.** Full coverage of one thread colour is the darkest a string-art render can go, and across the curated palettes `ink` carries two to three times the contrast against the paper that the middle of the accent ramp does — 15.7 against 6.8 on Paper. Anything whose whole job is reproducing a photograph's range should be drawn in the ink and tinted toward the accent, not the other way round. The rebuild keeps that and gives it something to do: each tone is mixed a different distance toward the ink, so the deepest is nearly all of it and the shallowest keeps most of its accent, which is what the white and the gold are doing on a real two-thread board.

**A pattern cannot make a thing it has no representation of, and tuning will never reveal that.** String art was built as a greedy tonal solver: nails at uniform angles around a circular rim, two thousand chords chosen by which one covered the most remaining darkness. It was measured, corrected, and shipped, and it was never going to make the pictures it was asked for. Every reference anyone reaches for when they say "string art" — the helmet, the mask, the letterforms — is built the other way round: nails driven along the subject's *outlines*, internal features included, and thread wound inside each bounded region to shade it. The nails carry the drawing and the thread carries only tone.

The solver had no representation of an edge at any point in it. It knew how dark a point was, and nothing else, so the only thing it could produce was a soft average of the target — and because a chord runs the full width of the disc, buying darkness in one place meant accepting ink everywhere else along it. Four rounds went into the picture quality; not one of them could have helped, because "make the edges crisp" was not a request the data structure could hear. The tell was there in the reported symptom: the complaint was never "the tone is off", it was that the result did not look like the thing.

This is the same shape as the truchet `quietTop` entry above and the contours cell-budget one, and it is the most expensive version of it in this repo. Before tuning a mechanism, name the thing being asked for and find where it is represented. If you cannot point at it, no parameter is going to produce it. The rebuilt version traces thresholds with marching squares, drives nails along the rings at a fixed spacing, and winds star polygons inside them; it also renders in about 30ms against the solver's 1,000, because outlines are a description and a search is a search.

**Two controls that fight, again — and the second time it was reach against density.** The rebuild gave each region two free quantities: how far in the star-polygon families reach, and how many families are wound inside that reach. A fixed chord budget was spent by widening the stride between families until it fitted. So raising `shading` raised the reach, which spread the same budget over more area: at 1 a render carried 1,539 chords in visibly separated bands where 0.55 carried 1,653. The control ran backwards, and every individual line of it was correct.

The truchet entry says to derive the implied quantity. The extra step here is picking *which* one, and the rule that settles it is the one from the arc-spacing note: ask which property a person actually sees. Nobody looks at a board and reads off how far in the families reach; they see how much thread is on it. So reach is fixed by the tone and `shading` buys passes within it, and the budget is spent by thinning every region together rather than by stretching anything. A budget applied to the wrong one of two coupled quantities is indistinguishable from a broken control.

**A budget enforced by a rounded-down divisor is not a budget.** The stride between families is the reach divided by the passes afforded, and rounding it down overshoots: a reach of 44 with fifteen passes gives a stride of two and twenty-one families, 40% over. Measured across a render it put 7,895 chords against a ceiling of 6,000. Rounding up gives back at most one family per shape and makes the ceiling true. Any time a count is enforced by dividing to get a step, the rounding direction is the difference between a cap and a suggestion.

**A line drawing and a photograph are not the same kind of input, and no measurement of the pixels tells you which you have.** The rebuilt string art shades what is dark, which is right for a photograph and exactly inverted for a drawing: there the dark is the *boundary*, and a stroke two cells wide traces into a ribbon with no interior, so every chord leaves it immediately and is dropped. The render came out as crisp outlines with nothing in them, and raising `shading` did nothing at all, because the shading had nowhere to go. It was reported as "it just seems to do the outlines", which is precisely what it was.

Inverting the field puts the cells of the drawing above the threshold and the strokes below it, and everything downstream works unchanged. Which of the two a picture is cannot be derived — a heavy drawing and a high-contrast photograph have much the same histogram — so it is a control rather than a detection, and the wrong setting fails visibly rather than subtly, which is the right way round.

Two things had to move with it, and both are the same lesson in different clothes:

**A quantile of area cannot find the gap between two spikes.** Thresholds are taken by quantile, which is what makes an arbitrary photograph work — see the contours entry about fractions of a field's possible range versus its actual one. A drawing's histogram is not a distribution, it is two spikes with nothing between them, so the quantile lands *inside* whichever spike holds that fraction: at the default coverage it put the threshold 0.2% below the top of the range. Every blurred stroke then read as an eight-cell gap instead of a two-cell one and the drawing's largest cell kept five of its 448 chords. For two spikes the meaningful threshold is a level, not an area. The general form: a quantile asks "how much", and when the answer is "almost all of it or almost none", that is not the question.

**Ask what the mark is, not how much of the chord is wrong.** The chord test was "every sample inside", which bridged nothing and also filled nothing in a drawing, since almost every long chord clips a line. Loosening it to "most samples inside" is the obvious next move and it is still the wrong question, because it is about the total: a short chord crosses less than a long one, so the small cells filled and the big ones stayed empty. What separates a thread passing *over* a mark from one *spanning* a gap is the longest unbroken excursion, and the width that divides them needs no constant — the nail spacing is already the finest thing the board resolves, widened by the blur radius, because a gap `simplify` manufactured is not a gap in the drawing. Measured, that took the big cell from 26 of 450 chords to 170.

Both of those were found by instrumenting rather than by reasoning. Three plausible diagnoses were tried and shipped nothing; dumping per-ring counts found it in one run.

**The flat-unit rule applies to every mark, and the arcs were the one that never got it.** Truchet's chords have been cut into pieces for colour since the fault was found on them — no piece carries one colour across more than 6% of the canvas width. The arcs were not, and one colour per arc is one colour across `(pi/2)*rho` of the canvas with rho reaching `s/sqrt(2)`: at five columns a single arc carries one colour across 18.5% of the width, three times the rule the chords hold to. Two arcs meeting at a cell edge then sample a whole cell apart, and a ribbon running through the grid changes hue in a hard vertical line at the join.

It was reported at full colour blend, and that is where it *shows* rather than where it starts — a fine ramp makes the step a different colour where a coarse one lands on a neighbouring shade. The blend slider was in effect a control for how visible this bug was, which is a fair sign it was carrying weight that belonged to a fix. It is gone; the ramp is always full.

Two details worth keeping. The cut points are a **hard-coded table of sin and cos**, because this file calls no trigonometry anywhere and that is deliberate: each piece is coloured by the field at its own midpoint, so those coordinates feed a *decision* about which band it lands in, and `Math.cos` is implementation-approximated where `sqrt` is not. And the undivided case still emits the exact string it always emitted, sampled at the same 45-degree point — past about nineteen columns an arc is already shorter than the rule allows, which is also the grid where the render is heaviest and quadrupling the mark count would hurt most.

Measured at full blend, worst colour step between two arc ends that touch, before and after: 227.7 to 62.7 at three columns, 140.3 to 66.6 at five, 114.6 to 48.9 at eight, and 66.6 to 66.6 at twenty where nothing is cut. That 66.6 floor is the step between neighbouring bands of a 48-colour ramp — it is present in correct output, so a bound tight enough to call it a fault would fail against the fix.

The reusable part: when one kind of mark gets a fix about how big an area is painted one colour, check every other kind in the same generator. The note about where colour is sampled says the same thing about *tiles*; this is the same lesson about *marks*, and the arcs sat wrong for as long as the chords sat right.

**A control can mean a different amount in different modes, and one range cannot serve both.** Truchet's divisions draw n concentric rings on quarter arcs, where twelve is the point of raising it, and 2n-1 parallel chords on diagonals, where twelve is twenty-three lines through one cell and the tiling reads as grey. The same slider, the same number, two unrelated amounts of ink.

`Generator.limits` states a ceiling that depends on another param's value, and it is on the generator rather than on the spec for the reason string art's picture-and-detail lookup gives: a spec describes itself, and one parameter's range depending on another's is a fact about the pattern they both belong to.

Two things about it are easy to get wrong, and both were tested by breaking them:

**Clamping is not carrying across.** Moving from a ceiling of twelve to one of six puts eleven of the twelve settings on the same place, so tapping through the tile sets loses where you were and hands back "the top" whatever you had chosen. The value is scaled instead — and scaled to the *ceiling*, not across the range, because that is the reading that round-trips. With a floor of one, scaling the span sends six to three and three back to five, so tapping twice round the sets walks the value downward a step at a time and never says so.

**The clamp has to be a second pass in `coerceParams`.** A ceiling cannot be applied before the parameter it depends on has been settled, and the two sit in whatever order the share encoding put them. Truchet declares its tile set before its divisions, so a single pass works there by luck and proves nothing — the test uses a fabricated generator with the condition declared *after* the thing it limits, which is the order the next generator will reach for the moment it appends a mode switch to a list it already had. `params` is append-only, so nothing stops it.

The cost, stated rather than discovered: a link that asked for twelve divisions on diagonals now decodes to six. That is the "narrowing a range" hazard from the invariants section arriving through a different door, and it is the right trade here — the alternative is a slider showing a ceiling the render quietly ignores.

**A dead control is survivable until you bind it to a gesture.** `weight` did nothing at all on truchet's triangles for as long as the generator existed. They are filled and it sets a stroke width, so there was nothing for it to apply itself to — and rather than being treated as a bug it was written down twice as a known limitation, in this file and in the parameter's own description. That is what made it last: a slider that is inert on one of three settings is easy to look past, and documenting it felt like honesty rather than deferral.

What ended it was promoting the three primaries. `weight` is truchet's horizontal drag now, so a dead control became a dead *gesture* — a third of the way a person drives the pattern doing nothing on a third of its tile sets — and it was reported within the week. The general form: promoting a control raises the cost of every compromise already in it, so the moment you decide which three carry a pattern, re-examine what those three actually do at every setting of the others. The file's own rule says a control that is inert in some mode is a smell; this is the one it was written about, left standing.

The fix is worth recording too, because the obvious reading was wrong. "Make the mark thinner" for a filled triangle means the band fills less of its pitch — but only if it is anchored at its corner-side edge. Centre it on itself instead and an undivided tile stops being a triangle and becomes a strip across the middle of the cell, joined to none of its neighbours, and the two are the *same expression* at full fill so nothing but a test about corner counts can tell them apart.

**A threshold on the larger of two quantities does not tell you which of them
is larger.** The gesture surface claims an axis once a drag has moved, and the
first version claimed whichever direction was ahead the moment *either* passed
ten pixels. Eleven across and four down passes that test, and the answer it
gives — across — is right about that sample and wrong about the gesture: a
thumb swiping up a phone pivots from the knuckle and travels sideways first.
The wrong axis then held for the rest of the swipe, so the control the person
was watching never moved. It was reported as "swipe up and down doesn't seem to
be registering consistently", and the inconsistency is the whole tell — whether
it happened depended on where round the arc the tenth pixel fell. The claim is
on the *lead* now, `abs(dx) - abs(dy)` past the threshold, with a second larger
distance at which an even diagonal has to pick one anyway. The test that
matters replays the arc, because a straight vertical drag passes under both
rules, which is exactly why this shipped with a vertical-drag test already
green.

It was also not the whole fault, which is the part worth keeping. Fixing it
improved the gesture and the report came back as "still isn't great", and the
two entries below are what was actually underneath. Three causes, one symptom,
and the first one found was the smallest of them — when a fix makes a reported
fault better without ending it, that is evidence of another cause rather than
of tuning left to do.

**Re-anchoring on the value being at a bound is not the same as the drag
having gone past one, and a control that starts on its minimum tells them
apart.** A scrub re-anchors its origin when you drag beyond an end, so that
reversing responds on the first pixel instead of paying back the overshoot —
right for a fader, and the condition for it was `value === spec.min || value
=== spec.max`. Divisions defaults to 1, which *is* its minimum, so it satisfies
that from the first move of every drag, long before the drag has covered a
step. Re-anchoring discards the displacement accumulated so far, so each move
started again from nothing and the value could never climb off the end.

What made it intermittent — and it was reported as inconsistency, twice — is
that a single move can escape on its own. Drag fast and the first move crosses
half a step, quantises upward, leaves the bound, and everything after it works.
Drag smoothly, as a thumb does against a 120Hz screen, and no individual move
ever crosses half a step, so nothing happens at all. The bug was a function of
pointer speed, which is why no amount of looking at the code for the *axis*
found it.

The test had to be a smooth drag to see any of this. The existing helper moves
in 24 increments, which on a 150px swipe is 6.25px an event — enough to clear
half a step on the first one, so every vertical test in the file passed for a
reason that had nothing to do with the mechanism being right. The fix keys on
whether the *fraction* overshot the range rather than on where the value
landed. The general form: when a guard's condition is a proxy for a state, ask
what else satisfies the proxy — here, being at the end and having gone past the
end look identical in the value and are opposite in intent.

**Pixels per step is the wrong invariant once a step stops being a small
thing — and the surface was the right one all along.** This entry is kept with
its middle rewritten, because the fix it originally recorded was itself
replaced two days later and the reasoning is only useful with both halves.

The gesture began by giving every parameter twelve pixels of travel per step,
clamped into a band. The argument for it was real: it makes a drag mean the
same on a phone and a desktop, where measuring against the surface does not.
What it could not do is produce a scale anybody could point at. The number of
steps is an implementation detail of a parameter, not a measure of how much a
step *does* — weight has 48 and one is invisible, divisions has 11 and one
redraws the pattern — so the two axes came out 3.7x apart. Measured, a 150px
drag moved weight 29% of its range and divisions 107% of its, which meant the
vertical axis saturated inside a third of the preview's height and every swipe
after the first did nothing. From outside that is indistinguishable from a
gesture that never registered, and that is what it was reported as.

The first fix was to raise the floor on total travel from 140px to 300 — a
better constant, still a constant, and still calibrated by hand against one
generator. What replaced it is the rule that needs no calibration: **the
picture is the control, so the picture is the scale.** Edge to edge covers the
whole range, on each axis against its own dimension. Let go half way and you
are half way along. That is a promise the surface states by existing, it holds
on every parameter without anybody tuning it, and it is what was asked for in
those words once the constants had been wrong twice.

Two details it needs to be true rather than nearly true. The range is spread
over the surface **less the pixels the axis lock spent deciding** — the value
anchors where the axis is claimed, so that lead moves the finger without moving
the value, and measuring against the full width lands a full-width drag about
5% short of the end. Six percent on a phone, where the lead is a bigger share
of a narrower surface. Near enough to read as a control that will not quite
reach, which is the same complaint this whole sequence started with. And the
surface is measured once, at pointerdown: reading layout per move is a forced
reflow per pointer event, and a surface that resized mid-drag would move the
value with the finger still.

The cost is the one the original argument named, now accepted deliberately. A
fine control on a narrow phone gets very little travel per step — weight's 48
steps across a ~210px preview is about 4px each. That is fine for an aesthetic
quantity nobody is trying to land on an exact step of, and it would not be fine
for a control where the exact step mattered. If one ever exists here it should
say so, rather than a constant pushing every parameter around to protect it.

**The other end of that division needed a floor, and the number came from the
control that already worked.** Spreading a range over the surface means a step
costs surface/steps, and the entry above is about that being *small*. It is
equally the reason it can be huge: contours' detail has four steps and
truchet's diagonal divisions have five, which on a phone preview is 130 and 104
pixels of finger for one change, and it was reported as exactly that. So a
control is never spread over the whole surface for fewer than ten steps —
below that it covers its range in proportionally less of it, holding the step
at surface/10.

Ten is not a taste. Truchet's arc divisions have eleven steps, about 47px each,
and are the promoted vertical gesture nobody has complained about; below ten
there is nothing else in the registry to compare against. So the floor hands a
coarse control the travel-per-step of the coarsest one that is fine, and ten is
also the largest value that leaves every existing control byte-for-byte as it
was. The general form, against the entry above rather than with it: a scale
calibrated per thing it scales is a smell, and a single floor taken from a
measurement is not the same thing as a constant per parameter.

The guard for it is worth reading before writing another. "Edge to edge is the
whole range" is not testable by dragging edge to edge, because the value clamps
at the end whether the travel is right or merely too short — the first version
of that test passed with the floor raised to sixteen, which would have squeezed
the very control it exists to protect. Drag *half* the surface and assert half
the range.

**And the fine end needed a floor too, which is a different clamp entirely.**
Chevron's relief has a hundred steps, 5.2px each on a phone, and contours'
terrain scale is 7.1. A change every five pixels is a *render* every five
pixels, and the preview cannot keep up: reported as feeling laggy, which is
what it is rather than a turn of phrase. So no felt change costs less than
about ten pixels.

The fix is not the obvious one, and the obvious one is worth naming because it
is what the guard rules out. Lengthening the drag until a step is ten pixels
needs 1,000px for relief on a 520px preview, so a full sweep would cover half
the control — it buys the ten pixels by spending the promise the entry above is
about. What works instead is coarsening the *lattice*: snap to every second
step. The value still crosses its whole range edge to edge and changes half as
often, and it stays on the spec's own lattice, so a scrubbed value is one the
slider and the share link can both hold.

The two clamps meet in the middle and the band is worth knowing: every scrubbed
control in the app now moves somewhere between 9.6 and 52 pixels per felt
change, where before it ran from 5.2 to 130. "Around ten" is literal — a
control already at 9.6 is left alone, because doubling it to 19.2 moves it
further from the target than leaving it does.

The general form, which is the part worth keeping: when a scale has to be
calibrated per thing it scales, the calibration is the smell. Look for a
quantity already on screen that can carry it.

Worth noting how the middle fix hid another bug and then exposed it. Raising
the travel floor made every pointer move smaller, which turned the re-anchor
fault above from intermittent into total and failed a test that had been
passing for the wrong reason since it was written. A calibration change is a
good way to find out which of your tests were only ever passing by luck.

**A bounded control has two dead directions, and a gesture that does nothing
cannot be told apart from one that is broken.** Swiping left on a control
already at its minimum did nothing, correctly — there is nothing to the left of
a minimum — and on this surface in particular that is not a neutral outcome.
Three separate faults here had already presented as "the swipe isn't
registering", so a legitimately dead gesture is the same experience as the bug,
and a person has no way to tell which they are looking at.

What it turns on is *when* the rule applies, and the two readings are not close.
Wrap whenever a drag reaches an end and a fader rolls over mid-drag: settling
next to either end becomes impossible, because you keep falling off it and
reappearing at the far one, and that is worse on a 48-step control than a
12-step one. Wrap only where a gesture *begins* and a drag stays a fader — it
clamps at the end like it always did — while lifting and swiping the same way
again is a second, deliberate statement that comes round. It also gives a short
path between the ends, which otherwise costs a full sweep of the preview.

So the wrap lives at the axis lock, which is the one place that knows a gesture
is starting rather than continuing, and `wrapPastEnd` is in core because where
a parameter goes when it runs out is a fact about the parameter.

Both halves need a test and the second one is easy to write badly. A first
attempt at injecting the mid-drag version set `from` to the wrapped value
inside the existing re-anchor branch, where the re-anchor that follows
immediately computes its offset from the new `from` and puts the value straight
back — a no-op that the test passed, which looked like proof the test could not
see mid-drag wrapping. It can; the injected bug was not the bug. When a bug
injection fails to fail, check that you injected the thing you meant before
concluding anything about the test.

> **The triangles are gone.** Everything from here to the end of the diamond
> entries is about a truchet tile set that was removed when arcs and diagonals
> became separate patterns. The code is not in the repo. The entries stay
> because every one of them is a lesson about something else — where colour is
> sampled, what a budget may be spent on, what a constraint leaves free, which
> instrument can see a fault — and because the diamond derivation is the
> clearest worked example in this file of a picture being determined by
> structure rather than by the seed.

**Filling the empty half of a truchet triangle fixes the measurement and
destroys the pattern.** A triangle fills half its cell and leaves the other half
as paper; that blank half *is* the tile set. Two real faults sit under it — a
lone triangle touches only two of its cell's four edges, so half the grid's
boundaries have a ribbon stopping against nothing, and dividing a half cell inks
less of the whole cell as the count rises — and drawing the opposite triangle
fixes both arithmetically while ruining the picture. At fourteen columns the
airy chevrons become uniform hatching with no negative space in them.

The rule that catches it: **dividing mass into ribbons must remove ink.**
Undivided the tiling inks 0.300, divided 0.205 at three and 0.169 at the
densest corner; the complement reads 0.311, 0.310, 0.308. A divided tile inking
more than a solid one is wrong whatever it looks like. That is the regression
test, and the joining fault is still open — a half-cell mark cannot reach four
edges, so the next attempt has to start from what the tile set is for.

Two instrument failures on the way, both worth avoiding: an absolute-brightness
pixel count scored 0.996 coverage on a near-black palette by counting
anti-aliased edges, and a script reading a stale `dist` reported identical
numbers for both versions. Use the metric the suite already trusts, rebuild
before measuring, and suspect the instrument before the code.

**Two fills at different opacities composite, and a hole in the upper one is a
window onto the lower.** The preview's gear was an opaque ring for the hub
drawn under a gear body at 0.55. The body paints over the ring; the ring's hole
does not, so what renders is a bright annulus with a grey disc sitting in it —
reported as "a strange dot, almost as if there's two icons? or a circle?".
Neither path is wrong on its own. This is the subpath note above seen from the
other side: there one element would not accumulate with itself, here two
elements accumulated where the drawing assumed they would not. It is one path
with `fill-rule="evenodd"` now, so the hub is the body's own hole and there is
nothing behind it to show through.

That fixed the compositing and not the reading, and it was reported a second
time in the same words. The glyph's *proportions* were the other half: stubby
teeth and a hub wide enough to dominate, so at the 19px it ships at the thing
still came out a ring with bumps — a circle, which is what was said twice. The
first check missed it because it compared the two icons at 152px, where both
are legible and only the grey disc stands out. At 40px the old one is a dark
ring and nothing else. **Rasterise at the size it ships at, not at a size that
flatters it** — the A/B rule in this file with the part about the shipping
version applied to an icon. The cog is generated from a tip radius, a root
radius and a hub now rather than typed out as coordinates, which is also why
it took two goes to get wrong.

**A control whose range is eaten by another control cannot carry a gesture.**
Truchet's `weight` is a fraction of the cell, and the fan thins its stroke to
the gap between rings so that raising the division count cannot close them into
a block. Both halves are right, and together they mean most of the weight
slider asks for a stroke wider than the gap and gets the gap. Measured on the
arcs at eight columns, the fraction of the slider's travel that changes the
rendered stroke at all: 100% at one division, 69% at two, 29% at three, 17% at
six, 6% at twelve — and the 0.16 default is already inside the dead zone from
three divisions up. Diagonals are the same shape of thing, 48% at three and 17%
at six.

This is the dead-control smell again, but the new part is what promotion did to
it. `weight` and `arcCount` were the two scrubbed axes, so the *vertical*
gesture decided how much of the *horizontal* one did anything — two of the
three primaries coupled, with no way to see it from the outside. The fix was
not to rescale `weight`; it was to notice that a gesture has to be independent
of the other gestures, and to give the horizontal axis to `density`, which is
uncoupled from both and is the control a person reaches for first anyway.

The first fix made the pitch the *unit* rather than the ceiling — `weight /
0.414` of the gap. The slider went live and every divided render that already
existed got 43% thinner, because the default then filled 0.386 of the pitch
where the old ceiling allowed 0.68: on the arcs at three columns and four
divisions, 13.46px before against 7.65px after. It was reported as the arcs no
longer being "smooth as before".

What ships keeps the original shape — cell-relative, limited by the room
between marks — and scales the *limit*. At and below the default it is exactly
the 0.68 it always was, byte-identical across 192 configs; above the default it
opens toward a whole pitch. **When a control is dead because a constant ceiling
truncates it, scale the ceiling** — reinterpreting the control moves every value
that control already had.

The triangles keep a dead top third and that is correct. At twice its pitch a
band has closed the gap either side of it and the tile is solid — there is
nothing further to fill, so it is saturation rather than a clamp, and unlike
the clamp it is visible in the picture. A dead range you can see the reason for
is not the same defect.

The regression test had to ask a different question from the one already
there. An existing test compares thin against heavy at one and three divisions
and passed against the bug throughout, because the *thin* end was still below
the gap and so still moved; the fault was at the top and got worse with the
count. The new one runs from the default upward at twelve. Against the clamp it
reads 0.290 ink at the default and 0.290 at the maximum — the same number
twice, which is what a dead control looks like once you finally measure it.
When a control is partly dead, test the half that is dead, not the range that
happens to span it.

**A test that names a control by its label breaks when the control moves, and
the ones that break are never in the file you are editing.** Swapping truchet's
horizontal gesture from `weight` to `density` moved each behind and out from
behind the gear, and three tests in two other spec files — `editor.spec.ts`
twice, `worker.spec.ts` once — reach for a slider by label purely to have
*something* to move. They timed out waiting for an element that is no longer in
the page. This file already recorded the same trap from the other direction
when density first went behind the disclosure; it happened again immediately in
reverse, so the rule is worth stating plainly: a test that just needs a control
should say so in a comment and name a promoted one, and moving a control means
grepping every spec file for its label rather than the one you are working in.

**Joining every edge and staying random are not both available, so the
choice is a dial.** A truchet triangle covers half its cell: it shows ink to
two of the four edges and blank paper to the other two, so with a free rotation
per cell about half of all shared edges have ink on one side and nothing on the
other, and a ribbon running into one stops dead against a ruler-straight
boundary. At low densities, where a cell is read on its own, that is the whole
of "the triangles don't line up".

The bound is worth knowing before anyone tries again. Let R be 1 when the
filled half touches the right edge and D when it touches the bottom; the four
rotations are exactly the four (R, D) pairs, and two cells meet along a shared
edge precisely when those bits alternate across it. So a fully joined tiling
needs R to alternate by column and D by row — which fixes every cell from the
first one, leaves four layouts in total, and makes the seed do nothing on this
tile set. There is no assignment that joins everything and keeps variety.

`JOIN_NEIGHBOUR` is 1 and is no longer a dial — the control that replaced it,
`diamonds`, steers the free phases instead and keeps the join whole. Measured
band ends with nothing facing them when it *was* a dial: 13-20% at 0.7, 7-13% at
0.85, 1-4% at 0.95, 0% at 1. It costs no ink and no negative space — the rotation decides which half
of a cell is filled, never how much — which is exactly what the earlier attempt
at this got wrong by drawing the opposite triangle as well.

It shipped at 0.7 for a while, and **the reason that was wrong is worth more
than the number**: the damage a broken seam does scales with the division count,
and the dial was calibrated when a tile was one solid triangle. Undivided, a
seam with ink on one side and paper on the other is just negative space and the
A/B at three columns is genuinely hard to call. Divide the tile into six ribbons
and the same seam stops six ribbons dead in mid-air, which is the first thing
anybody sees. It was reported four times before the dial was suspected at all.
The general form: when a compromise is measured on one setting of another
control, re-measure it at that control's extreme before calling it settled.

**The cost that entry used to record was not a real cost, and the mistake in it
is the useful part.** It said a fully joined tiling determines every cell from
the first, leaving four layouts and little for the seed to do. The first half is
right and the conclusion does not follow. Joining needs R to alternate *along
each row* and D *down each column*, which determines every cell in a row from
its first one — and says nothing about what that first one is. The first cell of
each row sets that row's phase, the first cell of each column sets its own, and
the join constrains neither. There are 2^(rows+cols) joined layouts, not four.

Those free phases are exactly the diamonds. Four cells close a ring around a
vertex only when all four turn their right angle to it, which needs the two rows
either side of that vertex to share a phase and the two columns either side to
share one too. So the `diamonds` control biases whether neighbouring rows and
columns agree, and it costs no join at all: 0% of band ends unmet at every
setting of it, measured. At 0 no two neighbours agree and the marks run unbroken
from one edge of the picture to the other; at 1 they all agree and the grid fills
with concentric diamonds; the middle mixes long runs with clusters.

**Those free bits are one per row and one per column, so a fully joined triangle
tiling is a plaid, and no seed will ever make it look otherwise.** This was
reported twice — "the diamonds are so symmetrical, they all seem to follow the
same vertical line", then "a lot of symmetry still that suggests it's not
random" — and the phases are not the problem: measured over a dozen seeds they
are a fair coin with a mean run of 2.0, and 200 seeds give 200 distinct tilings.
The structure is.

Write the join as `R(i,j) = (i + a_j) % 2` and `D(i,j) = (j + b_i) % 2` and put
the diamond condition beside it. A vertex closes into a diamond exactly when

    a_j == a_{j+1}   and   b_i == b_{i+1}   and   i + a_j is odd   and   j + b_i is odd

which was checked against the rendered rotation grid at four seeds and matches
it cell for cell, so this is the picture rather than a model of it. Every clause
is keyed on a *row* or a *column* and none on a cell. So whether a column
boundary can carry diamonds at all is one bit that holds for its entire height,
and whether a row boundary can is one bit that holds for its entire width: the
verticals run edge to edge because there is nothing in the construction that
could stop one part way down. A 13-wide render is 13x30 cells, and triangles get
43 free bits where diagonals — whose every rotation joins on all four edges —
get 390. That is the whole of why diagonals look unforced beside them and it is
not a tuning difference.

The trade is therefore not "more randomness" against "less". It is every seam
joined against features that do not span the canvas, and you cannot have both
with a half-cell mark on a square grid: a triangle shows ink to two of four
edges, so joining forces alternation, and alternation leaves only a phase. A
mark that touched all four edges would break the forcing, which is what the
other two tile sets are.

**So it is a control — `diamondBreak` — and the whole of its design is that the
cost is exact and stated.** A row leaves its phase by making one pair of
neighbours agree, which is one seam with ink on one side and paper on the
other, and the phase then carries on shifted because the next cell alternates
from the flipped value like any other. One seam bought, one run that stops part
way. The rate is per seam rather than per row, so a drag means the same run
length in cells at three columns and at twenty-six, and the slider's top is a
tenth of all seams — measured 10.08% over twelve seeds, against the 13-20% that
`JOIN_NEIGHBOUR` at 0.7 left and that was reported as small islands. The useful
part is the bottom third: at 0.3 it breaks 2.9% of seams, and at thirteen
columns and six divisions the plaid is gone with a handful of visible stubs.

Two things it needed to be worth having. It had to be **strictly additive** —
720 configs across three tile sets, five densities, four division counts, two
palettes and two seeds are byte-identical at the default, checked under `git
stash` rather than asserted. And the fault placement has to move with the seed,
where a `RenderContext` carries no seed and drawing one from the stream would
shift every later draw and repaint every truchet render there is. What was
already to hand is the raw `rng.int(0, 3)` every cell draws and the join then
throws away: folding those into a running mix gives a seed-dependent salt for
`hashSeed` and costs nothing from the stream. **Before adding a control that
needs its own randomness, look for a draw the code already makes and
discards.**

Two instrument failures are worth carrying, because the second is the one this
file keeps warning about. Reading rotations back out of the polygons put the
grid origin at zero, and the rows are centred with a spare row so `originY` is
negative — it read 19.3% of seams broken on a tiling that is joined by
construction, and the 0.00% it reads once fixed is what says the instrument
works. Then the metric: the obvious guard is that a joined diamond set is a
*product* of a row set and a column set, so two diamonds should imply the two
completing their rectangle — and that is only ~10% true even at zero, because
the parity terms halve it twice. The exact invariant is one step further in.
Joining makes `D(i, j) = (j + b_i) mod 2` for one bit per column, and a diamond
needs `D(i, j)` to be 1, so **every diamond in a column sits on a row of one
parity** — 152 of 152 groups, exactly, at every seed. That is "they all follow
the same vertical line" written down, and it is what the regression test asks.
A guard that is an identity beats one that is a tendency; look for it before
settling for a threshold.

Two smaller things fell out of measuring it. **Both ends of the `diamonds`
slider are deterministic** — at 0 the phases must all disagree and at 1 they
must all agree, so each end admits exactly four tilings and 200 seeds returned
4. Only the middle of the control is random at all, which is worth knowing
before reading a render at an extreme as evidence about the seed. And the
entry above says the middle "mixes long runs with clusters", which is true and
understates it: the clusters are rectangles, because they are a product.
The general form, which is why this is worth the space: "joining everything
fixes everything" was an inference from a real constraint, never measured, and
it shut down a whole design direction for a day. When a constraint forces a
relation between neighbours, check whether it also fixes the starting value —
a rule about differences leaves the constant free.

The regression test asks about the symptom, ink stopping at a boundary, rather
than about the rotation bias that produces it, so a better way of joining would
satisfy it too.

**Demoting a control does not reset it.** `weight` was a swipe gesture, got
dragged near its minimum while it was one, and was then moved behind the gear
still holding 0.04. The render came out as hairlines and was twice reported as
a bug in the pattern: the value was two taps away and nothing pointed at it.
Before moving a control out of sight, check what it is holding and say so in
the change, rather than leaving it for someone to find.

The fix that suggests itself is wrong, and it shipped for one deploy — a dot on
the gear whenever a hidden control sits away from its default. **A badge reads
as "needs attention", and a setting somebody deliberately chose does not need
attention.** It would sit there permanently after any adjustment, meaning
nothing, and it dresses "different from the default" up as "something is
wrong". Reverted. If a hidden value ever does need surfacing, surface the value
itself, not an alarm about it.

**A comment can be the last surviving copy of a reverted design.** The arcs
branch carried four layers of commentary from successive attempts, two of them
describing code that had been reverted and contradicting the layer below. Each
was true when written. Prose near a change is part of the change: when you
revert, revert what explains it too, and when you read a comment as evidence,
check it against the code.

**Two scales of texture, and only one of them can come from the grid.** A
printed survey sheet has country sweeping across the page and a fine wobble
riding on every line. Contours only ever had the first, and it was reported as
"the fine details of jagged edges — it doesn't seem like any of the controls we
have do this", with grain and valley incision named as the near misses.
(Both have since been removed; the entry below on the sign error says why.)

They are near misses for a reason that is structural rather than a matter of
range. Both warp the *field*, at the landform scale, before it is ever sampled.
And the field is sampled onto a grid, so nothing finer than one cell survives
to be drawn — while `detail`'s finest octave sits at `1 / (scale * 2^(detail-1))`
of the width, about 3% at its ceiling of five, where the texture wanted is
nearer 0.5%. Two ceilings, and the field's binds first.

The grid can be made to do it and the price is the whole map. Measured on one
terrain at 900px: baseline 69ms and 202kB; detail 8 at resolution 360 gives the
crenulation for 410ms and 1183kB, and rewrites the country into something much
busier while it is there — 54 contours where the same map had 38. Displacing
the traced line instead costs 99ms and 448kB and leaves every landform exactly
where it was, which is what was actually asked for.

It is not a cheat, and the reason matters for the next thing like it. Moving a
contour point along its own normal by d is what adding `d * |grad h|` to the
height at that point does — the same perturbation, evaluated only where it can
be seen, which is why it needs no finer grid. **When the thing you want is
visible only on a curve, ask whether it has to exist everywhere.**

Three things it needed, each found by breaking it:

**The confounded instrument, again, and this file is now five for five on
this.** The obvious measure of jaggedness is total turning per short step, and
it reads 54.9° at the old maximum detail — for lines that are plainly smooth
when you crop the render at 2.6x and look. A contour sweeping round a hill
turns exactly as much as a crenulated one. What separates them is comparing a
line against a *coarse walk of itself*, so the large-scale shape divides out:
plain runs 1.032 and roughness 1 runs 1.129, an excess of 0.032 against 0.129.
The first bound written off that was 15% and the mechanism delivers 9.4%, which
is the same mistake in miniature — take the threshold from the two measurements,
not from the one you like.

**A guard has to run where the thing it guards against can happen.** Contours
must never cross; that is the one rule a contour map cannot break. The cap is
two terms, a flat fraction of the short edge and a fraction of the gap the line
has to live in, and the crossing test was written at fourteen levels — where
the flat term binds and **deleting the gap term entirely changes nothing the
test can see.** At sixty levels, where the lines crowd, the same deletion puts
two crossings on the map and the test catches it. A test at the setting you
happen to be holding is a description.

**A mark that rides on a line has to be told which line.** Depression ticks
take their direction from the points either side, which on a roughened line is
the tangent of the wobble rather than of the contour — so ticks came out square
to the crenulation, pointing wherever it happened to face, and floated beside
the line because they were still being computed from the traced points while
the drawn ones had moved. Both halves: tick from the line that is drawn, and
take the neighbours far enough along it to average the wobble out.

**A second field mixed in to crease the valleys put its crests in them.**
Contours' `incision` was meant to cut the drainage lines a real slope carries:
plain fBm domes, ridged noise creases, so blending the two was supposed to make
the contours kink into the upstream V that gives a printed sheet away. It did
the opposite, and the reason is one sign. `ridged` is `1 - |gradient|` squared,
so it peaks where plain noise crosses zero — and measured against the domed
field it is not uncorrelated with it but *anti*-correlated, -0.535, with its
sharpest 2% sitting at the domed field's 24.6th percentile. Its crests land in
fBm's valley floors. Mixing it in therefore raised a sharp bump in the bottom
of every valley, and the contours nested tightly round the new summit: at the
slider's top the map went from 86 subpaths averaging 236px of extent to 121
averaging 178px, with the share under 60px doubling from 15% to 31%. It was
reported as "it seems to suck in my contours and that's it", which is exactly
what that is.

The sign is not the interesting part; `1 - noise.ridged(...)` was one character
and was rendered and looked at, and it stops the pinching without producing the
V either — at eight levels most creases fall between contours and are never
drawn. So the control was cut rather than fixed. The reusable form is the
question that would have caught it before a line was written: **when you mix a
second field in to modify the first, measure where the second one's features
land in the first.** "Ridged noise creases" is true and says nothing about
*which* heights get creased, and that was the whole of the bug.

Two things about how it hid. Three quarters of the slider was dead — max 0.2,
and nothing visible below 0.1 — so the fault only appeared at the very top of a
control most people would never push. And the first A/B of it compared 0.35,
0.7 and 1.0 and produced three byte-identical PNGs, because `coerceParams`
clamps them all to the 0.2 ceiling. **A render script does not go through the
editor, so nothing stops you measuring a value the slider cannot reach**; when
an A/B shows no difference at all, check the values actually arrived before
concluding anything about the code.

`grain` went with it, and for a duller reason: it warps the same field at the
same landform scale, so it changes which hills you get rather than how the map
reads, which is what `roughness` was built to do and does. Removing both is
strictly additive by construction — each defaulted to 0 — and 32 configs across
two seeds, two palettes and the corners of scale, level count and roughness are
byte-identical, checked under `git stash` rather than asserted.

**The arcs still carry the seam the chords were fixed for.** Truchet's chords
were cut into separately-stroked pieces for colour, every join was two strokes
sharing an exact edge, and that was measured and removed by switching to a
gradient — 0.961 coincident endpoints per path before, 0.081 after. The arcs
are cut the same way and were never fixed: `arcPoint(corner, rho, stops[c+1])`
is called once to end piece c and again to start piece c+1, same function, same
arguments, so identical floats through `num(…,1)`. The fix went to one mark and
not the other, and the regression test is scoped by name to the one that got it
— `describe('truchet diagonals do not leave a seam for a renderer to open')`.

Neither renderer here can see it: resvg and headless Chromium both composite
exactly, and the original report of this class was Safari drawing every line
dashed. So the suite is structurally blind and so is `npm run samples`.

It is **open**, and the reason it is open rather than fixed is the instrument.
Two independent counts of coincident endpoints disagreed about the legitimate
baseline — the join where an arc meets its neighbour across a cell edge, which
is correct and must not be counted — by a factor of two at nineteen columns.
Before fixing this, build a count that separates a cut seam from a tiling join
and validate it against a render with no cutting at all, which is what any
column count past about nineteen already gives you.

**Four instruments in a row could not see a wrong marching-squares saddle, and
the fifth question is whether the rule is even right.** The saddle case picks
between two ways of joining four crossings. Forcing it (`const high = true`)
and *inverting* it both leave the whole suite green — the inverted rule is
exactly the fault the source comment warns about, contours joining across a
saddle that should divide. Then: subpath and closed-ring counts move by about
1%, which is a threshold picked by eye rather than a guard; inter-level
crossings read 0 for correct output and 0 for both injections; and a ring-count
comparison against a flood fill of the same field failed its own validation,
returning identical numbers for both rules.

The part to pick up carefully. Worked by hand against `f(x,y) = x*y`, a saddle
whose answer is known — the region above a positive iso is two separate
hyperbola branches, so the highs divide, and the cell centre is below iso —
**the shipped rule answers the opposite way on both signs.** One hand-worked
cell is not a finding, and four attempts to confirm it at a scale that matters
all produced confounded instruments, so it is written down as a question rather
than a bug. Resolve it by rendering a field with one isolated saddle far from
the frame and looking at whether the lines divide or join, not by another
global count: every global count so far has been dominated by something else.

**A test about unpaired ends cannot see a wrong pairing.** Found while
re-verifying the tests above, and left standing: contours' marching-squares
saddle case picks between two ways of joining four crossings, and forcing the
choice (`const high = true`) fails no test. The one that looks like it should
catch it asserts no contour stops in the middle of the map — but *both* branches
link all four slots into two pairs, so no end is ever left alone whichever is
chosen. The test's own comment claims it closed this, and what it closed was a
different collapse, emitting one segment instead of two. It predates the
`grain`/`incision` removal and was confirmed against the prior commit, so it is
not fallout from that. The guard it wants is about which hills join, not about
whether ends are paired.

**Promoting a gesture to the registry moves three bugs with it.** Tap used to
cycle whichever parameter a generator nominated; it moves to the next pattern
now. The gesture is the same event and the mechanism underneath it is entirely
different, and each of the three things that broke is the same shape: state that
was safe while the pattern could not change under it.

The worst was an effect keyed on `generator.id`. It decodes the share link into
the editor, and while the id came from the route it could only change by
navigating — so `[generator.id]` was exactly right. The id is state now, so a
tap re-ran it against `window.location.search`, which still holds the previous
pattern's `q` until the 220ms URL debounce catches up, and would have been read
against the new pattern's params in any case. It would have undone the tap with
values that never meant anything. Mount only. **When you move a value from a
prop into state, grep every dependency array that names it** — each one was
written under a promise that no longer holds.

The second: two things legitimately called "Pattern". The editor's tab panel is
named Pattern by its tab, and the new control is a select labelled Pattern, so
`getByLabel('Pattern')` matched both and eleven tests died on a strict-mode
violation. Playwright's `getByLabel` is a case-insensitive substring match, which
is also why the dice's "Draw a new seed" collided with the Seed field and the
book's "Open your saved wallpapers" collided with the "3 saved" link. Two of
those were fixed by making the locator say which *kind* of thing it wants; one
was fixed by renaming the button, because "Open your collection" is the app's
own vocabulary and was better wording anyway. **A new button with an aria-label
is a new thing every label-based locator in the suite can match.**

The third was a test that had been passing on a coincidence. The browser-vs-Node
parity check renders a configuration and then asserts the editor's preview shows
exactly that — and it named the seed and the palette as literals. They happened
to be the ones `initialConfig` hands that pattern, so it passed; pointed at any
other pattern it fails immediately, with a diff of a thousand polygons that says
nothing about parity. It reads `initialConfig(g.id)` now. **A literal that
matches a derived value is a test that works where it was written and nowhere
else.**

**A desktop panel does not become a phone sheet by being put in one.** The
palette overlay is the same `PalettePanel` the Palette tab renders, and at 390px
it had 177px of width beside the button rail — enough to clip its own tab strip
to two of four, with the rest reachable only by a horizontal swipe nobody would
guess at. The fix was structural rather than cosmetic: the sheet takes the whole
preview and the rail hides while it is open, which then needs a real way out, so
it has a Done button. That button was absolutely positioned first, which puts it
over a scrolling container — it scrolled away with the content it was supposed
to sit above. Sticky, with an opaque background.

Worth recording how both were found: by rasterising the built page at 390px and
looking at it. Neither is visible in a test, both are obvious in a screenshot,
and the second one only exists because the first was fixed.

**Five buttons do not fit across a phone preview.** The rail is book, heart,
droplet, dice, gear. At 40px with 8px gaps that is 232px, and below 1000px the
preview is sized from its height — about 240px wide on a 390px phone — so a row
would span the entire picture. A column costs the same 232px of a preview two
and a half times as tall, and the sheet stops short of it rather than padding
itself away from the bottom. The general form is the arithmetic one this file
keeps returning to: work out what the space is before choosing how to fill it.

Two glyph notes, since the cog entry above was written about exactly this.
The palette button was three discs overlapping at different opacities, which is
two fills compositing into a third colour where they cross — the fault reported
twice on the cog, reintroduced from the other side within an hour of reading it.
Separated, they can all be opaque; but three dots beside a die, which is a
rounded square full of pips, is a shape you have to look at twice. A droplet has
a silhouette neither of the others can be confused with. **Compared at 19px,
which is the size it ships at**, not at a size that flatters it.

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
  (`COLOR_FIELD` cycles across the image), sampled **per piece of an arc** —
  per tile gives every arc in a cell one step of the ramp and the cell boundary
  shows as an edge, and per whole arc is still a flat unit up to 18.5% of the
  canvas wide, which steps in colour where two arcs meet. Arcs are cut on the
  same 6% rule the chords follow, from a table of literals rather than
  trigonometry. The chords themselves are no longer cut -- see the entry below
  on the seam this leaves on the arcs, which is open. The ramp is always at full resolution; `colorBlend` was a
  control and is not one any more.
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

- **A chord is stroked with a gradient, and the stop count is derived.** This
  entry said "cut into pieces" for a long time after the pieces were replaced,
  which is the reverted-design trap this file warns about, reached from the
  other side: the code moved and the record did not. The derivation below is
  still why the count is derived the way it is -- the gradient replaced the
  pieces, not the rule that sets how finely the colour has to be read -- and it
  also removed every cut seam, two strokes sharing an exact edge, which is the
  thing the arcs still have. Sampling
  once per chord fixed the cell-sized blocks and left a subtler version of the
  same fault: a colour boundary can then only fall in the gap *between* chords,
  and every chord runs at 45°, so the field's contours snap onto a lattice of
  parallel lines and come out as straight-edged diamond facets. The resolution
  is fine across the family, where the spacing is `s/n`, and coarse along it,
  where nothing changes for the chord's whole `1.41s`. That anisotropy is what
  a facet is. Pieces are sized so none carries one colour across more than 6%
  of the canvas width — `ceil(1.4142 / (cols * 0.06))`, keyed on the column
  count and never on pixels. It costs nothing where it is not needed: past
  about 23 columns a chord is already short enough to want a single piece,
  which is exactly where the render is heaviest.

Controls, on both: density, weight, colorSpread, arcCount (labelled Divisions;
max 12 on arcs, 6 on diagonals), and arcSpacing (spread) on the arcs alone.
The two the picture is driven by — horizontal for density, vertical for
arcCount — are promoted into the panel with their gesture written beside them;
the rest live behind the gear on the preview, as name and slider with no
explanation. Tap belongs to the registry now and moves to the next pattern.

`weight` held the horizontal slot until its range turned out to be eaten by the
division count, which the bug note above records. Removed as not worth their
slots, over the life of the generator: `colorBlend`, `mixed`, row weight
variation, `gap`, `subdivide`, `quietTop` and `openEnds` — and then `tileSet`,
`diamonds` and `diamondBreak` with the triangles. Every stroke is one width and
fully opaque.

The divisions ceiling used to be `limits`, a range declared against another
parameter's value and applied in a second pass of `coerceParams` because it
cannot be resolved until that parameter has settled. Splitting the tile sets
turned it into a number in a spec. **Nothing in the registry declares `limits`
any more**, and the machinery stays anyway: a mode switch with a dependent range
is the obvious next thing a generator will reach for, and its tests run against
a fabricated generator that declares the condition *after* the thing it limits,
which is the order that catches a single-pass implementation.


---

## Conventions

Develop on a feature branch; `main` is what deploys. End commit messages with
the attribution lines the session provides. Do not put model names anywhere in
the repo — commit messages, code comments, or UI.

Commit in logical increments, one concern per commit. Write commit bodies that
explain *why*, including what was ruled out; several in this history are the
only record of a subtle diagnosis.

**Report back in three headings, in this order: What's new, What's fixed,
What's unresolved.** Nothing before them but one line on whether it shipped.
Bullets, not paragraphs — the reasoning, the measurements, the A/B and what was
ruled out belong in the commit body, which is where they are useful later and
where nobody has to wade through them to find out what happened. This was asked
for after a run of replies that were accurate and too long to parse.

The third heading is not optional and "nothing" is rarely the honest answer.
Anything deliberately not done, any rough edge left standing, anything deferred,
suspected or checked-but-unverified goes there — including the things the work
revealed rather than caused. An empty third heading usually means it has not
been looked for.

Be accurate about uncertainty in user-facing copy. `/setup` documents an Apple
Shortcuts recipe and marks each label as either confirmed against Apple's
documentation or community-sourced, because `support.apple.com` is unreachable
from this build environment. Do not quietly upgrade a guess to a fact.

---

## Current state

Four patterns in the app: `truchet-arcs`, `truchet-diagonals`, `chevron-blocks`,
`contours`. Four more are written, tested and **not registered** — `flow-dots`,
`phyllotaxis`, `ridgelines`, `string-art` live in `retired` in
`generators/index.ts`, which means no page, no gallery card and no slot in the
tap cycle. `getGenerator` deliberately does not search `retired`: a pattern that
is not in the app must not resolve from a URL or from a saved collection item,
or it would render a page the gallery says does not exist.

They are not deleted, and the seam that keeps that honest is `ALL_GENERATORS` in
`packages/core/test/helpers.ts`, which is `[...generators, ...retired]`. Every
suite that sweeps "all generators" sweeps the retired ones too, so a change to a
shared helper cannot quietly rot the four nobody is looking at. A test about
what the *app* offers reads `generators` directly — the primaries contract is
the one that does.

Truchet used to be one generator with a `tileSet` select: arcs, diagonals and
triangles. Tap cycles the *pattern* now rather than a parameter, so a select
whose whole job was to be the tap had nothing left to be. Arcs and diagonals
became two registry entries sharing one render through `makeTruchet(kind, …)`,
and the triangles were removed outright. The bug notes about them are kept
below because the lessons are general — the flat-unit rule, dividing mass into
ribbons removing ink, a fully joined tiling being a plaid — but **the code they
describe is gone**, so do not go looking for it.

Two consequences of that rename worth knowing before reading any old number in
this file. The generator id is part of what `seedToInt` hashes, so the same seed
word draws a different picture under `truchet-arcs` than it did under `truchet`
— measured, the drawing itself is byte-identical across 120 configs once the
`<title>` is normalised, and every single hash still differs. And `/p/truchet/`
links are dead: the id is gone and the params shifted anyway when `tileSet` left
slot 1. That was taken knowingly, and it is the last time it will be free.

`string-art` is the only generator that takes an *input*, and it is one of
the four set aside. Its picture is a
param like any other — an `image` ParamSpec holding a 4-bit darkness grid
packed by `imagegrid.ts` into link-safe characters — so a share link is the
portrait rather than a reference to one, and nothing about the upload leaves
the browser. The grid names its own size in its first character, so a link
made at one detail setting still reads at another, and `GRID_SIZES` is the
set it may take: 48 costs about 1,500 characters of URL and 128 about 11,000.
The alphabet deliberately excludes `_`, which is what `share.ts` separates
params with. Adding that param kind broke three places that assumed "not
number, not boolean, therefore select"; if you add a fourth kind, expect the
same.

It is built in two movements, and keeping them separate is the whole design.
The picture is blurred, thresholded at nested quantiles — the darkest
`coverage`, then half of that, then half again — and each threshold is traced
into closed rings by marching squares. Nails are driven along every ring at a
fixed *spacing*, so a big shape gets more of them rather than the same number
spread thinner. Only then does thread go on, wound as star polygons inside
each ring, and a chord that would leave its region is dropped after being
tested along its own length. Edges come from where the nails are; the thread
only shades.

It reads a picture one of two ways and this is the first thing to check when
it looks wrong. **Masses** treats the dark as the shapes, which is a
photograph. **Lines** inverts, because a drawing's dark is its boundaries and
what wants filling is what they enclose; it also reads its thresholds off the
field's range rather than by quantile, and drops the region that reaches the
frame, since the paper outside a drawing is not one of its cells. A drawing
read as masses comes out as outlines with nothing in them.

Three things about it are load-bearing and easy to undo by accident. In masses
mode the thresholds are **quantiles, not values** — a fixed darkness is a
different control on every photograph, and on a backlit one it traces nothing
at all.
The trace grid is **fixed at 128 and is not the stored grid's size**, so
raising picture detail changes how much of the photograph feeds the outlines
rather than changing their shape. And **reach and density are not both free**:
see the entry above about which of two coupled quantities a budget may be
spent on.

It replaced a greedy tonal solver that wound chords across a circular loom.
That version is worth knowing about only as the bug note above records it —
its params are all gone, so links made before the rebuild decode into the new
slots and read as nonsense. Nothing outside this repo had one; the next such
change will not be free, and the encoding still has neither a version nor
named keys.

`chevron-blocks` is the only one that covers the canvas completely, which is
worth knowing before reasoning about its colour: a full-bleed field of accent
is a bright wallpaper whatever the palette says its background is, so its
blocks are anchored a fixed lightness distance from the paper rather than
painted at accent strength.

Two of the six now compose uniformly across the canvas rather than holding the
clock zone back, and for different reasons. Truchet never could: a tiling is
uniform by construction and any factor keyed on height draws a band across it.
Contours could and no longer does — its `relief` param flattened the field
toward the top so that fewer heights were crossed up there, which worked, and
was removed on request because the range above its default did little. The
consequence is plain in an A/B and worth knowing before anyone calls it a bug:
the top third now carries the same contour density as the bottom.

So the repo now holds the clock zone back three different ways and, in contours,
not at all. `quietFactor` dims what is drawn, which is right where density
varies and wrong on a uniform tiling. The other two are structural — they change
how much there is to draw up there rather than how it is painted — and that is
the family contours' `relief` belonged to: chevron-blocks' `skyline` is the
surviving example, growing its stacks toward the bottom and flattening them
toward the top. If contours ever wants its quiet top back, that is the shape of
the answer, and reinstating its old `relief` beats inventing something new.
Mind the collision when reading either file: chevron-blocks has a param of its
own called `relief`, and it means the height spread between stacks, which is a
different thing entirely.

`contours` and `ridgelines` are the same idea seen from two directions, and the
distinction is worth keeping straight: ridgelines is terrain in elevation, a
stack of height profiles with the front ones occluding the back, and contours is
the same sort of field in plan, traced as iso-lines by marching squares. Both
already sample noise in two dimensions — that was never what separated them.
Asking ridgelines for closed loops around a peak is asking a side view for a
plan, which no parameter can answer.
Client-only: no server rendering, no database, no accounts. The render service,
short config IDs and per-config iCloud shortcuts are the next phase.

Known weak points are listed at the end of the README. The main ones now: the
PNG export path is still synchronous, and PNG quantisation works on pixels
rather than on the palette the generator used.

Previews render in a worker (`apps/web/lib/render.worker.ts`), with one
deliberate exception: the *first* render of any `PatternImage` is inline. The
static export bakes its pictures into the HTML as data URLs and React hydrates
against that, so the client's opening render must produce the identical `src`
or it is a text hydration mismatch — the same class of bug as the build-stamp
one recorded in `next.config.mjs`. Everything after the first render goes
through the worker. `worker.spec.ts` asserts a worker actually starts, because
the client falls back to rendering inline whenever one cannot be had and a
silently broken worker is indistinguishable from a working one by looking at
the pictures.

That intermittent is closed, and the way it stayed open is worth the line.
`quality.spec.ts`'s "nothing is written to the console" test twice failed with
React error #418, a text hydration mismatch. The cause was found — Next
evaluates `next.config.mjs` more than once per build, so a bare `new Date()`
gave the prerendered HTML an earlier instant than the client bundle, and the
footer renders it to the minute, so the two agreed except when the loads
straddled a minute boundary — and the fix and its measurement went in sixty
lines below the note in the same file. Nobody updated the note, or this one, so
both went on describing an open investigation for weeks. `scripts/check-build-stamp.mjs`
is that assertion without a browser, and the Pages workflow runs it.
