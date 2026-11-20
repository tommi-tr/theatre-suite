import { checkShowJson, ShowFileError } from "../model/show";
import type { PartInfo, TcueOpened, TcueSaveArgs, TcueSaved, VersionEntry } from "./api";

/**
 * Show files in memory, for the browser preview (`/?demo`): the same answers and errors as the native side
 * (src-tauri/src/tcue.rs), without a disk. Nothing survives a reload.
 */
interface MemFile {
  showJson: string;
  parts: Map<string, Uint8Array>;
  modifiedMs: number;
}

const files = new Map<string, MemFile>();

const fail = (code: string, detail: string) => new Error(`${code}: ${detail}`);

function checked(text: string) {
  try {
    return checkShowJson(text);
  } catch (e) {
    if (e instanceof ShowFileError) throw fail(e.problem === "not-json" ? "damaged" : e.problem, e.message);
    throw e;
  }
}

/** A stand-in fingerprint (the real one is the SHA-256 of the file). */
function fingerprint(f: MemFile): string {
  let h = 2166136261;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  };
  feed(f.showJson);
  for (const [n, b] of f.parts) feed(`${n}:${b.length}`);
  return (h >>> 0).toString(16).padStart(8, "0").repeat(8);
}

const partsOf = (f: MemFile): PartInfo[] => [...f.parts].map(([name, b]) => ({ name, size: b.length }));
const versionsDirOf = (path: string) => path.replace(/\.tcue$/i, "") + ".versions";
const sepOf = (p: string) => (p.includes("\\") ? "\\" : "/");
const parentOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")));
const isVersion = (p: string) => /\.versions$/i.test(parentOf(p)) && /\.tcue$/i.test(p);

function get(path: string): MemFile {
  const f = files.get(path);
  if (!f) throw fail("io", `Cannot open ${path}: not found`);
  return f;
}

function fromBase64(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const memFs = {
  exists: (path: string) => files.has(path),
  /** Puts a file in memory as it is (the demo show). */
  put(path: string, showJson: string, parts: Record<string, Uint8Array> = {}, modifiedMs = Date.now()) {
    files.set(path, { showJson, parts: new Map(Object.entries(parts)), modifiedMs });
  },
  async create(path: string, title: string): Promise<TcueOpened> {
    if (files.has(path)) throw fail("io", `${path} already exists`);
    const id = Math.random().toString(16).slice(2).padEnd(16, "0") + Date.now().toString(16).padStart(16, "0");
    memFs.put(path, JSON.stringify({ format: "theatre.cue", formatVersion: 1, id, title: title.trim() }, null, 2));
    return memFs.open(path);
  },
  async open(path: string): Promise<TcueOpened> {
    const f = get(path);
    checked(f.showJson);
    return { showJson: f.showJson, parts: partsOf(f), sha256: fingerprint(f) };
  },
  async readPart(path: string, name: string): Promise<Uint8Array> {
    const b = get(path).parts.get(name);
    if (!b) throw fail("no-part", `The file has no part ${name}`);
    return b;
  },
  async save(a: TcueSaveArgs): Promise<TcueSaved> {
    if (a.showJson !== null) checked(a.showJson);
    const src = a.sourcePath ? get(a.sourcePath) : files.get(a.path);
    const showJson = a.showJson ?? src?.showJson;
    if (showJson === undefined) throw fail("damaged", "Nothing to save: no show.json");
    const parts = new Map(src?.parts ?? []);
    for (const r of a.removeParts ?? []) parts.delete(r);
    for (const p of a.addParts ?? []) {
      if (p.data === undefined) throw fail("io", `Cannot read ${p.fromPath ?? p.name} in the preview`);
      parts.set(p.name, fromBase64(p.data));
    }
    const f = { showJson, parts, modifiedMs: Date.now() };
    files.set(a.path, f);
    return { parts: partsOf(f), sha256: fingerprint(f) };
  },
  async versionsList(path: string): Promise<VersionEntry[]> {
    const dir = versionsDirOf(path);
    const out: VersionEntry[] = [];
    for (const [p, f] of files) {
      if (parentOf(p) !== dir) continue;
      const j = JSON.parse(f.showJson) as Record<string, unknown>;
      const kind = j.versionKind === "auto" ? "auto" : "named";
      const savedWith = j.savedWith as { version?: unknown } | undefined;
      out.push({
        path: p,
        name: p.slice(dir.length + 1),
        modifiedMs: f.modifiedMs,
        bytes: f.showJson.length + [...f.parts.values()].reduce((s, b) => s + b.length, 0),
        kind,
        note: typeof j.versionNote === "string" ? j.versionNote : "",
        appVersion: typeof savedWith?.version === "string" ? savedWith.version : "",
        damaged: false,
      });
    }
    return out.sort((a, b) => b.modifiedMs - a.modifiedMs || b.name.localeCompare(a.name));
  },
  async versionSave(path: string, name: string, kind: "named" | "auto", note: string): Promise<string> {
    const f = get(path);
    const dir = versionsDirOf(path);
    const stem = name.replace(/\.tcue$/i, "");
    let target = `${dir}${sepOf(path)}${name}`;
    for (let i = 2; files.has(target); i++) target = `${dir}${sepOf(path)}${stem}-${i}.tcue`;
    const j = { ...(JSON.parse(f.showJson) as object), versionKind: kind, versionNote: note.slice(0, 200) };
    files.set(target, { showJson: JSON.stringify(j, null, 2), parts: new Map(f.parts), modifiedMs: Date.now() });
    return target;
  },
  async versionRestore(path: string, version: string): Promise<TcueSaved> {
    if (!isVersion(version)) throw fail("io", "Only saved versions can be restored.");
    const v = get(version);
    const j = JSON.parse(v.showJson) as Record<string, unknown>;
    delete j.versionKind;
    delete j.versionNote;
    return memFs.save({ path, sourcePath: version, showJson: JSON.stringify(j, null, 2) });
  },
  async versionDelete(path: string): Promise<void> {
    if (!isVersion(path)) throw fail("io", "Only saved versions can be deleted.");
    files.delete(path);
  },
};
