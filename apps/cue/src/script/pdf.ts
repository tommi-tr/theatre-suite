/**
 * pdf.js for the script: fully offline. The worker is bundled with the app (Vite `?url`), and CMaps, standard
 * fonts, wasm decoders and ICC profiles are served by the app itself (vite.config.ts, `/pdfjs/…`). The PDF is
 * only read, never changed: no editing, no forms, no scripts.
 */
import { AnnotationMode, getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageText, TextItem } from "../model/anchor";

GlobalWorkerOptions.workerSrc = workerUrl;

export { AnnotationMode };
export type { PDFDocumentProxy, PDFPageProxy };

const dataUrl = (dir: string) => new URL(`${import.meta.env.BASE_URL}pdfjs/${dir}/`, document.baseURI).href;

/** Size of a page at 100% (PDF points), rotation applied. */
export interface PageSize {
  w: number;
  h: number;
}

export class PdfError extends Error {
  constructor(
    public problem: "password" | "damaged",
    detail: string,
  ) {
    super(detail);
    this.name = "PdfError";
  }
}

/** Opens a PDF from its bytes (pdf.js takes the buffer: a copy is passed, the caller keeps its own). */
export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = getDocument({
    data: bytes.slice(),
    cMapUrl: dataUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: dataUrl("standard_fonts"),
    wasmUrl: dataUrl("wasm"),
    iccUrl: dataUrl("iccs"),
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: false,
  });
  try {
    return await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name ?? "";
    throw new PdfError(name === "PasswordException" ? "password" : "damaged", String((e as Error)?.message ?? e));
  }
}

/** Frees a PDF (its worker side too). */
export function closePdf(doc: PDFDocumentProxy | null | undefined): void {
  if (doc) void doc.loadingTask.destroy().catch(() => {});
}

/** The size of every page at 100%. */
export async function pageSizes(doc: PDFDocumentProxy): Promise<PageSize[]> {
  const out: PageSize[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const v = p.getViewport({ scale: 1 });
    out.push({ w: v.width, h: v.height });
  }
  return out;
}

/** The text of a page as runs positioned in fractions of the page (for anchors). */
export async function pageText(doc: PDFDocumentProxy, n: number): Promise<PageText> {
  const page = await doc.getPage(n);
  const v = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: TextItem[] = [];
  for (const it of content.items) {
    if (!("str" in it) || !it.str) continue;
    const [a, b, c, d, e, f] = it.transform as number[];
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 10;
    const [x, baseline] = v.convertToViewportPoint(e, f);
    const top = baseline - size * 0.85;
    items.push({ str: it.str, x: x / v.width, y: top / v.height, w: (it.width || 0) / v.width, h: size / v.height });
  }
  return { page: n, items };
}

/** The text of every page (to relocate anchors in a new script). */
export async function allText(doc: PDFDocumentProxy): Promise<PageText[]> {
  const out: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push(await pageText(doc, i));
  return out;
}

/** An annotation already in the PDF with a comment (highlight, sticky note…), shown read-only. */
export interface PdfComment {
  kind: string;
  /** Fractions of the page. */
  x: number;
  y: number;
  w: number;
  h: number;
  author: string;
  text: string;
  /** A sticky note: drawn as an icon (pdf.js does not draw it on the canvas). */
  icon: boolean;
}

export async function pageComments(page: PDFPageProxy): Promise<PdfComment[]> {
  const v = page.getViewport({ scale: 1 });
  const list = await page.getAnnotations({ intent: "display" }).catch(() => []);
  const out: PdfComment[] = [];
  for (const a of list as Array<Record<string, unknown>>) {
    const text = ((a.contentsObj as { str?: string } | undefined)?.str ?? "").trim();
    const subtype = String(a.subtype ?? "");
    if (!text || subtype === "Popup" || subtype === "Link" || subtype === "Widget") continue;
    const rect = a.rect as number[] | undefined;
    if (!rect || rect.length !== 4) continue;
    const [x1, y1] = v.convertToViewportPoint(rect[0], rect[1]);
    const [x2, y2] = v.convertToViewportPoint(rect[2], rect[3]);
    out.push({
      kind: subtype,
      x: Math.min(x1, x2) / v.width,
      y: Math.min(y1, y2) / v.height,
      w: Math.abs(x2 - x1) / v.width,
      h: Math.abs(y2 - y1) / v.height,
      author: ((a.titleObj as { str?: string } | undefined)?.str ?? "").trim(),
      text,
      icon: subtype === "Text",
    });
  }
  return out;
}
