/** Diaframma cue list document — saved as `.diaframma` (readable JSON). */

export const FORMAT_ID = "diaframma.cuelist";
/**
 * 1: first version.
 * 2: five-band EQ (array), crossfade moved from "On Space" to "At end or Space".
 */
export const FORMAT_VERSION = 2;

/** How the track starts when GO plays it. */
export type OnSpace = "play" | "fadeIn" | "stopAllPlay";
/** What happens to the track at its end, or at GO while it plays. */
export type AtEnd = "stop" | "next" | "fadeOut" | "crossfade" | "loopAll" | "loopCut";
export type OthersOnGo = "pause" | "fadeOut" | "keep" | "stop";

/** Bands of the equalizer (Hz). 60 Hz and 14 kHz are shelves. */
export const EQ_BANDS = [60, 230, 910, 4000, 14000] as const;
export type Eq = [number, number, number, number, number];
export const FLAT_EQ: Eq = [0, 0, 0, 0, 0];

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
  eq: Eq;
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
    eq: [...FLAT_EQ],
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
  /** At end is Loop all / Loop cut. */
  looping: boolean;
  /** Repeating the loop now. */
  inLoop: boolean;
  /** The track GO acts on ("in front"). */
  main: boolean;
}

export type PendingStep = "stop" | "fadeOut" | "loopAll" | "loopCut";

export interface LiveState {
  standbyId: string | null;
  mainId: string | null;
  /** The next GO first does this to the main track. */
  pending: PendingStep | null;
  pausedAll: boolean;
  voices: Voice[];
  engine: { ready: boolean; device: string; sampleRate: number; error: string | null };
}

export const EMPTY_LIVE: LiveState = {
  standbyId: null,
  mainId: null,
  pending: null,
  pausedAll: false,
  voices: [],
  engine: { ready: false, device: "", sampleRate: 0, error: null },
};

export interface TrackInfo {
  durationSec: number;
  sampleRate: number;
  channels: number;
  /** Peak per bin, 0…1. */
  peaks: number[];
  /** K-weighted mean square per bin (loudness). */
  loudness?: number[];
}
