import { open, save, ask, message } from "@tauri-apps/plugin-dialog";
import { basename, debounce } from "@theatre-suite/core";
import { api, isTauri } from "./api";
import { docToFile, parseDoc, useDoc, AUDIO_EXTENSIONS } from "../state/doc";
import { useSettings } from "../state/settings";
import type { Track } from "../state/types";

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
