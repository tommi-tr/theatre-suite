import { create } from "zustand";
import type { GranveloDoc, Id } from "../../model/types";
import { useDoc } from "../../store/doc";
import type { NumberingState } from "./numbering";

/** State of the Allestimento screen that is not part of the document (and not shared with other modes). */
interface SetupStore {
  /** The "add lights" dialog is open. */
  addOpen: boolean;
  /** Light being renamed in the list. */
  renamingId: Id | null;
  /** Truss whose editor is open in the list. */
  editingTrussId: Id | null;
  /** "Numera a clic" is running (null = not). */
  numbering: NumberingState | null;
  /** Where the next "Numera a clic" starts, before it is started: asked in a small popover. */
  numberingAsk: boolean;
  setAddOpen: (v: boolean) => void;
  setRenaming: (id: Id | null) => void;
  setEditingTruss: (id: Id | null) => void;
  setNumbering: (s: NumberingState | null) => void;
  setNumberingAsk: (v: boolean) => void;
}

export const useSetup = create<SetupStore>((set) => ({
  addOpen: false,
  renamingId: null,
  editingTrussId: null,
  numbering: null,
  numberingAsk: false,
  setAddOpen: (addOpen) => set({ addOpen }),
  setRenaming: (renamingId) => set({ renamingId }),
  setEditingTruss: (editingTrussId) => set({ editingTrussId }),
  setNumbering: (numbering) => set({ numbering }),
  setNumberingAsk: (numberingAsk) => set({ numberingAsk }),
}));

/**
 * The document that "Numera a clic" itself produced last. If the document becomes anything else (undo from the top
 * bar, an edit elsewhere) the run ends, so the bar never says something untrue.
 */
export const numberingGuard: { doc: unknown } = { doc: null };

/** Starts a run at `start`. */
export function beginNumbering(start: NumberingState) {
  numberingGuard.doc = useDoc.getState().doc;
  useSetup.getState().setNumbering(start);
  useSetup.getState().setNumberingAsk(false);
}

/** One step of the run: the document goes through the store (one undo step) and the state moves on. */
export function commitNumbering(doc: GranveloDoc, state: NumberingState) {
  numberingGuard.doc = doc;
  useDoc.getState().change(() => doc);
  useSetup.getState().setNumbering(state);
}
