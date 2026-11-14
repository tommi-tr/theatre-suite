/**
 * The show (project of the launcher) a document belongs to, as the apps see it.
 * The index file is written by the launcher (crates/theatre-project, `progetto.theatre`);
 * apps only read it, to show the show's name and colour in their title bar.
 */

export const SHOW_INDEX_FILE = "progetto.theatre";

/** Colours offered for a show without an image (same list as the launcher). */
export const SHOW_COLORS = ["#7a2e4a", "#9a6a2a", "#2f6f80", "#4a5fa8", "#5b7a3a", "#7a4a8a", "#8a4a2a", "#3a5a5a"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The colour of a show: the one chosen, otherwise one derived from the title (always the same). */
export function showColor(title: string, cover?: { color?: string | null } | null): string {
  if (cover?.color && /^#[0-9a-f]{6}$/i.test(cover.color)) return cover.color;
  return SHOW_COLORS[hash(title.trim().toLowerCase()) % SHOW_COLORS.length];
}

export interface ShowInfo {
  id: string;
  title: string;
  color: string;
}

/** Reads the launcher's index file. Null if the text is not a show index. */
export function parseShowIndex(text: string): ShowInfo | null {
  try {
    const v = JSON.parse(text) as { format?: unknown; id?: unknown; title?: unknown; cover?: { color?: string } };
    if (v?.format !== "theatre.project" || typeof v.title !== "string" || !v.title.trim()) return null;
    return { id: typeof v.id === "string" ? v.id : "", title: v.title.trim(), color: showColor(v.title, v.cover) };
  } catch {
    return null;
  }
}

/** Folder of a file path (Windows or POSIX separators). */
export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i <= 0 ? path.slice(0, i + 1) : path.slice(0, i);
}

export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith("/") || dir.endsWith("\\") ? dir + name : dir + sep + name;
}
