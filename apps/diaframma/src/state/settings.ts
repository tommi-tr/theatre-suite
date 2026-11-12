import { create } from "zustand";
import type { Lang, ThemePref } from "@theatre-suite/core";
import { debounce } from "@theatre-suite/core";
import { api } from "../lib/api";
import { FLAT_EQ, type Eq, type OthersOnGo } from "./types";

export type PadMode = "hold" | "toEnd" | "toggle";

/** A launchpad sound. */
export interface Pad {
  id: string;
  /** Null for a standard sound: its name comes from the dictionary. */
  name: string | null;
  /** Standard sound that comes with Diaframma (file name without extension). */
  builtin: string | null;
  /** The user's own file. */
  path: string | null;
  /** The key that plays it (KeyboardEvent.code, e.g. "Numpad1" or "KeyC"); null = not on the keyboard. */
  key: string | null;
  /** On the Ctrl level of that key (Ctrl + key). */
  ctrl: boolean;
  /** hold: plays while the keys are held · toEnd: plays to the end · toggle: same keys again stop it. */
  mode: PadMode;
  loop: boolean;
  volumeDb: number;
}

export const BUILTIN_SOUNDS: { file: string; name: string; mode: PadMode; loop: boolean }[] = [
  { file: "thunder", name: "Thunder", mode: "toEnd", loop: false },
  { file: "doorbell", name: "Doorbell", mode: "toEnd", loop: false },
  { file: "phone-bell", name: "Old phone ringing", mode: "toggle", loop: true },
  { file: "phone-ring", name: "Phone ringing", mode: "toggle", loop: true },
  { file: "knock", name: "Knocking at the door", mode: "toEnd", loop: false },
  { file: "alarm-siren", name: "Siren", mode: "hold", loop: true },
  { file: "alarm-bell", name: "Alarm bell", mode: "hold", loop: true },
  { file: "car-horn", name: "Car horn", mode: "toEnd", loop: false },
  { file: "applause", name: "Applause", mode: "toEnd", loop: false },
  { file: "rain", name: "Rain", mode: "toggle", loop: true },
  { file: "wind", name: "Wind", mode: "toggle", loop: true },
  { file: "clock", name: "Clock ticking", mode: "toggle", loop: true },
  { file: "church-bell", name: "Church bell", mode: "toEnd", loop: false },
  { file: "beep", name: "Beep", mode: "hold", loop: true },
];

export function defaultPads(): Pad[] {
  return BUILTIN_SOUNDS.map((b, i) => ({
    id: `builtin-${b.file}`,
    name: null,
    builtin: b.file,
    path: null,
    key: i < 9 ? `Numpad${i + 1}` : null,
    ctrl: false,
    mode: b.mode,
    loop: b.loop,
    volumeDb: 0,
  }));
}

export interface Settings {
  version: 3;
  language: Lang;
  theme: ThemePref;
  /** After a GO, standby moves to the next track. */
  autoAdvance: boolean;
  othersOnGo: OthersOnGo;
  fadeInSec: number;
  fadeOutSec: number;
  crossfadeSec: number;
  /** Quick fade of the track in front when it has no Exit and GO starts another one. */
  quickFadeSec: number;
  stopAllSec: number;
  /** Waveform drawing: "mirror" = symmetric, "bottom" = from the baseline up. */
  waveStyle: "mirror" | "bottom";
  /** Output device name; null = Windows default. */
  outputDevice: string | null;
  recentFiles: string[];
  phoneEnabled: boolean;
  extensionBridgeEnabled: boolean;
  /** Roles of outputs in Rehearsal mode, by device name. */
  outputRoles: Record<string, "live" | "pre">;
  favorites: Favorite[];
  /** The guide was shown once at the first start. */
  guideSeen: boolean;
  /** First number of the cue list. */
  numberFrom: 0 | 1;
  /** A click on the waveform of a row moves the play position: only when the track is paused, whenever it plays, or never. */
  seekClick: "paused" | "always" | "never";
  /** Dragged points (IN, OUT, loop, curves) stick to the markers. */
  snapMarkers: boolean;
  /** Show mode: the track that plays is kept as the first row on screen. */
  followPlaying: boolean;
  /** Main volume of Show mode (dB). */
  mainDb: number;
  /** Rehearsal mode: main volume (0…1) applied on top of every source. */
  rhMain: number;
  /** Rehearsal mode: equalizer of Diaframma's own player. */
  rhEq: Eq;
  /** Rehearsal mode: Diaframma sets the output of every program itself (ignores the Windows default). */
  pinOutputs: boolean;
  /** Launchpad always active: its keys play also in Show and Rehearsal mode. */
  launchpadOn: boolean;
  pads: Pad[];
}

export interface Favorite {
  id: string;
  title: string;
  artist: string;
  source: string;
  /** ISO date-time when it was starred. */
  at: string;
  positionSec: number | null;
  link: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 3,
  language: "en",
  theme: "dark",
  autoAdvance: true,
  othersOnGo: "fadeOut",
  fadeInSec: 3,
  fadeOutSec: 3,
  crossfadeSec: 4,
  quickFadeSec: 1.5,
  stopAllSec: 1.5,
  waveStyle: "mirror",
  outputDevice: null,
  recentFiles: [],
  phoneEnabled: false,
  extensionBridgeEnabled: false,
  outputRoles: {},
  favorites: [],
  guideSeen: false,
  numberFrom: 1,
  seekClick: "paused",
  snapMarkers: false,
  followPlaying: false,
  mainDb: 0,
  rhMain: 1,
  rhEq: [...FLAT_EQ],
  pinOutputs: true,
  launchpadOn: false,
  pads: defaultPads(),
};

function sanitize(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS, pads: defaultPads(), rhEq: [...FLAT_EQ] as Eq };
  if (!raw || typeof raw !== "object") return s;
  const r = raw as Record<string, unknown>;
  const num = (k: keyof Settings, lo: number, hi: number) => {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) (s as Record<string, unknown>)[k] = Math.min(hi, Math.max(lo, v));
  };
  if (r.language === "en" || r.language === "it") s.language = r.language;
  if (r.theme === "dark" || r.theme === "light" || r.theme === "system") s.theme = r.theme;
  if (typeof r.autoAdvance === "boolean") s.autoAdvance = r.autoAdvance;
  if (r.othersOnGo === "fadeOut" || r.othersOnGo === "keep" || r.othersOnGo === "stop") s.othersOnGo = r.othersOnGo;
  // "Pause" is no longer offered: a quick fade out is the default.
  if (r.waveStyle === "mirror" || r.waveStyle === "bottom") s.waveStyle = r.waveStyle;
  if (r.numberFrom === 0 || r.numberFrom === 1) s.numberFrom = r.numberFrom;
  if (r.seekClick === "paused" || r.seekClick === "always" || r.seekClick === "never") s.seekClick = r.seekClick;
  if (typeof r.snapMarkers === "boolean") s.snapMarkers = r.snapMarkers;
  if (typeof r.followPlaying === "boolean") s.followPlaying = r.followPlaying;
  if (typeof r.pinOutputs === "boolean") s.pinOutputs = r.pinOutputs;
  if (typeof r.launchpadOn === "boolean") s.launchpadOn = r.launchpadOn;
  num("mainDb", -60, 10);
  num("rhMain", 0, 1);
  if (Array.isArray(r.rhEq)) s.rhEq = [0, 1, 2, 3, 4].map((i) => (typeof (r.rhEq as unknown[])[i] === "number" ? Math.max(-24, Math.min(24, (r.rhEq as number[])[i])) : 0)) as Eq;
  if (Array.isArray(r.pads)) {
    const modes: PadMode[] = ["hold", "toEnd", "toggle"];
    s.pads = (r.pads as unknown[])
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && typeof (p as Record<string, unknown>).id === "string")
      .map((p) => ({
        id: p.id as string,
        name: typeof p.name === "string" ? p.name : null,
        builtin: typeof p.builtin === "string" ? p.builtin : null,
        path: typeof p.path === "string" ? p.path : null,
        // Version 2 saved combinations of keys: a single key carries over, longer ones are left unassigned.
        key: typeof p.key === "string" ? p.key : Array.isArray(p.keys) && p.keys.length === 1 && typeof p.keys[0] === "string" ? (p.keys[0] as string) : null,
        ctrl: p.ctrl === true,
        mode: modes.includes(p.mode as PadMode) ? (p.mode as PadMode) : "toEnd",
        loop: p.loop === true,
        volumeDb: typeof p.volumeDb === "number" && Number.isFinite(p.volumeDb) ? Math.max(-40, Math.min(10, p.volumeDb)) : 0,
      }))
      .filter((p) => p.builtin || p.path)
      .slice(0, 64);
  }
  num("fadeInSec", 0, 60);
  num("fadeOutSec", 0, 60);
  num("crossfadeSec", 0, 60);
  num("quickFadeSec", 0.05, 30);
  num("stopAllSec", 0, 30);
  if (typeof r.outputDevice === "string" || r.outputDevice === null) s.outputDevice = r.outputDevice as string | null;
  if (Array.isArray(r.recentFiles)) s.recentFiles = r.recentFiles.filter((x): x is string => typeof x === "string").slice(0, 10);
  if (typeof r.phoneEnabled === "boolean") s.phoneEnabled = r.phoneEnabled;
  if (typeof r.guideSeen === "boolean") s.guideSeen = r.guideSeen;
  if (typeof r.extensionBridgeEnabled === "boolean") s.extensionBridgeEnabled = r.extensionBridgeEnabled;
  if (r.outputRoles && typeof r.outputRoles === "object") {
    const roles: Record<string, "live" | "pre"> = {};
    for (const [k, v] of Object.entries(r.outputRoles as Record<string, unknown>)) if (v === "live" || v === "pre") roles[k] = v;
    s.outputRoles = roles;
  }
  if (Array.isArray(r.favorites)) {
    s.favorites = (r.favorites as unknown[])
      .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
      .filter((f) => typeof f.id === "string" && typeof f.title === "string")
      .map((f) => ({
        id: f.id as string,
        title: f.title as string,
        artist: typeof f.artist === "string" ? f.artist : "",
        source: typeof f.source === "string" ? f.source : "",
        at: typeof f.at === "string" ? f.at : new Date().toISOString(),
        positionSec: typeof f.positionSec === "number" ? f.positionSec : null,
        link: typeof f.link === "string" ? f.link : null,
      }))
      .slice(0, 500);
  }
  return s;
}

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
  addRecent: (path: string) => void;
}

const persist = debounce((s: Settings) => {
  api.settingsSave(s).catch((e) => console.error("settings save failed", e));
}, 400);

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    try {
      const raw = await api.settingsLoad();
      set({ settings: sanitize(raw), loaded: true });
    } catch {
      set({ settings: DEFAULT_SETTINGS, loaded: true });
    }
  },
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    persist(settings);
  },
  addRecent: (path) => {
    const list = [path, ...get().settings.recentFiles.filter((p) => p !== path)].slice(0, 10);
    get().update({ recentFiles: list });
  },
}));
