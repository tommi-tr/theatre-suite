import { create } from "zustand";
import { History, type ShowInfo } from "@theatre-suite/core";
import type { PartInfo } from "../lib/api";
import type { CueShow } from "../model/show";

/** Changes to the same thing within this time are one step of undo. */
const COALESCE_MS = 1200;

/**
 * The open show. `show` is `show.json`; the parts (script PDF, images) stay in the file on disk and are listed
 * in `parts`. Parts added or removed since the last save are pending until the next save.
 */
interface DocStore {
  /** null = no show open (the start screen). */
  show: CueShow | null;
  filePath: string | null;
  dirty: boolean;
  /** Parts in the file on disk (after the last open or save). */
  parts: PartInfo[];
  /** SHA-256 of the file on disk after the last open or save. */
  sha256: string | null;
  /** The show of the launcher this file belongs to (index file next to it), if any. */
  band: ShowInfo | null;
  /** Increases at every load: views reset their state. */
  loadRev: number;
  canUndo: boolean;
  canRedo: boolean;
  load: (show: CueShow, opts: { filePath: string | null; dirty: boolean; parts?: PartInfo[]; sha256?: string | null }) => void;
  close: () => void;
  /** Changes the show. `key` groups quick successive changes into one undo step. */
  change: (recipe: (s: CueShow) => CueShow, key?: string) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (path: string, parts: PartInfo[], sha256: string) => void;
  setBand: (band: ShowInfo | null) => void;
}

const history = new History<CueShow>(300);
let lastKey: string | null = null;
let lastAt = 0;

export const useDoc = create<DocStore>((set, get) => ({
  show: null,
  filePath: null,
  dirty: false,
  parts: [],
  sha256: null,
  band: null,
  loadRev: 0,
  canUndo: false,
  canRedo: false,
  load: (show, { filePath, dirty, parts = [], sha256 = null }) => {
    history.clear();
    lastKey = null;
    set((s) => ({ show, filePath, dirty, parts, sha256, loadRev: s.loadRev + 1, canUndo: false, canRedo: false, band: filePath && filePath === s.filePath ? s.band : null }));
  },
  close: () => {
    history.clear();
    lastKey = null;
    set((s) => ({ show: null, filePath: null, dirty: false, parts: [], sha256: null, band: null, loadRev: s.loadRev + 1, canUndo: false, canRedo: false }));
  },
  change: (recipe, key) => {
    const prev = get().show;
    if (!prev) return;
    const next = recipe(prev);
    if (next === prev) return;
    const now = Date.now();
    if (!(key && key === lastKey && now - lastAt < COALESCE_MS)) history.record(prev);
    lastKey = key ?? null;
    lastAt = now;
    set({ show: next, dirty: true, canUndo: history.canUndo, canRedo: history.canRedo });
  },
  undo: () => {
    const cur = get().show;
    if (!cur) return;
    const prev = history.undo(cur);
    lastKey = null;
    if (prev) set({ show: prev, dirty: true, canUndo: history.canUndo, canRedo: history.canRedo });
  },
  redo: () => {
    const cur = get().show;
    if (!cur) return;
    const next = history.redo(cur);
    lastKey = null;
    if (next) set({ show: next, dirty: true, canUndo: history.canUndo, canRedo: history.canRedo });
  },
  markSaved: (filePath, parts, sha256) => set({ filePath, dirty: false, parts, sha256 }),
  setBand: (band) => set({ band }),
}));
