import { uid } from "@theatre-suite/core";
import { defaultChannels, fixtureType } from "./fixtureTypes";
import { nextFreeAddress, occupiedChannels } from "./addresses";
import { valuesOf } from "./universe";
import { defaultAim, defaultScenerySize, resolveDrop } from "../stage/geometry";
import { CHANNEL_FUNCTIONS, type Channel, type ChannelFunction, type Fixture, type FixtureTypeId, type GranveloDoc, type Id, type Memory, type Mount, type Scenery, type SceneryShape, type Stage, type Truss, type Vec3 } from "./types";

/**
 * Operations on the document. Every function returns a new document (the old one is untouched: undo keeps
 * it) and never changes what it was not asked to change — in particular, no operation renumbers lights or
 * changes addresses of other lights.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ */
/* Trusses                                                              */
/* ------------------------------------------------------------------ */

/** Trusses front to back (the order of their automatic names). */
export function trussesInOrder(doc: Pick<GranveloDoc, "trusses">): Truss[] {
  return [...doc.trusses].sort((a, b) => a.y - b.y || a.z - b.z || a.id.localeCompare(b.id));
}

/** Position (1, 2, 3…) of a truss front to back: "1ª americana" is the closest to the audience. */
export function trussOrdinal(doc: Pick<GranveloDoc, "trusses">, trussId: Id): number {
  return trussesInOrder(doc).findIndex((t) => t.id === trussId) + 1;
}

/** Same truss if one is within `tolerance` metres in depth and height; otherwise a new one is created (the magnet). */
export function trussAt(doc: GranveloDoc, y: number, z: number, tolerance = 0.25): { doc: GranveloDoc; trussId: Id } {
  const near = doc.trusses.find((t) => Math.abs(t.y - y) <= tolerance && Math.abs(t.z - z) <= tolerance);
  if (near) return { doc, trussId: near.id };
  const truss: Truss = { id: uid(), name: null, y: round2(y), z: round2(z) };
  return { doc: { ...doc, trusses: [...doc.trusses, truss] }, trussId: truss.id };
}

/* ------------------------------------------------------------------ */
/* Lights                                                               */
/* ------------------------------------------------------------------ */

/** Number for a new light: one more than the highest (removals never renumber). */
export function nextFixtureNumber(doc: Pick<GranveloDoc, "fixtures">): number {
  return doc.fixtures.reduce((n, f) => Math.max(n, f.number), 0) + 1;
}

/** Default aim by place: see `stage/geometry.ts` (pure, shared with the stage views). */
export { defaultAim };

export interface NewFixture {
  typeId: FixtureTypeId;
  name?: string;
  mount?: Mount;
  position?: Vec3;
  /** Address to use; `"next"` = first free one; null = none. Default `"next"`. */
  address?: number | null | "next";
}

/** Adds a light with the default channels and beam of its type. Returns the document and the new light's id. */
export function addFixture(doc: GranveloDoc, spec: NewFixture): { doc: GranveloDoc; id: Id } {
  const type = fixtureType(spec.typeId);
  const channels = defaultChannels(spec.typeId);
  const mount: Mount = spec.mount ?? { kind: "floating" };
  let position: Vec3 = spec.position ?? { x: 0, y: doc.stage.depth / 2, z: doc.stage.height };
  if (mount.kind === "truss") {
    const t = doc.trusses.find((x) => x.id === mount.trussId);
    if (t) position = { ...position, y: t.y, z: t.z };
  }
  const number = nextFixtureNumber(doc);
  const address = spec.address === undefined || spec.address === "next" ? nextFreeAddress(doc, channels.length) : spec.address;
  const f: Fixture = {
    id: uid(),
    number,
    name: spec.name ?? "",
    typeId: spec.typeId,
    universe: 1,
    address,
    channels,
    mount,
    position,
    beam: { angle: type.beam },
    aim: defaultAim(position, mount, doc.stage),
    unused: false,
    broken: false,
  };
  return { doc: { ...doc, fixtures: [...doc.fixtures, f] }, id: f.id };
}

/** Changes fields of one light (not its channels: see `setFixtureChannels`). */
export function updateFixture(doc: GranveloDoc, id: Id, patch: Partial<Omit<Fixture, "id" | "channels" | "universe">>): GranveloDoc {
  return { ...doc, fixtures: doc.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
}

/**
 * Removes a light: also from the groups and from the memories bound to the lights. The other lights keep
 * their numbers and addresses; memories bound to addresses keep their 512 values (the channels are simply free).
 */
export function removeFixture(doc: GranveloDoc, id: Id): GranveloDoc {
  return {
    ...doc,
    fixtures: doc.fixtures.filter((f) => f.id !== id),
    groups: doc.groups.map((g) => (g.fixtureIds.includes(id) ? { ...g, fixtureIds: g.fixtureIds.filter((x) => x !== id) } : g)),
    memories: doc.memories.map((m) => {
      if (m.state.binding !== "fixture" || !(id in m.state.fixtures)) return m;
      const fixtures = { ...m.state.fixtures };
      delete fixtures[id];
      return { ...m, state: { binding: "fixture", fixtures } };
    }),
  };
}

const sameLayout = (a: Channel[], b: Channel[]) => a.length === b.length && a.every((c, i) => c.function === b[i].function && (c.label ?? "") === (b[i].label ?? ""));

/**
 * New channel order/functions for one light. Memories bound to the lights keep each value with its channel
 * position (a longer list gets zeros, a shorter one drops the last values); memories bound to addresses do not change.
 */
export function setFixtureChannels(doc: GranveloDoc, id: Id, channels: Channel[]): GranveloDoc {
  const f = doc.fixtures.find((x) => x.id === id);
  if (!f || sameLayout(f.channels, channels)) return doc;
  const next = { ...f, channels: channels.map((c) => ({ ...c })) };
  return {
    ...doc,
    fixtures: doc.fixtures.map((x) => (x.id === id ? next : x)),
    memories: doc.memories.map((m) => {
      if (m.state.binding !== "fixture" || !(id in m.state.fixtures)) return m;
      return { ...m, state: { binding: "fixture", fixtures: { ...m.state.fixtures, [id]: valuesOf(next, m.state.fixtures) } } };
    }),
  };
}

/** "Applica a tutte le luci di questo tipo": the channels of `id` are copied to every light of the same type. */
export function applyChannelsToType(doc: GranveloDoc, id: Id): GranveloDoc {
  const src = doc.fixtures.find((x) => x.id === id);
  if (!src) return doc;
  return doc.fixtures.filter((f) => f.typeId === src.typeId && f.id !== id).reduce((d, f) => setFixtureChannels(d, f.id, src.channels), doc);
}

/** Changes the type of a light: channels and beam go back to the defaults of the new type; the address stays. */
export function changeFixtureType(doc: GranveloDoc, id: Id, typeId: FixtureTypeId): GranveloDoc {
  const f = doc.fixtures.find((x) => x.id === id);
  if (!f || f.typeId === typeId) return doc;
  const d = setFixtureChannels(doc, id, defaultChannels(typeId));
  return updateFixture(d, id, { typeId, beam: { angle: fixtureType(typeId).beam } });
}

/** Where a light is, for the list of Allestimento. */
export type PlaceKey = { kind: "house" } | { kind: "truss"; trussId: Id } | { kind: "floatingStage" } | { kind: "floor" };

export function placeOf(f: Fixture, doc: Pick<GranveloDoc, "trusses">): PlaceKey {
  if (f.mount.kind === "truss" && doc.trusses.some((t) => t.id === (f.mount as { trussId: Id }).trussId)) return { kind: "truss", trussId: f.mount.trussId };
  if (f.mount.kind === "floor") return { kind: "floor" };
  return f.position.y < 0 ? { kind: "house" } : { kind: "floatingStage" };
}

export interface PlaceGroup {
  key: PlaceKey;
  fixtures: Fixture[];
}

/** Lights grouped by position: In sala, then the trusses front to back, then floating over the stage, then on the floor. Each group by number. */
export function fixturesByPlace(doc: Pick<GranveloDoc, "fixtures" | "trusses">): PlaceGroup[] {
  const sorted = [...doc.fixtures].sort((a, b) => a.number - b.number);
  const groups: PlaceGroup[] = [{ key: { kind: "house" }, fixtures: [] }];
  for (const t of trussesInOrder(doc)) groups.push({ key: { kind: "truss", trussId: t.id }, fixtures: [] });
  groups.push({ key: { kind: "floatingStage" }, fixtures: [] }, { key: { kind: "floor" }, fixtures: [] });
  const find = (k: PlaceKey) => groups.find((g) => g.key.kind === k.kind && (k.kind !== "truss" || (g.key as { trussId: Id }).trussId === k.trussId))!;
  for (const f of sorted) find(placeOf(f, doc)).fixtures.push(f);
  return groups.filter((g) => g.fixtures.length > 0);
}

/* ------------------------------------------------------------------ */
/* Memories                                                             */
/* ------------------------------------------------------------------ */

/** Removes a memory and takes it out of the sequence; the emergency memory falls back to "all white". */
export function removeMemory(doc: GranveloDoc, id: Id): GranveloDoc {
  return {
    ...doc,
    memories: doc.memories.filter((m) => m.id !== id),
    sequence: doc.sequence.filter((x) => x !== id),
    settings: doc.settings.emergencyMemoryId === id ? { ...doc.settings, emergencyMemoryId: null } : doc.settings,
  };
}

/** Adds a memory (its number must be free) at the end of the sequence. */
export function addMemory(doc: GranveloDoc, memory: Memory, inSequence = true): GranveloDoc {
  if (doc.memories.some((m) => m.number === memory.number || m.id === memory.id)) throw new Error(`Memory ${memory.number} already exists`);
  return { ...doc, memories: [...doc.memories, memory], sequence: inSequence ? [...doc.sequence, memory.id] : doc.sequence };
}

/* ------------------------------------------------------------------ */
/* Allestimento: lists, placement, adding and editing lights           */
/* ------------------------------------------------------------------ */

/** Where lights are placed when they are added (a truss that exists, or one of the free places). */
export type PlaceChoice = { kind: "house" } | { kind: "truss"; trussId: Id } | { kind: "floating" } | { kind: "floor" };

export interface Placement {
  mount: Mount;
  position: Vec3;
  aim: Vec3;
}

const sameChoice = (f: Fixture, doc: Pick<GranveloDoc, "trusses">, place: PlaceChoice): boolean => {
  const k = placeOf(f, doc);
  if (place.kind === "truss") return k.kind === "truss" && k.trussId === place.trussId;
  if (place.kind === "floating") return k.kind === "floatingStage";
  return k.kind === place.kind;
};

/**
 * Takes `count` of `slots` that are the farthest from the already used `taken` values (each taken value
 * removes the slot nearest to it); the rest, in order, are the places for the new lights.
 */
function freeSlots(slots: number[], taken: number[], count: number): number[] {
  const left = [...slots];
  for (const t of taken) {
    if (left.length <= count) break;
    let best = 0;
    for (let i = 1; i < left.length; i++) if (Math.abs(left[i] - t) < Math.abs(left[best] - t)) best = i;
    left.splice(best, 1);
  }
  return left.slice(0, count);
}

/** `n` centres of equal slots between `lo` and `hi`. */
const slotCentres = (n: number, lo: number, hi: number): number[] => Array.from({ length: n }, (_, i) => lo + ((i + 0.5) * (hi - lo)) / n);

/**
 * Believable first position, beam position and aim for `count` new lights at a place (10_granvelo.md:
 * "in sala puntano al proscenio (distribuite, non tutte al centro), sopra il palco a pioggia, i tagli orizzontali,
 * quelle sul fondo in controluce"). New lights are spread across the width of the stage (on the floor: along its
 * depth, alternating sides) and keep away from the lights that are already there. Pure: the 3D stage reuses it
 * for lights dropped without a precise position.
 */
export function defaultPlacement(doc: Pick<GranveloDoc, "stage" | "trusses" | "fixtures">, place: PlaceChoice, count: number): Placement[] {
  const { stage } = doc;
  const here = doc.fixtures.filter((f) => sameChoice(f, doc, place));
  const half = Math.max(0.5, stage.width / 2 - 0.6);
  const out: Placement[] = [];
  if (place.kind === "floor") {
    const ys = freeSlots(slotCentres(here.length + count, stage.depth * 0.1, stage.depth * 0.9), here.map((f) => f.position.y), count);
    ys.forEach((y, i) => {
      const side = (here.length + i) % 2 === 0 ? -1 : 1;
      const mount: Mount = { kind: "floor" };
      const position = { x: round2(side * (stage.width / 2 - 0.4)), y: round2(y), z: 0 };
      out.push({ mount, position, aim: defaultAim(position, mount, stage) });
    });
    return out;
  }
  const xs = freeSlots(slotCentres(here.length + count, -half, half), here.map((f) => f.position.x), count);
  let mount: Mount;
  let y: number;
  let z: number;
  if (place.kind === "truss") {
    const truss = doc.trusses.find((t) => t.id === place.trussId);
    mount = { kind: "truss", trussId: place.trussId };
    y = truss?.y ?? stage.depth / 2;
    z = truss?.z ?? stage.height;
  } else if (place.kind === "house") {
    mount = { kind: "floating" };
    y = here[0]?.position.y ?? -3;
    z = here[0]?.position.z ?? 3;
  } else {
    mount = { kind: "floating" };
    y = round2(stage.depth / 2);
    z = round2(stage.height * 0.8);
  }
  for (const x of xs) {
    const position = { x: round2(x), y: round2(y), z: round2(z) };
    out.push({ mount, position, aim: defaultAim(position, mount, stage) });
  }
  return out;
}

/** Depth and height for a new truss: the first free step of 1,5 m from the front, a little under the top of the stage. */
export function nextTrussSpot(doc: Pick<GranveloDoc, "stage" | "trusses">): { y: number; z: number } {
  const z = round2(Math.max(2, doc.stage.height - 0.5));
  for (let y = 1.5; y <= doc.stage.depth - 0.5; y += 1.5)
    if (!doc.trusses.some((t) => Math.abs(t.y - y) < 0.6)) return { y: round2(y), z };
  return { y: round2(doc.stage.depth / 2), z };
}

/** Adds a truss. Returns the document and its id. */
export function addTruss(doc: GranveloDoc, spot: { y: number; z: number; name?: string | null }): { doc: GranveloDoc; id: Id } {
  const truss: Truss = { id: uid(), name: spot.name?.trim() ? spot.name.trim() : null, y: round2(spot.y), z: round2(spot.z) };
  return { doc: { ...doc, trusses: [...doc.trusses, truss] }, id: truss.id };
}

/** Renames a truss; an empty name goes back to the automatic one ("1ª americana"). */
export function renameTruss(doc: GranveloDoc, id: Id, name: string): GranveloDoc {
  const next = name.trim() ? name.trim() : null;
  if (!doc.trusses.some((t) => t.id === id && t.name !== next)) return doc;
  return { ...doc, trusses: doc.trusses.map((t) => (t.id === id ? { ...t, name: next } : t)) };
}

/** Moves a truss (depth Y and/or height Z, metres): the lights on it follow. */
export function moveTruss(doc: GranveloDoc, id: Id, to: { y?: number; z?: number }): GranveloDoc {
  const t = doc.trusses.find((x) => x.id === id);
  if (!t) return doc;
  const y = to.y === undefined ? t.y : round2(to.y);
  const z = to.z === undefined ? t.z : round2(to.z);
  if (y === t.y && z === t.z) return doc;
  return {
    ...doc,
    trusses: doc.trusses.map((x) => (x.id === id ? { ...x, y, z } : x)),
    fixtures: doc.fixtures.map((f) => (f.mount.kind === "truss" && f.mount.trussId === id ? { ...f, position: { ...f.position, y, z } } : f)),
  };
}

/** Lights hanging on a truss. */
export function lightsOnTruss(doc: Pick<GranveloDoc, "fixtures">, id: Id): Fixture[] {
  return doc.fixtures.filter((f) => f.mount.kind === "truss" && f.mount.trussId === id);
}

/** Removes a truss; the lights that hung on it become floating at the same coordinates. */
export function removeTruss(doc: GranveloDoc, id: Id): GranveloDoc {
  if (!doc.trusses.some((t) => t.id === id)) return doc;
  return {
    ...doc,
    trusses: doc.trusses.filter((t) => t.id !== id),
    fixtures: doc.fixtures.map((f) => (f.mount.kind === "truss" && f.mount.trussId === id ? { ...f, mount: { kind: "floating" } as Mount } : f)),
  };
}

/** What the list of Allestimento shows: like `fixturesByPlace` but every truss appears, also without lights. */
export function listGroups(doc: Pick<GranveloDoc, "fixtures" | "trusses">): PlaceGroup[] {
  const filled = fixturesByPlace(doc);
  const out: PlaceGroup[] = [];
  const house = filled.find((g) => g.key.kind === "house");
  if (house) out.push(house);
  for (const t of trussesInOrder(doc)) out.push(filled.find((g) => g.key.kind === "truss" && g.key.trussId === t.id) ?? { key: { kind: "truss", trussId: t.id }, fixtures: [] });
  for (const k of ["floatingStage", "floor"] as const) {
    const g = filled.find((x) => x.key.kind === k);
    if (g) out.push(g);
  }
  return out;
}

/** The lights in the order of the list (top to bottom). */
export function listOrder(doc: Pick<GranveloDoc, "fixtures" | "trusses">): Id[] {
  return listGroups(doc).flatMap((g) => g.fixtures.map((f) => f.id));
}

/** Where `count` new lights go: a place that exists, or a new truss created for the occasion. */
export type AddPlace = PlaceChoice | { kind: "newTruss" };
/** First address of new lights: the first free ones, a given one (consecutive from there), or none. */
export type AddressStart = { kind: "next" } | { kind: "at"; address: number } | { kind: "none" };

export interface AddFixturesSpec {
  typeId: FixtureTypeId;
  /** 1–24 */
  count: number;
  /** "PAR" gives "PAR 1", "PAR 2"…; empty = no name (the list shows the type). */
  baseName: string;
  place: AddPlace;
  address: AddressStart;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Highest N among the lights named "<base> N". */
function highestSuffix(doc: Pick<GranveloDoc, "fixtures">, base: string): number {
  const re = new RegExp(`^${escapeRe(base)} (\\d+)$`);
  return doc.fixtures.reduce((n, f) => {
    const m = re.exec(f.name);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0);
}

/** The names `addFixtures` would give: "PAR 4", "PAR 5"… continuing after the existing ones (empty base = no names). */
export function autoNames(doc: Pick<GranveloDoc, "fixtures">, baseName: string, count: number): string[] {
  const base = baseName.trim();
  const first = highestSuffix(doc, base) + 1;
  return Array.from({ length: count }, (_, i) => (base ? `${base} ${first + i}` : ""));
}

/**
 * Adds several lights of one type with believable positions (`defaultPlacement`) and names ("PAR 1", "PAR 2"…,
 * continuing after the ones that exist). Addresses: `next` = each light takes the first free address after the
 * ones already taken; `at` = consecutive from the address given (a light that does not fit before 512 gets none).
 * Never changes the other lights.
 */
export function addFixtures(doc: GranveloDoc, spec: AddFixturesSpec): { doc: GranveloDoc; ids: Id[]; trussId: Id | null; unaddressed: number } {
  const count = Math.max(1, Math.min(24, Math.floor(spec.count)));
  let d = doc;
  let place: PlaceChoice;
  let trussId: Id | null = null;
  if (spec.place.kind === "newTruss") {
    const made = addTruss(d, nextTrussSpot(d));
    d = made.doc;
    trussId = made.id;
    place = { kind: "truss", trussId: made.id };
  } else place = spec.place;
  const placements = defaultPlacement(d, place, count);
  const base = spec.baseName.trim();
  const first = highestSuffix(d, base) + 1;
  const type = fixtureType(spec.typeId);
  const ids: Id[] = [];
  let unaddressed = 0;
  let cursor = spec.address.kind === "at" ? spec.address.address : 1;
  placements.forEach((p, i) => {
    const channels = defaultChannels(spec.typeId);
    let address: number | null = null;
    if (spec.address.kind === "next") address = nextFreeAddress(d, channels.length);
    else if (spec.address.kind === "at") {
      address = cursor >= 1 && cursor + channels.length - 1 <= 512 ? cursor : null;
      cursor += channels.length;
    }
    if (spec.address.kind !== "none" && address === null) unaddressed++;
    const f: Fixture = {
      id: uid(),
      number: nextFixtureNumber(d),
      name: base ? `${base} ${first + i}` : "",
      typeId: spec.typeId,
      universe: 1,
      address,
      channels,
      mount: p.mount,
      position: p.position,
      beam: { angle: type.beam },
      aim: p.aim,
      unused: false,
      broken: false,
    };
    d = { ...d, fixtures: [...d.fixtures, f] };
    ids.push(f.id);
  });
  return { doc: d, ids, trussId, unaddressed };
}

/** Removes several lights. The others keep their numbers and addresses. */
export function removeFixtures(doc: GranveloDoc, ids: Id[]): GranveloDoc {
  return ids.reduce((d, id) => removeFixture(d, id), doc);
}

/**
 * How many memories use these lights, i.e. have something other than zero on them: for a memory bound to the
 * lights, a value of the light; for a memory bound to addresses, a value on the channels the light occupies.
 * Used to ask before deleting. (Deleting is always safe: see `removeFixture`.)
 */
export function memoriesUsing(doc: Pick<GranveloDoc, "fixtures" | "memories">, ids: Id[]): number {
  const lights = doc.fixtures.filter((f) => ids.includes(f.id));
  return doc.memories.filter((m) => {
    if (m.state.binding === "fixture") {
      const fx = m.state.fixtures;
      return lights.some((f) => (fx[f.id] ?? []).some((v) => v > 0));
    }
    const dmx = m.state.dmx;
    return lights.some((f) => occupiedChannels(f).some((ch) => (dmx[ch - 1] ?? 0) > 0));
  }).length;
}

/** Name for a copy: "PAR 3" → "PAR 4" (after the highest one that exists); a name without number gets " 2". */
export function copyName(doc: Pick<GranveloDoc, "fixtures">, name: string): string {
  if (!name.trim()) return "";
  const m = /^(.*\D)\s+(\d+)$/.exec(name) ?? /^(.*\D)(\d+)$/.exec(name);
  if (!m) return `${name} 2`;
  return `${m[1].trimEnd()} ${highestSuffix(doc, m[1].trimEnd()) + 1}`;
}

/** Duplicates lights: same type, channels, place and aim, a little to the side, next free address, new number. */
export function duplicateFixtures(doc: GranveloDoc, ids: Id[]): { doc: GranveloDoc; ids: Id[] } {
  let d = doc;
  const created: Id[] = [];
  for (const src of doc.fixtures.filter((f) => ids.includes(f.id))) {
    const half = d.stage.width / 2;
    const dx = src.position.x + 0.5 > half ? -0.5 : 0.5;
    const channels = src.channels.map((c) => ({ ...c }));
    const copy: Fixture = {
      ...src,
      id: uid(),
      number: nextFixtureNumber(d),
      name: copyName(d, src.name),
      channels,
      address: src.address === null ? null : nextFreeAddress(d, channels.length),
      position: { ...src.position, x: round2(src.position.x + dx) },
      aim: { ...src.aim, x: round2(src.aim.x + dx) },
      broken: false,
    };
    d = { ...d, fixtures: [...d.fixtures, copy] };
    created.push(copy.id);
  }
  return { doc: d, ids: created };
}

/** Gives a light another number (positive whole number, not used by another light). Null if it cannot. */
export function setFixtureNumber(doc: GranveloDoc, id: Id, number: number): GranveloDoc | null {
  if (!Number.isInteger(number) || number < 1 || number > 99999) return null;
  if (doc.fixtures.some((f) => f.number === number && f.id !== id)) return null;
  return updateFixture(doc, id, { number });
}

/** The same change on several lights. */
export function updateFixtures(doc: GranveloDoc, ids: Id[], patch: Partial<Omit<Fixture, "id" | "channels" | "universe">>): GranveloDoc {
  return { ...doc, fixtures: doc.fixtures.map((f) => (ids.includes(f.id) ? { ...f, ...patch } : f)) };
}

/** Address of one light (null = none). Does not check conflicts: the interface says them. */
export function setFixtureAddress(doc: GranveloDoc, id: Id, address: number | null): GranveloDoc {
  if (address !== null && (!Number.isInteger(address) || address < 1 || address > 512)) return doc;
  return updateFixture(doc, id, { address });
}

/** "Primo indirizzo libero" for one light: the first place where all its channels are free (its own channels do not count). */
export function giveFirstFreeAddress(doc: GranveloDoc, id: Id): GranveloDoc {
  const f = doc.fixtures.find((x) => x.id === id);
  if (!f) return doc;
  const a = nextFreeAddress(doc, f.channels.length, 1, [id]);
  return a === null ? doc : updateFixture(doc, id, { address: a });
}

/** Changes the type of several lights (channels and beam go back to the defaults of the type). */
export function changeFixtureTypes(doc: GranveloDoc, ids: Id[], typeId: FixtureTypeId): GranveloDoc {
  return ids.reduce((d, id) => changeFixtureType(d, id, typeId), doc);
}

/** True if the channels of a light are not the default ones of its type (changing the type would lose the changes). */
export function channelsCustomised(f: Pick<Fixture, "typeId" | "channels">): boolean {
  return !sameLayout(f.channels, defaultChannels(f.typeId));
}

/** Where lights go with `setMount`. */
export type MountChoice = { kind: "truss"; trussId: Id } | { kind: "floating" } | { kind: "floor" };

/**
 * Hangs lights on a truss (they take its depth and height), leaves them floating (they keep their coordinates;
 * from the floor they rise to a height above the stage) or puts them on the floor (height 0).
 */
export function setMount(doc: GranveloDoc, ids: Id[], to: MountChoice): GranveloDoc {
  const truss = to.kind === "truss" ? doc.trusses.find((t) => t.id === to.trussId) : undefined;
  if (to.kind === "truss" && !truss) return doc;
  return {
    ...doc,
    fixtures: doc.fixtures.map((f) => {
      if (!ids.includes(f.id)) return f;
      if (to.kind === "truss") return { ...f, mount: { kind: "truss", trussId: to.trussId }, position: { ...f.position, y: truss!.y, z: truss!.z } };
      if (to.kind === "floor") return { ...f, mount: { kind: "floor" }, position: { ...f.position, z: 0 } };
      const z = f.mount.kind === "floor" && f.position.z < 0.5 ? round2(doc.stage.height * 0.8) : f.position.z;
      return { ...f, mount: { kind: "floating" }, position: { ...f.position, z } };
    }),
  };
}

/** Position in metres (any of x, y, z). On a truss the depth and height are the truss's: only x changes there. */
export function setPosition(doc: GranveloDoc, ids: Id[], patch: Partial<Vec3>): GranveloDoc {
  return {
    ...doc,
    fixtures: doc.fixtures.map((f) => {
      if (!ids.includes(f.id)) return f;
      const onTruss = f.mount.kind === "truss";
      const position = { x: patch.x ?? f.position.x, y: onTruss ? f.position.y : (patch.y ?? f.position.y), z: onTruss ? f.position.z : (patch.z ?? f.position.z) };
      return { ...f, position };
    }),
  };
}

/** The point the lights look at (any of x, y, z). */
export function setAim(doc: GranveloDoc, ids: Id[], patch: Partial<Vec3>): GranveloDoc {
  return { ...doc, fixtures: doc.fixtures.map((f) => (ids.includes(f.id) ? { ...f, aim: { x: patch.x ?? f.aim.x, y: patch.y ?? f.aim.y, z: patch.z ?? f.aim.z } } : f)) };
}

/** Full beam angle in degrees (0–180). */
export function setBeamAngle(doc: GranveloDoc, ids: Id[], angle: number): GranveloDoc {
  if (!Number.isFinite(angle)) return doc;
  const a = Math.min(180, Math.max(0, angle));
  return { ...doc, fixtures: doc.fixtures.map((f) => (ids.includes(f.id) ? { ...f, beam: { ...f.beam, angle: a } } : f)) };
}

/** "Non usata in questa produzione": stays in the drawing and keeps its addresses, sends nothing. */
export function setUnused(doc: GranveloDoc, ids: Id[], unused: boolean): GranveloDoc {
  return updateFixtures(doc, ids, { unused });
}

/** Size of the stage in metres. */
export function setStage(doc: GranveloDoc, stage: Stage): GranveloDoc {
  const ok = (v: number, max: number) => Number.isFinite(v) && v >= 0.5 && v <= max;
  if (!ok(stage.width, 200) || !ok(stage.depth, 200) || !ok(stage.height, 100)) return doc;
  if (stage.width === doc.stage.width && stage.depth === doc.stage.depth && stage.height === doc.stage.height) return doc;
  return { ...doc, stage: { ...stage } };
}

/* ---- channels of one light ---- */

/** Moves the channel at `from` to position `to` (0-based). The values of memories bound to lights follow the channel. */
export function moveChannel(doc: GranveloDoc, id: Id, from: number, to: number): GranveloDoc {
  const f = doc.fixtures.find((x) => x.id === id);
  if (!f || from === to || from < 0 || to < 0 || from >= f.channels.length || to >= f.channels.length) return doc;
  const next = f.channels.map((c) => ({ ...c }));
  const [c] = next.splice(from, 1);
  next.splice(to, 0, c);
  return setFixtureChannels(doc, id, next);
}

/** Adds a channel at the end: the first function the light does not have yet among Main/Strobe/Other. */
export function addChannel(doc: GranveloDoc, id: Id, fn?: ChannelFunction): GranveloDoc {
  const f = doc.fixtures.find((x) => x.id === id);
  if (!f || f.channels.length >= 64) return doc;
  const has = (x: ChannelFunction) => f.channels.some((c) => c.function === x);
  const pick: ChannelFunction = fn ?? (!has("dimmer") ? "dimmer" : !has("strobe") ? "strobe" : "other");
  return setFixtureChannels(doc, id, [...f.channels.map((c) => ({ ...c })), { function: pick }]);
}

/** Removes a channel (a light keeps at least one). */
export function removeChannel(doc: GranveloDoc, id: Id, index: number): GranveloDoc {
  const f = doc.fixtures.find((x) => x.id === id);
  if (!f || f.channels.length <= 1 || index < 0 || index >= f.channels.length) return doc;
  return setFixtureChannels(doc, id, f.channels.filter((_, i) => i !== index).map((c) => ({ ...c })));
}

/** Function and/or label of one channel. An empty label removes it. */
export function setChannel(doc: GranveloDoc, id: Id, index: number, patch: { function?: ChannelFunction; label?: string }): GranveloDoc {
  const f = doc.fixtures.find((x) => x.id === id);
  if (!f || index < 0 || index >= f.channels.length) return doc;
  if (patch.function !== undefined && !CHANNEL_FUNCTIONS.includes(patch.function)) return doc;
  const next = f.channels.map((c, i) => {
    if (i !== index) return { ...c };
    const fn = patch.function ?? c.function;
    const label = patch.label === undefined ? c.label : patch.label.trim();
    return label ? { function: fn, label } : { function: fn };
  });
  return setFixtureChannels(doc, id, next);
}

/** The other lights of the same type whose channels differ from those of `id` ("Applica a tutte le luci di questo tipo" would change them). */
export function lightsToSync(doc: Pick<GranveloDoc, "fixtures">, id: Id): Id[] {
  const src = doc.fixtures.find((x) => x.id === id);
  if (!src) return [];
  return doc.fixtures.filter((f) => f.typeId === src.typeId && f.id !== id && !sameLayout(f.channels, src.channels)).map((f) => f.id);
}

/* ------------------------------------------------------------------ */
/* The stage: dragging lights, aiming, scenery                          */
/* ------------------------------------------------------------------ */

/**
 * "Sposta" on the stage: each light goes to the point given (metres) and is hung, left floating or put on the floor
 * by the rules of `resolveDrop` (stage/geometry.ts): a truss nearby catches it, a light left high over the stage where
 * there is no truss creates one (the next lights of the same drop are caught by it), near the floor it stands on the
 * floor. The aim does not change. One call = one step of undo.
 */
export function dropLights(doc: GranveloDoc, moves: { id: Id; to: Vec3 }[]): { doc: GranveloDoc; newTrusses: Id[] } {
  let d = doc;
  const newTrusses: Id[] = [];
  for (const m of moves) {
    const f = d.fixtures.find((x) => x.id === m.id);
    if (!f || ![m.to.x, m.to.y, m.to.z].every(Number.isFinite)) continue;
    const drop = resolveDrop(d, f.mount, m.to);
    let mount: Mount;
    let position = drop.position;
    if (drop.mount.kind === "newTruss") {
      const made = addTruss(d, { y: drop.mount.y, z: drop.mount.z });
      d = made.doc;
      newTrusses.push(made.id);
      mount = { kind: "truss", trussId: made.id };
      position = { ...position, y: round2(drop.mount.y), z: round2(drop.mount.z) };
    } else mount = drop.mount;
    d = { ...d, fixtures: d.fixtures.map((x) => (x.id === m.id ? { ...x, mount, position } : x)) };
  }
  return { doc: d, newTrusses };
}

/** "Orienta": the aim point of each light given (metres). */
export function setAims(doc: GranveloDoc, aims: Record<Id, Vec3>): GranveloDoc {
  if (!Object.keys(aims).length) return doc;
  return {
    ...doc,
    fixtures: doc.fixtures.map((f) => {
      const a = aims[f.id];
      if (!a || ![a.x, a.y, a.z].every(Number.isFinite)) return f;
      return { ...f, aim: { x: round2(a.x), y: round2(a.y), z: round2(a.z) } };
    }),
  };
}

/** "Puntamento predefinito": the lights point again where a light in their place usually points (`defaultAim`). */
export function resetAim(doc: GranveloDoc, ids: Id[]): GranveloDoc {
  return {
    ...doc,
    fixtures: doc.fixtures.map((f) => {
      if (!ids.includes(f.id)) return f;
      const pos = f.mount.kind === "truss" ? { ...f.position, ...(doc.trusses.find((t) => t.id === (f.mount as { trussId: Id }).trussId) ?? {}) } : f.position;
      return { ...f, aim: defaultAim({ x: pos.x, y: pos.y, z: pos.z }, f.mount, doc.stage) };
    }),
  };
}

/** Name for a new piece: "Parallelepipedo 2"… continuing after the existing ones (`base` is already translated). */
export function sceneryName(doc: Pick<GranveloDoc, "scenery">, base: string): string {
  const re = new RegExp(`^${escapeRe(base)} (\\d+)$`);
  const n = doc.scenery.reduce((m, s) => {
    const x = re.exec(s.name);
    return x ? Math.max(m, Number(x[1])) : s.name === base ? Math.max(m, 1) : m;
  }, 0);
  return n === 0 ? base : `${base} ${n + 1}`;
}

/** Adds a scenery piece of a shape, by default on the floor at the centre of the stage. Returns the document and its id. */
export function addScenery(doc: GranveloDoc, spec: { shape: SceneryShape; name: string; position?: Partial<Vec3>; color?: string }): { doc: GranveloDoc; id: Id } {
  const piece: Scenery = {
    id: uid(),
    name: spec.name,
    shape: spec.shape,
    position: { x: round2(spec.position?.x ?? 0), y: round2(spec.position?.y ?? doc.stage.depth / 2), z: round2(spec.position?.z ?? 0) },
    rotation: { x: 0, y: 0, z: 0 },
    size: defaultScenerySize(spec.shape),
    color: spec.color ?? "#8A8F9C",
  };
  return { doc: { ...doc, scenery: [...doc.scenery, piece] }, id: piece.id };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const finiteVec = (v: Vec3) => [v.x, v.y, v.z].every(Number.isFinite);

/**
 * Changes a scenery piece: name, shape, position, rotation (degrees, kept in −180…180), size (metres, ≥ 0, at most 100)
 * or colour (`#rrggbb`). Values that make no sense are ignored.
 */
export function updateScenery(doc: GranveloDoc, id: Id, patch: Partial<Omit<Scenery, "id">>): GranveloDoc {
  const s = doc.scenery.find((x) => x.id === id);
  if (!s) return doc;
  const next: Scenery = { ...s };
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.shape !== undefined) next.shape = patch.shape;
  if (patch.position && finiteVec(patch.position)) next.position = { x: round2(patch.position.x), y: round2(patch.position.y), z: round2(Math.max(-50, patch.position.z)) };
  if (patch.rotation && finiteVec(patch.rotation)) {
    const wrap = (a: number) => round2(((((a + 180) % 360) + 360) % 360) - 180);
    next.rotation = { x: wrap(patch.rotation.x), y: wrap(patch.rotation.y), z: wrap(patch.rotation.z) };
  }
  if (patch.size && finiteVec(patch.size)) {
    const c = (v: number) => round2(Math.min(100, Math.max(0, v)));
    next.size = { x: c(patch.size.x), y: c(patch.size.y), z: c(patch.size.z) };
  }
  if (patch.color !== undefined && HEX.test(patch.color)) next.color = patch.color.toUpperCase();
  return { ...doc, scenery: doc.scenery.map((x) => (x.id === id ? next : x)) };
}

/** Removes a scenery piece, also from the memories that had it on stage. */
export function removeScenery(doc: GranveloDoc, id: Id): GranveloDoc {
  if (!doc.scenery.some((s) => s.id === id)) return doc;
  return {
    ...doc,
    scenery: doc.scenery.filter((s) => s.id !== id),
    memories: doc.memories.map((m) => (m.scenery.some((p) => p.sceneryId === id) ? { ...m, scenery: m.scenery.filter((p) => p.sceneryId !== id) } : m)),
  };
}
