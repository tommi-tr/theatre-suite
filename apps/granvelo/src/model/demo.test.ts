import { describe, expect, it } from "vitest";
import { addressProblems, channelsInUse } from "./addresses";
import { demoDoc } from "./demo";
import { parse, serialize } from "./file";
import { fixturesByPlace, trussOrdinal } from "./ops";
import { litCount, memoriesInOrder } from "./memories";
import { FIXTURE_TYPES } from "./fixtureTypes";

describe("demo show La locandiera", () => {
  const doc = demoDoc();

  it("has 15 lights, 9 memories, an 8 × 6 × 4.5 m stage", () => {
    expect(doc.title).toBe("La locandiera");
    expect(doc.fixtures).toHaveLength(15);
    expect(doc.memories).toHaveLength(9);
    expect(doc.stage).toEqual({ width: 8, depth: 6, height: 4.5 });
    expect(doc.groups.length).toBeGreaterThanOrEqual(3);
    expect(doc.groups.length).toBeLessThanOrEqual(4);
    expect(doc.scenery.length).toBeGreaterThan(2);
  });

  it("is a valid file that reads back unchanged", () => {
    expect(parse(serialize(doc, { name: "Granvelo", version: "0.1.0" }))).toEqual(doc);
  });

  it("has no address conflict and every light fits in the universe", () => {
    const p = addressProblems(doc);
    expect(p.conflicts.size).toBe(0);
    expect(p.outOfRange.size).toBe(0);
    expect(doc.fixtures.every((f) => f.address !== null)).toBe(true);
    expect(channelsInUse(doc)).toBe(64);
  });

  it("has exactly one light not used in this production", () => {
    expect(doc.fixtures.filter((f) => f.unused).map((f) => f.number)).toEqual([7]);
  });

  it("uses a believable mix of types", () => {
    const types = new Set(doc.fixtures.map((f) => f.typeId));
    for (const t of ["parRgbw", "pc", "par7", "profile", "washMover", "ledBar", "smoke"]) expect(types.has(t as never)).toBe(true);
    expect(doc.fixtures.filter((f) => f.typeId === "washMover")).toHaveLength(2);
    expect([...types].every((t) => FIXTURE_TYPES.some((x) => x.id === t))).toBe(true);
  });

  it("puts the lights in the house, on two trusses and on the floor", () => {
    const places = fixturesByPlace(doc).map((g) => (g.key.kind === "truss" ? `truss ${trussOrdinal(doc, g.key.trussId)}` : g.key.kind));
    expect(places).toEqual(["house", "truss 1", "truss 2", "floor"]);
  });

  it("has nine different looks in order, with varied transitions", () => {
    const ordered = memoriesInOrder(doc);
    expect(ordered.map((m) => m.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const looks = new Set(doc.memories.map((m) => JSON.stringify(m.state)));
    expect(looks.size).toBe(9);
    expect(doc.memories.every((m) => litCount(doc, m.state) > 0)).toBe(true);
    expect(doc.memories.some((m) => m.transition.autoFollow)).toBe(true);
    expect(doc.memories.some((m) => m.transition.moveInDark)).toBe(true);
    expect(doc.memories.some((m) => m.transition.delay > 0)).toBe(true);
    expect(doc.memories.some((m) => m.transition.fadeIn !== m.transition.fadeOut)).toBe(true);
    expect(doc.memories.every((m) => m.label.trim().length > 0)).toBe(true);
  });
});
