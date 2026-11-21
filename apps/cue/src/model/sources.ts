import {
  emergencyValues,
  fadePayload,
  GranveloFileError,
  memoryById,
  memoryTarget,
  memoryThumbnail,
  patchValues,
  readShow,
  type FadePayload,
  type GranveloDoc,
  type MemoryThumbnail,
} from "@theatre-suite/show-files/granvelo";
import { DEFAULT_SHOW_SETTINGS, readCueList, type EngineTrack, type Exit, type Track, type TrackStart } from "@theatre-suite/show-files/diaframma";
import { audioEngineTrackId, itemActions, type AudioAction, type Go, type ItemRef } from "./gos";
import type { LightTimes, PlaybackLookup } from "./playback";

/**
 * Sources: the files of Granvelo (`.granvelo`) and Diaframma (`.diaframma`) a show takes its memories and tracks
 * from (13_cue.md, "Il file .tcue": tracks and memories stay in their files). Pure: the text of each file comes in
 * from lib/sources.ts; files are parsed with `@theatre-suite/show-files`, the same code Granvelo and Diaframma use.
 *
 * - A **link** is `{ id, app, path, docId?, name?, sha256? }`: `path` relative to the `.tcue` (`/` separators; an
 *   absolute path when on another drive), `docId` the Granvelo document id (a Diaframma cue list has none), `name`
 *   what the library shows, `sha256` the fingerprint at the last load (to say "changed since").
 * - Loading gives a **status** per source (ok · missing · unreadable · wrongFormat · newer · otherDocument ·
 *   unsupported) and the **library items** with stable keys `{ sourceId, itemId }`.
 * - A `Library` answers playback (`PlaybackLookup`), builds the DMX payloads (memory, dark, emergency) and the audio
 *   engine's track list (`audioSync`).
 */

export type SourceApp = "granvelo" | "diaframma" | "bardo";

export interface SourceLink {
  id: string;
  app: SourceApp;
  /** Relative to the `.tcue` file (`/`), or absolute. */
  path: string;
  docId?: string;
  name?: string;
  /** SHA-256 of the file when it was last loaded (optional). */
  sha256?: string;
}

export type SourceState = "ok" | "missing" | "unreadable" | "wrongFormat" | "newer" | "otherDocument" | "unsupported";

export interface SourceStatus {
  state: SourceState;
  /** For developers (English). */
  detail?: string;
  /** The file is not the one of the last load (fingerprint differs): GOs may point to changed items. */
  changed?: boolean;
}

/** A Granvelo memory in Cue's lights library. */
export interface LightItem {
  key: ItemRef;
  id: string;
  number: number;
  name: string;
  note: string;
  times: LightTimes;
  /** Delay + the longer fade. */
  durationSec: number;
  /** "Parte da sola": the next memory starts by itself after this one. */
  autoFollow: boolean;
  /** Starts by itself (the memory before it has "parte da sola"): a GO made from it is `auto`. */
  startsByItself: boolean;
  /** Place in Granvelo's sequence (null = not in it). */
  sequenceIndex: number | null;
  emergency: boolean;
  litCount: number;
  thumbnail: MemoryThumbnail;
}

/** A Diaframma track in Cue's audio library. */
export interface AudioItem {
  key: ItemRef;
  id: string;
  number: number | null;
  name: string;
  hidden: boolean;
  hasFile: boolean;
  /** The audio file to play (null = none found); `candidates` = where it was looked for. */
  path: string | null;
  candidates: string[];
  durationSec: number | null;
  /** Seconds that play (IN to OUT), when known. */
  playSec: number | null;
  fadeInSec: number;
  exit: Exit | null;
  exitSec: number;
  loop: boolean;
  volumeDb: number;
  start: TrackStart;
  /** Starts by itself (the track before it has Exit Next / Crossfade): a GO made from it is `auto`. */
  startsByItself: boolean;
}

export interface LoadedSource {
  link: SourceLink;
  status: SourceStatus;
  /** Absolute path of the file (null when it cannot be resolved: a relative path in an unsaved show). */
  absPath: string | null;
  sha256: string | null;
  /** Title of the Granvelo show / file name of the cue list. */
  title: string;
  granvelo: GranveloDoc | null;
  tracks: Track[] | null;
  lights: LightItem[];
  audio: AudioItem[];
}

/** The app of a file, from its extension (null = not a source Cue reads). */
export function appForPath(path: string): SourceApp | null {
  const p = path.toLowerCase();
  if (p.endsWith(".granvelo")) return "granvelo";
  if (p.endsWith(".diaframma")) return "diaframma";
  return null;
}

/** The file name without folder and extension ("Luci" for `…/Luci.granvelo`). */
export function baseName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** A source that could not be read. */
export function failedSource(link: SourceLink, state: Exclude<SourceState, "ok" | "otherDocument">, opts: { absPath?: string | null; detail?: string } = {}): LoadedSource {
  return { link, status: { state, detail: opts.detail }, absPath: opts.absPath ?? null, sha256: null, title: link.name ?? baseName(link.path), granvelo: null, tracks: null, lights: [], audio: [] };
}

export interface ParseOptions {
  absPath?: string | null;
  sha256?: string | null;
  /** Which candidate path of a track's audio file to play (default: the first; lib checks which exists). */
  trackPath?: (candidates: string[]) => string | null;
}

/** Reads the text of a source file into its library items. Never throws: problems become the status. */
export function parseSource(link: SourceLink, text: string, opts: ParseOptions = {}): LoadedSource {
  const absPath = opts.absPath ?? null;
  const sha256 = opts.sha256 ?? null;
  const changed = !!(link.sha256 && sha256 && link.sha256 !== sha256);
  if (link.app === "granvelo") {
    let doc: GranveloDoc;
    let memories: ReturnType<typeof readShow>["memories"];
    try {
      ({ doc, memories } = readShow(text));
    } catch (e) {
      if (e instanceof GranveloFileError) {
        const state = e.problem === "newer" ? "newer" : e.problem === "not-json" || e.problem === "not-granvelo" ? "wrongFormat" : "unreadable";
        return failedSource(link, state, { absPath, detail: e.message });
      }
      return failedSource(link, "unreadable", { absPath, detail: String(e) });
    }
    const lights: LightItem[] = memories.map((m) => {
      const mem = memoryById(doc, m.id);
      return {
        key: { sourceId: link.id, itemId: m.id },
        id: m.id,
        number: m.number,
        name: m.label,
        note: m.note,
        times: { fadeIn: m.transition.fadeIn, fadeOut: m.transition.fadeOut, delay: m.transition.delay, moveInDark: m.transition.moveInDark },
        durationSec: m.durationSec,
        autoFollow: m.autoFollow,
        startsByItself: m.startsByItself,
        sequenceIndex: m.sequenceIndex,
        emergency: m.emergency,
        litCount: m.litCount,
        thumbnail: memoryThumbnail(doc, mem ?? { state: { binding: "address", dmx: [] }, scenery: [] }),
      };
    });
    const other = !!link.docId && link.docId !== doc.id;
    return {
      link,
      status: { state: other ? "otherDocument" : "ok", changed: changed || undefined },
      absPath,
      sha256,
      title: doc.title || link.name || baseName(link.path),
      granvelo: doc,
      tracks: null,
      lights,
      audio: [],
    };
  }
  if (link.app === "diaframma") {
    let tracks: Track[];
    let summaries: ReturnType<typeof readCueList>["summaries"];
    try {
      ({ tracks, summaries } = readCueList(text, { docPath: absPath, settings: DEFAULT_SHOW_SETTINGS }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const state = /newer version/i.test(msg) ? "newer" : e instanceof SyntaxError || /not a Diaframma/i.test(msg) ? "wrongFormat" : "unreadable";
      return failedSource(link, state, { absPath, detail: msg });
    }
    const pick = opts.trackPath ?? ((c: string[]) => c[0] ?? null);
    const audio: AudioItem[] = summaries.map((t) => ({
      key: { sourceId: link.id, itemId: t.id },
      id: t.id,
      number: t.number,
      name: t.name,
      hidden: t.hidden,
      hasFile: t.hasFile,
      path: t.hasFile ? pick(t.candidates) : null,
      candidates: t.candidates,
      durationSec: t.durationSec,
      playSec: t.playSec,
      fadeInSec: t.fadeInSec,
      exit: t.exit,
      exitSec: t.exitSec,
      loop: t.loop,
      volumeDb: t.volumeDb,
      start: t.start,
      startsByItself: t.start !== "go",
    }));
    return { link, status: { state: "ok", changed: changed || undefined }, absPath, sha256, title: link.name || baseName(link.path), granvelo: null, tracks, lights: [], audio };
  }
  return failedSource(link, "unsupported", { absPath, detail: `app ${link.app}` });
}

/** True when the source's items can be used (ok, or another document at the same path: shown with a warning). */
export const usable = (s: LoadedSource) => s.status.state === "ok" || s.status.state === "otherDocument";

/** A track for the audio engine; `playSec` (seconds IN → OUT, when known) is read by the browser simulator only. */
export type SyncTrack = EngineTrack & { playSec?: number | null };

/** Why an action of a GO cannot play: its source is not loaded, or its item is no longer in the source. */
export interface MissingRef {
  goId: string;
  actionId: string;
  ref: ItemRef;
  reason: "source" | "item";
}

const keyOf = (r: ItemRef) => `${r.sourceId}\u0000${r.itemId}`;

/** Lights and tracks of every loaded source, by key. */
export class Library {
  readonly sources: readonly LoadedSource[];
  private lightMap = new Map<string, LightItem>();
  private audioMap = new Map<string, AudioItem>();
  private byId = new Map<string, LoadedSource>();

  constructor(sources: readonly LoadedSource[]) {
    this.sources = sources;
    for (const s of sources) {
      this.byId.set(s.link.id, s);
      if (!usable(s)) continue;
      for (const l of s.lights) this.lightMap.set(keyOf(l.key), l);
      for (const a of s.audio) this.audioMap.set(keyOf(a.key), a);
    }
  }

  source(id: string): LoadedSource | undefined {
    return this.byId.get(id);
  }

  light(ref: ItemRef): LightItem | null {
    return this.lightMap.get(keyOf(ref)) ?? null;
  }

  track(ref: ItemRef): AudioItem | null {
    return this.audioMap.get(keyOf(ref)) ?? null;
  }

  /** Every memory, source by source (the Luci tab). */
  get lights(): LightItem[] {
    return this.sources.filter(usable).flatMap((s) => s.lights);
  }

  /** Every visible track with a file, source by source (the Audio tab). */
  get audio(): AudioItem[] {
    return this.sources.filter(usable).flatMap((s) => s.audio.filter((a) => !a.hidden && a.hasFile));
  }

  /** What playback needs. */
  get lookup(): PlaybackLookup {
    return {
      memory: (r) => this.light(r)?.times ?? null,
      track: (r) => {
        const t = this.track(r);
        return t ? { playSec: t.playSec, exit: t.exit, exitSec: t.exitSec, loop: t.loop } : null;
      },
    };
  }

  /** Actions whose source or item is missing. */
  missing(gos: readonly Go[]): MissingRef[] {
    const out: MissingRef[] = [];
    for (const { go, action, ref } of itemActions(gos)) {
      const src = this.byId.get(ref.sourceId);
      if (!src || !usable(src)) out.push({ goId: go.id, actionId: action.id, ref, reason: "source" });
      else if (action.kind === "light" ? !this.light(ref) : !this.track(ref)) out.push({ goId: go.id, actionId: action.id, ref, reason: "item" });
    }
    return out;
  }

  private granveloDoc(sourceId?: string): GranveloDoc | null {
    if (sourceId) {
      const s = this.byId.get(sourceId);
      if (s?.granvelo && usable(s)) return s.granvelo;
    }
    return this.sources.find((s) => s.granvelo && usable(s))?.granvelo ?? null;
  }

  /**
   * The DMX fade of a light command: the memory (groups applied, Grand Master not) with `transition`, or dark
   * (`ref` null: every channel to 0, with the layout of the first Granvelo source). Null if the memory is missing.
   */
  fadePayload(ref: ItemRef | null, transition: LightTimes): FadePayload | null {
    if (!ref) {
      const doc = this.granveloDoc();
      return fadePayload(doc ?? { fixtures: [] }, new Array<number>(512).fill(0), transition);
    }
    const doc = this.granveloDoc(ref.sourceId);
    const m = doc ? memoryById(doc, ref.itemId) : undefined;
    if (!doc || !m) return null;
    return fadePayload(doc, memoryTarget(doc, m), transition);
  }

  /**
   * The 512 values of Emergenza, as Granvelo: the emergency memory of the first Granvelo source that has one, else
   * every used light white at full. Null with no Granvelo source (nothing is known about the lights).
   */
  emergencyValues(): number[] | null {
    for (const s of this.sources) {
      const doc = s.granvelo;
      if (!doc || !usable(s) || !doc.settings.emergencyMemoryId) continue;
      const m = memoryById(doc, doc.settings.emergencyMemoryId);
      if (m) return Array.from(memoryTarget(doc, m));
    }
    const doc = this.granveloDoc();
    return doc ? Array.from(patchValues(doc, emergencyValues(doc))) : null;
  }

  /**
   * The audio engine's tracks, per Diaframma source (ids as in the file; the native side adds the source prefix):
   * every track with its own times made explicit, plus one copy `trackId#actionId` for each sound of a GO that
   * changes its fade in or level (`audioEngineTrackId`).
   */
  audioSync(gos: readonly Go[]): { sourceId: string; tracks: SyncTrack[] }[] {
    const variants = new Map<string, AudioAction[]>();
    for (const g of gos)
      for (const a of g.actions)
        if (a.kind === "audio" && audioEngineTrackId(a) !== a.ref.itemId) {
          const list = variants.get(a.ref.sourceId) ?? [];
          list.push(a);
          variants.set(a.ref.sourceId, list);
        }
    const out: { sourceId: string; tracks: SyncTrack[] }[] = [];
    for (const s of this.sources) {
      if (!s.tracks || !usable(s)) continue;
      const items = new Map(s.audio.map((a) => [a.id, a]));
      const base = (t: Track): SyncTrack => {
        const item = items.get(t.id);
        const { file: _file, ...rest } = t;
        // Times made explicit: Diaframma's general times are app settings, not in the file.
        return { ...rest, path: item?.path ?? null, playSec: item?.playSec ?? null, entrySec: t.entry ? (item?.fadeInSec ?? t.entrySec) : t.entrySec, exitSec: t.exit === "fadeOut" || t.exit === "crossfade" ? (item?.exitSec ?? t.exitSec) : t.exitSec };
      };
      const tracks = s.tracks.map(base);
      for (const a of variants.get(s.link.id) ?? []) {
        const t = s.tracks.find((x) => x.id === a.ref.itemId);
        if (!t) continue;
        const copy = base(t);
        copy.id = audioEngineTrackId(a);
        copy.hidden = false;
        const fade = a.times?.fade ?? a.times?.fadeIn;
        if (typeof fade === "number" && Number.isFinite(fade)) {
          copy.entry = fade > 0 ? "fadeIn" : null;
          copy.entrySec = fade > 0 ? fade : null;
        }
        if (typeof a.levelDb === "number" && Number.isFinite(a.levelDb)) copy.volumeDb = t.volumeDb + a.levelDb;
        tracks.push(copy);
      }
      out.push({ sourceId: s.link.id, tracks });
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Paths                                                                */
/* ------------------------------------------------------------------ */

const isAbs = (p: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
const winLike = (p: string) => p.includes("\\") || /^[a-zA-Z]:/.test(p);

/** Splits an absolute path into its root and its parts (`..` and `.` removed); null if relative. */
function splitAbs(p: string): { root: string; parts: string[] } | null {
  if (!isAbs(p)) return null;
  let root: string;
  let rest: string;
  const unc = /^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)(.*)$/.exec(p);
  if (unc) {
    root = `\\\\${unc[1]}\\${unc[2]}`.toLowerCase();
    rest = unc[3];
  } else if (/^[a-zA-Z]:/.test(p)) {
    root = p.slice(0, 2).toUpperCase();
    rest = p.slice(2);
  } else {
    root = p[0];
    rest = p.slice(1);
  }
  const parts: string[] = [];
  for (const s of rest.split(/[\\/]/)) {
    if (!s || s === ".") continue;
    if (s === "..") parts.pop();
    else parts.push(s);
  }
  return { root, parts };
}

/**
 * `path` relative to the folder of the file `base` (`/` separators), as the native `files_relative_to`; null when
 * they are on different drives (the link then keeps the absolute path). Windows paths compare without case.
 */
export function relativePath(base: string, path: string): string | null {
  const b = splitAbs(base);
  const p = splitAbs(path);
  if (!b || !p) return null;
  const win = winLike(base) || winLike(path);
  const same = (x: string, y: string) => (win ? x.toLowerCase() === y.toLowerCase() : x === y);
  if (!same(b.root, p.root)) return null;
  const dir = b.parts.slice(0, -1);
  let common = 0;
  while (common < dir.length && common < p.parts.length && same(dir[common], p.parts[common])) common++;
  const out = [...dir.slice(common).map(() => ".."), ...p.parts.slice(common)];
  return out.length ? out.join("/") : ".";
}

/** A new link to a file (relative to the show file when possible). */
export function newLink(app: SourceApp, absPath: string, tcuePath: string | null, makeId: () => string, extra: Partial<SourceLink> = {}): SourceLink {
  const rel = tcuePath ? relativePath(tcuePath, absPath) : null;
  return { ...extra, id: makeId(), app, path: rel ?? absPath };
}
