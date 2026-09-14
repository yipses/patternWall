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
        {/* One path, one opacity. It was two: a full-strength ring for the hub
            over a 0.55 gear body, which composites into a bright ring with a
            grey disc inside it — the "strange dot, almost as if there's two
            icons" that was reported. The hub is the body's own hole now,
            subtracted with `evenodd` so it shows the button behind it, and
            nothing in here overlaps anything else. */}
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="m19.4 13-.1-1 1.6-1.3-1.6-2.8-2 .7-1.6-1-.3-2.1H12l-.3 2-1.7 1-1.9-.7-1.6 2.8L8.1 12l-.1 1-1.7 1.3 1.6 2.8 2-.7 1.6 1 .3 2.1h3.4l.3-2 1.7-1 1.9.7 1.6-2.8L19.4 13ZM12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z"
          />
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
