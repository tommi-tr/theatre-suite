import { create } from "zustand";
import { makeAnchor } from "../model/anchor";
import type { Anchor } from "../model/show";
import { scriptPageText } from "./store";

/** Zoom of the script: 1 = page width fitted to the column; 0.5 … 3. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

/** Where the pages are, in px of the scrolled content (changes only with zoom, size of the column, script). */
export interface Geometry {
  scale: number;
  tops: number[];
  heights: number[];
  lefts: number[];
  widths: number[];
  contentHeight: number;
  contentWidth: number;
  viewHeight: number;
}

/** The point of the view that the peek line and GOs refer to ("reading line"): 30% from the top. */
export const READING_LINE = 0.3;

export interface Peek {
  /** scrollTop when Ctrl went down. */
  fromTop: number;
  /** The band is on screen (Ctrl held a moment, or the script was scrolled). */
  visible: boolean;
  /** The script was scrolled during the peek: it goes back when Ctrl is released. */
  moved: boolean;
  /** Going back (animation running). */
  returning: boolean;
}

interface ScriptViewState {
  zoom: number;
  geometry: Geometry | null;
  peek: Peek | null;
  /** The note being edited (a new note opens in edit). */
  editingNote: string | null;
  setZoom: (z: number) => void;
  setGeometry: (g: Geometry | null) => void;
  setPeek: (p: Peek | null) => void;
  setEditingNote: (id: string | null) => void;
}

export const useScriptView = create<ScriptViewState>((set) => ({
  zoom: 1,
  geometry: null,
  peek: null,
  editingNote: null,
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  setGeometry: (geometry) => set({ geometry }),
  setPeek: (peek) => set({ peek }),
  setEditingNote: (editingNote) => set({ editingNote }),
}));

/** Content y (px) of an anchor. */
export function anchorTop(g: Geometry, a: { page: number; y: number }): number | null {
  const i = a.page - 1;
  if (i < 0 || i >= g.tops.length) return null;
  return g.tops[i] + a.y * g.heights[i];
}

/** The page and the fractions of the page at a point of the content. */
export function pointOnPage(g: Geometry, cx: number, cy: number): { page: number; x: number; y: number } | null {
  if (!g.tops.length) return null;
  let i = 0;
  while (i < g.tops.length - 1 && cy > g.tops[i] + g.heights[i] + (g.tops[i + 1] - g.tops[i] - g.heights[i]) / 2) i++;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { page: i + 1, x: clamp((cx - g.lefts[i]) / g.widths[i]), y: clamp((cy - g.tops[i]) / g.heights[i]) };
}

/**
 * The live view, for the parts around the script (notes column, later the GO columns): they follow the scroll
 * without React re-rendering (`onScroll` listeners move them), and they ask for anchors at points.
 */
type ScrollFn = (top: number) => void;
const scrollFns = new Set<ScrollFn>();
let scroller: HTMLElement | null = null;
let pointer: { x: number; y: number } | null = null;

export const scriptLive = {
  attach(el: HTMLElement | null) {
    scroller = el;
  },
  emit(top: number) {
    for (const f of scrollFns) f(top);
  },
  onScroll(fn: ScrollFn): () => void {
    scrollFns.add(fn);
    fn(scroller?.scrollTop ?? 0);
    return () => scrollFns.delete(fn);
  },
  scrollTop: () => scroller?.scrollTop ?? 0,
  /** Content point under the pointer (null when the pointer is not on the script). */
  setPointer(p: { x: number; y: number } | null) {
    pointer = p;
  },
  pointer: () => pointer,
  /** Content point at the centre of the view, on the reading line. */
  centre(): { x: number; y: number } | null {
    if (!scroller) return null;
    return { x: scroller.scrollLeft + scroller.clientWidth / 2, y: scroller.scrollTop + scroller.clientHeight * READING_LINE };
  },
};

/** The anchor at a content point (text of the page included). */
export async function anchorAtPoint(cx: number, cy: number): Promise<Anchor | null> {
  const g = useScriptView.getState().geometry;
  if (!g) return null;
  const at = pointOnPage(g, cx, cy);
  if (!at) return null;
  const page = await scriptPageText(at.page);
  if (!page) return { page: at.page, y: at.y, x: at.x, quote: "", before: "", after: "" };
  const [prev, next] = await Promise.all([at.y < 0.25 ? scriptPageText(at.page - 1) : null, at.y > 0.75 ? scriptPageText(at.page + 1) : null]);
  return makeAnchor(page, { x: at.x, y: at.y }, { prev: prev ?? undefined, next: next ?? undefined });
}

/** The anchor where a note or GO "here" goes: the pointer if it is on the script, else the reading line. */
export async function anchorHere(): Promise<Anchor | null> {
  const p = scriptLive.pointer() ?? scriptLive.centre();
  return p ? anchorAtPoint(p.x, p.y) : null;
}
