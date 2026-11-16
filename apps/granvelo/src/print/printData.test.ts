import { describe, expect, it } from "vitest";
import { makeT } from "@theatre-suite/core";
import { DICTS } from "../i18n";
import { demoDoc } from "../model/demo";
import { light, docWith } from "../model/testkit";
import { addressRange, listData, planData, sheetTitle } from "./printData";

const it_ = makeT(DICTS, "it");
const en = makeT(DICTS, "en");

describe("print data", () => {
  it("writes the title with the show, the sheet and the date", () => {
    const d = new Date(2026, 10, 16);
    expect(sheetTitle("La locandiera", "Pianta delle luci", d, "it")).toBe("La locandiera · Pianta delle luci · 16 novembre 2026");
    expect(sheetTitle("  ", "Plan", d, "en")).toContain("—");
  });

  it("writes address ranges", () => {
    expect(addressRange({ address: null, channels: [] })).toBe("—");
    expect(addressRange(light("l1", "halogen", 5))).toBe("005");
    expect(addressRange(light("l2", "parRgb", 21))).toBe("021–023");
  });

  it("lists every light once, grouped like the screen, with unused ones marked", () => {
    const doc = demoDoc();
    const list = listData(doc, it_, "it");
    expect(list.lights).toBe(doc.fixtures.length);
    expect(list.groups.flatMap((g) => g.rows).map((r) => r.id).sort()).toEqual(doc.fixtures.map((f) => f.id).sort());
    expect(list.unused).toBe(doc.fixtures.filter((f) => f.unused).length);
    expect(list.unused).toBeGreaterThan(0);
    expect(list.groups[0].title).toBe("In sala");
    expect(list.groups.some((g) => g.title === "1ª americana" && g.detail.includes("m dal bordo"))).toBe(true);
    // Inside a group, by number.
    for (const g of list.groups) expect(g.rows.map((r) => r.number)).toEqual([...g.rows.map((r) => r.number)].sort((a, b) => a - b));
    const row = list.groups.flatMap((g) => g.rows).find((r) => r.unused)!;
    expect(row.unused).toBe(true);
  });

  it("shows X on a bar and X, Y, Z elsewhere", () => {
    const doc = docWith([
      light("l1", "pc", 1, { mount: { kind: "floor" }, position: { x: 1.5, y: 2, z: 0 }, name: "" }),
      light("l2", "pc", 2, { mount: { kind: "floating" }, position: { x: -1, y: -3, z: 3 } }),
    ]);
    const rows = listData(doc, en, "en").groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.number === 1)!.position).toBe("X 1.5 · Y 2 · Z 0 m");
    expect(rows.find((r) => r.number === 1)!.name).toBe("PC");
    expect(listData(doc, en, "en").groups[0].title).toBe("In the house");
  });

  it("handles a show with no lights", () => {
    const list = listData(docWith([]), en, "en");
    expect(list).toEqual({ groups: [], lights: 0, unused: 0 });
    expect(planData(docWith([]), en, "en").lights).toEqual([]);
  });

  it("builds the plan: one entry per light, bars named and ordered front to back, legend by type", () => {
    const doc = demoDoc();
    const plan = planData(doc, it_, "it");
    expect(plan.lights).toHaveLength(doc.fixtures.length);
    expect(plan.trusses.map((t) => t.name)).toEqual(["1ª americana", "2ª americana"]);
    expect(plan.trusses[0].y).toBeGreaterThan(plan.trusses[1].y); // screen y: further back = more negative
    expect(plan.legend.reduce((n, e) => n + e.count, 0)).toBe(doc.fixtures.length);
    const l = plan.lights[0];
    expect(l.address).toMatch(/^\d{3}$/);
    // Everything is inside the paper box.
    for (const x of plan.lights) {
      expect(x.x).toBeGreaterThanOrEqual(plan.box.minX);
      expect(x.x).toBeLessThanOrEqual(plan.box.maxX);
      expect(x.y).toBeGreaterThanOrEqual(plan.box.minY);
      expect(x.y).toBeLessThanOrEqual(plan.box.maxY);
    }
    expect(plan.pieces).toHaveLength(doc.scenery.length);
    expect(plan.box.maxX).toBeGreaterThan(doc.stage.width / 2 + 2); // room for the names of the bars
  });
});
