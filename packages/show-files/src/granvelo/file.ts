import { uid } from "@theatre-suite/core";
import { defaultChannels, fixtureType, isFixtureTypeId } from "./fixtureTypes";
import { defaultAim } from "./stage";
import {
  APP_ID,
  CHANNEL_FUNCTIONS,
  DEFAULT_DOC_SETTINGS,
  DEFAULT_STAGE,
  FILE_FORMAT,
  UNIVERSE_SIZE,
  type Channel,
  type ChannelFunction,
  type DocSettings,
  type Fixture,
  type FixtureValues,
  type GranveloDoc,
  type Group,
  type Id,
  type Memory,
  type MemoryBinding,
  type MemoryState,
  type Mount,
  type Scenery,
  type SceneryPlacement,
  type SceneryShape,
  type Stage,
  type Transition,
  type Truss,
  type Vec3,
} from "./types";

/**
 * The `.granvelo` file: readable JSON, `format: 1`.
 *
 * ```
 * { "app": "granvelo", "format": 1, "savedWith": { "app": "Granvelo", "version": "0.1.0" }, "savedAt": "…",
 *   "id": "…", "title": "…", "stage": {…}, "trusses": […], "fixtures": […], "scenery": […], "groups": […],
 *   "memories": […], "sequence": […], "settings": {…}, …unknown keys kept as they are }
 * ```
 *
 * Reading is strict about what would make the show wrong and lenient about what can be safely filled in:
 * - refused with a clear reason: not JSON, not a Granvelo file, another format (newer → "update Granvelo",
 *   older → "test version no longer read": before the first publication there are no migrations), wrong
 *   types, values out of range (an address of 600, a level of 300), duplicate ids, two lights or two
 *   memories with the same number, a memory whose binding differs from the document's;
 * - filled in with defaults: missing optional fields (names, notes, beam, aim, transition times, settings…);
 * - dropped: references to things that do not exist (a group listing a removed light, a sequence entry of a
 *   removed memory, values of an unknown light) — keeping them could only confuse, dropping them loses nothing.
 * Unknown top-level keys are written back unchanged (a newer phase may add them).
 */

export type FileProblem = "not-json" | "not-granvelo" | "newer" | "unsupported" | "damaged";

export class GranveloFileError extends Error {
  /** For "damaged": where and why, in English (shown under the translated message). */
  readonly detail: string;
  constructor(
    public readonly problem: FileProblem,
    detail = "",
  ) {
    super(detail ? `${problem}: ${detail}` : problem);
    this.detail = detail;
  }
}

const HEADER_KEYS = ["app", "format", "savedWith", "savedAt"];
const DOC_KEYS = ["id", "title", "stage", "trusses", "fixtures", "scenery", "groups", "memories", "sequence", "settings"];
const KNOWN_KEYS = new Set([...HEADER_KEYS, ...DOC_KEYS]);

/** A new, empty show. */
export function newDocument(opts: { title?: string; stage?: Partial<Stage> } = {}): GranveloDoc {
  return {
    id: uid(),
    title: opts.title ?? "",
    stage: { ...DEFAULT_STAGE, ...opts.stage },
    trusses: [],
    fixtures: [],
    scenery: [],
    groups: [],
    memories: [],
    sequence: [],
    settings: { ...DEFAULT_DOC_SETTINGS },
    extra: {},
  };
}

/* ------------------------------------------------------------------ */
/* Writing                                                              */
/* ------------------------------------------------------------------ */

/** Pretty JSON, but arrays of plain numbers (DMX values) on one line, so a memory stays readable. */
function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/\[\s+(-?[\d.eE+-]+(?:,\s+-?[\d.eE+-]+)*)\s+\]/g, (_, inner: string) => `[${inner.split(/,\s+/).join(", ")}]`);
}

export function serialize(doc: GranveloDoc, app: { name: string; version: string }, now = new Date()): string {
  const file = {
    app: APP_ID,
    format: FILE_FORMAT,
    savedWith: { app: app.name, version: app.version },
    savedAt: now.toISOString(),
    id: doc.id,
    title: doc.title,
    stage: doc.stage,
    trusses: doc.trusses,
    fixtures: doc.fixtures,
    scenery: doc.scenery,
    groups: doc.groups,
    memories: doc.memories,
    sequence: doc.sequence,
    settings: doc.settings,
    ...doc.extra,
  };
  return `${stringify(file)}\n`;
}

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

type Obj = Record<string, unknown>;

function fail(path: string, why: string): never {
  throw new GranveloFileError("damaged", `${path}: ${why}`);
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) fail(path, "expected an object");
  return v;
}

function arr(v: unknown, path: string, optional = true): unknown[] {
  if (v === undefined && optional) return [];
  if (!Array.isArray(v)) fail(path, "expected a list");
  return v;
}

function num(v: unknown, path: string, o: { min?: number; max?: number; int?: boolean; def?: number } = {}): number {
  if (v === undefined && o.def !== undefined) return o.def;
  if (typeof v !== "number" || !Number.isFinite(v)) fail(path, "expected a number");
  if (o.int && !Number.isInteger(v)) fail(path, "expected a whole number");
  if (o.min !== undefined && v < o.min) fail(path, `must be at least ${o.min}`);
  if (o.max !== undefined && v > o.max) fail(path, `must be at most ${o.max}`);
  return v;
}

function str(v: unknown, path: string, def?: string, max = 2000): string {
  if (v === undefined && def !== undefined) return def;
  if (typeof v !== "string") fail(path, "expected a text");
  if (v.length > max) fail(path, `longer than ${max} characters`);
  return v;
}

function bool(v: unknown, path: string, def: boolean): boolean {
  if (v === undefined) return def;
  if (typeof v !== "boolean") fail(path, "expected true or false");
  return v;
}

function id(v: unknown, path: string): Id {
  const s = str(v, path, undefined, 100);
  if (!s.trim()) fail(path, "empty id");
  return s;
}

const COORD = 1000;
function vec3(v: unknown, path: string, def?: Vec3): Vec3 {
  if (v === undefined && def) return def;
  const o = obj(v, path);
  return {
    x: num(o.x, `${path}.x`, { min: -COORD, max: COORD }),
    y: num(o.y, `${path}.y`, { min: -COORD, max: COORD }),
    z: num(o.z, `${path}.z`, { min: -COORD, max: COORD }),
  };
}

function unique<T>(items: T[], key: (x: T) => string | number, path: string, what: string): void {
  const seen = new Set<string | number>();
  for (const x of items) {
    const k = key(x);
    if (seen.has(k)) fail(path, `two ${what} ${k}`);
    seen.add(k);
  }
}

const dmxValue = (v: unknown, path: string) => num(v, path, { min: 0, max: 255, int: true });

function readStage(v: unknown): Stage {
  const o = obj(v, "stage");
  return {
    width: num(o.width, "stage.width", { min: 0.5, max: 200 }),
    depth: num(o.depth, "stage.depth", { min: 0.5, max: 200 }),
    height: num(o.height, "stage.height", { min: 0.5, max: 100 }),
  };
}

function readTruss(v: unknown, path: string): Truss {
  const o = obj(v, path);
  const name = o.name === null || o.name === undefined ? null : str(o.name, `${path}.name`, undefined, 200);
  return { id: id(o.id, `${path}.id`), name: name && name.trim() ? name : null, y: num(o.y, `${path}.y`, { min: -COORD, max: COORD }), z: num(o.z, `${path}.z`, { min: -COORD, max: COORD }) };
}

function readChannel(v: unknown, path: string): Channel {
  const o = obj(v, path);
  const fn = str(o.function, `${path}.function`, undefined, 100);
  const label = o.label === undefined ? undefined : str(o.label, `${path}.label`, undefined, 60);
  if ((CHANNEL_FUNCTIONS as readonly string[]).includes(fn)) return label ? { function: fn as ChannelFunction, label } : { function: fn as ChannelFunction };
  // A function this version does not know: kept readable as "other" with its name.
  return { function: "other", label: label || fn };
}

function readMount(v: unknown, path: string, trussIds: Set<Id>): Mount {
  const o = obj(v, path);
  switch (o.kind) {
    case "truss": {
      const t = id(o.trussId, `${path}.trussId`);
      return trussIds.has(t) ? { kind: "truss", trussId: t } : { kind: "floating" };
    }
    case "floating":
      return { kind: "floating" };
    case "floor":
      return { kind: "floor" };
    default:
      return fail(`${path}.kind`, "expected truss, floating or floor");
  }
}

function readFixture(v: unknown, path: string, stage: Stage, trussIds: Set<Id>, trusses: Truss[]): Fixture {
  const o = obj(v, path);
  const typeId = str(o.typeId, `${path}.typeId`, undefined, 100);
  if (!isFixtureTypeId(typeId)) fail(`${path}.typeId`, `unknown type of light "${typeId}"`);
  if (o.universe !== undefined && o.universe !== 1) fail(`${path}.universe`, "only universe 1 exists");
  const address = o.address === null || o.address === undefined ? null : num(o.address, `${path}.address`, { min: 1, max: UNIVERSE_SIZE, int: true });
  const channels = o.channels === undefined ? defaultChannels(typeId) : arr(o.channels, `${path}.channels`, false).map((c, i) => readChannel(c, `${path}.channels[${i}]`));
  if (channels.length === 0) fail(`${path}.channels`, "a light needs at least one channel");
  if (channels.length > UNIVERSE_SIZE) fail(`${path}.channels`, "too many channels");
  const mount = readMount(o.mount ?? { kind: "floating" }, `${path}.mount`, trussIds);
  let position = vec3(o.position, `${path}.position`);
  if (mount.kind === "truss") {
    const t = trusses.find((x) => x.id === mount.trussId)!;
    position = { ...position, y: t.y, z: t.z };
  }
  const beamObj = o.beam === undefined ? {} : obj(o.beam, `${path}.beam`);
  return {
    id: id(o.id, `${path}.id`),
    number: num(o.number, `${path}.number`, { min: 1, max: 99999, int: true }),
    name: str(o.name, `${path}.name`, "", 200),
    typeId,
    universe: 1,
    address,
    channels,
    mount,
    position,
    beam: { angle: num(beamObj.angle, `${path}.beam.angle`, { min: 0, max: 180, def: fixtureType(typeId).beam }) },
    aim: vec3(o.aim, `${path}.aim`, defaultAim(position, mount, stage)),
    unused: bool(o.unused, `${path}.unused`, false),
    broken: bool(o.broken, `${path}.broken`, false),
  };
}

const SHAPES: SceneryShape[] = ["box", "cone", "sphere", "plane", "cylinder"];

function readScenery(v: unknown, path: string): Scenery {
  const o = obj(v, path);
  const shape = str(o.shape, `${path}.shape`, undefined, 20) as SceneryShape;
  if (!SHAPES.includes(shape)) fail(`${path}.shape`, `unknown shape "${shape}"`);
  const color = str(o.color, `${path}.color`, "#8A8F9C", 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail(`${path}.color`, "expected a colour like #a1b2c3");
  const size = vec3(o.size, `${path}.size`);
  if (size.x < 0 || size.y < 0 || size.z < 0) fail(`${path}.size`, "sizes cannot be negative");
  return {
    id: id(o.id, `${path}.id`),
    name: str(o.name, `${path}.name`, "", 200),
    shape,
    position: vec3(o.position, `${path}.position`),
    rotation: vec3(o.rotation, `${path}.rotation`, { x: 0, y: 0, z: 0 }),
    size,
    color: color.toUpperCase(),
  };
}

function readGroup(v: unknown, path: string, fixtureIds: Set<Id>): Group {
  const o = obj(v, path);
  const ids = arr(o.fixtureIds, `${path}.fixtureIds`).map((x, i) => id(x, `${path}.fixtureIds[${i}]`));
  return {
    id: id(o.id, `${path}.id`),
    name: str(o.name, `${path}.name`, "", 200),
    fixtureIds: [...new Set(ids)].filter((x) => fixtureIds.has(x)),
    level: num(o.level, `${path}.level`, { min: 0, max: 255, int: true, def: 255 }),
  };
}

function readState(v: unknown, path: string, binding: MemoryBinding, fixtures: Fixture[]): MemoryState {
  const o = obj(v, path);
  if (o.binding !== binding) fail(`${path}.binding`, `expected "${binding}" like the setting of the document`);
  if (binding === "address") {
    const dmx = arr(o.dmx, `${path}.dmx`, false);
    if (dmx.length !== UNIVERSE_SIZE) fail(`${path}.dmx`, `expected ${UNIVERSE_SIZE} values`);
    return { binding, dmx: dmx.map((x, i) => dmxValue(x, `${path}.dmx[${i}]`)) };
  }
  const raw = obj(o.fixtures ?? {}, `${path}.fixtures`);
  const out: FixtureValues = {};
  for (const f of fixtures) {
    if (!(f.id in raw)) continue;
    const vals = arr(raw[f.id], `${path}.fixtures.${f.id}`, false).map((x, i) => dmxValue(x, `${path}.fixtures.${f.id}[${i}]`));
    out[f.id] = f.channels.map((_, i) => vals[i] ?? 0);
  }
  return { binding, fixtures: out };
}

function readTransition(v: unknown, path: string, def: number): Transition {
  const o = v === undefined ? {} : obj(v, path);
  const secs = (x: unknown, p: string, d: number) => num(x, p, { min: 0, max: 3600, def: d });
  return {
    fadeIn: secs(o.fadeIn, `${path}.fadeIn`, def),
    fadeOut: secs(o.fadeOut, `${path}.fadeOut`, def),
    delay: secs(o.delay, `${path}.delay`, 0),
    autoFollow: bool(o.autoFollow, `${path}.autoFollow`, false),
    moveInDark: bool(o.moveInDark, `${path}.moveInDark`, false),
  };
}

function readMemory(v: unknown, path: string, settings: DocSettings, fixtures: Fixture[], sceneryIds: Set<Id>): Memory {
  const o = obj(v, path);
  const scenery: SceneryPlacement[] = [];
  arr(o.scenery, `${path}.scenery`).forEach((p, i) => {
    const q = obj(p, `${path}.scenery[${i}]`);
    const sceneryId = id(q.sceneryId, `${path}.scenery[${i}].sceneryId`);
    if (!sceneryIds.has(sceneryId) || scenery.some((s) => s.sceneryId === sceneryId)) return;
    scenery.push({ sceneryId, position: vec3(q.position, `${path}.scenery[${i}].position`), rotation: vec3(q.rotation, `${path}.scenery[${i}].rotation`, { x: 0, y: 0, z: 0 }) });
  });
  return {
    id: id(o.id, `${path}.id`),
    number: num(o.number, `${path}.number`, { min: 1, max: 99999, int: true }),
    label: str(o.label, `${path}.label`, "", 200),
    note: str(o.note, `${path}.note`, "", 4000),
    state: readState(o.state, `${path}.state`, settings.memoryBinding, fixtures),
    scenery,
    transition: readTransition(o.transition, `${path}.transition`, settings.defaultCrossfade),
  };
}

function readSettings(v: unknown): DocSettings {
  const o = v === undefined ? {} : obj(v, "settings");
  const binding = o.memoryBinding ?? DEFAULT_DOC_SETTINGS.memoryBinding;
  if (binding !== "address" && binding !== "fixture") fail("settings.memoryBinding", 'expected "address" or "fixture"');
  return {
    memoryBinding: binding,
    defaultCrossfade: num(o.defaultCrossfade, "settings.defaultCrossfade", { min: 0, max: 3600, def: DEFAULT_DOC_SETTINGS.defaultCrossfade }),
    emergencyMemoryId: o.emergencyMemoryId === null || o.emergencyMemoryId === undefined ? null : id(o.emergencyMemoryId, "settings.emergencyMemoryId"),
  };
}

/** Reads the text of a `.granvelo` file. Throws `GranveloFileError` (see the rules at the top). */
export function parse(text: string): GranveloDoc {
  let v: unknown;
  try {
    v = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new GranveloFileError("not-json");
  }
  if (!isObj(v) || v.app !== APP_ID) throw new GranveloFileError("not-granvelo");
  if (typeof v.format !== "number" || !Number.isInteger(v.format)) throw new GranveloFileError("damaged", "format: expected a whole number");
  if (v.format > FILE_FORMAT) throw new GranveloFileError("newer");
  // No older formats exist before the suite is published: anything else is refused, not guessed.
  if (v.format !== FILE_FORMAT) throw new GranveloFileError("unsupported");

  const settings = readSettings(v.settings);
  const stage = readStage(v.stage);
  const trusses = arr(v.trusses, "trusses").map((x, i) => readTruss(x, `trusses[${i}]`));
  unique(trusses, (t) => t.id, "trusses", "trusses with id");
  const trussIds = new Set(trusses.map((t) => t.id));
  const fixtures = arr(v.fixtures, "fixtures").map((x, i) => readFixture(x, `fixtures[${i}]`, stage, trussIds, trusses));
  unique(fixtures, (f) => f.id, "fixtures", "lights with id");
  unique(fixtures, (f) => f.number, "fixtures", "lights with number");
  const fixtureIds = new Set(fixtures.map((f) => f.id));
  const scenery = arr(v.scenery, "scenery").map((x, i) => readScenery(x, `scenery[${i}]`));
  unique(scenery, (s) => s.id, "scenery", "scenery pieces with id");
  const groups = arr(v.groups, "groups").map((x, i) => readGroup(x, `groups[${i}]`, fixtureIds));
  unique(groups, (g) => g.id, "groups", "groups with id");
  const sceneryIds = new Set(scenery.map((s) => s.id));
  const memories = arr(v.memories, "memories").map((x, i) => readMemory(x, `memories[${i}]`, settings, fixtures, sceneryIds));
  unique(memories, (m) => m.id, "memories", "memories with id");
  unique(memories, (m) => m.number, "memories", "memories with number");
  const memoryIds = new Set(memories.map((m) => m.id));
  const sequence = [...new Set(arr(v.sequence, "sequence").map((x, i) => id(x, `sequence[${i}]`)))].filter((x) => memoryIds.has(x));
  if (settings.emergencyMemoryId && !memoryIds.has(settings.emergencyMemoryId)) settings.emergencyMemoryId = null;

  const extra: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (!KNOWN_KEYS.has(k)) extra[k] = x;
  return {
    id: id(v.id, "id"),
    title: str(v.title, "title", "", 200),
    stage,
    trusses,
    fixtures,
    scenery,
    groups,
    memories,
    sequence,
    settings,
    extra,
  };
}
