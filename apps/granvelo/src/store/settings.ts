import { create } from "zustand";
import { debounce, type Lang, type ThemePref } from "@theatre-suite/core";
import { api, isTauri } from "../lib/api";

/** How intensities are written in the desk: DMX steps 0–255 or percent. */
export type Units = "dmx" | "percent";
/** Family of the USB-DMX cable: recognised automatically, or chosen by hand (Settings → Uscita DMX). */
export type DmxType = "auto" | "pro" | "open";
/** Detail of the stage preview (10_granvelo.md, "Anteprima e computer vecchi"). */
export type PreviewDetail = "essential" | "medium" | "high" | "auto";

/**
 * Settings of this computer (saved in Granvelo's data folder, not in the show). What belongs to the show —
 * memories bound to addresses or lights, default crossfade, emergency memory — is saved in the `.granvelo`
 * file (`settings` of the document) and edited from the same Settings window.
 */
export interface Settings {
  version: 1;
  language: Lang;
  theme: ThemePref;
  units: Units;
  /**
   * Port of the chosen USB-DMX cable ("COM3"); null = automatic (the first cable found). With type "auto" the
   * port is only tried first; with Pro or Open DMX it is used as it is.
   */
  dmxDevice: string | null;
  dmxType: DmxType;
  previewDetail: PreviewDetail;
  recentFiles: string[];
}

function systemLanguage(): Lang {
  return typeof navigator !== "undefined" && /^it\b/i.test(navigator.language) ? "it" : "en";
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  language: systemLanguage(),
  // Stage app: dark by default (02_design.md).
  theme: "dark",
  units: "dmx",
  dmxDevice: null,
  dmxType: "auto",
  previewDetail: "medium",
  recentFiles: [],
};

const LOCAL_KEY = "granvelo.settings";

const pick = <T extends string>(v: unknown, allowed: readonly T[], def: T): T => (allowed.includes(v as T) ? (v as T) : def);

export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    version: 1,
    language: pick<Lang>(r.language, ["it", "en"], DEFAULT_SETTINGS.language),
    theme: pick<ThemePref>(r.theme, ["dark", "light", "system"], "dark"),
    units: pick<Units>(r.units, ["dmx", "percent"], "dmx"),
    dmxDevice: typeof r.dmxDevice === "string" && r.dmxDevice ? r.dmxDevice.slice(0, 200) : null,
    dmxType: pick<DmxType>(r.dmxType, ["auto", "pro", "open"], "auto"),
    previewDetail: pick<PreviewDetail>(r.previewDetail, ["essential", "medium", "high", "auto"], "medium"),
    recentFiles: Array.isArray(r.recentFiles) ? r.recentFiles.filter((x): x is string => typeof x === "string").slice(0, 10) : [],
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
