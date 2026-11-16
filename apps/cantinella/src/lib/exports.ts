import { open, save } from "@tauri-apps/plugin-dialog";
import type { TFunc } from "@theatre-suite/core";
import { api, isTauri } from "./api";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

/** File name without characters Windows does not accept. */
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").trim();

/** Name to start from: "<show> - <what>". */
export function exportBase(what: string): string {
  const { show, data } = useDoc.getState();
  const base = show?.title || data.title.trim();
  return safeName(base ? `${base} - ${what}` : what);
}

/** Saves a text file chosen by the user (a download in the browser preview). Returns true when saved. */
export async function saveTextFile(t: TFunc, name: string, ext: string, mime: string, text: string): Promise<boolean> {
  try {
    if (!isTauri) {
      const url = URL.createObjectURL(new Blob([text], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    }
    const dir = useDoc.getState().filePath?.replace(/[\\/][^\\/]*$/, "");
    const chosen = await save({ defaultPath: dir ? `${dir}/${name}.${ext}` : `${name}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }], title: t("Save") });
    if (!chosen) return false;
    const path = chosen.toLowerCase().endsWith(`.${ext}`) ? chosen : `${chosen}.${ext}`;
    await api.writeText(path, text);
    useUi.getState().showToast(t("Saved {name}.", { name: path.split(/[\\/]/).pop() ?? path }));
    return true;
  } catch (e) {
    useUi.getState().showToast(`${t("Could not save the file.")} ${e instanceof Error ? e.message : String(e)}`, "error");
    return false;
  }
}

/** Asks for a file and reads it as text. Returns null when cancelled. */
export async function pickTextFile(title: string, extensions: string[]): Promise<{ path: string; text: string } | null> {
  if (!isTauri) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = extensions.map((e) => `.${e}`).join(",");
      input.onchange = async () => {
        const f = input.files?.[0];
        resolve(f ? { path: f.name, text: await f.text() } : null);
      };
      input.click();
    });
  }
  const chosen = await open({ filters: [{ name: extensions.join(", "), extensions }], multiple: false, directory: false, title });
  if (!chosen || Array.isArray(chosen)) return null;
  return { path: chosen, text: await api.readText(chosen) };
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A simple printable page: a title, a subtitle and blocks of rows. */
export interface PrintDoc {
  title: string;
  subtitle?: string;
  blocks: Array<{ heading?: string; rows?: string[][]; head?: string[]; lines?: string[] }>;
}

export function printHtml(doc: PrintDoc): string {
  const parts = [`<h1>${escHtml(doc.title)}</h1>`];
  if (doc.subtitle) parts.push(`<p class="sub">${escHtml(doc.subtitle)}</p>`);
  for (const b of doc.blocks) {
    if (b.heading) parts.push(`<h2>${escHtml(b.heading)}</h2>`);
    if (b.lines) parts.push(...b.lines.map((l) => `<p>${escHtml(l)}</p>`));
    if (b.rows?.length) {
      parts.push("<table>");
      if (b.head) parts.push(`<thead><tr>${b.head.map((h) => `<th>${escHtml(h)}</th>`).join("")}</tr></thead>`);
      parts.push(`<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${escHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    }
  }
  return parts.join("\n");
}

/**
 * Prints a page (on Windows "Microsoft Print to PDF" makes a PDF). The page is put in a layer that
 * only the printer sees, and removed afterwards.
 */
export function printDoc(doc: PrintDoc): void {
  document.getElementById("cn-print")?.remove();
  const el = document.createElement("div");
  el.id = "cn-print";
  el.innerHTML = printHtml(doc);
  document.body.appendChild(el);
  const done = () => {
    el.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  setTimeout(() => window.print(), 30);
}
