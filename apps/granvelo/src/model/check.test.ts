import { describe, expect, it } from "vitest";
import { checkLook, checkPlan, checkValues, makesLight, restorePoint, runStep, setBroken, sharedWith, startRun, summarize, type CheckRun, type RunAction } from "./check";
import { docWith, light } from "./testkit";
import { visibleLight } from "./universe";

const slice = (u: Uint8Array, from: number, n: number) => Array.from(u.slice(from - 1, from - 1 + n));

describe("checkLook: one light on, everything else off", () => {
  it("halogen, PC, profile: the Main at the level", () => {
    const doc = docWith([light("f1", "halogen", 1), light("f2", "pc", 2), light("f3", "profile", 3)]);
    expect(slice(checkLook(doc, "f2", 1), 1, 4)).toEqual([0, 255, 0, 0]);
    expect(slice(checkLook(doc, "f2", 0.5), 1, 4)).toEqual([0, 128, 0, 0]);
    expect(slice(checkLook(doc, "f3", 1), 1, 4)).toEqual([0, 0, 255, 0]);
  });

  it("PAR RGB and RGBW without a Main: the colour channels are the intensity, so the level scales them", () => {
    const doc = docWith([light("f1", "parRgb", 10), light("f2", "parRgbw", 20)]);
    expect(slice(checkLook(doc, "f1", 1), 10, 3)).toEqual([255, 255, 255]);
    expect(slice(checkLook(doc, "f1", 0.5), 10, 3)).toEqual([128, 128, 128]);
    expect(slice(checkLook(doc, "f2", 1), 20, 4)).toEqual([255, 255, 255, 255]);
    expect(slice(checkLook(doc, "f2", 0.5, "red"), 20, 4)).toEqual([128, 0, 0, 0]);
    expect(slice(checkLook(doc, "f2", 1, "blue"), 20, 4)).toEqual([0, 0, 255, 0]);
  });

  it("PAR with a Main: colours at full, the Main at the level", () => {
    const doc = docWith([light("f1", "par6", 1), light("f2", "par7", 10)]);
    // dimmer, red, green, blue, strobe, macro
    expect(slice(checkLook(doc, "f1", 0.5), 1, 6)).toEqual([128, 255, 255, 255, 0, 0]);
    // dimmer, red, green, blue, white, amber, uv: white test = R G B W, never amber or UV
    expect(slice(checkLook(doc, "f2", 1), 10, 7)).toEqual([255, 255, 255, 255, 255, 0, 0]);
    expect(slice(checkLook(doc, "f2", 1, "green"), 10, 7)).toEqual([255, 0, 255, 0, 0, 0, 0]);
  });

  it("LED bar: strobe stays off", () => {
    const doc = docWith([light("f1", "ledBar", 1)]);
    expect(slice(checkLook(doc, "f1", 1), 1, 5)).toEqual([255, 255, 255, 255, 0]);
  });

  it("moving heads: Main and colours on, pan and tilt at the centre, the rest at 0", () => {
    const doc = docWith([light("w", "washMover", 1), light("s", "spotMover", 20)]);
    // pan, panFine, tilt, tiltFine, speed, dimmer, strobe, r, g, b, w
    expect(slice(checkLook(doc, "w", 1), 1, 11)).toEqual([127, 0, 127, 0, 0, 255, 0, 255, 255, 255, 255]);
    expect(slice(checkLook(doc, "w", 0.5, "red"), 1, 11)).toEqual([127, 0, 127, 0, 0, 128, 0, 255, 0, 0, 0]);
    // pan, panFine, tilt, tiltFine, speed, dimmer, strobe, colorWheel, gobo, focus
    expect(slice(checkLook(doc, "s", 1), 20, 10)).toEqual([127, 0, 127, 0, 0, 255, 0, 0, 0, 0]);
  });

  it("strobe light: steady white, no flashing; smoke machine: nothing fires", () => {
    const doc = docWith([light("a", "strobe", 1), light("b", "smoke", 10)]);
    expect(slice(checkLook(doc, "a", 1), 1, 2)).toEqual([255, 0]);
    expect(slice(checkLook(doc, "b", 1), 10, 2)).toEqual([0, 0]);
    expect(makesLight(doc.fixtures[0])).toBe(true);
    expect(makesLight(doc.fixtures[1])).toBe(false);
  });

  it("follows the channel order the user chose", () => {
    const f = light("f1", "parRgb", 5, {
      channels: [{ function: "blue" }, { function: "dimmer" }, { function: "red" }, { function: "strobe" }, { function: "green" }],
    });
    const doc = docWith([f]);
    expect(slice(checkLook(doc, "f1", 0.5), 5, 5)).toEqual([255, 128, 255, 0, 255]);
    expect(slice(checkLook(doc, "f1", 1, "red"), 5, 5)).toEqual([0, 255, 255, 0, 0]);
  });

  it("a light with an extra, unusual channel list: other functions stay at 0, pan/tilt at the centre", () => {
    const f = light("f1", "washMover", 1, { channels: [{ function: "macro" }, { function: "tilt" }, { function: "dimmer" }, { function: "other" }, { function: "pan" }, { function: "red" }] });
    expect(slice(checkLook(docWith([f]), "f1", 1), 1, 6)).toEqual([0, 127, 255, 0, 127, 255]);
  });

  it("a colour the light cannot make is asked as white (halogen, a light with only some colours)", () => {
    const doc = docWith([light("h", "halogen", 1), light("a", "parRgb", 5, { channels: [{ function: "dimmer" }, { function: "amber" }, { function: "uv" }] })]);
    expect(slice(checkLook(doc, "h", 1, "red"), 1, 1)).toEqual([255]);
    expect(slice(checkLook(doc, "a", 1, "red"), 5, 3)).toEqual([255, 255, 0]);
  });

  it("the colour it asks for is the colour the preview would show", () => {
    const f = light("f1", "par7", 1);
    const doc = docWith([f]);
    const seen = (color: "white" | "red" | "green" | "blue") => visibleLight(f, Array.from(checkLook(doc, "f1", 1, color).slice(0, 7))).hue;
    expect(seen("red")).toBe("#FF0000");
    expect(seen("green")).toBe("#00FF00");
    expect(seen("blue")).toBe("#0000FF");
  });

  it("turns on only that light: every other channel is 0, also with other lights around", () => {
    const doc = docWith([light("f1", "parRgb", 1), light("f2", "pc", 4), light("f3", "pc", 5), light("f4", "parRgb", 6)]);
    const u = checkLook(doc, "f2", 1);
    expect(u.length).toBe(512);
    expect(Array.from(u).reduce((n, v) => n + (v > 0 ? 1 : 0), 0)).toBe(1);
    expect(u[3]).toBe(255);
  });

  it("gives all zeros for a light that is not used, has no address, does not exist, and drops channels past 512", () => {
    const doc = docWith([light("a", "pc", 1, { unused: true }), light("b", "pc", null), light("c", "parRgb", 511)]);
    expect(Array.from(checkLook(doc, "a", 1)).some((v) => v > 0)).toBe(false);
    expect(Array.from(checkLook(doc, "b", 1)).some((v) => v > 0)).toBe(false);
    expect(Array.from(checkLook(doc, "zzz", 1)).some((v) => v > 0)).toBe(false);
    expect(slice(checkLook(doc, "c", 1), 511, 2)).toEqual([255, 255]);
  });

  it("bad levels are clamped", () => {
    const doc = docWith([light("a", "pc", 1)]);
    expect(checkLook(doc, "a", 7)[0]).toBe(255);
    expect(checkLook(doc, "a", -1)[0]).toBe(0);
    expect(checkLook(doc, "a", NaN)[0]).toBe(0);
    expect(checkValues(light("a", "pc", 1), 0.5)).toEqual([128]);
  });
});

describe("which lights, in what order", () => {
  const doc = docWith([
    light("f1", "pc", 1, { number: 5 }),
    light("f2", "pc", 2, { number: 2 }),
    light("f3", "pc", 3, { number: 3, unused: true }),
    light("f4", "pc", null, { number: 1 }),
    light("f5", "parRgb", 511, { number: 4 }),
    light("f6", "pc", 7, { number: 6 }),
  ]);
  it("goes by number, skipping what cannot be checked and saying why", () => {
    const p = checkPlan(doc);
    expect(p.steps).toEqual(["f2", "f1", "f6"]);
    expect(p.skipped).toEqual([
      { id: "f4", reason: "noAddress" },
      { id: "f3", reason: "unused" },
      { id: "f5", reason: "outOfRange" },
    ]);
  });
  it("is empty for a show without lights", () => {
    expect(checkPlan(docWith([]))).toEqual({ steps: [], skipped: [] });
  });
  it("tells which lights share channels", () => {
    const d = docWith([light("a", "pc", 5), light("b", "pc", 5), light("c", "pc", 6)]);
    expect(sharedWith(d, "a")).toEqual(["b"]);
    expect(sharedWith(d, "c")).toEqual([]);
  });
});

describe("the run", () => {
  const run = (actions: RunAction[], count = 3, from: CheckRun = startRun()) => actions.reduce((r, a) => runStep(r, a, count), from);
  it("moves forward and back and stops at the first light", () => {
    expect(run([{ type: "next" }, { type: "next" }]).index).toBe(2);
    expect(run([{ type: "back" }]).index).toBe(0);
  });
  it("Next on the last light leads to the summary; Back returns to the last light", () => {
    const end = run([{ type: "next" }, { type: "next" }, { type: "next" }]);
    expect(end.view).toBe("summary");
    expect(runStep(end, { type: "next" }, 3)).toBe(end);
    const back = runStep(end, { type: "back" }, 3);
    expect(back).toMatchObject({ view: "light", index: 2 });
  });
  it("a verdict can advance by itself, also from the last light", () => {
    const r = run([{ type: "verdict", id: "a", verdict: "ok", advance: true }, { type: "verdict", id: "b", verdict: "broken", advance: true }, { type: "verdict", id: "c", verdict: "ok", advance: true }]);
    expect(r.view).toBe("summary");
    expect(r.verdicts).toEqual({ a: "ok", b: "broken", c: "ok" });
  });
  it("a verdict can be changed, goto jumps from the summary, restart clears everything", () => {
    const r = run([{ type: "verdict", id: "a", verdict: "broken" }, { type: "verdict", id: "a", verdict: "ok" }, { type: "summary" }]);
    expect(r.verdicts).toEqual({ a: "ok" });
    expect(runStep(r, { type: "goto", index: 1 }, 3)).toMatchObject({ view: "light", index: 1 });
    expect(runStep(r, { type: "goto", index: 99 }, 3).index).toBe(2);
    expect(runStep(r, { type: "restart" }, 3)).toEqual(startRun());
  });
  it("a run with no lights stays on the first step without crashing", () => {
    expect(runStep(startRun(), { type: "back" }, 0).index).toBe(0);
    expect(runStep(startRun(), { type: "next" }, 0).view).toBe("summary");
  });
  it("sums up what works, what does not and what was not checked, in the order of the plan", () => {
    const s = summarize({ steps: ["a", "b", "c", "d"] }, { c: "broken", a: "ok" });
    expect(s).toEqual({ ok: ["a"], broken: ["c"], unchecked: ["b", "d"] });
  });
});

describe("leaving the check", () => {
  it("the restore point is an exact copy of what was under the master, unaffected by later changes", () => {
    const before = new Uint8Array(512);
    before[0] = 200;
    before[511] = 9;
    const point = restorePoint(before);
    before[0] = 0;
    expect(point[0]).toBe(200);
    expect(point[511]).toBe(9);
    expect(point.length).toBe(512);
  });
  it("accepts a plain array, a short one and out-of-range values", () => {
    const p = restorePoint([1, 300, -4]);
    expect(Array.from(p.slice(0, 4))).toEqual([1, 255, 0, 0]);
    expect(p.length).toBe(512);
  });
  it("after the check the cable carries exactly the restore point (check, then restore)", () => {
    const doc = docWith([light("a", "pc", 1), light("b", "pc", 2)]);
    const stage = new Uint8Array(512);
    stage[0] = 77;
    stage[1] = 30;
    const point = restorePoint(stage);
    const during = checkLook(doc, "b", 1);
    expect(Array.from(during.slice(0, 2))).toEqual([0, 255]);
    expect(Array.from(point.slice(0, 2))).toEqual([77, 30]);
  });
});

describe("marking a light", () => {
  const doc = docWith([light("a", "pc", 1), light("b", "pc", 2, { broken: true })]);
  it("marks and clears, changing nothing else", () => {
    const m = setBroken(doc, "a", true);
    expect(m.fixtures.map((f) => f.broken)).toEqual([true, true]);
    expect(m.fixtures[0]).toEqual({ ...doc.fixtures[0], broken: true });
    expect(setBroken(m, "b", false).fixtures.map((f) => f.broken)).toEqual([true, false]);
  });
  it("returns the same document when nothing changes (no undo step)", () => {
    expect(setBroken(doc, "b", true)).toBe(doc);
    expect(setBroken(doc, "a", false)).toBe(doc);
    expect(setBroken(doc, "zzz", true)).toBe(doc);
  });
});
