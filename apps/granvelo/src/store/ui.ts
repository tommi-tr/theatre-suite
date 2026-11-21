import { create } from "zustand";
import type { Id } from "../model/types";

/** The three ways of working (selector at the top centre). */
export type Mode = "setup" | "desk" | "show";

export type DialogKind = "settings" | "versions" | "newShow" | "check" | "sequence" | "print";

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
  /** Light with the cursor in the list of Allestimento (the one the properties name first). */
  fixtureId: Id | null;
  /** All lights selected in Allestimento (several with Ctrl/Shift click); `fixtureId` is one of them. */
  selection: Id[];
  /** Where a Shift range starts. */
  anchorId: Id | null;
  /** Memory to bring into view when the sequence dialog opens. */
  sequenceFocusId: Id | null;
  setMode: (m: Mode) => void;
  openDialog: (kind: DialogKind) => void;
  openSettings: (tab?: SettingsTab) => void;
  /** Sequence and transitions (Show), optionally on one memory. */
  openSequence: (focusId?: Id | null) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  closeDialog: () => void;
  showToast: (message: string, kind?: "info" | "error") => void;
  clearToast: () => void;
  setBanner: (kind: BannerKind | null, data?: string) => void;
  selectFixture: (id: Id | null) => void;
  /** Selects several lights at once; `cursor` = the one with the cursor (default: the last), `anchor` = start of a Shift range (default: the cursor). */
  setSelection: (ids: Id[], cursor?: Id | null, anchor?: Id | null) => void;
}

export const useUi = create<UiStore>((set) => ({
  mode: "setup",
  dialog: null,
  settingsTab: "general",
  toast: null,
  banner: null,
  fixtureId: null,
  selection: [],
  anchorId: null,
  sequenceFocusId: null,
  setMode: (mode) => set({ mode }),
  openDialog: (dialog) => set({ dialog }),
  openSettings: (tab) => set((s) => ({ dialog: "settings", settingsTab: tab ?? s.settingsTab })),
  openSequence: (focusId) => set({ dialog: "sequence", sequenceFocusId: focusId ?? null }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  closeDialog: () => set({ dialog: null }),
  showToast: (message, kind = "info") => set({ toast: { message, kind } }),
  clearToast: () => set({ toast: null }),
  setBanner: (kind, data) => set({ banner: kind ? { kind, data } : null }),
  selectFixture: (fixtureId) => set({ fixtureId, selection: fixtureId ? [fixtureId] : [], anchorId: fixtureId }),
  setSelection: (ids, cursor, anchor) => {
    const c = cursor === undefined ? (ids[ids.length - 1] ?? null) : cursor;
    set({ selection: ids, fixtureId: c, anchorId: anchor === undefined ? c : anchor });
  },
}));
