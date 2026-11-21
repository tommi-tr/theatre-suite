import { describe, expect, it } from "vitest";
import { demoDoc } from "./demo";
import { copySceneryFrom, moveSceneryInMemory, placementIn, previousInSequence, sceneryChanges, setSceneryOnStage } from "./sceneryMemory";
import { serialize, parse } from "./file";

const doc = () => demoDoc();

describe("scenery per memory", () => {
  it("a piece enters and leaves the stage in one memory only", () => {
    const d = doc();
    const lamp = d.scenery.find((s) => s.id === "sc-lamp")!;
    const m1 = d.memories[0];
    expect(placementIn(d, m1.id, lamp.id)).toBeNull();
    const on = setSceneryOnStage(d, m1.id, lamp.id, true);
    expect(placementIn(on, m1.id, lamp.id)).toEqual({ sceneryId: lamp.id, position: lamp.position, rotation: lamp.rotation });
    expect(placementIn(on, d.memories[1].id, lamp.id)).toBeNull();
    // Keeps the order of the pieces of the document.
    const ids = on.memories[0].scenery.map((p) => p.sceneryId);
    expect(ids).toEqual(on.scenery.map((s) => s.id).filter((id) => ids.includes(id)));
    // Doing it again changes nothing (same object: no undo step).
    expect(setSceneryOnStage(on, m1.id, lamp.id, true)).toBe(on);
    const off = setSceneryOnStage(on, m1.id, lamp.id, false);
    expect(placementIn(off, m1.id, lamp.id)).toBeNull();
    expect(setSceneryOnStage(off, m1.id, lamp.id, false)).toBe(off);
  });

  it("moves and turns a piece in a memory without touching the piece or the other memories", () => {
    const d = doc();
    const table = d.scenery.find((s) => s.id === "sc-table")!;
    const [a, b] = [d.memories[0], d.memories[1]];
    const r = moveSceneryInMemory(d, a.id, table.id, { position: { x: 1.234, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 190 } });
    expect(placementIn(r, a.id, table.id)).toMatchObject({ position: { x: 1.23, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: -170 } });
    expect(placementIn(r, b.id, table.id)).toEqual(placementIn(d, b.id, table.id));
    expect(r.scenery).toBe(d.scenery);
    // Off stage there, or nonsense: nothing.
    const lamp = d.scenery.find((s) => s.id === "sc-lamp")!;
    expect(moveSceneryInMemory(d, a.id, lamp.id, { position: { x: 1, y: 1, z: 0 } })).toBe(d);
    expect(moveSceneryInMemory(d, a.id, table.id, { position: { x: NaN, y: 1, z: 0 } })).toBe(d);
    expect(moveSceneryInMemory(d, "nope", table.id, { position: { x: 1, y: 1, z: 0 } })).toBe(d);
  });

  it("copies the scenery of another memory", () => {
    const d = doc();
    const last = d.memories[d.memories.length - 2]; // has the lamp
    const r = copySceneryFrom(d, d.memories[0].id, last.id);
    expect(r.memories[0].scenery.map((p) => p.sceneryId)).toEqual(last.scenery.map((p) => p.sceneryId));
    expect(r.memories[0].scenery[0]).not.toBe(last.scenery[0]);
    expect(copySceneryFrom(d, last.id, last.id)).toBe(d);
  });

  it("tells what happens to each piece compared with the memory before", () => {
    let d = doc();
    const [m1, m2] = [d.memories[0], d.memories[1]];
    const lamp = "sc-lamp";
    d = setSceneryOnStage(d, m2.id, lamp, true);
    d = moveSceneryInMemory(d, m2.id, "sc-table", { position: { x: 0.5, y: 3, z: 0 } });
    d = setSceneryOnStage(d, m2.id, "sc-chair", false);
    const c = sceneryChanges(d, m2.id, m1.id);
    expect(c[lamp]).toBe("enters");
    expect(c["sc-table"]).toBe("moves");
    expect(c["sc-chair"]).toBe("leaves");
    expect(c["sc-backdrop"]).toBe("stays");
    expect(sceneryChanges(d, m1.id, null)["sc-backdrop"]).toBe("enters");
    expect(previousInSequence(d, m2.id)).toBe(m1.id);
    expect(previousInSequence(d, m1.id)).toBeNull();
  });

  it("is saved with the memory (format 1 as it is) and read back", () => {
    let d = doc();
    d = setSceneryOnStage(d, d.memories[0].id, "sc-lamp", true);
    d = moveSceneryInMemory(d, d.memories[0].id, "sc-lamp", { position: { x: -2, y: 4, z: 0 }, rotation: { x: 0, y: 0, z: 30 } });
    const back = parse(serialize(d, { name: "granvelo", version: "0.6.0" }));
    expect(placementIn(back, d.memories[0].id, "sc-lamp")).toMatchObject({ position: { x: -2, y: 4, z: 0 }, rotation: { z: 30 } });
  });
});
