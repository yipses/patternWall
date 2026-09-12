/**
 * SVG emission and the vocabulary rules that keep it portable.
 *
 * PatternWall's contract is that one string — the generator's SVG — is the
 * single source of truth for what you see on screen and what lands in the PNG.
 * That only holds if the string means the same thing to every renderer we care
 * about: the browser today, resvg in Node for tests, and resvg on a server
 * later. So the vocabulary is deliberately small. No `<style>`, no CSS classes,
 * no filters, no `<text>`, no external references. Presentation attributes
 * only. Everything a filter would have done is computed in `noise.ts` and
 * emitted as geometry.
 */

export const ALLOWED_ELEMENTS: readonly string[] = [
  'svg',
  'g',
  'defs',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'use',
  'mask',
  'title',
];

/** Attributes that would drag in CSS, scripting or an external resource. */
export const FORBIDDEN_ATTRIBUTES: readonly string[] = ['style', 'class', 'filter', 'requiredExtensions', 'systemLanguage'];

export interface VocabularyViolation {
  kind: 'element' | 'attribute' | 'text';
  name: string;
  detail: string;
}

const TAG_RE = /<\s*([a-zA-Z_][\w:.-]*)((?:\s+[^<>"']*(?:"[^"]*"|'[^']*')?)*)\s*\/?\s*>/g;
const ATTR_RE = /([a-zA-Z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

/**
 * A deliberately strict, dependency-free scan of an SVG string. It is not a
 * full XML parser; it is a gate. Anything it cannot confidently classify is
 * reported rather than waved through.
 */
export function validateSvgVocabulary(svg: string): VocabularyViolation[] {
  const out: VocabularyViolation[] = [];
  const allowed = new Set(ALLOWED_ELEMENTS);
  const forbiddenAttr = new Set(FORBIDDEN_ATTRIBUTES);

  if (/<!\[CDATA\[/.test(svg)) out.push({ kind: 'text', name: 'CDATA', detail: 'CDATA sections are not allowed' });
  if (/<!DOCTYPE/i.test(svg)) out.push({ kind: 'text', name: 'DOCTYPE', detail: 'DOCTYPE is not allowed' });
  if (/<\?/.test(svg)) out.push({ kind: 'text', name: 'processing-instruction', detail: 'processing instructions are not allowed' });

  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(svg)) !== null) {
    // No closing-tag guard: TAG_RE requires a letter or underscore straight
    // after the `<`, so `</circle>` never matches in the first place. The guard
    // that used to sit here read as if closing tags were being filtered out,
    // which is a misleading thing for the next person to reason from.
    const name = m[1] as string;
    if (!allowed.has(name)) {
      out.push({ kind: 'element', name, detail: `<${name}> is outside the allowed vocabulary` });
    }
    const attrBlob = m[2] ?? '';
    ATTR_RE.lastIndex = 0;
    let a: RegExpExecArray | null;
    while ((a = ATTR_RE.exec(attrBlob)) !== null) {
      const attr = a[1] as string;
      const value = (a[3] ?? a[4] ?? '') as string;
      const lower = attr.toLowerCase();
      if (forbiddenAttr.has(lower)) {
        out.push({ kind: 'attribute', name: attr, detail: `attribute "${attr}" is not allowed on <${name}>` });
      }
      if (lower.startsWith('on')) {
        out.push({ kind: 'attribute', name: attr, detail: `event handler attribute "${attr}" is not allowed` });
      }
      // The SVG namespace declaration is the one legitimate absolute URL.
      const isNamespace = lower === 'xmlns' || lower.startsWith('xmlns:');
      if (!isNamespace && (/^(https?:)?\/\//.test(value.trim()) || /url\(\s*['"]?https?:/i.test(value))) {
        out.push({ kind: 'attribute', name: attr, detail: `attribute "${attr}" references an external URL` });
      }
    }
  }

  // Closing tags for disallowed elements (e.g. </text>) would slip past the
  // opening-tag scan if the element were self-closed elsewhere.
  const closeRe = /<\s*\/\s*([a-zA-Z_][\w:.-]*)\s*>/g;
  let c: RegExpExecArray | null;
  while ((c = closeRe.exec(svg)) !== null) {
    const name = c[1] as string;
    if (!allowed.has(name)) out.push({ kind: 'element', name, detail: `</${name}> is outside the allowed vocabulary` });
  }

  return out;
}

/** Number formatter: short, stable, locale-independent. */
export function num(v: number, dp = 2): string {
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(dp);
  // Trim trailing zeros but keep the string canonical so output is byte-stable.
  const trimmed = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return trimmed === '-0' ? '0' : trimmed;
}

export function escapeText(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type AttrValue = string | number | undefined | null | false;

/** Serialise attributes in insertion order, skipping empty values. */
export function attrs(map: Record<string, AttrValue>): string {
  const parts: string[] = [];
  for (const key of Object.keys(map)) {
    const v = map[key];
    if (v === undefined || v === null || v === false) continue;
    const s = typeof v === 'number' ? num(v) : String(v);
    parts.push(`${key}="${escapeText(s)}"`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export function el(name: string, a: Record<string, AttrValue>, children?: string): string {
  if (children === undefined || children === '') return `<${name}${attrs(a)}/>`;
  return `<${name}${attrs(a)}>${children}</${name}>`;
}

/**
 * Wrap a body in a root `<svg>`.
 *
 * `shape-rendering="geometricPrecision"` is set once at the root: browsers
 * default to `auto`, which lets them switch to `crispEdges` at small sizes and
 * makes the on-screen preview diverge from the rasterised export.
 */
export function svgRoot(width: number, height: number, title: string, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width, 0)}" height="${num(height, 0)}" ` +
    `viewBox="0 0 ${num(width, 0)} ${num(height, 0)}" shape-rendering="geometricPrecision">` +
    `<title>${escapeText(title)}</title>` +
    body +
    `</svg>`
  );
}

/** Build a `points="…"` list. */
export function points(pts: readonly (readonly [number, number])[], dp = 2): string {
  return pts.map(([x, y]) => `${num(x, dp)},${num(y, dp)}`).join(' ');
}

/**
 * Catmull-Rom through the given points, emitted as a cubic Bézier path.
 * Used by the ridgeline generator: sampling a noise field at ~120 points and
 * interpolating beats sampling at 800 points and connecting them with lines,
 * both for file size and for how the curve reads at the crest.
 */
export function smoothPath(pts: readonly (readonly [number, number])[], tension = 1, dp = 2): string {
  if (pts.length === 0) return '';
  const first = pts[0] as readonly [number, number];
  if (pts.length < 3) {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${num(p[0], dp)} ${num(p[1], dp)}`).join('');
  }
  let d = `M${num(first[0], dp)} ${num(first[1], dp)}`;
  const at = (i: number): readonly [number, number] =>
    pts[Math.min(pts.length - 1, Math.max(0, i))] as readonly [number, number];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const k = tension / 6;
    const c1x = p1[0] + (p2[0] - p0[0]) * k;
    const c1y = p1[1] + (p2[1] - p0[1]) * k;
    const c2x = p2[0] - (p3[0] - p1[0]) * k;
    const c2y = p2[1] - (p3[1] - p1[1]) * k;
    d += `C${num(c1x, dp)} ${num(c1y, dp)} ${num(c2x, dp)} ${num(c2y, dp)} ${num(p2[0], dp)} ${num(p2[1], dp)}`;
  }
  return d;
}
