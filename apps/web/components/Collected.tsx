'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { encodeConfig, getGenerator } from '@patternwall/core';
import { PatternImage } from './PatternImage';
import { Button, uiStyles as ui } from './ui';
import { loadCollected, removeCollected, type CollectedItem } from '../lib/storage';
import styles from './Collected.module.css';

export function Collected() {
  const [items, setItems] = useState<CollectedItem[] | null>(null);

  useEffect(() => {
    setItems(loadCollected());
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>Collected</h1>
        <p className={styles.sub}>
          Configurations you saved, kept in this browser&rsquo;s local storage. Nothing here is uploaded anywhere, which also
          means it does not follow you to another device — copy a link if you want that.
        </p>
      </div>

      {items === null ? (
        <p className={ui.help}>Reading your collection…</p>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Nothing collected yet.</div>
          <p className={styles.emptyBody}>
            Open a pattern, get it to a state you like, and press <strong>Collect</strong>. It will show up here with its seed
            and palette intact, ready to re-open or export again.
          </p>
          <Link className={`${ui.btn} ${ui.primary}`} href="/">
            Browse the gallery
          </Link>
        </div>
      ) : (
        <ul className={styles.grid}>
          {items.map((item) => {
            const g = getGenerator(item.generatorId);
            if (!g) return null;
            const query = encodeConfig({ generatorId: g.id, seed: item.seed, params: item.params, palette: item.palette });
            return (
              <li key={item.id} className={styles.item}>
                <Link className={styles.thumbLink} href={`/p/${g.id}?${query}`}>
                  <PatternImage
                    spec={{ generatorId: g.id, seed: item.seed, params: item.params, palette: item.palette, width: 220, height: 477, bleed: 0 }}
                    alt={`${g.name} with the ${item.palette.name} palette, seed ${item.seed}`}
                    className={styles.thumb}
                  />
                </Link>
                <div className={styles.meta}>
                  <span className={styles.name}>{g.name}</span>
                  <span className={styles.when}>{new Date(item.savedAt).toLocaleDateString()}</span>
                </div>
                <span className={styles.seed}>
                  {item.palette.name} · {item.seed}
                </span>
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => setItems(removeCollected(item.id))}
                  aria-label={`Remove the saved ${g.name} configuration with seed ${item.seed}`}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
