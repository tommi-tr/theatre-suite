import { create } from "zustand";
import { History, type ShowInfo } from "@theatre-suite/core";
import { newData } from "../model/defaults";
import type { CantinellaData } from "../model/types";

/** Changes to the same thing within this time are one step of undo (typing a name). */
const COALESCE_MS = 1200;

interface DocStore {
  data: CantinellaData;
  filePath: string | null;
  dirty: boolean;
  /** The show of the launcher this file belongs to (index file next to it), if any. */
  show: ShowInfo | null;
  /** Increases at every load: views reset their selection. */
  loadRev: number;
  canUndo: boolean;
  canRedo: boolean;
  load: (data: CantinellaData, opts: { filePath: string | null; dirty: boolean }) => void;
  /** Changes the document. `key` groups quick successive changes into one undo step. */
  change: (recipe: (d: CantinellaData) => CantinellaData, key?: string) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (path: string) => void;
  setShow: (show: ShowInfo | null) => void;
}

const history = new History<CantinellaData>(300);
let lastKey: string | null = null;
let lastAt = 0;

export const useDoc = create<DocStore>((set, get) => ({
  data: newData(),
  filePath: null,
  dirty: false,
  show: null,
  loadRev: 0,
  canUndo: false,
  canRedo: false,
  load: (data, { filePath, dirty }) => {
    history.clear();
    lastKey = null;
    set((s) => ({ data, filePath, dirty, loadRev: s.loadRev + 1, canUndo: false, canRedo: false, show: filePath === s.filePath ? s.show : null }));
  },
  change: (recipe, key) => {
    const prev = get().data;
    const next = recipe(prev);
    if (next === prev) return;
    const now = Date.now();
    if (!(key && key === lastKey && now - lastAt < COALESCE_MS)) history.record(prev);
    lastKey = key ?? null;
    lastAt = now;
    set({ data: next, dirty: true, canUndo: history.canUndo, canRedo: history.canRedo });
  },
  undo: () => {
    const prev = history.undo(get().data);
    lastKey = null;
    if (prev) set({ data: prev, dirty: true, canUndo: history.canUndo, canRedo: history.canRedo });
  },
  redo: () => {
    const next = history.redo(get().data);
    lastKey = null;
    if (next) set({ data: next, dirty: true, canUndo: history.canUndo, canRedo: history.canRedo });
  },
  markSaved: (filePath) => set({ filePath, dirty: false }),
  setShow: (show) => set({ show }),
}));
