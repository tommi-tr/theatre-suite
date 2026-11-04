import { create } from "zustand";
import { basename, History, uid } from "@theatre-suite/core";
import { api } from "../lib/api";
import { APP_VERSION } from "../lib/version";
import {
  FORMAT_ID,
  FORMAT_VERSION,
  newTrack,
  type AtEnd,
  type CueListDoc,
  type LiveState,
  type OnSpace,
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

/** Reads any known version of the file format and returns valid tracks. Throws on unknown files. */
export function parseDoc(text: string): Track[] {
  const raw = JSON.parse(text) as Partial<CueListDoc> & { tracks?: unknown };
  if (!raw || raw.format !== FORMAT_ID) throw new Error("This is not a Diaframma cue list.");
  if (typeof raw.formatVersion !== "number" || raw.formatVersion > FORMAT_VERSION) {
    throw new Error("This cue list was made with a newer version of Diaframma. Please update Diaframma.");
  }
  if (!Array.isArray(raw.tracks)) throw new Error("The cue list is damaged (no tracks).");
  const onSpace: OnSpace[] = ["play", "fadeIn", "crossfade", "stopAllPlay"];
  const atEnd: AtEnd[] = ["stop", "next", "fadeOut", "crossfade", "loopAll", "loopCut"];
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const seen = new Set<string>();
  return (raw.tracks as unknown[]).map((t0) => {
    const t = (t0 ?? {}) as Record<string, unknown>;
    let id = typeof t.id === "string" && t.id ? t.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const base = newTrack(id);
    const f = t.file as Record<string, unknown> | null | undefined;
    const eq = (t.eq ?? {}) as Record<string, unknown>;
    const loop = t.loop as Record<string, unknown> | null | undefined;
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
      onSpace: onSpace.includes(t.onSpace as OnSpace) ? (t.onSpace as OnSpace) : "play",
      atEnd: atEnd.includes(t.atEnd as AtEnd) ? (t.atEnd as AtEnd) : "stop",
      ignoreVolume: t.ignoreVolume === true,
      volumeDb: num(t.volumeDb, 0),
      eq: { low: num(eq.low, 0), mid: num(eq.mid, 0), high: num(eq.high, 0) },
      inSec: Math.max(0, num(t.inSec, 0)),
      outSec: typeof t.outSec === "number" ? t.outSec : null,
      envelope: Array.isArray(t.envelope)
        ? (t.envelope as unknown[])
            .map((p) => p as Record<string, unknown>)
            .filter((p) => typeof p.t === "number" && typeof p.v === "number")
            .map((p) => ({ t: p.t as number, v: Math.min(1, Math.max(0, p.v as number)) }))
            .sort((a, b) => a.t - b.t)
        : [],
      loop: loop && typeof loop.inSec === "number" && typeof loop.outSec === "number" ? { inSec: loop.inSec, outSec: loop.outSec } : null,
      loopVisible: t.loopVisible !== false,
    };
  });
}

/** Visible (numbered) tracks, in order. */
export function numbering(tracks: Track[]): Map<string, number> {
  const m = new Map<string, number>();
  let n = 0;
  for (const t of tracks) if (!t.hidden) m.set(t.id, ++n);
  return m;
}

export type InfoState = TrackInfo | "loading" | "error";

interface DocStore {
  tracks: Track[];
  filePath: string | null;
  dirty: boolean;
  /** Missing audio files, by track id. */
  missing: Record<string, boolean>;
  expanded: Record<string, boolean>;
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
  toggleHidden: (id: string) => void;
  moveTrack: (from: number, to: number) => void;
  undo: () => void;
  redo: () => void;
  newDoc: () => void;
  replaceDoc: (tracks: Track[], filePath: string | null, dirty: boolean) => void;
  markSaved: (filePath: string) => void;
  toggleExpanded: (id: string) => void;
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
    loop: null,
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
    infos: {},
    live: { standbyId: null, voices: [], engine: { ready: false, device: "", sampleRate: 0, error: null } },
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
    clearTrack: (id) => get().patchTrack(id, { file: null, inSec: 0, outSec: null, envelope: [], loop: null }),
    deleteTrack: (id) => commit(get().tracks.filter((t) => t.id !== id)),
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
    toggleExpanded: (id) => set({ expanded: { ...get().expanded, [id]: !get().expanded[id] } }),
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

/** Effective OUT point (null outSec = end of file). */
export function effectiveOut(t: Track, dur: number | null): number | null {
  if (t.outSec !== null) return dur !== null ? Math.min(t.outSec, dur) : t.outSec;
  return dur;
}
