import type { OthersOnGo, Track } from "./types";

/**
 * What Diaframma sends to its native audio engine with `engine_sync` (and `player_sync`, `pads_sync`,
 * `selftest_run`): the tracks with their file path already resolved (`TrackParams` on the Rust side) and the
 * general settings (`Config`). Pure: the app decides which path is resolved and which settings apply.
 */

export interface EngineConfig {
  othersOnGo: OthersOnGo;
  autoAdvance: boolean;
  fadeInSec: number;
  fadeOutSec: number;
  crossfadeSec: number;
  /** Quick fade of the track in front when it has no Exit. */
  quickFadeSec?: number;
  stopAllSec: number;
  mainDb?: number;
  numberFrom?: number;
  /** Show behaviour (the track in front leaves by its Exit). Off for the player and the pads. */
  steps?: boolean;
}

/** Track as sent to the engine: path already resolved. */
export type EngineTrack = Omit<Track, "file"> & { path: string | null };

/** The general settings that shape the show behaviour of the engine (Diaframma's Settings → Show). */
export type ShowSettings = Pick<Required<EngineConfig>, "othersOnGo" | "autoAdvance" | "fadeInSec" | "fadeOutSec" | "crossfadeSec" | "quickFadeSec" | "stopAllSec" | "mainDb" | "numberFrom">;

/**
 * The defaults of Diaframma's settings, the same as the engine's own `Config::default()`: what a cue list sounds
 * like when nobody changed the Settings (the times of a track left to "the general time" come from here).
 */
export const DEFAULT_SHOW_SETTINGS: ShowSettings = {
  othersOnGo: "fadeOut",
  autoAdvance: true,
  fadeInSec: 3,
  fadeOutSec: 3,
  crossfadeSec: 4,
  quickFadeSec: 1.5,
  stopAllSec: 1.5,
  mainDb: 0,
  numberFrom: 1,
};

/** The `Config` of the show engine from the settings (show behaviour on: the track in front leaves by its Exit). */
export function showEngineConfig(s: ShowSettings = DEFAULT_SHOW_SETTINGS): EngineConfig {
  return {
    othersOnGo: s.othersOnGo,
    autoAdvance: s.autoAdvance,
    fadeInSec: s.fadeInSec,
    fadeOutSec: s.fadeOutSec,
    crossfadeSec: s.crossfadeSec,
    quickFadeSec: s.quickFadeSec,
    stopAllSec: s.stopAllSec,
    mainDb: s.mainDb,
    numberFrom: s.numberFrom,
    steps: true,
  };
}

/** One track for the engine, with the path to play (null = nothing to play: no file, or the file is missing). */
export function engineTrack(track: Track, path: string | null): EngineTrack {
  const { file: _file, ...rest } = track;
  return { ...rest, path };
}

/** The tracks for the engine: each plays its file's path unless it is marked missing (by track id). */
export function engineTracks(tracks: Track[], missing: Record<string, boolean> = {}): EngineTrack[] {
  return tracks.map(({ file, ...rest }) => ({ ...rest, path: file && !missing[rest.id] ? file.path : null }));
}
