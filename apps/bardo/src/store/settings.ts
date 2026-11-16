import { create } from "zustand";
import { debounce, type Lang, type ThemePref } from "@theatre-suite/core";
import type { FormatModel } from "../format/model";
import { normalizeFormat } from "../format/model";
import type { DocLang } from "../model/types";
import { api, isTauri } from "../lib/api";

export interface Settings {
  version: 1;
  /** Language of the interface. */
  language: Lang;
  theme: ThemePref;
  /** Name written on notes and versions. */
  author: string;
  spellcheck: boolean;
  /** Language of new scripts. */
  docLang: DocLang;
  recentFiles: string[];
  /** Models saved with "Salva come modello". */
  userModels: FormatModel[];
  guideSeen: boolean;
  zoom: number;
  showMarks: boolean;
  /** View the text without page breaks. */
  continuous: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  language: "it",
  theme: "light",
  author: "",
  spellcheck: true,
  docLang: "it",
  recentFiles: [],
  userModels: [],
  guideSeen: false,
  zoom: 1,
  showMarks: true,
  continuous: false,
};

const LOCAL_KEY = "bardo.settings";

function normalize(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...r,
    language: r.language === "en" ? "en" : "it",
    theme: r.theme === "dark" || r.theme === "system" ? r.theme : "light",
    docLang: r.docLang === "en" ? "en" : "it",
    recentFiles: Array.isArray(r.recentFiles) ? r.recentFiles.filter((x) => typeof x === "string").slice(0, 10) : [],
    userModels: Array.isArray(r.userModels) ? r.userModels.map(normalizeFormat) : [],
    zoom: typeof r.zoom === "number" && r.zoom >= 0.5 && r.zoom <= 2 ? r.zoom : 1,
    version: 1,
  };
}

const persist = debounce((s: Settings) => {
  if (isTauri) api.settingsSave(s).catch((e) => console.error("settings not saved", e));
  else localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
}, 400);

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
  addRecent: (path: string) => void;
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
}));
