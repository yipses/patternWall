import { renderToSvg, getGenerator, type Palette, type ParamValue } from '@patternwall/core';

export interface RenderSpec {
  generatorId: string;
  seed: string;
  params: Record<string, ParamValue>;
  palette: Palette;
  width: number;
  height: number;
  bleed: number;
}

/**
 * The app's single door into the core renderer. Everything visible — gallery
 * card, editor preview, PNG export, batch zip — goes through here, so there is
 * exactly one definition of "what this configuration looks like".
 */
export function renderSpec(spec: RenderSpec): string {
  const g = getGenerator(spec.generatorId);
  if (!g) throw new Error(`Unknown pattern: ${spec.generatorId}`);
  return renderToSvg({
    generator: g,
    width: spec.width,
    height: spec.height,
    palette: spec.palette,
    params: spec.params,
    seed: spec.seed,
    bleed: spec.bleed,
  });
}

const utf8ToBase64 = (s: string): string => {
  if (typeof window === 'undefined') return Buffer.from(s, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return window.btoa(bin);
};

/**
 * Base64 rather than percent-encoding: the SVG strings run to a few hundred
 * kilobytes and base64 both encodes faster and avoids a class of parsing bugs
 * with `#` inside `url(...)` references.
 */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
}
