import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { basename, debounce, findShow, type TFunc } from "@theatre-suite/core";
import { CantinellaFileError, parse, serialize } from "../model/file";
import { newData } from "../model/defaults";
import { api, isTauri } from "./api";
import { APP_VERSION } from "./version";
import { useDoc } from "../store/doc";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

const FILTER = [{ name: "Cantinella", extensions: ["cantinella"] }];
const APP = { name: "Cantinella", version: APP_VERSION };

export function fileErrorText(t: TFunc, e: unknown): string {
  if (e instanceof CantinellaFileError) {
    switch (e.problem) {
      case "not-json":
      case "not-cantinella":
        return t("This is not a Cantinella file.");
      case "newer":
        return t("This file was saved with a newer version of Cantinella. Please update Cantinella to open it.");
      case "unsupported":
        return t("This file was made with a test version of Cantinella whose format is no longer read.");
      default:
        return t("The file is damaged and cannot be opened.");
    }
  }
  return e instanceof Error ? e.message : String(e);
}

/** Suggested name: "<show> - produzione.cantinella", or "Produzione.cantinella". */
export function suggestedName(t: TFunc): string {
  const { show, data } = useDoc.getState();
  const base = show ? `${show.title} - ${t("production")}` : data.title.trim() || t("Production");
  return `${base}.cantinella`.replace(/[\\/:*?"<>|]/g, "-");
}

/** Looks for the launcher's show index next to the file and shows the show in the title bar. */
export async function detectShow(path: string | null): Promise<void> {
  if (!path || !isTauri) {
    if (isTauri) useDoc.getState().setShow(null);
    return;
  }
  const show = await findShow(path, { exists: api.pathExists, read: api.readText });
  if (useDoc.getState().filePath === path) useDoc.getState().setShow(show);
}

export async function saveDoc(t: TFunc, saveAs = false): Promise<boolean> {
  const st = useDoc.getState();
  let path = st.filePath;
  if (!path || saveAs) {
    const chosen = await save({ filters: FILTER, defaultPath: path ?? suggestedName(t), title: t("Save production") });
    if (!chosen) return false;
    path = chosen.toLowerCase().endsWith(".cantinella") ? chosen : `${chosen}.cantinella`;
  }
  try {
    await api.writeText(path, serialize(useDoc.getState().data, APP));
    useDoc.getState().markSaved(path);
    useSettings.getState().addRecent(path);
    writeAutosaveNow();
    void detectShow(path);
    return true;
  } catch (e) {
    await message(`${t("Could not save the file.")}\n${String(e)}`, { title: "Cantinella", kind: "error" });
    return false;
  }
}

/** Asks what to do with unsaved changes. False if the user cancelled. */
export async function confirmDiscard(t: TFunc): Promise<boolean> {
  if (!useDoc.getState().dirty) return true;
  const wantSave = await ask(t("There are unsaved changes. Save them first?"), {
    title: "Cantinella",
    kind: "warning",
    okLabel: t("Save"),
    cancelLabel: t("Don't save"),
  });
  if (wantSave) return saveDoc(t);
  return true;
}

export async function openDocPath(t: TFunc, path: string): Promise<boolean> {
  try {
    const data = parse(await api.readText(path));
    useDoc.getState().load(data, { filePath: path, dirty: false });
    useSettings.getState().addRecent(path);
    startPlace();
    void detectShow(path);
    return true;
  } catch (e) {
    await message(`${t("Could not open {name}.", { name: basename(path) })}\n${fileErrorText(t, e)}`, { title: "Cantinella", kind: "error" });
    return false;
  }
}

export async function openDocDialog(t: TFunc): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  const chosen = await open({ filters: FILTER, multiple: false, directory: false, title: t("Open production") });
  if (typeof chosen === "string") await openDocPath(t, chosen);
}

export async function newDoc(t: TFunc): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  useDoc.getState().load(newData(t("Production")), { filePath: null, dirty: false });
  startPlace();
}

/** Where the window starts: the start screen for an empty file, the address book otherwise. */
export function startPlace() {
  const { data } = useDoc.getState();
  const ui = useUi.getState();
  ui.selectPerson(null);
  if (data.people.length === 0) ui.go(null);
  else ui.go("departments", "people");
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

function snapshot(): string {
  const st = useDoc.getState();
  const data: AutosaveData = { savedAt: new Date().toISOString(), filePath: st.filePath, dirty: st.dirty, file: serialize(st.data, APP) };
  return JSON.stringify(data);
}

function writeAutosaveNow() {
  if (!isTauri) return;
  api.autosaveWrite(snapshot()).catch((e) => console.error("autosave failed", e));
}

const autosaveSoon = debounce(writeAutosaveNow, 2000);

/** Every change is copied to Cantinella's data folder within ~2 s. */
export function startAutosave(): () => void {
  return useDoc.subscribe((s, prev) => {
    if (s.data !== prev.data || s.filePath !== prev.filePath || s.dirty !== prev.dirty) autosaveSoon();
  });
}

export function flushAutosave() {
  autosaveSoon.flush();
}

export function restoreAutosave(text: string): boolean {
  try {
    const a = JSON.parse(text) as AutosaveData;
    useDoc.getState().load(parse(a.file), { filePath: a.filePath, dirty: a.dirty });
    startPlace();
    void detectShow(a.filePath);
    return true;
  } catch {
    return false;
  }
}
