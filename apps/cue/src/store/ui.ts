import { create } from "zustand";

/** The four ways of working (selector at the top centre). */
export type Mode = "prepare" | "projections" | "controls" | "show";
export const MODES: Mode[] = ["prepare", "projections", "controls", "show"];

export type DialogKind = "settings" | "versions" | "newShow";

/** Categories of the Settings window (13_cue.md, "Impostazioni"). */
export type SettingsTab = "general" | "script" | "keys" | "link" | "outputs" | "projections" | "test" | "about";

export interface Toast {
  message: string;
  kind: "info" | "error";
}

export type BannerKind = "crashRestored" | "crashRestoreAvailable";

interface UiStore {
  mode: Mode;
  dialog: DialogKind | null;
  settingsTab: SettingsTab;
  toast: Toast | null;
  banner: { kind: BannerKind; data?: string } | null;
  /** 1 normally; n with `--instance n` (shown next to the version). */
  instance: number;
  setMode: (m: Mode) => void;
  openDialog: (kind: DialogKind) => void;
  openSettings: (tab?: SettingsTab) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  closeDialog: () => void;
  showToast: (message: string, kind?: "info" | "error") => void;
  clearToast: () => void;
  setBanner: (kind: BannerKind | null, data?: string) => void;
  setInstance: (n: number) => void;
}

export const useUi = create<UiStore>((set) => ({
  mode: "prepare",
  dialog: null,
  settingsTab: "general",
  toast: null,
  banner: null,
  instance: 1,
  setMode: (mode) => set({ mode }),
  openDialog: (dialog) => set({ dialog }),
  openSettings: (tab) => set((s) => ({ dialog: "settings", settingsTab: tab ?? s.settingsTab })),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  closeDialog: () => set({ dialog: null }),
  showToast: (message, kind = "info") => set({ toast: { message, kind } }),
  clearToast: () => set({ toast: null }),
  setBanner: (kind, data) => set({ banner: kind ? { kind, data } : null }),
  setInstance: (instance) => set({ instance }),
}));
