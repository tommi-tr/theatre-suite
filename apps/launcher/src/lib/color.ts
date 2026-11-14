import type { Cover } from "./types";

import { SHOW_COLORS, showColor as coreShowColor } from "@theatre-suite/core";

/** Colours offered for a show without an image (shared with the apps, see @theatre-suite/core). */
export { SHOW_COLORS };

/** The colour of a show: the one chosen, otherwise one derived from the title (always the same). */
export function showColor(title: string, cover?: Cover | null): string {
  return coreShowColor(title, cover);
}

function mix(hex: string, to: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * amount));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export const darker = (hex: string, amount = 0.6) => mix(hex, 0, amount);

/** Background of a cover without image: a soft curtain-like gradient in the show colour. */
export function coverBackground(color: string): string {
  return `repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 24px), linear-gradient(135deg, ${color} 0%, ${darker(color, 0.72)} 100%)`;
}

/** The colour as it should appear on the app bar (a bit lighter on dark themes keeps it visible). */
export function bandColor(hex: string, dark: boolean): string {
  return dark ? mix(hex, 255, 0.18) : hex;
}

export function rgbOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
