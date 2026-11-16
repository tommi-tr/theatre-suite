import { describe, expect, it } from "vitest";
import { demoDoc } from "./demo";
import { addScenery, addTruss, dropLights, removeScenery, resetAim, sceneryName, setAims, updateScenery } from "./ops";
import { docWith, light } from "./testkit";
import { defaultAim } from "../stage/geometry";

const base = () => {
  const d = docWith([light("f1", "pc", 1), light("f2", "pc", 2), light("f3", "pc", 3, { mount: { kind: "floor" }, position: { x: -4, y: 2, z: 0 } })]);
  return addTruss(d, { y: 1.5, z: 4.5 });
};

describe("dropLights", () => {
  it("a truss nearby catches the light; the aim stays", () => {
    const { doc, id } = base();
    const before = doc.fixtures[0].aim;
    const r = dropLights(doc, [{ id: "f1", to: { x: 1, y: 1.8, z: 4.4 } }]);
    const f = r.doc.fixtures.find((x) => x.id === "f1")!;
    expect(f.mount).toEqual({ kind: "truss", trussId: id });
    expect(f.position).toEqual({ x: 1, y: 1.5, z: 4.5 });
    expect(f.aim).toEqual(before);
    expect(r.newTrusses).toEqual([]);
  });

  it("high over the stage with no truss: one new truss, shared by the lights of the same drop", () => {
    const { doc } = base();
    const r = dropLights(doc, [
      { id: "f1", to: { x: -1, y: 4, z: 4.2 } },
      { id: "f2", to: { x: 1, y: 4.2, z: 4.3 } },
    ]);
    expect(r.newTrusses).toHaveLength(1);
    expect(r.doc.trusses).toHaveLength(2);
    const [a, b] = ["f1", "f2"].map((id) => r.doc.fixtures.find((x) => x.id === id)!);
    expect(a.mount).toEqual({ kind: "truss", trussId: r.newTrusses[0] });
    expect(b.mount).toEqual(a.mount);
    expect(b.position.y).toBe(4);
  });

  it("near the floor on the floor, elsewhere floating; other lights untouched", () => {
    const { doc } = base();
    const r = dropLights(doc, [
      { id: "f1", to: { x: 0, y: 2, z: 0.3 } },
      { id: "f2", to: { x: 0, y: -3, z: 5 } },
    ]);
    expect(r.doc.fixtures[0]).toMatchObject({ mount: { kind: "floor" }, position: { x: 0, y: 2, z: 0 } });
    expect(r.doc.fixtures[1]).toMatchObject({ mount: { kind: "floating" }, position: { x: 0, y: -3, z: 5 } });
    expect(r.doc.fixtures[2]).toBe(doc.fixtures[2]);
  });

  it("an automatic truss left empty by the drag disappears; a named one or one that was already empty stays", () => {
    const { doc, id } = base();
    const hung = dropLights(doc, [{ id: "f1", to: { x: 0, y: 1.5, z: 4.5 } }]).doc;
    expect(hung.trusses).toHaveLength(1);
    const moved = dropLights(hung, [{ id: "f1", to: { x: 0, y: -3, z: 5 } }]);
    expect(moved.doc.trusses).toHaveLength(0);
    // named: kept
    const named = { ...hung, trusses: hung.trusses.map((t) => ({ ...t, name: "Ribalta" })) };
    expect(dropLights(named, [{ id: "f1", to: { x: 0, y: -3, z: 5 } }]).doc.trusses).toHaveLength(1);
    // already empty (made on purpose): kept when other lights are moved
    const other = addTruss(doc, { y: 4, z: 4.5 }).doc;
    expect(dropLights(other, [{ id: "f1", to: { x: 0, y: -3, z: 5 } }]).doc.trusses).toHaveLength(2);
    expect(id).toBeTruthy();
  });

  it("moving a light from one truss to another leaves the first one only if it still has lights", () => {
    const d0 = addTruss(base().doc, { y: 4, z: 4.5 });
    const d1 = dropLights(d0.doc, [{ id: "f1", to: { x: 0, y: 1.5, z: 4.5 } }, { id: "f2", to: { x: 1, y: 1.5, z: 4.5 } }]).doc;
    const r = dropLights(d1, [{ id: "f1", to: { x: 0, y: 4, z: 4.5 } }]);
    expect(r.doc.trusses).toHaveLength(2);
    const r2 = dropLights(r.doc, [{ id: "f2", to: { x: 1, y: 4, z: 4.5 } }]);
    expect(r2.doc.trusses.map((t) => t.y)).toEqual([4]);
  });

  it("ignores unknown lights and impossible points", () => {
    const { doc } = base();
    expect(dropLights(doc, [{ id: "nope", to: { x: 0, y: 0, z: 0 } }, { id: "f1", to: { x: NaN, y: 0, z: 0 } }]).doc).toBe(doc);
  });
});

describe("aims", () => {
  it("setAims moves only the lights given, rounded to the centimetre", () => {
    const { doc } = base();
    const d = setAims(doc, { f2: { x: 1.234, y: 2, z: 0 } });
    expect(d.fixtures[1].aim).toEqual({ x: 1.23, y: 2, z: 0 });
    expect(d.fixtures[0]).toBe(doc.fixtures[0]);
    expect(setAims(doc, {})).toBe(doc);
  });
  it("resetAim gives back the default aim of the place (a truss light uses the truss)", () => {
    const { doc, id } = base();
    const hung = dropLights(doc, [{ id: "f1", to: { x: 1, y: 1.5, z: 4.5 } }]).doc;
    const d = resetAim(setAims(hung, { f1: { x: 3, y: 3, z: 3 }, f3: { x: 0, y: 0, z: 0 } }), ["f1", "f3"]);
    expect(d.fixtures[0].aim).toEqual(defaultAim({ x: 1, y: 1.5, z: 4.5 }, { kind: "truss", trussId: id }, d.stage));
    expect(d.fixtures[2].aim).toEqual({ x: 4, y: 2, z: 1.2 });
  });
});

describe("scenery", () => {
  it("adds a piece with a believable size, on the floor at the centre", () => {
    const { doc, id } = addScenery(docWith([]), { shape: "box", name: "Cubo" });
    const s = doc.scenery.find((x) => x.id === id)!;
    expect(s).toMatchObject({ name: "Cubo", shape: "box", position: { x: 0, y: 3, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });
    expect(s.size.x).toBeGreaterThan(0);
  });

  it("names continue after the existing ones", () => {
    let d = docWith([]);
    expect(sceneryName(d, "Cubo")).toBe("Cubo");
    d = addScenery(d, { shape: "box", name: "Cubo" }).doc;
    expect(sceneryName(d, "Cubo")).toBe("Cubo 2");
    d = addScenery(d, { shape: "box", name: "Cubo 5" }).doc;
    expect(sceneryName(d, "Cubo")).toBe("Cubo 6");
  });

  it("updates only sensible values: rotation kept in −180…180, sizes ≥ 0, colour #rrggbb", () => {
    const { doc, id } = addScenery(docWith([]), { shape: "box", name: "Cubo" });
    const d = updateScenery(doc, id, { rotation: { x: 0, y: 270, z: -190 }, size: { x: -1, y: 2, z: 3 }, color: "#a0b0c0", name: "  Tavolo " });
    const s = d.scenery[0];
    expect(s.rotation).toEqual({ x: 0, y: -90, z: 170 });
    expect(s.size).toEqual({ x: 0, y: 2, z: 3 });
    expect(s.color).toBe("#A0B0C0");
    expect(s.name).toBe("Tavolo");
    expect(updateScenery(d, id, { color: "red" }).scenery[0].color).toBe("#A0B0C0");
    expect(updateScenery(d, "nope", { name: "x" })).toBe(d);
  });

  it("removing a piece takes it out of the memories too", () => {
    const demo = demoDoc();
    const used = demo.memories.filter((m) => m.scenery.some((p) => p.sceneryId === "sc-table")).length;
    expect(used).toBeGreaterThan(0);
    const d = removeScenery(demo, "sc-table");
    expect(d.scenery.some((s) => s.id === "sc-table")).toBe(false);
    expect(d.memories.every((m) => m.scenery.every((p) => p.sceneryId !== "sc-table"))).toBe(true);
    expect(removeScenery(d, "sc-table")).toBe(d);
  });
});
