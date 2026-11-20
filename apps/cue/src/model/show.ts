/**
 * The show of a `.tcue` file (`show.json`, format 1; schema in docs/cue/FORMAT.md).
 *
 * - The smallest valid show is what the launcher creates: `{ format, formatVersion, id, title }`. Every other
 *   field is optional and gets its default here.
 * - **Unknown fields are kept**: parsing starts from the raw object and lays the known fields over it, at the
 *   top level and inside every item (a GO, a source…), so a file written by a newer Cue, or by a later phase,
 *   loses nothing when saved by this one. Code that changes the show must copy objects (`{ ...go, x }`), never
 *   rebuild them from the known fields alone.
 */

import type { Action, Go, ItemRef } from "./gos";

export const FORMAT = "theatre.cue";
export const FORMAT_VERSION = 1;

/**
 * A point of the script (model/anchor.ts): page (from 1), height on the page (0 top … 1 bottom), optionally the
 * position across, and the text at that point to find it again in a new edition of the script.
 */
export interface Anchor {
  page: number;
  y: number;
  x?: number;
  /** The line at the point ("" on a page without text). */
  quote: string;
  /** A few words before and after the quote. */
  before: string;
  after: string;
  /** With a Bardo script: the id of the line (phase 5). */
  lineId?: string;
}

/** The script: one PDF inside the file, or a Bardo script among the sources (phase 5). */
export type ScriptRef =
  | { kind: "pdf"; part: string; fileName: string; sha256: string; pageCount: number }
  | { kind: "bardo"; sourceId: string };

/** The part name of the script PDF inside the file (one PDF per show). */
export const SCRIPT_PART = "script.pdf";

export type SourceApp = "granvelo" | "diaframma" | "bardo";

/** A file of another app the show takes items from (planned, phase 2). Path relative to the `.tcue`. */
export interface Source {
  id: string;
  app: SourceApp;
  path: string;
  /** Id of the document inside that file, when it has one. */
  docId?: string;
  name?: string;
  /** SHA-256 of the file at the last load: a different one means the file changed (phase 2). */
  sha256?: string;
}

/**
 * GOs and their actions: the types live in model/gos.ts (with the functions that edit them) and are re-exported
 * here, so `show.json` has one description.
 */
export type { Action, ActionKind, ActionTimes, AudioAction, AudioStopAction, GivenBy, Go, GoAnchor, ItemRef, LightAction, PowerPointAction, ProjectionAction } from "./gos";
/** Old name of `Action`. */
export type GoAction = Action;

/** A note on the script (Note column; phase 1). */
export interface ScriptNote {
  id: string;
  anchor: Anchor;
  text: string;
}

/** Auto scroll speed from a point (or a GO) on (phase 2). 1 = the general speed. */
export interface SpeedZone {
  id: string;
  from: Anchor;
  fromGoId?: string;
  speed: number;
}

/** Widths and heights the user set (phase 1–2). */
export interface Layout {
  /** Width of the script as a fraction (0.2–0.8) of script + columns; null = the default. */
  scriptWidth: number | null;
  /** Height in px of each audio box (by action id), dragged by its handle. */
  audioBoxHeights: Record<string, number>;
}

export type Transition = { kind: "cut" } | { kind: "dissolve" | "throughBlack"; seconds: number };

/** An image, video or slide of the projections (phase 4). Images inside the file, videos outside. */
export interface ProjectionItem {
  id: string;
  kind: "image" | "video" | "slide";
  /** Image or slide: `images/<id>.<ext>` inside the file. */
  part?: string;
  /** Video: path relative to the `.tcue` and its SHA-256. */
  path?: string;
  sha256?: string;
  name: string;
  transition: Transition;
  /** Colour of this item alone ("Questo"); absent = the one of "Tutti" (`Projection.color`). */
  color?: Color;
  /** What happens when a video ends: stay on the last frame (default), go black, or loop. */
  atEnd?: "hold" | "black" | "loop";
  /** `thumbs/<id>.jpg` inside the file. */
  thumb?: string;
  /** Video length in seconds (read when it was added). */
  durationSec?: number;
}

/** Colour adjustments, each -100..100 (0 = untouched). */
export interface Color {
  brightness: number;
  contrast: number;
  temperature: number;
  saturation: number;
}

export interface Projection {
  /** The blank image ("tappo"): black, or an image inside the file. */
  blank: { kind: "black" } | { kind: "image"; part: string };
  /** Name of the output screen chosen last time. */
  screen: string | null;
  /** Colour of every item ("Tutti"); an item's own `color` replaces it. */
  color?: Color;
  items: ProjectionItem[];
}

/** A line of "Prima del sipario" (phase 5). */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** Proposed by Cue, or written by the user ("tua"). */
  origin: "suggested" | "user";
}

/** Settings that belong to the show (the computer's ones are in the app settings). */
export interface ShowSettings {
  /** General auto scroll speed, script lines per second (phase 2). */
  autoScrollSpeed: number;
  /** Fade to black, seconds (default 3). */
  ftbSeconds: number;
  /** The memory the Preset key (Piazzato, house lights) brings up; none = the key does nothing. */
  presetRef?: ItemRef;
}

export interface CueShow {
  format: typeof FORMAT;
  formatVersion: typeof FORMAT_VERSION;
  id: string;
  title: string;
  script: ScriptRef | null;
  sources: Source[];
  gos: Go[];
  notes: ScriptNote[];
  speedZones: SpeedZone[];
  layout: Layout;
  projection: Projection;
  checklist: ChecklistItem[];
  settings: ShowSettings;
  /** Which Cue wrote the file last. */
  savedWith?: { app: string; version: string };
}

export const DEFAULT_LAYOUT: Layout = { scriptWidth: null, audioBoxHeights: {} };
export const DEFAULT_PROJECTION: Projection = { blank: { kind: "black" }, screen: null, items: [] };
export const DEFAULT_SHOW_SETTINGS: ShowSettings = { autoScrollSpeed: 1, ftbSeconds: 3 };

export type ShowFileProblem = "not-json" | "not-cue" | "newer" | "damaged";

export class ShowFileError extends Error {
  constructor(
    public problem: ShowFileProblem,
    public detail = "",
  ) {
    super(detail || problem);
    this.name = "ShowFileError";
  }
}

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, def = ""): string => (typeof v === "string" ? v : def);
const num = (v: unknown, def: number, lo = -Infinity, hi = Infinity): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);

/** Objects of a list, unknown fields included; anything that is not an object is dropped. */
function list<T>(v: unknown, fix: (o: Raw) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v) {
    if (!isObj(x)) continue;
    const y = fix(x);
    if (y) out.push(y);
  }
  return out;
}

function anchor(v: unknown): Anchor {
  const o = isObj(v) ? v : {};
  const a = { ...o, page: Math.round(num(o.page, 1, 1)), y: num(o.y, 0, 0, 1), quote: str(o.quote), before: str(o.before), after: str(o.after) } as Anchor;
  if (o.x !== undefined) {
    if (typeof o.x === "number" && Number.isFinite(o.x)) a.x = num(o.x, 0, 0, 1);
    else delete a.x;
  }
  return a;
}

export const SCRIPT_WIDTH_MIN = 0.2;
export const SCRIPT_WIDTH_MAX = 0.8;

/** A transition read from a file: anything unknown is a cut; durations are 0.1–10 s. */
function transition(v: unknown): Transition {
  if (isObj(v) && (v.kind === "dissolve" || v.kind === "throughBlack")) return { kind: v.kind, seconds: num(v.seconds, 1, 0.1, 10) };
  return { kind: "cut" };
}

const withId = (o: Raw) => (typeof o.id === "string" && o.id ? o : null);

function script(v: unknown): ScriptRef | null {
  if (!isObj(v)) return null;
  if (v.kind === "pdf" && typeof v.part === "string")
    return { ...v, kind: "pdf", part: v.part, fileName: str(v.fileName), sha256: str(v.sha256), pageCount: Math.round(num(v.pageCount, 0, 0)) } as ScriptRef;
  if (v.kind === "bardo" && typeof v.sourceId === "string") return { ...v, kind: "bardo", sourceId: v.sourceId } as ScriptRef;
  // A kind this Cue does not know: kept as it is.
  return v as unknown as ScriptRef;
}

/**
 * Checks the text of `show.json` (as the native side does) and returns the raw object.
 * Throws ShowFileError: not JSON, not a Cue show, newer format.
 */
export function checkShowJson(text: string): Raw {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new ShowFileError("not-json", String(e));
  }
  if (!isObj(v) || v.format !== FORMAT) throw new ShowFileError("not-cue");
  const fv = v.formatVersion;
  if (typeof fv === "number" && Number.isInteger(fv) && fv > FORMAT_VERSION) throw new ShowFileError("newer", String(fv));
  if (fv !== FORMAT_VERSION) throw new ShowFileError("not-cue");
  return v;
}

const clampPct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(100, Math.max(-100, v))) : 0);

/** A colour with every value a whole number in -100..100. */
export function normalizeColor(c: Record<string, unknown>): Color {
  return { brightness: clampPct(c.brightness), contrast: clampPct(c.contrast), temperature: clampPct(c.temperature), saturation: clampPct(c.saturation) };
}

/** Reads `show.json` into a show with every field present, keeping unknown fields. */
export function parseShow(text: string, makeId: () => string = defaultId): CueShow {
  const raw = checkShowJson(text);
  const layout = isObj(raw.layout) ? raw.layout : {};
  const projection = isObj(raw.projection) ? raw.projection : {};
  const settings = isObj(raw.settings) ? raw.settings : {};
  const show: CueShow = {
    ...raw,
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    id: str(raw.id) || makeId(),
    title: str(raw.title),
    script: script(raw.script),
    sources: list(raw.sources, withId) as unknown as Source[],
    gos: list(raw.gos, (o) =>
      withId(o) ? ({ ...o, anchor: anchor(o.anchor), actions: list(o.actions, withId), givenBy: o.givenBy === "primary" || o.givenBy === "secondary" ? o.givenBy : "both" } as unknown as Go) : null,
    ),
    notes: list(raw.notes, (o) => (withId(o) ? ({ ...o, anchor: anchor(o.anchor), text: str(o.text) } as unknown as ScriptNote) : null)),
    speedZones: list(raw.speedZones, (o) => (withId(o) ? ({ ...o, from: anchor(o.from), speed: num(o.speed, 1, 0.05, 20) } as unknown as SpeedZone) : null)),
    layout: {
      ...layout,
      scriptWidth:
        typeof layout.scriptWidth === "number" && Number.isFinite(layout.scriptWidth) ? Math.min(SCRIPT_WIDTH_MAX, Math.max(SCRIPT_WIDTH_MIN, layout.scriptWidth)) : null,
      audioBoxHeights: isObj(layout.audioBoxHeights) ? (layout.audioBoxHeights as Record<string, number>) : {},
    },
    projection: {
      ...projection,
      blank: isObj(projection.blank) && projection.blank.kind === "image" && typeof projection.blank.part === "string" ? (projection.blank as Projection["blank"]) : { kind: "black" },
      screen: typeof projection.screen === "string" ? projection.screen : null,
      items: list(projection.items, (o) =>
        withId(o)
          ? ({
              ...o,
              kind: o.kind === "video" || o.kind === "slide" ? o.kind : "image",
              name: str(o.name),
              transition: transition(o.transition),
              ...(isObj(o.color) ? { color: normalizeColor(o.color) } : {}),
              ...(o.atEnd === "black" || o.atEnd === "loop" ? { atEnd: o.atEnd } : o.atEnd ? { atEnd: "hold" } : {}),
            } as unknown as ProjectionItem)
          : null,
      ),
      ...(isObj(projection.color) ? { color: normalizeColor(projection.color) } : {}),
    },
    checklist: list(raw.checklist, (o) =>
      withId(o) ? ({ ...o, text: str(o.text), done: o.done === true, origin: o.origin === "user" ? "user" : "suggested" } as unknown as ChecklistItem) : null,
    ),
    settings: {
      ...settings,
      autoScrollSpeed: num(settings.autoScrollSpeed, DEFAULT_SHOW_SETTINGS.autoScrollSpeed, 0.05, 20),
      ftbSeconds: num(settings.ftbSeconds, DEFAULT_SHOW_SETTINGS.ftbSeconds, 0, 60),
    },
  };
  const preset = settings.presetRef;
  if (isObj(preset) && typeof preset.sourceId === "string" && typeof preset.itemId === "string") show.settings.presetRef = { ...preset, sourceId: preset.sourceId, itemId: preset.itemId };
  else delete show.settings.presetRef;
  if (isObj(raw.savedWith)) show.savedWith = { ...raw.savedWith, app: str(raw.savedWith.app), version: str(raw.savedWith.version) };
  // Version metadata belongs to the copy in the versions folder, never to the show.
  delete (show as unknown as Raw).versionKind;
  delete (show as unknown as Raw).versionNote;
  return show;
}

/** The text of `show.json`: the known fields first (in a fixed order), then any unknown field. */
export function serializeShow(show: CueShow, app?: { name: string; version: string }): string {
  const { format, formatVersion, id, title, ...rest } = show;
  const out: Raw = { format, formatVersion, id, title, ...rest };
  if (app) out.savedWith = { ...(isObj(show.savedWith) ? show.savedWith : {}), app: app.name, version: app.version };
  return `${JSON.stringify(out, null, 2)}\n`;
}

function defaultId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32).padEnd(32, "0");
}

/** A new, empty show (what "Nuovo spettacolo" makes; same as the launcher's file once parsed). */
export function newShow(title: string, makeId: () => string = defaultId): CueShow {
  return parseShow(JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, id: makeId(), title: title.trim() }), makeId);
}

/** Problem code of an error from the native side (`code: detail`) or from parseShow. */
export function errorCode(e: unknown): string {
  if (e instanceof ShowFileError) return e.problem === "not-json" ? "damaged" : e.problem;
  const text = e instanceof Error ? e.message : String(e);
  const m = /^([a-z-]+): /.exec(text);
  return m ? m[1] : "other";
}

/** The detail after the code, for developers. */
export function errorDetail(e: unknown): string {
  if (e instanceof ShowFileError) return e.detail;
  const text = e instanceof Error ? e.message : String(e);
  return text.replace(/^[a-z-]+: /, "");
}
