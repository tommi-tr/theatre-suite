import { transitionDuration } from "./crossfade";
import type { Id, Memory, Transition } from "./types";

/**
 * The Show engine, pure: what GO, Indietro, Pausa, Blackout, Fade to black and Emergenza do to the state of the
 * evening, and which commands they send to the DMX output. No React, no stores, no clock: every call gets `now`
 * (milliseconds) and the memories of the sequence in show order, and returns the new state, the **effects** (output
 * commands, executed by `store/show.ts` through `store/output.ts`) and, sometimes, a **notice** for the operator.
 *
 * The fades themselves are computed by the DMX engine (Rust, or `dmxSim.ts` in the browser): this module only keeps
 * its own clock of the running transition (for the progress bar, Pausa and "parte da sola"). A fade sent to the
 * engine finishes there even if the interface stops; only "parte da sola" needs this module's `tick`.
 *
 * States (see `showPhase`): `idle` (nothing moving), `fading`, `paused`, and three overlays on top of the
 * playback — `blackout` (reversible, what is underneath keeps going), `ftb` (Fade to black, reversible) and
 * `emergency` (all white or the emergency memory; it ends the running fade and holds the Blackout/FTB state
 * it found, to give it back when the operator leaves it).
 *
 * Rules:
 * - **GO** brings the memory *ready* (`readyId`) on stage with its transition, from whatever is on stage now (also in
 *   the middle of another fade, or a paused one). It becomes the memory *on air* (`liveId`) at once — the strip slides
 *   while the fade runs — and the next one of the sequence becomes ready. At the end of the sequence GO does nothing.
 * - **Indietro** goes to the memory before the one on air, with that memory's times (never "parte da sola"); the one
 *   that was on air becomes ready again. On the first memory it does nothing.
 * - **Pausa** stops the running transition where it is; pressed again it goes on. With nothing moving it does nothing.
 * - **Parte da sola**: when the transition to a memory with `autoFollow` ends (pauses excluded), the ready memory gets
 *   a GO by itself, timed from the exact end (no drift along a chain). Held while in emergency.
 * - **Blackout** / **Fade to black** act on the output master only (intensity channels); GO, Indietro and Pausa go on
 *   underneath. Both are refused during the emergency.
 * - **Emergenza** needs two presses within `EMERGENCY_WINDOW_MS`: the first arms it, the second fires it. Leaving it
 *   (`leaveEmergency`) gives back Blackout and FTB as they were; the stage goes back to the desk (store).
 */

/** Second press of E within this time fires the emergency. */
export const EMERGENCY_WINDOW_MS = 3000;

export interface ShowFade {
  /** The memory that was on air at GO (null = none). */
  fromId: Id | null;
  /** The memory coming on stage (= `liveId` while it runs). */
  toId: Id;
  startedAt: number;
  /** Set while paused. */
  pausedAt: number | null;
  /** Milliseconds spent paused so far. */
  pausedMs: number;
  durationMs: number;
  /** Start the ready memory by itself at the end. */
  autoFollow: boolean;
  /** Started by Indietro. */
  back: boolean;
}

export interface ShowState {
  /** The memory on air (during a transition, the one coming in). */
  liveId: Id | null;
  /** The memory of the next GO; null = end of the sequence (or empty). */
  readyId: Id | null;
  fade: ShowFade | null;
  /** When the memory on air was called. */
  liveSince: number | null;
  /** First GO of the evening (for "durata della serata"). */
  startedAt: number | null;
  blackout: boolean;
  ftb: boolean;
  /** Active emergency, with the Blackout/FTB state to give back. */
  emergency: { since: number; blackout: boolean; ftb: boolean } | null;
  /** First press of E (waiting for the second). */
  armedAt: number | null;
}

export type ShowEffect =
  | { kind: "fade"; memoryId: Id; transition: Transition }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "blackout"; on: boolean }
  | { kind: "fadeToBlack"; seconds: number }
  | { kind: "releaseBlack"; seconds: number }
  | { kind: "emergencyOn"; memoryId: Id | null }
  | { kind: "emergencyOff"; blackout: boolean; ftb: boolean };

export type ShowNotice = "emptySequence" | "endOfSequence" | "firstMemory" | "nothingToPause" | "inEmergency" | "emergencyArmed" | "notInSequence";

export type ShowAction =
  | { type: "go" }
  | { type: "back" }
  | { type: "pause" }
  | { type: "blackout" }
  | { type: "ftb"; seconds: number }
  | { type: "emergency" }
  | { type: "leaveEmergency" }
  /** Clock: ends transitions, starts "parte da sola", disarms E. Call it a few times a second. */
  | { type: "tick" }
  /** The operator chooses the next memory. */
  | { type: "setReady"; id: Id }
  /** From the top: the first memory ready, the clock of the evening at zero (the stage does not change). */
  | { type: "restart" }
  /** The document changed: drop what no longer exists, find the ready memory again. */
  | { type: "sync" };

export interface ShowContext {
  now: number;
  /** The memories of the sequence, in show order. */
  sequence: readonly Memory[];
  /** Memory played by Emergenza (null = all white). */
  emergencyMemoryId: Id | null;
}

export interface ShowResult {
  state: ShowState;
  effects: ShowEffect[];
  notice?: ShowNotice;
}

export type ShowPhase = "idle" | "fading" | "paused" | "blackout" | "ftb" | "emergency";

export const initialShow = (): ShowState => ({ liveId: null, readyId: null, fade: null, liveSince: null, startedAt: null, blackout: false, ftb: false, emergency: null, armedAt: null });

/** The most important thing happening now (the overlays first). */
export function showPhase(s: ShowState): ShowPhase {
  if (s.emergency) return "emergency";
  if (s.blackout) return "blackout";
  if (s.ftb) return "ftb";
  if (s.fade) return s.fade.pausedAt !== null ? "paused" : "fading";
  return "idle";
}

/** Milliseconds of the running transition (pauses excluded). */
export function fadeElapsed(f: ShowFade, now: number): number {
  return Math.max(0, (f.pausedAt ?? now) - f.startedAt - f.pausedMs);
}

/** 0–1 for the bar of the transition box. */
export function fadeProgress(f: ShowFade | null, now: number): number {
  if (!f) return 0;
  return f.durationMs <= 0 ? 1 : Math.min(1, fadeElapsed(f, now) / f.durationMs);
}

const indexIn = (seq: readonly Memory[], id: Id | null) => (id === null ? -1 : seq.findIndex((m) => m.id === id));

/** The memory after `id` in the sequence (the first one when `id` is null or not in it… only when null). */
function nextAfter(seq: readonly Memory[], id: Id | null): Id | null {
  if (id === null) return seq[0]?.id ?? null;
  const i = indexIn(seq, id);
  if (i < 0) return seq[0]?.id ?? null;
  return seq[i + 1]?.id ?? null;
}

const durationMs = (tr: Transition) => Math.round(transitionDuration(tr) * 1000);

/** Starts the transition to `m` at `at`. */
function start(s: ShowState, seq: readonly Memory[], m: Memory, at: number, back: boolean, effects: ShowEffect[]): ShowState {
  effects.push({ kind: "fade", memoryId: m.id, transition: m.transition });
  return {
    ...s,
    fade: { fromId: s.liveId, toId: m.id, startedAt: at, pausedAt: null, pausedMs: 0, durationMs: durationMs(m.transition), autoFollow: !back && m.transition.autoFollow, back },
    liveId: m.id,
    liveSince: at,
    startedAt: s.startedAt ?? at,
    readyId: back ? s.liveId : nextAfter(seq, m.id),
  };
}

/** Ends the transitions that are over (at `now`) and runs "parte da sola", from the exact end time. */
function settle(s: ShowState, ctx: ShowContext, effects: ShowEffect[]): ShowState {
  // A chain of zero-time transitions could go round many times: never more than the length of the sequence.
  for (let guard = 0; guard <= ctx.sequence.length && s.fade; guard++) {
    const f = s.fade;
    if (f.pausedAt !== null || fadeElapsed(f, ctx.now) < f.durationMs) break;
    const endAt = f.startedAt + f.pausedMs + f.durationMs;
    s = { ...s, fade: null };
    if (!f.autoFollow || s.emergency) break;
    const next = ctx.sequence.find((m) => m.id === s.readyId);
    if (!next) break;
    s = start(s, ctx.sequence, next, endAt, false, effects);
  }
  return s;
}

/** Keeps the state in line with the document (memories deleted, sequence changed). */
function normalize(s: ShowState, seq: readonly Memory[]): ShowState {
  let out = s;
  if (out.fade && !seq.some((m) => m.id === out.fade!.toId)) out = { ...out, fade: null };
  if (out.liveId !== null && !seq.some((m) => m.id === out.liveId)) out = { ...out, liveId: null, liveSince: null };
  if (out.readyId === null || !seq.some((m) => m.id === out.readyId)) {
    const ready = nextAfter(seq, out.liveId);
    if (ready !== out.readyId) out = { ...out, readyId: ready };
  }
  return out;
}

/** The state machine. Pure: the same inputs give the same result. */
export function showReduce(state: ShowState, action: ShowAction, ctx: ShowContext): ShowResult {
  const effects: ShowEffect[] = [];
  const seq = ctx.sequence;
  const now = ctx.now;
  let s = state;
  const done = (notice?: ShowNotice): ShowResult => (notice ? { state: s, effects, notice } : { state: s, effects });

  switch (action.type) {
    case "go": {
      s = settle(normalize(s, seq), ctx, effects);
      if (s.emergency) return done("inEmergency");
      if (!seq.length) return done("emptySequence");
      const m = seq.find((x) => x.id === s.readyId);
      if (!m) return done("endOfSequence");
      s = start(s, seq, m, now, false, effects);
      s = settle(s, ctx, effects);
      return done();
    }
    case "back": {
      s = settle(normalize(s, seq), ctx, effects);
      if (s.emergency) return done("inEmergency");
      const i = indexIn(seq, s.liveId);
      if (i <= 0) return done(seq.length ? "firstMemory" : "emptySequence");
      s = start(s, seq, seq[i - 1], now, true, effects);
      s = settle(s, ctx, effects);
      return done();
    }
    case "pause": {
      s = settle(s, ctx, effects);
      if (s.emergency) return done("inEmergency");
      const f = s.fade;
      if (!f) return done("nothingToPause");
      if (f.pausedAt === null) {
        s = { ...s, fade: { ...f, pausedAt: now } };
        effects.push({ kind: "pause" });
      } else {
        s = { ...s, fade: { ...f, pausedAt: null, pausedMs: f.pausedMs + Math.max(0, now - f.pausedAt) } };
        effects.push({ kind: "resume" });
      }
      return done();
    }
    case "blackout": {
      if (s.emergency) return done("inEmergency");
      s = { ...s, blackout: !s.blackout };
      effects.push({ kind: "blackout", on: s.blackout });
      return done();
    }
    case "ftb": {
      if (s.emergency) return done("inEmergency");
      const seconds = Number.isFinite(action.seconds) ? Math.max(0, action.seconds) : 0;
      s = { ...s, ftb: !s.ftb };
      effects.push(s.ftb ? { kind: "fadeToBlack", seconds } : { kind: "releaseBlack", seconds });
      return done();
    }
    case "emergency": {
      if (s.emergency) return done("inEmergency");
      if (s.armedAt === null || now - s.armedAt > EMERGENCY_WINDOW_MS || now < s.armedAt) {
        s = { ...s, armedAt: now };
        return done("emergencyArmed");
      }
      // The emergency takes the stage: the running transition ends where it is (the memory coming in stays "on air").
      s = { ...s, armedAt: null, fade: null, emergency: { since: now, blackout: s.blackout, ftb: s.ftb }, blackout: false, ftb: false };
      effects.push({ kind: "emergencyOn", memoryId: ctx.emergencyMemoryId });
      return done();
    }
    case "leaveEmergency": {
      const e = s.emergency;
      if (!e) return done();
      s = { ...s, emergency: null, blackout: e.blackout, ftb: e.ftb };
      effects.push({ kind: "emergencyOff", blackout: e.blackout, ftb: e.ftb });
      return done();
    }
    case "tick": {
      if (s.armedAt !== null && (now - s.armedAt > EMERGENCY_WINDOW_MS || now < s.armedAt)) s = { ...s, armedAt: null };
      s = settle(s, ctx, effects);
      return done();
    }
    case "setReady": {
      if (!seq.some((m) => m.id === action.id)) return done("notInSequence");
      if (s.readyId !== action.id) s = { ...s, readyId: action.id };
      return done();
    }
    case "restart": {
      s = { ...normalize(s, seq), readyId: seq[0]?.id ?? null, startedAt: null };
      return done();
    }
    case "sync": {
      s = normalize(s, seq);
      return done();
    }
  }
}
