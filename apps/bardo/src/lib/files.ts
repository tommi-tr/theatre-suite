import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { basename, debounce, type TFunc } from "@theatre-suite/core";
import { BardoFileError, makeVersion, openVersion, parse, serialize, type SavedVersion } from "../model/file";
import { newScriptDoc, getData } from "../model/defaults";
import { sampleDoc } from "../model/sample";
import { deriveIndex } from "../model/derive";
import type { Node as PMNode } from "prosemirror-model";
import { api, isTauri } from "./api";
import { APP_NAME } from "./version";
import { currentState, useDoc } from "../store/doc";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

const FILTER = [{ name: "Bardo", extensions: ["bardo"] }];

function currentDoc(): PMNode | null {
  return currentState()?.doc ?? useDoc.getState().doc;
}

export function fileErrorText(t: TFunc, e: unknown): string {
  if (e instanceof BardoFileError) {
    switch (e.message) {
      case "not-json":
      case "not-bardo":
        return t("This is not a Bardo script.");
      case "newer":
        return t("This script was saved with a newer version of Bardo. Please update Bardo to open it.");
      default:
        return t("The file is damaged and cannot be opened.");
    }
  }
  return e instanceof Error ? e.message : String(e);
}

/** Suggested file name: "Amleto - copione 2.3.bardo". */
export function suggestedName(t: TFunc, ext: string): string {
  const doc = currentDoc();
  const data = doc ? getData(doc) : null;
  const title = data?.meta.title.trim() || t("Script");
  const label = t("script");
  const v = data?.version ? ` ${data.version}` : "";
  return `${title} - ${label}${v}.${ext}`.replace(/[\\/:*?"<>|]/g, "-");
}

export async function saveDoc(t: TFunc, saveAs = false): Promise<boolean> {
  const st = useDoc.getState();
  const doc = currentDoc();
  if (!doc) return false;
  let path = st.filePath;
  if (!path || saveAs) {
    const chosen = await save({ filters: FILTER, defaultPath: path ?? suggestedName(t, "bardo"), title: t("Save script") });
    if (!chosen) return false;
    path = chosen.toLowerCase().endsWith(".bardo") ? chosen : `${chosen}.bardo`;
  }
  try {
    await api.writeText(path, serialize(doc, st.versions, APP_NAME));
    useDoc.getState().markSaved(path);
    useSettings.getState().addRecent(path);
    writeAutosaveNow();
    return true;
  } catch (e) {
    await message(`${t("Could not save the script.")}\n${String(e)}`, { title: "Bardo", kind: "error" });
    return false;
  }
}

/** Asks what to do with unsaved changes. False if the user cancelled. */
export async function confirmDiscard(t: TFunc): Promise<boolean> {
  if (!useDoc.getState().dirty) return true;
  const wantSave = await ask(t("The script has unsaved changes. Save them first?"), {
    title: "Bardo",
    kind: "warning",
    okLabel: t("Save"),
    cancelLabel: t("Don't save"),
  });
  if (wantSave) return saveDoc(t);
  return true;
}

export async function openDocPath(t: TFunc, path: string): Promise<void> {
  try {
    const text = await api.readText(path);
    const { doc, versions } = parse(text);
    useDoc.getState().load(doc, { filePath: path, dirty: false, versions });
    useSettings.getState().addRecent(path);
  } catch (e) {
    await message(`${t("Could not open {name}.", { name: basename(path) })}\n${fileErrorText(t, e)}`, { title: "Bardo", kind: "error" });
  }
}

export async function openDocDialog(t: TFunc): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  const chosen = await open({ filters: FILTER, multiple: false, directory: false, title: t("Open script") });
  if (typeof chosen === "string") await openDocPath(t, chosen);
}

export async function newDoc(t: TFunc): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  useDoc.getState().load(newScriptDoc(useSettings.getState().settings.docLang), { filePath: null, dirty: false, versions: [] });
}

export async function openSample(t: TFunc): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  const lang = useSettings.getState().settings.language;
  useDoc.getState().load(sampleDoc(lang), { filePath: null, dirty: false, versions: [] });
}

/* ------------------------------------------------------------------ */
/* Versions kept inside the file                                        */
/* ------------------------------------------------------------------ */

/** Saves the current text as a version and moves on to `nextNumber`. */
export function saveAsNewVersion(nextNumber: string, label: string): SavedVersion | null {
  const st = useDoc.getState();
  const view = st.view;
  const doc = currentDoc();
  if (!view || !doc) return null;
  const data = getData(doc);
  const words = deriveIndex(doc).totals.words;
  const v = makeVersion(doc, data.version, data.versionLabel, words);
  st.setVersions([...st.versions, v]);
  view.dispatch(view.state.tr.setDocAttribute("data", { ...data, version: nextNumber, versionLabel: label }));
  return v;
}

/** Brings back an older version: the current text is kept as a version first. */
export function restoreVersion(v: SavedVersion) {
  const st = useDoc.getState();
  const doc = currentDoc();
  if (!doc) return;
  const data = getData(doc);
  const keep = makeVersion(doc, data.version, data.versionLabel, deriveIndex(doc).totals.words);
  const old = openVersion(v);
  st.load(old, { filePath: st.filePath, dirty: true, versions: [...st.versions, keep] });
}

/* ------------------------------------------------------------------ */
/* Autosave and crash recovery                                          */
/* ------------------------------------------------------------------ */

interface AutosaveData {
  savedAt: string;
  filePath: string | null;
  dirty: boolean;
  file: string;
}

function snapshot(): string | null {
  const st = useDoc.getState();
  const doc = currentDoc();
  if (!doc) return null;
  const data: AutosaveData = { savedAt: new Date().toISOString(), filePath: st.filePath, dirty: st.dirty, file: serialize(doc, st.versions, APP_NAME) };
  return JSON.stringify(data);
}

function writeAutosaveNow() {
  if (!isTauri) return;
  const s = snapshot();
  if (s) api.autosaveWrite(s).catch((e) => console.error("autosave failed", e));
}

const autosaveSoon = debounce(writeAutosaveNow, 2000);

/** Every change is copied to Bardo's data folder within ~2 s. */
export function startAutosave(): () => void {
  let prevDoc = currentDoc();
  let prevPath = useDoc.getState().filePath;
  let prevDirty = useDoc.getState().dirty;
  return useDoc.subscribe((s) => {
    const doc = s.state?.doc ?? s.doc;
    if (doc !== prevDoc || s.filePath !== prevPath || s.dirty !== prevDirty) {
      prevDoc = doc;
      prevPath = s.filePath;
      prevDirty = s.dirty;
      autosaveSoon();
    }
  });
}

export function flushAutosave() {
  autosaveSoon.flush();
}

export function restoreAutosave(text: string): boolean {
  try {
    const data = JSON.parse(text) as AutosaveData;
    const { doc, versions } = parse(data.file);
    useDoc.getState().load(doc, { filePath: data.filePath, dirty: data.dirty, versions });
    return true;
  } catch {
    return false;
  }
}

export function toastError(t: TFunc, e: unknown) {
  useUi.getState().showToast(fileErrorText(t, e), "error");
}
