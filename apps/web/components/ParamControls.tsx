'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  GRID_SIZE,
  effectiveSpec,
  resolvePrimaries,
  secondaryParams,
  type Generator,
  type ParamSpec,
  type ParamValue,
  type PrimaryRole,
} from '@patternwall/core';
import { loadImageFile } from '../lib/extract';
import { formatValue } from '../lib/format';
import { imageToGrid } from '../lib/to-grid';
import { Switch, uiStyles as ui } from './ui';

/**
 * The picture control.
 *
 * Reading the file is asynchronous and can fail in ways that are the person's
 * business rather than ours — an unsupported format, a file that is not really
 * an image, a browser that will not hand over a canvas — so the failure is
 * shown here next to the control that caused it rather than thrown into the
 * page's error boundary.
 *
 * What it hands back is not the image: it is the packed darkness grid,
 * which is a parameter like any other and travels in the share link with the
 * rest of them. Nothing anywhere keeps the original file.
 */
function ImageField({
  id,
  helpId,
  hasPicture,
  size,
  onPicked,
}: {
  id: string;
  helpId: string;
  hasPicture: boolean;
  size: number;
  onPicked: (packed: string) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  // The decoded picture is kept for as long as the page lives, so that changing
  // the detail control re-reads it rather than asking for the file again. It is
  // deliberately not stored anywhere: reload, or arrive from a link, and the
  // original is gone — only the packed grid survives, which is the whole point
  // of packing it.
  const source = useRef<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Re-pack when the detail changes, but only from an image we still have.
  const firstSize = useRef(size);
  useEffect(() => {
    if (size === firstSize.current) return;
    firstSize.current = size;
    const img = source.current;
    if (!img) return;
    try {
      onPicked(imageToGrid(img, size));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That picture could not be read.');
    }
  }, [size, onPicked]);

  return (
    <div>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/*"
        aria-describedby={helpId}
        data-testid="string-art-image"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          // Clear the input straight away so choosing the same file twice
          // still fires a change event.
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setProblem(null);
          try {
            const img = await loadImageFile(file);
            source.current = img;
            onPicked(imageToGrid(img, size));
          } catch (err) {
            setProblem(err instanceof Error ? err.message : 'That picture could not be read.');
          } finally {
            setBusy(false);
          }
        }}
      />
      {hasPicture ? (
        <button
          type="button"
          className={`${ui.btn} ${ui.ghost} ${ui.small}`}
          onClick={() => {
            source.current = null;
            onPicked('');
            if (input.current) input.current.value = '';
          }}
        >
          Use the seed&rsquo;s own pattern instead
        </button>
      ) : null}
      {busy ? <p className={ui.help}>Reading that picture&hellip;</p> : null}
      {problem ? (
        <p className={ui.help} role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What each gesture is called, next to the control it drives.
 *
 * These labels are the whole of the discoverability. There is no tutorial
 * overlay and no first-run hint: the three controls sit at the top of the
 * panel with their gesture written beside them, so reading the panel once
 * teaches the picture. Hidden from assistive technology because the gesture
 * is a shortcut to a control that is right there — announcing "swipe left or
 * right" to somebody driving a slider with arrow keys is noise.
 */
const GESTURE_LABEL: Record<PrimaryRole, string> = {
  tap: 'Tap',
  x: 'Swipe \u2194',
  y: 'Swipe \u2195',
};

function Control({
  spec,
  value,
  detail,
  gesture,
  onChange,
  onCommit,
}: {
  spec: ParamSpec;
  value: ParamValue;
  /**
   * The grid size a picture should be read at, from the generator's own
   * `detail` param where it has one. An image control has to know it, and a
   * param spec only describes itself — so it is threaded in rather than looked
   * up, which keeps `ParamControls` the only place that knows the two are
   * related.
   */
  detail: number;
  /** The gesture that also drives this control, when one does. */
  gesture?: PrimaryRole;
  onChange: (v: ParamValue) => void;
  onCommit: () => void;
}) {
  const id = useId();
  const helpId = `${id}-help`;

  return (
    <div className={ui.field}>
      <div className={ui.labelRow}>
        <label className={ui.label} htmlFor={id}>
          {gesture ? (
            <span className={ui.gesture} aria-hidden="true">
              {GESTURE_LABEL[gesture]}
            </span>
          ) : null}
          {spec.label}
        </label>
        <span className={ui.value}>{formatValue(spec, value)}</span>
      </div>

      {spec.type === 'number' ? (
        <input
          id={id}
          className={ui.range}
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={typeof value === 'number' ? value : spec.default}
          aria-describedby={helpId}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
          onBlur={onCommit}
        />
      ) : null}

      {spec.type === 'select' ? (
        <select
          id={id}
          className={ui.select}
          value={typeof value === 'string' ? value : spec.default}
          aria-describedby={helpId}
          onChange={(e) => {
            onChange(e.target.value);
            onCommit();
          }}
        >
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}

      {spec.type === 'image' ? (
        <ImageField
          id={id}
          helpId={helpId}
          hasPicture={typeof value === 'string' && value.length > 0}
          size={detail}
          onPicked={(packed) => {
            onChange(packed);
            onCommit();
          }}
        />
      ) : null}

      {spec.type === 'boolean' ? (
        <Switch
          id={id}
          label={spec.label}
          checked={value === true}
          onChange={(v) => {
            onChange(v);
            onCommit();
          }}
        />
      ) : null}

      <p className={ui.help} id={helpId}>
        {spec.description}
      </p>
    </div>
  );
}

export function ParamControls({
  generator,
  params,
  onChange,
  onCommit,
}: {
  generator: Generator;
  params: Record<string, ParamValue>;
  onChange: (key: string, value: ParamValue) => void;
  onCommit: () => void;
}) {
  // A generator with a picture may also declare how finely to read one. Only
  // string art does today, and the lookup is deliberately a lookup rather than
  // anything the ParamSpec union knows about: a spec describes itself, and one
  // param needing to see another is a fact about this generator, not about the
  // type.
  const declared = params.detail ?? generator.params.find((p) => p.key === 'detail')?.default;
  const detail = Number(declared);
  const size = Number.isFinite(detail) && detail > 0 ? detail : GRID_SIZE;

  const bindings = resolvePrimaries(generator);
  const rest = secondaryParams(generator);
  const advancedId = useId();

  /**
   * Which controls are showing, and who decided.
   *
   * `auto` means nobody has said yet, and CSS answers it: shown on a wide
   * window, hidden on a narrow one. That indirection is the point. The default
   * has to differ by viewport, and reading the viewport during render is a
   * hydration mismatch — this app has an unresolved React #418 on record and a
   * scar in `next.config.mjs` from the last one. Server and client therefore
   * render the identical `data-advanced="auto"`, and only the stylesheet knows
   * how wide the window is. Once somebody presses the button, React takes over
   * and CSS stops having an opinion.
   *
   * `wide` exists only so `aria-expanded` can tell the truth. It is set in an
   * effect, after hydration, which is the same post-mount upgrade `useClock`
   * does in `PreviewFrame`.
   */
  const [choice, setChoice] = useState<'auto' | 'open' | 'closed'>('auto');
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1000px)');
    const sync = (): void => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const open = choice === 'auto' ? wide : choice === 'open';

  // Every control is rendered against the spec it is actually working to, not
  // the one it declared: a range that depends on another param would otherwise
  // offer a ceiling the render clamps away, and the slider and the picture
  // would disagree about what the value is.
  const control = (declared: ParamSpec, gesture?: PrimaryRole) => {
    const spec = effectiveSpec(generator, declared, params);
    return (
    <Control
      key={spec.key}
      spec={spec}
      value={params[spec.key] ?? spec.default}
      detail={size}
      {...(gesture ? { gesture } : {})}
      onChange={(v) => onChange(spec.key, v)}
      onCommit={onCommit}
    />
    );
  };

  // A pattern that has not chosen its three is left exactly as it was: one
  // flat list, no disclosure, nothing hidden.
  if (bindings.length === 0) return <div>{generator.params.map((spec) => control(spec))}</div>;

  return (
    <div>
      <div className={ui.promoted}>
        {bindings.map((b) => (b.spec ? control(b.spec, b.role) : null))}
      </div>

      <div className={ui.advanced} data-advanced={choice}>
        <button
          type="button"
          className={ui.advancedToggle}
          aria-expanded={open}
          aria-controls={advancedId}
          onClick={() => setChoice(open ? 'closed' : 'open')}
        >
          <span className={ui.caret} aria-hidden="true" />
          Advanced
          <span className={ui.advancedCount}>{rest.length}</span>
        </button>
        {/* Always rendered, shown or hidden by CSS. `aria-controls` can point
            at it honestly because the id always resolves — which is the thing
            the note on TabList says to avoid doing when it would not. */}
        <div className={ui.advancedBody} id={advancedId}>
          {rest.map((spec) => control(spec))}
        </div>
      </div>
    </div>
  );
}
