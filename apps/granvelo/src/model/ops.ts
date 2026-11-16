import { uid } from "@theatre-suite/core";
import { defaultChannels, fixtureType } from "./fixtureTypes";
import { nextFreeAddress } from "./addresses";
import { valuesOf } from "./universe";
import type { Channel, Fixture, FixtureTypeId, GranveloDoc, Id, Memory, Mount, Stage, Truss, Vec3 } from "./types";

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

/**
 * Default aim (10_granvelo.md): in the house they point at the proscenium, spread (not all at the centre);
 * on the floor they cut across horizontally; at the back they are backlights; elsewhere above the stage they
 * point straight down.
 */
export function defaultAim(position: Vec3, mount: Mount, stage: Stage): Vec3 {
  const half = stage.width / 2;
  if (position.y < 0) return { x: round2(Math.max(-half * 0.7, Math.min(half * 0.7, position.x * 0.6))), y: round2(Math.min(1.5, stage.depth / 3)), z: 1.6 };
  if (mount.kind === "floor") return { x: position.x <= 0 ? round2(half) : round2(-half), y: position.y, z: position.z };
  if (position.y > stage.depth * 0.7) return { x: position.x, y: round2(Math.max(0, position.y - 2.5)), z: 1.5 };
  return { x: position.x, y: position.y, z: 0 };
}

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
