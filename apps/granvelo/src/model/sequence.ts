import type { GranveloDoc, Id, Memory, Transition } from "./types";

/**
 * The sequence of the show (`doc.sequence`: memory ids in show order, a memory may be left out) and the transition of
 * each memory, as pure document operations. Show and Banco change the order only through these.
 *
 * The transition of a memory is how the stage goes **to** that memory (see crossfade.ts). Times are seconds, cleaned
 * here to 0 … `MAX_TRANSITION` with one decimal, so a typed "abc" or "-3" never reaches the file nor the engine.
 */

/** The longest time that can be typed for a transition (10 minutes). */
export const MAX_TRANSITION = 600;

/** A typed time made safe: not a number → `fallback`, clamped to 0…MAX_TRANSITION, one decimal. */
export function cleanTime(v: unknown, fallback = 0): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.round(Math.min(MAX_TRANSITION, Math.max(0, n)) * 10) / 10;
}

/** The memories of the sequence, in show order (ids that point nowhere are skipped). */
export function sequenceMemories(doc: Pick<GranveloDoc, "memories" | "sequence">): Memory[] {
  const byId = new Map(doc.memories.map((m) => [m.id, m]));
  return doc.sequence.map((id) => byId.get(id)).filter((m): m is Memory => !!m);
}

/** Moves a memory of the sequence by `delta` places (−1 = earlier). Unchanged if it is not in the sequence or at the edge. */
export function moveInSequence(doc: GranveloDoc, id: Id, delta: number): GranveloDoc {
  const i = doc.sequence.indexOf(id);
  if (i < 0 || !Number.isInteger(delta) || delta === 0) return doc;
  const j = Math.max(0, Math.min(doc.sequence.length - 1, i + delta));
  if (j === i) return doc;
  const seq = doc.sequence.filter((x) => x !== id);
  seq.splice(j, 0, id);
  return { ...doc, sequence: seq };
}

/**
 * Puts a memory in the sequence (at `index`, default at the end) or takes it out. A memory taken out stays in the
 * show (Banco, Blind), it is only skipped by GO.
 */
export function setInSequence(doc: GranveloDoc, id: Id, on: boolean, index?: number): GranveloDoc {
  if (!doc.memories.some((m) => m.id === id)) return doc;
  const has = doc.sequence.includes(id);
  if (!on) return has ? { ...doc, sequence: doc.sequence.filter((x) => x !== id) } : doc;
  if (has) return doc;
  const seq = [...doc.sequence];
  const at = index === undefined ? seq.length : Math.max(0, Math.min(seq.length, Math.round(index)));
  seq.splice(at, 0, id);
  return { ...doc, sequence: seq };
}

/** Changes the transition of a memory; times are cleaned (see `cleanTime`). Unchanged when nothing changes. */
export function setTransition(doc: GranveloDoc, id: Id, patch: Partial<Transition>): GranveloDoc {
  const m = doc.memories.find((x) => x.id === id);
  if (!m) return doc;
  const cur = m.transition;
  const next: Transition = {
    fadeIn: patch.fadeIn === undefined ? cur.fadeIn : cleanTime(patch.fadeIn, cur.fadeIn),
    fadeOut: patch.fadeOut === undefined ? cur.fadeOut : cleanTime(patch.fadeOut, cur.fadeOut),
    delay: patch.delay === undefined ? cur.delay : cleanTime(patch.delay, cur.delay),
    autoFollow: patch.autoFollow === undefined ? cur.autoFollow : !!patch.autoFollow,
    moveInDark: patch.moveInDark === undefined ? cur.moveInDark : !!patch.moveInDark,
  };
  if (next.fadeIn === cur.fadeIn && next.fadeOut === cur.fadeOut && next.delay === cur.delay && next.autoFollow === cur.autoFollow && next.moveInDark === cur.moveInDark) return doc;
  return { ...doc, memories: doc.memories.map((x) => (x.id === id ? { ...x, transition: next } : x)) };
}

/** Same time up and down ("crossfade"): sets both. */
export const setCrossfade = (doc: GranveloDoc, id: Id, seconds: number): GranveloDoc => setTransition(doc, id, { fadeIn: seconds, fadeOut: seconds });
