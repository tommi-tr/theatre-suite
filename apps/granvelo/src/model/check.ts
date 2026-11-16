import { addressProblems, lastChannel, occupiedChannels } from "./addresses";
import { COLOR_FUNCTIONS } from "./fixtureTypes";
import { intensityIndexes } from "./universe";
import { DMX_MAX, UNIVERSE_SIZE, type Fixture, type GranveloDoc, type Id } from "./types";

/**
 * "Controllo luci": the person who has just hung the lights checks, one by one, that each answers at its address.
 * Pure rules (no React, no output): which lights are visited and in what order, what one light gets on the
 * cable, and the state of a run (position, verdicts). The dialog (`modes/check`) only draws it and sends it
 * through the output store.
 */

/** The colour a colour light is asked to make. */
export type CheckColor = "white" | "red" | "green" | "blue";
export const CHECK_COLORS: CheckColor[] = ["white", "red", "green", "blue"];

/** Value of the centre of the range of a position channel (coarse); the fine channel stays at 0. */
export const CENTRE = 127;

const clamp = (v: number) => Math.min(DMX_MAX, Math.max(0, Math.floor(v + 0.5)));

/** Does the light have colour channels (red, green, blue, white, amber or UV)? */
export const hasColorChannels = (f: Pick<Fixture, "channels">): boolean => f.channels.some((c) => COLOR_FUNCTIONS.includes(c.function));

/** Can the light be asked to make red, green or blue (it has the three of them)? */
export const canMixColors = (f: Pick<Fixture, "channels">): boolean => (["red", "green", "blue"] as const).every((fn) => f.channels.some((c) => c.function === fn));

/**
 * The values of ONE light for the check, in the order of its channels (the order the user may have changed):
 * - intensity channels (`dimmer`; for a light without any, its colour channels) at `level` (0–1);
 * - colour channels: for white all of red, green, blue and white at full (if the light has none of them, amber
 *   instead); for red, green or blue only that one;
 * - pan and tilt at the centre (127), their fine channels, amber, UV and everything else (strobe, speed, wheels,
 *   gobos, zoom, focus, smoke, fan, macro…) at 0, so nothing flashes, moves around or fires.
 * A colour that the light cannot make is asked as white.
 */
export function checkValues(f: Pick<Fixture, "channels">, level: number, color: CheckColor = "white"): number[] {
  const k = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
  const intensity = new Set(intensityIndexes(f));
  const has = (fn: string) => f.channels.some((c) => c.function === fn);
  const mixes = canMixColors(f);
  const asked: CheckColor = mixes ? color : "white";
  const whiteFns = has("red") || has("green") || has("blue") || has("white") ? ["red", "green", "blue", "white"] : ["amber"];
  return f.channels.map((c, i) => {
    let v = 0;
    switch (c.function) {
      case "dimmer":
        v = DMX_MAX;
        break;
      case "red":
      case "green":
      case "blue":
        v = asked === "white" || asked === c.function ? DMX_MAX : 0;
        break;
      case "white":
        v = asked === "white" && whiteFns.includes("white") ? DMX_MAX : 0;
        break;
      case "amber":
        v = asked === "white" && whiteFns[0] === "amber" ? DMX_MAX : 0;
        break;
      case "pan":
      case "tilt":
        return CENTRE;
      default:
        return 0;
    }
    return intensity.has(i) ? clamp(v * k) : v;
  });
}

/**
 * What goes on the cable for the check of one light: only that light on, every other channel at 0. The light is
 * found by id; a light that is not used, has no address or does not exist gives all zeros. Channels past 512 are dropped.
 */
export function checkLook(doc: Pick<GranveloDoc, "fixtures">, fixtureId: Id, level = 1, color: CheckColor = "white"): Uint8Array {
  const out = new Uint8Array(UNIVERSE_SIZE);
  const f = doc.fixtures.find((x) => x.id === fixtureId);
  if (!f || f.unused || f.address === null) return out;
  const v = checkValues(f, level, color);
  occupiedChannels(f).forEach((ch, i) => {
    out[ch - 1] = v[i];
  });
  return out;
}

/** Does the check make any light with this light (a smoke machine does not: smoke stays off)? */
export function makesLight(f: Pick<Fixture, "channels">): boolean {
  return checkValues(f, 1).some((v, i) => v > 0 && f.channels[i].function !== "pan" && f.channels[i].function !== "tilt");
}

/* ------------------------------------------------------------------ */
/* Which lights, in what order                                          */
/* ------------------------------------------------------------------ */

/** Why a light cannot be checked. */
export type SkipReason = "unused" | "noAddress" | "outOfRange";

export interface CheckPlan {
  /** Lights to check, by number. */
  steps: Id[];
  /** Lights left out, by number, with the reason. */
  skipped: { id: Id; reason: SkipReason }[];
}

/**
 * The lights go in number order. Left out (and listed apart with the reason): lights "not used in this production",
 * lights without an address, lights that do not fit before channel 512.
 */
export function checkPlan(doc: Pick<GranveloDoc, "fixtures">): CheckPlan {
  const sorted = [...doc.fixtures].sort((a, b) => a.number - b.number);
  const steps: Id[] = [];
  const skipped: CheckPlan["skipped"] = [];
  for (const f of sorted) {
    if (f.unused) skipped.push({ id: f.id, reason: "unused" });
    else if (f.address === null) skipped.push({ id: f.id, reason: "noAddress" });
    else if ((lastChannel(f) ?? 0) > UNIVERSE_SIZE) skipped.push({ id: f.id, reason: "outOfRange" });
    else steps.push(f.id);
  }
  return { steps, skipped };
}

/** The lights that share channels with this one (turning it on also turns them on). */
export function sharedWith(doc: Pick<GranveloDoc, "fixtures">, id: Id): Id[] {
  return addressProblems(doc).conflicts.get(id) ?? [];
}

/* ------------------------------------------------------------------ */
/* The run                                                              */
/* ------------------------------------------------------------------ */

export type Verdict = "ok" | "broken";

export interface CheckRun {
  /** Where the run is: the light at `index` of the plan, or the summary. */
  view: "light" | "summary";
  index: number;
  /** What the person said in this run, by light id. */
  verdicts: Record<Id, Verdict>;
}

export const startRun = (): CheckRun => ({ view: "light", index: 0, verdicts: {} });

export type RunAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; index: number }
  | { type: "summary" }
  | { type: "verdict"; id: Id; verdict: Verdict; advance?: boolean }
  | { type: "restart" };

/** One step of the run: Next on the last light leads to the summary; Back from the summary returns to the last light. */
export function runStep(run: CheckRun, action: RunAction, count: number): CheckRun {
  const last = Math.max(0, count - 1);
  switch (action.type) {
    case "next":
      if (run.view === "summary") return run;
      return run.index >= last ? { ...run, view: "summary" } : { ...run, index: run.index + 1 };
    case "back":
      if (run.view === "summary") return { ...run, view: "light", index: last };
      return { ...run, index: Math.max(0, run.index - 1) };
    case "goto":
      return { ...run, view: "light", index: Math.min(last, Math.max(0, action.index)) };
    case "summary":
      return { ...run, view: "summary" };
    case "verdict": {
      const next = { ...run, verdicts: { ...run.verdicts, [action.id]: action.verdict } };
      return action.advance ? runStep(next, { type: "next" }, count) : next;
    }
    case "restart":
      return startRun();
  }
}

export interface RunSummary {
  ok: Id[];
  broken: Id[];
  /** In the plan but with no verdict in this run. */
  unchecked: Id[];
}

/** Which lights work, which do not and which were not checked (all in the order of the plan). */
export function summarize(plan: Pick<CheckPlan, "steps">, verdicts: Record<Id, Verdict>): RunSummary {
  const s: RunSummary = { ok: [], broken: [], unchecked: [] };
  for (const id of plan.steps) {
    const v = verdicts[id];
    (v === "ok" ? s.ok : v === "broken" ? s.broken : s.unchecked).push(id);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Leaving the check                                                    */
/* ------------------------------------------------------------------ */

/**
 * What the stage looked like before the first light was turned on: the 512 values under the output master
 * (a copy, so later changes of the store's array cannot touch it). Sent back with `setUniverse` on exit, the
 * stage is exactly as it was (Blackout and the other masters were never touched).
 */
export function restorePoint(under: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(UNIVERSE_SIZE);
  for (let i = 0; i < UNIVERSE_SIZE; i++) out[i] = clamp(under[i] ?? 0);
  return out;
}

/** Marks (or clears the mark of) one light as not working in a copy of the document; the same document if nothing changes. */
export function setBroken(doc: GranveloDoc, id: Id, broken: boolean): GranveloDoc {
  const f = doc.fixtures.find((x) => x.id === id);
  if (!f || f.broken === broken) return doc;
  return { ...doc, fixtures: doc.fixtures.map((x) => (x.id === id ? { ...x, broken } : x)) };
}
