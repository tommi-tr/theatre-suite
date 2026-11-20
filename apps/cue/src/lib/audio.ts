import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EngineConfig, EngineTrack, LiveState } from "@theatre-suite/show-files/diaframma";
import { isTauri } from "./api";

export type { LiveState, Voice } from "@theatre-suite/show-files/diaframma";

/**
 * Cue's sound output, typed. Two implementations of the same `AudioApi`:
 * - `tauriAudio`: Cue's native engine (src-tauri/src/audio.rs over `crates/audio-engine`; event `cue-audio-state`);
 * - `createSimAudio()` (audioSim.ts): a browser stand-in used outside Tauri and always in `/?demo`, with one output
 *   "Uscita simulata" and voices that advance with the clock, so the screens show sound playing.
 *
 * Tracks are synced per source (one `.diaframma` file each, ids as in the file); the engine knows them as
 * `"<sourceId>:<trackId>"` (`engineId`), which is what the live state's `voices[].trackId` carry. A sound of a GO with
 * its own times or level plays a copy `trackId#actionId` (see `audioEngineTrackId` in model/gos.ts).
 */

/** The tracks of one Diaframma source (`Library.audioSync`). `playSec` is used by the simulator only. */
export interface SyncSource {
  sourceId: string;
  tracks: (EngineTrack & { playSec?: number | null })[];
}

type Unlisten = () => void;

export interface AudioApi {
  readonly simulated: boolean;
  /** Names of the outputs of this computer. */
  listDevices(): Promise<string[]>;
  /** Output by name; null = the system default. */
  setDevice(name: string | null): Promise<void>;
  /** The full list of tracks Cue may play (replaces the previous one). */
  sync(sources: SyncSource[], config?: Partial<EngineConfig>): Promise<void>;
  /** Plays a track now (rejects when the output is not available). */
  playNow(sourceId: string, trackId: string): Promise<void>;
  /** Fades one track out (`fadeSec` null = at once, without a click). */
  stopTrack(sourceId: string, trackId: string, fadeSec: number | null): Promise<void>;
  /** Every sound out: at once, or with the general stop fade. */
  stopAll(immediate: boolean): Promise<void>;
  /** Pause all / resume all. */
  setPaused(paused: boolean): Promise<void>;
  state(): Promise<LiveState>;
  onState(fn: (s: LiveState) => void): Unlisten;
}

/** The engine's id of a track of a source. */
export const engineId = (sourceId: string, trackId: string): string => `${sourceId}:${trackId}`;

/** Source and track (with its `#actionId` copy suffix, if any) of an engine id; null without a source prefix. */
export function splitEngineId(id: string): { sourceId: string; trackId: string; baseTrackId: string } | null {
  const i = id.indexOf(":");
  if (i < 0) return null;
  const trackId = id.slice(i + 1);
  return { sourceId: id.slice(0, i), trackId, baseTrackId: trackId.split("#")[0] };
}

/** Cue's engine configuration (also the native default): GO leaves the other tracks alone, nothing advances by itself. */
export const CUE_AUDIO_CONFIG: Partial<EngineConfig> = { othersOnGo: "keep", autoAdvance: false, steps: false };

const fullConfig = (c?: Partial<EngineConfig>): EngineConfig => ({ othersOnGo: "keep", autoAdvance: false, fadeInSec: 3, fadeOutSec: 3, crossfadeSec: 4, stopAllSec: 1.5, quickFadeSec: 1.5, steps: false, ...c });

/** The native engine of Cue. */
export const tauriAudio: AudioApi = {
  simulated: false,
  listDevices: () => invoke<string[]>("audio_list_devices"),
  setDevice: (name) => invoke("audio_set_device", { name }),
  sync: (sources, config) => invoke("audio_sync", { sources: sources.map((s) => ({ sourceId: s.sourceId, tracks: s.tracks.map(({ playSec: _p, ...t }) => t) })), config: config ? fullConfig(config) : null }),
  playNow: (sourceId, trackId) => invoke("audio_play_now", { sourceId, trackId }),
  stopTrack: (sourceId, trackId, fadeSec) => invoke("audio_stop_track", { sourceId, trackId, fadeSec: fadeSec !== null && Number.isFinite(fadeSec) ? Math.max(0, fadeSec) : null }),
  stopAll: (immediate) => invoke("audio_stop_all", { immediate }),
  setPaused: (paused) => invoke("audio_set_paused", { paused }),
  state: () => invoke<LiveState>("audio_state"),
  onState: (fn) => {
    let stop: Unlisten | null = null;
    let gone = false;
    void listen<LiveState>("cue-audio-state", (e) => fn(e.payload)).then((u) => {
      if (gone) u();
      else stop = u;
    });
    return () => {
      gone = true;
      stop?.();
    };
  },
};

const isDemoUrl = () => typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");

let chosen: Promise<AudioApi> | null = null;

/** The engine to use: native in the app, the simulator in the browser and in `/?demo`. */
export function audioApi(): Promise<AudioApi> {
  if (!chosen)
    chosen = (async () => {
      if (isTauri && !isDemoUrl()) return tauriAudio;
      const { createSimAudio } = await import("./audioSim");
      const sim = createSimAudio();
      if (typeof window !== "undefined") (window as unknown as { __cueAudio?: unknown }).__cueAudio = sim;
      return sim;
    })();
  return chosen;
}
