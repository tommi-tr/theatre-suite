import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import type { Node as PMNode } from "prosemirror-model";
import { normalizeFormat } from "../format/model";
import { defaultCategories, emptyData, newId } from "./defaults";
import { schema, ID_NODES } from "./schema";
import type { DocData, DocLang } from "./types";

/**
 * The .bardo file: readable JSON.
 * - `data`: title, characters, categories, format… (everything that is not running text)
 * - `content`: the text, as ProseMirror JSON
 * - `versions`: earlier versions kept inside the file, compressed (gzip + base64).
 *   They are never exported: Word and PDF copies contain only the current text.
 */
export const FILE_FORMAT_VERSION = 1;

export interface SavedVersion {
  number: string;
  label: string;
  savedAt: string;
  /** gzip + base64 of { data, content }. */
  gz: string;
  words: number;
}

export interface BardoFile {
  format: "bardo";
  formatVersion: number;
  app: string;
  savedAt: string;
  data: DocData;
  content: unknown[];
  versions: SavedVersion[];
}

export class BardoFileError extends Error {}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Fills missing fields (older or partly damaged files) with sensible values. */
export function normalizeData(raw: unknown): DocData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<DocData>;
  const lang: DocLang = r.lang === "en" ? "en" : "it";
  const def = emptyData(lang);
  const arr = <T,>(v: unknown, f: (x: Record<string, unknown>) => T | null): T[] =>
    Array.isArray(v) ? (v.map((x) => (x && typeof x === "object" ? f(x as Record<string, unknown>) : null)).filter(Boolean) as T[]) : [];
  const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
  const cats = arr(r.categories, (c) => (typeof c.id === "string" && c.id ? { id: c.id, name: str(c.name, c.id), icon: (str(c.icon, "tag") as DocData["categories"][number]["icon"]), builtin: !!c.builtin } : null));
  // Built-in categories are always there.
  for (const b of defaultCategories(lang)) if (!cats.some((c) => c.id === b.id)) cats.push(b);
  return {
    lang,
    meta: {
      title: str(r.meta?.title),
      subtitle: str(r.meta?.subtitle),
      basedOn: str(r.meta?.basedOn),
      authors: str(r.meta?.authors),
      translation: str(r.meta?.translation),
    },
    characters: arr(r.characters, (c) => (typeof c.id === "string" && c.id ? { id: c.id, name: str(c.name), short: str(c.short), long: str(c.long), actor: str(c.actor) } : null)),
    cast: arr(r.cast, (c) => ({ id: str(c.id) || newId("role"), role: str(c.role), people: str(c.people) })),
    categories: cats,
    items: arr(r.items, (c) => (typeof c.id === "string" && c.id && typeof c.cat === "string" ? { id: c.id, cat: c.cat, name: str(c.name), description: str(c.description) } : null)),
    notes: arr(r.notes, (c) => (typeof c.id === "string" && c.id ? { id: c.id, text: str(c.text), author: str(c.author), created: str(c.created) } : null)),
    version: str(r.version, def.version),
    versionLabel: str(r.versionLabel, def.versionLabel),
    format: normalizeFormat(r.format),
    sends: arr(r.sends, (c) => ({ at: str(c.at), version: str(c.version), format: str(c.format), audience: str(c.audience) })),
  };
}

/** Gives a fresh id to elements that lost it or share it with another one. */
export function fixIds(doc: PMNode): PMNode {
  const seen = new Set<string>();
  let changed = false;
  const blocks: PMNode[] = [];
  doc.forEach((node) => {
    if (ID_NODES.has(node.type.name)) {
      const id = node.attrs.id as string;
      if (!id || seen.has(id)) {
        changed = true;
        const prefix = { act: "act", tableau: "tab", scene: "scene", speech: "sp", direction: "dir", auto: "auto" }[node.type.name] ?? "el";
        const fresh = newId(prefix);
        seen.add(fresh);
        blocks.push(node.type.create({ ...node.attrs, id: fresh }, node.content, node.marks));
        return;
      }
      seen.add(id);
    }
    blocks.push(node);
  });
  return changed ? doc.type.create(doc.attrs, blocks) : doc;
}

export function docFromParts(data: DocData, content: unknown[]): PMNode {
  const json = { type: "doc", attrs: { data }, content: content.length ? content : [{ type: "direction", attrs: { id: newId("dir") } }] };
  const doc = schema.nodeFromJSON(json);
  doc.check();
  return fixIds(doc);
}

function docContent(doc: PMNode): unknown[] {
  const json = doc.toJSON() as { content?: unknown[] };
  return json.content ?? [];
}

export function serialize(doc: PMNode, versions: SavedVersion[], appName: string): string {
  const file: BardoFile = {
    format: "bardo",
    formatVersion: FILE_FORMAT_VERSION,
    app: appName,
    savedAt: new Date().toISOString(),
    data: doc.attrs.data as DocData,
    content: docContent(doc),
    versions,
  };
  return JSON.stringify(file, null, 1);
}

export interface ParsedFile {
  doc: PMNode;
  versions: SavedVersion[];
}

export function parse(text: string): ParsedFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BardoFileError("not-json");
  }
  const f = raw as Partial<BardoFile>;
  if (!f || f.format !== "bardo") throw new BardoFileError("not-bardo");
  if (typeof f.formatVersion === "number" && f.formatVersion > FILE_FORMAT_VERSION) throw new BardoFileError("newer");
  const data = normalizeData(f.data);
  let doc: PMNode;
  try {
    doc = docFromParts(data, Array.isArray(f.content) ? f.content : []);
  } catch {
    throw new BardoFileError("damaged");
  }
  const versions = Array.isArray(f.versions)
    ? f.versions.filter((v): v is SavedVersion => !!v && typeof v === "object" && typeof (v as SavedVersion).gz === "string")
    : [];
  return { doc, versions };
}

/** Packs the current text as an earlier version (kept inside the file). */
export function makeVersion(doc: PMNode, number: string, label: string, words: number): SavedVersion {
  const payload = JSON.stringify({ data: doc.attrs.data, content: docContent(doc) });
  return { number, label, savedAt: new Date().toISOString(), gz: bytesToBase64(gzipSync(strToU8(payload), { level: 9 })), words };
}

export function openVersion(v: SavedVersion): PMNode {
  const payload = JSON.parse(strFromU8(gunzipSync(base64ToBytes(v.gz)))) as { data: unknown; content: unknown[] };
  return docFromParts(normalizeData(payload.data), Array.isArray(payload.content) ? payload.content : []);
}

/** Next version number: "2.3" → "2.4"; "3" → "3.1". */
export function nextVersion(v: string): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v.trim());
  if (!m) return "1.0";
  const major = Number(m[1]);
  const minor = m[2] === undefined ? 0 : Number(m[2]);
  return `${major}.${minor + 1}`;
}

/** Next major version: "2.3" → "3.0". */
export function nextMajor(v: string): string {
  const m = /^(\d+)/.exec(v.trim());
  return `${m ? Number(m[1]) + 1 : 1}.0`;
}
