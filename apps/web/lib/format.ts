import type { ParamSpec, ParamValue } from '@patternwall/core';

/**
 * A parameter's value, as a person reads it.
 *
 * Lives here rather than beside the controls because two places show it now:
 * the readout next to each control, and the one on the preview while a gesture
 * is moving it. Those must agree — a drag that says 0.18 on the picture and
 * 0.2 beside the slider is two numbers for one thing.
 */
export function formatValue(spec: ParamSpec, value: ParamValue): string {
  if (spec.type === 'number') {
    const n = typeof value === 'number' ? value : spec.default;
    return spec.step >= 1 ? String(Math.round(n)) : n.toFixed(spec.step >= 0.1 ? 1 : 2);
  }
  if (spec.type === 'boolean') return value === true ? 'on' : 'off';
  if (spec.type === 'image') return typeof value === 'string' && value.length > 0 ? 'yours' : 'none';
  const opt = spec.options.find((o) => o.value === value);
  return opt ? opt.label : String(value);
}
