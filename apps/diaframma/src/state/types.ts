/** Diaframma cue list document — saved as `.diaframma` (readable JSON). */

export const FORMAT_ID = "diaframma.cuelist";
/**
 * Current format: one attention track; optional Entry / Exit per track; Loop is a switch;
 * five-band EQ; pan (fader and curve); every group of the editor can be ignored or hidden.
 * Until the suite is published, only this version is read (no migrations from older ones).
 */
export const FORMAT_VERSION = 3;

/** What the track does when GO starts it (optional). */
export type Entry = "fadeIn";
/** How the track leaves, at GO or at its end (optional). */
export type Exit = "fadeOut" | "crossfade" | "next";
/** What happens to a track that plays and has no Exit when GO is pressed. */
export type OthersOnGo = "fadeOut" | "keep" | "stop";

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
  /** Entrata: null = plain start. */
  entry: Entry | null;
  /** Length of the fade in; null = the general time of the Settings. */
  entrySec: number | null;
  /** Uscita: null = the general setting at GO, stop at the end. */
  exit: Exit | null;
  /** Length of the fade out / crossfade; null = the general time. */
  exitSec: number | null;
  /** Repeats until GO: between the loop points if there are any, else the whole track. */
  loopOn: boolean;
  volumeDb: number;
  eq: Eq;
  /** Balance, -1 (left) … +1 (right). */
  pan: number;
  inSec: number;
  outSec: number | null;
  envelope: EnvPoint[];
  /** Pan over time; `v` is -1…+1. */
  panEnvelope: EnvPoint[];
  loop: { inSec: number; outSec: number } | null;
  /** Markers (seconds from the start of the file): they help to line up IN, OUT, loop points and curve points. */
  markers: number[];
  /** Shown or hidden in the editor, per group (they keep working when hidden). */
  cutVisible: boolean;
  loopVisible: boolean;
  envelopeVisible: boolean;
  panVisible: boolean;
  /** Bypassed but kept: the track plays from 00:00 to the end of the file. */
  ignoreCut: boolean;
  ignoreEnvelope: boolean;
  /** The loop covers the whole track instead of the loop points. */
  ignoreLoop: boolean;
  /** The pan curve is bypassed: the pan fader alone decides. */
  ignorePan: boolean;
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
    entry: null,
    entrySec: null,
    exit: null,
    exitSec: null,
    loopOn: false,
    volumeDb: 0,
    eq: [...FLAT_EQ],
    pan: 0,
    inSec: 0,
    outSec: null,
    envelope: [],
    panEnvelope: [],
    loop: null,
    markers: [],
    cutVisible: true,
    loopVisible: true,
    envelopeVisible: true,
    panVisible: true,
    ignoreCut: false,
    ignoreEnvelope: false,
    ignoreLoop: false,
    ignorePan: false,
  };
}

/** Live state pushed by the audio engine (~20 times per second). */
export interface Voice {
  trackId: string;
  positionSec: number;
  durationSec: number;
  paused: boolean;
  fading: "in" | "out" | null;
  /** The track has Loop on. */
  looping: boolean;
  /** Repeating the loop now. */
  inLoop: boolean;
  /** The track in front: the one whose Exit applies at GO. */
  main: boolean;
}

export interface LiveState {
  standbyId: string | null;
  mainId: string | null;
  /** The attention track will start by itself (the track in front ends with Next / Crossfade). */
  autoStart: boolean;
  pausedAll: boolean;
  voices: Voice[];
  engine: { ready: boolean; device: string; sampleRate: number; error: string | null };
}

export const EMPTY_LIVE: LiveState = {
  standbyId: null,
  mainId: null,
  autoStart: false,
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
