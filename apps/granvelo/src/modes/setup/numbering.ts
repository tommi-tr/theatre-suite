import { fits } from "../../model/addresses";
import type { GranveloDoc, Id } from "../../model/types";

/**
 * "Numera a clic": the state machine of numbering lights by clicking them in order. Pure (no React): the list
 * of lights uses it now, the 3D stage will use the same one for clicks on the stage.
 *
 * You choose the first address, then click lights one after the other: each click gives the clicked light the
 * next address (the channels of the previous light are skipped). Conflicts with lights that have not been
 * renumbered yet are allowed (the interface shows them in amber). Each click is one change of the document (one
 * step of undo); `undoLast` takes back the last click.
 */

export interface NumberingStep {
  id: Id;
  /** Address before the click (null = none). */
  previous: number | null;
  /** Address given. */
  address: number;
}

export interface NumberingState {
  /** Address the next clicked light will get. */
  next: number;
  /** Clicks so far, oldest first. */
  steps: NumberingStep[];
}

export type ClickResult =
  | { kind: "assigned"; address: number }
  /** Clicked again in the same run: nothing changes. */
  | { kind: "already" }
  /** The light would not fit before channel 512: nothing changes. */
  | { kind: "noRoom" }
  | { kind: "missing" };

export function startNumbering(start: number): NumberingState {
  return { next: Math.min(512, Math.max(1, Math.floor(start) || 1)), steps: [] };
}

/** A click on a light: it gets `state.next`. Returns the new document and state (the same objects if nothing changed). */
export function clickLight(doc: GranveloDoc, state: NumberingState, id: Id): { doc: GranveloDoc; state: NumberingState; result: ClickResult } {
  const f = doc.fixtures.find((x) => x.id === id);
  if (!f) return { doc, state, result: { kind: "missing" } };
  if (state.steps.some((s) => s.id === id)) return { doc, state, result: { kind: "already" } };
  const n = Math.max(1, f.channels.length);
  if (!fits(state.next, n)) return { doc, state, result: { kind: "noRoom" } };
  const address = state.next;
  return {
    doc: { ...doc, fixtures: doc.fixtures.map((x) => (x.id === id ? { ...x, address } : x)) },
    state: { next: address + n, steps: [...state.steps, { id, previous: f.address, address }] },
    result: { kind: "assigned", address },
  };
}

/** Takes back the last click (the light gets its old address again, `next` goes back). Nothing to take back = same objects. */
export function undoLast(doc: GranveloDoc, state: NumberingState): { doc: GranveloDoc; state: NumberingState; undone: Id | null } {
  const last = state.steps[state.steps.length - 1];
  if (!last) return { doc, state, undone: null };
  return {
    doc: { ...doc, fixtures: doc.fixtures.map((x) => (x.id === last.id ? { ...x, address: last.previous } : x)) },
    state: { next: last.address, steps: state.steps.slice(0, -1) },
    undone: last.id,
  };
}

/** Lights already numbered in this run, and the address each got. */
export function numberedInRun(state: NumberingState): Map<Id, number> {
  return new Map(state.steps.map((s) => [s.id, s.address]));
}

/** Can another light of `channels` channels still be numbered? */
export function hasRoom(state: NumberingState, channels = 1): boolean {
  return fits(state.next, channels);
}
