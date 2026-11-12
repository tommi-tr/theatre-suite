import { open, save, ask, message } from "@tauri-apps/plugin-dialog";
import { basename, debounce } from "@theatre-suite/core";
import { api, isTauri, type VersionEntry } from "./api";
import { docToFile, parseDoc, useDoc, AUDIO_EXTENSIONS } from "../state/doc";
import { useSettings } from "../state/settings";
import type { Track } from "../state/types";

const CUE_EXT = /\.diaframma$/i;

type T = (k: string, v?: Record<string, string | number>) => string;

const CUE_FILTER = [{ name: "Diaframma cue list", extensions: ["diaframma"] }];

/** Before saving: store paths relative to the cue list too, so a show folder can be moved. */
async function withRelativePaths(tracks: Track[], filePath: string): Promise<Track[]> {
  return Promise.all(
    tracks.map(async (t) => {
      if (!t.file) return t;
      const rel = await api.makeRelative(filePath, t.file.path).catch(() => null);
      return { ...t, file: { ...t.file, relativePath: rel } };
    }),
  );
}

export async function saveDoc(t: T, saveAs = false): Promise<boolean> {
  const st = useDoc.getState();
  let path = st.filePath;
  if (!path || saveAs) {
    const chosen = await save({ filters: CUE_FILTER, defaultPath: path ?? "Show.diaframma", title: t("Save cue list") });
    if (!chosen) return false;
    path = chosen.toLowerCase().endsWith(".diaframma") ? chosen : `${chosen}.diaframma`;
  }
  try {
    const tracks = await withRelativePaths(st.tracks, path);
    await keepOldContentOnce(t, path);
    await api.writeText(path, JSON.stringify(docToFile(tracks), null, 2));
    useDoc.setState({ tracks });
    useDoc.getState().markSaved(path);
    useSettings.getState().addRecent(path);
    writeAutosaveNow();
    return true;
  } catch (e) {
    await message(t("Could not save the cue list.") + "\n" + String(e), { title: "Diaframma", kind: "error" });
    return false;
  }
}

/** Asks what to do with unsaved changes. Returns false if the user cancelled. */
export async function confirmDiscard(t: T): Promise<boolean> {
  if (!useDoc.getState().dirty) return true;
  const wantSave = await ask(t("The cue list has unsaved changes. Save them first?"), {
    title: "Diaframma",
    kind: "warning",
    okLabel: t("Save"),
    cancelLabel: t("Don't save"),
  });
  if (wantSave) return saveDoc(t);
  return true;
}

/** Fixes paths: tries the relative path, then marks missing files. */
async function resolveFiles(tracks: Track[], filePath: string | null): Promise<{ tracks: Track[]; missing: Record<string, boolean> }> {
  const exists = await api.pathsExist(tracks.map((t) => t.file?.path ?? ""));
  const missing: Record<string, boolean> = {};
  const out = await Promise.all(
    tracks.map(async (t, i) => {
      if (!t.file || exists[i]) return t;
      if (filePath && t.file.relativePath) {
        const p = await api.resolveRelative(filePath, t.file.relativePath).catch(() => null);
        if (p) return { ...t, file: { ...t.file, path: p } };
      }
      missing[t.id] = true;
      return t;
    }),
  );
  return { tracks: out, missing };
}

export async function openDocPath(t: T, path: string): Promise<void> {
  try {
    const text = await api.readText(path);
    const parsed = parseDoc(text);
    const { tracks, missing } = await resolveFiles(parsed, path);
    const doc = useDoc.getState();
    doc.replaceDoc(tracks, path, false);
    doc.setMissing(missing);
    useSettings.getState().addRecent(path);
  } catch (e) {
    await message(t("Could not open {name}.", { name: basename(path) }) + "\n" + (e instanceof Error ? e.message : String(e)), {
      title: "Diaframma",
      kind: "error",
    });
  }
}

export async function openDocDialog(t: T): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  const chosen = await open({ filters: CUE_FILTER, multiple: false, directory: false, title: t("Open cue list") });
  if (typeof chosen === "string") await openDocPath(t, chosen);
}

export async function newDocConfirm(t: T): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  useDoc.getState().newDoc();
}

export async function pickAudioFiles(t: T, multiple: boolean): Promise<string[]> {
  const chosen = await open({
    multiple,
    directory: false,
    title: t("Choose audio files"),
    filters: [{ name: t("Audio files"), extensions: AUDIO_EXTENSIONS }],
  });
  if (!chosen) return [];
  return Array.isArray(chosen) ? chosen : [chosen];
}

/** Guided search of missing files: the user picks a folder, Diaframma looks inside it. */
export async function locateMissing(t: T): Promise<number> {
  const doc = useDoc.getState();
  const ids = Object.keys(doc.missing).filter((id) => doc.missing[id]);
  if (!ids.length) return 0;
  const dir = await open({ directory: true, multiple: false, title: t("Choose the folder that contains the audio files") });
  if (typeof dir !== "string") return -1;
  const tracks = doc.tracks.filter((x) => ids.includes(x.id));
  const found = await api.findFiles(dir, tracks.map((x) => x.file?.name ?? ""));
  const missing = { ...doc.missing };
  let n = 0;
  doc.setTracks(
    (all) =>
      all.map((x) => {
        const k = tracks.findIndex((m) => m.id === x.id);
        const p = k >= 0 ? found[k] : null;
        if (!p || !x.file) return x;
        n++;
        delete missing[x.id];
        return { ...x, file: { ...x.file, path: p } };
      }),
    { record: true },
  );
  doc.setMissing(missing);
  useDoc.getState().tracks.forEach((x) => x.file && useDoc.getState().ensureInfo(x.file.path));
  return n;
}

// ---------------- Confirmations ----------------

async function confirmBox(t: T, message: string, okLabel: string): Promise<boolean> {
  if (!isTauri) return window.confirm(message);
  return ask(message, { title: "Diaframma", kind: "warning", okLabel, cancelLabel: t("Cancel") });
}

const shown = (track: Track, number: number | null) => (number !== null ? `${number} · ${track.file?.name ?? ""}` : (track.file?.name ?? ""));

/** Clearing a track loses its file and all its settings: ask first (an empty row asks nothing). */
export async function confirmClearTrack(t: T, track: Track, number: number | null): Promise<boolean> {
  if (!track.file) return true;
  return confirmBox(t, t("Clear track {name}? The audio file and all its settings are removed from the row. You can bring them back with Undo.", { name: shown(track, number) }), t("Clear"));
}

/** Deleting a row removes it from the cue list: ask first (an empty row asks nothing). */
export async function confirmDeleteTrack(t: T, track: Track, number: number | null): Promise<boolean> {
  if (!track.file) return true;
  return confirmBox(t, t("Delete track {name}? The row is removed from the cue list. You can bring it back with Undo.", { name: shown(track, number) }), t("Delete"));
}

// ---------------- Versions ----------------
//
// A version is a plain copy of the cue list in a folder next to it
// (`Show.diaframma` → `Show.versions/`). Named versions are made by the user
// and are never removed by Diaframma. Automatic ones (`…_auto.diaframma`) are
// made before the first save of a session and before a restore; the newest 30 are kept.

const AUTO_KEEP = 30;
const autoDone = new Set<string>();

export const versionsDirOf = (filePath: string) => filePath.replace(CUE_EXT, "") + ".versions";
const sepOf = (p: string) => (p.includes("\\") ? "\\" : "/");
const two = (n: number) => String(n).padStart(2, "0");
const stampOf = (d = new Date()) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;

export type VersionKind = "named" | "auto";

export interface VersionInfo extends VersionEntry {
  kind: VersionKind;
  note: string;
  tracks: number;
  appVersion: string;
}

/** Text of a cue list with the note and kind of a version added (readers of the format ignore them). */
function versionText(docText: string, kind: VersionKind, note: string): string {
  const raw = JSON.parse(docText) as Record<string, unknown>;
  return JSON.stringify({ ...raw, versionKind: kind, versionNote: note }, null, 2);
}

async function pruneAuto(dir: string): Promise<void> {
  const all = await api.versionsList(dir);
  const autos = all.filter((v) => /_auto(-\d+)?\.diaframma$/i.test(v.name));
  for (const old of autos.slice(AUTO_KEEP)) await api.versionDelete(old.path).catch(() => {});
}

/** Writes a version of `docText` (the text of a cue list file) next to `filePath`. Returns its path. */
export async function writeVersion(filePath: string, docText: string, kind: VersionKind, note: string): Promise<string> {
  const dir = versionsDirOf(filePath);
  const base = `${stampOf()}${kind === "auto" ? "_auto" : ""}`;
  let path = `${dir}${sepOf(filePath)}${base}.diaframma`;
  for (let i = 2; (await api.pathsExist([path]))[0]; i++) path = `${dir}${sepOf(filePath)}${base}-${i}.diaframma`;
  await api.writeText(path, versionText(docText, kind, note));
  if (kind === "auto") await pruneAuto(dir).catch(() => {});
  return path;
}

/** Before the first save of a session over an existing file, its old content is kept as an automatic version. */
async function keepOldContentOnce(t: T, path: string): Promise<void> {
  if (autoDone.has(path)) return;
  autoDone.add(path);
  try {
    if (!(await api.pathsExist([path]))[0]) return;
    await writeVersion(path, await api.readText(path), "auto", t("Before the first save of this session"));
  } catch {
    // A version that cannot be kept must never stop the save.
  }
}

/** Saves the cue list, then keeps this state as a named version. Returns false if the save was cancelled or failed. */
export async function saveNamedVersion(t: T, note: string): Promise<boolean> {
  if (!(await saveDoc(t))) return false;
  const st = useDoc.getState();
  if (!st.filePath) return false;
  try {
    await writeVersion(st.filePath, await api.readText(st.filePath), "named", note.trim());
    return true;
  } catch (e) {
    await message(t("Could not save the version.") + "\n" + String(e), { title: "Diaframma", kind: "error" });
    return false;
  }
}

/** The versions kept for a cue list, newest first, with their note and size read from each file. */
export async function listVersions(filePath: string): Promise<VersionInfo[]> {
  const entries = await api.versionsList(versionsDirOf(filePath));
  return Promise.all(
    entries.map(async (e) => {
      let note = "";
      let tracks = 0;
      let appVersion = "";
      let kind: VersionKind = /_auto(-\d+)?\.diaframma$/i.test(e.name) ? "auto" : "named";
      try {
        const raw = JSON.parse(await api.readText(e.path)) as Record<string, unknown>;
        if (typeof raw.versionNote === "string") note = raw.versionNote;
        if (raw.versionKind === "auto" || raw.versionKind === "named") kind = raw.versionKind;
        if (Array.isArray(raw.tracks)) tracks = (raw.tracks as { file?: unknown }[]).filter((x) => x && x.file).length;
        const app = raw.app as { version?: unknown } | undefined;
        if (app && typeof app.version === "string") appVersion = app.version;
      } catch {
        // A damaged version is still listed (it can be deleted).
      }
      return { ...e, kind, note, tracks, appVersion };
    }),
  );
}

/**
 * Goes back to a version: the current state is kept as an automatic version first, then the version is
 * loaded into the cue list as unsaved changes (the file on disk changes only when the user saves).
 */
export async function restoreVersion(t: T, v: VersionEntry): Promise<boolean> {
  const st = useDoc.getState();
  if (!st.filePath) return false;
  try {
    const parsed = parseDoc(await api.readText(v.path));
    await writeVersion(st.filePath, JSON.stringify(docToFile(st.tracks)), "auto", t("Before going back to another version"));
    const { tracks, missing } = await resolveFiles(parsed, st.filePath);
    const doc = useDoc.getState();
    doc.replaceDoc(tracks, st.filePath, true);
    doc.setMissing(missing);
    return true;
  } catch (e) {
    await message(t("Could not open {name}.", { name: v.name }) + "\n" + (e instanceof Error ? e.message : String(e)), { title: "Diaframma", kind: "error" });
    return false;
  }
}

export async function confirmRestoreVersion(t: T): Promise<boolean> {
  return confirmBox(t, t("Go back to this version? What you have now is kept as an automatic version first, and this one is loaded as unsaved changes."), t("Go back"));
}

export async function confirmDeleteVersion(t: T): Promise<boolean> {
  return confirmBox(t, t("Delete this version? It cannot be brought back."), t("Delete"));
}

// ---------------- Autosave ----------------

interface AutosaveData {
  savedAt: string;
  filePath: string | null;
  dirty: boolean;
  doc: ReturnType<typeof docToFile>;
}

function snapshot(): string {
  const st = useDoc.getState();
  const data: AutosaveData = { savedAt: new Date().toISOString(), filePath: st.filePath, dirty: st.dirty, doc: docToFile(st.tracks) };
  return JSON.stringify(data);
}

function writeAutosaveNow() {
  if (!isTauri) return;
  api.autosaveWrite(snapshot()).catch((e) => console.error("autosave failed", e));
}

const autosaveSoon = debounce(writeAutosaveNow, 1500);

/** Starts autosave: every change is written to the data folder within ~1.5 s. */
export function startAutosave(): () => void {
  let prevTracks = useDoc.getState().tracks;
  let prevPath = useDoc.getState().filePath;
  let prevDirty = useDoc.getState().dirty;
  return useDoc.subscribe((s) => {
    if (s.tracks !== prevTracks || s.filePath !== prevPath || s.dirty !== prevDirty) {
      prevTracks = s.tracks;
      prevPath = s.filePath;
      prevDirty = s.dirty;
      autosaveSoon();
    }
  });
}

export function flushAutosave() {
  autosaveSoon.flush();
}

/** Restores the state saved by autosave (after a crash, or a normal restart). */
export async function restoreAutosave(text: string): Promise<boolean> {
  try {
    const data = JSON.parse(text) as AutosaveData;
    const tracks = parseDoc(JSON.stringify(data.doc));
    const { tracks: fixed, missing } = await resolveFiles(tracks, data.filePath);
    const doc = useDoc.getState();
    doc.replaceDoc(fixed, data.filePath, data.dirty);
    doc.setMissing(missing);
    return true;
  } catch {
    return false;
  }
}

/** Exports the cue list as CSV (to share with the company or print). */
export async function exportCsv(t: T): Promise<void> {
  const { tracks, infos } = useDoc.getState();
  const fmt = (s: number | null | undefined) => (s === null || s === undefined ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
  let n = useSettings.getState().settings.numberFrom - 1;
  const rows = [[t("No."), t("Track"), t("Entry"), t("Exit"), "IN", "OUT", t("Duration"), t("Volume"), t("File")]];
  for (const x of tracks) {
    if (x.hidden) continue;
    n++;
    if (!x.file) continue;
    const info = infos[x.file.path];
    const dur = info && typeof info === "object" ? info.durationSec : x.file.durationSec ?? null;
    const out = x.outSec ?? dur;
    rows.push([String(n), x.file.name, x.entry ?? "", `${x.exit ?? ""}${x.loopOn ? " loop" : ""}`.trim(), fmt(x.inSec), fmt(out), fmt(out !== null && out !== undefined ? out - x.inSec : null), `${x.volumeDb} dB`, x.file.path]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const base = useDoc.getState().filePath?.replace(/\.diaframma$/i, "") ?? "Cue list";
  const path = await save({ defaultPath: `${base}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }], title: t("Export cue list") });
  if (!path) return;
  try {
    await api.writeText(path, "\ufeff" + csv);
  } catch (e) {
    await message(String(e), { title: "Diaframma", kind: "error" });
  }
}
