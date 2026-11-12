import { create } from "zustand";
import { api, errorText, onEvent } from "../lib/api";
import { tr } from "../i18n";
import { plural } from "../lib/text";
import type { AppsView, OpenAllReport, Phase, ProjectView, Settings, ShowNode } from "../lib/types";

export type Screen = { name: "home" } | { name: "project"; path: string } | { name: "suite" };

export type DialogState =
  | null
  | { kind: "newShow" }
  | { kind: "copy"; node: ShowNode }
  | { kind: "cover"; path: string }
  | { kind: "settings" }
  | { kind: "adopt"; path: string; found: number }
  | { kind: "details"; path: string }
  | { kind: "newDoc"; path: string; app: string; phase: Phase | null }
  | { kind: "openAll"; report: OpenAllReport }
  | { kind: "forget"; node: ShowNode }
  | { kind: "feedback"; app?: string };

interface Store {
  settings: Settings | null;
  screen: Screen;
  shows: ShowNode[];
  view: ProjectView | null;
  apps: AppsView | null;
  checking: boolean;
  dialog: DialogState;
  toast: { message: string; kind: "info" | "error" } | null;
  /** Bumped when cover images change, so cards reload them. */
  coverStamp: number;

  init: () => Promise<void>;
  go: (s: Screen) => void;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  refreshShows: (rescan?: boolean) => Promise<void>;
  openShow: (path: string) => Promise<void>;
  reloadProject: () => Promise<void>;
  setDialog: (d: DialogState) => void;
  showToast: (message: string, kind?: "info" | "error") => void;
  clearToast: () => void;
  checkUpdates: () => Promise<void>;
  refreshApps: () => Promise<void>;
  bumpCovers: () => void;
}

export const useStore = create<Store>((set, get) => ({
  settings: null,
  screen: { name: "home" },
  shows: [],
  view: null,
  apps: null,
  checking: false,
  dialog: null,
  toast: null,
  coverStamp: 0,

  init: async () => {
    const settings = await api.settingsLoad();
    set({ settings });
    await get().refreshShows(true).catch((e) => get().showToast(errorText(e), "error"));
    api.appsStatus().then((apps) => set({ apps })).catch(() => {});
    // The weekly check: only if the user left it on and a week has passed. Offline is silent.
    api.updatesCheckIfDue().then((apps) => apps && set({ apps })).catch(() => {});
    const startup = await api.startupShow().catch(() => null);
    if (startup) await get().openShow(startup);
    await onEvent<string>("open-show", (dir) => void get().openShow(dir));
  },

  go: (screen) => set({ screen }),

  saveSettings: async (patch) => {
    const cur = get().settings;
    if (!cur) return;
    const next = { ...cur, ...patch };
    set({ settings: next });
    try {
      await api.settingsSave(next);
    } catch (e) {
      get().showToast(errorText(e), "error");
    }
  },

  refreshShows: async (rescan = false) => {
    const shows = rescan ? await api.showsRescan() : await api.showsList();
    set({ shows });
  },

  openShow: async (path) => {
    try {
      const res = await api.showOpen(path);
      if (res.notAShow) {
        set({ dialog: { kind: "adopt", path, found: res.foundDocuments } });
        return;
      }
      const view = await api.projectGet(path);
      set({ view, screen: { name: "project", path } });
      if (res.rebuilt || view.rebuilt) get().showToast(tr("The show index was damaged and has been rebuilt from the folder. Nothing was lost."));
      else if (view.added > 0) get().showToast(plural(tr, view.added, "1 new document found in the folder.", "{n} new documents found in the folder."));
      void get().refreshShows();
    } catch (e) {
      get().showToast(errorText(e), "error");
    }
  },

  reloadProject: async () => {
    const s = get().screen;
    if (s.name !== "project") return;
    try {
      set({ view: await api.projectGet(s.path) });
    } catch (e) {
      get().showToast(errorText(e), "error");
    }
  },

  setDialog: (dialog) => set({ dialog }),
  showToast: (message, kind = "info") => set({ toast: { message, kind } }),
  clearToast: () => set({ toast: null }),

  checkUpdates: async () => {
    set({ checking: true });
    try {
      const apps = await api.updatesCheck();
      set({ apps });
      const cur = get().settings;
      if (cur && !apps.error) set({ settings: { ...cur, lastCheck: apps.checkedAt } });
    } catch (e) {
      get().showToast(errorText(e), "error");
    } finally {
      set({ checking: false });
    }
  },

  refreshApps: async () => {
    try {
      set({ apps: await api.appsStatus() });
    } catch {
      /* the list simply stays as it was */
    }
  },

  bumpCovers: () => set((s) => ({ coverStamp: s.coverStamp + 1 })),
}));
