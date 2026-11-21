/**
 * Projections: the sequence of images and videos, its transitions and colour, and what the output screen shows.
 * Pure, no React (tested in projection.test.ts). The output window and the preview in Proiezioni draw an `OutState`.
 */
import type { Color, Projection, ProjectionItem, Transition } from "./show";

export const NEUTRAL: Color = { brightness: 0, contrast: 0, temperature: 0, saturation: 0 };
export const COLOR_KEYS = ["brightness", "contrast", "temperature", "saturation"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export const DEFAULT_TRANSITION_SECONDS = 1.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ */
/* Sequence                                                             */
/* ------------------------------------------------------------------ */

export const indexOfItem = (items: readonly ProjectionItem[], id: string | null | undefined): number => (id ? items.findIndex((i) => i.id === id) : -1);

/**
 * The item a step goes to. With nothing on screen (-1) "next" is the first item and "previous" nothing; at the ends
 * the sequence stops (null): a show never wraps around by surprise.
 */
export function stepTarget(items: readonly ProjectionItem[], currentId: string | null, dir: "next" | "previous"): ProjectionItem | null {
  const i = indexOfItem(items, currentId);
  const j = dir === "next" ? i + 1 : i - 1;
  return j >= 0 && j < items.length ? items[j] : null;
}

/** The item after the one on screen (the "prossimo" of the preview). */
export const nextItem = (items: readonly ProjectionItem[], currentId: string | null) => stepTarget(items, currentId, "next");

/** Moves the item at `from` so that it ends up at index `to` of the new list. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  const out = [...items];
  const [it] = out.splice(from, 1);
  out.splice(clamp(to, 0, out.length), 0, it);
  return out;
}

export const removeItem = (p: Projection, id: string): Projection => ({ ...p, items: p.items.filter((i) => i.id !== id) });

export function updateItem(p: Projection, id: string, patch: Partial<ProjectionItem>): Projection {
  return { ...p, items: p.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
}

/** The image parts (`images/…`, `thumbs/…`) a projection uses: what the file must keep. */
export function usedParts(p: Projection): Set<string> {
  const out = new Set<string>();
  for (const i of p.items) {
    if (i.part) out.add(i.part);
    if (i.thumb) out.add(i.thumb);
  }
  if (p.blank.kind === "image") out.add(p.blank.part);
  return out;
}

/** Parts that hold projection pictures. */
export const isPicturePart = (name: string): boolean => name.startsWith("images/") || name.startsWith("thumbs/");

/**
 * The picture parts of the file that no projection uses any more — not the current one, nor one that undo or redo
 * could bring back (`keep`): removed at the next save, so the file does not keep growing with deleted images.
 */
export function partsToDrop(fileParts: readonly string[], keep: readonly Projection[]): string[] {
  const used = new Set<string>();
  for (const p of keep) for (const n of usedParts(p)) used.add(n);
  return fileParts.filter((n) => isPicturePart(n) && !used.has(n));
}

/* ------------------------------------------------------------------ */
/* Transitions                                                          */
/* ------------------------------------------------------------------ */

export function transitionText(t: Transition): { kind: Transition["kind"]; seconds: number | null } {
  return t.kind === "cut" ? { kind: "cut", seconds: null } : { kind: t.kind, seconds: Number.isFinite(t.seconds) ? t.seconds : DEFAULT_TRANSITION_SECONDS };
}

export function withTransitionKind(t: Transition, kind: Transition["kind"]): Transition {
  if (kind === "cut") return { kind: "cut" };
  return { kind, seconds: t.kind === "cut" ? DEFAULT_TRANSITION_SECONDS : t.seconds };
}

/**
 * How the layers fade, in ms. Cut: the new one is there at once. Dissolve: the new one fades in over the old one,
 * which stays opaque underneath until it is covered. Through black: the old one fades out in the first half, the new one in during the second.
 */
export interface TransitionTimeline {
  /** Old layer: fade to 0 over `outMs` starting at 0 (0 = it stays until the new one covers it). */
  outMs: number;
  /** New layer: fade to 1 over `inMs` starting at `inDelayMs`. */
  inMs: number;
  inDelayMs: number;
  /** When the old layer can be removed. */
  totalMs: number;
}

export function transitionTimeline(t: Transition): TransitionTimeline {
  if (t.kind === "cut") return { outMs: 0, inMs: 0, inDelayMs: 0, totalMs: 0 };
  const ms = Math.round(clamp(Number.isFinite(t.seconds) ? t.seconds : DEFAULT_TRANSITION_SECONDS, 0.1, 10) * 1000);
  if (t.kind === "dissolve") return { outMs: 0, inMs: ms, inDelayMs: 0, totalMs: ms };
  const half = Math.round(ms / 2);
  return { outMs: half, inMs: half, inDelayMs: half, totalMs: half * 2 };
}

/* ------------------------------------------------------------------ */
/* Colour                                                               */
/* ------------------------------------------------------------------ */

/** The colour an item is shown with: its own ("Questo"), else the one of "Tutti", else untouched. */
export const effectiveColor = (p: Pick<Projection, "color">, item: Pick<ProjectionItem, "color"> | null | undefined): Color => item?.color ?? p.color ?? NEUTRAL;

export const isNeutral = (c: Color) => COLOR_KEYS.every((k) => c[k] === 0);

/** A value is "modified" (amber) when it differs from what it would be without the edit being looked at: 0 for "Tutti", the "Tutti" value for "Questo". */
export const isModified = (value: number, base: number) => value !== base;

/**
 * Sets one colour value. `scope` "all" writes the colour of every item ("Tutti"); an item id writes that item's own
 * colour, starting from what it shows now ("Questo").
 */
export function setColorValue(p: Projection, scope: "all" | string, key: ColorKey, value: number): Projection {
  const v = Math.round(clamp(value, -100, 100));
  if (scope === "all") {
    const c = { ...(p.color ?? NEUTRAL), [key]: v };
    const { color: _old, ...rest } = p;
    return isNeutral(c) ? rest : { ...rest, color: c };
  }
  return {
    ...p,
    items: p.items.map((i) => {
      if (i.id !== scope) return i;
      return { ...i, color: { ...effectiveColor(p, i), [key]: v } };
    }),
  };
}

/** "Questo" goes back to following "Tutti". */
export function resetItemColor(p: Projection, id: string): Projection {
  return { ...p, items: p.items.map((i) => (i.id === id ? ((): ProjectionItem => { const { color: _c, ...rest } = i; return rest; })() : i)) };
}

/** Warm/cool as gains of the red and blue channels (temperature -100 cool .. +100 warm). */
export function temperatureGains(temperature: number): { r: number; b: number } {
  const t = clamp(temperature, -100, 100) / 100;
  return { r: +(1 + 0.22 * t).toFixed(4), b: +(1 - 0.28 * t).toFixed(4) };
}

/** The CSS `filter` for a colour; `svgId` is the id of the `<filter>` that does the temperature (see ProjectionScreen). */
export function colorFilter(c: Color, svgId: string): string {
  const parts: string[] = [];
  if (c.brightness !== 0) parts.push(`brightness(${(1 + c.brightness / 100).toFixed(3)})`);
  if (c.contrast !== 0) parts.push(`contrast(${(1 + c.contrast / 100).toFixed(3)})`);
  if (c.saturation !== 0) parts.push(`saturate(${(1 + c.saturation / 100).toFixed(3)})`);
  if (c.temperature !== 0) parts.push(`url(#${svgId})`);
  return parts.length ? parts.join(" ") : "none";
}

/* ------------------------------------------------------------------ */
/* What the output shows                                                */
/* ------------------------------------------------------------------ */

/** Where an image's bytes are: a part of the show file, or a pending one (staged) not saved yet. */
export interface ImageRef {
  file: string | null;
  staged: string | null;
  part: string;
}

export type OutMedia =
  | { type: "black" }
  | { type: "image"; image: ImageRef }
  /** `src` is the address the output window plays (served by the `cuevideo` protocol); `poster` is what the preview shows. */
  | { type: "video"; src: string; atEnd: "hold" | "black" | "loop"; poster?: ImageRef };

/** Everything the output window needs to draw. `key` changes at every firing, even of the same item (a video restarts). */
export interface OutState {
  key: string;
  media: OutMedia;
  color: Color;
  transition: Transition;
  /** The test pattern of Settings → Proiezioni covers everything. */
  test: boolean;
}

export const BLACK_OUT: OutState = { key: "black", media: { type: "black" }, color: NEUTRAL, transition: { kind: "cut" }, test: false };
