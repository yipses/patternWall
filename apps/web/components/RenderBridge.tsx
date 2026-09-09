'use client';

import { useEffect } from 'react';
import { curatedPalettes, defaultParams, getGenerator, renderToSvg, type Palette, type ParamValue } from '@patternwall/core';

declare global {
  interface Window {
    patternwall?: {
      render(input: {
        generatorId: string;
        seed: string;
        width: number;
        height: number;
        bleed?: number;
        paletteId?: string;
        palette?: Palette;
        params?: Record<string, ParamValue>;
      }): string;
    };
  }
}

/**
 * A tiny, documented programmatic hook onto the renderer.
 *
 * The end-to-end suite asserts that the SVG the browser produces is byte-for-
 * byte the SVG Node produces for the same inputs. That claim is the foundation
 * of the whole "preview is the export" design, and it can only be tested if the
 * browser will render on demand. It reads nothing and mutates nothing.
 */
export function RenderBridge() {
  useEffect(() => {
    window.patternwall = {
      render(input) {
        const g = getGenerator(input.generatorId);
        if (!g) throw new Error(`Unknown pattern: ${input.generatorId}`);
        const palette =
          input.palette ?? curatedPalettes.find((p) => p.id === (input.paletteId ?? 'obsidian')) ?? curatedPalettes[0]!;
        return renderToSvg({
          generator: g,
          width: input.width,
          height: input.height,
          palette,
          params: input.params ?? defaultParams(g),
          seed: input.seed,
          bleed: input.bleed ?? 0,
        });
      },
    };
    return () => {
      delete window.patternwall;
    };
  }, []);

  return null;
}
