import { create } from "zustand";

export type Phase = "compose" | "format" | "send";

export type DialogKind =
  | "settings"
  | "guide"
  | "title"
  | "characters"
  | "cast"
  | "scene"
  | "act"
  | "tableau"
  | "autolist"
  | "categories"
  | "version"
  | "stats"
  | "note"
  | "import"
  | "models"
  | "symbols"
  | "rename";

export interface DialogState {
  kind: DialogKind;
  /** Usually the document position of the element the window is about. */
  pos?: number;
  /** Extra information (an item id, a preset…). */
  extra?: string;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  message: string;
  kind: "info" | "error";
  action?: ToastAction;
}

export interface SpeakerPicker {
  /** Position of the block (speech or line) the speaker is chosen for. */
  pos: number;
  /** "convert": the line becomes a speech; "change": another character speaks it. */
  mode: "convert" | "change";
}

interface UiStore {
  phase: Phase;
  setPhase: (p: Phase) => void;
  dialog: DialogState | null;
  openDialog: (kind: DialogKind, pos?: number, extra?: string) => void;
  closeDialog: () => void;
  toast: Toast | null;
  showToast: (message: string, kind?: "info" | "error", action?: ToastAction) => void;
  clearToast: () => void;
  banner: { kind: "crashRestored" | "crashRestoreAvailable"; data?: string } | null;
  setBanner: (kind: "crashRestored" | "crashRestoreAvailable" | null, data?: string) => void;
  ribbon: "compose" | "manual";
  setRibbon: (r: "compose" | "manual") => void;
  structureView: "tree" | "pages";
  setStructureView: (v: "tree" | "pages") => void;
  focusMode: boolean;
  toggleFocus: () => void;
  contextMenu: { x: number; y: number } | null;
  setContextMenu: (m: { x: number; y: number } | null) => void;
  speakerPicker: SpeakerPicker | null;
  setSpeakerPicker: (p: SpeakerPicker | null) => void;
  find: { open: boolean; replace: boolean };
  setFind: (f: { open: boolean; replace: boolean }) => void;
  /** Formatta: element whose style is being edited. */
  formatElement: string;
  setFormatElement: (k: string) => void;
}

export const useUi = create<UiStore>((set) => ({
  phase: "compose",
  setPhase: (phase) => set({ phase, contextMenu: null, speakerPicker: null }),
  dialog: null,
  openDialog: (kind, pos, extra) => set({ dialog: { kind, pos, extra }, contextMenu: null }),
  closeDialog: () => set({ dialog: null }),
  toast: null,
  showToast: (message, kind = "info", action) => set({ toast: { message, kind, action } }),
  clearToast: () => set({ toast: null }),
  banner: null,
  setBanner: (kind, data) => set({ banner: kind ? { kind, data } : null }),
  ribbon: "compose",
  setRibbon: (ribbon) => set({ ribbon }),
  structureView: "tree",
  setStructureView: (structureView) => set({ structureView }),
  focusMode: false,
  toggleFocus: () => set((s) => ({ focusMode: !s.focusMode })),
  contextMenu: null,
  setContextMenu: (contextMenu) => set({ contextMenu }),
  speakerPicker: null,
  setSpeakerPicker: (speakerPicker) => set({ speakerPicker }),
  find: { open: false, replace: false },
  setFind: (find) => set({ find }),
  formatElement: "speaker",
  setFormatElement: (formatElement) => set({ formatElement }),
}));
