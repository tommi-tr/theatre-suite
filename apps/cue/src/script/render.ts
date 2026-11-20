import { AnnotationMode, pageComments, type PdfComment, type PDFDocumentProxy } from "./pdf";

/**
 * Page canvases: rendered by pdf.js at the size they are shown (× devicePixelRatio), at most two at a time,
 * and kept in a small cache so scrolling back and forth does not render again. Pages far from the view are
 * not rendered at all (the viewer asks only for the visible pages ± 1).
 */
const MAX_CACHED = 12;
/** A canvas never gets bigger than this (memory): a very big zoom is rendered a little softer. */
const MAX_PIXELS = 14_000_000;
const CONCURRENT = 2;

const cache = new Map<string, HTMLCanvasElement>();
const keyOf = (docKey: string, page: number, scale: number) => `${docKey}|${page}|${scale.toFixed(3)}`;

export function cachedCanvas(docKey: string, page: number, scale: number): HTMLCanvasElement | null {
  const k = keyOf(docKey, page, scale);
  const c = cache.get(k);
  if (!c) return null;
  cache.delete(k);
  cache.set(k, c);
  return c;
}

function remember(k: string, c: HTMLCanvasElement) {
  cache.set(k, c);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value as string;
    const old = cache.get(oldest);
    cache.delete(oldest);
    // A canvas still on screen stays where it is; it is only no longer cached.
    if (old && !old.isConnected) {
      old.width = 0;
      old.height = 0;
    }
  }
}

/** Forget everything of a script (another script was loaded). */
export function dropCache(docKey?: string) {
  for (const k of [...cache.keys()]) if (!docKey || k.startsWith(`${docKey}|`)) cache.delete(k);
}

interface Job {
  run: () => Promise<void>;
  cancelled: boolean;
}
const queue: Job[] = [];
let running = 0;

function pump() {
  while (running < CONCURRENT && queue.length) {
    const job = queue.shift()!;
    if (job.cancelled) continue;
    running++;
    job.run().finally(() => {
      running--;
      pump();
    });
  }
}

/** Renders a page at `scale` (device px per PDF point). Resolves to the canvas, or null if cancelled. */
export function renderPage(doc: PDFDocumentProxy, docKey: string, pageNo: number, scale: number): { promise: Promise<HTMLCanvasElement | null>; cancel: () => void } {
  const k = keyOf(docKey, pageNo, scale);
  const hit = cachedCanvas(docKey, pageNo, scale);
  if (hit) return { promise: Promise.resolve(hit), cancel: () => {} };
  let cancelRender: (() => void) | null = null;
  const job: Job = { cancelled: false, run: async () => {} };
  const promise = new Promise<HTMLCanvasElement | null>((resolve) => {
    job.run = async () => {
      if (job.cancelled) return resolve(null);
      try {
        const page = await doc.getPage(pageNo);
        const base = page.getViewport({ scale: 1 });
        const s = Math.min(scale, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
        const viewport = page.getViewport({ scale: s });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.className = "cue-page__canvas";
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return resolve(null);
        // Highlights, ink and stamps already in the PDF are drawn with the page (read-only).
        const task = page.render({ canvas, canvasContext: ctx, viewport, annotationMode: AnnotationMode.ENABLE, background: "#ffffff" });
        cancelRender = () => task.cancel();
        if (job.cancelled) task.cancel();
        await task.promise;
        remember(k, canvas);
        resolve(canvas);
      } catch {
        resolve(null);
      }
    };
  });
  queue.push(job);
  pump();
  return {
    promise,
    cancel: () => {
      job.cancelled = true;
      cancelRender?.();
    },
  };
}

const comments = new Map<string, Promise<PdfComment[]>>();

/** Comments already in the PDF on a page (cached per script). */
export function commentsOf(doc: PDFDocumentProxy, docKey: string, pageNo: number): Promise<PdfComment[]> {
  const k = `${docKey}|${pageNo}`;
  let p = comments.get(k);
  if (!p) {
    p = doc.getPage(pageNo).then(pageComments, () => []);
    comments.set(k, p);
  }
  return p;
}
