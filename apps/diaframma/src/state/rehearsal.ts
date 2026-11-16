import { create } from "zustand";
import { api, type RhSource } from "../lib/api";
import { useSettings } from "./settings";
import { usePlayer } from "./player";

/**
 * Volume of each Rehearsal source as the user sets it (0…1). What reaches
 * Windows is level × main volume, so the main fader moves everything together.
 */
interface RhStore {
  levels: Record<string, number>;
  setLevel: (src: RhSource, level: number) => void;
  /** First time a source is seen: its level is what Windows has now. */
  adopt: (sources: RhSource[]) => void;
  /** Sends every level again (after the main volume moved). */
  resend: (sources: RhSource[]) => void;
}

const tabId = (id: string) => (id.startsWith("tab:") ? Number(id.slice(4)) : null);

function send(src: RhSource, level: number) {
  const v = Math.max(0, Math.min(1, level * useSettings.getState().settings.rhMain));
  if (src.id === "internal") usePlayer.getState().setVolume(v);
  else if (tabId(src.id) !== null) api.extCommand(tabId(src.id)!, "volume", v).catch(() => {});
  else api.rhSetVolume([src.id], v).catch(() => {});
}

export const useRh = create<RhStore>((set, get) => ({
  levels: {},
  setLevel: (src, level) => {
    const l = Math.max(0, Math.min(1, level));
    set({ levels: { ...get().levels, [src.id]: l } });
    send(src, l);
  },
  adopt: (sources) => {
    const main = useSettings.getState().settings.rhMain;
    let changed = false;
    const levels = { ...get().levels };
    for (const s of sources) {
      if (s.volume === null || levels[s.id] !== undefined) continue;
      levels[s.id] = main > 0.001 ? Math.min(1, s.volume / main) : s.volume;
      changed = true;
    }
    if (changed) set({ levels });
  },
  resend: (sources) => {
    const levels = get().levels;
    for (const s of sources) if (s.volume !== null && levels[s.id] !== undefined) send(s, levels[s.id]);
  },
}));
