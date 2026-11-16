import { create } from "zustand";
import { basename, History, uid } from "@theatre-suite/core";
import { api } from "../lib/api";
import { APP_VERSION } from "../lib/version";
import {
  EMPTY_LIVE,
  FORMAT_ID,
  FORMAT_VERSION,
  newTrack,
  type CueListDoc,
  type Entry,
  type EnvPoint,
  type Eq,
  type Exit,
  type LiveState,
  type Track,
  type TrackInfo,
} from "./types";

export const AUDIO_EXTENSIONS = ["wav", "mp3", "flac", "ogg", "oga", "m4a", "aac", "aif", "aiff", "caf", "opus", "wma"];

export function isAudioPath(p: string) {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTENSIONS.includes(ext);
}

function emptyTracks(): Track[] {
  return [newTrack(uid()), newTrack(uid()), newTrack(uid())];
}

export function docToFile(tracks: Track[]): CueListDoc {
  return {
    format: FORMAT_ID,
    formatVersion: FORMAT_VERSION,
    app: { name: "Diaframma", version: APP_VERSION },
    tracks,
  };
}

/**
 * Reads a cue list and returns valid tracks. Only the current format is read:
 * until the suite is published there is no compatibility with older files.
 * Throws a clear message on any other file.
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

export type RowView = "normal" | "compact";

export type InfoState = TrackInfo | "loading" | "error";

interface DocStore {
  tracks: Track[];
  filePath: string | null;
  dirty: boolean;
  /** Missing audio files, by track id. */
  missing: Record<string, boolean>;
  expanded: Record<string, boolean>;
  /** "compact": one short line per track, only the chosen options. */
  view: RowView;
  infos: Record<string, InfoState>;
  live: LiveState;
  locked: boolean;
  history: History<Track[]>;

  setTracks: (fn: (tracks: Track[]) => Track[], opts?: { record?: boolean }) => void;
  patchTrack: (id: string, patch: Partial<Track>, opts?: { record?: boolean }) => void;
  addTrack: () => string;
  addFiles: (paths: string[], intoId?: string) => void;
  loadIntoTrack: (id: string, path: string) => void;
  clearTrack: (id: string) => void;
  deleteTrack: (id: string) => void;
  addMarker: (id: string, sec: number) => void;
  removeMarker: (id: string, index: number) => void;
  duplicateTrack: (id: string) => void;
  toggleHidden: (id: string) => void;
  moveTrack: (from: number, to: number) => void;
  undo: () => void;
  redo: () => void;
  newDoc: () => void;
  replaceDoc: (tracks: Track[], filePath: string | null, dirty: boolean) => void;
  markSaved: (filePath: string) => void;
  toggleExpanded: (id: string) => void;
  setAllExpanded: (open: boolean) => void;
  setView: (v: RowView) => void;
  setLive: (live: LiveState) => void;
  setLocked: (v: boolean) => void;
  ensureInfo: (path: string) => void;
  setMissing: (m: Record<string, boolean>) => void;
}

function trackFromPath(path: string): Partial<Track> {
  return {
    file: { path, name: basename(path), relativePath: null, durationSec: null },
    inSec: 0,
    outSec: null,
    envelope: [],
    panEnvelope: [],
    loop: null,
    markers: [],
    ignoreCut: false,
    ignoreEnvelope: false,
    ignoreLoop: false,
    ignorePan: false,
  };
}

export const useDoc = create<DocStore>((set, get) => {
  const commit = (tracks: Track[], record = true) => {
    const { tracks: prev, history } = get();
    if (record) history.record(prev);
    set({ tracks, dirty: true });
  };
  return {
    tracks: emptyTracks(),
    filePath: null,
    dirty: false,
    missing: {},
    expanded: {},
    view: "normal",
    infos: {},
    live: EMPTY_LIVE,
    locked: false,
    history: new History<Track[]>(),

    setTracks: (fn, opts) => commit(fn(get().tracks), opts?.record !== false),
    patchTrack: (id, patch, opts) =>
      commit(
        get().tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        opts?.record !== false,
      ),
    addTrack: () => {
      const id = uid();
      commit([...get().tracks, newTrack(id)]);
      return id;
    },
    addFiles: (paths, intoId) => {
      const audio = paths.filter(isAudioPath);
      if (!audio.length) return;
      let tracks = [...get().tracks];
      let start = intoId ? tracks.findIndex((t) => t.id === intoId) : -1;
      for (const p of audio) {
        if (start >= 0 && start < tracks.length && !tracks[start].file) {
          tracks[start] = { ...tracks[start], ...trackFromPath(p) };
          start++;
          continue;
        }
        // Fill the first empty slot after the target, else append.
        const empty = tracks.findIndex((t, i) => !t.file && !t.hidden && i >= Math.max(0, start));
        if (empty >= 0) {
          tracks[empty] = { ...tracks[empty], ...trackFromPath(p) };
          start = empty + 1;
        } else {
          const id = uid();
          tracks = [...tracks, { ...newTrack(id), ...trackFromPath(p) }];
          start = tracks.length;
        }
      }
      commit(tracks);
      audio.forEach((p) => get().ensureInfo(p));
    },
    loadIntoTrack: (id, path) => {
      get().patchTrack(id, trackFromPath(path));
      const m = { ...get().missing };
      delete m[id];
      set({ missing: m });
      get().ensureInfo(path);
    },
    clearTrack: (id) => get().patchTrack(id, { file: null, inSec: 0, outSec: null, envelope: [], panEnvelope: [], loop: null, markers: [], ignoreCut: false, ignoreEnvelope: false, ignoreLoop: false, ignorePan: false }),
    deleteTrack: (id) => commit(get().tracks.filter((t) => t.id !== id)),
    addMarker: (id, sec) => {
      const t = get().tracks.find((x) => x.id === id);
      if (!t || !Number.isFinite(sec) || sec < 0) return;
      const m = Math.round(sec * 100) / 100;
      if (t.markers.some((x) => Math.abs(x - m) < 0.05)) return;
      get().patchTrack(id, { markers: [...t.markers, m].sort((a, b) => a - b) });
    },
    removeMarker: (id, index) => {
      const t = get().tracks.find((x) => x.id === id);
      if (!t || index < 0 || index >= t.markers.length) return;
      get().patchTrack(id, { markers: t.markers.filter((_, i) => i !== index) });
    },
    duplicateTrack: (id) => {
      const tracks = [...get().tracks];
      const i = tracks.findIndex((t) => t.id === id);
      if (i < 0) return;
      const src = tracks[i];
      const copy: Track = {
        ...structuredClone(src),
        id: uid(),
        hidden: false,
      };
      tracks.splice(i + 1, 0, copy);
      commit(tracks);
      // The copy opens like the original, so it can be changed at once.
      if (get().expanded[id]) set({ expanded: { ...get().expanded, [copy.id]: true } });
    },
    toggleHidden: (id) => {
      const t = get().tracks.find((x) => x.id === id);
      if (t) get().patchTrack(id, { hidden: !t.hidden });
    },
    moveTrack: (from, to) => {
      const tracks = [...get().tracks];
      if (from < 0 || from >= tracks.length || to < 0 || to >= tracks.length || from === to) return;
      const [t] = tracks.splice(from, 1);
      tracks.splice(to, 0, t);
      commit(tracks);
    },
    undo: () => {
      const prev = get().history.undo(get().tracks);
      if (prev) set({ tracks: prev, dirty: true });
    },
    redo: () => {
      const next = get().history.redo(get().tracks);
      if (next) set({ tracks: next, dirty: true });
    },
    newDoc: () => {
      get().history.clear();
      set({ tracks: emptyTracks(), filePath: null, dirty: false, missing: {}, expanded: {} });
    },
    replaceDoc: (tracks, filePath, dirty) => {
      get().history.clear();
      set({ tracks, filePath, dirty, expanded: {}, missing: {} });
      tracks.forEach((t) => t.file && get().ensureInfo(t.file.path));
    },
    markSaved: (filePath) => set({ filePath, dirty: false }),
    toggleExpanded: (id) => set({ expanded: { ...get().expanded, [id]: !get().expanded[id] }, view: "normal" }),
    setAllExpanded: (open) =>
      set({ expanded: open ? Object.fromEntries(get().tracks.filter((t) => t.file && !t.hidden).map((t) => [t.id, true])) : {}, view: "normal" }),
    setView: (view) => set({ view, expanded: view === "compact" ? {} : get().expanded }),
    setLive: (live) => set({ live }),
    setLocked: (v) => set({ locked: v }),
    ensureInfo: (path) => {
      const cur = get().infos[path];
      if (cur && cur !== "error") return;
      set({ infos: { ...get().infos, [path]: "loading" } });
      api
        .engineAnalyze(path)
        .then((info) => {
          set({ infos: { ...get().infos, [path]: info } });
          // Remember the duration in the document (useful when the file is missing later).
          const tracks = get().tracks;
          if (tracks.some((t) => t.file?.path === path && t.file.durationSec !== info.durationSec)) {
            set({
              tracks: tracks.map((t) => (t.file?.path === path ? { ...t, file: { ...t.file, durationSec: info.durationSec } } : t)),
            });
          }
        })
        .catch(() => set({ infos: { ...get().infos, [path]: "error" } }));
    },
    setMissing: (m) => set({ missing: m }),
  };
});

export function trackDuration(t: Track, infos: Record<string, InfoState>): number | null {
  if (!t.file) return null;
  const info = infos[t.file.path];
  if (info && typeof info === "object") return info.durationSec;
  return t.file.durationSec ?? null;
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

/**
 * Loudness of the part of the track that plays (IN–OUT), in LUFS-like dB,
 * gated like EBU R128 (silence and quiet passages do not count). Null if unknown.
 */
export function trackLoudness(t: Track, info: InfoState | undefined): { lufs: number; peak: number } | null {
  if (!info || typeof info !== "object" || !info.loudness?.length || !info.durationSec) return null;
  const bins = info.loudness.length;
  const dur = info.durationSec;
  const out = effectiveOut(t, dur) ?? dur;
  const a = Math.max(0, Math.floor((effectiveIn(t) / dur) * bins));
  const b = Math.min(bins, Math.max(a + 1, Math.ceil((out / dur) * bins)));
  const ms = info.loudness.slice(a, b);
  const peak = Math.max(...info.peaks.slice(a, b), 1e-6);
  const lk = (x: number) => -0.691 + 10 * Math.log10(Math.max(x, 1e-12));
  // Absolute gate −70, then relative gate −10 below the mean.
  let gated = ms.filter((x) => lk(x) > -70);
  if (!gated.length) return null;
  const mean1 = gated.reduce((s, x) => s + x, 0) / gated.length;
  gated = gated.filter((x) => lk(x) > lk(mean1) - 10);
  if (!gated.length) return null;
  const mean = gated.reduce((s, x) => s + x, 0) / gated.length;
  return { lufs: lk(mean), peak };
}

/**
 * Sets the volume fader of every track so that they all sound equally loud
 * (the median loudness is the target, so faders move as little as possible).
 * A track is never pushed so far that it would clip. Returns how many tracks changed.
 */
export function matchVolumes(): { changed: number; skipped: number } {
  const st = useDoc.getState();
  const items = st.tracks
    .filter((t) => t.file && !t.hidden)
    .map((t) => ({ t, l: trackLoudness(t, st.infos[t.file!.path]) }))
    .filter((x): x is { t: Track; l: { lufs: number; peak: number } } => x.l !== null);
  const skipped = st.tracks.filter((t) => t.file && !t.hidden).length - items.length;
  if (!items.length) return { changed: 0, skipped };
  const sorted = items.map((x) => x.l.lufs).sort((a, b) => a - b);
  const target = sorted[Math.floor(sorted.length / 2)];
  const vols = new Map<string, number>();
  for (const { t, l } of items) {
    let db = target - l.lufs;
    const headroom = -20 * Math.log10(l.peak) - 0.5; // dB until the peak reaches −0.5 dBFS
    db = Math.min(db, headroom, 10);
    db = Math.max(-40, Math.round(db * 2) / 2);
    if (Math.abs(db - t.volumeDb) >= 0.5) vols.set(t.id, db);
  }
  if (vols.size) st.setTracks((tracks) => tracks.map((t) => (vols.has(t.id) ? { ...t, volumeDb: vols.get(t.id)! } : t)));
  return { changed: vols.size, skipped };
}

/** The voice in front: the one GO acts on, else the newest that plays, else the last one (same rule as the transport bar). */
export function frontVoice(live: LiveState) {
  return live.voices.find((v) => v.main) ?? [...live.voices].reverse().find((v) => !v.paused && v.fading !== "out") ?? live.voices[live.voices.length - 1] ?? null;
}
