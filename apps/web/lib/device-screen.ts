'use client';

import { useEffect, useState } from 'react';

export interface DeviceScreen {
  w: number;
  h: number;
  dpr: number;
}

/** A phone-shaped canvas, for a device that is not one. */
export const FALLBACK_SCREEN: DeviceScreen = { w: 390, h: 845, dpr: 2 };

/**
 * The canvas `/m` draws, taken from the device's own screen where there is one.
 *
 * Shared with the collection, whose tiles are the same shape for the same
 * reason: a saved wallpaper shown at anything but the screen's own aspect is a
 * picture of a different phone.
 *
 * `screen` rather than the viewport on purpose: the viewport is whatever
 * Safari has left after its address bar, and that slides around as you scroll,
 * which would re-render the pattern at a new aspect every time it moved. The
 * screen is the thing a wallpaper actually has to fit, it is what "detect the
 * phone resolution" means, and it does not move.
 *
 * A desktop has a screen too, and it is landscape, so taking it literally
 * turns this page into a very wide wallpaper — which is the one thing `/m` is
 * not. Anything that is not portrait, or is wider than a phone gets, falls
 * back to a phone shape and lets the black show around it.
 *
 * Null until the effect runs. The static export prerenders this page, so the
 * first client render has to match the HTML that was baked in -- reading the
 * screen during render would be a text hydration mismatch, the same class of
 * bug as the build stamp.
 */
export function useDeviceScreen(enabled: boolean): DeviceScreen | null {
  const [box, setBox] = useState<DeviceScreen | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const read = (): void => {
      const sw = Math.max(1, Math.round(window.screen?.width ?? window.innerWidth));
      const sh = Math.max(1, Math.round(window.screen?.height ?? window.innerHeight));
      // Portrait, and no wider than a large phone. A tablet in portrait is
      // deliberately excluded: 4:3 of this pattern is not what anybody opened
      // `/m` to see.
      const isPhone = sh > sw && sw <= 600;
      const next = isPhone
        ? { w: sw, h: sh, dpr: Math.min(3, Math.max(1, window.devicePixelRatio || 1)) }
        : FALLBACK_SCREEN;
      setBox((prev) => (prev && prev.w === next.w && prev.h === next.h && prev.dpr === next.dpr ? prev : next));
    };
    read();
    window.addEventListener('orientationchange', read);
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('orientationchange', read);
      window.removeEventListener('resize', read);
    };
  }, [enabled]);
  return box;
}
