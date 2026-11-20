import { message, open, save } from "@tauri-apps/plugin-dialog";
import { basename, debounce, findShow, type TFunc } from "@theatre-suite/core";
import { confirmSave, confirmYesNo } from "@theatre-suite/ui";
import { errorCode, errorDetail, newShow, parseShow, serializeShow, type CueShow } from "../model/show";
import { api, isDemo, isTauri, type VersionEntry } from "./api";
import { APP_VERSION } from "./version";
import { useDoc } from "../store/doc";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

const EXT = /\.tcue$/i;
const FILTER = [{ name: "Cue", extensions: ["tcue"] }];
const APP = { name: "Cue", version: APP_VERSION };

/** A sentence for the user from an error of the native side or of the model. */
export function fileErrorText(t: TFunc, e: unknown): string {
  const detail = errorDetail(e);
  switch (errorCode(e)) {
    case "not-zip":
    case "not-cue":
      return t("This is not a Cue show file (.tcue).");
    case "newer":
      return t("This file was saved with a newer version of Cue. Please update Cue to open it.");
    case "damaged":
      return `${t("The file is damaged and cannot be opened.")}${detail ? `\n(${detail})` : ""}`;
    case "io":
      return `${t("The file cannot be read or written here.")}${detail ? `\n(${detail})` : ""}`;
    default:
      return detail || String(e);
  }
}

/** Problems are told in a window in the app, a toast in the browser preview. */
async function tell(text: string): Promise<void> {
  if (isTauri) await message(text, { title: "Cue", kind: "error" });
  else useUi.getState().showToast(text, "error");
}

/** Suggested name: the title of the show (or of the launcher's show). */
export function suggestedName(t: TFunc): string {
  const { band, show } = useDoc.getState();
  const base = show?.title.trim() || band?.title || t("New show");
  return `${base}.tcue`.replace(/[\\/:*?"<>|]/g, "-");
}

/** The show of the launcher: its index next to the file (in the demo, La locandiera). */
export async function detectShow(path: string | null): Promise<void> {
  if (!isTauri) {
    if (isDemo && path) {
      const { DEMO_BAND, DEMO_PATH } = await import("../model/demo");
      useDoc.getState().setBand(path === DEMO_PATH ? DEMO_BAND : null);
    }
    return;
  }
  if (!path) return useDoc.getState().setBand(null);
  const band = await findShow(path, { exists: api.pathExists, read: api.readText });
  if (useDoc.getState().filePath === path) useDoc.getState().setBand(band);
}

function afterLoad() {
  useUi.getState().setMode("prepare");
}

export async function saveDoc(t: TFunc, saveAs = false): Promise<boolean> {
  const st = useDoc.getState();
  if (!st.show) return false;
  let path = st.filePath;
  if (!path || saveAs) {
    if (!isTauri) {
      useUi.getState().showToast(t("In this preview files are not saved: install Cue to save."));
      return false;
    }
    const chosen = await save({ filters: FILTER, defaultPath: path ?? suggestedName(t), title: t("Save the show") });
    if (!chosen) return false;
    path = EXT.test(chosen) ? chosen : `${chosen}.tcue`;
  }
  try {
    if (path === st.filePath) await keepOldContentOnce(t, path);
    // Unchanged parts come from the file the show was opened from (also for Save as); none for a new show.
    const source = st.filePath && (await api.pathExists(st.filePath)) ? st.filePath : null;
    const saved = await api.tcueSave({ path, sourcePath: source, showJson: serializeShow(useDoc.getState().show!, APP) });
    useDoc.getState().markSaved(path, saved.parts, saved.sha256);
    useSettings.getState().addRecent(path);
    writeAutosaveNow();
    void detectShow(path);
    if (!isTauri) useUi.getState().showToast(t("Saved in this preview only: nothing is written on the disk."));
    return true;
  } catch (e) {
    await tell(`${t("Could not save the file.")}\n${fileErrorText(t, e)}`);
    return false;
  }
}

/** Asks what to do with unsaved changes. False if the user cancelled. */
export async function confirmDiscard(t: TFunc): Promise<boolean> {
  if (!useDoc.getState().dirty || !useDoc.getState().show) return true;
  const choice = await confirmSave({
    title: t("Unsaved changes"),
    message: t("There are unsaved changes. Save them first?"),
    cancel: t("Cancel"),
    discard: t("Don't save"),
    save: t("Save"),
    close: t("Close"),
  });
  if (choice === "save") return saveDoc(t);
  return choice === "discard";
}

export async function openDocPath(t: TFunc, path: string): Promise<boolean> {
  try {
    const opened = await api.tcueOpen(path);
    const show = parseShow(opened.showJson);
    useDoc.getState().load(show, { filePath: path, dirty: false, parts: opened.parts, sha256: opened.sha256 });
    useSettings.getState().addRecent(path);
    afterLoad();
    void detectShow(path);
    return true;
  } catch (e) {
    await tell(`${t("Could not open {name}.", { name: basename(path) })}\n${fileErrorText(t, e)}`);
    return false;
  }
}

export async function openDocDialog(t: TFunc): Promise<void> {
  if (!isTauri) {
    useUi.getState().showToast(t("In this preview files cannot be opened: try the demo show."));
    return;
  }
  if (!(await confirmDiscard(t))) return;
  const chosen = await open({ filters: FILTER, multiple: false, directory: false, title: t("Open a show") });
  if (typeof chosen === "string") await openDocPath(t, chosen);
}

/** Opens a recent file, or says it is gone and drops it from the list. */
export async function openRecent(t: TFunc, path: string): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  if (!(await api.pathExists(path))) {
    useSettings.getState().removeRecent(path);
    useUi.getState().showToast(t("{name} is no longer there: removed from the list.", { name: basename(path) }), "error");
    return;
  }
  await openDocPath(t, path);
}

/** "New show": asks about unsaved changes, then the title. */
export async function newDocDialog(t: TFunc): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  useUi.getState().openDialog("newShow");
}

/** Creates the new show in memory (the unsaved changes were already dealt with); saved with the first Save. */
export function createDoc(title: string): void {
  useDoc.getState().load(newShow(title), { filePath: null, dirty: false });
  afterLoad();
}

/** The demo show (browser preview): La locandiera / Serata.tcue, in memory. */
export async function openDemo(): Promise<void> {
  const { DEMO_PATH, putDemoFile } = await import("../model/demo");
  putDemoFile();
  const opened = await api.tcueOpen(DEMO_PATH);
  useDoc.getState().load(parseShow(opened.showJson), { filePath: DEMO_PATH, dirty: false, parts: opened.parts, sha256: opened.sha256 });
  afterLoad();
  await detectShow(DEMO_PATH);
}

/* ------------------------------------------------------------------ */
/* Versions (as Diaframma and Granvelo: `Serata.tcue` → `Serata.versions/`) */
/* ------------------------------------------------------------------ */
//
// Named versions are made by the user and are never removed by Cue. Automatic ones (`…_auto.tcue`) are made
// before the first save of a session over an existing file and before going back to a version; the newest 30
// are kept. A version is a whole copy of the file (script and images included), parts copied raw.

const AUTO_KEEP = 30;
const autoDone = new Set<string>();

export const versionsDirOf = (filePath: string) => filePath.replace(EXT, "") + ".versions";
const two = (n: number) => String(n).padStart(2, "0");
const stampOf = (d = new Date()) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;

export async function writeVersion(filePath: string, kind: "named" | "auto", note: string): Promise<string> {
  const path = await api.versionSave(filePath, `${stampOf()}${kind === "auto" ? "_auto" : ""}.tcue`, kind, note);
  if (kind === "auto") {
    const all = await api.versionsList(filePath).catch(() => [] as VersionEntry[]);
    for (const old of all.filter((v) => v.kind === "auto").slice(AUTO_KEEP)) await api.versionDelete(old.path).catch(() => {});
  }
  return path;
}

async function keepOldContentOnce(t: TFunc, path: string): Promise<void> {
  if (autoDone.has(path)) return;
  autoDone.add(path);
  try {
    if (await api.pathExists(path)) await writeVersion(path, "auto", t("Before the first save of this session"));
  } catch {
    // A version that cannot be kept must never stop the save.
  }
}

export async function saveNamedVersion(t: TFunc, note: string): Promise<boolean> {
  if (!(await saveDoc(t))) return false;
  const st = useDoc.getState();
  if (!st.filePath) return false;
  try {
    await writeVersion(st.filePath, "named", note.trim());
    return true;
  } catch (e) {
    await tell(`${t("Could not save the version.")}\n${fileErrorText(t, e)}`);
    return false;
  }
}

/** Goes back to a version: the file as it is now is kept as an automatic version, then the version replaces it. */
export async function restoreVersion(t: TFunc, v: VersionEntry): Promise<boolean> {
  if (!(await confirmDiscard(t))) return false;
  const st = useDoc.getState();
  if (!st.filePath) return false;
  const path = st.filePath;
  try {
    await writeVersion(path, "auto", t("Before going back to another version"));
    await api.versionRestore(path, v.path);
    return openDocPath(t, path);
  } catch (e) {
    await tell(`${t("Could not open {name}.", { name: v.name })}\n${fileErrorText(t, e)}`);
    return false;
  }
}

function confirmBox(t: TFunc, text: string, okLabel: string): Promise<boolean> {
  return confirmYesNo({ title: t("Please confirm"), message: text, cancel: t("Cancel"), confirm: okLabel, danger: true, close: t("Close") });
}

export const confirmRestoreVersion = (t: TFunc) =>
  confirmBox(t, t("Go back to this version? The file as it is now is kept as an automatic version first."), t("Go back"));

export const confirmDeleteVersion = (t: TFunc) => confirmBox(t, t("Delete this version? It cannot be brought back."), t("Delete"));

/* ------------------------------------------------------------------ */
/* Autosave and crash recovery                                          */
/* ------------------------------------------------------------------ */
//
// The autosave keeps show.json and the path of the file in Cue's data folder (the parts are in the file on
// disk). After a crash Cue offers to recover it; nothing is sent to lights, sound or screens on recovery.

interface AutosaveData {
  savedAt: string;
  filePath: string | null;
  dirty: boolean;
  showJson: string;
}

function snapshot(show: CueShow): string {
  const st = useDoc.getState();
  const data: AutosaveData = { savedAt: new Date().toISOString(), filePath: st.filePath, dirty: st.dirty, showJson: serializeShow(show, APP) };
  return JSON.stringify(data);
}

function writeAutosaveNow() {
  if (!isTauri) return;
  const show = useDoc.getState().show;
  if (!show) {
    api.autosaveClear().catch(() => {});
    return;
  }
  api.autosaveWrite(snapshot(show)).catch((e) => console.error("autosave failed", e));
}

const autosaveSoon = debounce(writeAutosaveNow, 1500);

/** Every change is copied to Cue's data folder within ~1.5 s. */
export function startAutosave(): () => void {
  return useDoc.subscribe((s, prev) => {
    if (s.show !== prev.show || s.filePath !== prev.filePath || s.dirty !== prev.dirty) autosaveSoon();
  });
}

export function flushAutosave() {
  autosaveSoon.flush();
}

export async function restoreAutosave(text: string): Promise<boolean> {
  try {
    const a = JSON.parse(text) as AutosaveData;
    const show = parseShow(a.showJson);
    let parts = undefined;
    let sha256 = null;
    if (a.filePath && (await api.pathExists(a.filePath))) {
      const opened = await api.tcueOpen(a.filePath).catch(() => null);
      parts = opened?.parts;
      sha256 = opened?.sha256 ?? null;
    }
    useDoc.getState().load(show, { filePath: a.filePath, dirty: a.dirty, parts, sha256 });
    afterLoad();
    void detectShow(a.filePath);
    return true;
  } catch {
    return false;
  }
}

/** Closes the show and goes back to the first screen. */
export async function closeDoc(t: TFunc): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  useDoc.getState().close();
  if (isTauri) await api.autosaveClear().catch(() => {});
}
