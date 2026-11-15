import { create } from "zustand";
import type { SectionId } from "../model/types";
import { DEFAULT_PARTS, type PartId } from "../shell/sections";

export type DialogKind = "settings" | "import" | "copyList" | "deletePerson" | "pasteReplies" | "copyMessage" | "deleteDate";

export interface DialogState {
  kind: DialogKind;
  /** An item id (the person or date to delete…) or, for "copyMessage", which message: `dates` or `reminder`. */
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
  /** Cell selected in the availability table. */
  cell: { personId: string; dateId: string } | null;
  /** Availability table: only the people who still have to answer. */
  onlyMissing: boolean;
  /** Text to read when "Paste the replies" opens (what was pasted outside the window). */
  pasteText: string;
  go: (section: SectionId | null, part?: PartId) => void;
  openDialog: (kind: DialogKind, extra?: string) => void;
  closeDialog: () => void;
  showToast: (message: string, kind?: "info" | "error") => void;
  clearToast: () => void;
  setBanner: (kind: BannerKind | null, data?: string) => void;
  selectPerson: (id: string | null) => void;
  selectCell: (cell: { personId: string; dateId: string } | null) => void;
  setOnlyMissing: (v: boolean) => void;
  openPaste: (text?: string) => void;
  openCopyMessage: (which: "dates" | "reminder") => void;
}

export const useUi = create<UiStore>((set) => ({
  section: null,
  parts: { ...DEFAULT_PARTS },
  dialog: null,
  toast: null,
  banner: null,
  personId: null,
  cell: null,
  onlyMissing: false,
  pasteText: "",
  go: (section, part) =>
    set((s) => ({ section, parts: section && part ? { ...s.parts, [section]: part } : s.parts })),
  openDialog: (kind, extra) => set({ dialog: { kind, extra } }),
  closeDialog: () => set({ dialog: null }),
  showToast: (message, kind = "info") => set({ toast: { message, kind } }),
  clearToast: () => set({ toast: null }),
  setBanner: (kind, data) => set({ banner: kind ? { kind, data } : null }),
  selectPerson: (personId) => set({ personId }),
  selectCell: (cell) => set({ cell }),
  setOnlyMissing: (onlyMissing) => set({ onlyMissing }),
  openPaste: (text = "") => set({ pasteText: text, dialog: { kind: "pasteReplies" } }),
  openCopyMessage: (which) => set({ dialog: { kind: "copyMessage", extra: which } }),
}));
