import { create } from "zustand";
import { basename } from "@theatre-suite/core";
import { api, isTauri, onEvent, type EngineConfig, type EngineTrack } from "../lib/api";
import { newTrack, type LiveState } from "./types";
import { useSettings } from "./settings";

/** Diaframma's own player for Rehearsal mode: fully controllable (play, seek, volume, speed, output). */
interface PlayerStore {
  playlist: string[];
  index: number;
  volume: number;
  speed: number;
  device: string | null;
  live: LiveState | null;
  open: (paths: string[]) => void;
  play: (index?: number, fromSec?: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  setSpeed: (v: number) => void;
  setDevice: (name: string | null) => void;
  /** Sends the equalizer of the settings again. */
  refreshEq: () => void;
  close: () => void;
}

const CONFIG: EngineConfig = { othersOnGo: "stop", autoAdvance: false, fadeInSec: 0, fadeOutSec: 0, crossfadeSec: 0, stopAllSec: 0.05, steps: false };

function trackFor(path: string, index: number, inSec: number, volume: number): EngineTrack {
  const db = volume <= 0.001 ? -60 : 20 * Math.log10(volume);
  const { file: _f, ...rest } = newTrack(`player-${index}`);
  return { ...rest, path, inSec, volumeDb: db, atEnd: "stop", eq: [...useSettings.getState().settings.rhEq] };
}

export const usePlayer = create<PlayerStore>((set, get) => {
  const sync = (inSec = 0) => {
    const { playlist, index, volume } = get();
    const path = playlist[index];
    if (!path) return Promise.resolve();
    return api.playerSync([trackFor(path, index, inSec, volume)], CONFIG);
  };
  return {
    playlist: [],
    index: 0,
    volume: 1,
    speed: 1,
    device: null,
    live: null,
    open: (paths) => {
      if (!paths.length) return;
      set({ playlist: paths, index: 0 });
      // The player's output opens only now; wait until it is ready, then play.
      (async () => {
        await api.playerSetDevice(get().device).catch(() => {});
        for (let i = 0; i < 40; i++) {
          const st = await api.playerState().catch(() => null);
          if (st?.engine.ready) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        get().play(0);
      })();
    },
    play: (index, fromSec = 0) => {
      const i = index ?? get().index;
      if (i < 0 || i >= get().playlist.length) return;
      set({ index: i });
      sync(fromSec)
        .then(() => api.playerPlay(`player-${i}`))
        .catch((e) => console.error(e));
    },
    toggle: () => {
      const { live, index } = get();
      const v = live?.voices.find((x) => x.trackId === `player-${index}`);
      if (v) api.playerPause(v.trackId).catch(() => {});
      else get().play();
    },
    next: () => get().index + 1 < get().playlist.length && get().play(get().index + 1),
    prev: () => {
      const v = get().live?.voices[0];
      if (v && v.positionSec > 3) get().play(get().index, 0);
      else if (get().index > 0) get().play(get().index - 1);
      else get().play(0);
    },
    seek: (sec) => get().play(get().index, Math.max(0, sec)),
    setVolume: (v) => {
      set({ volume: v });
      sync(get().live?.voices[0]?.positionSec ?? 0).catch(() => {});
    },
    setSpeed: (v) => {
      set({ speed: v });
      api.playerSetSpeed(v).catch(() => {});
    },
    setDevice: (name) => {
      set({ device: name });
      api.playerSetDevice(name).catch(() => {});
    },
    refreshEq: () => {
      if (get().playlist.length) sync(get().live?.voices[0]?.positionSec ?? 0).catch(() => {});
    },
    close: () => {
      api.playerStop().catch(() => {});
      set({ playlist: [], index: 0 });
    },
  };
});

export function currentName(): string {
  const { playlist, index } = usePlayer.getState();
  return playlist[index] ? basename(playlist[index]) : "";
}

let started = false;
export function startPlayerEvents() {
  if (started || !isTauri) return;
  started = true;
  onEvent<LiveState>("player-state", (live) => usePlayer.setState({ live }));
}
