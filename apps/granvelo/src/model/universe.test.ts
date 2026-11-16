import { describe, expect, it } from "vitest";
import { applyMasters, emergencyValues, fixtureFactors, intensityIndexes, patchValues, readValues, renderUniverse, setColor, visibleLight } from "./universe";
import { docWith, light } from "./testkit";
import type { Group } from "./types";

const group = (id: string, fixtureIds: string[], level = 255): Group => ({ id, name: id, fixtureIds, level });

describe("patch", () => {
  it("writes each light at its address and nothing for unused or unaddressed lights", () => {
    const doc = docWith([light("f1", "parRgb", 1), light("f2", "pc", 10), light("f3", "pc", 11, { unused: true }), light("f4", "pc", null)]);
    const out = patchValues(doc, { f1: [10, 20, 30], f2: [200], f3: [99], f4: [77] });
    expect(Array.from(out.slice(0, 12))).toEqual([10, 20, 30, 0, 0, 0, 0, 0, 0, 200, 0, 0]);
    expect(out.length).toBe(512);
  });
  it("lets the higher value win on a conflict, whatever the order", () => {
    const a = docWith([light("f1", "pc", 5), light("f2", "pc", 5)]);
    const b = docWith([light("f2", "pc", 5), light("f1", "pc", 5)]);
    const v = { f1: [100], f2: [40] };
    expect(patchValues(a, v)[4]).toBe(100);
    expect(patchValues(b, v)[4]).toBe(100);
  });
  it("reads back what it wrote", () => {
    const doc = docWith([light("f1", "par7", 3), light("f2", "pc", 20)]);
    const values = { f1: [255, 1, 2, 3, 4, 5, 6], f2: [128] };
    expect(readValues(doc, patchValues(doc, values))).toEqual(values);
  });
  it("clamps and rounds values", () => {
    const doc = docWith([light("f1", "parRgb", 1)]);
    expect(Array.from(patchValues(doc, { f1: [300, -5, 12.5] }).slice(0, 3))).toEqual([255, 0, 13]);
  });
});

describe("intensity channels", () => {
  it("are the Main channels, or the colour channels of a light without a Main", () => {
    expect(intensityIndexes(light("a", "pc", 1))).toEqual([0]);
    expect(intensityIndexes(light("a", "parRgbw", 1))).toEqual([0, 1, 2, 3]);
    expect(intensityIndexes(light("a", "par6", 1))).toEqual([0]); // dimmer, r, g, b, strobe, macro
    expect(intensityIndexes(light("a", "washMover", 1))).toEqual([5]);
    expect(intensityIndexes(light("a", "smoke", 1))).toEqual([]);
  });
});

describe("groups and Grand Master", () => {
  const doc = docWith(
    [
      light("f1", "pc", 1),
      light("f2", "parRgb", 2), // no Main: colour channels scale
      light("f3", "washMover", 10), // pan, panFine, tilt, tiltFine, speed, dimmer, strobe, r, g, b, w
      light("f4", "smoke", 30),
    ],
    { groups: [group("g1", ["f1", "f2"], 128), group("g2", ["f1"], 255)] },
  );
  const values = { f1: [200], f2: [200, 100, 50], f3: [10, 20, 30, 40, 50, 200, 60, 255, 128, 0, 0], f4: [180, 90] };

  it("scales the intensity of the lights of a group in proportion", () => {
    const out = renderUniverse(doc, values);
    expect(out[0]).toBe(Math.floor(200 * (128 / 255) + 0.5)); // 100
    expect(Array.from(out.slice(1, 4))).toEqual([100, 50, 25]);
    expect(out[14]).toBe(200); // f3 is in no group
  });

  it("multiplies the levels of the groups a light belongs to, then the Grand Master", () => {
    const f = fixtureFactors(doc, { groups: { g2: 51 }, grandMaster: 255 });
    expect(f.get("f1")).toBeCloseTo((128 / 255) * (51 / 255));
    const half = renderUniverse(doc, values, { grandMaster: 128 });
    expect(half[0]).toBe(Math.floor(200 * (128 / 255) * (128 / 255) + 0.5));
    expect(half[14]).toBe(Math.floor(200 * (128 / 255) + 0.5));
  });

  it("never scales pan, tilt, colour of a light with a Main, strobe or smoke", () => {
    const out = renderUniverse(doc, values, { grandMaster: 0 });
    expect(out[0]).toBe(0);
    expect(Array.from(out.slice(1, 4))).toEqual([0, 0, 0]);
    expect(Array.from(out.slice(9, 20))).toEqual([10, 20, 30, 40, 50, 0, 60, 255, 128, 0, 0]);
    expect(Array.from(out.slice(29, 31))).toEqual([180, 90]);
  });

  it("does not change the raw values it is given and leaves channels of no light alone", () => {
    const raw = new Uint8Array(512);
    raw[0] = 200;
    raw[400] = 99;
    const out = applyMasters(doc, raw, { grandMaster: 0 });
    expect(raw[0]).toBe(200);
    expect(out[0]).toBe(0);
    expect(out[400]).toBe(99);
  });

  it("gives a shared intensity channel the larger factor", () => {
    const d = docWith([light("a", "pc", 1), light("b", "pc", 1)], { groups: [group("g", ["a"], 0)] });
    expect(renderUniverse(d, { a: [200], b: [200] })[0]).toBe(200);
  });
});

describe("colour", () => {
  it("sets R, G, B and takes the common part into white", () => {
    const f = light("f", "parRgbw", 1);
    expect(setColor(f, [0, 0, 0, 0], { r: 255, g: 200, b: 100 })).toEqual([155, 100, 0, 100]);
  });
  it("uses amber for oranges and never touches Main or UV", () => {
    const f = light("f", "par7", 1); // dimmer, r, g, b, w, a, uv
    expect(setColor(f, [180, 0, 0, 0, 0, 0, 77], { r: 255, g: 128, b: 0 })).toEqual([180, 85, 1, 0, 0, 170, 77]);
  });
  it("leaves a light without colour channels as it is", () => {
    expect(setColor(light("f", "pc", 1), [140], { r: 0, g: 0, b: 255 })).toEqual([140]);
  });
  it("derives the visible colour of the lens from the values", () => {
    expect(visibleLight(light("f", "parRgb", 1), [255, 0, 0])).toEqual({ hue: "#FF0000", level: 1, color: "#FF0000" });
    expect(visibleLight(light("f", "par6", 1), [128, 0, 0, 255, 0, 0])).toMatchObject({ hue: "#0000FF", color: "#000080" });
    const halogen = visibleLight(light("f", "pc", 1), [255]);
    expect(halogen).toEqual({ hue: "#FFD9A0", level: 1, color: "#FFD9A0" });
    expect(visibleLight(light("f", "pc", 1), [0]).level).toBe(0);
    expect(visibleLight(light("f", "smoke", 1), [255, 255]).hue).toBeNull();
    const dark = visibleLight(light("f", "parRgb", 1), [0, 0, 0]);
    expect(dark.level).toBe(0);
    expect(dark.color).toBe("#000000");
  });
});

describe("emergency", () => {
  it("brings every used light to white at full, without strobe or smoke, keeping positions", () => {
    const doc = docWith([light("m", "washMover", 1), light("p", "par7", 20), light("s", "smoke", 40), light("u", "pc", 50, { unused: true })]);
    const v = emergencyValues(doc, { m: [11, 12, 13, 14, 15, 0, 200, 0, 0, 0, 0], s: [200, 200] });
    expect(v.m).toEqual([11, 12, 13, 14, 15, 255, 0, 255, 255, 255, 255]);
    expect(v.p).toEqual([255, 255, 255, 255, 255, 0, 0]);
    expect(v.s).toEqual([0, 0]);
    expect(v.u).toBeUndefined();
  });
});
