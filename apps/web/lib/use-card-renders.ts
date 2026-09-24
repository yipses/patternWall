'use client';

import { useEffect, useRef, useState } from 'react';
import type { FeedCard } from '@patternwall/core';
import type { RenderSpec } from './render';
import { isSuperseded, renderDataUrl, renderDataUrlAsync } from './render-client';

/**
 * The cards the feed is about to show, drawn before they are shown.
 *
 * A swipe has to reveal a finished picture underneath, and some patterns take
 * the better part of a second to draw — so the queue is drawn while the person
 * is still looking at the current card. This hook owns that: it asks the
 * worker for every card it is given, keeps the answers, and forgets the ones
 * that have left.
 *
 * Two channels, and the split is the point. The card on screen is re-drawn on
 * every tap, flick and slider move, and only the newest of those is worth
 * finishing — so it goes on a channel that supersedes what is queued behind
 * it. Cards ahead are each wanted exactly once and must never cancel one
 * another, so they go on none.
 */
export function specFor(card: FeedCard, size: { w: number; h: number }): RenderSpec {
  return { generatorId: card.generatorId, seed: card.seed, params: card.params, palette: card.palette, width: size.w, height: size.h, bleed: 0 };
}

export function cardKey(card: FeedCard, size: { w: number; h: number }): string {
  return `${card.generatorId}|${card.seed}|${size.w}x${size.h}|${JSON.stringify(card.params)}|${JSON.stringify(card.palette)}`;
}

/** How many finished pictures are kept beyond the ones currently wanted. */
const SPARE = 6;

export function useCardRenders(current: FeedCard | null, ahead: readonly FeedCard[], size: { w: number; h: number } | null) {
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  const [failed, setFailed] = useState<Map<string, string>>(() => new Map());
  const pending = useRef(new Set<string>());
  const order = useRef<string[]>([]);

  useEffect(() => {
    if (!size) return;
    const wanted: { card: FeedCard; channel?: string }[] = [];
    if (current) wanted.push({ card: current, channel: 'feed-current' });
    for (const card of ahead) wanted.push({ card });

    for (const { card, channel } of wanted) {
      const key = cardKey(card, size);
      if (urls.has(key) || pending.current.has(key)) continue;
      pending.current.add(key);
      const spec = specFor(card, size);
      renderDataUrlAsync(spec, channel ? { channel } : undefined)
        .then((url) => store(key, url))
        .catch((err: Error) => {
          pending.current.delete(key);
          if (isSuperseded(err)) return;
          // The worker could not be had at all. Drawing inline blocks the
          // main thread, and a picture late is still better than none.
          if (err.message === 'render worker unavailable') {
            try {
              store(key, renderDataUrl(spec));
              return;
            } catch (inner) {
              err = inner instanceof Error ? inner : err;
            }
          }
          setFailed((m) => new Map(m).set(key, err.message));
        });
    }

    function store(key: string, url: string): void {
      pending.current.delete(key);
      order.current = [...order.current.filter((k) => k !== key), key];
      setUrls((prev) => {
        const next = new Map(prev).set(key, url);
        // Keep what is wanted and a few of the most recent besides, so a
        // rewind lands on a picture that is already drawn. Data URLs of a
        // dense pattern run to megabytes, so nothing is kept forever.
        const keep = new Set([...wanted.map((w) => cardKey(w.card, size!)), ...order.current.slice(-SPARE)]);
        for (const k of next.keys()) if (!keep.has(k)) next.delete(k);
        return next;
      });
    }
    // `urls` is read to skip what is already drawn, not to re-run on every
    // arrival — re-running would re-request nothing and cost a pass per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, ahead, size]);

  const urlOf = (card: FeedCard | null | undefined): string | undefined => (card && size ? urls.get(cardKey(card, size)) : undefined);
  const errorOf = (card: FeedCard | null | undefined): string | undefined => (card && size ? failed.get(cardKey(card, size)) : undefined);
  return { urlOf, errorOf };
}
