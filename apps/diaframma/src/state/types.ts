/** Diaframma cue list document — saved as `.diaframma` (readable JSON). */

export const FORMAT_ID = "diaframma.cuelist";
export const FORMAT_VERSION = 1;

export type OnSpace = "play" | "fadeIn" | "crossfade" | "stopAllPlay";
export type AtEnd = "stop" | "next" | "fadeOut" | "crossfade" | "loopAll" | "loopCut";
export type OthersOnGo = "pause" | "fadeOut" | "keep" | "stop";

export interface EnvPoint {
  /** Seconds from the start of the file. */
  t: number;
  /** Level 0…1 (1 = track volume). */
  v: number;
}

export interface TrackFile {
  /** Absolute path at the time of saving. */
  path: string;
  /** Path relative to the cue list file (for moving a show folder). */
  relativePath?: string | null;
  name: string;
  durationSec?: number | null;
}

export interface Track {
  id: string;
  hidden: boolean;
  file: TrackFile | null;
  onSpace: OnSpace;
  atEnd: AtEnd;
  ignoreVolume: boolean;
  volumeDb: number;
  eq: { low: number; mid: number; high: number };
  inSec: number;
  outSec: number | null;
  envelope: EnvPoint[];
  loop: { inSec: number; outSec: number } | null;
  loopVisible: boolean;
}

export interface CueListDoc {
  format: typeof FORMAT_ID;
  formatVersion: number;
  app: { name: "Diaframma"; version: string };
  tracks: Track[];
}

export function newTrack(id: string): Track {
  return {
    id,
    hidden: false,
    file: null,
    onSpace: "play",
    atEnd: "stop",
    ignoreVolume: false,
    volumeDb: 0,
    eq: { low: 0, mid: 0, high: 0 },
    inSec: 0,
    outSec: null,
    envelope: [],
    loop: null,
    loopVisible: true,
  };
}

/** Live state pushed by the audio engine (~20 times per second). */
export interface Voice {
  trackId: string;
  positionSec: number;
  durationSec: number;
  paused: boolean;
  fading: "in" | "out" | null;
  looping: boolean;
}

export interface LiveState {
  standbyId: string | null;
  voices: Voice[];
  engine: { ready: boolean; device: string; sampleRate: number; error: string | null };
}

export interface TrackInfo {
  durationSec: number;
  sampleRate: number;
  channels: number;
  /** Peak per bin, 0…1. */
  peaks: number[];
}
