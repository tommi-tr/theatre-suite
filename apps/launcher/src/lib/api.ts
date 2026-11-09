import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppsView, OpenAllReport, OpenResult, ProjectView, Settings, ShowNode } from "./types";
import { demo } from "./demo";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return demo(cmd, args) as Promise<T>;
  return invoke<T>(cmd, args);
}

export const api = {
  appInfo: () => call<{ name: string; version: string; os: string }>("app_info"),
  startupShow: () => call<string | null>("startup_show"),
  settingsLoad: () => call<Settings>("settings_load"),
  settingsSave: (settings: Settings) => call<void>("settings_save", { settings }),
  defaultShowsDir: () => call<string>("default_shows_dir"),

  showsList: () => call<ShowNode[]>("shows_list"),
  showsRescan: () => call<ShowNode[]>("shows_rescan"),
  showCreate: (title: string, subtitle: string, parentDir: string) => call<string>("show_create", { title, subtitle, parentDir }),
  showOpen: (path: string) => call<OpenResult>("show_open", { path }),
  showAdopt: (path: string, title: string) => call<string>("show_adopt", { path, title }),
  showForget: (path: string) => call<void>("show_forget", { path }),
  copySize: (path: string) => call<number>("copy_size", { path }),
  nestedDefault: (path: string) => call<string>("nested_default", { path }),
  showCopy: (path: string, destParent: string, name: string) => call<string>("show_copy", { path, destParent, name }),

  projectGet: (path: string) => call<ProjectView>("project_get", { path }),
  projectSetMeta: (path: string, title: string, subtitle: string) => call<void>("project_set_meta", { path, title, subtitle }),
  documentSet: (path: string, docId: string, patch: Record<string, unknown>) => call<void>("document_set", { path, docId, patch }),
  documentNew: (path: string, appId: string, title: string) => call<string>("document_new", { path, appId, title }),
  documentOpen: (path: string, docId: string) => call<void>("document_open", { path, docId }),
  showOpenAll: (path: string) => call<OpenAllReport>("show_open_all", { path }),
  appLaunch: (appId: string) => call<void>("app_launch", { appId }),
  reveal: (path: string) => call<void>("reveal", { path }),

  coverGet: (path: string) => call<string | null>("cover_get", { path }),
  imagePreview: (file: string) => call<string>("image_preview", { file }),
  coverSetImage: (path: string, jpegBase64: string, color: string | null) => call<string>("cover_set_image", { path, jpegBase64, color }),
  coverClearImage: (path: string) => call<void>("cover_clear_image", { path }),
  coverSetColor: (path: string, color: string | null) => call<void>("cover_set_color", { path, color }),

  appsStatus: () => call<AppsView>("apps_status"),
  appPathSet: (appId: string, program: string | null) => call<void>("app_path_set", { appId, program }),
  updatesCheck: () => call<AppsView>("updates_check"),
  updatesCheckIfDue: () => call<AppsView | null>("updates_check_if_due"),
};

export function appWindow() {
  return isTauri ? getCurrentWindow() : null;
}

export function onEvent<T>(name: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {});
  return listen<T>(name, (e) => cb(e.payload));
}

/** Native errors are plain text; a few carry a code before a colon. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
