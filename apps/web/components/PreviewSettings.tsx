'use client';

import { GRID_SIZE, effectiveSpec, secondaryParams, type Generator, type ParamValue } from '@patternwall/core';
import { Control } from './ParamControls';
import { uiStyles as ui } from './ui';
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
export function PreviewSettings({
  generator,
  params,
  open,
  onToggle,
  onChange,
  onCommit,
  onNewSeed,
}: {
  generator: Generator;
  params: Record<string, ParamValue>;
  open: boolean;
  onToggle: () => void;
  onChange: (key: string, value: ParamValue) => void;
  onCommit: () => void;
  onNewSeed: () => void;
}) {
  const rest = secondaryParams(generator);

  return (
    <>
      <button
        type="button"
        className={styles.gear}
        aria-expanded={open}
        aria-label={open ? 'Hide the other controls' : 'Show the other controls'}
        data-testid="preview-settings"
        onClick={onToggle}
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
            onToggle();
          }}
        />
      ) : null}

      {open ? (
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
          <button type="button" className={`${ui.btn} ${ui.small} ${styles.seed}`} onClick={onNewSeed}>
            New seed
          </button>
        </div>
      ) : null}
    </>
  );
}
