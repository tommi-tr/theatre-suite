import { create } from "zustand";
import type { DragPayload } from "./drag";

export type LibTab = "lights" | "audio" | "video";

/** What is chosen in the library panel (kept when the mode changes): the tab, the search, the selected item. */
interface LibraryUi {
  tab: LibTab;
  query: string;
  /** The item selected with a click: `N` places it at the reading point. */
  selected: DragPayload | null;
  setTab: (t: LibTab) => void;
  setQuery: (q: string) => void;
  select: (item: DragPayload | null) => void;
}

export const useLibraryUi = create<LibraryUi>((set) => ({
  tab: "lights",
  query: "",
  selected: null,
  setTab: (tab) => set({ tab, selected: null }),
  setQuery: (query) => set({ query }),
  select: (selected) => set({ selected }),
}));
