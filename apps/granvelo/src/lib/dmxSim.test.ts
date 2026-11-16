import { describe, expect, it } from "vitest";
import { createSimDmx, SimCore, TEST_RISE } from "./dmxSim";
import type { EngineLayout } from "./dmx";

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
