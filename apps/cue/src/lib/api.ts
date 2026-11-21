import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { memFs } from "./memFs";

export interface SessionStart {
  crashed: boolean;
  autosave: string | null;
  openFile: string | null;
  /** 1 normally; n when started with `--instance n`. */
  instance: number;
}

/** One entry of the `.tcue` zip other than `show.json`. */
export interface PartInfo {
  name: string;
  size: number;
}

export interface TcueOpened {
  showJson: string;
  parts: PartInfo[];
  sha256: string;
}

export interface TcueSaved {
  parts: PartInfo[];
  sha256: string;
}

/** A part to add or replace: bytes in base64 (`data`) or a file on disk copied by the native side (`fromPath`). */
export interface AddPart {
  name: string;
  data?: string;
  fromPath?: string;
}

export interface TcueSaveArgs {
  path: string;
  /** Where unchanged parts come from (Save as); by default the file itself. */
  sourcePath?: string | null;
  /** New show.json; null keeps the one in the file. */
  showJson: string | null;
  addParts?: AddPart[];
  removeParts?: string[];
}

/** A part copied to Cue's autosave folder until the next save (survives a crash). */
export interface StagedPart {
  path: string;
  sha256: string;
  size: number;
}

/** A saved version of a show file (a copy in the `.versions` folder next to it). */
export interface VersionEntry {
  path: string;
  name: string;
  modifiedMs: number;
  bytes: number;
  kind: "named" | "auto";
  note: string;
  appVersion: string;
  damaged: boolean;
}

/** A screen of this computer (output window). */
export interface MonitorInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
  primary: boolean;
  /** The one the Cue window is on. */
  current: boolean;
}

/** State of the open PowerPoint presentation, as the helper reports it. */
export interface PptState {
  ok: boolean;
  error?: string;
  detail?: string;
  name?: string;
  count?: number;
  slide?: number;
  slideshow?: boolean;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isDemo = !isTauri && typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

/**
 * The native commands. In a plain browser (the `/?demo` preview) every call has a stand-in: show files live
 * in memory (`memFs`), settings in localStorage (see store/settings), the rest answers harmlessly.
 */
export const api = {
  appInfo: () =>
    isTauri ? call<{ name: string; version: string; os: string; instance: number }>("app_info") : Promise.resolve({ name: "Cue", version: "", os: "browser", instance: 1 }),
  settingsLoad: () => (isTauri ? call<unknown>("settings_load") : Promise.resolve({})),
  settingsSave: (settings: unknown) => (isTauri ? call<void>("settings_save", { settings }) : Promise.resolve()),
  sessionStart: () => (isTauri ? call<SessionStart>("session_start") : Promise.resolve<SessionStart>({ crashed: false, autosave: null, openFile: null, instance: 1 })),
  autosaveWrite: (json: string) => (isTauri ? call<void>("autosave_write", { json }) : Promise.resolve()),
  autosaveClear: () => (isTauri ? call<void>("autosave_clear") : Promise.resolve()),
  writeText: (path: string, text: string) => call<void>("file_write_text", { path, text }),
  readText: (path: string) => (isTauri ? call<string>("file_read_text", { path }) : Promise.reject(new Error(`io: ${path} is not available in the preview`))),
  pathExists: (path: string) => (isTauri ? call<boolean>("path_exists", { path }) : Promise.resolve(memFs.exists(path))),
  revealInFolder: (path: string) => (isTauri ? call<void>("reveal_in_folder", { path }) : Promise.resolve(void console.info("[demo] show in folder:", path))),
  tcueNew: (path: string, title: string) => (isTauri ? call<TcueOpened>("tcue_new", { path, title }) : memFs.create(path, title)),
  tcueOpen: (path: string) => (isTauri ? call<TcueOpened>("tcue_open", { path }) : memFs.open(path)),
  /** The bytes of one part (an ArrayBuffer from the native side, no base64 on the way). */
  tcueReadPart: async (path: string, name: string): Promise<Uint8Array> =>
    isTauri ? new Uint8Array(await call<ArrayBuffer>("tcue_read_part", { path, name })) : memFs.readPart(path, name),
  tcueSave: (a: TcueSaveArgs) =>
    isTauri
      ? call<TcueSaved>("tcue_save", { path: a.path, sourcePath: a.sourcePath ?? null, showJson: a.showJson, addParts: a.addParts ?? [], removeParts: a.removeParts ?? [] })
      : memFs.save(a),
  /** Copies a file the user chose into the autosave folder as a pending part (native side, no bytes through here). */
  partStage: (from: string, name: string) => (isTauri ? call<StagedPart>("part_stage", { from, name }) : Promise.reject(new Error(`io: ${from} is not available in the preview`))),
  /** Stages bytes made by the interface (a thumbnail, a rendered slide) as a pending part. */
  partStageBytes: async (bytes: Uint8Array, name: string): Promise<StagedPart> =>
    isTauri ? invoke<StagedPart>("part_stage_bytes", bytes, { headers: { name } }) : { path: memFs.stage(bytes, name), sha256: "", size: bytes.length },
  stagedRead: async (path: string): Promise<Uint8Array> => (isTauri ? new Uint8Array(await call<ArrayBuffer>("staged_read", { path })) : memFs.stagedRead(path)),
  stagedExists: (path: string) => (isTauri ? call<boolean>("path_exists", { path }) : Promise.resolve(memFs.stagedExists(path))),
  stagedDrop: (paths: string[]) => (isTauri ? call<void>("staged_drop", { paths }) : Promise.resolve(memFs.stagedDrop(paths))),
  /** Writes a part of the file (or a pending one) to `dest`. Native only: the browser downloads instead. */
  partExport: (a: { path: string | null; name: string; staged: string | null; dest: string }) => call<void>("part_export", a),
  versionsList: (path: string) => (isTauri ? call<VersionEntry[]>("versions_list", { path }) : memFs.versionsList(path)),
  versionSave: (path: string, name: string, kind: "named" | "auto", note: string) =>
    isTauri ? call<string>("version_save", { path, name, kind, note }) : memFs.versionSave(path, name, kind, note),
  versionRestore: (path: string, version: string) => (isTauri ? call<TcueSaved>("version_restore", { path, version }) : memFs.versionRestore(path, version)),
  versionDelete: (path: string) => (isTauri ? call<void>("version_delete", { path }) : memFs.versionDelete(path)),
  /** Any file the user chose (a PDF of slides), as bytes. */
  readBytes: async (path: string): Promise<Uint8Array> => new Uint8Array(await call<ArrayBuffer>("files_read_bytes", { path })),
  projMonitors: () =>
    isTauri
      ? call<MonitorInfo[]>("proj_monitors")
      : Promise.resolve<MonitorInfo[]>([
          { index: 0, name: "\\\\.\\DISPLAY1", width: 1366, height: 768, x: 0, y: 0, scale: 1, primary: true, current: true },
          { index: 1, name: "\\\\.\\DISPLAY2", width: 1920, height: 1080, x: 1366, y: 0, scale: 1, primary: false, current: false },
        ]),
  projOpen: (monitor: number | null, windowed: boolean) => (isTauri ? call<void>("proj_open", { monitor, windowed }) : Promise.resolve()),
  projClose: () => (isTauri ? call<void>("proj_close") : Promise.resolve()),
  projIsOpen: () => (isTauri ? call<boolean>("proj_is_open") : Promise.resolve(false)),
  /** Authorises a video of the show folder and gives the address the output window plays it from. */
  projVideoUrl: (showFile: string, rel: string) => call<string>("proj_video_url", { showFile, rel }),
  projCopyVideo: (showFile: string, from: string) => call<string>("proj_copy_video", { showFile, from }),
  pptAvailable: () => (isTauri ? call<boolean>("ppt_available") : Promise.resolve(false)),
  pptConnect: () => call<PptState>("ppt_connect"),
  pptCommand: (op: "next" | "previous" | "goto" | "start" | "status", slide?: number) => call<PptState>("ppt_command", { op, slide: slide ?? null }),
  pptDisconnect: () => (isTauri ? call<void>("ppt_disconnect") : Promise.resolve()),
  pptExport: (pptx: string, outDir: string) => call<string[]>("ppt_export", { pptx, outDir }),
  pptTempDir: () => call<string>("ppt_temp_dir"),
  pptCleanup: (dir: string) => call<void>("ppt_cleanup", { dir }),
  /** Is the launcher installed ("Torna al launcher")? In the browser demo: yes, to see the button. */
  launcherAvailable: () => (isTauri ? call<boolean>("launcher_available") : Promise.resolve(isDemo)),
  openLauncher: (showDir: string) => (isTauri ? call<void>("open_launcher", { showDir }) : Promise.resolve(void console.info("[demo] back to the launcher:", showDir))),
};

/** The app window (a harmless stand-in when the interface runs in a plain browser). */
export const appWindow: ReturnType<typeof getCurrentWindow> = isTauri
  ? getCurrentWindow()
  : ({
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => window.close(),
      destroy: async () => window.close(),
      isMaximized: async () => false,
      onResized: async () => () => {},
      onCloseRequested: async () => () => {},
    } as unknown as ReturnType<typeof getCurrentWindow>);

/** Tells every window (the output window listens). A no-op in the browser preview. */
export async function emitEvent(name: string, payload?: unknown): Promise<void> {
  if (!isTauri) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(name, payload);
}

export async function onEvent<T>(name: string, fn: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  return listen<T>(name, (e) => fn(e.payload));
}
