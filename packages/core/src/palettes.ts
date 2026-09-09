/**
 * The curated palette library.
 *
 * These are hand-built, not generated. A generative system will happily give
 * you ten thousand colour schemes and about nine of them will be worth looking
 * at; the library is where the taste lives. Every entry below was chosen so
 * that white iOS clock numerals sit legibly on the upper third, and so that
 * the accents differ in lightness as well as in hue — a set that varies only
 * by hue collapses into mush the moment a pattern shrinks it to a 4px dot.
 */

import type { Palette } from './palette.js';

export const PALETTE_TAGS = [
  'warm',
  'muted',
  'high-contrast',
  'monochrome',
  'crt',
  'risograph',
  'earth',
  'neon',
  'pastel',
  'oled',
] as const;

export type PaletteTag = (typeof PALETTE_TAGS)[number];

type Seed = {
  id: string;
  name: string;
  background: string;
  ink: string;
  accents: string[];
  mode: 'light' | 'dark';
  tags: PaletteTag[];
  pair?: string;
};

const SEEDS: Seed[] = [
  // --- True-black OLED --------------------------------------------------
  { id: 'obsidian', name: 'Obsidian', background: '#000000', ink: '#f5f3ef', accents: ['#ff5c39', '#ffb03a', '#4f7cff'], mode: 'dark', tags: ['high-contrast', 'oled'], pair: 'paper' },
  { id: 'void-ember', name: 'Void Ember', background: '#000000', ink: '#e9e2d8', accents: ['#b3401f', '#f0a06a', '#6d2010'], mode: 'dark', tags: ['warm', 'oled'], pair: 'clay' },
  { id: 'ink-well', name: 'Ink Well', background: '#000000', ink: '#cfd6dd', accents: ['#2f6f9f', '#7fb3d5', '#163a53'], mode: 'dark', tags: ['muted', 'oled'], pair: 'indigo-wash' },
  { id: 'graphite', name: 'Graphite', background: '#000000', ink: '#dcdcdc', accents: ['#8a8a8a', '#4a4a4a', '#bdbdbd'], mode: 'dark', tags: ['monochrome', 'oled'], pair: 'monochrome-light' },
  { id: 'neon-rain', name: 'Neon Rain', background: '#000000', ink: '#eaffff', accents: ['#00f0c8', '#ff2e88', '#7a5cff'], mode: 'dark', tags: ['neon', 'oled'] },
  { id: 'ultra-black', name: 'Ultra Black', background: '#000000', ink: '#ffffff', accents: ['#ffffff', '#8c8c8c'], mode: 'dark', tags: ['monochrome', 'high-contrast', 'oled'] },
  { id: 'blackcurrant', name: 'Blackcurrant', background: '#000000', ink: '#efe4f5', accents: ['#a259d9', '#e05fa0', '#4a1f78'], mode: 'dark', tags: ['neon', 'oled'] },
  { id: 'gold-leaf', name: 'Gold Leaf', background: '#000000', ink: '#f3ead6', accents: ['#c9a227', '#8a6b12', '#efd88a'], mode: 'dark', tags: ['warm', 'muted', 'oled'] },

  // --- Dark, not black --------------------------------------------------
  { id: 'slate-dusk', name: 'Slate Dusk', background: '#12161c', ink: '#e6e9ee', accents: ['#6f8ba8', '#c9a227', '#3f5468'], mode: 'dark', tags: ['muted'], pair: 'fog' },
  { id: 'deep-teal', name: 'Deep Teal', background: '#06231f', ink: '#dff5ee', accents: ['#21b3a0', '#f2c14e', '#0e6c62'], mode: 'dark', tags: ['high-contrast'], pair: 'sea-glass' },
  { id: 'plum-smoke', name: 'Plum Smoke', background: '#17111c', ink: '#ece4f2', accents: ['#8f5fa8', '#d98cb0', '#4c2f5c'], mode: 'dark', tags: ['muted'], pair: 'rose-quartz' },
  { id: 'oxblood', name: 'Oxblood', background: '#1a0e0e', ink: '#f0e2dc', accents: ['#a83232', '#d97b4a', '#5c1f1f'], mode: 'dark', tags: ['warm', 'earth'] },
  { id: 'prussian', name: 'Prussian', background: '#0b1b2b', ink: '#e8eef5', accents: ['#1f6f8b', '#e5b769', '#9fc7d8'], mode: 'dark', tags: ['muted'] },
  { id: 'charcoal-rose', name: 'Charcoal Rose', background: '#191717', ink: '#f2ebe7', accents: ['#d98080', '#f0c9b8', '#7a5c5c'], mode: 'dark', tags: ['muted', 'warm'] },
  { id: 'bauhaus-night', name: 'Bauhaus Night', background: '#101014', ink: '#f5f5f0', accents: ['#e03a2f', '#f2c31c', '#1b6fd6'], mode: 'dark', tags: ['high-contrast'], pair: 'cobalt-paper' },
  { id: 'forest-floor', name: 'Forest Floor', background: '#1a1f16', ink: '#e2ead9', accents: ['#6f8f4f', '#c9a227', '#37502a'], mode: 'dark', tags: ['earth'], pair: 'lichen' },
  { id: 'copper-night', name: 'Copper Night', background: '#0f0d0c', ink: '#f0e4d8', accents: ['#c87137', '#e8b48a', '#8a4b22'], mode: 'dark', tags: ['warm', 'earth'] },
  { id: 'vapor', name: 'Vapor', background: '#14082a', ink: '#f2e6ff', accents: ['#ff4ecd', '#4ee0ff', '#ffe14e'], mode: 'dark', tags: ['neon'] },
  { id: 'acid', name: 'Acid', background: '#0a0f00', ink: '#eaffc7', accents: ['#c8ff00', '#00ffa8', '#ff3d00'], mode: 'dark', tags: ['neon', 'high-contrast'] },
  { id: 'sodium', name: 'Sodium', background: '#0d0b08', ink: '#ffe9c4', accents: ['#ffb703', '#fb8500', '#8ecae6'], mode: 'dark', tags: ['warm', 'neon'] },
  { id: 'midnight-sea', name: 'Midnight Sea', background: '#081a2c', ink: '#dbe9f4', accents: ['#3d7ea6', '#7fd1c1', '#123c5c'], mode: 'dark', tags: ['muted'] },
  { id: 'basalt', name: 'Basalt', background: '#16181a', ink: '#dfe2e4', accents: ['#5b6266', '#9aa3a8', '#2b3033'], mode: 'dark', tags: ['monochrome', 'muted'] },

  // --- CRT --------------------------------------------------------------
  { id: 'crt-green', name: 'CRT Green', background: '#001a0e', ink: '#b6ffcf', accents: ['#16ff77', '#0a9a4a', '#d9ffe8'], mode: 'dark', tags: ['crt', 'neon'] },
  { id: 'crt-amber', name: 'CRT Amber', background: '#180d00', ink: '#ffcf8a', accents: ['#ff9d20', '#a35c00', '#ffe6bf'], mode: 'dark', tags: ['crt', 'warm'] },
  { id: 'terminal-blue', name: 'Terminal Blue', background: '#000814', ink: '#9fd0ff', accents: ['#2f7dff', '#cfe6ff', '#0a3d7a'], mode: 'dark', tags: ['crt'] },
  { id: 'phosphor-white', name: 'Phosphor', background: '#0a0a0a', ink: '#eaeaea', accents: ['#c9f7ff', '#7fb8c4', '#3d5a60'], mode: 'dark', tags: ['crt', 'monochrome'] },

  // --- Light paper ------------------------------------------------------
  { id: 'paper', name: 'Paper', background: '#f6f3ec', ink: '#1c1a17', accents: ['#c2452d', '#2f5d50', '#d99e2b'], mode: 'light', tags: ['warm'], pair: 'obsidian' },
  { id: 'bone', name: 'Bone', background: '#efece4', ink: '#2a2926', accents: ['#7d7a70', '#4a4842', '#b3ae9f'], mode: 'light', tags: ['monochrome', 'muted'] },
  { id: 'monochrome-light', name: 'Monochrome', background: '#ffffff', ink: '#000000', accents: ['#8f8f8f', '#545454', '#c8c8c8'], mode: 'light', tags: ['monochrome', 'high-contrast'], pair: 'graphite' },
  { id: 'cobalt-paper', name: 'Cobalt Paper', background: '#f4f4f2', ink: '#16181d', accents: ['#1a44d8', '#d8341a', '#f0b400'], mode: 'light', tags: ['high-contrast'], pair: 'bauhaus-night' },
  { id: 'sepia', name: 'Sepia', background: '#f0e6d2', ink: '#3a2c1c', accents: ['#8c6239', '#c49a6c', '#5c4327'], mode: 'light', tags: ['warm', 'earth', 'muted'] },
  { id: 'fog', name: 'Fog', background: '#d9dcdd', ink: '#2b3133', accents: ['#8a9598', '#6b7679', '#b9c1c3'], mode: 'light', tags: ['muted', 'monochrome'], pair: 'slate-dusk' },
  { id: 'indigo-wash', name: 'Indigo Wash', background: '#dfe3ee', ink: '#232a45', accents: ['#4d5b93', '#8892c4', '#2a3565'], mode: 'light', tags: ['muted'], pair: 'ink-well' },

  // --- Risograph --------------------------------------------------------
  { id: 'riso-pink', name: 'Riso Pink', background: '#f5efe6', ink: '#2b2b2b', accents: ['#ff4f79', '#2b57ff', '#ffd400'], mode: 'light', tags: ['risograph', 'high-contrast'] },
  { id: 'riso-duo', name: 'Riso Duo', background: '#f2eee7', ink: '#232323', accents: ['#0d6b5f', '#ff7a3d'], mode: 'light', tags: ['risograph'] },
  { id: 'riso-violet', name: 'Riso Violet', background: '#f4f1ea', ink: '#242024', accents: ['#6a3df0', '#f24d6a', '#00b3a4'], mode: 'light', tags: ['risograph', 'high-contrast'] },

  // --- Earth ------------------------------------------------------------
  { id: 'clay', name: 'Clay', background: '#eee3d6', ink: '#3b2f26', accents: ['#b5654a', '#d8a05f', '#7a6a52'], mode: 'light', tags: ['earth', 'warm'], pair: 'void-ember' },
  { id: 'sandstone', name: 'Sandstone', background: '#e8dcc8', ink: '#33291d', accents: ['#a67c52', '#6b7f5e', '#cbb28a'], mode: 'light', tags: ['earth', 'muted'] },
  { id: 'lichen', name: 'Lichen', background: '#e6e9df', ink: '#2f3a2c', accents: ['#6f8f5a', '#45613b', '#b9c49f'], mode: 'light', tags: ['earth'], pair: 'forest-floor' },
  { id: 'dust', name: 'Dust', background: '#cfc7bb', ink: '#2e2a24', accents: ['#8e8577', '#5d564b', '#a89b88'], mode: 'light', tags: ['muted', 'earth'] },

  // --- Pastel -----------------------------------------------------------
  { id: 'pastel-morning', name: 'Pastel Morning', background: '#fdf6f0', ink: '#4a4038', accents: ['#f0a4b4', '#9ec7dd', '#e8cf87'], mode: 'light', tags: ['pastel'] },
  { id: 'pastel-mint', name: 'Pastel Mint', background: '#f2f8f4', ink: '#2f3d37', accents: ['#8ec9b2', '#e8b48a', '#a9b8e0'], mode: 'light', tags: ['pastel'] },
  { id: 'sea-glass', name: 'Sea Glass', background: '#eaf2f2', ink: '#24383a', accents: ['#5aa39d', '#2d6a6a', '#a9cfca'], mode: 'light', tags: ['pastel', 'muted'], pair: 'deep-teal' },
  { id: 'rose-quartz', name: 'Rose Quartz', background: '#f0e2e4', ink: '#3a2b2e', accents: ['#c07f8a', '#8c5f68', '#dfb9c0'], mode: 'light', tags: ['pastel', 'muted'], pair: 'plum-smoke' },
  { id: 'peach-fizz', name: 'Peach Fizz', background: '#fff2e8', ink: '#45322a', accents: ['#f27a45', '#f0b98f', '#6f8fa8'], mode: 'light', tags: ['pastel', 'warm'] },
];

function build(): Palette[] {
  const byId = new Map<string, Seed>();
  for (const s of SEEDS) byId.set(s.id, s);
  return SEEDS.map((s) => {
    const base: Palette = {
      id: s.id,
      name: s.name,
      background: s.background,
      ink: s.ink,
      accents: s.accents.slice(),
      mode: s.mode,
      tags: s.tags.slice(),
    };
    if (s.pair) {
      const other = byId.get(s.pair);
      if (other) {
        base.pair = {
          id: other.id,
          name: other.name,
          background: other.background,
          ink: other.ink,
          accents: other.accents.slice(),
          mode: other.mode,
          tags: other.tags.slice(),
        };
      }
    }
    return base;
  });
}

export const curatedPalettes: Palette[] = build();

export function getPalette(id: string): Palette | undefined {
  return curatedPalettes.find((p) => p.id === id);
}

/** The palette used whenever nothing else is specified or a lookup fails. */
export const defaultPalette: Palette = getPalette('obsidian') as Palette;
