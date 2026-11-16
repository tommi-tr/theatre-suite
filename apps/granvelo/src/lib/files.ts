import { message, open, save } from "@tauri-apps/plugin-dialog";
import { basename, debounce, findShow, type TFunc } from "@theatre-suite/core";
import { confirmSave, confirmYesNo } from "@theatre-suite/ui";
import { GranveloFileError, newDocument, parse, serialize } from "../model/file";
import type { GranveloDoc, Stage } from "../model/types";
import { api, isTauri, type VersionEntry } from "./api";
import { APP_VERSION } from "./version";
import { useDoc } from "../store/doc";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

const EXT = /\.granvelo$/i;
const FILTER = [{ name: "Granvelo", extensions: ["granvelo"] }];
const APP = { name: "Granvelo", version: APP_VERSION };

export function fileErrorText(t: TFunc, e: unknown): string {
  if (e instanceof GranveloFileError) {
    switch (e.problem) {
      case "not-json":
      case "not-granvelo":
        return t("This is not a Granvelo file.");
      case "newer":
        return t("This file was saved with a newer version of Granvelo. Please update Granvelo to open it.");
      case "unsupported":
        return t("This file was made with a test version of Granvelo whose format is no longer read.");
      default:
        return `${t("The file is damaged and cannot be opened.")}${e.detail ? `\n(${e.detail})` : ""}`;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

/** Suggested name: "<show> - luci.granvelo", or the title of the document. */
export function suggestedName(t: TFunc): string {
  const { show, doc } = useDoc.getState();
  const base = show ? `${show.title} - ${t("lights")}` : doc?.title.trim() || t("Lights");
  return `${base}.granvelo`.replace(/[\\/:*?"<>|]/g, "-");
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
  if (!st.doc) return false;
  if (!isTauri) {
    useUi.getState().showToast(t("In this preview files are not saved: install Granvelo to save."));
    return false;
  }
  let path = st.filePath;
  if (!path || saveAs) {
    const chosen = await save({ filters: FILTER, defaultPath: path ?? suggestedName(t), title: t("Save the lights of the show") });
    if (!chosen) return false;
    path = EXT.test(chosen) ? chosen : `${chosen}.granvelo`;
  }
  try {
    await keepOldContentOnce(t, path);
    await api.writeText(path, serialize(useDoc.getState().doc!, APP));
    useDoc.getState().markSaved(path);
    useSettings.getState().addRecent(path);
    writeAutosaveNow();
    void detectShow(path);
    return true;
  } catch (e) {
    await message(`${t("Could not save the file.")}\n${String(e)}`, { title: "Granvelo", kind: "error" });
    return false;
  }
}

/** Asks what to do with unsaved changes. False if the user cancelled. */
export async function confirmDiscard(t: TFunc): Promise<boolean> {
  if (!useDoc.getState().dirty || !useDoc.getState().doc) return true;
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

function afterLoad() {
  const ui = useUi.getState();
  ui.selectFixture(null);
  ui.setMode("setup");
}

export async function openDocPath(t: TFunc, path: string): Promise<boolean> {
  try {
    const doc = parse(await api.readText(path));
    useDoc.getState().load(doc, { filePath: path, dirty: false });
    useSettings.getState().addRecent(path);
    afterLoad();
    void detectShow(path);
    return true;
  } catch (e) {
    await message(`${t("Could not open {name}.", { name: basename(path) })}\n${fileErrorText(t, e)}`, { title: "Granvelo", kind: "error" });
    return false;
  }
}

export async function openDocDialog(t: TFunc): Promise<void> {
  if (!isTauri) {
    useUi.getState().showToast(t("In this preview files cannot be opened: try the demo show."));
    return;
  }
  if (!(await confirmDiscard(t))) return;
  const chosen = await open({ filters: FILTER, multiple: false, directory: false, title: t("Open the lights of a show") });
  if (typeof chosen === "string") await openDocPath(t, chosen);
}

/** "New show": asks about unsaved changes, then opens the window that asks the stage size. */
export async function newDocDialog(t: TFunc): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  useUi.getState().openDialog("newShow");
}

/** Creates the new show (the unsaved changes were already dealt with). */
export function createDoc(title: string, stage: Stage): void {
  useDoc.getState().load(newDocument({ title: title.trim(), stage }), { filePath: null, dirty: false });
  afterLoad();
}

/** Opens the demo show *La locandiera* (as an unsaved document). */
export async function openDemo(t: TFunc): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  const { demoDoc, DEMO_SHOW } = await import("../model/demo");
  useDoc.getState().load(demoDoc(), { filePath: null, dirty: false });
  if (!isTauri) useDoc.getState().setShow(DEMO_SHOW);
  afterLoad();
}

/** Closes the show and goes back to the start screen. */
export async function closeDoc(t: TFunc): Promise<void> {
  if (!(await confirmDiscard(t))) return;
  useDoc.getState().close();
  if (isTauri) await api.autosaveClear().catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Versions (as Diaframma: `Show.granvelo` → `Show.versions/`)          */
/* ------------------------------------------------------------------ */
//
// Named versions are made by the user and are never removed by Granvelo. Automatic ones (`…_auto.granvelo`)
// are made before the first save of a session over an existing file and before going back to a version;
// the newest 30 are kept.

const AUTO_KEEP = 30;
const autoDone = new Set<string>();

export const versionsDirOf = (filePath: string) => filePath.replace(EXT, "") + ".versions";
const sepOf = (p: string) => (p.includes("\\") ? "\\" : "/");
const two = (n: number) => String(n).padStart(2, "0");
const stampOf = (d = new Date()) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
const AUTO_RE = /_auto(-\d+)?\.granvelo$/i;

export type VersionKind = "named" | "auto";

export interface VersionInfo extends VersionEntry {
  kind: VersionKind;
  note: string;
  lights: number;
  memories: number;
  appVersion: string;
}

/** Text of a file with the note and kind of a version added (top-level keys: reading keeps them as unknown keys). */
function versionText(docText: string, kind: VersionKind, note: string): string {
  const raw = JSON.parse(docText) as Record<string, unknown>;
  return `${JSON.stringify({ ...raw, versionKind: kind, versionNote: note }, null, 2)}\n`;
}

async function pruneAuto(dir: string): Promise<void> {
  const all = await api.versionsList(dir);
  for (const old of all.filter((v) => AUTO_RE.test(v.name)).slice(AUTO_KEEP)) await api.versionDelete(old.path).catch(() => {});
}

export async function writeVersion(filePath: string, docText: string, kind: VersionKind, note: string): Promise<string> {
  const dir = versionsDirOf(filePath);
  const base = `${stampOf()}${kind === "auto" ? "_auto" : ""}`;
  let path = `${dir}${sepOf(filePath)}${base}.granvelo`;
  for (let i = 2; await api.pathExists(path); i++) path = `${dir}${sepOf(filePath)}${base}-${i}.granvelo`;
  await api.writeText(path, versionText(docText, kind, note));
  if (kind === "auto") await pruneAuto(dir).catch(() => {});
  return path;
}

async function keepOldContentOnce(t: TFunc, path: string): Promise<void> {
  if (autoDone.has(path)) return;
  autoDone.add(path);
  try {
    if (!(await api.pathExists(path))) return;
    await writeVersion(path, await api.readText(path), "auto", t("Before the first save of this session"));
  } catch {
    // A version that cannot be kept must never stop the save.
  }
}

export async function saveNamedVersion(t: TFunc, note: string): Promise<boolean> {
  if (!(await saveDoc(t))) return false;
  const st = useDoc.getState();
  if (!st.filePath) return false;
  try {
    await writeVersion(st.filePath, await api.readText(st.filePath), "named", note.trim());
    return true;
  } catch (e) {
    await message(`${t("Could not save the version.")}\n${String(e)}`, { title: "Granvelo", kind: "error" });
    return false;
  }
}

export async function listVersions(filePath: string): Promise<VersionInfo[]> {
  const entries = await api.versionsList(versionsDirOf(filePath));
  return Promise.all(
    entries.map(async (e) => {
      let note = "";
      let lights = 0;
      let memories = 0;
      let appVersion = "";
      let kind: VersionKind = AUTO_RE.test(e.name) ? "auto" : "named";
      try {
        const raw = JSON.parse(await api.readText(e.path)) as Record<string, unknown>;
        if (typeof raw.versionNote === "string") note = raw.versionNote;
        if (raw.versionKind === "auto" || raw.versionKind === "named") kind = raw.versionKind;
        if (Array.isArray(raw.fixtures)) lights = raw.fixtures.length;
        if (Array.isArray(raw.memories)) memories = raw.memories.length;
        const w = raw.savedWith as { version?: unknown } | undefined;
        if (w && typeof w.version === "string") appVersion = w.version;
      } catch {
        // A damaged version is still listed (it can be deleted).
      }
      return { ...e, kind, note, lights, memories, appVersion };
    }),
  );
}

/** Goes back to a version: the current state is kept as an automatic version first, then the version is loaded as unsaved changes. */
export async function restoreVersion(t: TFunc, v: VersionEntry): Promise<boolean> {
  const st = useDoc.getState();
  if (!st.filePath || !st.doc) return false;
  try {
    const raw = JSON.parse(await api.readText(v.path)) as Record<string, unknown>;
    delete raw.versionKind;
    delete raw.versionNote;
    const parsed = parse(JSON.stringify(raw));
    await writeVersion(st.filePath, serialize(st.doc, APP), "auto", t("Before going back to another version"));
    useDoc.getState().load(parsed, { filePath: st.filePath, dirty: true });
    afterLoad();
    void detectShow(st.filePath);
    return true;
  } catch (e) {
    await message(`${t("Could not open {name}.", { name: v.name })}\n${fileErrorText(t, e)}`, { title: "Granvelo", kind: "error" });
    return false;
  }
}

function confirmBox(t: TFunc, text: string, okLabel: string): Promise<boolean> {
  return confirmYesNo({ title: t("Please confirm"), message: text, cancel: t("Cancel"), confirm: okLabel, danger: true, close: t("Close") });
}

export const confirmRestoreVersion = (t: TFunc) =>
  confirmBox(t, t("Go back to this version? What you have now is kept as an automatic version first, and this one is loaded as unsaved changes."), t("Go back"));

export const confirmDeleteVersion = (t: TFunc) => confirmBox(t, t("Delete this version? It cannot be brought back."), t("Delete"));

/* ------------------------------------------------------------------ */
/* Autosave and crash recovery                                          */
/* ------------------------------------------------------------------ */

interface AutosaveData {
  savedAt: string;
  filePath: string | null;
  dirty: boolean;
  file: string;
}

function snapshot(doc: GranveloDoc): string {
  const st = useDoc.getState();
  const data: AutosaveData = { savedAt: new Date().toISOString(), filePath: st.filePath, dirty: st.dirty, file: serialize(doc, APP) };
  return JSON.stringify(data);
}

function writeAutosaveNow() {
  if (!isTauri) return;
  const doc = useDoc.getState().doc;
  if (!doc) {
    api.autosaveClear().catch(() => {});
    return;
  }
  api.autosaveWrite(snapshot(doc)).catch((e) => console.error("autosave failed", e));
}

const autosaveSoon = debounce(writeAutosaveNow, 1500);

/** Every change is copied to Granvelo's data folder within ~1.5 s. */
export function startAutosave(): () => void {
  return useDoc.subscribe((s, prev) => {
    if (s.doc !== prev.doc || s.filePath !== prev.filePath || s.dirty !== prev.dirty) autosaveSoon();
  });
}

export function flushAutosave() {
  autosaveSoon.flush();
}

export function restoreAutosave(text: string): boolean {
  try {
    const a = JSON.parse(text) as AutosaveData;
    useDoc.getState().load(parse(a.file), { filePath: a.filePath, dirty: a.dirty });
    afterLoad();
    void detectShow(a.filePath);
    return true;
  } catch {
    return false;
  }
}
