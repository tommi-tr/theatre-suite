import { create } from "zustand";
import type { Lang, ThemePref } from "@theatre-suite/core";
import { debounce } from "@theatre-suite/core";
import { api } from "../lib/api";
import type { OthersOnGo } from "./types";

export interface Settings {
  version: 1;
  language: Lang;
  theme: ThemePref;
  /** After a GO, standby moves to the next track. */
  autoAdvance: boolean;
  othersOnGo: OthersOnGo;
  fadeInSec: number;
  fadeOutSec: number;
  crossfadeSec: number;
  stopAllSec: number;
  /** Output device name; null = Windows default. */
  outputDevice: string | null;
  recentFiles: string[];
  phoneEnabled: boolean;
  extensionBridgeEnabled: boolean;
  /** Roles of outputs in Rehearsal mode, by device name. */
  outputRoles: Record<string, "live" | "pre">;
  favorites: Favorite[];
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
  version: 1,
  language: "en",
  theme: "dark",
  autoAdvance: true,
  othersOnGo: "pause",
  fadeInSec: 3,
  fadeOutSec: 3,
  crossfadeSec: 4,
  stopAllSec: 1.5,
  outputDevice: null,
  recentFiles: [],
  phoneEnabled: false,
  extensionBridgeEnabled: false,
  outputRoles: {},
  favorites: [],
};

function sanitize(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return s;
  const r = raw as Record<string, unknown>;
  const num = (k: keyof Settings, lo: number, hi: number) => {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) (s as Record<string, unknown>)[k] = Math.min(hi, Math.max(lo, v));
  };
  if (r.language === "en" || r.language === "it") s.language = r.language;
  if (r.theme === "dark" || r.theme === "light" || r.theme === "system") s.theme = r.theme;
  if (typeof r.autoAdvance === "boolean") s.autoAdvance = r.autoAdvance;
  if (r.othersOnGo === "pause" || r.othersOnGo === "fadeOut" || r.othersOnGo === "keep" || r.othersOnGo === "stop") s.othersOnGo = r.othersOnGo;
  num("fadeInSec", 0, 60);
  num("fadeOutSec", 0, 60);
  num("crossfadeSec", 0, 60);
  num("stopAllSec", 0, 30);
  if (typeof r.outputDevice === "string" || r.outputDevice === null) s.outputDevice = r.outputDevice as string | null;
  if (Array.isArray(r.recentFiles)) s.recentFiles = r.recentFiles.filter((x): x is string => typeof x === "string").slice(0, 10);
  if (typeof r.phoneEnabled === "boolean") s.phoneEnabled = r.phoneEnabled;
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
