import { describe, expect, it } from "vitest";
import { createSimDmx, SimCore, TEST_RISE } from "./dmxSim";
import type { EngineLayout, EngineTransition } from "./dmx";
import vectors from "../model/engineVectors.json";

const ALL: EngineLayout = { intensity: new Array(512).fill(1), mover: new Array(512).fill(-1), moverIntensity: [] };
const uni = (pairs: [number, number][]) => {
  const u = new Array<number>(512).fill(0);
  for (const [i, v] of pairs) u[i] = v;
  return u;
};
const tr = (fadeIn: number, fadeOut: number) => ({ fadeIn, fadeOut, delay: 0, moveInDark: false });

/** The same cases as the Rust core (src-tauri/src/dmx/core.rs): the browser behaves like the engine. */
describe("simulated engine core", () => {
  it("fades on time and ends on the target", () => {
    const c = new SimCore();
    c.advance(0);
    expect(c.fadeTo(uni([[0, 200]]), tr(2, 2), ALL)).toBe(1);
    c.advance(1);
    expect(c.frame()[0]).toBe(100);
    c.advance(2.5);
    expect(c.frame()[0]).toBe(200);
    expect(c.fadeState()).toMatchObject({ active: false, doneId: 1 });
  });

  it("pauses and resumes, and a new fade starts from the current values", () => {
    const c = new SimCore();
    c.advance(10);
    c.fadeTo(uni([[0, 200]]), tr(4, 4), ALL, 7);
    c.advance(11);
    c.pause();
    c.advance(20);
    expect(c.frame()[0]).toBe(50);
    c.resume();
    c.advance(21);
    expect(c.frame()[0]).toBe(100);
    c.fadeTo(uni([]), tr(1, 1), ALL);
    expect(c.frame()[0]).toBe(100);
    c.advance(21.5);
    expect(c.frame()[0]).toBe(50);
  });

  it("set universe during a fade ends the fade and jumps", () => {
    const c = new SimCore();
    c.advance(0);
    c.fadeTo(uni([[0, 200]]), tr(2, 2), ALL);
    c.advance(1);
    c.setUniverse(uni([[1, 30]]));
    c.advance(5);
    expect(Array.from(c.frame().slice(0, 2))).toEqual([0, 30]);
    expect(c.fadeState().doneId).toBe(0);
  });

  it("blackout is reversible while the fade continues underneath; GM and FTB only on the mask", () => {
    const c = new SimCore();
    c.advance(0);
    c.grandMaster(255, uni([[0, 1]]));
    c.setUniverse(uni([[1, 77]]));
    c.fadeTo(uni([[0, 200], [1, 77]]), tr(4, 4), ALL);
    c.advance(1);
    c.blackout(true);
    expect(Array.from(c.frame().slice(0, 2))).toEqual([0, 77]);
    c.advance(3);
    c.blackout(false);
    expect(c.frame()[0]).toBe(150);
    c.grandMaster(128);
    expect(c.frame()[0]).toBe(Math.floor(150 * (128 / 255) + 0.5));
    c.grandMaster(255);
    c.fadeToBlack(2);
    c.advance(4);
    expect(Array.from(c.frame().slice(0, 2))).toEqual([100, 77]);
    c.releaseBlack(0);
    expect(c.frame()[0]).toBe(200);
  });

  it("the test pattern raises one channel at a time", () => {
    const c = new SimCore();
    c.advance(0);
    c.startTest(3, 128);
    c.advance(TEST_RISE);
    expect(c.frame()[0]).toBe(128);
    expect(c.testState()).toEqual({ channel: 1, of: 3 });
    c.stopTest();
    expect(c.testState()).toBeNull();
  });
});

describe("simulated engine", () => {
  it("is idle until connected, then sends; it never finds a cable in the browser", async () => {
    let now = 0;
    const sim = createSimDmx({ now: () => now, timer: false });
    const states: string[] = [];
    sim.onStatus((s) => states.push(s.link.state));
    sim.tick();
    expect((await sim.getStatus()).live.framesSent).toBe(0);
    await sim.connect({ mode: "auto" });
    expect(states.at(-1)).toBe("error");
    await sim.connect({ mode: "simulated" });
    expect(states.at(-1)).toBe("simulated");
    for (let i = 1; i <= 80; i++) {
      now = i / 40;
      sim.tick();
    }
    const s = await sim.getStatus();
    expect(s.live.framesSent).toBeGreaterThanOrEqual(80);
    expect(s.live.fps).toBeCloseTo(40, 0);
    expect(await sim.listDevices()).toEqual([]);
  });

  it("publishes the output when it changes, at most 20 times a second", async () => {
    let now = 0;
    const sim = createSimDmx({ now: () => now, timer: false });
    const outs: number[] = [];
    sim.onOutput((o) => outs.push(o[0]));
    await sim.connect({ mode: "simulated" });
    await sim.fadeTo({ target: uni([[0, 255]]), transition: tr(1, 1), layout: ALL });
    for (let i = 1; i <= 44; i++) {
      now = i / 40;
      sim.tick();
    }
    // The last values arrive at the next allowed moment, even if nothing changes after them.
    expect(outs.length).toBeLessThanOrEqual(23);
    expect(outs.at(-1)).toBe(255);
  });

  it("with the example cables, a pulled cable is lost and comes back", async () => {
    let now = 0;
    const sim = createSimDmx({ now: () => now, timer: false, exampleDevices: true });
    await sim.connect({ mode: "auto" });
    expect((await sim.getStatus()).status.link).toMatchObject({ state: "connected", kind: "pro" });
    sim.pullCable();
    expect((await sim.getStatus()).status.link.state).toBe("lost");
    now = 1.5;
    sim.tick();
    expect((await sim.getStatus()).status.link).toMatchObject({ state: "lost", attempts: 1 });
    sim.plugCable();
    now = 3;
    sim.tick();
    expect((await sim.getStatus()).status.link.state).toBe("connected");
  });
});

type Pair = [number, number];
interface Step {
  t: number;
  do?: string;
  values?: Pair[];
  target?: Pair[];
  transition?: EngineTransition;
  layout?: "all" | EngineLayout;
  on?: boolean;
  seconds?: number;
  level?: number;
  mask?: number[];
  channels?: number;
  expect?: Pair[];
  under?: Pair[];
  fade?: boolean;
}

/** Sparse [[channel, value]] → values (at least 512, longer if a channel is beyond). */
const sparse = (pairs: Pair[] = []) => {
  const out = new Array<number>(Math.max(512, ...pairs.map(([c]) => c + 1))).fill(0);
  for (const [c, v] of pairs) out[c] = v;
  return out;
};

/** The same file is run by cargo test against the Rust core (src-tauri/src/dmx/core.rs). */
describe("shared engine vectors (browser simulator = native engine)", () => {
  it("has the vectors", () => expect(vectors.cases.length).toBeGreaterThanOrEqual(10));
  for (const c of vectors.cases as { name: string; steps: Step[] }[]) {
    it(c.name, () => {
      const core = new SimCore();
      for (const s of c.steps) {
        core.advance(s.t);
        switch (s.do) {
          case undefined:
            break;
          case "setUniverse":
            core.setUniverse(sparse(s.values));
            break;
          case "fadeTo":
            core.fadeTo(sparse(s.target), s.transition!, s.layout === "all" ? ALL : s.layout!);
            break;
          case "pause":
            core.pause();
            break;
          case "resume":
            core.resume();
            break;
          case "stopFade":
            core.stopFade();
            break;
          case "blackout":
            core.blackout(!!s.on);
            break;
          case "fadeToBlack":
            core.fadeToBlack(s.seconds!);
            break;
          case "releaseBlack":
            core.releaseBlack(s.seconds!);
            break;
          case "grandMaster": {
            const mask = s.mask ? sparse(s.mask.map((ch) => [ch, 1] as Pair)) : undefined;
            core.grandMaster(s.level!, mask);
            break;
          }
          case "test":
            core.startTest(s.channels!, s.level!);
            break;
          case "stopTest":
            core.stopTest();
            break;
          default:
            throw new Error(`unknown command ${s.do}`);
        }
        const frame = core.frame();
        const under = core.playbackNow();
        for (const [ch, v] of s.expect ?? []) expect(frame[ch], `t = ${s.t}, channel ${ch}`).toBe(v);
        for (const [ch, v] of s.under ?? []) expect(under[ch], `t = ${s.t}, under channel ${ch}`).toBe(v);
        if (s.fade !== undefined) expect(core.fadeState().active, `t = ${s.t}, fade running`).toBe(s.fade);
      }
    });
  }
});

describe("simulated engine: bad values and universes", () => {
  it("treats NaN and Infinity times as the engine does", () => {
    const c = new SimCore();
    c.advance(0);
    c.fadeTo(uni([[0, 200]]), { fadeIn: NaN, fadeOut: Infinity, delay: -2, moveInDark: false }, ALL);
    expect(c.frame()[0]).toBe(200);
    c.fadeTo(uni([]), { fadeIn: 0, fadeOut: Infinity, delay: 0, moveInDark: false }, ALL);
    expect(c.fadeState().total).toBe(86_400);
    c.setUniverse(uni([[0, 200]]));
    c.fadeToBlack(NaN);
    expect(c.frame()[0]).toBe(0);
  });

  it("knows only universe 1", async () => {
    const sim = createSimDmx({ now: () => 0, timer: false });
    await expect(sim.setUniverse(uni([[0, 1]]), 2)).rejects.toThrow(/universe 2/);
    await expect(sim.setUniverse(uni([[0, 1]]), 1)).resolves.toBeUndefined();
    await expect(sim.fadeTo({ target: uni([]), transition: tr(0, 0), layout: ALL, universe: 3 })).rejects.toThrow();
    expect(await sim.fadeTo({ target: uni([]), transition: tr(0, 0), layout: ALL })).toBeGreaterThan(0);
  });
});
