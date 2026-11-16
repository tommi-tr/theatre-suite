import { describe, expect, it } from "vitest";
import { EMERGENCY_WINDOW_MS, fadeProgress, initialShow, showPhase, showReduce, type ShowAction, type ShowContext, type ShowEffect, type ShowState } from "./show";
import type { Memory, Transition } from "./types";

const tr = (t: Partial<Transition> = {}): Transition => ({ fadeIn: 2, fadeOut: 2, delay: 0, autoFollow: false, moveInDark: false, ...t });
const mem = (id: string, t: Partial<Transition> = {}): Memory => ({
  id,
  number: Number(id.replace(/\D/g, "")) || 1,
  label: id,
  note: "",
  state: { binding: "address", dmx: [] },
  scenery: [],
  transition: tr(t),
});

const SEQ = [mem("m1"), mem("m2", { fadeIn: 4, fadeOut: 1, delay: 1 }), mem("m3"), mem("m4")];

/** Runs actions at given times and collects every effect and notice. */
function run(steps: Array<[number, ShowAction]>, seq: Memory[] = SEQ, from: ShowState = initialShow(), emergencyMemoryId: string | null = null) {
  let state = showReduce(from, { type: "sync" }, ctx(0, seq, emergencyMemoryId)).state;
  const effects: ShowEffect[] = [];
  const notices: string[] = [];
  for (const [now, action] of steps) {
    const r = showReduce(state, action, ctx(now, seq, emergencyMemoryId));
    state = r.state;
    effects.push(...r.effects);
    if (r.notice) notices.push(r.notice);
  }
  return { state, effects, notices };
}
const ctx = (now: number, sequence: Memory[], emergencyMemoryId: string | null = null): ShowContext => ({ now, sequence, emergencyMemoryId });
const fades = (e: ShowEffect[]) => e.filter((x) => x.kind === "fade").map((x) => (x.kind === "fade" ? x.memoryId : ""));

describe("show: GO", () => {
  it("starts with the first memory ready and nothing on air", () => {
    const { state } = run([]);
    expect(state.liveId).toBeNull();
    expect(state.readyId).toBe("m1");
    expect(showPhase(state)).toBe("idle");
  });

  it("GO brings the ready memory on air with its transition and readies the next", () => {
    const { state, effects } = run([[1000, { type: "go" }]]);
    expect(state.liveId).toBe("m1");
    expect(state.readyId).toBe("m2");
    expect(state.startedAt).toBe(1000);
    expect(state.liveSince).toBe(1000);
    expect(showPhase(state)).toBe("fading");
    expect(effects).toEqual([{ kind: "fade", memoryId: "m1", transition: SEQ[0].transition }]);
  });

  it("the transition ends after delay + the longer of up and down", () => {
    let r = run([[0, { type: "go" }], [2000, { type: "tick" }], [2500, { type: "go" }]]);
    expect(r.state.fade?.durationMs).toBe(5000); // m2: delay 1 + max(4, 1)
    r = run([[0, { type: "go" }], [2000, { type: "tick" }], [2500, { type: "go" }], [7499, { type: "tick" }]]);
    expect(showPhase(r.state)).toBe("fading");
    expect(fadeProgress(r.state.fade, 5000)).toBeCloseTo(0.5);
    r = run([[0, { type: "go" }], [2000, { type: "tick" }], [2500, { type: "go" }], [7500, { type: "tick" }]]);
    expect(showPhase(r.state)).toBe("idle");
    expect(r.state.liveId).toBe("m2");
  });

  it("GO during a fade starts the next one at once (the engine starts from the current values)", () => {
    const { state, effects } = run([[0, { type: "go" }], [500, { type: "go" }]]);
    expect(fades(effects)).toEqual(["m1", "m2"]);
    expect(state.liveId).toBe("m2");
    expect(state.fade?.fromId).toBe("m1");
    expect(state.fade?.startedAt).toBe(500);
    expect(state.readyId).toBe("m3");
  });

  it("GO at the end of the sequence does nothing and says so", () => {
    const seq = [mem("m1"), mem("m2")];
    const { state, effects, notices } = run([[0, { type: "go" }], [10, { type: "go" }], [20, { type: "go" }]], seq);
    expect(fades(effects)).toEqual(["m1", "m2"]);
    expect(state.readyId).toBeNull();
    expect(notices).toEqual(["endOfSequence"]);
  });

  it("GO with an empty sequence does nothing", () => {
    const { state, effects, notices } = run([[0, { type: "go" }], [0, { type: "back" }]], []);
    expect(effects).toEqual([]);
    expect(notices).toEqual(["emptySequence", "emptySequence"]);
    expect(state.readyId).toBeNull();
  });

  it("the operator can choose the ready memory", () => {
    const { state, effects, notices } = run([[0, { type: "setReady", id: "m3" }], [10, { type: "go" }], [20, { type: "setReady", id: "zz" }]]);
    expect(fades(effects)).toEqual(["m3"]);
    expect(state.readyId).toBe("m4");
    expect(notices).toEqual(["notInSequence"]);
  });

  it("a zero-time transition ends at once", () => {
    const seq = [mem("m1", { fadeIn: 0, fadeOut: 0 }), mem("m2")];
    const { state } = run([[0, { type: "go" }]], seq);
    expect(state.fade).toBeNull();
    expect(state.liveId).toBe("m1");
  });

  it("restart readies the first memory and resets the clock without touching the stage", () => {
    const { state, effects } = run([[0, { type: "go" }], [100, { type: "go" }], [200, { type: "restart" }]]);
    expect(state.readyId).toBe("m1");
    expect(state.liveId).toBe("m2");
    expect(state.startedAt).toBeNull();
    expect(fades(effects)).toEqual(["m1", "m2"]);
  });
});

describe("show: Indietro", () => {
  it("goes to the memory before, with its own times, and readies the one that was on air", () => {
    const { state, effects } = run([[0, { type: "go" }], [100, { type: "go" }], [200, { type: "go" }], [300, { type: "back" }]]);
    expect(fades(effects)).toEqual(["m1", "m2", "m3", "m2"]);
    expect(state.liveId).toBe("m2");
    expect(state.readyId).toBe("m3");
    expect(state.fade?.back).toBe(true);
    expect(state.fade?.durationMs).toBe(5000);
  });

  it("does nothing on the first memory or before any GO", () => {
    expect(run([[0, { type: "back" }]]).notices).toEqual(["firstMemory"]);
    const r = run([[0, { type: "go" }], [10, { type: "back" }]]);
    expect(r.notices).toEqual(["firstMemory"]);
    expect(fades(r.effects)).toEqual(["m1"]);
  });

  it("never starts the next memory by itself", () => {
    const seq = [mem("m1", { autoFollow: true }), mem("m2", { autoFollow: true }), mem("m3")];
    // m1 auto-follows into m2 (at 2 s), which auto-follows into m3 (at 4 s); Indietro at 5 s goes back to m2 only.
    const r = run([[0, { type: "go" }], [2000, { type: "tick" }], [4000, { type: "tick" }], [5000, { type: "back" }], [20000, { type: "tick" }]], seq);
    expect(fades(r.effects)).toEqual(["m1", "m2", "m3", "m2"]);
    expect(r.state.liveId).toBe("m2");
    expect(r.state.readyId).toBe("m3");
  });
});

describe("show: Pausa", () => {
  it("stops the clock of the transition and goes on from there", () => {
    const r = run([[0, { type: "go" }], [500, { type: "pause" }], [10_000, { type: "tick" }]]);
    expect(showPhase(r.state)).toBe("paused");
    expect(fadeProgress(r.state.fade, 10_000)).toBeCloseTo(0.25);
    const r2 = run([[0, { type: "go" }], [500, { type: "pause" }], [10_000, { type: "pause" }], [11_499, { type: "tick" }]]);
    expect(showPhase(r2.state)).toBe("fading");
    expect(r2.effects.map((e) => e.kind)).toEqual(["fade", "pause", "resume"]);
    const r3 = run([[0, { type: "go" }], [500, { type: "pause" }], [10_000, { type: "pause" }], [11_500, { type: "tick" }]]);
    expect(showPhase(r3.state)).toBe("idle");
  });

  it("with nothing moving does nothing", () => {
    const r = run([[0, { type: "pause" }], [0, { type: "go" }], [5000, { type: "pause" }]]);
    expect(r.notices).toEqual(["nothingToPause", "nothingToPause"]);
    expect(r.effects.map((e) => e.kind)).toEqual(["fade"]);
  });

  it("GO on a paused fade starts the next transition (not paused)", () => {
    const r = run([[0, { type: "go" }], [500, { type: "pause" }], [800, { type: "go" }]]);
    expect(showPhase(r.state)).toBe("fading");
    expect(r.state.liveId).toBe("m2");
  });
});

describe("show: parte da sola", () => {
  const seq = [mem("m1", { autoFollow: true, fadeIn: 1, fadeOut: 1 }), mem("m2", { fadeIn: 3, fadeOut: 3 }), mem("m3")];

  it("starts the ready memory by itself at the exact end of the transition", () => {
    const r = run([[0, { type: "go" }], [1300, { type: "tick" }]], seq);
    expect(fades(r.effects)).toEqual(["m1", "m2"]);
    expect(r.state.liveId).toBe("m2");
    expect(r.state.fade?.startedAt).toBe(1000);
    expect(fadeProgress(r.state.fade, 1300)).toBeCloseTo(0.1);
  });

  it("waits for a paused transition", () => {
    const r = run([[0, { type: "go" }], [500, { type: "pause" }], [5000, { type: "tick" }]], seq);
    expect(fades(r.effects)).toEqual(["m1"]);
    const r2 = run([[0, { type: "go" }], [500, { type: "pause" }], [5000, { type: "pause" }], [5500, { type: "tick" }]], seq);
    expect(fades(r2.effects)).toEqual(["m1", "m2"]);
    expect(r2.state.fade?.startedAt).toBe(5500);
  });

  it("follows a chain of zero-time memories without looping", () => {
    const chain = [mem("m1", { fadeIn: 0, fadeOut: 0, autoFollow: true }), mem("m2", { fadeIn: 0, fadeOut: 0, autoFollow: true }), mem("m3", { fadeIn: 0, fadeOut: 0, autoFollow: true })];
    const r = run([[0, { type: "go" }], [1, { type: "tick" }]], chain);
    expect(fades(r.effects)).toEqual(["m1", "m2", "m3"]);
    expect(r.state.readyId).toBeNull();
    expect(r.state.fade).toBeNull();
  });

  it("goes to the memory chosen as ready", () => {
    const r = run([[0, { type: "go" }], [500, { type: "setReady", id: "m3" }], [1000, { type: "tick" }]], seq);
    expect(fades(r.effects)).toEqual(["m1", "m3"]);
  });

  it("is held during the emergency", () => {
    const r = run([[0, { type: "go" }], [100, { type: "emergency" }], [200, { type: "emergency" }], [5000, { type: "tick" }]], seq);
    expect(fades(r.effects)).toEqual(["m1"]);
  });
});

describe("show: Blackout and Fade to black", () => {
  it("Blackout is reversible and GO goes on underneath", () => {
    const r = run([[0, { type: "go" }], [100, { type: "blackout" }], [200, { type: "go" }]]);
    expect(showPhase(r.state)).toBe("blackout");
    expect(r.state.liveId).toBe("m2");
    expect(r.effects.map((e) => e.kind)).toEqual(["fade", "blackout", "fade"]);
    const r2 = run([[0, { type: "blackout" }], [100, { type: "blackout" }]]);
    expect(r2.effects).toEqual([{ kind: "blackout", on: true }, { kind: "blackout", on: false }]);
    expect(showPhase(r2.state)).toBe("idle");
  });

  it("Fade to black goes down and comes back with its time", () => {
    const r = run([[0, { type: "ftb", seconds: 5 }], [100, { type: "ftb", seconds: 5 }]]);
    expect(r.effects).toEqual([{ kind: "fadeToBlack", seconds: 5 }, { kind: "releaseBlack", seconds: 5 }]);
    expect(run([[0, { type: "ftb", seconds: NaN }]]).effects).toEqual([{ kind: "fadeToBlack", seconds: 0 }]);
    expect(showPhase(run([[0, { type: "ftb", seconds: 3 }]]).state)).toBe("ftb");
  });
});

describe("show: Emergenza", () => {
  it("the first press arms it, the second within 3 s fires it", () => {
    const armed = run([[0, { type: "emergency" }]]);
    expect(armed.notices).toEqual(["emergencyArmed"]);
    expect(armed.effects).toEqual([]);
    const fired = run([[0, { type: "emergency" }], [EMERGENCY_WINDOW_MS, { type: "emergency" }]]);
    expect(fired.effects).toEqual([{ kind: "emergencyOn", memoryId: null }]);
    expect(showPhase(fired.state)).toBe("emergency");
  });

  it("a second press too late only arms it again", () => {
    const r = run([[0, { type: "emergency" }], [EMERGENCY_WINDOW_MS + 1, { type: "emergency" }]]);
    expect(r.notices).toEqual(["emergencyArmed", "emergencyArmed"]);
    expect(r.state.emergency).toBeNull();
    const r2 = run([[0, { type: "emergency" }], [3500, { type: "tick" }]]);
    expect(r2.state.armedAt).toBeNull();
  });

  it("uses the emergency memory of the settings", () => {
    const r = run([[0, { type: "emergency" }], [10, { type: "emergency" }]], SEQ, initialShow(), "m3");
    expect(r.effects).toEqual([{ kind: "emergencyOn", memoryId: "m3" }]);
  });

  it("ends the running fade, holds Blackout and FTB, refuses the other commands", () => {
    const r = run([[0, { type: "go" }], [100, { type: "blackout" }], [200, { type: "ftb", seconds: 2 }], [300, { type: "emergency" }], [400, { type: "emergency" }], [500, { type: "go" }], [600, { type: "back" }], [700, { type: "pause" }], [800, { type: "blackout" }], [900, { type: "ftb", seconds: 2 }], [1000, { type: "emergency" }]]);
    expect(r.state.fade).toBeNull();
    expect(r.state.blackout).toBe(false);
    expect(r.state.ftb).toBe(false);
    expect(r.state.liveId).toBe("m1");
    expect(r.notices.filter((n) => n === "inEmergency")).toHaveLength(6);
    expect(r.effects.map((e) => e.kind)).toEqual(["fade", "blackout", "fadeToBlack", "emergencyOn"]);
  });

  it("leaving gives back Blackout and FTB as they were", () => {
    const r = run([[0, { type: "blackout" }], [10, { type: "emergency" }], [20, { type: "emergency" }], [30, { type: "leaveEmergency" }], [40, { type: "leaveEmergency" }]]);
    expect(r.state.emergency).toBeNull();
    expect(r.state.blackout).toBe(true);
    expect(r.effects.slice(-1)).toEqual([{ kind: "emergencyOff", blackout: true, ftb: false }]);
    expect(r.effects.filter((e) => e.kind === "emergencyOff")).toHaveLength(1);
  });
});

describe("show: the document changes", () => {
  it("a deleted memory leaves the state, the ready one is found again", () => {
    let r = run([[0, { type: "go" }], [10, { type: "go" }]]);
    expect(r.state.liveId).toBe("m2");
    const without = SEQ.filter((m) => m.id !== "m3");
    const s = showReduce(r.state, { type: "sync" }, ctx(20, without)).state;
    expect(s.readyId).toBe("m4");
    const s2 = showReduce(s, { type: "sync" }, ctx(30, SEQ.filter((m) => m.id !== "m2"))).state;
    expect(s2.liveId).toBeNull();
    expect(s2.fade).toBeNull();
    r = run([[0, { type: "go" }], [10, { type: "go" }], [20, { type: "go" }], [30, { type: "go" }]]);
    expect(r.state.readyId).toBeNull();
    const more = [...SEQ, mem("m5")];
    expect(showReduce(r.state, { type: "sync" }, ctx(40, more)).state.readyId).toBe("m5");
  });

  it("carries on from a memory the desk put on stage", () => {
    const r = run([[0, { type: "onStage", id: "m3" }], [10, { type: "go" }]]);
    expect(r.effects.map((e) => (e.kind === "fade" ? e.memoryId : e.kind))).toEqual(["m4"]);
    const busy = run([[0, { type: "go" }], [10, { type: "onStage", id: "m3" }]]);
    expect(busy.state.liveId).toBe("m1");
    expect(run([[0, { type: "onStage", id: "zz" }]]).notices).toEqual(["notInSequence"]);
  });
});
