'use client';

import { useId } from 'react';
import type { Generator, ParamSpec, ParamValue } from '@patternwall/core';
import { Switch, uiStyles as ui } from './ui';

function formatValue(spec: ParamSpec, value: ParamValue): string {
  if (spec.type === 'number') {
    const n = typeof value === 'number' ? value : spec.default;
    return spec.step >= 1 ? String(Math.round(n)) : n.toFixed(spec.step >= 0.1 ? 1 : 2);
  }
  if (spec.type === 'boolean') return value === true ? 'on' : 'off';
  const opt = spec.options.find((o) => o.value === value);
  return opt ? opt.label : String(value);
}

function Control({
  spec,
  value,
  onChange,
  onCommit,
}: {
  spec: ParamSpec;
  value: ParamValue;
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
  return (
    <div>
      {generator.params.map((spec) => (
        <Control
          key={spec.key}
          spec={spec}
          value={params[spec.key] ?? spec.default}
          onChange={(v) => onChange(spec.key, v)}
          onCommit={onCommit}
        />
      ))}
    </div>
  );
}
