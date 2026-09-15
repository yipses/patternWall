'use client';

import { GRID_SIZE, effectiveSpec, secondaryParams, type Generator, type Palette, type ParamValue } from '@patternwall/core';
import Link from 'next/link';
import { uiStyles as ui } from './ui';
import { PalettePanel } from './PalettePanel';
import { Control } from './ParamControls';
import styles from './PreviewSettings.module.css';

/**
 * The rest of the controls, on the picture.
 *
 * Three of a pattern's parameters are driven by the picture itself and live at
 * the top of the panel with their gesture written beside them. These are the
 * others, and on a phone the panel they used to sit in is a scroll away from
 * the thing it changes — so they come to the preview instead, behind a gear in
 * the corner.
 *
 * Name and slider, nothing else. Every parameter in this app carries a
 * paragraph explaining itself and those paragraphs are worth having, but not
 * here: a sheet over a phone preview has room for about four rows, and a
 * control you are already looking at the result of does not need to be
 * introduced. The explanations stay in the generator's own essay below.
 *
 * This is the only place these controls live. Rendering them here *and* in the
 * panel would put two sliders on one parameter, which is two things for
 * `getByLabel` to find and two places for a value to look stale.
 */
/** Which of the two sheets is up, if either. */
export type Sheet = 'settings' | 'palette' | null;

export function PreviewSettings({
  generator,
  params,
  palette,
  open,
  onOpen,
  onChange,
  onCommit,
  onNewSeed,
  onPalette,
  collected,
  onCollect,
  collectedHref,
}: {
  generator: Generator;
  params: Record<string, ParamValue>;
  palette: Palette;
  open: Sheet;
  onOpen: (sheet: Sheet) => void;
  onChange: (key: string, value: ParamValue) => void;
  onCommit: () => void;
  onNewSeed: () => void;
  onPalette: (p: Palette) => void;
  /** Whether what is on screen is already kept, which the heart shows. */
  collected: boolean;
  onCollect: () => void;
  /** Where the kept ones live. A real link, so it opens in a tab like one. */
  collectedHref: string;
}) {
  const rest = secondaryParams(generator);
  const toggle = (sheet: Exclude<Sheet, null>) => () => onOpen(open === sheet ? null : sheet);

  return (
    <>
      <div className={styles.buttons} data-hidden={open === 'palette' ? 'true' : undefined}>
        <Link className={styles.round} href={collectedHref} aria-label="Open your collection" data-testid="preview-book">
          {/* An open book: two leaves either side of a spine. Drawn as strokes
              rather than a filled block, so it stays a book at 19px instead of
              becoming a rounded rectangle like the die two places down. */}
          <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinejoin="round"
              d="M12 6.6C10.2 5.1 7.8 4.4 4.2 4.4v13c3.6 0 6 .7 7.8 2.2 1.8-1.5 4.2-2.2 7.8-2.2v-13c-3.6 0-6 .7-7.8 2.2Z"
            />
            <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" d="M12 6.6v13" />
          </svg>
        </Link>

        <button
          type="button"
          className={collected ? `${styles.round} ${styles.on}` : styles.round}
          aria-label={collected ? 'Already saved' : 'Save this wallpaper'}
          aria-pressed={collected}
          data-testid="preview-heart"
          onClick={onCollect}
        >
          {/* Outline until it is kept, then filled. The shape is the same path
              either way, so the only thing that changes is whether there is
              paint in it — which is the whole of what the button is saying. */}
          <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
            <path
              fill={collected ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinejoin="round"
              d="M12 20.4C5.6 16.3 2.6 12.9 2.6 9.4A4.9 4.9 0 0 1 12 7.3a4.9 4.9 0 0 1 9.4 2.1c0 3.5-3 6.9-9.4 11Z"
            />
          </svg>
        </button>

        <button
          type="button"
          className={styles.round}
          aria-expanded={open === 'palette'}
          aria-label={open === 'palette' ? 'Hide the palette' : 'Choose a palette'}
          data-testid="preview-palette"
          onClick={toggle('palette')}
        >
          {/* A droplet. Three swatches in a triangle was the other candidate
              and it loses on silhouette: beside a die, which is a rounded
              square full of pips, "three dots" is the shape a person has to
              look twice at. This is solid and unmistakable at the 19px it
              ships at, which is where it was compared — see the note on the
              cog below about checking an icon at a size that flatters it. */}
          <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M12 2.4c4.4 4.9 6.9 8.4 6.9 11.4a6.9 6.9 0 0 1-13.8 0c0-3 2.5-6.5 6.9-11.4Z" />
          </svg>
        </button>

        <button
          type="button"
          className={styles.round}
          aria-label="Draw a new seed"
          data-testid="preview-dice"
          onClick={onNewSeed}
        >
          {/* A die's three face. One path with `evenodd`, so the pips are the
              body's own holes rather than discs drawn over it — see the gear. */}
          <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M6 2.6h12A3.4 3.4 0 0 1 21.4 6v12a3.4 3.4 0 0 1-3.4 3.4H6A3.4 3.4 0 0 1 2.6 18V6A3.4 3.4 0 0 1 6 2.6ZM7.6 5.6a2 2 0 1 0 0 4a2 2 0 0 0 0-4ZM12 10a2 2 0 1 0 0 4a2 2 0 0 0 0-4ZM16.4 14.4a2 2 0 1 0 0 4a2 2 0 0 0 0-4Z"
            />
          </svg>
        </button>

        <button
          type="button"
          className={styles.round}
          aria-expanded={open === 'settings'}
          aria-label={open === 'settings' ? 'Hide the other controls' : 'Show the other controls'}
          data-testid="preview-settings"
          onClick={toggle('settings')}
        >
        {/* One path, one opacity, and proportions rather than coordinates
            typed out by hand. It was two paths — an opaque hub ring under a
            0.55 body — which composite into a bright annulus with a grey disc
            in it. Making the hub the body\'s own hole with `evenodd` fixed the
            compositing and not the reading: the teeth were stubby and the hub
            was wide, so at 19px it still came out a ring with bumps, and it
            was reported a second time as a circle. This cog is generated from
            a tip radius, a root radius and a hub — square teeth, small hub —
            and checked by rasterising it at the 19px it ships at rather than
            at a size nobody sees it. */}
          <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
            <path fill="currentColor" fillRule="evenodd" d="M19.41 9.57L22.77 9.77L22.77 14.23L19.41 14.43A7.8 7.8 0 0 1 18.96 15.52L21.19 18.04L18.04 21.19L15.52 18.96A7.8 7.8 0 0 1 14.43 19.41L14.23 22.77L9.77 22.77L9.57 19.41A7.8 7.8 0 0 1 8.48 18.96L5.96 21.19L2.81 18.04L5.04 15.52A7.8 7.8 0 0 1 4.59 14.43L1.23 14.23L1.23 9.77L4.59 9.57A7.8 7.8 0 0 1 5.04 8.48L2.81 5.96L5.96 2.81L8.48 5.04A7.8 7.8 0 0 1 9.57 4.59L9.77 1.23L14.23 1.23L14.43 4.59A7.8 7.8 0 0 1 15.52 5.04L18.04 2.81L21.19 5.96L18.96 8.48A7.8 7.8 0 0 1 19.41 9.57ZM12 9.30a2.7 2.7 0 1 0 0 5.40a2.7 2.7 0 1 0 0 -5.40Z" />
          </svg>
        </button>
      </div>

      {open ? (
        /* The rest of the preview is the gesture surface, so with the sheet
           open a press beside it cycled the tile set — which is the picture
           changing under a menu that is asking about something else. This
           takes the press instead and closes. It sits above the surface and
           below the sheet, so the sheet's own controls are untouched, and it
           closes on `pointerdown` rather than on click because the surface
           opens its gesture on the same event and only one of them can. */
        <div
          className={styles.scrim}
          data-testid="preview-settings-scrim"
          aria-hidden="true"
          onPointerDown={(e) => {
            e.preventDefault();
            onOpen(null);
          }}
        />
      ) : null}

      {open === 'settings' ? (
        <div className={styles.sheet} role="group" aria-label={`${generator.name} settings`}>
          <div className={styles.rows}>
            {rest.map((declared) => {
              const spec = effectiveSpec(generator, declared, params);
              return (
                <Control
                  key={spec.key}
                  spec={spec}
                  value={params[spec.key] ?? spec.default}
                  detail={GRID_SIZE}
                  compact
                  onChange={(v) => onChange(spec.key, v)}
                  onCommit={onCommit}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {/* The palette panel itself, over the picture rather than a scroll away
          from it. It is the same component the Palette tab renders and the
          same state behind both — colour is the one choice you judge entirely
          by looking at the preview, so it has to be reachable from there. */}
      {open === 'palette' ? (
        <div className={`${styles.sheet} ${styles.tall}`} role="group" aria-label="Palette">
          <PalettePanel palette={palette} onChange={onPalette} />
          {/* The rail is hidden while this is up, so the sheet can have the
              whole width — a palette library in a 177px column clips its own
              tab strip. That leaves nothing to press but the sliver of scrim
              around the edge, which is not an affordance. Hence a real way
              out, at the bottom where a thumb already is. */}
          <button type="button" className={`${ui.btn} ${styles.done}`} data-testid="preview-palette-done" onClick={() => onOpen(null)}>
            Done
          </button>
        </div>
      ) : null}
    </>
  );
}
