import { describe, expect, it } from "vitest";
import { captureState, convertState, emptyState, litCount, memoriesInOrder, nextMemoryNumber, setMemoryBinding, stateUniverse, stateValues } from "./memories";
import { applyChannelsToType, changeFixtureType, removeFixture, setFixtureChannels, updateFixture } from "./ops";
import { docWith, light } from "./testkit";
import type { GranveloDoc, Memory, MemoryState } from "./types";

const memory = (id: string, number: number, state: MemoryState): Memory => ({
  id,
  number,
  label: id,
  note: "",
  state,
  scenery: [],
  transition: { fadeIn: 3, fadeOut: 3, delay: 0, autoFollow: false, moveInDark: false },
});

function sample(binding: "address" | "fixture"): GranveloDoc {
  const fixtures = [light("a", "pc", 1), light("b", "parRgb", 5), light("c", "pc", 20, { unused: true })];
  const base = docWith(fixtures);
  const values = { a: [200], b: [10, 20, 30], c: [50] };
  const state = captureState(base, values, binding);
  return docWith(fixtures, { memories: [memory("m1", 1, state)], sequence: ["m1"], settings: { ...base.settings, memoryBinding: binding } });
}

describe("memory states", () => {
  it("bound to addresses, store the 512 channels as they go out (unused lights send nothing)", () => {
    const doc = sample("address");
    const st = doc.memories[0].state;
    expect(st.binding).toBe("address");
    if (st.binding !== "address") return;
    expect(st.dmx).toHaveLength(512);
    expect(st.dmx.slice(0, 8)).toEqual([200, 0, 0, 0, 10, 20, 30, 0]);
    expect(st.dmx[19]).toBe(0);
    expect(stateValues(doc, st)).toEqual({ a: [200], b: [10, 20, 30], c: [0] });
  });

  it("bound to lights, store each light's values (unused ones too)", () => {
    const doc = sample("fixture");
    const st = doc.memories[0].state;
    expect(st).toEqual({ binding: "fixture", fixtures: { a: [200], b: [10, 20, 30], c: [50] } });
    expect(Array.from(stateUniverse(doc, st).slice(0, 8))).toEqual([200, 0, 0, 0, 10, 20, 30, 0]);
    expect(stateUniverse(doc, st)[19]).toBe(0);
  });

  it("keeps channels of no light when a memory bound to addresses is saved again", () => {
    const doc = sample("address");
    const base = doc.memories[0].state;
    if (base.binding !== "address") throw new Error();
    base.dmx[300] = 77;
    const again = captureState(doc, { a: [1], b: [2, 3, 4] }, "address", base);
    if (again.binding !== "address") throw new Error();
    expect(again.dmx[300]).toBe(77);
    expect(again.dmx.slice(0, 7)).toEqual([1, 0, 0, 0, 2, 3, 4]);
  });
});

describe("switching the binding of the memories", () => {
  it("is lossless back and forth when every light has an address and nothing conflicts", () => {
    const doc = sample("address");
    const toFix = setMemoryBinding(doc, "fixture");
    expect(toFix.settings.memoryBinding).toBe("fixture");
    expect(toFix.memories[0].state).toEqual({ binding: "fixture", fixtures: { a: [200], b: [10, 20, 30], c: [0] } });
    const back = setMemoryBinding(toFix, "address");
    expect(back.memories[0].state).toEqual(doc.memories[0].state);
  });

  it("address → fixture drops the values of channels that no light occupies", () => {
    const doc = sample("address");
    const st = doc.memories[0].state;
    if (st.binding !== "address") throw new Error();
    st.dmx[400] = 99;
    const conv = convertState(doc, st, "fixture");
    expect(Array.from(stateUniverse(doc, conv))[400]).toBe(0);
  });

  it("fixture → address writes unused lights only where no used light is", () => {
    const fixtures = [light("a", "pc", 1), light("u", "pc", 1, { unused: true }), light("v", "pc", 9, { unused: true }), light("n", "pc", null)];
    const doc = docWith(fixtures);
    const conv = convertState(doc, { binding: "fixture", fixtures: { a: [10], u: [250], v: [33], n: [44] } }, "address");
    if (conv.binding !== "address") throw new Error();
    expect(conv.dmx[0]).toBe(10);
    expect(conv.dmx[8]).toBe(33);
    expect(conv.dmx.filter((x) => x === 44)).toEqual([]);
  });

  it("bound to addresses: changing an address does not change the memory, the light reads other channels", () => {
    const doc = sample("address");
    const moved = updateFixture(doc, "a", { address: 100 });
    expect(moved.memories[0].state).toBe(doc.memories[0].state);
    expect(stateValues(moved, moved.memories[0].state).a).toEqual([0]);
  });

  it("bound to lights: changing an address does not spoil the memory, it follows the light", () => {
    const doc = sample("fixture");
    const moved = updateFixture(doc, "a", { address: 100 });
    expect(stateValues(moved, moved.memories[0].state).a).toEqual([200]);
    expect(stateUniverse(moved, moved.memories[0].state)[99]).toBe(200);
    expect(stateUniverse(moved, moved.memories[0].state)[0]).toBe(0);
  });
});

describe("operations keep the memories consistent", () => {
  it("removing a light removes it from groups and light-bound memories", () => {
    const doc = { ...sample("fixture"), groups: [{ id: "g", name: "G", fixtureIds: ["a", "b"], level: 255 }] };
    const next = removeFixture(doc, "a");
    expect(next.groups[0].fixtureIds).toEqual(["b"]);
    const st = next.memories[0].state;
    expect(st.binding === "fixture" && "a" in st.fixtures).toBe(false);
  });

  it("changing the channels of a light keeps the values by channel position", () => {
    const doc = sample("fixture");
    const next = setFixtureChannels(doc, "b", [{ function: "dimmer" }, { function: "red" }, { function: "green" }, { function: "blue" }]);
    expect(stateValues(next, next.memories[0].state).b).toEqual([10, 20, 30, 0]);
    const shorter = changeFixtureType(next, "b", "pc");
    expect(shorter.fixtures.find((f) => f.id === "b")!.channels).toEqual([{ function: "dimmer" }]);
    expect(stateValues(shorter, shorter.memories[0].state).b).toEqual([10]);
  });

  it("applies the channel layout of one light to every light of its type", () => {
    const doc = docWith([light("p1", "parRgb", 1), light("p2", "parRgb", 4), light("x", "pc", 9)]);
    const swapped = setFixtureChannels(doc, "p1", [{ function: "blue" }, { function: "green" }, { function: "red", label: "R" }]);
    const all = applyChannelsToType(swapped, "p1");
    expect(all.fixtures[1].channels).toEqual([{ function: "blue" }, { function: "green" }, { function: "red", label: "R" }]);
    expect(all.fixtures[1].channels).not.toBe(all.fixtures[0].channels);
    expect(all.fixtures[2].channels).toEqual([{ function: "dimmer" }]);
  });
});

describe("lists of memories", () => {
  it("numbers, order and lit lights", () => {
    const base = sample("address");
    const doc = { ...base, memories: [...base.memories, memory("m9", 9, emptyState("address")), memory("m4", 4, emptyState("address"))], sequence: ["m9", "m1"] };
    expect(nextMemoryNumber(doc)).toBe(10);
    expect(memoriesInOrder(doc).map((m) => m.id)).toEqual(["m9", "m1", "m4"]);
    expect(litCount(doc, doc.memories[0].state)).toBe(2);
    expect(litCount(doc, doc.memories[1].state)).toBe(0);
  });
});
