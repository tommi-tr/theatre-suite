import { uid } from "@theatre-suite/core";
import { COLOR_FUNCTIONS } from "./fixtureTypes";
import { captureState, stateValues, nextMemoryNumber } from "./memories";
import { addMemory } from "./ops";
import { applyMasters, intensityIndexes, patchValues, parseHex, rgbToHex, setColor, valuesOf, visibleLight, type Rgb } from "./universe";
import { DMX_MAX, type Fixture, type FixtureValues, type GranveloDoc, type Group, type Id, type Memory, type MemoryBinding } from "./types";

/**
 * The pure part of the virtual desk (Banco, and Show in the next phase): the values "on the faders", what they make
 * go out, how they compare with a memory, groups, memory edits and the colour picker. No React, no stores.
 *
 * The values of the faders are `FixtureValues` (per light id, one 0–255 value per channel position), as in a memory
 * bound to the lights: they follow a light when its address changes, and are reconciled when the patch changes.
 */

const clamp = (v: number) => (Number.isFinite(v) ? Math.min(DMX_MAX, Math.max(0, Math.floor(v + 0.5))) : 0);

/** Every light at zero. */
export function emptyValues(doc: Pick<GranveloDoc, "fixtures">): FixtureValues {
  const out: FixtureValues = {};
  for (const f of doc.fixtures) out[f.id] = f.channels.map(() => 0);
  return out;
}

/**
 * The values kept for the lights that are still there, with the right number of channels (new channels at 0, lights that
 * are gone dropped). Returns `values` itself when nothing needs to change.
 */
export function reconcileValues(doc: Pick<GranveloDoc, "fixtures">, values: FixtureValues): FixtureValues {
  let same = Object.keys(values).length === doc.fixtures.length;
  const out: FixtureValues = {};
  for (const f of doc.fixtures) {
    const v = values[f.id];
    if (!v || v.length !== f.channels.length) same = false;
    out[f.id] = valuesOf(f, values);
  }
  return same ? values : out;
}

/** A copy of the values with one channel changed (the other lights keep their arrays: cheap, and `===` still works). */
export function withChannel(values: FixtureValues, f: Pick<Fixture, "id" | "channels">, index: number, value: number): FixtureValues {
  if (index < 0 || index >= f.channels.length) return values;
  const row = valuesOf(f as Fixture, values);
  const v = clamp(value);
  if (row[index] === v && values[f.id]?.length === row.length) return values;
  row[index] = v;
  return { ...values, [f.id]: row };
}

/** The 512 values for the lights: patch → groups. **The Grand Master is not applied** (the engine does it, see output.ts). */
export function deskUniverse(doc: Pick<GranveloDoc, "fixtures" | "groups">, values: FixtureValues): Uint8Array {
  return applyMasters(doc, patchValues(doc, values), { grandMaster: DMX_MAX });
}

/** What the lights really make, to draw on the screen: like `deskUniverse` with the Grand Master (0–255) applied. */
export function shownUniverse(doc: Pick<GranveloDoc, "fixtures" | "groups">, values: FixtureValues, grandMaster: number): Uint8Array {
  return applyMasters(doc, patchValues(doc, values), { grandMaster });
}

/**
 * Do the faders differ from a memory? Only what a memory can hold counts: lights not used in this production are
 * ignored, and in a memory bound to addresses so are lights without an address (they send nothing, the memory cannot
 * remember them).
 */
export function valuesDiffer(doc: Pick<GranveloDoc, "fixtures">, values: FixtureValues, memory: Pick<Memory, "state">): boolean {
  const saved = stateValues(doc, memory.state);
  for (const f of doc.fixtures) {
    if (f.unused) continue;
    if (memory.state.binding === "address" && f.address === null) continue;
    const a = valuesOf(f, values);
    const b = valuesOf(f, saved);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  }
  return false;
}

/** The values of a memory, as the faders show them. */
export const memoryValues = (doc: Pick<GranveloDoc, "fixtures">, memory: Pick<Memory, "state">): FixtureValues => stateValues(doc, memory.state);

/* ------------------------------------------------------------------ */
/* One intensity per light (the "compact" density)                      */
/* ------------------------------------------------------------------ */

/** Level of the light (0–255): the highest of its intensity channels. */
export function intensityOf(f: Pick<Fixture, "channels">, row: readonly number[]): number {
  return intensityIndexes(f).reduce((m, i) => Math.max(m, row[i] ?? 0), 0);
}

/**
 * Sets the level of a light: every `dimmer` channel to `level`; a light without a dimmer scales its colours together,
 * keeping the colour (all colours at `level` = white when they were all at zero).
 */
export function withIntensity(f: Pick<Fixture, "channels">, row: readonly number[], level: number): number[] {
  const idx = intensityIndexes(f);
  const lv = clamp(level);
  const out = f.channels.map((_, i) => clamp(row[i] ?? 0));
  if (idx.length === 0) return out;
  if (f.channels.some((c) => c.function === "dimmer")) {
    for (const i of idx) out[i] = lv;
    return out;
  }
  const peak = Math.max(...idx.map((i) => out[i]));
  for (const i of idx) out[i] = peak === 0 ? lv : clamp((out[i] * lv) / peak);
  return out;
}

/* ------------------------------------------------------------------ */
/* Colour picker                                                        */
/* ------------------------------------------------------------------ */

/** Does the light have red, green and blue (so the colour picker can set its colour)? */
export const hasColorPicker = (f: Pick<Fixture, "channels" | "unused">): boolean =>
  !f.unused && ["red", "green", "blue"].every((fn) => f.channels.some((c) => c.function === fn));

/** The colour of a light as the picker shows it (`#RRGGBB`, at full brightness), from its values. */
export function pickerColor(f: Pick<Fixture, "channels" | "typeId">, row: readonly number[]): string {
  const colourOnly = f.channels.map((c, i) => (COLOR_FUNCTIONS.includes(c.function) ? (row[i] ?? 0) : 0));
  const dim = f.channels.map((c, i) => (c.function === "dimmer" ? DMX_MAX : COLOR_FUNCTIONS.includes(c.function) ? colourOnly[i] : (row[i] ?? 0)));
  const v = visibleLight(f, dim);
  return v.hue ?? "#FFFFFF";
}

/** Sets the colour on every light with a colour picker among `ids`; the others are not touched. */
export function applyColor(doc: Pick<GranveloDoc, "fixtures">, values: FixtureValues, ids: readonly Id[], hex: string): FixtureValues {
  const rgb = parseHex(hex);
  if (!rgb) return values;
  const want = new Set(ids);
  let out = values;
  for (const f of doc.fixtures) {
    if (!want.has(f.id) || !hasColorPicker(f)) continue;
    const row = setColor(f, valuesOf(f, out), rgb as Rgb);
    out = { ...out, [f.id]: row };
  }
  return out;
}

export { rgbToHex };

/* ------------------------------------------------------------------ */
/* Groups                                                               */
/* ------------------------------------------------------------------ */

export function addGroup(doc: GranveloDoc, name: string, fixtureIds: readonly Id[]): { doc: GranveloDoc; id: Id } {
  const known = new Set(doc.fixtures.map((f) => f.id));
  const group: Group = { id: uid(), name: name.trim(), fixtureIds: [...new Set(fixtureIds)].filter((id) => known.has(id)), level: DMX_MAX };
  return { doc: { ...doc, groups: [...doc.groups, group] }, id: group.id };
}

export function renameGroup(doc: GranveloDoc, id: Id, name: string): GranveloDoc {
  return { ...doc, groups: doc.groups.map((g) => (g.id === id ? { ...g, name: name.trim() } : g)) };
}

export function removeGroup(doc: GranveloDoc, id: Id): GranveloDoc {
  return { ...doc, groups: doc.groups.filter((g) => g.id !== id) };
}

export function setGroupLevel(doc: GranveloDoc, id: Id, level: number): GranveloDoc {
  const v = clamp(level);
  const g = doc.groups.find((x) => x.id === id);
  if (!g || g.level === v) return doc;
  return { ...doc, groups: doc.groups.map((x) => (x.id === id ? { ...x, level: v } : x)) };
}

/* ------------------------------------------------------------------ */
/* Memories                                                             */
/* ------------------------------------------------------------------ */

/** Is `n` a number a memory can have (positive integer) and free (other than `exceptId`)? */
export function memoryNumberFree(doc: Pick<GranveloDoc, "memories">, n: number, exceptId?: Id): boolean {
  return Number.isInteger(n) && n > 0 && !doc.memories.some((m) => m.number === n && m.id !== exceptId);
}

export function renameMemory(doc: GranveloDoc, id: Id, label: string): GranveloDoc {
  return { ...doc, memories: doc.memories.map((m) => (m.id === id ? { ...m, label: label.trim() } : m)) };
}

/** Changes the number of a memory; null if the number is not a free positive integer. */
export function setMemoryNumber(doc: GranveloDoc, id: Id, number: number): GranveloDoc | null {
  if (!memoryNumberFree(doc, number, id)) return null;
  return { ...doc, memories: doc.memories.map((m) => (m.id === id ? { ...m, number } : m)) };
}

/** "Salva": the faders become the state of the memory (scenery placements, label and transition stay as they are). */
export function saveMemoryValues(doc: GranveloDoc, id: Id, values: FixtureValues): GranveloDoc {
  return {
    ...doc,
    memories: doc.memories.map((m) => (m.id === id ? { ...m, state: captureState(doc, values, doc.settings.memoryBinding as MemoryBinding, m.state) } : m)),
  };
}

/** "Salva come nuova": a new memory at the end of the sequence, with the document's default crossfade. Null if the number is taken. */
export function saveNewMemory(doc: GranveloDoc, values: FixtureValues, number: number, label: string, scenery: Memory["scenery"] = []): { doc: GranveloDoc; id: Id } | null {
  if (!memoryNumberFree(doc, number)) return null;
  const t = Math.max(0, doc.settings.defaultCrossfade);
  const memory: Memory = {
    id: uid(),
    number,
    label: label.trim(),
    note: "",
    state: captureState(doc, values, doc.settings.memoryBinding),
    scenery,
    transition: { fadeIn: t, fadeOut: t, delay: 0, autoFollow: false, moveInDark: false },
  };
  return { doc: addMemory(doc, memory), id: memory.id };
}

/** The number proposed for a new memory. */
export const proposedMemoryNumber = nextMemoryNumber;
