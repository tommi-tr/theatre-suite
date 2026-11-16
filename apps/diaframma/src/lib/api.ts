import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LiveState, OthersOnGo, Track, TrackInfo } from "../state/types";

export interface SessionStart {
  crashed: boolean;
  autosave: string | null;
  openFile: string | null;
}

/** A saved version of a cue list (a copy in the `.versions` folder next to it). */
export interface VersionEntry {
  path: string;
  name: string;
  modifiedMs: number;
  bytes: number;
}

export interface EngineConfig {
  othersOnGo: OthersOnGo;
  autoAdvance: boolean;
  fadeInSec: number;
  fadeOutSec: number;
  crossfadeSec: number;
  /** Quick fade of the track in front when it has no Exit. */
  quickFadeSec?: number;
  stopAllSec: number;
  mainDb?: number;
  numberFrom?: number;
  /** Show behaviour (the track in front leaves by its Exit). Off for the player and the pads. */
  steps?: boolean;
}

/** Track as sent to the engine: path already resolved. */
export type EngineTrack = Omit<Track, "file"> & { path: string | null };

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return Promise.reject(new Error(`Not running inside Diaframma (${cmd})`));
  return invoke<T>(cmd, args);
}

export const api = {
  appInfo: () => call<{ name: string; version: string; os: string }>("app_info"),
  builtinSoundsDir: () => call<string | null>("builtin_sounds_dir"),
  settingsLoad: () => call<unknown>("settings_load"),
  settingsSave: (settings: unknown) => call<void>("settings_save", { settings }),
  sessionStart: () => call<SessionStart>("session_start"),
  autosaveWrite: (json: string) => call<void>("autosave_write", { json }),
  autosaveClear: () => call<void>("autosave_clear"),
  readText: (path: string) => call<string>("file_read_text", { path }),
  /** Is the launcher installed ("Torna al launcher")? In the browser demo: yes, to see the button. */
  launcherAvailable: () => (isTauri ? call<boolean>("launcher_available") : Promise.resolve(typeof location !== "undefined" && location.search.includes("demo"))),
  openLauncher: (showDir: string) => (isTauri ? call<void>("open_launcher", { showDir }) : Promise.resolve(void console.info("[demo] back to the launcher:", showDir))),
  writeText: (path: string, text: string) => call<void>("file_write_text", { path, text }),
  versionsList: (dir: string) => call<VersionEntry[]>("versions_list", { dir }),
  versionDelete: (path: string) => call<void>("version_delete", { path }),
  pathsExist: (paths: string[]) => call<boolean[]>("paths_exist", { paths }),
  openProjectPage: (url: string) => call<void>("open_project_page", { url }),
  findFiles: (dir: string, names: string[]) => call<(string | null)[]>("find_files", { dir, names }),
  resolveRelative: (baseFile: string, relative: string) => call<string | null>("resolve_relative", { baseFile, relative }),
  makeRelative: (baseFile: string, target: string) => call<string | null>("make_relative", { baseFile, target }),

  // Audio engine (Show mode)
  engineDevices: () => call<string[]>("engine_devices"),
  engineSetDevice: (name: string | null) => call<void>("engine_set_device", { name }),
  engineSync: (tracks: EngineTrack[], config: EngineConfig) => call<void>("engine_sync", { tracks, config }),
  engineSetStandby: (trackId: string | null) => call<void>("engine_set_standby", { trackId }),
  engineStandbyStep: (delta: number) => call<void>("engine_standby_step", { delta }),
  engineGo: () => call<void>("engine_go"),
  enginePause: (trackId: string) => call<void>("engine_pause", { trackId }),
  enginePauseAll: () => call<void>("engine_pause_all"),
  engineSeek: (trackId: string, sec: number) => call<void>("engine_seek", { trackId, sec }),
  engineStopAll: (immediate: boolean) => call<void>("engine_stop_all", { immediate }),
  engineStopTrack: (trackId: string) => call<void>("engine_stop_track", { trackId }),
  engineAnalyze: (path: string) => call<TrackInfo>("engine_analyze", { path }),
  engineState: () => call<LiveState>("engine_state"),
  selftestRun: (tracks: EngineTrack[], config: EngineConfig, runs: number) => call<TestReport>("selftest_run", { tracks, config, runs }),

  // Rehearsal mode (other programs on this computer)
  rhSnapshot: () => call<RhSnapshot>("rh_snapshot"),
  rhMedia: (id: string, action: "toggle" | "next" | "prev" | "pause") => call<void>("rh_media", { id, action }),
  rhSetVolume: (ids: string[], volume: number) => call<void>("rh_set_volume", { ids, volume }),
  rhSetSpeed: (ids: string[], rate: number) => call<void>("rh_set_speed", { ids, rate }),
  rhRoute: (id: string, outputId: string | null) => call<void>("rh_route", { id, outputId }),
  rhPauseAll: () => call<void>("rh_pause_all"),
  rhSetOutputVolume: (id: string, volume: number) => call<void>("rh_set_output_volume", { id, volume }),

  // Internal player (Rehearsal mode)
  playerSync: (tracks: EngineTrack[], config: EngineConfig) => call<void>("player_sync", { tracks, config }),
  playerPlay: (trackId: string) => call<void>("player_play", { trackId }),
  playerPause: (trackId: string) => call<void>("player_pause", { trackId }),
  playerSeek: (trackId: string, sec: number) => call<void>("player_seek", { trackId, sec }),
  playerStop: () => call<void>("player_stop"),
  playerSetSpeed: (speed: number) => call<void>("player_set_speed", { speed }),
  playerSetDevice: (name: string | null) => call<void>("player_set_device", { name }),
  playerState: () => call<LiveState>("player_state"),

  // Launchpad
  padsSync: (tracks: EngineTrack[], config: EngineConfig) => call<void>("pads_sync", { tracks, config }),
  padsPlay: (trackId: string) => call<void>("pads_play", { trackId }),
  padsStop: (trackId: string, fadeSec: number) => call<void>("pads_stop", { trackId, fadeSec }),
  padsStopAll: () => call<void>("pads_stop_all"),
  padsSetDevice: (name: string | null) => call<void>("pads_set_device", { name }),
  padsState: () => call<LiveState>("pads_state"),

  // Connections (off until the user turns them on)
  extEnable: (on: boolean) => call<void>("ext_enable", { on }),
  extTabs: () => call<ExtTabs>("ext_tabs"),
  extCommand: (tabId: number, action: string, value?: number) => call<void>("ext_command", { tabId, action, value: value ?? null }),
  phoneEnable: (on: boolean) => call<PhoneInfo>("phone_enable", { on }),
  phoneInfo: () => call<PhoneInfo>("phone_info"),
  phoneNewCode: () => call<PhoneInfo>("phone_new_code"),
  phoneUpdate: (locked: boolean, favorites: unknown, levels: Record<string, number>, rhMain: number, rh: PhoneRehearsal | null) =>
    call<void>("phone_update", { locked, favorites, levels, rhMain, rh }),
};

export interface ExtTab {
  tabId: number;
  title: string;
  url: string;
  favIconUrl: string;
  audible: boolean;
  muted: boolean;
  media: null | {
    paused: boolean;
    currentTime: number;
    duration: number | null;
    volume: number;
    playbackRate: number;
    hasNext: boolean;
    site: string;
    title: string;
    artist: string;
  };
}

export interface ExtTabs {
  enabled: boolean;
  connected: boolean;
  tabs: ExtTab[];
}

/** What the phone shows in Rehearsal mode: the same sources and outputs as the computer. */
export interface PhoneRehearsal {
  sources: Array<Pick<RhSource, "id" | "app" | "title" | "artist" | "status" | "canToggle" | "canNext" | "canPrev"> & { volume: number | null }>;
  outputs: Array<{ id: string; name: string; description: string; kind: RhOutput["kind"]; volume: number | null; isDefault: boolean; role: "live" | "pre" | null }>;
}

/** Result of the reliability test (Settings → Test). */
export interface TestStep {
  run: number;
  step: number;
  code: string;
  ok: boolean;
  number: number | null;
  name: string | null;
  exit: "fadeOut" | "crossfade" | "next" | "none" | null;
  seconds: number | null;
}
export interface TestReport {
  runs: number;
  steps: TestStep[];
  errors: number;
  identical: boolean;
  seconds: number;
}

export interface PhoneInfo {
  enabled: boolean;
  url: string;
  code: string;
  qrSvg: string;
  error: string | null;
}

export interface RhSource {
  id: string;
  app: string;
  exe: string;
  kind: "spotify" | "browser" | "media" | "vlc" | "wmp" | "program" | "internal";
  title: string;
  artist: string;
  thumb: string | null;
  status: "playing" | "paused" | "stopped";
  canToggle: boolean;
  canNext: boolean;
  canPrev: boolean;
  canSpeed: boolean;
  speed: number | null;
  volume: number | null;
  peak: number;
  pids: number[];
  outputId: string | null;
  positionSec: number | null;
  durationSec: number | null;
}

export interface RhOutput {
  id: string;
  name: string;
  /** "Speakers", "Headphones"… as Windows describes it. */
  description: string;
  kind: "speakers" | "headphones" | "hdmi" | "digital" | "line" | "other";
  /** Known to Windows but not connected now. */
  connected: boolean;
  /** Volume of the output itself (0…1). */
  volume: number | null;
  isDefault: boolean;
  peakL: number;
  peakR: number;
}

export interface RhSnapshot {
  supported: boolean;
  routingAvailable: boolean;
  sources: RhSource[];
  outputs: RhOutput[];
  pendingRestore: number;
}

export function onEngineState(cb: (s: LiveState) => void): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {});
  return listen<LiveState>("engine-state", (e) => cb(e.payload));
}

export function onEvent<T>(name: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {});
  return listen<T>(name, (e) => cb(e.payload));
}

export const appWindow = {
  minimize: () => isTauri && getCurrentWindow().minimize(),
  toggleMaximize: () => isTauri && getCurrentWindow().toggleMaximize(),
  close: () => isTauri && getCurrentWindow().close(),
  destroy: () => isTauri && getCurrentWindow().destroy(),
  isMaximized: async () => (isTauri ? getCurrentWindow().isMaximized() : false),
  onResized: (cb: () => void) => (isTauri ? getCurrentWindow().onResized(cb) : Promise.resolve(() => {})),
  onCloseRequested: (cb: (prevent: () => void) => Promise<void> | void) =>
    isTauri
      ? getCurrentWindow().onCloseRequested(async (e) => {
          await cb(() => e.preventDefault());
        })
      : Promise.resolve(() => {}),
  onDragDrop: (cb: (paths: string[], x: number, y: number) => void) =>
    isTauri
      ? getCurrentWindow().onDragDropEvent((e) => {
          if (e.payload.type === "drop") cb(e.payload.paths, e.payload.position.x, e.payload.position.y);
        })
      : Promise.resolve(() => {}),
};
