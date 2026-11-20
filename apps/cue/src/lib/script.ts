import { message, open, save } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { basename, type TFunc } from "@theatre-suite/core";
import { buildIndex, relocate, type Relocation } from "../model/anchor";
import { SCRIPT_PART, type Anchor, type CueShow } from "../model/show";
import { adoptScript, readScriptBytes, useScriptDoc } from "../script/store";
import { allText, closePdf, openPdf, PdfError, type PDFDocumentProxy } from "../script/pdf";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { api, isTauri } from "./api";
import { memFs } from "./memFs";

/**
 * The script of the show: "Carica il copione", "Sostituisci copione" (anchors relocated, with a preview before
 * applying) and "Esporta il PDF". The PDF chosen by the user is first copied into Cue's autosave folder
 * (a pending part: it survives a crash) and goes into the `.tcue` at the next save.
 */

interface Picked {
  fileName: string;
  staged: string;
  sha256: string;
  doc: PDFDocumentProxy;
}

async function tell(text: string) {
  if (isTauri) await message(text, { title: "Cue", kind: "error" });
  else useUi.getState().showToast(text, "error");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) return "";
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The browser preview: a file input instead of the native dialog. */
function pickInBrowser(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.style.display = "none";
    input.dataset.cue = "script-input";
    document.body.appendChild(input);
    let done = false;
    const finish = (f: File | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(f);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    input.click();
  });
}

/** Asks for a PDF, stages it and opens it (so a file that is not a readable PDF is refused at once). */
async function pickPdf(t: TFunc, title: string): Promise<Picked | null> {
  let fileName = "";
  let staged = "";
  let sha256 = "";
  let bytes: Uint8Array;
  try {
    if (isTauri) {
      const chosen = await open({ filters: [{ name: "PDF", extensions: ["pdf"] }], multiple: false, directory: false, title });
      if (typeof chosen !== "string") return null;
      fileName = basename(chosen);
      const s = await api.partStage(chosen, SCRIPT_PART);
      staged = s.path;
      sha256 = s.sha256;
      bytes = await api.stagedRead(staged);
    } else {
      const file = await pickInBrowser();
      if (!file) return null;
      fileName = file.name;
      bytes = new Uint8Array(await file.arrayBuffer());
      sha256 = await sha256Hex(bytes);
      staged = memFs.stage(bytes, SCRIPT_PART);
    }
  } catch (e) {
    await tell(`${t("Could not read the PDF.")}\n${String((e as Error)?.message ?? e)}`);
    return null;
  }
  try {
    const doc = await openPdf(bytes);
    return { fileName, staged, sha256, doc };
  } catch (e) {
    void api.stagedDrop([staged]).catch(() => {});
    await tell(e instanceof PdfError && e.problem === "password" ? t("This PDF is protected by a password: Cue cannot open it.") : t("This file is not a readable PDF."));
    return null;
  }
}

function scriptRef(p: Picked) {
  return { kind: "pdf" as const, part: SCRIPT_PART, fileName: p.fileName, sha256: p.sha256, pageCount: p.doc.numPages };
}

/** Puts the new script in the show (with `recipe` for the anchors). The old pending copy is no longer needed. */
async function install(p: Picked, recipe: (s: CueShow) => CueShow) {
  const old = useDoc.getState().pending[SCRIPT_PART];
  await adoptScript(p.sha256 || `${SCRIPT_PART}:${p.doc.numPages}`, p.doc);
  useDoc.getState().changeWithPart((s) => recipe({ ...s, script: scriptRef(p) }), { name: SCRIPT_PART, staged: p.staged });
  if (old && old !== p.staged) void api.stagedDrop([old]).catch(() => {});
}

/** "Carica il copione…": the first script of the show. */
export async function loadScript(t: TFunc): Promise<void> {
  if (useDoc.getState().show?.script) return replaceScript(t);
  const p = await pickPdf(t, t("Load the script"));
  if (!p) return;
  await install(p, (s) => s);
  useUi.getState().showToast(t("Script loaded: {n} pages. It is saved inside the show file.", { n: p.doc.numPages }));
}

/* ------------------------------------------------------------------ */
/* Replace the script: relocate anchors, preview, apply                  */
/* ------------------------------------------------------------------ */

export type AnchorOwner = { kind: "note"; id: string } | { kind: "go"; id: string } | { kind: "zone"; id: string };

export interface ReplaceRow {
  owner: AnchorOwner;
  /** What the user recognises it by (the note text, "GO 14"). */
  label: string;
  old: Anchor;
  relocation: Relocation;
  /** Index of the chosen candidate (0 = best). */
  choice: number;
  checked: boolean;
}

export interface ReplacePlan {
  picked: Picked;
  oldPages: number;
  rows: ReplaceRow[];
}

/** The plan shown in the preview dialog (null = no dialog). */
export const useReplacePlan = create<{ plan: ReplacePlan | null; set: (p: ReplacePlan | null) => void }>((set) => ({ plan: null, set: (plan) => set({ plan }) }));

/** Every anchor of the show, with who owns it. */
export function anchorsOf(show: CueShow): { owner: AnchorOwner; label: string; anchor: Anchor }[] {
  return [
    ...show.notes.map((n) => ({ owner: { kind: "note" as const, id: n.id }, label: n.text, anchor: n.anchor })),
    ...show.gos.map((g, i) => ({ owner: { kind: "go" as const, id: g.id }, label: `GO ${i + 1}`, anchor: g.anchor })),
    ...show.speedZones.map((z) => ({ owner: { kind: "zone" as const, id: z.id }, label: "", anchor: z.from })),
  ];
}

/** Builds the relocation plan of every anchor in the new script. */
export async function planReplace(show: CueShow, picked: Picked): Promise<ReplacePlan> {
  const index = buildIndex(await allText(picked.doc));
  const rows = anchorsOf(show).map(({ owner, label, anchor }) => {
    const relocation = relocate(anchor, index);
    return { owner, label, old: anchor, relocation, choice: 0, checked: relocation.status === "sure" };
  });
  return { picked, oldPages: show.script?.kind === "pdf" ? show.script.pageCount : 0, rows };
}

/** Where a row's anchor goes: the chosen candidate when checked, otherwise the old place (page kept within the new script). */
export function targetOf(row: ReplaceRow, pages: number): Anchor {
  const cand = row.relocation.candidates[row.choice];
  if (row.checked && cand) return { ...row.old, ...cand.anchor };
  return { ...row.old, page: Math.min(Math.max(1, row.old.page), Math.max(1, pages)) };
}

/** Applies a plan: the new script, every anchor moved as decided. */
export async function applyReplace(t: TFunc, plan: ReplacePlan): Promise<void> {
  const pages = plan.picked.doc.numPages;
  const by = new Map(plan.rows.map((r) => [`${r.owner.kind}:${r.owner.id}`, targetOf(r, pages)]));
  const at = (kind: string, id: string, a: Anchor) => by.get(`${kind}:${id}`) ?? a;
  useReplacePlan.getState().set(null);
  await install(plan.picked, (s) => ({
    ...s,
    notes: s.notes.map((n) => ({ ...n, anchor: at("note", n.id, n.anchor) })),
    gos: s.gos.map((g) => ({ ...g, anchor: at("go", g.id, g.anchor) })),
    speedZones: s.speedZones.map((z) => ({ ...z, from: at("zone", z.id, z.from) })),
  }));
  const moved = plan.rows.filter((r) => r.checked).length;
  useUi.getState().showToast(t("Script replaced: {n} of {total} anchors moved.", { n: moved, total: plan.rows.length }));
}

export function cancelReplace(plan: ReplacePlan) {
  useReplacePlan.getState().set(null);
  void api.stagedDrop([plan.picked.staged]).catch(() => {});
  closePdf(plan.picked.doc);
}

/** "Sostituisci copione…": a new edition of the script; notes and GOs are found again in it. */
export async function replaceScript(t: TFunc): Promise<void> {
  const show = useDoc.getState().show;
  if (!show) return;
  const p = await pickPdf(t, t("Replace the script"));
  if (!p) return;
  const current = useDoc.getState().show!;
  if (!anchorsOf(current).length) {
    await install(p, (s) => s);
    useUi.getState().showToast(t("Script replaced: {n} pages.", { n: p.doc.numPages }));
    return;
  }
  useReplacePlan.getState().set(await planReplace(current, p));
}

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

/** "Esporta il PDF…": the PDF inside the show, unchanged, to a file the user chooses. */
export async function exportScript(t: TFunc): Promise<void> {
  const { show, filePath, pending } = useDoc.getState();
  if (!show?.script || show.script.kind !== "pdf") return;
  const part = show.script.part || SCRIPT_PART;
  const name = show.script.fileName || "script.pdf";
  try {
    if (isTauri) {
      const dest = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }], defaultPath: name, title: t("Export the PDF") });
      if (!dest) return;
      await api.partExport({ path: filePath, name: part, staged: pending[part] ?? null, dest: /\.pdf$/i.test(dest) ? dest : `${dest}.pdf` });
      useUi.getState().showToast(t("PDF exported: {name}", { name: basename(dest) }));
    } else {
      const bytes = await readScriptBytes();
      if (!bytes) return;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  } catch (e) {
    await tell(`${t("Could not export the PDF.")}\n${String((e as Error)?.message ?? e)}`);
  }
}

/** Is a script loaded and shown? (menu items) */
export const scriptReady = () => useScriptDoc.getState().status === "ready";
