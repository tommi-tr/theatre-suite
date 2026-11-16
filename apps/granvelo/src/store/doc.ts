import { create } from "zustand";
import { History, type ShowInfo } from "@theatre-suite/core";
import type { GranveloDoc } from "../model/types";

/** Changes to the same thing within this time are one step of undo (typing a name, moving a fader). */
const COALESCE_MS = 1200;

interface DocStore {
  /** The open show; null = no document (the start screen). */
  doc: GranveloDoc | null;
  filePath: string | null;
  dirty: boolean;
  /** The show of the launcher this file belongs to (index file next to it), if any. */
  show: ShowInfo | null;
  /** Increases at every load: views reset their selection. */
  loadRev: number;
  canUndo: boolean;
  canRedo: boolean;
  load: (doc: GranveloDoc, opts: { filePath: string | null; dirty: boolean }) => void;
  /** Back to the start screen (after the user agreed to drop unsaved changes). */
  close: () => void;
  /** Changes the document. `key` groups quick successive changes into one undo step. */
  change: (recipe: (d: GranveloDoc) => GranveloDoc, key?: string) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (path: string) => void;
  setShow: (show: ShowInfo | null) => void;
}

const history = new History<GranveloDoc>(300);
let lastKey: string | null = null;
let lastAt = 0;

export const useDoc = create<DocStore>((set, get) => ({
  doc: null,
  filePath: null,
  dirty: false,
  show: null,
  loadRev: 0,
  canUndo: false,
  canRedo: false,
  load: (doc, { filePath, dirty }) => {
    history.clear();
    lastKey = null;
    set((s) => ({ doc, filePath, dirty, loadRev: s.loadRev + 1, canUndo: false, canRedo: false, show: filePath && filePath === s.filePath ? s.show : null }));
  },
  close: () => {
    history.clear();
    lastKey = null;
    set((s) => ({ doc: null, filePath: null, dirty: false, show: null, loadRev: s.loadRev + 1, canUndo: false, canRedo: false }));
  },
  change: (recipe, key) => {
    const prev = get().doc;
    if (!prev) return;
    const next = recipe(prev);
    if (next === prev) return;
    const now = Date.now();
    if (!(key && key === lastKey && now - lastAt < COALESCE_MS)) history.record(prev);
    lastKey = key ?? null;
    lastAt = now;
    set({ doc: next, dirty: true, canUndo: history.canUndo, canRedo: history.canRedo });
  },
  undo: () => {
    const cur = get().doc;
    if (!cur) return;
    const prev = history.undo(cur);
    lastKey = null;
    if (prev) set({ doc: prev, dirty: true, canUndo: history.canUndo, canRedo: history.canRedo });
  },
  redo: () => {
    const cur = get().doc;
    if (!cur) return;
    const next = history.redo(cur);
    lastKey = null;
    if (next) set({ doc: next, dirty: true, canUndo: history.canUndo, canRedo: history.canRedo });
  },
  markSaved: (filePath) => set({ filePath, dirty: false }),
  setShow: (show) => set({ show }),
}));
