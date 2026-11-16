import { create } from "zustand";
import { debounce, type Lang, type ThemePref } from "@theatre-suite/core";
import { api, isTauri } from "../lib/api";

export interface Settings {
  version: 1;
  /** Language of the interface. */
  language: Lang;
  theme: ThemePref;
  recentFiles: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  language: "it",
  // Office / production app: light by default (02_design.md).
  theme: "light",
  recentFiles: [],
};

const LOCAL_KEY = "cantinella.settings";

function normalize(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    language: r.language === "en" ? "en" : "it",
    theme: r.theme === "dark" || r.theme === "system" ? r.theme : "light",
    recentFiles: Array.isArray(r.recentFiles) ? r.recentFiles.filter((x) => typeof x === "string").slice(0, 10) : [],
    version: 1,
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
    set({ settings: normalize(raw), loaded: true });
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
