import { create } from "zustand";
import { debounce, type Lang, type ThemePref } from "@theatre-suite/core";
import { api, isTauri } from "../lib/api";

/** How intensities are written in the desk: DMX steps 0–255 or percent. */
export type Units = "dmx" | "percent";
/** Family of the USB-DMX cable: recognised automatically, or chosen by hand (Settings → Uscita DMX). */
export type DmxType = "auto" | "pro" | "open";
/** Detail of the stage preview (10_granvelo.md, "Anteprima e computer vecchi"). */
export type PreviewDetail = "essential" | "medium" | "high" | "auto";
/** What the automatic detail measured on this computer: the level it chose, the typical time of one picture, and when. */
export interface AutoDetail {
  level: "essential" | "medium" | "high";
  /** Typical time to draw one picture of the richest preview, in milliseconds. */
  ms: number;
  at: number;
}
/** The desk under the Show: none, groups only, one fader per light, every channel. */
export type ShowDesk = "none" | "mini" | "compact" | "extended";

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
  /** Result of the last measurement of "Automatica" (null = never measured). */
  autoDetail: AutoDetail | null;
  /** Seconds of "Fade to black" (F in the Show), down and back up. */
  ftbSeconds: number;
  showDesk: ShowDesk;
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
  autoDetail: null,
  ftbSeconds: 5,
  showDesk: "compact",
  recentFiles: [],
};

const LOCAL_KEY = "granvelo.settings";

const pick = <T extends string>(v: unknown, allowed: readonly T[], def: T): T => (allowed.includes(v as T) ? (v as T) : def);

function readAutoDetail(v: unknown): AutoDetail | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const level = pick<AutoDetail["level"]>(o.level, ["essential", "medium", "high"], "medium");
  if (typeof o.ms !== "number" || !Number.isFinite(o.ms) || o.ms < 0 || typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
  return { level, ms: Math.round(o.ms * 10) / 10, at: o.at };
}

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
    autoDetail: readAutoDetail(r.autoDetail),
    ftbSeconds: typeof r.ftbSeconds === "number" && Number.isFinite(r.ftbSeconds) ? Math.round(Math.min(60, Math.max(0, r.ftbSeconds)) * 10) / 10 : DEFAULT_SETTINGS.ftbSeconds,
    showDesk: pick<ShowDesk>(r.showDesk, ["none", "mini", "compact", "extended"], "compact"),
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
