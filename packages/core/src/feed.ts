/**
 * The swipe feed: random cards, and the history that makes them recoverable.
 *
 * Every card on the feed is drawn at random, so a card swiped away is gone for
 * good unless something remembers it — there is no gallery it came from and no
 * link anybody kept. That is the whole reason this module is more than a
 * random-number call. The history below is what rewind reads, and it is
 * written so that rewind can undo *every* change of card, not only a swipe:
 * a tap re-roll destroys the card on screen just as surely as a skip does.
 *
 * Pure, like everything in this package. The randomness comes in through a
 * seeded `Rng` and a `make` callback, so the app decides where entropy comes
 * from and the tests decide it does not.
 */
import { quantise } from './controls.js';
import { normalizePalette, type Palette } from './palette.js';
import { curatedPalettes, defaultPalette } from './palettes.js';
import type { Rng } from './rng.js';
import type { PatternConfig } from './share.js';
import { getGenerator } from './generators/index.js';
import { coerceParams, type Generator, type ParamSpec, type ParamValue } from './types.js';

export type FeedCard = PatternConfig;

/**
 * Narrower ranges for browsing, keyed `generatorId.paramKey`.
 *
 * Empty on purpose. A slider's range is what a person can reach deliberately;
 * the range a random card should be drawn from is a different and narrower
 * thing, because the extremes are where a pattern turns to grey noise or an
 * empty field and a feed full of those feels like work rather than browsing.
 * Setting them is its own pass, done by looking at renders, and this table is
 * where that pass lands — a data change, not a code change.
 */
export const BROWSE_RANGES: Record<string, { min: number; max: number }> = {};

const SEED_WORDS = [
  'ash', 'bergamot', 'cinder', 'delta', 'ember', 'fenn', 'glass', 'hollow', 'iris', 'juniper', 'kelp', 'lumen',
  'moss', 'nimbus', 'ochre', 'pewter', 'quill', 'reed', 'slate', 'tallow', 'umber', 'vellum', 'wick', 'yarrow',
] as const;

/** A readable seed, the same shape the editor's dice draws. */
export function randomSeedWord(rng: Rng): string {
  return `${rng.pick(SEED_WORDS)}-${rng.int(100, 999)}`;
}

/** One value for one parameter, anywhere a person could have put it. */
export function randomValue(generatorId: string, spec: ParamSpec, rng: Rng): ParamValue {
  switch (spec.type) {
    case 'number': {
      const narrowed = BROWSE_RANGES[`${generatorId}.${spec.key}`];
      const lo = Math.max(spec.min, narrowed?.min ?? spec.min);
      const hi = Math.min(spec.max, narrowed?.max ?? spec.max);
      // Drawn over steps rather than over the continuum, so both ends are as
      // likely as anything between them and every value lands on the lattice
      // the slider and the share link can both hold.
      const steps = Math.max(0, Math.round((hi - lo) / spec.step));
      return quantise(spec, lo + rng.int(0, steps) * spec.step);
    }
    case 'select':
      return spec.options.length > 0 ? rng.pick(spec.options).value : spec.default;
    case 'boolean':
      return rng.bool();
    case 'image':
      // A picture is an input somebody gives, not a setting to roll. No
      // registered pattern takes one; the default is the pattern's own answer.
      return spec.default;
  }
}

/**
 * Every parameter at random, then coerced.
 *
 * Coerced so that a range which depends on another parameter's value is
 * applied after that value is settled, the same second pass a decoded link
 * gets — nothing declares one today, and the next mode switch will.
 */
export function randomParams(g: Generator, rng: Rng): Record<string, ParamValue> {
  const raw: Record<string, ParamValue> = {};
  for (const spec of g.params) raw[spec.key] = randomValue(g.id, spec, rng);
  return coerceParams(g, raw);
}

/** A whole new card: pattern, settings, seed and palette, all drawn. */
export function randomCard(rng: Rng, pool: readonly Generator[], palettes: readonly Palette[] = curatedPalettes): FeedCard {
  const g = rng.pick(pool);
  return {
    generatorId: g.id,
    seed: randomSeedWord(rng),
    params: randomParams(g, rng),
    palette: palettes.length > 0 ? rng.pick(palettes) : defaultPalette,
  };
}

/**
 * The same pattern and the same colours, with new settings and a new seed.
 *
 * Keeping the palette is what makes a tap mean "more like this" rather than a
 * weaker skip: the two things a person judges first — which pattern, what
 * colours — stay put, and everything that makes this particular one hold
 * steady moves.
 */
export function rerollCard(card: FeedCard, g: Generator, rng: Rng): FeedCard {
  return { generatorId: card.generatorId, seed: randomSeedWord(rng), params: randomParams(g, rng), palette: card.palette };
}

/**
 * The next or previous curated palette.
 *
 * A card can hold a palette that is not in the list — one edited in the
 * Colours sheet — and stepping from it has to land somewhere; it lands on the
 * first curated one going forward and the last going back, so both directions
 * leave a custom palette rather than one of them doing nothing.
 */
export function cyclePalette(card: FeedCard, direction: 1 | -1, palettes: readonly Palette[] = curatedPalettes): FeedCard {
  if (palettes.length === 0) return card;
  const at = palettes.findIndex((p) => p.id === card.palette.id);
  const next = at === -1 ? (direction === 1 ? 0 : palettes.length - 1) : (at + direction + palettes.length) % palettes.length;
  return { ...card, palette: palettes[next] as Palette };
}

/* ---------------------------------------------------------------- history */

/** How far rewind reaches. Configurations are tiny, so this is generous. */
export const FEED_HISTORY = 50;

/** How many cards are drawn ahead, so a swipe never lands on nothing. */
export const FEED_AHEAD = 2;

/**
 * One change of card, and what was on screen before it.
 *
 * A like records whether it actually added anything, because rewinding it
 * takes the card back out of the collection — and a configuration that was
 * already kept before this like must not be deleted by undoing it.
 */
export type FeedStep =
  | { kind: 'skip'; card: FeedCard }
  | { kind: 'like'; card: FeedCard; added: boolean }
  | { kind: 'reroll'; card: FeedCard };

export interface FeedState {
  current: FeedCard;
  /** What comes next, front first. */
  queue: FeedCard[];
  /** Oldest first. The last entry is what rewind undoes. */
  history: FeedStep[];
}

const pushStep = (history: FeedStep[], step: FeedStep): FeedStep[] => [...history, step].slice(-FEED_HISTORY);

const fill = (queue: FeedCard[], make: () => FeedCard): FeedCard[] => {
  const next = [...queue];
  while (next.length < FEED_AHEAD) next.push(make());
  return next;
};

export function feedStart(first: FeedCard, make: () => FeedCard): FeedState {
  return { current: first, queue: fill([], make), history: [] };
}

/** A swipe, or a press on ✕ or ♥. The card leaves and the next one arrives. */
export function feedVerdict(s: FeedState, kind: 'skip' | 'like', make: () => FeedCard, added = false): FeedState {
  const [next, ...rest] = s.queue;
  const step: FeedStep = kind === 'like' ? { kind, card: s.current, added } : { kind, card: s.current };
  return { current: next ?? make(), queue: fill(rest, make), history: pushStep(s.history, step) };
}

/** A tap. The card on screen is replaced in place, and rewind can bring it back. */
export function feedReroll(s: FeedState, next: FeedCard): FeedState {
  return { ...s, current: next, history: pushStep(s.history, { kind: 'reroll', card: s.current }) };
}

/**
 * A change that is not a change of card: a palette flick, a slider in the
 * Adjust sheet. No history — a flick is reversed by flicking back, and a
 * slider by moving it — so rewind stays about cards.
 */
export function feedReplace(s: FeedState, card: FeedCard): FeedState {
  return { ...s, current: card };
}

/**
 * Put back what was on screen before, and undo whatever took it away.
 *
 * The card being looked at when rewind is pressed had no verdict, so it goes
 * back to the front of the queue rather than into the bin: rewinding and then
 * skipping forward walks the same line of cards again. A re-roll is the
 * exception, because what it displaced is a variant of the same card rather
 * than a different one, and queueing a near-duplicate would read as a bug.
 *
 * Returns the step it undid, so the caller can reverse what the reducer cannot
 * see — taking a liked card back out of the collection.
 */
export function feedRewind(s: FeedState): { state: FeedState; undone: FeedStep | null } {
  const last = s.history[s.history.length - 1];
  if (!last) return { state: s, undone: null };
  const history = s.history.slice(0, -1);
  if (last.kind === 'reroll') return { state: { current: last.card, queue: s.queue, history }, undone: last };
  return { state: { current: last.card, queue: [s.current, ...s.queue], history }, undone: last };
}

/* ------------------------------------------------------------ persistence */

/**
 * A card read back from storage, or null if it cannot be shown.
 *
 * Resolved through `getGenerator`, which deliberately does not search the
 * retired patterns — a card for a pattern that is not in the app must not
 * render a page the gallery says does not exist.
 */
export function restoreCard(raw: unknown): FeedCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.generatorId !== 'string' || typeof r.seed !== 'string') return null;
  const g = getGenerator(r.generatorId);
  if (!g) return null;
  const params = coerceParams(g, (r.params && typeof r.params === 'object' ? r.params : {}) as Record<string, unknown>);
  const read = normalizePalette((r.palette && typeof r.palette === 'object' ? r.palette : {}) as Partial<Palette>, defaultPalette);
  // Normalising keeps the colours and drops anything else, including a curated
  // palette's `pair` — its light or dark twin, which is what the Colours
  // sheet's "Swap to" reads. A card whose colours are still exactly a curated
  // palette's gets that palette back whole, so a restored card is the card
  // that was left rather than one that has quietly lost a button.
  const curated = curatedPalettes.find(
    (c) => c.id === read.id && c.background === read.background && c.ink === read.ink && c.accents.join() === read.accents.join(),
  );
  return { generatorId: g.id, seed: r.seed, params, palette: curated ?? read };
}

/**
 * A whole feed read back from storage.
 *
 * Anything unreadable is dropped rather than failing the lot: losing one old
 * history step is better than losing the card on screen, which is the thing
 * persisting exists to protect. Only an unreadable *current* card starts over.
 */
export function restoreFeed(raw: unknown, make: () => FeedCard): FeedState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const current = restoreCard(r.current);
  if (!current) return null;
  const queue = (Array.isArray(r.queue) ? r.queue : []).map(restoreCard).filter((c): c is FeedCard => c !== null);
  const history: FeedStep[] = [];
  for (const s of Array.isArray(r.history) ? r.history : []) {
    if (!s || typeof s !== 'object') continue;
    const step = s as Record<string, unknown>;
    const card = restoreCard(step.card);
    if (!card) continue;
    if (step.kind === 'skip' || step.kind === 'reroll') history.push({ kind: step.kind, card });
    else if (step.kind === 'like') history.push({ kind: 'like', card, added: step.added === true });
  }
  return { current, queue: fill(queue, make), history: history.slice(-FEED_HISTORY) };
}
