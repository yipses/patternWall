export interface DevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  group: string;
}

/**
 * Wallpaper pixel sizes, i.e. the native panel resolution, not the CSS point
 * size. Several phones share a panel — the 16 Pro Max and 17 Pro Max are both
 * 1320x2868 — so the labels group them rather than pretending they differ.
 */
export const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'ip17pm', label: 'iPhone 17 Pro Max / 16 Pro Max', width: 1320, height: 2868, group: 'Current' },
  { id: 'ip17p', label: 'iPhone 17 Pro / 16 Pro / Air', width: 1206, height: 2622, group: 'Current' },
  { id: 'ip17', label: 'iPhone 17', width: 1206, height: 2622, group: 'Current' },
  { id: 'ip15pm', label: 'iPhone 15/14 Pro Max, 16 Plus', width: 1290, height: 2796, group: 'Recent' },
  { id: 'ip15p', label: 'iPhone 15/14 Pro, 16', width: 1179, height: 2556, group: 'Recent' },
  { id: 'ip14pl', label: 'iPhone 14 Plus / 13 Pro Max', width: 1284, height: 2778, group: 'Recent' },
  { id: 'ip13', label: 'iPhone 14 / 13 / 12', width: 1170, height: 2532, group: 'Recent' },
  { id: 'ip13mini', label: 'iPhone 13 mini / 12 mini', width: 1080, height: 2340, group: 'Recent' },
  { id: 'ip16e', label: 'iPhone 16e / SE (2022 shape)', width: 1170, height: 2532, group: 'Other' },
  { id: 'ipse3', label: 'iPhone SE (home button)', width: 750, height: 1334, group: 'Other' },
  { id: 'ip11', label: 'iPhone 11 / XR', width: 828, height: 1792, group: 'Other' },
];

export const DEFAULT_DEVICE = DEVICE_PRESETS[1] as DevicePreset;

/** Best-effort read of the current display's true pixel size. */
export function detectScreen(): { width: number; height: number } | null {
  if (typeof window === 'undefined' || !window.screen) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(Math.min(window.screen.width, window.screen.height) * dpr);
  const h = Math.round(Math.max(window.screen.width, window.screen.height) * dpr);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 200 || h < 200) return null;
  return { width: w, height: h };
}
