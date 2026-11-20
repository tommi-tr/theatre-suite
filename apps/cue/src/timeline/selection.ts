import { create } from "zustand";
import { useDoc } from "../store/doc";

/**
 * The GO selected in Prepara (selection ring on its button, the "GO selezionato" panel on the right). Shared by the
 * timeline (which sets it on a click) and the panel of the selected GO. Forgotten when another show is opened or the
 * GO is deleted.
 */
interface GoSelection {
  selectedGoId: string | null;
  select: (id: string | null) => void;
}

export const useGoSelection = create<GoSelection>((set) => ({
  selectedGoId: null,
  select: (selectedGoId) => set({ selectedGoId }),
}));

useDoc.subscribe((s, prev) => {
  const sel = useGoSelection.getState().selectedGoId;
  if (!sel) return;
  if (s.loadRev !== prev.loadRev || (s.show?.gos !== prev.show?.gos && !s.show?.gos.some((g) => g.id === sel))) useGoSelection.getState().select(null);
});
