'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { defaultParams, defaultPalette, encodeConfig, generators, getPalette, TAXONOMY, type Tag } from '@patternwall/core';
import { PatternImage } from './PatternImage';
import { Chip, Tag as TagPill } from './ui';
import { loadCollected, type CollectedItem } from '../lib/storage';
import type { RenderSpec } from '../lib/render';
import styles from './Gallery.module.css';

type SortKey = 'recent' | 'name' | 'collected';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'name', label: 'Name' },
  { value: 'collected', label: 'Collected' },
];

// Every card gets a different seed and palette so the gallery reads as a
// spread rather than as one pattern printed four times.
const CARD_PALETTES = ['obsidian', 'riso-pink', 'deep-teal', 'clay', 'neon-rain', 'sepia', 'prussian', 'pastel-mint', 'crt-amber', 'fog'];

function cardSpec(index: number, generatorId: string): RenderSpec {
  const g = generators.find((x) => x.id === generatorId)!;
  const palette = getPalette(CARD_PALETTES[index % CARD_PALETTES.length] as string) ?? defaultPalette;
  return {
    generatorId,
    seed: `card-${generatorId}`,
    params: defaultParams(g),
    palette,
    width: 300,
    height: 650,
    bleed: 0,
  };
}

export function Gallery() {
  const [activeTags, setActiveTags] = useState<Tag[]>([]);
  const [sort, setSort] = useState<SortKey>('recent');
  const [collected, setCollected] = useState<CollectedItem[]>([]);

  useEffect(() => {
    setCollected(loadCollected());
  }, []);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of collected) map.set(item.generatorId, (map.get(item.generatorId) ?? 0) + 1);
    return map;
  }, [collected]);

  const usedTags = useMemo(() => {
    const used = new Set<string>();
    for (const g of generators) for (const t of g.tags) used.add(t);
    return TAXONOMY.filter((t) => used.has(t));
  }, []);

  const shown = useMemo(() => {
    const list = generators
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => activeTags.length === 0 || activeTags.every((t) => g.tags.includes(t)));
    const sorted = [...list];
    if (sort === 'name') sorted.sort((a, b) => a.g.name.localeCompare(b.g.name));
    else if (sort === 'collected') sorted.sort((a, b) => (counts.get(b.g.id) ?? 0) - (counts.get(a.g.id) ?? 0) || a.g.name.localeCompare(b.g.name));
    else sorted.sort((a, b) => b.i - a.i);
    return sorted;
  }, [activeTags, sort, counts]);

  const toggleTag = (t: Tag) => setActiveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <div className={styles.page}>
      <div className={styles.masthead}>
        <h1 className={styles.title}>Patterns for a screen you look at four hundred times a day.</h1>
        <p className={styles.standfirst}>
          Every wallpaper here is a small program rather than a picture. Open one, move the controls, and it redraws — the
          same seed and the same settings always give you the same image, so a link is a wallpaper. <strong>Export at your
          phone&rsquo;s exact pixel size</strong>, with eight percent bleed so iOS&rsquo;s parallax never finds an edge.
        </p>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filter patterns by tag">
          <Chip on={activeTags.length === 0} onClick={() => setActiveTags([])}>
            All
          </Chip>
          {usedTags.map((t) => (
            <Chip key={t} on={activeTags.includes(t)} onClick={() => toggleTag(t)}>
              {t}
            </Chip>
          ))}
        </div>
        <div className={styles.sort}>
          <label htmlFor="gallery-sort">Sort</label>
          <select id="gallery-sort" className={styles.sortSelect} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Nothing matches all of those tags.</div>
          <p className={styles.emptyBody}>
            Tags combine with AND, so asking for both <em>isometric</em> and <em>organic</em> can easily come back empty.
            Remove one and try again.
          </p>
          <Chip onClick={() => setActiveTags([])}>Clear filters</Chip>
        </div>
      ) : (
        <ul className={styles.grid}>
          {shown.map(({ g, i }) => {
            const n = counts.get(g.id) ?? 0;
            const query = encodeConfig({
              generatorId: g.id,
              seed: `card-${g.id}`,
              params: defaultParams(g),
              palette: cardSpec(i, g.id).palette,
            });
            return (
              <li key={g.id} className={styles.card}>
                <Link className={styles.cardLink} href={`/p/${g.id}?${query}`}>
                  <div className={styles.thumb}>
                    <PatternImage spec={cardSpec(i, g.id)} alt={`${g.name}: ${g.tagline}`} className={styles.thumbImg} />
                    {n > 0 ? <span className={styles.count}>{n} saved</span> : null}
                  </div>
                </Link>
                <div className={styles.meta}>
                  <Link className={styles.cardLink} href={`/p/${g.id}?${query}`}>
                    <span className={styles.name}>{g.name}</span>
                  </Link>
                  <p className={styles.tagline}>{g.tagline}</p>
                  <div className={styles.tags}>
                    {g.tags.map((t) => (
                      <TagPill key={t}>{t}</TagPill>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.footNote}>
        <strong>Recent</strong> orders by when a pattern family joined the collection, newest first. <strong>Collected</strong>{' '}
        orders by how many of your saved configurations use each one. Nothing you make leaves this browser — saved
        configurations and palettes live in local storage, and there is no account to make.
      </p>
    </div>
  );
}
