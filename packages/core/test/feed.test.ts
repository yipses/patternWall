import { describe, expect, it } from 'vitest';
import {
  FEED_AHEAD,
  FEED_HISTORY,
  createRng,
  curatedPalettes,
  cyclePalette,
  feedReplace,
  feedReroll,
  feedRewind,
  feedStart,
  feedVerdict,
  generators,
  getGenerator,
  randomCard,
  renderToSvg,
  rerollCard,
  restoreFeed,
  retired,
  type FeedCard,
  type FeedState,
} from '../src/index.js';

/** A card maker that is deterministic per test and never repeats a card. */
function maker(seed = 1): () => FeedCard {
  const rng = createRng(seed);
  return () => randomCard(rng, generators);
}

const same = (a: FeedCard, b: FeedCard): boolean => JSON.stringify(a) === JSON.stringify(b);

describe('a random card', () => {
  it('is always something the app can draw, inside the ranges a person could set', () => {
    const make = maker(7);
    for (let i = 0; i < 40; i++) {
      const card = make();
      const g = getGenerator(card.generatorId);
      expect(g, `card ${i} names a pattern the app does not have`).toBeDefined();
      for (const spec of g!.params) {
        const v = card.params[spec.key];
        if (spec.type === 'number') {
          expect(typeof v).toBe('number');
          expect(v as number).toBeGreaterThanOrEqual(spec.min);
          expect(v as number).toBeLessThanOrEqual(spec.max);
          // On the lattice, or the slider and the share link disagree about it.
          const steps = ((v as number) - spec.min) / spec.step;
          expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
        }
        if (spec.type === 'select') expect(spec.options.map((o) => o.value)).toContain(v);
      }
      expect(() =>
        renderToSvg({ generator: g!, seed: card.seed, params: card.params, palette: card.palette, width: 120, height: 260, bleed: 0 }),
      ).not.toThrow();
    }
  });

  it('never draws a pattern that is not in the app', () => {
    // A retired pattern must not resolve from a URL or a saved item, and a
    // feed that dealt one would be showing a page the gallery says is gone.
    const make = maker(3);
    const retiredIds = new Set(retired.map((g) => g.id));
    for (let i = 0; i < 300; i++) expect(retiredIds.has(make().generatorId)).toBe(false);
  });

  it('reaches every pattern, every palette, and both ends of a range', () => {
    const make = maker(11);
    const seenPatterns = new Set<string>();
    const seenPalettes = new Set<string>();
    const divisions = new Set<number>();
    for (let i = 0; i < 1200; i++) {
      const c = make();
      seenPatterns.add(c.generatorId);
      seenPalettes.add(c.palette.id);
      if (c.generatorId === 'truchet-diagonals') divisions.add(c.params.arcCount as number);
    }
    expect([...seenPatterns].sort()).toEqual(generators.map((g) => g.id).sort());
    expect(seenPalettes.size).toBe(curatedPalettes.length);
    // Drawn over steps, so the ends are as likely as the middle. A draw over
    // the continuum then rounded would give each end half a step's worth.
    const spec = getGenerator('truchet-diagonals')!.params.find((p) => p.key === 'arcCount')!;
    if (spec.type !== 'number') throw new Error('arcCount is not a number');
    expect(divisions.has(spec.min)).toBe(true);
    expect(divisions.has(spec.max)).toBe(true);
  });
});

describe('a tap re-roll', () => {
  /*
   * The owner's rule, in their words: "when I tap on the screen and get a new
   * wallpaper, colour should change". It first shipped keeping the palette,
   * and a new wallpaper in the old colours was reported as the colours being
   * broken. Only the pattern holds.
   */
  it('keeps the pattern and changes the colours, every time', () => {
    const rng = createRng(5);
    let card = randomCard(rng, generators);
    const g = getGenerator(card.generatorId)!;
    for (let i = 0; i < 200; i++) {
      const next = rerollCard(card, g, rng);
      expect(next.generatorId).toBe(card.generatorId);
      // Every time, not usually: a tap whose colours stay put is the report.
      expect(next.palette.id, `tap ${i} kept the colours`).not.toBe(card.palette.id);
      expect(next.seed === card.seed && JSON.stringify(next.params) === JSON.stringify(card.params)).toBe(false);
      card = next;
    }
  });
});

describe('a palette flick', () => {
  const card = randomCard(createRng(2), generators);

  it('goes forward and comes back to where it was', () => {
    const on = { ...card, palette: curatedPalettes[3]! };
    expect(cyclePalette(cyclePalette(on, 1), -1).palette.id).toBe(on.palette.id);
  });

  it('walks the whole list and wraps', () => {
    let c = { ...card, palette: curatedPalettes[0]! };
    const seen = new Set<string>();
    for (let i = 0; i < curatedPalettes.length; i++) {
      seen.add(c.palette.id);
      c = cyclePalette(c, 1);
    }
    expect(seen.size).toBe(curatedPalettes.length);
    expect(c.palette.id).toBe(curatedPalettes[0]!.id);
  });

  it('leaves a palette that is not in the list, in both directions', () => {
    // A palette edited in the Colours sheet has an id nothing else has. One
    // direction doing nothing from there would read as a dead gesture.
    const custom = { ...card, palette: { ...curatedPalettes[0]!, id: 'custom-xyz' } };
    expect(cyclePalette(custom, 1).palette.id).toBe(curatedPalettes[0]!.id);
    expect(cyclePalette(custom, -1).palette.id).toBe(curatedPalettes[curatedPalettes.length - 1]!.id);
  });
});

describe('the feed never loses a card it showed you', () => {
  /*
   * The rule this exists for: every card is random, so one that is swiped
   * away is gone unless the feed remembers it. So the guard is not "rewind
   * does something" — it is that walking rewind all the way back replays
   * every card that was ever on screen, in reverse, whatever mixture of
   * skips, likes and re-rolls put them there.
   */
  it('rewinds through any mixture of skips, likes and re-rolls, card for card', () => {
    const make = maker(21);
    const rng = createRng(99);
    let s: FeedState = feedStart(make(), make);
    const shown: FeedCard[] = [s.current];

    const choices = rng;
    for (let i = 0; i < 30; i++) {
      const r = choices.int(0, 2);
      if (r === 0) s = feedVerdict(s, 'skip', make);
      else if (r === 1) s = feedVerdict(s, 'like', make, true);
      else s = feedReroll(s, rerollCard(s.current, getGenerator(s.current.generatorId)!, rng));
      shown.push(s.current);
    }

    for (let i = shown.length - 2; i >= 0; i--) {
      const { state, undone } = feedRewind(s);
      expect(undone, `rewind ran out at step ${i}`).not.toBeNull();
      expect(same(state.current, shown[i]!), `card ${i} did not come back`).toBe(true);
      s = state;
    }
    expect(feedRewind(s).undone).toBeNull();
  });

  it('puts the card you were looking at back in line, so skipping forward walks the same cards again', () => {
    const make = maker(4);
    let s = feedStart(make(), make);
    const a = s.current;
    s = feedVerdict(s, 'skip', make);
    const b = s.current;

    // Rewind from b to a. b had no verdict, so it must not be thrown away.
    s = feedRewind(s).state;
    expect(same(s.current, a)).toBe(true);
    s = feedVerdict(s, 'skip', make);
    expect(same(s.current, b), 'the card on screen at rewind was lost').toBe(true);
  });

  it('does not queue a re-rolled variant', () => {
    // What a re-roll displaced is a variant of the same card. Queueing it
    // would deal a near-duplicate a swipe later, which reads as a bug.
    const make = maker(8);
    let s = feedStart(make(), make);
    const queueBefore = s.queue.map((c) => JSON.stringify(c));
    s = feedReroll(s, rerollCard(s.current, getGenerator(s.current.generatorId)!, createRng(1)));
    s = feedRewind(s).state;
    expect(s.queue.map((c) => JSON.stringify(c))).toEqual(queueBefore);
  });

  it('reports whether a like added anything, so undoing it can take it back out', () => {
    const make = maker(6);
    let s = feedStart(make(), make);
    s = feedVerdict(s, 'like', make, true);
    expect(feedRewind(s).undone).toMatchObject({ kind: 'like', added: true });

    // Liked when it was already in the collection: undoing must not delete
    // the copy that was kept before.
    s = feedVerdict(feedRewind(s).state, 'like', make, false);
    expect(feedRewind(s).undone).toMatchObject({ kind: 'like', added: false });
  });

  it('keeps colours and adjustments out of history', () => {
    // A flick is undone by flicking back and a slider by moving it. Putting
    // them in history would make rewind walk back through colours before it
    // reached the card you swiped away by mistake.
    const make = maker(9);
    let s = feedStart(make(), make);
    s = feedVerdict(s, 'skip', make);
    s = feedReplace(s, cyclePalette(s.current, 1));
    s = feedReplace(s, cyclePalette(s.current, 1));
    expect(s.history).toHaveLength(1);
  });

  it('reaches fifty steps back, and no further', () => {
    const make = maker(12);
    let s = feedStart(make(), make);
    for (let i = 0; i < FEED_HISTORY + 20; i++) s = feedVerdict(s, 'skip', make);
    expect(s.history).toHaveLength(FEED_HISTORY);
    let undone = 0;
    while (feedRewind(s).undone) {
      s = feedRewind(s).state;
      undone++;
    }
    expect(undone).toBe(FEED_HISTORY);
  });

  it('always has cards drawn ahead', () => {
    const make = maker(13);
    let s = feedStart(make(), make);
    for (let i = 0; i < 10; i++) {
      expect(s.queue.length).toBeGreaterThanOrEqual(FEED_AHEAD);
      s = feedVerdict(s, i % 2 ? 'like' : 'skip', make);
    }
  });
});

describe('a feed read back from storage', () => {
  it('comes back exactly as it was', () => {
    // This is what makes an accidental Safari back-swipe, or iOS unloading
    // the tab, cost nothing.
    const make = maker(14);
    let s = feedStart(make(), make);
    s = feedVerdict(s, 'like', make, true);
    s = feedVerdict(s, 'skip', make);
    const back = restoreFeed(JSON.parse(JSON.stringify(s)), make);
    expect(back).toEqual(s);
  });

  it('drops a card for a pattern that is not in the app, and keeps the rest', () => {
    const make = maker(15);
    let s = feedStart(make(), make);
    s = feedVerdict(s, 'skip', make);
    s = feedVerdict(s, 'skip', make);
    const raw = JSON.parse(JSON.stringify(s));
    raw.history[0].card.generatorId = retired[0]!.id;
    const back = restoreFeed(raw, make)!;
    expect(back.history).toHaveLength(1);
    expect(back.current).toEqual(s.current);
  });

  it('starts over only when the card on screen cannot be read', () => {
    const make = maker(16);
    expect(restoreFeed({ current: { generatorId: 'no-such-pattern', seed: 'x' } }, make)).toBeNull();
    expect(restoreFeed('nonsense', make)).toBeNull();
    expect(restoreFeed(null, make)).toBeNull();
  });
});
