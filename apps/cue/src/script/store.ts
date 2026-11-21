import { create } from "zustand";
import type { PageText } from "../model/anchor";
import { SCRIPT_PART } from "../model/show";
import { api } from "../lib/api";
import { useDoc } from "../store/doc";
import { closePdf, openPdf, pageSizes, pageText, PdfError, type PageSize, type PDFDocumentProxy } from "./pdf";

/**
 * The PDF of the open show, loaded with pdf.js. It follows the show: a new script (another fingerprint) is
 * loaded, the same one is kept even if it moved from a pending copy into the saved file.
 */
interface ScriptDocState {
  status: "none" | "loading" | "ready" | "error";
  /** "password" | "damaged" | "io" when status is error. */
  error: string;
  /** The fingerprint of what is loaded (or loading). */
  key: string | null;
  doc: PDFDocumentProxy | null;
  sizes: PageSize[];
}

export const useScriptDoc = create<ScriptDocState>(() => ({ status: "none", error: "", key: null, doc: null, sizes: [] }));

let texts = new Map<number, Promise<PageText>>();
let loading = 0;

function release() {
  const old = useScriptDoc.getState().doc;
  texts = new Map();
  closePdf(old);
}

/** The text of a page of the loaded script (cached). */
export function scriptPageText(n: number): Promise<PageText> | null {
  const { doc } = useScriptDoc.getState();
  if (!doc || n < 1 || n > doc.numPages) return null;
  let p = texts.get(n);
  if (!p) {
    p = pageText(doc, n).catch(() => ({ page: n, items: [] }));
    texts.set(n, p);
  }
  return p;
}

/** Uses a PDF already opened (after "Carica il copione"): no second read. */
export async function adoptScript(key: string, doc: PDFDocumentProxy): Promise<void> {
  loading++;
  release();
  const sizes = await pageSizes(doc);
  useScriptDoc.setState({ status: "ready", error: "", key, doc, sizes });
}

/** Reads the bytes of the current script: the pending copy if there is one, else the part in the file. */
export async function readScriptBytes(): Promise<Uint8Array | null> {
  const { show, pending, filePath } = useDoc.getState();
  if (!show?.script || show.script.kind !== "pdf") return null;
  const part = show.script.part || SCRIPT_PART;
  if (pending[part]) return api.stagedRead(pending[part]);
  if (filePath) return api.tcueReadPart(filePath, part);
  return null;
}

async function sync() {
  const { show } = useDoc.getState();
  const script = show?.script?.kind === "pdf" ? show.script : null;
  const key = script ? script.sha256 || `${script.part}:${script.pageCount}` : null;
  const cur = useScriptDoc.getState();
  if (key === cur.key && cur.status !== "error") return;
  const ticket = ++loading;
  if (!key) {
    release();
    useScriptDoc.setState({ status: "none", error: "", key: null, doc: null, sizes: [] });
    return;
  }
  useScriptDoc.setState({ status: "loading", error: "", key });
  try {
    const bytes = await readScriptBytes();
    if (!bytes) throw new Error("io: no script bytes");
    const doc = await openPdf(bytes);
    const sizes = await pageSizes(doc);
    if (ticket !== loading) return closePdf(doc);
    release();
    useScriptDoc.setState({ status: "ready", error: "", key, doc, sizes });
  } catch (e) {
    if (ticket !== loading) return;
    release();
    useScriptDoc.setState({ status: "error", error: e instanceof PdfError ? e.problem : "io", doc: null, sizes: [] });
  }
}

/** Keeps the loaded PDF in step with the open show. */
export function startScriptSync(): () => void {
  void sync();
  return useDoc.subscribe((s, prev) => {
    if (s.show?.script !== prev.show?.script || s.loadRev !== prev.loadRev) void sync();
  });
}

/** Loads again (after an error, or when the file was saved somewhere else). */
export function reloadScript() {
  useScriptDoc.setState({ key: null });
  void sync();
}
