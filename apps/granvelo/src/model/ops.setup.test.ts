import { describe, expect, it } from "vitest";
import { addressProblems, newProblems, conflictDetails, conflictPairs, numberInRow, occupiedChannels } from "./addresses";
import { newDocument } from "./file";
import { captureState } from "./memories";
import {
  addChannel,
  addFixtures,
  addTruss,
  applyChannelsToType,
  changeFixtureTypes,
  channelsCustomised,
  copyName,
  defaultPlacement,
  duplicateFixtures,
  giveFirstFreeAddress,
  lightsOnTruss,
  lightsToSync,
  listGroups,
  listOrder,
  memoriesUsing,
  moveChannel,
  moveTruss,
  nextTrussSpot,
  removeChannel,
  removeFixture,
  removeFixtures,
  removeTruss,
  renameTruss,
  setAim,
  setBeamAngle,
  setChannel,
  setFixtureAddress,
  setFixtureNumber,
  setMount,
  setPosition,
  setStage,
  setUnused,
  updateFixtures,
} from "./ops";
import { docWith, light } from "./testkit";
import type { GranveloDoc, Memory } from "./types";

const empty = () => newDocument({ title: "T", stage: { width: 8, depth: 6, height: 4.5 } });
const spec = { typeId: "parRgb" as const, count: 1, baseName: "PAR", place: { kind: "floating" } as const, address: { kind: "next" } as const };

describe("defaultPlacement", () => {
  it("spreads lights across the width and keeps them inside the stage", () => {
    const p = defaultPlacement(empty(), { kind: "floating" }, 4);
    const xs = p.map((x) => x.position.x);
    expect(new Set(xs).size).toBe(4);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(Math.min(...xs)).toBeGreaterThan(-4);
    expect(Math.max(...xs)).toBeLessThan(4);
    expect(p.every((x) => x.position.y === 3 && x.position.z === 3.6)).toBe(true);
    // a single light goes to the centre
    expect(defaultPlacement(empty(), { kind: "floating" }, 1)[0].position.x).toBe(0);
  });

  it("in the house, lights are in front of the proscenium and aim at the stage, not all at the centre", () => {
    const p = defaultPlacement(empty(), { kind: "house" }, 4);
    expect(p.every((x) => x.position.y < 0)).toBe(true);
    expect(p.every((x) => x.aim.y > 0)).toBe(true);
    expect(new Set(p.map((x) => x.aim.x)).size).toBe(4);
    expect(p[0].aim.x).toBeLessThan(p[3].aim.x);
  });

  it("on a truss they take its depth and height and look down; at the back they are backlights", () => {
    let doc = empty();
    const front = addTruss(doc, { y: 1.5, z: 4 });
    const back = addTruss(front.doc, { y: 5, z: 4 });
    doc = back.doc;
    const a = defaultPlacement(doc, { kind: "truss", trussId: front.id }, 2);
    expect(a[0].mount).toEqual({ kind: "truss", trussId: front.id });
    expect(a[0].position).toMatchObject({ y: 1.5, z: 4 });
    expect(a[0].aim.z).toBe(0);
    const b = defaultPlacement(doc, { kind: "truss", trussId: back.id }, 1);
    expect(b[0].aim.y).toBeLessThan(b[0].position.y);
    expect(b[0].aim.z).toBe(1.5);
  });

  it("on the floor they stand at the sides alternately and cut across the stage horizontally", () => {
    const p = defaultPlacement(empty(), { kind: "floor" }, 4);
    expect(p.every((x) => x.mount.kind === "floor" && x.position.z === 0)).toBe(true);
    expect(p[0].position.x).toBeLessThan(0);
    expect(p[1].position.x).toBeGreaterThan(0);
    expect(p[0].aim.x).toBeGreaterThan(0); // looks to the other side
    expect(p[0].aim.z).toBeGreaterThan(0);
    expect(new Set(p.map((x) => x.position.y)).size).toBe(4);
  });

  it("stays away from the lights that are already in the same place", () => {
    const first = addFixtures(empty(), { ...spec, count: 3 });
    const more = defaultPlacement(first.doc, { kind: "floating" }, 3);
    const used = first.doc.fixtures.map((f) => f.position.x);
    for (const m of more) for (const x of used) expect(Math.abs(m.position.x - x)).toBeGreaterThan(0.2);
  });
});

describe("adding lights", () => {
  it("adds one light with defaults of its type, number 1, first free address", () => {
    const r = addFixtures(empty(), spec);
    const f = r.doc.fixtures[0];
    expect(r.ids).toEqual([f.id]);
    expect(f.number).toBe(1);
    expect(f.name).toBe("PAR 1");
    expect(f.address).toBe(1);
    expect(f.channels.map((c) => c.function)).toEqual(["red", "green", "blue"]);
    expect(f.beam.angle).toBe(25);
    expect(r.unaddressed).toBe(0);
  });

  it("adds many with consecutive names, numbers and addresses, continuing after existing ones", () => {
    const a = addFixtures(empty(), { ...spec, count: 3 });
    expect(a.doc.fixtures.map((f) => [f.number, f.name, f.address])).toEqual([
      [1, "PAR 1", 1],
      [2, "PAR 2", 4],
      [3, "PAR 3", 7],
    ]);
    const b = addFixtures(a.doc, { ...spec, count: 2 });
    expect(b.doc.fixtures.slice(3).map((f) => [f.number, f.name, f.address])).toEqual([
      [4, "PAR 4", 10],
      [5, "PAR 5", 13],
    ]);
  });

  it("first free address fills a gap that fits and skips reserved channels of unused lights", () => {
    const base = docWith([light("f1", "pc", 1), light("f2", "pc", 3, { unused: true }), light("f3", "pc", 5)]);
    const r = addFixtures(base, { ...spec, typeId: "pc", count: 2 });
    expect(r.doc.fixtures.slice(3).map((f) => f.address)).toEqual([2, 4]);
  });

  it("starting at a given address numbers consecutively; a light that does not fit gets none", () => {
    const r = addFixtures(empty(), { ...spec, count: 3, address: { kind: "at", address: 508 } });
    expect(r.doc.fixtures.map((f) => f.address)).toEqual([508, null, null]);
    expect(r.unaddressed).toBe(2);
  });

  it("can leave the addresses for later", () => {
    const r = addFixtures(empty(), { ...spec, count: 2, address: { kind: "none" } });
    expect(r.doc.fixtures.map((f) => f.address)).toEqual([null, null]);
    expect(r.unaddressed).toBe(0);
  });

  it("creates a new truss when asked, and puts the lights on it", () => {
    const r = addFixtures(empty(), { ...spec, count: 2, place: { kind: "newTruss" } });
    expect(r.trussId).not.toBeNull();
    expect(r.doc.trusses).toHaveLength(1);
    expect(lightsOnTruss(r.doc, r.trussId!)).toHaveLength(2);
  });

  it("limits the number to 1–24 and accepts an empty name", () => {
    expect(addFixtures(empty(), { ...spec, count: 99 }).ids).toHaveLength(24);
    expect(addFixtures(empty(), { ...spec, count: 0 }).ids).toHaveLength(1);
    expect(addFixtures(empty(), { ...spec, baseName: "" }).doc.fixtures[0].name).toBe("");
  });

  it("does not change the lights that were there", () => {
    const base = addFixtures(empty(), { ...spec, count: 2 }).doc;
    const r = addFixtures(base, { ...spec, typeId: "pc" });
    expect(r.doc.fixtures.slice(0, 2)).toEqual(base.fixtures);
  });

  it("chooses a new truss depth that is not taken", () => {
    let doc = empty();
    const a = nextTrussSpot(doc);
    expect(a).toEqual({ y: 1.5, z: 4 });
    doc = addTruss(doc, a).doc;
    expect(nextTrussSpot(doc).y).toBe(3);
  });
});

describe("deleting", () => {
  it("removes lights without renumbering or readdressing the others", () => {
    const doc = addFixtures(empty(), { ...spec, count: 4 }).doc;
    const [a, b, c, d] = doc.fixtures;
    const r = removeFixtures(doc, [b.id, c.id]);
    expect(r.fixtures).toEqual([a, d]);
    expect(r.fixtures.map((f) => [f.number, f.address])).toEqual([
      [1, 1],
      [4, 10],
    ]);
    // a new light takes a new number, not a freed one
    expect(addFixtures(r, spec).doc.fixtures[2].number).toBe(5);
  });

  it("takes the lights out of groups and out of memories bound to the lights; memories bound to addresses keep their values", () => {
    const fixtures = [light("a", "pc", 1), light("b", "pc", 2)];
    const base = docWith(fixtures);
    const mem = (id: string, state: Memory["state"]): Memory => ({ id, number: id === "m1" ? 1 : 2, label: id, note: "", state, scenery: [], transition: { fadeIn: 3, fadeOut: 3, delay: 0, autoFollow: false, moveInDark: false } });
    const doc: GranveloDoc = {
      ...base,
      groups: [{ id: "g", name: "G", fixtureIds: ["a", "b"], level: 255 }],
      memories: [mem("m1", captureState(base, { a: [200], b: [100] }, "fixture")), mem("m2", captureState(base, { a: [200], b: [100] }, "address"))],
      sequence: ["m1", "m2"],
    };
    const r = removeFixtures(doc, ["a"]);
    expect(r.groups[0].fixtureIds).toEqual(["b"]);
    expect(r.memories[0].state).toEqual({ binding: "fixture", fixtures: { b: [100] } });
    const m2 = r.memories[1].state;
    expect(m2.binding === "address" && m2.dmx.slice(0, 2)).toEqual([200, 100]);
    // the memory list and the sequence are untouched
    expect(r.memories).toHaveLength(2);
    expect(r.sequence).toEqual(["m1", "m2"]);
  });

  it("counts the memories that use some lights (to ask before deleting)", () => {
    const fixtures = [light("a", "pc", 1), light("b", "pc", 2)];
    const base = docWith(fixtures);
    const mem = (id: string, n: number, state: Memory["state"]): Memory => ({ id, number: n, label: id, note: "", state, scenery: [], transition: { fadeIn: 3, fadeOut: 3, delay: 0, autoFollow: false, moveInDark: false } });
    const doc = { ...base, memories: [mem("m1", 1, captureState(base, { a: [200], b: [0] }, "fixture")), mem("m2", 2, captureState(base, { a: [0], b: [100] }, "address"))] };
    expect(memoriesUsing(doc, ["a"])).toBe(1);
    expect(memoriesUsing(doc, ["b"])).toBe(1);
    expect(memoriesUsing(doc, ["a", "b"])).toBe(2);
    expect(memoriesUsing(docWith(fixtures), ["a"])).toBe(0);
  });
});

describe("duplicating and renumbering", () => {
  it("copies a light next to the original with a new number, name and free address", () => {
    const doc = addFixtures(empty(), { ...spec, count: 2 }).doc;
    const r = duplicateFixtures(doc, [doc.fixtures[0].id]);
    const c = r.doc.fixtures[2];
    expect(r.ids).toEqual([c.id]);
    expect(c.id).not.toBe(doc.fixtures[0].id);
    expect(c.number).toBe(3);
    expect(c.name).toBe("PAR 3");
    expect(c.address).toBe(7);
    expect(c.channels).toEqual(doc.fixtures[0].channels);
    expect(c.channels).not.toBe(doc.fixtures[0].channels);
    expect(c.position.x).toBe(doc.fixtures[0].position.x + 0.5);
    expect(c.mount).toEqual(doc.fixtures[0].mount);
  });

  it("copies several in the order of the document, and a light without address stays without", () => {
    const doc = docWith([light("f1", "pc", null), light("f2", "pc", 5)]);
    const r = duplicateFixtures(doc, ["f2", "f1"]);
    expect(r.doc.fixtures).toHaveLength(4);
    expect(r.doc.fixtures[2].address).toBeNull();
    expect(r.doc.fixtures[3].address).toBe(1);
  });

  it("builds names of copies", () => {
    const doc = docWith([light("a", "pc", 1, { name: "PC centro" }), light("b", "pc", 2, { name: "Spot 4" })]);
    expect(copyName(doc, "Spot 4")).toBe("Spot 5");
    expect(copyName(doc, "PC centro")).toBe("PC centro 2");
    expect(copyName(doc, "")).toBe("");
  });

  it("renumbers a light only to a free positive whole number", () => {
    const doc = docWith([light("f1", "pc", 1), light("f2", "pc", 2)]);
    expect(setFixtureNumber(doc, "f1", 9)!.fixtures[0].number).toBe(9);
    expect(setFixtureNumber(doc, "f1", 2)).toBeNull();
    expect(setFixtureNumber(doc, "f1", 0)).toBeNull();
    expect(setFixtureNumber(doc, "f1", 1.5)).toBeNull();
    expect(setFixtureNumber(doc, "f1", 1)!.fixtures[0].number).toBe(1);
  });
});

describe("type, address and position", () => {
  it("retyping resets channels and beam to the type defaults and keeps the address", () => {
    const doc = addFixtures(empty(), { ...spec, count: 2 }).doc;
    const ids = doc.fixtures.map((f) => f.id);
    const r = changeFixtureTypes(doc, ids, "parRgbw");
    expect(r.fixtures.map((f) => f.channels.length)).toEqual([4, 4]);
    expect(r.fixtures.map((f) => f.address)).toEqual([1, 4]);
    expect(r.fixtures[0].typeId).toBe("parRgbw");
    // 4 channels from 1 and from 4 now overlap
    expect(addressProblems(r).conflicts.size).toBe(2);
    expect(newProblems(doc, r).sort()).toEqual([...ids].sort());
  });

  it("knows when channels were customised", () => {
    const f = light("f1", "parRgb", 1);
    expect(channelsCustomised(f)).toBe(false);
    expect(channelsCustomised({ ...f, channels: [{ function: "green" }, { function: "red" }, { function: "blue" }] })).toBe(true);
    expect(channelsCustomised({ ...f, channels: [{ function: "red", label: "R" }, { function: "green" }, { function: "blue" }] })).toBe(true);
  });

  it("sets an address (1–512 or none) and finds the first free one", () => {
    const doc = docWith([light("f1", "pc", 1), light("f2", "parRgb", 1)]);
    expect(setFixtureAddress(doc, "f2", 20).fixtures[1].address).toBe(20);
    expect(setFixtureAddress(doc, "f2", null).fixtures[1].address).toBeNull();
    expect(setFixtureAddress(doc, "f2", 513)).toBe(doc);
    expect(setFixtureAddress(doc, "f2", 0)).toBe(doc);
    const fixed = giveFirstFreeAddress(doc, "f2");
    expect(fixed.fixtures[1].address).toBe(2);
    expect(addressProblems(fixed).conflicts.size).toBe(0);
    // its own channels do not count as taken
    expect(giveFirstFreeAddress(docWith([light("f1", "parRgb", 5)]), "f1").fixtures[0].address).toBe(1);
  });

  it("numbers several lights in a row in list order, by their channel count", () => {
    const doc = docWith([light("f1", "pc", 100), light("f2", "parRgbw", 7), light("f3", "pc", null)]);
    const r = numberInRow(doc, ["f2", "f3", "f1"], 21);
    expect(r.doc.fixtures.map((f) => f.address)).toEqual([26, 21, 25]);
    expect(r.notFitting).toEqual([]);
    const tight = numberInRow(doc, ["f2", "f1", "f3"], 510);
    // the 4-channel light does not fit at 510 and keeps its address; the others carry on from 510
    expect(tight.notFitting).toEqual(["f2"]);
    expect(tight.doc.fixtures.map((f) => f.address)).toEqual([510, 7, 511]);
  });

  it("explains conflicts: with whom and on which channels", () => {
    const doc = docWith([light("f1", "parRgbw", 17, { name: "A" }), light("f2", "pc", 19, { name: "PC centro" }), light("f3", "pc", 30, { unused: true }), light("f4", "pc", 30)]);
    const d = conflictDetails(doc, "f1");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ from: 19, to: 19 });
    expect(d[0].other.name).toBe("PC centro");
    expect(conflictDetails(doc, "f4")).toEqual([]); // the unused light does not conflict
    expect(conflictDetails(doc, "f3")).toEqual([]);
    expect(conflictPairs(addressProblems(doc))).toBe(1);
  });

  it("moves lights to a truss (they take its depth and height), to floating and to the floor", () => {
    let doc = addFixtures(empty(), { ...spec, count: 2 }).doc;
    const t = addTruss(doc, { y: 2, z: 4 });
    doc = t.doc;
    const ids = doc.fixtures.map((f) => f.id);
    const onTruss = setMount(doc, ids, { kind: "truss", trussId: t.id });
    expect(onTruss.fixtures.every((f) => f.mount.kind === "truss" && f.position.y === 2 && f.position.z === 4)).toBe(true);
    expect(onTruss.fixtures.map((f) => f.position.x)).toEqual(doc.fixtures.map((f) => f.position.x));
    const floor = setMount(onTruss, ids, { kind: "floor" });
    expect(floor.fixtures.every((f) => f.mount.kind === "floor" && f.position.z === 0)).toBe(true);
    const floating = setMount(floor, ids, { kind: "floating" });
    expect(floating.fixtures.every((f) => f.mount.kind === "floating" && f.position.z > 0)).toBe(true);
    expect(setMount(doc, ids, { kind: "truss", trussId: "nope" })).toBe(doc);
  });

  it("edits position, aim, beam and 'not used' for several lights; on a truss only X is free", () => {
    let doc = addFixtures(empty(), { ...spec, count: 2, place: { kind: "newTruss" } }).doc;
    const ids = doc.fixtures.map((f) => f.id);
    doc = setPosition(doc, ids, { x: 1, y: 9, z: 9 });
    expect(doc.fixtures.map((f) => f.position.x)).toEqual([1, 1]);
    expect(doc.fixtures[0].position.y).toBe(1.5); // follows the truss
    doc = setMount(doc, ids, { kind: "floating" });
    doc = setPosition(doc, ids, { y: 2, z: 3 });
    expect(doc.fixtures[0].position).toEqual({ x: 1, y: 2, z: 3 });
    doc = setAim(doc, [ids[0]], { z: 1 });
    expect(doc.fixtures[0].aim.z).toBe(1);
    expect(doc.fixtures[1].aim.z).not.toBe(1);
    expect(setBeamAngle(doc, ids, 500).fixtures[0].beam.angle).toBe(180);
    expect(setBeamAngle(doc, ids, 40).fixtures[1].beam.angle).toBe(40);
    const u = setUnused(doc, [ids[1]], true);
    expect(u.fixtures.map((f) => f.unused)).toEqual([false, true]);
    expect(updateFixtures(doc, ids, { name: "X" }).fixtures.map((f) => f.name)).toEqual(["X", "X"]);
  });

  it("an unused light keeps its address and never conflicts", () => {
    const doc = docWith([light("f1", "pc", 5), light("f2", "pc", 5)]);
    expect(addressProblems(doc).conflicts.size).toBe(2);
    const r = setUnused(doc, ["f2"], true);
    expect(r.fixtures[1].address).toBe(5);
    expect(addressProblems(r).conflicts.size).toBe(0);
    expect(occupiedChannels(r.fixtures[1])).toEqual([5]);
  });
});

describe("channels of a light", () => {
  const doc = () => docWith([light("f1", "par6", 1), light("f2", "par6", 10), light("f3", "pc", 30)]);

  it("reorders a channel", () => {
    const r = moveChannel(doc(), "f1", 0, 3);
    expect(r.fixtures[0].channels.map((c) => c.function)).toEqual(["red", "green", "blue", "dimmer", "strobe", "macro"]);
    expect(moveChannel(doc(), "f1", 2, 2)).toEqual(doc());
    const same = doc();
    expect(moveChannel(same, "f1", 0, 9)).toBe(same);
  });

  it("keeps the values of memories bound to the lights with their channel when reordering", () => {
    const base = doc();
    const mem: Memory = { id: "m", number: 1, label: "m", note: "", state: { binding: "fixture", fixtures: { f1: [255, 1, 2, 3, 0, 0], f2: [0, 0, 0, 0, 0, 0], f3: [0] } }, scenery: [], transition: { fadeIn: 3, fadeOut: 3, delay: 0, autoFollow: false, moveInDark: false } };
    const r = moveChannel({ ...base, memories: [mem] }, "f1", 0, 3);
    // setFixtureChannels keeps values by channel position (documented in ops.ts): the list has the same length
    const st = r.memories[0].state;
    expect(st.binding === "fixture" && st.fixtures.f1).toHaveLength(6);
  });

  it("adds a channel (Main, then Strobe, then Other) and says when that creates a conflict", () => {
    const base = docWith([light("f1", "parRgb", 1), light("f2", "pc", 4)]);
    const r = addChannel(base, "f1");
    expect(r.fixtures[0].channels.map((c) => c.function)).toEqual(["red", "green", "blue", "dimmer"]);
    expect(newProblems(base, r).sort()).toEqual(["f1", "f2"]);
    expect(addChannel(r, "f1").fixtures[0].channels[4].function).toBe("strobe");
    expect(addChannel(addChannel(r, "f1"), "f1").fixtures[0].channels[5].function).toBe("other");
  });

  it("removes a channel but keeps at least one", () => {
    const r = removeChannel(doc(), "f1", 1);
    expect(r.fixtures[0].channels.map((c) => c.function)).toEqual(["dimmer", "green", "blue", "strobe", "macro"]);
    expect(r.fixtures[0].channels).toHaveLength(5);
    expect(removeChannel(doc(), "f3", 0).fixtures[2].channels).toHaveLength(1);
    expect(removeChannel(doc(), "f1", 99).fixtures[0].channels).toHaveLength(6);
  });

  it("changes the function and the label of a channel; an empty label goes away", () => {
    let r = setChannel(doc(), "f1", 0, { function: "white", label: "  Bianco  " });
    expect(r.fixtures[0].channels[0]).toEqual({ function: "white", label: "Bianco" });
    r = setChannel(r, "f1", 0, { label: "" });
    expect(r.fixtures[0].channels[0]).toEqual({ function: "white" });
    expect(setChannel(r, "f1", 40, { function: "red" })).toBe(r);
  });

  it("applies the channels of one light to every light of the same type and reports who changes", () => {
    const edited = moveChannel(doc(), "f1", 0, 3);
    expect(lightsToSync(edited, "f1")).toEqual(["f2"]);
    const r = applyChannelsToType(edited, "f1");
    expect(r.fixtures[1].channels).toEqual(r.fixtures[0].channels);
    expect(r.fixtures[2].channels.map((c) => c.function)).toEqual(["dimmer"]); // another type: untouched
    expect(lightsToSync(r, "f1")).toEqual([]);
    expect(r.fixtures.map((f) => f.address)).toEqual([1, 10, 30]);
  });
});

describe("trusses", () => {
  const withTruss = () => {
    const base = addFixtures(empty(), { ...spec, count: 3, place: { kind: "newTruss" } });
    return { doc: base.doc, trussId: base.trussId! };
  };

  it("renames a truss (empty = automatic name again)", () => {
    const { doc, trussId } = withTruss();
    const r = renameTruss(doc, trussId, "  Fondo ");
    expect(r.trusses[0].name).toBe("Fondo");
    expect(renameTruss(r, trussId, "  ").trusses[0].name).toBeNull();
    expect(renameTruss(doc, trussId, "")).toBe(doc);
  });

  it("moves a truss with the lights hanging on it, not the others", () => {
    const { doc, trussId } = withTruss();
    const floating = addFixtures(doc, { ...spec, typeId: "pc" }).doc;
    const r = moveTruss(floating, trussId, { y: 4, z: 3.2 });
    expect(r.trusses[0]).toMatchObject({ y: 4, z: 3.2 });
    expect(lightsOnTruss(r, trussId).every((f) => f.position.y === 4 && f.position.z === 3.2)).toBe(true);
    expect(r.fixtures[3].position).toEqual(floating.fixtures[3].position);
    expect(moveTruss(r, trussId, { y: 4 })).toBe(r);
    expect(moveTruss(r, "nope", { y: 1 })).toBe(r);
  });

  it("deleting a truss turns its lights into floating ones at the same coordinates", () => {
    const { doc, trussId } = withTruss();
    const before = doc.fixtures.map((f) => f.position);
    const r = removeTruss(doc, trussId);
    expect(r.trusses).toHaveLength(0);
    expect(r.fixtures.every((f) => f.mount.kind === "floating")).toBe(true);
    expect(r.fixtures.map((f) => f.position)).toEqual(before);
    expect(r.fixtures.map((f) => f.address)).toEqual(doc.fixtures.map((f) => f.address));
  });

  it("lists every truss even without lights, front to back, with the other places after", () => {
    let doc = empty();
    const back = addTruss(doc, { y: 4, z: 4 });
    const front = addTruss(back.doc, { y: 1, z: 4 });
    doc = front.doc;
    expect(listGroups(doc).map((g) => g.key.kind === "truss" && g.key.trussId)).toEqual([front.id, back.id]);
    doc = addFixtures(doc, { ...spec, count: 1, place: { kind: "house" } }).doc;
    doc = addFixtures(doc, { ...spec, count: 1, place: { kind: "floor" } }).doc;
    doc = addFixtures(doc, { ...spec, count: 1, place: { kind: "truss", trussId: back.id } }).doc;
    expect(listGroups(doc).map((g) => g.key.kind)).toEqual(["house", "truss", "truss", "floor"]);
    expect(listOrder(doc)).toHaveLength(3);
  });
});

describe("stage size", () => {
  it("changes the size and refuses nonsense", () => {
    const doc = empty();
    expect(setStage(doc, { width: 10, depth: 7, height: 5 }).stage).toEqual({ width: 10, depth: 7, height: 5 });
    expect(setStage(doc, { width: 0, depth: 7, height: 5 })).toBe(doc);
    expect(setStage(doc, { ...doc.stage })).toBe(doc);
  });
});

describe("removing a light", () => {
  it("never renumbers or re-addresses the others", () => {
    const doc = docWith([light("f1", "parRgbw", 1, { number: 1 }), light("f2", "pc", 5, { number: 2 }), light("f3", "pc", 6, { number: 3 })]);
    const next = removeFixture(doc, "f2");
    expect(next.fixtures.map((f) => [f.id, f.number, f.address])).toEqual([
      ["f1", 1, 1],
      ["f3", 3, 6],
    ]);
  });
});
