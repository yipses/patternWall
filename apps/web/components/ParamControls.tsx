'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GRID_SIZE, type Generator, type ParamSpec, type ParamValue } from '@patternwall/core';
import { loadImageFile } from '../lib/extract';
import { imageToGrid } from '../lib/to-grid';
import { Switch, uiStyles as ui } from './ui';

function formatValue(spec: ParamSpec, value: ParamValue): string {
  if (spec.type === 'number') {
    const n = typeof value === 'number' ? value : spec.default;
    return spec.step >= 1 ? String(Math.round(n)) : n.toFixed(spec.step >= 0.1 ? 1 : 2);
  }
  if (spec.type === 'boolean') return value === true ? 'on' : 'off';
  if (spec.type === 'image') return typeof value === 'string' && value.length > 0 ? 'yours' : 'none';
  const opt = spec.options.find((o) => o.value === value);
  return opt ? opt.label : String(value);
}

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

function Control({
  spec,
  value,
  detail,
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
  onChange: (v: ParamValue) => void;
  onCommit: () => void;
}) {
  const id = useId();
  const helpId = `${id}-help`;

  return (
    <div className={ui.field}>
      <div className={ui.labelRow}>
        <label className={ui.label} htmlFor={id}>
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

  return (
    <div>
      {generator.params.map((spec) => (
        <Control
          key={spec.key}
          spec={spec}
          value={params[spec.key] ?? spec.default}
          detail={Number.isFinite(detail) && detail > 0 ? detail : GRID_SIZE}
          onChange={(v) => onChange(spec.key, v)}
          onCommit={onCommit}
        />
      ))}
    </div>
  );
}
