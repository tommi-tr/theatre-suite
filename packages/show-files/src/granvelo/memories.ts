import { occupiedChannels } from "./addresses";
import { intensityIndexes, patchValues, readValues, valuesOf } from "./universe";
import { DMX_MAX, UNIVERSE_SIZE, type FixtureValues, type GranveloDoc, type Memory, type MemoryBinding, type MemoryState } from "./types";

/**
 * Memory states and the two bindings (see `MemoryState` in types.ts).
 *
 * Whatever the binding, the rest of the app reads a memory through two functions:
 * - `stateValues`: the values of each light (for the faders of the desk);
 * - `stateUniverse`: the 512 raw values before the masters (for the output and the crossfade).
 * and writes one with `captureState`.
 *
 * Switching the document setting (`setMemoryBinding`) converts every memory with the patch **as it is now**:
 * - address → fixture: each light takes the values found at its channels. Values on channels that no light
 *   occupies are dropped (there is no light to keep them); the Settings explain this before switching.
 * - fixture → address: the values of the used lights are written at their addresses (higher value wins on a
 *   conflict), then lights not used in this production fill only the channels no used light occupies.
 *   Lights without an address are dropped.
 * Converting back and forth is lossless as long as every light has an address and there are no conflicts.
 */

const clamp = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(DMX_MAX, Math.max(0, Math.floor(v + 0.5))) : 0);

export function emptyState(binding: MemoryBinding): MemoryState {
  return binding === "address" ? { binding, dmx: new Array<number>(UNIVERSE_SIZE).fill(0) } : { binding, fixtures: {} };
}

/** Values of each light in a memory (every light of the document gets an entry). */
export function stateValues(doc: Pick<GranveloDoc, "fixtures">, state: MemoryState): FixtureValues {
  if (state.binding === "address") return readValues(doc, state.dmx);
  const out: FixtureValues = {};
  for (const f of doc.fixtures) out[f.id] = valuesOf(f, state.fixtures);
  return out;
}

/** The 512 raw values of a memory, before groups and Grand Master. */
export function stateUniverse(doc: Pick<GranveloDoc, "fixtures">, state: MemoryState): Uint8Array {
  if (state.binding === "address") return Uint8Array.from(state.dmx.slice(0, UNIVERSE_SIZE), clamp);
  return patchValues(doc, state.fixtures);
}

/**
 * Makes the state to save in a memory from the values of the lights.
 * In `address` binding the channels no used light occupies keep the values of `base` (the memory being
 * overwritten), so saving never loses them.
 */
export function captureState(doc: Pick<GranveloDoc, "fixtures">, values: FixtureValues, binding: MemoryBinding, base?: MemoryState): MemoryState {
  if (binding === "fixture") {
    const fixtures: FixtureValues = {};
    for (const f of doc.fixtures) fixtures[f.id] = valuesOf(f, values);
    return { binding, fixtures };
  }
  const dmx = base?.binding === "address" ? base.dmx.slice(0, UNIVERSE_SIZE).map(clamp) : new Array<number>(UNIVERSE_SIZE).fill(0);
  while (dmx.length < UNIVERSE_SIZE) dmx.push(0);
  const patched = patchValues(doc, values);
  for (const f of doc.fixtures) if (!f.unused) for (const ch of occupiedChannels(f)) dmx[ch - 1] = patched[ch - 1];
  return { binding, dmx };
}

/** Converts one state to the other binding with the current patch (rules at the top of the file). */
export function convertState(doc: Pick<GranveloDoc, "fixtures">, state: MemoryState, to: MemoryBinding): MemoryState {
  if (state.binding === to) return state;
  if (to === "fixture") return { binding: "fixture", fixtures: stateValues(doc, state) };
  const fixtures = state.binding === "fixture" ? state.fixtures : {};
  const dmx = Array.from(patchValues(doc, fixtures));
  const usedChannels = new Set<number>();
  for (const f of doc.fixtures) if (!f.unused) for (const ch of occupiedChannels(f)) usedChannels.add(ch);
  for (const f of doc.fixtures) {
    if (!f.unused) continue;
    const v = valuesOf(f, fixtures);
    occupiedChannels(f).forEach((ch, i) => {
      if (!usedChannels.has(ch)) dmx[ch - 1] = Math.max(dmx[ch - 1], v[i]);
    });
  }
  return { binding: "address", dmx };
}

/** Changes the document setting and converts every memory. */
export function setMemoryBinding(doc: GranveloDoc, to: MemoryBinding): GranveloDoc {
  if (doc.settings.memoryBinding === to) return doc;
  return {
    ...doc,
    settings: { ...doc.settings, memoryBinding: to },
    memories: doc.memories.map((m) => ({ ...m, state: convertState(doc, m.state, to) })),
  };
}

/** Number for a new memory: one more than the highest. */
export function nextMemoryNumber(doc: Pick<GranveloDoc, "memories">): number {
  return doc.memories.reduce((n, m) => Math.max(n, m.number), 0) + 1;
}

/** Memories in show order (those in the sequence first, then the others by number). */
export function memoriesInOrder(doc: Pick<GranveloDoc, "memories" | "sequence">): Memory[] {
  const byId = new Map(doc.memories.map((m) => [m.id, m]));
  const inSeq = doc.sequence.map((id) => byId.get(id)).filter((m): m is Memory => !!m);
  const rest = doc.memories.filter((m) => !doc.sequence.includes(m.id)).sort((a, b) => a.number - b.number);
  return [...inSeq, ...rest];
}

/** How many used lights give light (some intensity channel above zero) in a memory: for lists and summaries. */
export function litCount(doc: Pick<GranveloDoc, "fixtures">, state: MemoryState): number {
  const values = stateValues(doc, state);
  return doc.fixtures.filter((f) => !f.unused && intensityIndexes(f).some((i) => (values[f.id]?.[i] ?? 0) > 0)).length;
}
