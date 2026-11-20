import { DEFAULT_SHOW_SETTINGS, type ShowSettings } from "./engine";
import { effectiveIn, effectiveOut, numbering, parseDoc } from "./file";
import type { Entry, Exit, Track } from "./types";

/**
 * A cue list seen from outside Diaframma (Cue's audio library): one plain summary per track, in cue list order.
 * Nothing here touches the disk: paths are only computed (the app checks which one exists).
 */

/** How a track starts in the show. */
export type TrackStart =
  /** With a GO. */
  | "go"
  /** By itself when the track before it ends (that track has Exit "Next"). */
  | "afterPrevious"
  /** By itself, fading in while the track before it fades out (that track has Exit "Crossfade"). */
  | "crossfadeFromPrevious";

export interface TrackSummary {
  /** Stable id of the track (kept in the file; never recomputed by moving or renumbering). */
  id: string;
  /** Number shown in Diaframma (hidden tracks have none). */
  number: number | null;
  hidden: boolean;
  /** File name ("" for an empty row). */
  name: string;
  /** Has an audio file (an empty row has none). */
  hasFile: boolean;
  /** Absolute path as saved. */
  path: string | null;
  /** Path relative to the cue list as saved (`/` separators), if any. */
  relativePath: string | null;
  /**
   * Where to look for the file, in Diaframma's order: the saved absolute path, then the relative path resolved
   * against the folder of the cue list (when the document path is known).
   */
  candidates: string[];
  /** Length of the file in seconds, when the file stores it (often unknown: the engine measures it). */
  durationSec: number | null;
  /** Where it starts and stops in the file (the cut; OUT null = end of the file). */
  inSec: number;
  outSec: number | null;
  /** Seconds that play from IN to OUT, when known. */
  playSec: number | null;
  volumeDb: number;
  pan: number;
  loop: boolean;
  entry: Entry | null;
  /** Fade in seconds (0 without an Entry); the general time of the settings when the track has none of its own. */
  fadeInSec: number;
  exit: Exit | null;
  /** Fade out / crossfade seconds for an Exit "fadeOut" or "crossfade" (general time when unset); 0 otherwise. */
  exitSec: number;
  start: TrackStart;
}

/** `relative` (as Diaframma saves it, `/` or `\` separators) resolved against the folder of the file `docPath`. */
export function resolveRelativePath(docPath: string, relative: string): string | null {
  if (!docPath || !relative) return null;
  const sep = docPath.includes("\\") ? "\\" : "/";
  const parts = docPath.split(/[\\/]/);
  parts.pop();
  if (!parts.length) return null;
  // Parts that make the root and cannot be climbed over: "" (POSIX "/"), "C:", or "", "", server, share (UNC).
  const rootLen = parts[0] === "" && parts[1] === "" && parts.length >= 4 ? 4 : 1;
  for (const seg of relative.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > rootLen) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.length === 1 && parts[0] === "" ? sep : parts.join(sep);
}

/** Where to look for a track's file, in Diaframma's order (absolute path first, then the relative one). */
export function trackPathCandidates(track: Pick<Track, "file">, docPath?: string | null): string[] {
  const f = track.file;
  if (!f) return [];
  const out = [f.path];
  const rel = docPath && f.relativePath ? resolveRelativePath(docPath, f.relativePath) : null;
  if (rel && rel !== f.path) out.push(rel);
  return out;
}

/** A track can be played by the show engine: shown and with a file. */
const playable = (t: Track) => !t.hidden && !!t.file;

/** One summary per track, in cue list order. `settings` = the general times (Diaframma's defaults if not given). */
export function listTracks(tracks: Track[], opts: { docPath?: string | null; settings?: ShowSettings } = {}): TrackSummary[] {
  const s = opts.settings ?? DEFAULT_SHOW_SETTINGS;
  const numbers = numbering(tracks, s.numberFrom);
  let previous: Track | null = null;
  return tracks.map((t) => {
    const dur = t.file?.durationSec ?? null;
    const out = effectiveOut(t, dur);
    const inSec = effectiveIn(t);
    let start: TrackStart = "go";
    if (playable(t) && previous && !previous.loopOn) {
      if (previous.exit === "next") start = "afterPrevious";
      else if (previous.exit === "crossfade") start = "crossfadeFromPrevious";
    }
    if (playable(t)) previous = t;
    const exitSec = t.exit === "fadeOut" || t.exit === "crossfade" ? Math.max(0, t.exitSec ?? (t.exit === "crossfade" ? s.crossfadeSec : s.fadeOutSec)) : 0;
    return {
      id: t.id,
      number: numbers.get(t.id) ?? null,
      hidden: t.hidden,
      name: t.file?.name ?? "",
      hasFile: !!t.file,
      path: t.file?.path ?? null,
      relativePath: t.file?.relativePath ?? null,
      candidates: trackPathCandidates(t, opts.docPath),
      durationSec: dur,
      inSec,
      outSec: t.ignoreCut ? null : t.outSec,
      playSec: out !== null ? Math.max(0, out - inSec) : null,
      volumeDb: t.volumeDb,
      pan: t.pan,
      loop: t.loopOn,
      entry: t.entry,
      fadeInSec: t.entry === "fadeIn" ? Math.max(0, t.entrySec ?? s.fadeInSec) : 0,
      exit: t.exit,
      exitSec,
      start,
    };
  });
}

/** Reads the text of a `.diaframma` file (format 3 only, see `parseDoc`) and lists its tracks. */
export function readCueList(text: string, opts: { docPath?: string | null; settings?: ShowSettings } = {}): { tracks: Track[]; summaries: TrackSummary[] } {
  const tracks = parseDoc(text);
  return { tracks, summaries: listTracks(tracks, opts) };
}
