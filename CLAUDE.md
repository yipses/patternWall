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
this repo had links worth keeping yet. Contours' `relief` then went the same way
for the same reason, shifting the seven params after it. That window is closing:
the moment someone bookmarks a configuration, this stops being a free operation.
If links ever need to survive, the encoding needs a version or named keys — it
has neither today.

**Narrowing a param's range is the quiet version of the same thing, and it can
also disarm a test.** Lowering a maximum does not shift any slot, so links keep
decoding — but `coerceParams` clamps, so every stored value above the new
ceiling silently becomes the ceiling, and any default above it has to move with
it. Contours' `grain` and `incision` defaults both sat above their new maxima
and were pinned down to them.

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

- **A chord is cut into pieces for colour, and the count is derived.** Sampling
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

Seven generators: `flow-dots`, `truchet`, `phyllotaxis`, `ridgelines`,
`contours`, `chevron-blocks`, `string-art`. Two taxonomy tags — `distortion` and `physics` —
have no patterns yet. Truchet and contours are by far the most worked over; the
rest have had little iteration and should be assumed rougher rather than better.

`string-art` is the only generator that takes an *input*. Its picture is a
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

Three things about it are load-bearing and easy to undo by accident. The
thresholds are **quantiles, not values** — a fixed darkness is a different
control on every photograph, and on a backlit one it traces nothing at all.
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

One unresolved intermittent: `quality.spec.ts`'s "nothing is written to the
console" test has twice failed with React error #418, a text hydration
mismatch, and has not been reproducible since. The note on that test records
what was ruled out. Both sightings were during unrelated work, so do not assume
your change caused it — check the note before spending an afternoon on it.
