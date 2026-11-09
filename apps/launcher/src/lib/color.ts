import type { Cover } from "./types";

/** Colours offered for a show without an image. */
export const SHOW_COLORS = ["#7a2e4a", "#9a6a2a", "#2f6f80", "#4a5fa8", "#5b7a3a", "#7a4a8a", "#8a4a2a", "#3a5a5a"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The colour of a show: the one chosen, otherwise one derived from the title (always the same). */
export function showColor(title: string, cover?: Cover | null): string {
  if (cover?.color && /^#[0-9a-f]{6}$/i.test(cover.color)) return cover.color;
  return SHOW_COLORS[hash(title.trim().toLowerCase()) % SHOW_COLORS.length];
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
