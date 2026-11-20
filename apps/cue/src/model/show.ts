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

export const FORMAT = "theatre.cue";
export const FORMAT_VERSION = 1;

/** A point of the script: page (from 1), height on the page (0 top … 1 bottom), the text around it. */
export interface Anchor {
  page: number;
  y: number;
  /** Text at the point, to find it again in a new edition of the script (phase 1). */
  text?: { before: string; exact: string; after: string };
  /** With a Bardo script: the id of the line (phase 5). */
  lineId?: string;
}

/** The script: one PDF inside the file, or a Bardo script among the sources (planned, phases 1 and 5). */
export type ScriptRef =
  | { kind: "pdf"; part: string; name: string; pages: number; sha256: string }
  | { kind: "bardo"; sourceId: string };

export type SourceApp = "granvelo" | "diaframma" | "bardo";

/** A file of another app the show takes items from (planned, phase 2). Path relative to the `.tcue`. */
export interface Source {
  id: string;
  app: SourceApp;
  path: string;
  /** Id of the document inside that file, when it has one. */
  docId?: string;
  name?: string;
}

/** An item of a source: a Granvelo memory, a Diaframma track (stable ids). */
export interface ItemRef {
  sourceId: string;
  itemId: string;
}

export type ActionKind = "light" | "audio" | "projection" | "powerpoint";

/** One action of a GO (planned, phase 2; projection and PowerPoint phase 4). */
export interface GoAction {
  id: string;
  kind: ActionKind;
  /** light / audio: the memory or track. */
  ref?: ItemRef;
  /** projection: the item of `projection.items`. */
  projectionItemId?: string;
  /** powerpoint: next, previous or a slide number. */
  powerpoint?: "next" | "previous" | number;
  /** Times taken from the source file, changed in Cue (seconds). */
  times?: { fade?: number; delay?: number };
  /** Audio level change in dB. */
  levelDb?: number;
}

/** Who may give a GO when a secondary computer is connected. */
export type GivenBy = "both" | "primary" | "secondary";

export interface Go {
  id: string;
  anchor: Anchor;
  actions: GoAction[];
  givenBy: GivenBy;
  /** Starts by itself after the previous one (Next/Crossfade of Diaframma, "parte da sola" of Granvelo). */
  auto?: boolean;
  note?: string;
}

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
  /** Width of the script column in px; null = automatic. */
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
  color?: { brightness: number; contrast: number; temperature: number; saturation: number };
  /** What happens when a video ends. */
  atEnd?: "hold" | "black" | "next";
}

export interface Projection {
  /** The blank image ("tappo"): black, or an image inside the file. */
  blank: { kind: "black" } | { kind: "image"; part: string };
  /** Name of the output screen chosen last time. */
  screen: string | null;
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
  /** Fade to black, seconds. */
  ftbSeconds: number;
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
export const DEFAULT_SHOW_SETTINGS: ShowSettings = { autoScrollSpeed: 1, ftbSeconds: 5 };

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
  return { ...o, page: Math.round(num(o.page, 1, 1)), y: num(o.y, 0, 0, 1) } as Anchor;
}

const withId = (o: Raw) => (typeof o.id === "string" && o.id ? o : null);

function script(v: unknown): ScriptRef | null {
  if (!isObj(v)) return null;
  if (v.kind === "pdf" && typeof v.part === "string") return { ...v, kind: "pdf", part: v.part, name: str(v.name), pages: Math.round(num(v.pages, 0, 0)), sha256: str(v.sha256) } as ScriptRef;
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
      scriptWidth: typeof layout.scriptWidth === "number" && Number.isFinite(layout.scriptWidth) ? Math.round(layout.scriptWidth) : null,
      audioBoxHeights: isObj(layout.audioBoxHeights) ? (layout.audioBoxHeights as Record<string, number>) : {},
    },
    projection: {
      ...projection,
      blank: isObj(projection.blank) && projection.blank.kind === "image" && typeof projection.blank.part === "string" ? (projection.blank as Projection["blank"]) : { kind: "black" },
      screen: typeof projection.screen === "string" ? projection.screen : null,
      items: list(projection.items, withId) as unknown as ProjectionItem[],
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
