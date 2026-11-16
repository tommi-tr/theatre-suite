import { describe, expect, it } from "vitest";
import { addressMap, addressProblems, applyAddresses, channelsInUse, fits, lastChannel, nextFreeAddress, numberByClicks, occupiedChannels } from "./addresses";
import { removeFixture } from "./ops";
import { docWith, light } from "./testkit";

describe("channels of a light", () => {
  it("occupies address … address + channels − 1", () => {
    expect(occupiedChannels(light("f1", "parRgbw", 10))).toEqual([10, 11, 12, 13]);
    expect(occupiedChannels(light("f1", "pc", 512))).toEqual([512]);
    expect(occupiedChannels(light("f1", "pc", null))).toEqual([]);
  });
  it("never goes beyond 512 and says when a light does not fit", () => {
    const f = light("f1", "par7", 510);
    expect(occupiedChannels(f)).toEqual([510, 511, 512]);
    expect(lastChannel(f)).toBe(516);
    expect(fits(510, 7)).toBe(false);
    expect(fits(506, 7)).toBe(true);
    expect(fits(0, 1)).toBe(false);
    expect(addressProblems(docWith([f])).outOfRange.has("f1")).toBe(true);
  });
});

describe("conflicts and the 512-cell map", () => {
  const doc = docWith([
    light("f1", "parRgbw", 1), // 1–4
    light("f2", "parRgb", 4), // 4–6: overlaps f1 on 4
    light("f3", "pc", 10),
    light("f4", "pc", 10, { unused: true }), // reserved, not connected
    light("f5", "pc", null),
  ]);

  it("finds the lights that share channels, and only those", () => {
    const p = addressProblems(doc);
    expect([...p.conflicts.keys()].sort()).toEqual(["f1", "f2"]);
    expect(p.conflicts.get("f1")).toEqual(["f2"]);
    expect(p.conflicts.get("f2")).toEqual(["f1"]);
    expect(p.outOfRange.size).toBe(0);
  });

  it("does not put an unused light in conflict, but keeps its channels reserved", () => {
    const map = addressMap(doc);
    expect(map).toHaveLength(512);
    expect(map[9]).toMatchObject({ channel: 10, lights: ["f3"], reserved: ["f4"], conflict: false });
    expect(map[3]).toMatchObject({ channel: 4, lights: ["f1", "f2"], conflict: true });
    expect(map[100]).toMatchObject({ lights: [], reserved: [], conflict: false });
  });

  it("counts the channels in use (reserved ones included, each channel once)", () => {
    expect(channelsInUse(doc)).toBe(7); // 1–6 and 10
  });
});

describe("next free address", () => {
  const doc = docWith([light("f1", "parRgbw", 1), light("f2", "pc", 6), light("f3", "pc", 8, { unused: true })]);
  it("skips used and reserved channels", () => {
    expect(nextFreeAddress(doc, 1)).toBe(5);
    expect(nextFreeAddress(doc, 2)).toBe(9);
    expect(nextFreeAddress(doc, 4, 2)).toBe(9);
  });
  it("can ignore the light being moved", () => {
    expect(nextFreeAddress(doc, 4, 1, ["f1"])).toBe(1);
  });
  it("returns null when nothing fits", () => {
    expect(nextFreeAddress(docWith([light("f1", "pc", 300)]), 300)).toBeNull();
    expect(nextFreeAddress(docWith([]), 513)).toBeNull();
  });
});

describe("numbering by clicking the lights in order", () => {
  const doc = docWith([
    light("f1", "parRgbw", null), // 4 ch
    light("f2", "pc", null), // 1 ch
    light("f3", "par7", 200), // 7 ch
    light("f4", "pc", 3), // not clicked
  ]);

  it("gives consecutive addresses after the channels of the previous light", () => {
    const r = numberByClicks(doc, ["f3", "f1", "f2"], 1);
    expect([...r.addresses.entries()]).toEqual([
      ["f3", 1],
      ["f1", 8],
      ["f2", 12],
    ]);
    expect(r.notFitting).toEqual([]);
    const next = applyAddresses(doc, r.addresses);
    expect(next.fixtures.find((f) => f.id === "f4")!.address).toBe(3); // untouched…
    expect(addressProblems(next).conflicts.has("f4")).toBe(true); // …so the conflict shows
  });

  it("can jump over the lights that are not in the list", () => {
    const r = numberByClicks(doc, ["f1", "f2"], 1, { skipTaken: true });
    expect([...r.addresses.entries()]).toEqual([
      ["f1", 4],
      ["f2", 8],
    ]);
  });

  it("leaves alone the lights that would not fit and ignores repeated clicks", () => {
    const r = numberByClicks(doc, ["f1", "f1", "f3", "f2"], 506);
    expect([...r.addresses.entries()]).toEqual([
      ["f1", 506],
      ["f2", 510],
    ]);
    expect(r.notFitting).toEqual(["f3"]);
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
