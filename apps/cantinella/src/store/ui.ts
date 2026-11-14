import { create } from "zustand";
import type { SectionId } from "../model/types";
import { DEFAULT_PARTS, type PartId } from "../shell/sections";

export type DialogKind = "settings" | "import" | "copyList" | "deletePerson";

export interface DialogState {
  kind: DialogKind;
  /** An item id (the person to delete…). */
  extra?: string;
}

export interface Toast {
  message: string;
  kind: "info" | "error";
}

export type BannerKind = "crashRestored" | "crashRestoreAvailable";

interface UiStore {
  /** Null = the start screen "Where do you want to start?". */
  section: SectionId | null;
  /** Last part opened in each section. */
  parts: Record<SectionId, PartId>;
  dialog: DialogState | null;
  toast: Toast | null;
  banner: { kind: BannerKind; data?: string } | null;
  /** Person selected in the address book. */
  personId: string | null;
  go: (section: SectionId | null, part?: PartId) => void;
  openDialog: (kind: DialogKind, extra?: string) => void;
  closeDialog: () => void;
  showToast: (message: string, kind?: "info" | "error") => void;
  clearToast: () => void;
  setBanner: (kind: BannerKind | null, data?: string) => void;
  selectPerson: (id: string | null) => void;
}

export const useUi = create<UiStore>((set) => ({
  section: null,
  parts: { ...DEFAULT_PARTS },
  dialog: null,
  toast: null,
  banner: null,
  personId: null,
  go: (section, part) =>
    set((s) => ({ section, parts: section && part ? { ...s.parts, [section]: part } : s.parts })),
  openDialog: (kind, extra) => set({ dialog: { kind, extra } }),
  closeDialog: () => set({ dialog: null }),
  showToast: (message, kind = "info") => set({ toast: { message, kind } }),
  clearToast: () => set({ toast: null }),
  setBanner: (kind, data) => set({ banner: kind ? { kind, data } : null }),
  selectPerson: (personId) => set({ personId }),
}));
