import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { PAGE_SIZES, type FormatModel } from "../format/model";
import { blockAt, type DocIndex } from "../model/derive";
import { getData } from "../model/defaults";
import { SCRIPT_BLOCKS } from "../model/schema";
import { indexKey } from "./plugins";

/*
 * Live pagination.
 *
 * The text is one column as wide as the text of a page. After every change
 * Bardo measures the blocks, decides where each page ends (following the
 * rules of good typesetting: no scene title at the bottom of a page, no
 * single lines, a speech split over two pages repeats the name…) and inserts
 * invisible spacers that push the text onto the next sheet. Sheets, headers
 * and footers are drawn behind the text from the result.
 *
 * Measurements are taken in "natural" coordinates: the position the text
 * would have without any spacer. Spacers only move the following text down
 * and never change how lines wrap, so one measurement is enough.
 */

export const MM = 96 / 25.4;
export const PAGE_GAP = 28;

export type Zone = "doc" | "script";

export interface Geometry {
  pageW: number;
  pageH: number;
  gap: number;
  contentW: number;
  inner: number;
  outer: number;
  mirror: boolean;
  zones: Record<Zone, { top: number; bottom: number }>;
  /** Extra side margins of documentation pages (title, lists) compared with script pages. */
  docExtra: { left: number; right: number };
}

export function geometry(f: FormatModel): Geometry {
  const size = PAGE_SIZES[f.page.size] ?? PAGE_SIZES.A4;
  const s = f.page.script;
  const d = f.page.doc;
  return {
    pageW: size.w * MM,
    pageH: size.h * MM,
    gap: PAGE_GAP,
    contentW: (size.w - s.inner - s.outer) * MM,
    inner: s.inner * MM,
    outer: s.outer * MM,
    mirror: f.page.mirror,
    zones: { doc: { top: d.top * MM, bottom: d.bottom * MM }, script: { top: s.top * MM, bottom: s.bottom * MM } },
    docExtra: { left: Math.max(0, d.inner - s.inner) * MM, right: Math.max(0, d.outer - s.outer) * MM },
  };
}

export interface PageInfo {
  index: number;
  /** Printed number (1-based). */
  number: number;
  zone: Zone;
  /** Top of the sheet, in editor coordinates (the editor starts at the text of page 1). */
  top: number;
  /** Left of the sheet relative to the text column (negative). */
  left: number;
  firstBlock: number;
  /** Index into DocIndex.scenes / acts in force at the top of the page (-1: none). */
  scene: number;
  act: number;
  /** Characters who speak on this page (ids). */
  speakers: string[];
}

export interface Break {
  kind: "block" | "inline";
  pos: number;
  h: number;
  /** Page (index) that starts after the break. */
  page: number;
  /** Name repeated on the next page ("AMLETO (segue)"). */
  cont: string;
}

export interface Pagination {
  geom: Geometry;
  pages: PageInfo[];
  breaks: Break[];
  /** Page index where each top-level block starts. */
  blockPage: number[];
  /** Positions inside a block where a new page starts. */
  splits: { pos: number; block: number; page: number }[];
  continuous: boolean;
  rev: number;
}

/** Printed page number of a position. */
export function pageOfPos(p: Pagination | null, index: DocIndex, pos: number): number | null {
  if (!p || p.continuous || !p.blockPage.length) return null;
  const b = blockAt(index, pos);
  let page = p.blockPage[b] ?? 0;
  for (const s of p.splits) if (s.block === b && s.pos <= pos) page = s.page;
  return (p.pages[page]?.number ?? page + 1);
}

interface Block {
  i: number;
  pos: number;
  node: PMNode;
  dom: HTMLElement;
  type: string;
  zone: Zone;
  top: number;
  bottom: number;
  /** Visual top of the block's first line relative to the client (for line search). */
  sBefore: number;
}

interface Line {
  top: number;
  bottom: number;
  clientTop: number;
}

function sideMargins(g: Geometry, number: number) {
  // Odd pages (1, 3…) are right-hand pages: the inner margin is on the left.
  if (!g.mirror || number % 2 === 1) return { left: g.inner, right: g.outer };
  return { left: g.outer, right: g.inner };
}

const TEXT_FILTER = {
  acceptNode(n: Node) {
    const el = n.parentElement;
    if (!el || el.closest(".b-pb, .b-speaker, .b-auto-lane, .b-lane")) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  },
};

function textRoot(b: Block): HTMLElement {
  return (b.type === "speech" ? b.dom.querySelector<HTMLElement>(".b-speech-text") : null) ?? b.dom;
}

function measureLines(b: Block, rootTop: number, scale: number, innerSpacers: { clientTop: number; h: number }[]): Line[] {
  const rects: { top: number; bottom: number }[] = [];
  const walker = document.createTreeWalker(textRoot(b), NodeFilter.SHOW_TEXT, TEXT_FILTER);
  const range = document.createRange();
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!(t as Text).data.length) continue;
    range.selectNodeContents(t);
    for (const r of Array.from(range.getClientRects())) if (r.height > 0) rects.push({ top: r.top, bottom: r.bottom });
  }
  rects.sort((a, b2) => a.top - b2.top);
  const lines: Line[] = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    if (last && r.top < last.bottom - 2) {
      last.bottom = Math.max(last.bottom, r.bottom);
      last.clientTop = Math.min(last.clientTop, r.top);
    } else lines.push({ top: r.top, bottom: r.bottom, clientTop: r.top });
  }
  return lines.map((l) => {
    const inner = innerSpacers.filter((s) => s.clientTop < l.clientTop).reduce((a, s) => a + s.h, 0);
    return {
      top: (l.top - rootTop) / scale - b.sBefore - inner,
      bottom: (l.bottom - rootTop) / scale - b.sBefore - inner,
      clientTop: l.clientTop,
    };
  });
}

/** Document position of the first character drawn on the line that starts at `clientTop`. */
function lineStartPos(view: EditorView, b: Block, clientTop: number): number | null {
  const walker = document.createTreeWalker(textRoot(b), NodeFilter.SHOW_TEXT, TEXT_FILTER);
  const range = document.createRange();
  const topOf = (t: Text, i: number) => {
    range.setStart(t, i);
    range.setEnd(t, i + 1);
    return range.getBoundingClientRect().top;
  };
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const len = t.data.length;
    if (!len || topOf(t, len - 1) < clientTop - 2) continue;
    let lo = 0;
    let hi = len - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (topOf(t, mid) >= clientTop - 2) hi = mid;
      else lo = mid + 1;
    }
    try {
      return view.posAtDOM(t, lo);
    } catch {
      return null;
    }
  }
  return null;
}

function computePagination(view: EditorView, format: FormatModel, index: DocIndex, continuous: boolean, contLabel: string, rev: number): Pagination {
  const g = geometry(format);
  const doc = view.state.doc;
  const empty: Pagination = { geom: g, pages: [], breaks: [], blockPage: [], splits: [], continuous, rev };
  const root = view.dom as HTMLElement;
  const rootRect = root.getBoundingClientRect();
  const scale = root.offsetWidth ? rootRect.width / root.offsetWidth : 1;
  const rootTop = rootRect.top;

  // Spacers currently in the page (from the previous pagination).
  const spacers = Array.from(root.querySelectorAll<HTMLElement>(".b-pb")).map((el) => {
    let pos = -1;
    try {
      pos = view.posAtDOM(el, 0);
    } catch {
      /* detached */
    }
    return { pos, h: Number(el.dataset.h) || 0, kind: el.dataset.kind, clientTop: el.getBoundingClientRect().top };
  });

  const blocks: Block[] = [];
  doc.forEach((node, pos, i) => {
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom || !(dom instanceof HTMLElement)) return;
    const r = dom.getBoundingClientRect();
    let sBefore = 0;
    let sInside = 0;
    for (const s of spacers) {
      if (s.pos < pos || (s.pos === pos && s.kind === "block")) sBefore += s.h;
      else if (s.kind === "inline" && s.pos > pos && s.pos < pos + node.nodeSize) sInside += s.h;
    }
    blocks.push({
      i,
      pos,
      node,
      dom,
      type: node.type.name,
      zone: SCRIPT_BLOCKS.has(node.type.name) ? "script" : "doc",
      top: (r.top - rootTop) / scale - sBefore,
      bottom: (r.bottom - rootTop) / scale - sBefore - sInside,
      sBefore,
    });
  });
  if (!blocks.length) return empty;
  if (continuous) {
    return { ...empty, blockPage: blocks.map(() => 0), pages: [{ index: 0, number: 1, zone: "script", top: -g.zones.script.top, left: -g.inner, firstBlock: 0, scene: -1, act: -1, speakers: [] }] };
  }

  // Zone of a page break node = zone of what follows.
  for (let k = blocks.length - 2; k >= 0; k--) if (blocks[k].type === "page_break") blocks[k].zone = blocks[k + 1].zone;

  const origin = g.zones[blocks[0].zone].top;
  const sheetTop = (p: number) => p * (g.pageH + g.gap) - origin;
  const contentTop = (p: number, z: Zone) => sheetTop(p) + g.zones[z].top;
  const contentBottom = (p: number, z: Zone) => sheetTop(p) + g.pageH - g.zones[z].bottom;

  const pages: PageInfo[] = [];
  const breaks: Break[] = [];
  const splits: Pagination["splits"] = [];
  const blockPage: number[] = new Array(doc.childCount).fill(0);
  let page = 0;
  let zone: Zone = blocks[0].zone;
  let limit = contentBottom(0, zone);
  let hasContent = false;
  let S = 0;
  const opt = format.options;
  const part = format.partition;
  const minLines = opt.widows ? 2 : 1;

  const openPage = (p: number, z: Zone, first: number) => {
    const m = sideMargins(g, p + 1);
    pages.push({ index: p, number: p + 1, zone: z, top: sheetTop(p), left: -m.left, firstBlock: first, scene: -1, act: -1, speakers: [] });
  };
  openPage(0, zone, blocks[0].i);

  const breakBefore = (b: Block) => {
    const target = contentTop(page + 1, b.zone);
    const h = Math.max(0, target - (b.top + S));
    breaks.push({ kind: "block", pos: b.pos, h, page: page + 1, cont: "" });
    S += h;
    page += 1;
    zone = b.zone;
    limit = contentBottom(page, zone);
    hasContent = false;
    openPage(page, zone, b.i);
  };

  const lineHeightOf = (b: Block) => {
    const cs = getComputedStyle(textRoot(b));
    const lh = parseFloat(cs.lineHeight);
    return Number.isFinite(lh) ? lh : parseFloat(cs.fontSize) * 1.35;
  };

  /** Lowest point that must fit on the page so that `k` keeps enough of what follows. */
  const keepBottom = (k: number): number => {
    let j = k + 1;
    while (j < blocks.length && (blocks[j].type === "act" || blocks[j].type === "tableau" || blocks[j].type === "scene")) j++;
    if (j >= blocks.length) return blocks[k].bottom;
    const next = blocks[j];
    if (next.type === "page_break" || next.type === "auto") return blocks[j - 1].bottom;
    const keep = blocks[k].type === "direction" ? 2 : part.keepLines;
    const lh = lineHeightOf(next);
    return Math.min(next.bottom, next.top + keep * lh);
  };

  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    const prev = k > 0 ? blocks[k - 1] : null;
    const forced =
      hasContent &&
      ((b.type === "act" && part.actNewPage) ||
        (b.type === "scene" && part.sceneNewPage && prev?.type !== "act" && prev?.type !== "tableau") ||
        prev?.type === "page_break" ||
        (prev?.type === "auto" && prev.node.attrs.kind === "title") ||
        (b.type === "auto" && b.node.attrs.kind === "title"));
    if (forced) breakBefore(b);

    const isHeading = b.type === "act" || b.type === "tableau" || b.type === "scene";
    const splittable = b.node.isTextblock;
    if (b.bottom + S > limit + 0.5) {
      if (splittable) {
        const inner = spacers.filter((s) => s.kind === "inline" && s.pos > b.pos && s.pos < b.pos + b.node.nodeSize);
        const lines = measureLines(b, rootTop, scale, inner);
        const n = lines.length;
        let start = 0;
        const fitting = () => lines.filter((l) => l.bottom + S <= limit + 0.5).length;
        let fit = fitting();
        const shortBlock = n < minLines * 2;
        if (hasContent && (shortBlock || fit < minLines)) {
          breakBefore(b);
          fit = fitting();
        }
        if (fit < n) {
          if (n - fit < minLines && n > minLines) fit = n - minLines;
          if (fit < 1) fit = 1;
          // Split as many times as needed (a speech longer than a page).
          while (fit < n) {
            const l = lines[fit];
            const pos = lineStartPos(view, b, l.clientTop);
            if (pos === null || pos <= b.pos) break;
            const cont = b.type === "speech" && opt.continued ? `${b.node.attrs.name || ""}` : "";
            const extra = cont && format.speech.namePos !== "left" ? lineHeightOf(b) : 0;
            const target = contentTop(page + 1, zone) + extra;
            const h = Math.max(0, target - (l.top + S));
            breaks.push({ kind: "inline", pos, h, page: page + 1, cont });
            S += h;
            page += 1;
            limit = contentBottom(page, zone);
            openPage(page, zone, b.i);
            splits.push({ pos, block: b.i, page });
            start = fit;
            const rest = lines.slice(start);
            const more = rest.filter((x) => x.bottom + S <= limit + 0.5).length;
            if (more >= rest.length) break;
            fit = start + Math.max(1, rest.length - more < minLines ? rest.length - minLines : more);
          }
        }
      } else if (hasContent) {
        breakBefore(b);
      }
    } else if (hasContent && (isHeading || (b.type === "direction" && opt.keepDirection && blocks[k + 1]?.type === "speech"))) {
      if (keepBottom(k) + S > limit + 0.5) breakBefore(b);
    }
    blockPage[b.i] = page;
    hasContent = true;
  }

  // Header data: act, scene and speakers of every page.
  for (const p of pages) {
    p.scene = index.blockScene[p.firstBlock] ?? -1;
    p.act = index.blockAct[p.firstBlock] ?? -1;
  }
  doc.forEach((node, _pos, i) => {
    if (node.type.name !== "speech" || !node.attrs.speaker) return;
    const p = pages[blockPage[i]];
    if (p && !p.speakers.includes(node.attrs.speaker)) p.speakers.push(node.attrs.speaker);
  });
  void contLabel;
  return { geom: g, pages, breaks, blockPage, splits, continuous, rev };
}

/* ------------------------------------------------------------------ */
/* Plugin                                                               */
/* ------------------------------------------------------------------ */

interface PaginateState {
  decos: DecorationSet;
  result: Pagination | null;
  continuous: boolean;
}

export const paginateKey = new PluginKey<PaginateState>("bardo-paginate");

function spacerWidget(b: Break, contLabel: string) {
  return () => {
    const el = document.createElement(b.kind === "block" ? "div" : "span");
    el.className = `b-pb b-pb--${b.kind}`;
    el.dataset.kind = b.kind;
    el.dataset.h = String(b.h);
    el.style.height = `${b.h}px`;
    el.contentEditable = "false";
    if (b.cont) {
      const c = document.createElement("span");
      c.className = "b-cont";
      c.textContent = b.cont;
      const s = document.createElement("span");
      s.className = "b-cont-tag";
      s.textContent = ` ${contLabel}`;
      c.appendChild(s);
      el.appendChild(c);
    }
    return el;
  };
}

function sameBreaks(a: Break[], b: Break[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].pos !== b[i].pos || a[i].kind !== b[i].kind || Math.abs(a[i].h - b[i].h) > 0.75 || a[i].cont !== b[i].cont) return false;
  }
  return true;
}

export interface PaginateOptions {
  onResult: (p: Pagination) => void;
  contLabel: () => string;
}

/** Ask for a new pagination soon (fonts loaded, an automatic list changed size…). */
export function requestRepaginate(view: EditorView) {
  const fn = (view as unknown as { __bardoRepaginate?: () => void }).__bardoRepaginate;
  fn?.();
}

export function setContinuous(view: EditorView, on: boolean) {
  view.dispatch(view.state.tr.setMeta(paginateKey, { continuous: on }).setMeta("addToHistory", false));
  requestRepaginate(view);
}

export function getPagination(state: EditorState): Pagination | null {
  return paginateKey.getState(state)?.result ?? null;
}

export function paginatePlugin(opts: PaginateOptions) {
  let rev = 0;
  return new Plugin<PaginateState>({
    key: paginateKey,
    state: {
      init: () => ({ decos: DecorationSet.empty, result: null, continuous: false }),
      apply(tr, prev) {
        const meta = tr.getMeta(paginateKey) as Partial<PaginateState> | undefined;
        if (meta) return { ...prev, ...meta };
        if (tr.docChanged) return { ...prev, decos: prev.decos.map(tr.mapping, tr.doc) };
        return prev;
      },
    },
    props: {
      decorations(state) {
        const s = paginateKey.getState(state);
        return s && !s.continuous ? s.decos : null;
      },
    },
    view(view) {
      let timer: number | null = null;
      let frame: number | null = null;
      const run = () => {
        frame = null;
        if (!view.dom.isConnected) return;
        const state = view.state;
        const st = paginateKey.getState(state)!;
        const data = getData(state.doc);
        const index = indexKey.getState(state)!.index;
        let result: Pagination;
        try {
          result = computePagination(view, data.format, index, st.continuous, opts.contLabel(), rev + 1);
        } catch (e) {
          console.error("pagination failed", e);
          return;
        }
        const prev = st.result;
        const changed = !prev || !sameBreaks(prev.breaks, result.breaks) || prev.pages.length !== result.pages.length || prev.continuous !== result.continuous;
        if (!changed && prev) {
          // Same breaks: keep the decorations, refresh the page data (scenes, speakers).
          opts.onResult({ ...result, rev: prev.rev });
          return;
        }
        rev += 1;
        result.rev = rev;
        const label = opts.contLabel();
        const decos = DecorationSet.create(
          state.doc,
          result.breaks.map((b) => Decoration.widget(b.pos, spacerWidget(b, label), { side: -1, key: `pb-${b.kind}-${b.pos}-${Math.round(b.h * 10)}-${b.cont}`, ignoreSelection: true })),
        );
        view.dispatch(state.tr.setMeta(paginateKey, { decos, result }).setMeta(indexKey, { pagesRev: rev }).setMeta("addToHistory", false));
        opts.onResult(result);
      };
      const schedule = (delay = 120) => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          timer = null;
          if (frame !== null) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(run);
        }, delay);
      };
      (view as unknown as { __bardoRepaginate?: () => void }).__bardoRepaginate = () => schedule(60);
      const onFonts = () => schedule(30);
      document.fonts?.addEventListener?.("loadingdone", onFonts);
      document.fonts?.ready.then(onFonts);
      schedule(0);
      return {
        update(v, prevState) {
          const before = paginateKey.getState(prevState);
          const now = paginateKey.getState(v.state);
          if (v.state.doc !== prevState.doc || before?.continuous !== now?.continuous) schedule();
        },
        destroy() {
          if (timer !== null) window.clearTimeout(timer);
          if (frame !== null) cancelAnimationFrame(frame);
          document.fonts?.removeEventListener?.("loadingdone", onFonts);
        },
      };
    },
  });
}
