import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText as clipboardWrite } from "@tauri-apps/plugin-clipboard-manager";

export interface SessionStart {
  crashed: boolean;
  autosave: string | null;
  openFile: string | null;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return Promise.reject(new Error(`Not running inside Cantinella (${cmd})`));
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
    if (!isTauri) return Promise.reject(new Error("Not running inside Cantinella"));
    return invoke<void>("file_write_bytes", bytes, { headers: { "x-path": encodeURIComponent(path) } });
  },
  pathExists: (path: string) => call<boolean>("path_exists", { path }),
  revealInFolder: (path: string) => call<void>("reveal_in_folder", { path }),
  /** Is the launcher installed ("Torna al launcher")? In the browser demo: yes, to see the button. */
  launcherAvailable: () => (isTauri ? call<boolean>("launcher_available") : Promise.resolve(typeof location !== "undefined" && location.search.includes("demo"))),
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

export async function onEvent<T>(name: string, fn: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  return listen<T>(name, (e) => fn(e.payload));
}

/** Copies text for WhatsApp, email… (system clipboard; the browser one in the preview). */
export async function copyText(text: string): Promise<void> {
  if (isTauri) await clipboardWrite(text);
  else await navigator.clipboard?.writeText(text);
}
