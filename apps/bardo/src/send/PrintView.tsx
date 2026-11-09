import { setContinuous, type Pagination } from "../editor/paginate";
import { PAGE_SIZES } from "../format/model";
import { getData } from "../model/defaults";
import { useDoc } from "../store/doc";

/*
 * Print view (PDF and printer).
 *
 * The pages are exactly the ones on screen: for every sheet Bardo copies
 * the white sheet (with header and footer) and the slice of text that
 * falls on it, then the system prints them one per sheet of paper.
 */

export interface PrintOptions {
  /** Character id: their speeches are highlighted (copy for an actor). */
  actor?: string;
  /** Category id: its words are highlighted (copy for a department). */
  category?: string;
  /** Written across every page; replaces the one of the format. */
  watermark?: string;
}

export interface PageSize {
  widthMm: number;
  heightMm: number;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Waits for the text to be laid out in pages (switches off the continuous view if needed). */
export async function ensurePages(): Promise<{ p: Pagination; restore: () => void }> {
  const st = useDoc.getState();
  const view = st.view;
  if (!view) throw new Error("No script is open.");
  let restore = () => {};
  if (!st.pages || st.pages.continuous) {
    setContinuous(view, false);
    restore = () => setContinuous(view, true);
  }
  try {
    await document.fonts?.ready;
  } catch {
    /* fonts API missing: continue */
  }
  for (let i = 0; i < 60; i++) {
    const p = useDoc.getState().pages;
    if (p && !p.continuous && p.pages.length) return { p, restore };
    await sleep(50);
  }
  restore();
  throw new Error("The pages are not ready yet. Please try again.");
}

function highlightCss(opts: PrintOptions): string {
  const rules: string[] = [];
  if (opts.actor) rules.push(`.b-pp-doc .b-speech[data-speaker="${CSS.escape(opts.actor)}"] .b-speech-text{background:rgba(255,213,79,.45);box-shadow:-3pt 0 0 rgba(255,213,79,.45),-5.5pt 0 0 #c8642c}`);
  if (opts.category) rules.push(`.b-pp-doc .b-cat[data-cat="${CSS.escape(opts.category)}"]{background:rgba(255,213,79,.6);border-radius:1.5pt}`);
  return rules.join("\n");
}

/**
 * Draws pages into `target`. `only` limits the pages drawn (preview).
 * `target` must be laid out (not display:none) while this runs.
 */
export function renderPages(target: HTMLElement, p: Pagination, opts: PrintOptions, only?: number[]): number {
  const view = useDoc.getState().view;
  if (!view) return 0;
  const data = getData(view.state.doc);
  const g = p.geom;
  const stack = view.dom.closest(".b-stack");
  const sheets = stack ? Array.from(stack.querySelectorAll<HTMLElement>(":scope > .b-sheet")) : [];
  const children = Array.from(view.dom.children) as HTMLElement[];
  const boxes = children.map((el) => ({ el, top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight }));
  target.replaceChildren();
  const style = document.createElement("style");
  style.textContent = highlightCss(opts);
  target.appendChild(style);
  const watermark = opts.watermark ?? data.format.watermark;
  const list = only ?? p.pages.map((_x, i) => i);
  for (const i of list) {
    const page = p.pages[i];
    if (!page) continue;
    const start = page.top;
    const end = page.top + g.pageH;
    const el = document.createElement("div");
    el.className = "b-pp-page";
    el.style.width = `${g.pageW}px`;
    el.style.height = `${g.pageH}px`;
    const sheet = sheets[i];
    if (sheet) {
      const s = sheet.cloneNode(true) as HTMLElement;
      s.style.left = "0";
      s.style.top = "0";
      s.style.boxShadow = "none";
      s.querySelector(".b-sheet__wm")?.remove();
      el.appendChild(s);
    }
    if (watermark) {
      const wm = document.createElement("div");
      wm.className = "b-sheet__wm b-pp-wm";
      wm.textContent = watermark;
      el.appendChild(wm);
    }
    const content = document.createElement("div");
    content.className = "b-doc b-pp-doc b-pp-content";
    content.style.width = `${g.contentW}px`;
    content.style.left = `${-page.left}px`;
    const slice = boxes.filter((b) => b.bottom > start - 1 && b.top < end + 1);
    for (const b of slice) content.appendChild(b.el.cloneNode(true));
    el.appendChild(content);
    target.appendChild(el);
    if (slice.length) {
      const first = content.firstElementChild as HTMLElement;
      content.style.top = `${slice[0].top - start - first.offsetTop}px`;
    }
  }
  return list.length;
}

const PAGE_STYLE_ID = "b-print-page";

/** Prepares the print view for the whole script; returns the paper size. */
export async function preparePrint(opts: PrintOptions): Promise<{ size: PageSize; pages: number; done: () => void }> {
  const { p, restore } = await ensurePages();
  const root = document.getElementById("print-root");
  if (!root) throw new Error("Print view missing.");
  const data = getData(useDoc.getState().view!.state.doc);
  const size = PAGE_SIZES[data.format.page.size] ?? PAGE_SIZES.A4;
  let pageStyle = document.getElementById(PAGE_STYLE_ID);
  if (!pageStyle) {
    pageStyle = document.createElement("style");
    pageStyle.id = PAGE_STYLE_ID;
    document.head.appendChild(pageStyle);
  }
  pageStyle.textContent = `@page{size:${size.w}mm ${size.h}mm;margin:0}`;
  root.classList.add("is-measuring");
  const pages = renderPages(root, p, opts);
  root.classList.remove("is-measuring");
  restore();
  return {
    size: { widthMm: size.w, heightMm: size.h },
    pages,
    done: () => root.replaceChildren(),
  };
}

/** The print view lives outside the app (#print-root): nothing to draw here. */
export function PrintRoot() {
  return null;
}
