import { create } from "zustand";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { DocIndex } from "../model/derive";
import { getData } from "../model/defaults";
import type { SavedVersion } from "../model/file";
import type { DocData } from "../model/types";
import type { Pagination } from "../editor/paginate";
import { getIndex } from "../editor/plugins";

interface DocStore {
  view: EditorView | null;
  state: EditorState | null;
  /** Document shown when the editor is created (or replaced). */
  doc: PMNode | null;
  /** Increases every time a new document is loaded (the editor rebuilds its state). */
  loadRev: number;
  filePath: string | null;
  dirty: boolean;
  versions: SavedVersion[];
  pages: Pagination | null;
  setView: (v: EditorView | null) => void;
  onState: (st: EditorState, tr: Transaction | null) => void;
  setPages: (p: Pagination) => void;
  load: (doc: PMNode, opts: { filePath: string | null; dirty: boolean; versions: SavedVersion[] }) => void;
  markSaved: (path: string) => void;
  setVersions: (v: SavedVersion[]) => void;
}

export const useDoc = create<DocStore>((set) => ({
  view: null,
  state: null,
  doc: null,
  loadRev: 0,
  filePath: null,
  dirty: false,
  versions: [],
  pages: null,
  setView: (view) => set({ view, state: view?.state ?? null }),
  onState: (state, tr) =>
    set((s) => ({
      state,
      dirty: s.dirty || (!!tr && tr.docChanged && tr.getMeta("addToHistory") !== false && tr.getMeta("noDirty") !== true),
    })),
  setPages: (pages) => set({ pages }),
  load: (doc, { filePath, dirty, versions }) => set((s) => ({ doc, filePath, dirty, versions, loadRev: s.loadRev + 1, pages: null })),
  markSaved: (filePath) => set({ filePath, dirty: false }),
  setVersions: (versions) => set({ versions }),
}));

/** Current editor view (null before the editor is shown). */
export function getView(): EditorView | null {
  return useDoc.getState().view;
}

export function currentState(): EditorState | null {
  return useDoc.getState().view?.state ?? useDoc.getState().state;
}

/** Data of the current script (title, characters, format…). */
export function currentData(): DocData | null {
  const st = currentState();
  return st ? getData(st.doc) : null;
}

export function currentIndex(): DocIndex | null {
  const st = currentState();
  return st ? getIndex(st) : null;
}

/** Hook: data of the script, re-rendering when it changes. */
export function useData(): DocData | null {
  return useDoc((s) => (s.state ? getData(s.state.doc) : null));
}

export function useIndex(): DocIndex | null {
  return useDoc((s) => (s.state ? getIndex(s.state) : null));
}
