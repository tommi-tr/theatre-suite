import { describe, expect, it } from "vitest";
import { addGroup, applyColor, deskUniverse, emptyValues, hasColorPicker, intensityOf, memoryNumberFree, pickerColor, reconcileValues, removeGroup, renameMemory, saveMemoryValues, saveNewMemory, setGroupLevel, setMemoryNumber, shownUniverse, valuesDiffer, withChannel, withIntensity } from "./desk";
import { captureState } from "./memories";
import { docWith, light } from "./testkit";
import type { GranveloDoc, Memory } from "./types";

const mem = (doc: GranveloDoc, id: string, number: number, values: Record<string, number[]>): Memory => ({
  id,
  number,
  label: id,
  note: "",
  state: captureState(doc, values, doc.settings.memoryBinding),
  scenery: [{ sceneryId: "s", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  transition: { fadeIn: 1, fadeOut: 1, delay: 0, autoFollow: false, moveInDark: false },
});

const base = () => docWith([light("a1", "pc", 1), light("b2", "parRgb", 5), light("c3", "pc", null)]);

describe("desk values", () => {
  it("starts at zero and keeps values by light id when the patch changes", () => {
    const doc = base();
    const v = withChannel(emptyValues(doc), doc.fixtures[0], 0, 200);
    expect(v.a1).toEqual([200]);
    const moved = { ...doc, fixtures: doc.fixtures.map((f) => (f.id === "a1" ? { ...f, address: 40 } : f)).filter((f) => f.id !== "c3") };
    const r = reconcileValues(moved, v);
    expect(r.a1).toEqual([200]);
    expect(r.c3).toBeUndefined();
    expect(deskUniverse(moved, r)[39]).toBe(200);
    expect(reconcileValues(moved, r)).toBe(r);
  });

  it("applies the groups but not the Grand Master in deskUniverse", () => {
    const doc = base();
    const g = addGroup(doc, "Front", ["a1"]);
    const half = setGroupLevel(g.doc, g.id, 128);
    const v = withChannel(emptyValues(half), half.fixtures[0], 0, 200);
    expect(deskUniverse(half, v)[0]).toBe(100);
    expect(shownUniverse(half, v, 128)[0]).toBe(50);
  });

  it("compares with a memory, ignoring unused lights and unaddressed lights (address binding)", () => {
    const doc = base();
    const m = mem(doc, "m1", 1, { a1: [100], b2: [1, 2, 3], c3: [0] });
    const d = { ...doc, memories: [m] };
    const same = { a1: [100], b2: [1, 2, 3], c3: [77] };
    expect(valuesDiffer(d, same, m)).toBe(false);
    expect(valuesDiffer(d, { ...same, a1: [101] }, m)).toBe(true);
    expect(valuesDiffer({ ...d, fixtures: d.fixtures.map((f) => (f.id === "a1" ? { ...f, unused: true } : f)) }, { ...same, a1: [5] }, m)).toBe(false);
  });
});

describe("intensity and colour", () => {
  it("one intensity per light", () => {
    const rgb = light("p1", "parRgb", 1);
    expect(intensityOf(rgb, [255, 128, 0])).toBe(255);
    expect(withIntensity(rgb, [200, 100, 0], 100)).toEqual([100, 50, 0]);
    expect(withIntensity(rgb, [0, 0, 0], 90)).toEqual([90, 90, 90]);
    const pc = light("a1", "pc", 1);
    expect(withIntensity(pc, [10], 99)).toEqual([99]);
  });

  it("the picker sets R, G, B only on lights that have them", () => {
    const doc = base();
    expect(hasColorPicker(doc.fixtures[1])).toBe(true);
    expect(hasColorPicker(doc.fixtures[0])).toBe(false);
    const v = applyColor(doc, emptyValues(doc), ["a1", "b2"], "#FF8000");
    expect(v.b2).toEqual([255, 128, 0]);
    expect(v.a1).toEqual([0]);
    expect(pickerColor(doc.fixtures[1], v.b2)).toBe("#FF8000");
  });
});

describe("groups and memories", () => {
  it("adds, renames and removes a group", () => {
    const doc = base();
    const { doc: d, id } = addGroup(doc, " Fondale ", ["a1", "zzz", "a1"]);
    expect(d.groups[0]).toMatchObject({ name: "Fondale", fixtureIds: ["a1"], level: 255 });
    expect(removeGroup(d, id).groups).toHaveLength(0);
  });

  it("saves over a memory keeping its scenery, label and transition", () => {
    const doc = base();
    const m = mem(doc, "m1", 1, { a1: [10], b2: [0, 0, 0], c3: [0] });
    const d = saveMemoryValues({ ...doc, memories: [m] }, "m1", { a1: [222], b2: [1, 1, 1], c3: [0] });
    expect(d.memories[0].scenery).toEqual(m.scenery);
    expect(d.memories[0].transition).toEqual(m.transition);
    expect(valuesDiffer(d, { a1: [222], b2: [1, 1, 1], c3: [0] }, d.memories[0])).toBe(false);
  });

  it("saves as new with the default crossfade at the end of the sequence; refuses a taken number", () => {
    const doc = { ...base(), settings: { ...base().settings, defaultCrossfade: 4 } };
    const r = saveNewMemory(doc, { a1: [50], b2: [0, 0, 0], c3: [0] }, 3, " Alba ")!;
    expect(r.doc.memories[0]).toMatchObject({ number: 3, label: "Alba", transition: { fadeIn: 4, fadeOut: 4 } });
    expect(r.doc.sequence).toEqual([r.id]);
    expect(saveNewMemory(r.doc, {}, 3, "x")).toBeNull();
    expect(saveNewMemory(r.doc, {}, 0, "x")).toBeNull();
    expect(saveNewMemory(r.doc, {}, 1.5, "x")).toBeNull();
  });

  it("renumbers with unique positive integers", () => {
    const doc = base();
    const d = { ...doc, memories: [mem(doc, "m1", 1, {}), mem(doc, "m2", 2, {})] };
    expect(memoryNumberFree(d, 2)).toBe(false);
    expect(memoryNumberFree(d, 2, "m2")).toBe(true);
    expect(setMemoryNumber(d, "m1", 2)).toBeNull();
    expect(setMemoryNumber(d, "m1", 7)!.memories[0].number).toBe(7);
    expect(renameMemory(d, "m1", " Buio ").memories[0].label).toBe("Buio");
  });
});
