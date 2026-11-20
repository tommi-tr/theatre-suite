import { basename, uid } from "@theatre-suite/core";
import { FORMAT_ID, FORMAT_VERSION, newTrack, type CueListDoc, type Entry, type EnvPoint, type Eq, type Exit, type Track } from "./types";

/**
 * The `.diaframma` file (readable JSON, format 3): reading, writing and the plain track helpers that do not need the
 * audio engine. Shared by Diaframma (which re-exports them from `state/doc.ts`) and by the apps that read its cue
 * lists (Cue).
 */

/** The document as it is written to the file. `appVersion` = the version of Diaframma that writes it. */
export function docToFile(tracks: Track[], appVersion: string): CueListDoc {
  return {
    format: FORMAT_ID,
    formatVersion: FORMAT_VERSION,
    app: { name: "Diaframma", version: appVersion },
    tracks,
  };
}

/**
 * Reads a cue list and returns valid tracks. Only the current format is read:
 * until the suite is published there is no compatibility with older files.
 * Throws a clear message on any other file.
 *
 * Every track keeps the `id` written in the file (its stable id); a track without one, or with the id of a track
 * read before it, gets a new one.
 */
export function parseDoc(text: string): Track[] {
  const raw = JSON.parse(text) as Partial<CueListDoc> & { tracks?: unknown };
  if (!raw || raw.format !== FORMAT_ID) throw new Error("This is not a Diaframma cue list.");
  if (raw.formatVersion !== FORMAT_VERSION) {
    throw new Error(
      typeof raw.formatVersion === "number" && raw.formatVersion > FORMAT_VERSION
        ? "This cue list was made with a newer version of Diaframma. Please update Diaframma."
        : "This cue list was made with a different version of Diaframma and cannot be opened.",
    );
  }
  if (!Array.isArray(raw.tracks)) throw new Error("The cue list is damaged (no tracks).");
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const optSec = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const eqOf = (v: unknown): Eq =>
    Array.isArray(v) ? ([0, 1, 2, 3, 4].map((i) => Math.max(-24, Math.min(24, num(v[i], 0)))) as Eq) : [0, 0, 0, 0, 0];
  const curve = (v: unknown, lo: number, hi: number): EnvPoint[] =>
    Array.isArray(v)
      ? (v as unknown[])
          .map((p) => p as Record<string, unknown>)
          .filter((p) => p && typeof p.t === "number" && typeof p.v === "number")
          .map((p) => ({ t: p.t as number, v: Math.min(hi, Math.max(lo, p.v as number)) }))
          .sort((a, b) => a.t - b.t)
      : [];
  const seen = new Set<string>();
  const rawTracks = raw.tracks as unknown[];

  return rawTracks.map((t0) => {
    const t = (t0 ?? {}) as Record<string, unknown>;
    let id = typeof t.id === "string" && t.id ? t.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const base = newTrack(id);
    const f = t.file as Record<string, unknown> | null | undefined;
    const loop = t.loop as Record<string, unknown> | null | undefined;
    const exits: Exit[] = ["fadeOut", "crossfade", "next"];
    const entry: Entry | null = t.entry === "fadeIn" ? "fadeIn" : null;
    const exit: Exit | null = exits.includes(t.exit as Exit) ? (t.exit as Exit) : null;
    return {
      ...base,
      hidden: t.hidden === true,
      file:
        f && typeof f.path === "string"
          ? {
              path: f.path,
              relativePath: typeof f.relativePath === "string" ? f.relativePath : null,
              name: typeof f.name === "string" ? f.name : basename(f.path),
              durationSec: typeof f.durationSec === "number" ? f.durationSec : null,
            }
          : null,
      entry,
      entrySec: optSec(t.entrySec),
      exit,
      exitSec: optSec(t.exitSec),
      loopOn: t.loopOn === true,
      volumeDb: num(t.volumeDb, 0),
      eq: eqOf(t.eq),
      pan: Math.min(1, Math.max(-1, num(t.pan, 0))),
      inSec: Math.max(0, num(t.inSec, 0)),
      outSec: typeof t.outSec === "number" ? t.outSec : null,
      envelope: curve(t.envelope, 0, 1),
      panEnvelope: curve(t.panEnvelope, -1, 1),
      loop: loop && typeof loop.inSec === "number" && typeof loop.outSec === "number" ? { inSec: loop.inSec, outSec: loop.outSec } : null,
      markers: Array.isArray(t.markers)
        ? [...new Set((t.markers as unknown[]).filter((m): m is number => typeof m === "number" && Number.isFinite(m) && m >= 0).map((m) => Math.round(m * 100) / 100))].sort((a, b) => a - b)
        : [],
      cutVisible: t.cutVisible !== false,
      loopVisible: t.loopVisible !== false,
      envelopeVisible: t.envelopeVisible !== false,
      panVisible: t.panVisible !== false,
      ignoreCut: t.ignoreCut === true,
      ignoreEnvelope: t.ignoreEnvelope === true,
      ignoreLoop: t.ignoreLoop === true,
      ignorePan: t.ignorePan === true,
    };
  });
}

/** Visible (numbered) tracks, in order. `from` is the first number (0 or 1). */
export function numbering(tracks: Track[], from = 1): Map<string, number> {
  const m = new Map<string, number>();
  let n = from;
  for (const t of tracks) if (!t.hidden) m.set(t.id, n++);
  return m;
}

/** Where the track really starts (00:00 when the cut is ignored). */
export function effectiveIn(t: Track): number {
  return t.ignoreCut ? 0 : t.inSec;
}

/** Effective OUT point (null outSec = end of file; the end of the file when the cut is ignored). */
export function effectiveOut(t: Track, dur: number | null): number | null {
  if (t.outSec !== null && !t.ignoreCut) return dur !== null ? Math.min(t.outSec, dur) : t.outSec;
  return dur;
}
