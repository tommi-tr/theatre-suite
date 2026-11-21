import { invoke } from "@tauri-apps/api/core";
import type { TFunc } from "@theatre-suite/core";
import { resolveRelativePath } from "@theatre-suite/show-files/diaframma";
import { api, isTauri } from "./api";
import { appForPath, failedSource, Library, newLink, parseSource, relativePath, type LoadedSource, type SourceLink } from "../model/sources";

/**
 * Reading the sources of a show from disk (model/sources.ts does the parsing): resolve the path relative to the
 * `.tcue`, read the file, fingerprint it, find each track's audio file. In a plain browser (the `/?demo` preview)
 * files come from an in-memory table filled by the demo (`putDemoSourceFile`).
 */

const demoFiles = new Map<string, string>();

/** The preview's files (demo `.granvelo` / `.diaframma`), by absolute path. */
export function putDemoSourceFile(absPath: string, text: string): void {
  demoFiles.set(absPath, text);
}

const isAbs = (p: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p);

/** Absolute path of a link (null: relative path and the show was never saved). */
export async function resolveSourcePath(link: Pick<SourceLink, "path">, tcuePath: string | null): Promise<string | null> {
  if (!tcuePath) return isAbs(link.path) ? link.path : null;
  if (isTauri) return invoke<string | null>("files_resolve_relative", { base: tcuePath, rel: link.path });
  return isAbs(link.path) ? link.path : resolveRelativePath(tcuePath, link.path);
}

/** Path of a file relative to the show file (`/`), or null when on another drive. */
export async function pathRelativeToShow(tcuePath: string, absPath: string): Promise<string | null> {
  if (isTauri) return invoke<string | null>("files_relative_to", { base: tcuePath, path: absPath });
  return relativePath(tcuePath, absPath);
}

type Read = { ok: true; text: string } | { ok: false; state: "missing" | "unreadable"; detail: string };

async function readText(absPath: string): Promise<Read> {
  if (!isTauri) {
    const text = demoFiles.get(absPath);
    return text === undefined ? { ok: false, state: "missing", detail: absPath } : { ok: true, text };
  }
  try {
    return { ok: true, text: await invoke<string>("files_read_text", { path: absPath }) };
  } catch (e) {
    const msg = String(e);
    return { ok: false, state: msg.startsWith("missing:") ? "missing" : "unreadable", detail: msg };
  }
}

/** SHA-256 of a file (hex); null in the browser or when it cannot be read. */
export async function fileSha256(absPath: string): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return await invoke<string>("files_sha256", { path: absPath });
  } catch {
    return null;
  }
}

/** Reads one source. Never throws: problems are in `status`. */
export async function loadSource(link: SourceLink, tcuePath: string | null): Promise<LoadedSource> {
  if (link.app !== "granvelo" && link.app !== "diaframma") return failedSource(link, "unsupported", { detail: `app ${link.app}` });
  const absPath = await resolveSourcePath(link, tcuePath).catch(() => null);
  if (!absPath) return failedSource(link, "missing", { detail: "relative path and no show file" });
  const [read, sha256] = await Promise.all([readText(absPath), fileSha256(absPath)]);
  if (!read.ok) return failedSource(link, read.state, { absPath, detail: read.detail });
  const first = parseSource(link, read.text, { absPath, sha256 });
  if (link.app !== "diaframma" || !isTauri) return first;
  // Diaframma's order: the saved absolute path, then the path relative to the cue list; the first that exists.
  const found = new Map<string, boolean>();
  await Promise.all(first.audio.flatMap((a) => a.candidates).map(async (c) => found.set(c, await api.pathExists(c).catch(() => false))));
  return parseSource(link, read.text, { absPath, sha256, trackPath: (cands) => cands.find((c) => found.get(c)) ?? null });
}

/** Reads every source of the show into a library. */
export async function loadLibrary(links: readonly SourceLink[], tcuePath: string | null): Promise<Library> {
  return new Library(await Promise.all(links.map((l) => loadSource(l, tcuePath))));
}

/**
 * Links a file chosen by the user (`.granvelo` or `.diaframma`): path relative to the show file when possible, the
 * Granvelo document id, the name to show and the fingerprint. Null when the file is not a source Cue reads.
 */
export async function linkSourceFile(absPath: string, tcuePath: string | null, makeId: () => string): Promise<{ link: SourceLink; loaded: LoadedSource } | null> {
  const app = appForPath(absPath);
  if (!app || app === "bardo") return null;
  const rel = tcuePath ? await pathRelativeToShow(tcuePath, absPath).catch(() => null) : null;
  let link: SourceLink = { ...newLink(app, absPath, null, makeId), path: rel ?? absPath };
  const loaded = await loadSource({ ...link, path: absPath }, null);
  if (loaded.status.state === "ok") {
    link = { ...link, name: loaded.title };
    if (loaded.granvelo) link.docId = loaded.granvelo.id;
    if (loaded.sha256) link.sha256 = loaded.sha256;
  }
  return { link, loaded: { ...loaded, link } };
}

/** The link with the fingerprint of the file as loaded now (after the user checked a changed source). */
export const withFingerprint = (link: SourceLink, loaded: LoadedSource): SourceLink => (loaded.sha256 ? { ...link, sha256: loaded.sha256 } : link);

/** What to say about a source, in the interface language ("" when all is well). */
export function sourceStatusText(t: TFunc, s: LoadedSource): string {
  const app = s.link.app === "granvelo" ? "Granvelo" : s.link.app === "diaframma" ? "Diaframma" : "Bardo";
  switch (s.status.state) {
    case "ok":
      return s.status.changed ? t("Changed since the last save: check the GOs that use it.") : "";
    case "missing":
      return t("The file is not there: {path}", { path: s.absPath ?? s.link.path });
    case "unreadable":
      return t("The file cannot be read.");
    case "wrongFormat":
      return s.link.app === "granvelo" ? t("This is not a Granvelo show (.granvelo).") : t("This is not a Diaframma cue list (.diaframma).");
    case "newer":
      return t("Made with a newer {app}: update {app} on this computer.", { app });
    case "otherDocument":
      return t("This file now holds another show: check the GOs that use it.");
    case "unsupported":
      return t("Bardo scripts come in a later version.");
  }
}
