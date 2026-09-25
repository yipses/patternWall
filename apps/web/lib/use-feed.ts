'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createRng,
  cyclePalette,
  feedReplace,
  feedReroll,
  feedRewind,
  feedStart,
  feedVerdict,
  generators,
  getGenerator,
  initialConfig,
  randomCard,
  rerollCard,
  restoreFeed,
  type FeedCard,
  type FeedState,
  type FeedStep,
  type Palette,
  type ParamValue,
} from '@patternwall/core';
import { collectionKey, loadCollected, removeManyCollected, saveCollected, type CollectedItem } from './storage';

/**
 * Where the feed is kept between visits.
 *
 * localStorage rather than sessionStorage, and not for convenience. The two
 * ways this page most often dies are Safari's own edge swipe winning over a
 * card swipe, and iOS unloading a backgrounded tab — and after either, the
 * page must come back on the same card with the same history, or the browser
 * itself becomes the "gone forever" that rewind exists to prevent.
 */
const FEED_KEY = 'patternwall.feed.v1';

/** Which one-time hints have been shown. See the first-run notes in Feed. */
const HINTS_KEY = 'patternwall.feed.hints.v1';

export interface FeedHints {
  nudged: boolean;
  tipped: boolean;
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or a full store. The feed still works; it just will not
    // survive the tab, which is the degraded mode storage.ts settles on too.
  }
}

/**
 * Entropy for the card maker.
 *
 * The one place `Math.random` is allowed near a render: core is pure and takes
 * a seeded stream, and this is where the app decides the stream is not the
 * same every visit.
 */
function entropy(): number {
  return Math.floor(Math.random() * 0x100000000);
}

export type LikeResult = 'liked' | 'failed';

/**
 * The feed's state and every way it can change.
 *
 * Null until mounted, deliberately. The static export prerenders this page,
 * and anything random or read from storage during that render disagrees with
 * the baked HTML — a text hydration mismatch, the class of bug this repo has
 * already paid for twice. So the first paint is the ground, and the card
 * arrives in an effect.
 */
export function useFeed() {
  const rng = useMemo(() => createRng(entropy()), []);
  const make = useCallback((): FeedCard => randomCard(rng, generators), [rng]);

  const [feed, setFeed] = useState<FeedState | null>(null);
  const [latestSaved, setLatestSaved] = useState<CollectedItem | null>(null);
  const [hints, setHints] = useState<FeedHints>({ nudged: true, tipped: true });

  /*
   * Written synchronously on every change, because the actions below can run
   * several times before React re-renders — two quick taps, or a verdict
   * landing while a palette flick is still settling. Reading `feed` from a
   * closure would apply the second change to the state before the first.
   * The same trap CLAUDE.md records for the editor's selects.
   */
  const ref = useRef<FeedState | null>(null);
  const commit = useCallback((next: FeedState) => {
    ref.current = next;
    setFeed(next);
    writeJson(FEED_KEY, next);
  }, []);

  useEffect(() => {
    const restored = restoreFeed(readJson(FEED_KEY), make);
    // The first card anyone sees is a pattern's own opening configuration
    // rather than a random draw, so a first impression does not depend on the
    // dice. Hand-picked openers belong to the ranges pass; until then this is
    // the known-good one.
    commit(restored ?? feedStart(initialConfig(generators[0]!.id), make));
    setLatestSaved(loadCollected()[0] ?? null);
    const h = readJson(HINTS_KEY) as Partial<FeedHints> | null;
    setHints({ nudged: h?.nudged === true, tipped: h?.tipped === true });
  }, [commit, make]);

  const markHint = useCallback((which: keyof FeedHints) => {
    setHints((h) => {
      const next = { ...h, [which]: true };
      writeJson(HINTS_KEY, next);
      return next;
    });
  }, []);

  const skip = useCallback(() => {
    const s = ref.current;
    if (s) commit(feedVerdict(s, 'skip', make));
  }, [commit, make]);

  /**
   * Keep it, and move on — unless keeping it failed, in which case stay.
   *
   * Advancing past a card that did not save would be the worst outcome on the
   * screen: the person asked to keep it and it is gone. So a failed write
   * reports back and the card stays where it is.
   */
  const like = useCallback((): LikeResult => {
    const s = ref.current;
    if (!s) return 'failed';
    const key = collectionKey(s.current);
    const before = loadCollected().some((i) => i.id === key);
    const result = saveCollected(s.current);
    if (!result.ok) return 'failed';
    setLatestSaved(result.items[0] ?? null);
    commit(feedVerdict(s, 'like', make, !before));
    return 'liked';
  }, [commit, make]);

  /** A tap: a new wallpaper in the same pattern — new settings, seed and colours. */
  const reroll = useCallback(() => {
    const s = ref.current;
    if (!s) return;
    const g = getGenerator(s.current.generatorId);
    if (!g) return;
    commit(feedReroll(s, rerollCard(s.current, g, rng)));
  }, [commit, rng]);

  /**
   * Put back what was on screen before, and undo whatever took it away —
   * including taking a liked card back out of the collection, but only if
   * this like is what put it there.
   */
  const rewind = useCallback((): FeedStep | null => {
    const s = ref.current;
    if (!s) return null;
    const { state, undone } = feedRewind(s);
    if (!undone) return null;
    if (undone.kind === 'like' && undone.added) {
      const { items } = removeManyCollected([collectionKey(undone.card)]);
      setLatestSaved(items[0] ?? null);
    }
    commit(state);
    return undone;
  }, [commit]);

  const flickPalette = useCallback(
    (direction: 1 | -1): Palette | null => {
      const s = ref.current;
      if (!s) return null;
      const next = cyclePalette(s.current, direction);
      commit(feedReplace(s, next));
      return next.palette;
    },
    [commit],
  );

  const setPalette = useCallback(
    (palette: Palette) => {
      const s = ref.current;
      if (s) commit(feedReplace(s, { ...s.current, palette }));
    },
    [commit],
  );

  const setParam = useCallback(
    (key: string, value: ParamValue) => {
      const s = ref.current;
      if (s) commit(feedReplace(s, { ...s.current, params: { ...s.current.params, [key]: value } }));
    },
    [commit],
  );

  return { feed, latestSaved, hints, markHint, skip, like, reroll, rewind, flickPalette, setPalette, setParam };
}
