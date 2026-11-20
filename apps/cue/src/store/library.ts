import { create } from "zustand";
import { audioApi } from "../lib/audio";
import { loadLibrary } from "../lib/sources";
import { Library, type SourceLink } from "../model/sources";
import { useDoc } from "./doc";

/**
 * The library of the open show: the memories and tracks of its linked files (`show.sources`), read from disk.
 * It follows the show (a source added, removed or moved, another show opened) and is read again when Cue gets the
 * window focus back, so a file changed meanwhile in Granvelo or Diaframma shows up. Prepara draws its panels
 * from it; Show uses it for the thumbnails, the names and `library.missing(show.gos)`.
 */
interface LibraryStore {
  library: Library;
  /** Reading the files now. */
  loading: boolean;
  /** Increases at every new `library`. */
  rev: number;
  reload: () => Promise<void>;
}

const EMPTY = new Library([]);
let ticket = 0;

export const useLibrary = create<LibraryStore>((set) => ({
  library: EMPTY,
  loading: false,
  rev: 0,
  reload: async () => {
    const my = ++ticket;
    const { show, filePath } = useDoc.getState();
    if (!show || show.sources.length === 0) {
      set((s) => (s.library === EMPTY ? s : { library: EMPTY, loading: false, rev: s.rev + 1 }));
      return;
    }
    set({ loading: true });
    try {
      const library = await loadLibrary(show.sources as SourceLink[], filePath);
      if (my === ticket) set((s) => ({ library, loading: false, rev: s.rev + 1 }));
    } catch (e) {
      console.error("library not loaded", e);
      if (my === ticket) set({ loading: false });
    }
  },
}));

/** Keeps `useLibrary` in step with the open show and the files on disk. Returns the cleanup. */
export function startLibrarySync(): () => void {
  const reload = () => void useLibrary.getState().reload();
  reload();
  const unsub = useDoc.subscribe((s, prev) => {
    if (s.show?.sources !== prev.show?.sources || s.filePath !== prev.filePath || s.loadRev !== prev.loadRev) reload();
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onFocus = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(reload, 250);
  };
  window.addEventListener("focus", onFocus);
  return () => {
    unsub();
    if (timer) clearTimeout(timer);
    window.removeEventListener("focus", onFocus);
  };
}

let lastSync = "";

/** Gives the audio engine the tracks of the show (only when they changed: sources, or a sound's times or level). */
function syncAudio() {
  const gos = useDoc.getState().show?.gos ?? [];
  const tracks = useLibrary.getState().library.audioSync(gos);
  const key = JSON.stringify(tracks);
  if (key === lastSync) return;
  lastSync = key;
  void audioApi()
    .then((a) => a.sync(tracks))
    .catch((e) => console.error("audio sync failed", e));
}

/** Keeps the audio engine's tracks in step with the library and the GOs (call once, at start). */
export function startAudioSync(): () => void {
  syncAudio();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const a = useLibrary.subscribe((s, prev) => {
    if (s.library !== prev.library) syncAudio();
  });
  const b = useDoc.subscribe((s, prev) => {
    if (s.show?.gos === prev.show?.gos) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(syncAudio, 250);
  });
  return () => {
    a();
    b();
    if (timer) clearTimeout(timer);
  };
}
