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
  /**
   * Parts added since the last save (part name → staged copy in Cue's autosave folder, see lib/api partStage).
   * They survive a crash with the autosave and go into the file at the next save.
   */
  pending: Record<string, string>;
  /** SHA-256 of the file on disk after the last open or save. */
  sha256: string | null;
  /** The show of the launcher this file belongs to (index file next to it), if any. */
  band: ShowInfo | null;
  /** Increases at every load: views reset their state. */
  loadRev: number;
  canUndo: boolean;
  canRedo: boolean;
  load: (show: CueShow, opts: { filePath: string | null; dirty: boolean; parts?: PartInfo[]; sha256?: string | null; pending?: Record<string, string> }) => void;
  close: () => void;
  /** Changes the show. `key` groups quick successive changes into one undo step. */
  change: (recipe: (s: CueShow) => CueShow, key?: string) => void;
  undo: () => void;
  redo: () => void;
  /**
   * After a save of `saved` (the show object that was written) with the pending parts `savedPending`. Edits made
   * while the file was being written keep the show dirty, and parts added meanwhile stay pending.
   */
  markSaved: (path: string, parts: PartInfo[], sha256: string, saved: CueShow, savedPending: Record<string, string>) => void;
  /**
   * A change that also adds a part (a new script): not undoable, since the part on disk cannot follow an undo.
   * Undo history restarts from here.
   */
  changeWithPart: (recipe: (s: CueShow) => CueShow, part: { name: string; staged: string }) => void;
  /**
   * A change that also adds parts (images of the projections). Undo history is kept: the parts of an undone change
   * stay in the file (harmless) and are there again if it is redone.
   */
  changeWithParts: (recipe: (s: CueShow) => CueShow, parts: { name: string; staged: string }[]) => void;
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
  pending: {},
  sha256: null,
  band: null,
  loadRev: 0,
  canUndo: false,
  canRedo: false,
  load: (show, { filePath, dirty, parts = [], sha256 = null, pending = {} }) => {
    history.clear();
    lastKey = null;
    set((s) => ({ show, filePath, dirty, parts, pending, sha256, loadRev: s.loadRev + 1, canUndo: false, canRedo: false, band: filePath && filePath === s.filePath ? s.band : null }));
  },
  close: () => {
    history.clear();
    lastKey = null;
    set((s) => ({ show: null, filePath: null, dirty: false, parts: [], pending: {}, sha256: null, band: null, loadRev: s.loadRev + 1, canUndo: false, canRedo: false }));
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
  markSaved: (filePath, parts, sha256, saved, savedPending) =>
    set((s) => {
      const pending = Object.fromEntries(Object.entries(s.pending).filter(([name, path]) => savedPending[name] !== path));
      return { filePath, parts, sha256, pending, dirty: s.show !== saved || Object.keys(pending).length > 0 };
    }),
  changeWithPart: (recipe, part) => {
    const prev = get().show;
    if (!prev) return;
    history.clear();
    lastKey = null;
    set((s) => ({ show: recipe(prev), dirty: true, pending: { ...s.pending, [part.name]: part.staged }, canUndo: false, canRedo: false }));
  },
  changeWithParts: (recipe, parts) => {
    const prev = get().show;
    if (!prev) return;
    history.record(prev);
    lastKey = null;
    set((s) => ({
      show: recipe(prev),
      dirty: true,
      pending: { ...s.pending, ...Object.fromEntries(parts.map((p) => [p.name, p.staged])) },
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    }));
  },
  setBand: (band) => set({ band }),
}));
