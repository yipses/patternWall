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

**One mark per cell cannot tile — and the triangles were the set that never
got the fix.** The arcs' entry above says this, and it was written about the
arcs, and for as long as this generator existed the triangles sat with exactly
the same fault. A triangle is bounded by two cell edges and the diagonal, so it
touches only two of its cell's four edges. Counted over all sixteen rotation
pairs, only 4 put ink on both sides of a shared edge, 8 put it on one side
only, and 4 on neither: half the boundaries in the grid have a ribbon stopping
dead against nothing.

What made it visible was the division count, and it was reported as divisions
"not doing well" on this set. Filling every other band of a *half* cell inks
less and less of the whole cell as the count rises — measured at five columns,
0.538 of the canvas undivided against 0.337 at six divisions, a 37% collapse.
So raising divisions thinned the tiling to scattered ribbons rather than
dividing it, and the odd counts scattered stray corner tips through it as well.
Drawing the opposite triangle on the complementary parity holds it at 0.517 to
0.550 across the same range, gives the cell legs on all four edges, and leaves
one division byte-identical, because at one band the complement's loop starts
at -1 and does not run.

The parity is the part worth understanding. Reading across the cell the bands
run A0..A(n-1) then B(n-1)..B0, so filling A from n-1 and B from n-2 continues
the alternation straight through the shared diagonal: 2n interleaved stripes
across the whole cell instead of n across half of it.

**And there is a limit here that is worth stating rather than discovering.**
Whether two neighbours agree along their shared edge depends on the parity of
the count. A triangle measures its bands from its own right-angle corner, and
of the four rotations one measures both legs in the grid's natural direction,
one measures both reversed, and two measure one each way. Reversing an index
along an edge of n intervals maps m to n-1-m, which preserves parity when n is
odd and flips it when n is even. So at odd counts every cell agrees with every
neighbour, and at even counts the mixed rotations cannot agree on both of their
legs at once — ink lines up against gaps and the tiling reads as a brick offset
rather than as continuous ribbon. Measured as cross-edge disagreement at five
columns: 34% at three divisions against 55% at two and 53% at four. It looks
like a woven texture rather than like breakage, which is why it ships, but a
count of three or five is doing something a count of two or four structurally
cannot. This is the same shape of argument as the arcs' mirror rule, and if the
even counts ever need to join, that is where the answer will come from.

**Two of the three pinned triangle lengths moved for this, deliberately.** The
undivided one is the identity of the set and must never move; the divided ones
roughly double, because the tile stopped wasting half its cell. A test also had
to be re-aimed rather than re-pinned: it asserted that a heavy divided triangle
covers the *same* as a heavy undivided one within 0.02, and that equality was
an artefact — both were a solid half cell. With the whole cell to fuse across
it now measures 0.574 against 0.300, so the claim it can still make is that the
top of the slider fuses ribbons into mass, not that two numbers match.

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

The fix is the one the triangles already had: **the pitch is the unit, not the
ceiling.** A stroke is `weight / FULL_PITCH_WEIGHT` of the gap it has, so a
given weight produces the same *look* at every division count instead of the
same absolute width until it hits a wall. All three sets now mean one thing by
it — how much of its own share each mark fills — and the slider is live over
100% of its travel at every count on arcs and diagonals.

Two things made that cheap. At one division there is no neighbour and so no
pitch, so the mark keeps its cell-relative width and the default render is
byte-identical — checked by checksum on the rasterised PNG, not by eye. And
the constant is chosen so the arcs are *continuous* across that seam rather
than merely unbroken: the two-ring pitch is exactly the fan's whole outward
span, so 0.414 makes one division and two draw the same stroke at the same
weight.

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
  (`COLOR_FIELD` cycles across the image), sampled **per piece of an arc** —
  per tile gives every arc in a cell one step of the ramp and the cell boundary
  shows as an edge, and per whole arc is still a flat unit up to 18.5% of the
  canvas wide, which steps in colour where two arcs meet. Arcs are cut on the
  same 6% rule the chords follow, from a table of literals rather than
  trigonometry. The ramp is always at full resolution; `colorBlend` was a
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

- **Triangles divide on that same lattice, and a divided cell draws two of
  them.** Every rotation lists its right-angle corner first, so scaling about
  that vertex sweeps the hypotenuse across the cell and a slice at `k/n` lands
  on the chord `k*(s/n)`. Fill every other band counting down from the
  hypotenuse, then draw the opposite triangle on the complementary parity: one
  triangle touches only two of the cell's four edges, so alone it leaves half
  the grid's boundaries with a ribbon stopping against nothing, and it inks
  less of the cell the further you divide it. The pair alternates straight
  through the shared diagonal — 2n stripes across the whole cell — and holds
  its ink at about half the canvas at every count. One division draws nothing
  from the complement and is byte-identical to what it always was. Agreement
  across a shared edge holds at odd counts and not at even ones; the bug note
  above derives why.

- **`weight` sets how much of its pitch a triangle band fills**, since there is
  no stroke here to widen. One is the width this set always drew, so the
  default is byte-identical to what it was; below it the band pulls back toward
  the corner-side edge it is anchored on, above it the band grows past its
  pitch and the alternating ribbons fuse into solid mass. Anchored at that edge
  and never centred on itself: at one division the anchored version scales
  about the right angle and stays a triangle with its legs on the cell edges,
  where the neighbours meet it, while a centred one becomes a four-sided strip
  floating across the middle of the cell, joined to nothing. The two are the
  same expression at full fill, which is why every test but the one about
  corner counts passes either way.

- **Divisions stops at six on diagonals**, through `limits`, because the count
  is a different amount of ink on each set: n rings on arcs against 2n-1 chords
  on diagonals. Tapping between sets scales the value to the new ceiling rather
  than clamping it, so half way along stays half way along.

Controls: density, tileSet, weight, colorSpread,
arcCount (labelled Divisions; max 6 on diagonals, 12 elsewhere), arcSpacing
(spread; quarter arcs only). The three it is driven by — tap for tileSet,
horizontal for density, vertical for arcCount — are promoted into the panel;
`weight` held the horizontal slot until its range turned out to be eaten by
the division count, which the bug note above records; the rest live behind the gear on the preview, as name and slider with no
explanation, alongside a button for a fresh seed. Removed as not worth their slots: `colorBlend`, `mixed`, row
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

One unresolved intermittent: `quality.spec.ts`'s "nothing is written to the
console" test has twice failed with React error #418, a text hydration
mismatch, and has not been reproducible since. The note on that test records
what was ruled out. Both sightings were during unrelated work, so do not assume
your change caused it — check the note before spending an afternoon on it.
