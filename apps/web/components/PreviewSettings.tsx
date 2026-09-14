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
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Zm0-2a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
          />
          <path
            fill="currentColor"
            d="m19.4 13-.1-1 1.6-1.3-1.6-2.8-2 .7-1.6-1-.3-2.1H12l-.3 2-1.7 1-1.9-.7-1.6 2.8L8.1 12l-.1 1-1.7 1.3 1.6 2.8 2-.7 1.6 1 .3 2.1h3.4l.3-2 1.7-1 1.9.7 1.6-2.8L19.4 13Z"
            opacity="0.55"
          />
        </svg>
      </button>

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
