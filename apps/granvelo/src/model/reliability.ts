import { SimCore, SIM_PERIOD } from "../lib/dmxSim";
import { addressProblems } from "./addresses";
import { transitionDuration } from "./crossfade";
import { intensityMask, memoryFadePayload } from "./enginePayload";
import { litCount } from "./memories";
import { sequenceMemories } from "./sequence";
import { DMX_MAX, UNIVERSE_SIZE, type GranveloDoc, type Memory } from "./types";

/**
 * The reliability test (Settings → Test): the whole sequence of memories played, GO after GO, by the same engine the
 * browser preview uses (`SimCore`, numerically identical to the Rust engine) — accelerated, with no output at all —
 * plus the checks of the document that matter on the evening. Pure apart from the clock used to time the frames.
 *
 * What it checks:
 * - every transition takes the time it should (within one frame) and ends exactly on the memory's values;
 * - memories with values out of 0–255 (or not whole numbers), memories with no light on (maybe meant: a blackout);
 * - lights in conflict, lights that do not fit in the 512 channels, lights without an address;
 * - "parte da sola" on the last memory (nothing will follow), very long transitions (over a minute);
 * - how long this computer takes to compute a frame (a frame every 25 ms on the cable).
 */

export type ReliabilityLevel = "ok" | "warn" | "stop";

export type ReliabilityFinding =
  | { kind: "emptySequence"; level: "warn" }
  | { kind: "badValues"; level: "stop"; number: number; count: number }
  | { kind: "timing"; level: "stop"; number: number; expected: number; measured: number }
  | { kind: "wrongEnd"; level: "stop"; number: number; channels: number }
  | { kind: "conflicts"; level: "warn"; lights: number }
  | { kind: "outOfRange"; level: "warn"; lights: number }
  | { kind: "noAddress"; level: "warn"; lights: number }
  | { kind: "emptyMemory"; level: "warn"; number: number }
  | { kind: "autoFollowLast"; level: "warn"; number: number }
  | { kind: "longTransition"; level: "warn"; number: number; seconds: number }
  | { kind: "slowFrames"; level: "warn"; maxMs: number };

export interface ReliabilityReport {
  memories: number;
  transitions: number;
  /** Seconds of transitions in the whole sequence (what the test simulated). */
  showSeconds: number;
  frames: number;
  avgFrameMs: number;
  maxFrameMs: number;
  findings: ReliabilityFinding[];
  /** The worst level found. */
  level: ReliabilityLevel;
}

/** Over this a transition is reported (it may be meant, but it is worth a look). */
export const LONG_TRANSITION = 60;
/** Over this the computation of one frame is reported as slow (a frame leaves every 25 ms). */
export const SLOW_FRAME_MS = 10;
/** At most this many frames per transition are computed (very long ones are sampled more coarsely). */
const MAX_FRAMES_PER_FADE = 2400;

/** Values of a memory that are not whole numbers 0–255. */
function badValues(m: Memory): number {
  const bad = (v: unknown) => typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > DMX_MAX;
  if (m.state.binding === "address") return m.state.dmx.filter(bad).length + Math.max(0, m.state.dmx.length - UNIVERSE_SIZE);
  return Object.values(m.state.fixtures).reduce((n, row) => n + row.filter(bad).length, 0);
}

const defaultClock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function reliabilityTest(doc: GranveloDoc, clock: () => number = defaultClock): ReliabilityReport {
  const findings: ReliabilityFinding[] = [];
  const seq = sequenceMemories(doc);
  if (!seq.length) findings.push({ kind: "emptySequence", level: "warn" });

  const used = doc.fixtures.filter((f) => !f.unused);
  const p = addressProblems(doc);
  if (p.conflicts.size) findings.push({ kind: "conflicts", level: "warn", lights: p.conflicts.size });
  if (p.outOfRange.size) findings.push({ kind: "outOfRange", level: "warn", lights: p.outOfRange.size });
  const noAddress = used.filter((f) => f.address === null).length;
  if (noAddress) findings.push({ kind: "noAddress", level: "warn", lights: noAddress });

  const core = new SimCore();
  core.grandMaster(DMX_MAX, intensityMask(doc));
  core.setUniverse(new Uint8Array(UNIVERSE_SIZE));
  let now = 0;
  core.advance(now);
  let frames = 0;
  let frameMsTotal = 0;
  let maxFrameMs = 0;
  let showSeconds = 0;

  seq.forEach((m, i) => {
    const bad = badValues(m);
    if (bad) findings.push({ kind: "badValues", level: "stop", number: m.number, count: bad });
    if (litCount(doc, m.state) === 0) findings.push({ kind: "emptyMemory", level: "warn", number: m.number });
    const expected = transitionDuration(m.transition);
    showSeconds += expected;
    if (expected > LONG_TRANSITION) findings.push({ kind: "longTransition", level: "warn", number: m.number, seconds: expected });
    if (m.transition.autoFollow && i === seq.length - 1) findings.push({ kind: "autoFollowLast", level: "warn", number: m.number });

    const payload = memoryFadePayload(doc, m);
    core.fadeTo(payload.target, payload.transition, payload.layout);
    const period = Math.max(SIM_PERIOD, expected / MAX_FRAMES_PER_FADE);
    const startedAt = now;
    let guard = Math.ceil(expected / period) + 10;
    while (core.fadeState().active && guard-- > 0) {
      now += period;
      const t0 = clock();
      core.advance(now);
      core.frame();
      const ms = Math.max(0, clock() - t0);
      frames++;
      frameMsTotal += ms;
      maxFrameMs = Math.max(maxFrameMs, ms);
    }
    const measured = core.fadeState().active ? Infinity : now - startedAt;
    // The engine ends a fade at the first frame at or after its end: never more than one frame late.
    if (!(measured >= expected - 1e-9 && measured <= expected + period + 1e-6)) findings.push({ kind: "timing", level: "stop", number: m.number, expected, measured });
    const out = core.frame();
    let wrong = 0;
    for (let c = 0; c < UNIVERSE_SIZE; c++) if (out[c] !== payload.target[c]) wrong++;
    if (wrong) findings.push({ kind: "wrongEnd", level: "stop", number: m.number, channels: wrong });
  });

  const avgFrameMs = frames ? frameMsTotal / frames : 0;
  if (maxFrameMs > SLOW_FRAME_MS) findings.push({ kind: "slowFrames", level: "warn", maxMs: maxFrameMs });
  const level: ReliabilityLevel = findings.some((f) => f.level === "stop") ? "stop" : findings.length ? "warn" : "ok";
  return { memories: seq.length, transitions: seq.length, showSeconds, frames, avgFrameMs, maxFrameMs, findings, level };
}
