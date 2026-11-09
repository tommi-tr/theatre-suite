import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface SessionStart {
  crashed: boolean;
  autosave: string | null;
  openFile: string | null;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return Promise.reject(new Error(`Not running inside Bardo (${cmd})`));
  return invoke<T>(cmd, args);
}

export const api = {
  appInfo: () => call<{ name: string; version: string; os: string }>("app_info"),
  settingsLoad: () => call<unknown>("settings_load"),
  settingsSave: (settings: unknown) => call<void>("settings_save", { settings }),
  sessionStart: () => call<SessionStart>("session_start"),
  autosaveWrite: (json: string) => call<void>("autosave_write", { json }),
  autosaveClear: () => call<void>("autosave_clear"),
  readText: (path: string) => call<string>("file_read_text", { path }),
  writeText: (path: string, text: string) => call<void>("file_write_text", { path, text }),
  readBytes: async (path: string) => new Uint8Array(await call<ArrayBuffer>("file_read_bytes", { path })),
  writeBytes: (path: string, bytes: Uint8Array) => {
    if (!isTauri) return Promise.reject(new Error("Not running inside Bardo"));
    return invoke<void>("file_write_bytes", bytes, { headers: { "x-path": encodeURIComponent(path) } });
  },
  pathExists: (path: string) => call<boolean>("path_exists", { path }),
  revealInFolder: (path: string) => call<void>("reveal_in_folder", { path }),
  pdfDirectSupported: () => call<boolean>("pdf_direct_supported"),
  printPage: () => call<void>("print_page"),
  printToPdf: (path: string, page: { widthMm: number; heightMm: number }) => call<void>("print_to_pdf", { path, page }),
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

export async function onEvent<T>(name: string, fn: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  return listen<T>(name, (e) => fn(e.payload));
}
