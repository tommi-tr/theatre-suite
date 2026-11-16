import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureState } from "../model/memories";
import { docWith, light } from "../model/testkit";
import type { GranveloDoc, Memory } from "../model/types";
import { useDesk } from "./desk";
import { useDoc } from "./doc";
import { useOutput } from "./output";
import { emergencyUniverse, useShow } from "./show";
import type { FadePayload } from "../lib/dmx";

const mem = (doc: GranveloDoc, id: string, number: number, values: Record<string, number[]>, autoFollow = false): Memory => ({
  id,
  number,
  label: id,
  note: "",
  state: captureState(doc, values, doc.settings.memoryBinding),
  scenery: [],
  transition: { fadeIn: 1, fadeOut: 1, delay: 0, autoFollow, moveInDark: false },
});

function makeDoc(): GranveloDoc {
  const d = docWith([light("a1", "pc", 1), light("b2", "parRgb", 5)]);
  return {
    ...d,
    memories: [mem(d, "m1", 1, { a1: [100], b2: [0, 0, 0] }, true), mem(d, "m2", 2, { a1: [0], b2: [200, 100, 50] }), mem(d, "m3", 3, { a1: [10], b2: [0, 0, 0] })],
    sequence: ["m1", "m2", "m3"],
    groups: [{ id: "g", name: "G", fixtureIds: ["a1"], level: 128 }],
  };
}

const calls: Array<[string, unknown[]]> = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rec = (name: string): any => async (...args: unknown[]) => {
  calls.push([name, args]);
  return 1;
};
const names = () => calls.map((c) => c[0]);
const show = () => useShow.getState();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  calls.length = 0;
  useOutput.setState({
    setUniverse: rec("setUniverse"),
    fadeTo: rec("fadeTo"),
    pause: rec("pause"),
    resume: rec("resume"),
    blackout: rec("blackout"),
    fadeToBlack: rec("fadeToBlack"),
    releaseBlack: rec("releaseBlack"),
    setGrandMaster: rec("setGrandMaster"),
  });
  useDoc.getState().load(makeDoc(), { filePath: null, dirty: false });
  calls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("show store", () => {
  it("GO sends the memory's fade (groups applied) and hands the memory to the desk", () => {
    expect(show().show.readyId).toBe("m1");
    show().dispatch({ type: "go" });
    expect(names()).toEqual(["fadeTo"]);
    const p = calls[0][1][0] as FadePayload;
    expect(p.target[0]).toBe(50); // a1 at 100, group at 128/255
    expect(p.transition).toEqual({ fadeIn: 1, fadeOut: 1, delay: 0, moveInDark: false });
    expect(useDesk.getState().liveMemoryId).toBe("m1");
    expect(useDesk.getState().values.a1).toEqual([100]);
    expect(useDesk.getState().modified).toBe(false);
  });

  it("'starts by itself' runs on its own clock", () => {
    show().dispatch({ type: "go" });
    vi.advanceTimersByTime(1100);
    expect(names()).toEqual(["fadeTo", "fadeTo"]);
    expect(show().show.liveId).toBe("m2");
    vi.advanceTimersByTime(1100);
    expect(show().show.fade).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(names()).toEqual(["fadeTo", "fadeTo"]);
  });

  it("editing a transition during a fade does not resend the desk (the fade is not cut)", () => {
    useDesk.getState().activate();
    useOutput.setState({ live: { ...useOutput.getState().live, fade: { ...useOutput.getState().live.fade, active: true } } });
    show().dispatch({ type: "go" });
    calls.length = 0;
    useDoc.getState().change((d) => ({ ...d, memories: d.memories.map((m) => (m.id === "m2" ? { ...m, transition: { ...m.transition, fadeIn: 9 } } : m)) }));
    useDesk.getState().activate();
    expect(names().filter((n) => n === "setUniverse")).toEqual([]);
    useOutput.setState({ live: { ...useOutput.getState().live, fade: { ...useOutput.getState().live.fade, active: false } } });
  });

  it("emergency: all white at full, masters released; leaving it gives the stage back to the desk", () => {
    show().dispatch({ type: "go" });
    show().dispatch({ type: "blackout" });
    calls.length = 0;
    expect(show().dispatch({ type: "emergency" })).toBe("emergencyArmed");
    expect(calls).toEqual([]);
    show().dispatch({ type: "emergency" });
    expect(names()).toEqual(["setUniverse", "blackout", "releaseBlack", "setGrandMaster"]);
    const u = calls[0][1][0] as Uint8Array;
    expect(Array.from(u.slice(0, 7))).toEqual([255, 0, 0, 0, 255, 255, 255]);
    expect(calls[1][1][0]).toBe(false);
    expect(calls[3][1][0]).toBe(255);
    calls.length = 0;
    show().dispatch({ type: "leaveEmergency" });
    expect(names()).toEqual(["fadeTo", "setGrandMaster", "blackout"]);
    expect((calls[0][1][0] as FadePayload).target[0]).toBe(50);
    expect(calls[2][1][0]).toBe(true);
    expect(show().show.blackout).toBe(true);
  });

  it("emergency with a chosen memory plays it as saved", () => {
    const doc = useDoc.getState().doc!;
    expect(emergencyUniverse(doc, "m2")[4]).toBe(200);
    expect(emergencyUniverse(doc, "m1")[0]).toBe(100); // the group does not dim it
    expect(emergencyUniverse(doc, "zz")[0]).toBe(255);
  });

  it("GO works with the output not connected (the engine keeps the values for when it connects)", () => {
    expect(useOutput.getState().status.link.state).toBe("idle");
    show().dispatch({ type: "go" });
    expect(show().show.liveId).toBe("m1");
    expect(names()).toEqual(["fadeTo"]);
  });

  it("a new show starts from the top, unlocked", () => {
    show().dispatch({ type: "go" });
    show().setLocked(true);
    useDoc.getState().load(makeDoc(), { filePath: null, dirty: false });
    expect(show().show.liveId).toBeNull();
    expect(show().show.readyId).toBe("m1");
    expect(show().locked).toBe(false);
  });
});
