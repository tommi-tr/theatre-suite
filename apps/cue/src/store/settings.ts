import { create } from "zustand";
import { debounce, type Lang, type ThemePref } from "@theatre-suite/core";
import { api, isTauri } from "../lib/api";
import { cloneKeymap, DEFAULT_KEYMAP, normalizeKeymap, type Keymap } from "../model/keys";

/** Paper of the script, separate from the app theme: white (default) or dark (inverted, with its brightness). */
export type Paper = "white" | "dark";
/** What ← → (and A D) do on the script: zoom (default) or change page. */
export type ArrowKeys = "zoom" | "page";

/** Settings of this computer (saved in Cue's data folder, not in the show). */
export interface Settings {
  version: 1;
  language: Lang;
  theme: ThemePref;
  paper: Paper;
  /** Brightness of the dark paper, 40–100 (%). */
  paperBrightness: number;
  arrowKeys: ArrowKeys;
  recentFiles: string[];
  /** The keys (model/keys.ts): every action with its alternative chords. F13 is always GO and is not in it. */
  keymap: Keymap;
  /** Sound output by name; null = the system default. */
  audioDevice: string | null;
  /** DMX cable: the port chosen by the user ("COM3"); null = Cue finds it. */
  dmxPort: string | null;
  /** In Show the script scrolls by itself to the standby GO when it changes (a hand scroll suspends it, "Segui" resumes). */
  followStandby: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  // Italian by default (13_cue.md); the interface is ready for English.
  language: "it",
  // Stage app: dark by default (02_design.md).
  theme: "dark",
  paper: "white",
  paperBrightness: 85,
  arrowKeys: "zoom",
  recentFiles: [],
  keymap: cloneKeymap(DEFAULT_KEYMAP),
  audioDevice: null,
  dmxPort: null,
  followStandby: true,
};

const LOCAL_KEY = "cue.settings";

const pick = <T extends string>(v: unknown, allowed: readonly T[], def: T): T => (allowed.includes(v as T) ? (v as T) : def);

export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    version: 1,
    language: pick<Lang>(r.language, ["it", "en"], DEFAULT_SETTINGS.language),
    theme: pick<ThemePref>(r.theme, ["dark", "light", "system"], "dark"),
    paper: pick<Paper>(r.paper, ["white", "dark"], "white"),
    paperBrightness:
      typeof r.paperBrightness === "number" && Number.isFinite(r.paperBrightness) ? Math.round(Math.min(100, Math.max(40, r.paperBrightness))) : DEFAULT_SETTINGS.paperBrightness,
    arrowKeys: pick<ArrowKeys>(r.arrowKeys, ["zoom", "page"], "zoom"),
    recentFiles: Array.isArray(r.recentFiles) ? r.recentFiles.filter((x): x is string => typeof x === "string").slice(0, 10) : [],
    keymap: normalizeKeymap(r.keymap),
    audioDevice: typeof r.audioDevice === "string" && r.audioDevice ? r.audioDevice : null,
    dmxPort: typeof r.dmxPort === "string" && r.dmxPort ? r.dmxPort : null,
    followStandby: typeof r.followStandby === "boolean" ? r.followStandby : DEFAULT_SETTINGS.followStandby,
  };
}

const persist = debounce((s: Settings) => {
  if (isTauri) api.settingsSave(s).catch((e) => console.error("settings not saved", e));
  else {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
    } catch {
      /* preview without storage */
    }
  }
}, 400);

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
  addRecent: (path: string) => void;
  removeRecent: (path: string) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    let raw: unknown = {};
    try {
      raw = isTauri ? await api.settingsLoad() : JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}");
    } catch {
      raw = {};
    }
    set({ settings: normalizeSettings(raw), loaded: true });
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
  removeRecent: (path) => get().update({ recentFiles: get().settings.recentFiles.filter((p) => p !== path) }),
}));
