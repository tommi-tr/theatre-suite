import { create } from "zustand";
import type { Id } from "../model/types";

/** The three ways of working (selector at the top centre). */
export type Mode = "setup" | "desk" | "show";

export type DialogKind = "settings" | "versions" | "newShow";

/** Categories of the Settings window (10_granvelo.md, "Impostazioni"). */
export type SettingsTab = "general" | "dmx" | "preview" | "memories" | "test" | "about";

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
  /** Light selected in the list of Allestimento. */
  fixtureId: Id | null;
  setMode: (m: Mode) => void;
  openDialog: (kind: DialogKind) => void;
  openSettings: (tab?: SettingsTab) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  closeDialog: () => void;
  showToast: (message: string, kind?: "info" | "error") => void;
  clearToast: () => void;
  setBanner: (kind: BannerKind | null, data?: string) => void;
  selectFixture: (id: Id | null) => void;
}

export const useUi = create<UiStore>((set) => ({
  mode: "setup",
  dialog: null,
  settingsTab: "general",
  toast: null,
  banner: null,
  fixtureId: null,
  setMode: (mode) => set({ mode }),
  openDialog: (dialog) => set({ dialog }),
  openSettings: (tab) => set((s) => ({ dialog: "settings", settingsTab: tab ?? s.settingsTab })),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  closeDialog: () => set({ dialog: null }),
  showToast: (message, kind = "info") => set({ toast: { message, kind } }),
  clearToast: () => set({ toast: null }),
  setBanner: (kind, data) => set({ banner: kind ? { kind, data } : null }),
  selectFixture: (fixtureId) => set({ fixtureId }),
}));
