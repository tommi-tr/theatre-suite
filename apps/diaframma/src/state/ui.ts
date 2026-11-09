import { create } from "zustand";

export type Mode = "show" | "rehearsal" | "launchpad";
export type DialogName = "settings" | "guide" | "phone" | "reorder" | "editor" | null;

interface UiStore {
  mode: Mode;
  dialog: DialogName;
  /** Track id for the large editor. */
  editorTrackId: string | null;
  toast: { message: string; kind: "info" | "error" } | null;
  banner: { kind: "crashRestored" | "crashRestoreAvailable"; data?: string } | null;
  setMode: (m: Mode) => void;
  openDialog: (d: Exclude<DialogName, null>) => void;
  openEditor: (trackId: string) => void;
  closeDialog: () => void;
  showToast: (message: string, kind?: "info" | "error") => void;
  clearToast: () => void;
  setBanner: (kind: "crashRestored" | "crashRestoreAvailable" | null, data?: string) => void;
}

export const useUi = create<UiStore>((set) => ({
  mode: "show",
  dialog: null,
  editorTrackId: null,
  toast: null,
  banner: null,
  setMode: (mode) => set({ mode }),
  openDialog: (dialog) => set({ dialog }),
  openEditor: (editorTrackId) => set({ dialog: "editor", editorTrackId }),
  closeDialog: () => set({ dialog: null }),
  showToast: (message, kind = "info") => set({ toast: { message, kind } }),
  clearToast: () => set({ toast: null }),
  setBanner: (kind, data) => set({ banner: kind ? { kind, data } : null }),
}));
