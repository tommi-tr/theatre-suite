import { describe, expect, it } from "vitest";
import { captureState, stateUniverse, stateValues } from "./memories";
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

/* The pure memory functions are tested in @theatre-suite/show-files (granvelo/memories.test.ts); here, how the operations of the document keep them consistent. */

describe("switching the binding of the memories", () => {
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
