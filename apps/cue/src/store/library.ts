import { create } from "zustand";
import { Library } from "../model/sources";
import type { Go } from "../model/gos";
import { audioApi } from "../lib/audio";
import { loadLibrary } from "../lib/sources";
import { useDoc } from "./doc";

/**
 * The library of the open show: every source (`show.sources`) read from disk, shared by Prepara (library panel,
 * missing items), the timeline (names, thumbnails, durations) and the Show (playback lookup, DMX payloads). It
 * follows the show: a change of the sources or of the file reloads it; a change of the GOs that touches the sounds
 * (times, level) syncs the audio engine again.
 */
interface LibraryStore {
  library: Library;
  /** A load is running. */
  loading: boolean;
  /** Increases at every load (views can reset). */
  rev: number;
  /** Reads the sources again (after the user linked or fixed one). */
  reload: () => Promise<void>;
}

const EMPTY = new Library([]);
let ticket = 0;

async function load() {
  const { show, filePath } = useDoc.getState();
  const mine = ++ticket;
  if (!show || !show.sources.length) {
    useLibrary.setState((s) => ({ library: EMPTY, loading: false, rev: s.rev + 1 }));
    syncAudio(true);
    return;
  }
  useLibrary.setState({ loading: true });
  const library = await loadLibrary(show.sources, filePath).catch(() => EMPTY);
  if (mine !== ticket) return;
  useLibrary.setState((s) => ({ library, loading: false, rev: s.rev + 1 }));
  syncAudio(true);
}

export const useLibrary = create<LibraryStore>(() => ({ library: EMPTY, loading: false, rev: 0, reload: load }));

let lastSync = "";

/** Gives the audio engine the tracks of the show (only when they changed). */
function syncAudio(force = false) {
  const gos: readonly Go[] = useDoc.getState().show?.gos ?? [];
  const tracks = useLibrary.getState().library.audioSync(gos);
  const key = JSON.stringify(tracks);
  if (!force && key === lastSync) return;
  lastSync = key;
  void audioApi()
    .then((a) => a.sync(tracks))
    .catch((e) => console.error("audio sync failed", e));
}

/** Keeps the library in step with the open show (call once, at start). */
export function startLibrarySync(): () => void {
  void load();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = useDoc.subscribe((s, prev) => {
    if (s.loadRev !== prev.loadRev || s.filePath !== prev.filePath || s.show?.sources !== prev.show?.sources) {
      void load();
      return;
    }
    if (s.show?.gos !== prev.show?.gos) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => syncAudio(), 250);
    }
  });
  return () => {
    stop();
    if (timer) clearTimeout(timer);
  };
}
