'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  accent,
  checkPalette,
  curatedPalettes,
  hashSeed,
  hexToOklch,
  isHex,
  oklchToHex,
  PALETTE_TAGS,
  type Palette,
  type PaletteTag,
} from '@patternwall/core';
import { Button, Chip, Notice, TabList, uiStyles as ui } from './ui';
import { HARMONY_SCHEMES, harmonyPalette, type HarmonyScheme } from '../lib/harmony';
import { extractPalette, loadImageFile } from '../lib/extract';
import { loadSavedPalettes, removePalette, savePalette } from '../lib/storage';
import styles from './PalettePanel.module.css';

type PaletteTabKey = 'library' | 'edit' | 'harmony' | 'photo';

const TABS: { value: PaletteTabKey; label: string }[] = [
  { value: 'library', label: 'Library' },
  { value: 'edit', label: 'Colours' },
  { value: 'harmony', label: 'Harmony' },
  { value: 'photo', label: 'From a photo' },
];

function Strip({ palette, className }: { palette: Palette; className?: string }) {
  return (
    <div className={className ?? styles.strip}>
      <span className={styles.stripCell} style={{ background: palette.background }} />
      <span className={styles.stripCell} style={{ background: palette.ink }} />
      {palette.accents.map((a, i) => (
        <span key={`${a}-${i}`} className={styles.stripCell} style={{ background: a }} />
      ))}
    </div>
  );
}

function OklchSliders({ hex, onChange }: { hex: string; onChange: (hex: string) => void }) {
  const c = hexToOklch(hex);
  const rows: { key: 'l' | 'c' | 'h'; label: string; min: number; max: number; step: number; value: number }[] = [
    { key: 'l', label: 'L', min: 0, max: 1, step: 0.005, value: c.l },
    { key: 'c', label: 'C', min: 0, max: 0.37, step: 0.002, value: c.c },
    { key: 'h', label: 'H', min: 0, max: 360, step: 1, value: c.h },
  ];
  return (
    <div className={styles.sliders}>
      {rows.map((row) => (
        <div className={styles.sliderRow} key={row.key}>
          <span aria-hidden="true">{row.label}</span>
          <input
            className={ui.range}
            type="range"
            min={row.min}
            max={row.max}
            step={row.step}
            value={row.value}
            aria-label={`${row.key === 'l' ? 'Lightness' : row.key === 'c' ? 'Chroma' : 'Hue'} of ${hex}`}
            onChange={(e) => onChange(oklchToHex({ ...c, [row.key]: Number(e.target.value) }))}
          />
          <span>{row.key === 'h' ? Math.round(row.value) : row.value.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

function ColourSlot({
  label,
  hex,
  onChange,
  onRemove,
}: {
  label: string;
  hex: string;
  onChange: (hex: string) => void;
  onRemove?: () => void;
}) {
  const [draft, setDraft] = useState(hex);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setDraft(hex);
    setBad(false);
  }, [hex]);

  const apply = (value: string): boolean => {
    const v = value.startsWith('#') ? value : `#${value}`;
    // isHex still accepts four and eight digits, and oklchToHex round-trips the
    // alpha, so the blur path has to refuse them too or it would put back what
    // the typing path just declined to take.
    if (v.length === 5 || v.length === 9) return false;
    if (!isHex(v)) return false;
    setBad(false);
    onChange(oklchToHex(hexToOklch(v)));
    return true;
  };

  /**
   * Committing on every keystroke made a six-digit hex impossible to type.
   * `isHex` accepts the three-digit shorthand, so `#1a2` committed the moment
   * it was typed, the parent normalised it to `#11aa22`, and the effect above
   * replaced the draft mid-word — typing `#1a2b3c` one character at a time left
   * `#11aa22b3c` in the field, flagged invalid.
   *
   * So the live commit waits for a length that cannot be a prefix of something
   * longer: six digits. The three-digit shorthand still works, on blur or
   * Enter, which is also where anything unparseable reverts. Nothing is marked
   * invalid while it is still being typed — an incomplete colour is not a wrong
   * one.
   *
   * Eight digits used to be accepted here. Alpha is not carried through the
   * renderer or the share encoding, so offering it meant a colour that looked
   * one way in the preview and another through its own link. It is now refused
   * at the field, which is the only place it could be typed.
   */
  const commitWhileTyping = (value: string) => {
    const digits = (value.startsWith('#') ? value.slice(1) : value).trim();
    // Flagged only for something that cannot become a colour however much more
    // is typed: a character outside the hex alphabet, or more than eight
    // digits. A half-typed value is incomplete, not wrong, and marking it red
    // on the way past three characters is what the old commit-per-keystroke
    // did. This keeps the invalid state meaningful rather than leaving it
    // permanently off.
    setBad(digits.length > 6 || !/^[0-9a-fA-F]*$/.test(digits));
    if (digits.length === 6) apply(value);
  };

  const commitFinal = () => {
    if (apply(draft)) return;
    setDraft(hex);
    setBad(false);
  };

  return (
    <div className={styles.slot}>
      <div className={styles.slotHead}>
        <span className={styles.slotLabel}>{label}</span>
        <input
          className={styles.swatchInput}
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000'}
          aria-label={`${label} colour picker`}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
        />
        <input
          className={bad ? `${styles.hexInput} ${styles.hexBad}` : styles.hexInput}
          value={draft}
          spellCheck={false}
          aria-label={`${label} hex value`}
          aria-invalid={bad || undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            commitWhileTyping(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={commitFinal}
        />
        {onRemove ? (
          <Button variant="ghost" size="small" onClick={onRemove} aria-label={`Remove ${label}`}>
            Remove
          </Button>
        ) : null}
      </div>
      <OklchSliders hex={hex} onChange={onChange} />
      {bad ? (
        <p className={ui.help} role="alert">
          That is not a hex colour. Try something like #1a2b3c.
        </p>
      ) : null}
    </div>
  );
}

export function PalettePanel({ palette, onChange }: { palette: Palette; onChange: (p: Palette) => void }) {
  const [tab, setTab] = useState<PaletteTabKey>('library');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<PaletteTag | null>(null);
  const [saved, setSaved] = useState<Palette[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');

  const [harmonySeed, setHarmonySeed] = useState('#e0a458');
  const [scheme, setScheme] = useState<HarmonyScheme>('analogous');

  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoStops, setPhotoStops] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSaved(loadSavedPalettes());
  }, []);

  useEffect(() => {
    if (saveState === 'idle') return;
    const id = window.setTimeout(() => setSaveState('idle'), 2400);
    return () => window.clearTimeout(id);
  }, [saveState]);

  const warnings = useMemo(() => checkPalette(palette).filter((w) => !dismissed.includes(w.id)), [palette, dismissed]);

  const library = useMemo(() => {
    const all = [...saved.map((p) => ({ p, saved: true })), ...curatedPalettes.map((p) => ({ p, saved: false }))];
    const q = query.trim().toLowerCase();
    return all.filter(({ p }) => {
      if (tagFilter && !(p.tags ?? []).includes(tagFilter)) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.tags ?? []).some((t) => t.includes(q));
    });
  }, [saved, query, tagFilter]);

  const setAccent = (i: number, hex: string) => {
    const accents = palette.accents.slice();
    accents[i] = hex;
    onChange({ ...palette, id: 'custom', name: 'Custom', accents });
  };

  const harmony = useMemo(() => harmonyPalette(harmonySeed, scheme, palette.mode), [harmonySeed, scheme, palette.mode]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const img = await loadImageFile(file);
      const { palette: extracted, stops } = extractPalette(img, file.name.replace(/\.[^.]+$/, '') || 'From photo');
      setPhotoStops(stops);
      setPhotoUrl(img.src);
      onChange({ ...extracted, id: 'custom' });
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'That image could not be read.');
      setPhotoStops([]);
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <div className={styles.panel}>
      {warnings.map((w) => (
        <Notice key={w.id} level={w.level === 'warn' ? 'warn' : 'info'} onDismiss={() => setDismissed((d) => [...d, w.id])}>
          {w.message}
        </Notice>
      ))}

      <div className={styles.current}>
        <div className={styles.currentTop}>
          <span className={styles.currentName}>{palette.name}</span>
          <Button
            size="small"
            onClick={() => onChange({ ...palette, mode: palette.mode === 'dark' ? 'light' : 'dark' })}
            aria-label={`Mark this palette as ${palette.mode === 'dark' ? 'light' : 'dark'}`}
          >
            {palette.mode === 'dark' ? 'Dark' : 'Light'}
          </Button>
        </div>
        <Strip palette={palette} />
        <div className={styles.actions}>
          {palette.pair ? (
            <Button
              size="small"
              onClick={() => {
                const { pair, ...rest } = palette;
                if (pair) onChange({ ...pair, pair: rest });
              }}
            >
              Swap to {palette.pair.name}
            </Button>
          ) : null}
          <Button
            size="small"
            success={saveState === 'saved'}
            onClick={() => {
              // Keyed on the palette's colours, not the clock. Two saves in
              // the same millisecond produced the same id, which meant
              // duplicate React keys in the library and a Delete that removed
              // both. Content also makes saving the same palette twice an
              // update rather than a duplicate, which savePalette already
              // handles by id.
              const id = `saved-${hashSeed(`${palette.background}|${palette.ink}|${palette.accents.join('')}`).toString(36)}`;
              const name = palette.name === 'Custom' ? `Custom ${new Date().toLocaleDateString()}` : palette.name;
              const result = savePalette({ ...palette, id, name, tags: [...(palette.tags ?? []), 'saved'] });
              setSaved(result.items);
              setSaveState(result.ok ? 'saved' : 'failed');
            }}
          >
            {saveState === 'saved' ? 'Saved' : 'Save palette'}
          </Button>
        </div>
        {saveState === 'failed' ? (
          <Notice level="error">This browser would not let the palette be stored — private browsing or a full quota will do that.</Notice>
        ) : null}
      </div>

      <TabList
        label="Palette tools"
        tabs={TABS}
        value={tab}
        onChange={setTab}
        idFor={(v) => `ptab-${v}`}
        panelIdFor={(v) => `ppanel-${v}`}
        className={styles.tabs}
        tabClassName={(on) => (on ? `${styles.tab} ${styles.tabOn}` : styles.tab)}
      />

      {tab === 'library' ? (
        <div role="tabpanel" id="ppanel-library" aria-labelledby="ptab-library" tabIndex={0}>
          <div className={styles.search}>
            <input
              className={ui.input}
              type="search"
              placeholder="Search palettes"
              value={query}
              aria-label="Search palettes by name or tag"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className={styles.tagRow}>
            <Chip on={tagFilter === null} onClick={() => setTagFilter(null)}>
              All
            </Chip>
            {PALETTE_TAGS.map((t) => (
              <Chip key={t} on={tagFilter === t} onClick={() => setTagFilter(tagFilter === t ? null : t)}>
                {t}
              </Chip>
            ))}
          </div>
          {library.length === 0 ? (
            <Notice>
              No palettes match that. <button className={ui.btn + ' ' + ui.small} type="button" onClick={() => { setQuery(''); setTagFilter(null); }}>Clear the filters</button>
            </Notice>
          ) : (
            <ul className={styles.libGrid}>
              {library.map(({ p, saved: isSaved }) => (
                <li key={`${isSaved ? 's' : 'c'}-${p.id}`} className={styles.libItem}>
                  <button
                    type="button"
                    className={p.background === palette.background && p.accents.join() === palette.accents.join() ? `${styles.libBtn} ${styles.libOn}` : styles.libBtn}
                    onClick={() => onChange({ ...p })}
                    aria-label={`Use the ${p.name} palette`}
                  >
                    <span className={styles.libStrip}>
                      <span style={{ background: p.background }} />
                      <span style={{ background: p.ink }} />
                      {p.accents.map((a, i) => (
                        <span key={i} style={{ background: a }} />
                      ))}
                    </span>
                    <span className={styles.libName}>{p.name}</span>
                  </button>
                  {isSaved ? (
                    <button
                      type="button"
                      className={styles.libDelete}
                      aria-label={`Delete the saved palette ${p.name}`}
                      onClick={() => setSaved(removePalette(p.id))}
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === 'edit' ? (
        <div role="tabpanel" id="ppanel-edit" aria-labelledby="ptab-edit" tabIndex={0}>
          <p className={styles.hint}>
            Hex is what you paste; OKLCH is what you tune. Moving L alone changes only how light a colour is, which is the
            control you actually want when a mark is disappearing into the background.
          </p>
          <ColourSlot label="Background" hex={palette.background} onChange={(hex) => onChange({ ...palette, id: 'custom', name: 'Custom', background: hex })} />
          <ColourSlot label="Ink" hex={palette.ink} onChange={(hex) => onChange({ ...palette, id: 'custom', name: 'Custom', ink: hex })} />
          {palette.accents.map((a, i) => (
            <ColourSlot
              key={i}
              label={`Accent ${i + 1}`}
              hex={a}
              onChange={(hex) => setAccent(i, hex)}
              onRemove={
                palette.accents.length > 1
                  ? () => onChange({ ...palette, id: 'custom', name: 'Custom', accents: palette.accents.filter((_, j) => j !== i) })
                  : undefined
              }
            />
          ))}
          {palette.accents.length < 4 ? (
            <Button
              size="small"
              onClick={() =>
                onChange({ ...palette, id: 'custom', name: 'Custom', accents: [...palette.accents, accent(palette, palette.accents.length - 1)] })
              }
            >
              Add an accent
            </Button>
          ) : (
            <p className={ui.help}>Four accents is the ceiling. Generators wrap the list, so more would only repeat.</p>
          )}
        </div>
      ) : null}

      {tab === 'harmony' ? (
        <div role="tabpanel" id="ppanel-harmony" aria-labelledby="ptab-harmony" tabIndex={0}>
          <p className={styles.hint}>
            Pick one colour you like and take the rest from the hue wheel. Each set also walks lightness, so the accents stay
            apart once iOS blurs and dims them behind the app grid.
          </p>
          <div className={ui.field}>
            <div className={ui.labelRow}>
              <label className={ui.label} htmlFor="harmony-seed">
                Seed colour
              </label>
              <span className={ui.value}>{harmonySeed}</span>
            </div>
            <div className={styles.slotHead}>
              <input
                id="harmony-seed"
                className={styles.swatchInput}
                type="color"
                value={harmonySeed}
                onChange={(e) => setHarmonySeed(e.target.value.toLowerCase())}
              />
              <input
                className={styles.hexInput}
                value={harmonySeed}
                aria-label="Seed colour hex value"
                spellCheck={false}
                onChange={(e) => {
                  const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                  if (isHex(v)) setHarmonySeed(v.toLowerCase());
                }}
              />
            </div>
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="harmony-scheme">
              Scheme
            </label>
            <select id="harmony-scheme" className={ui.select} value={scheme} onChange={(e) => setScheme(e.target.value as HarmonyScheme)}>
              {HARMONY_SCHEMES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className={ui.help}>{HARMONY_SCHEMES.find((s) => s.value === scheme)?.hint}</p>
          </div>
          <Strip palette={harmony} />
          <div className={styles.actions}>
            <Button variant="primary" size="small" onClick={() => onChange({ ...harmony, id: 'custom' })}>
              Use this palette
            </Button>
          </div>
        </div>
      ) : null}

      {tab === 'photo' ? (
        <div role="tabpanel" id="ppanel-photo" aria-labelledby="ptab-photo" tabIndex={0}>
          <p className={styles.hint}>
            The image is scaled down to about 120 pixels on its long edge, converted to OKLCH and clustered into five stops.
            Clustering perceptually rather than in RGB is the difference between getting the colours you can see in the
            photograph and getting five slightly different greys. Nothing is uploaded — it is all done in this tab.
          </p>
          <div className={styles.dropZone}>
            Choose a photograph to read a palette from.
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              aria-label="Choose an image to extract a palette from"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
              }}
            />
          </div>
          {photoBusy ? <Notice>Reading colours…</Notice> : null}
          {photoError ? <Notice level="error">{photoError}</Notice> : null}
          {photoUrl && photoStops.length > 0 ? (
            <div className={styles.thumbRow}>
              {/* The user's own local image, shown back to them for confirmation. */}
              <img className={styles.thumb} src={photoUrl} alt="The photograph the palette was read from" />
              <div>
                <div className={styles.stops}>
                  {photoStops.map((s, i) => (
                    <span key={i} className={styles.stop} style={{ background: s }} title={s} />
                  ))}
                </div>
                <p className={ui.help}>
                  Five stops, darkest to lightest. The extremes became the background and the ink; the middle three became
                  accents, ordered by how much of the image they cover.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
