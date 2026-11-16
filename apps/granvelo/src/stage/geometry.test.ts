import { describe, expect, it } from "vitest";
import { DEFAULT_STAGE, type Truss } from "../model/types";
import { light } from "../model/testkit";
import {
  FLOOR_ZONE,
  beamPool,
  defaultAim,
  facing,
  highZone,
  lightPosition,
  poolOutline,
  project,
  resolveDrop,
  sceneryOutline,
  trussMagnet,
  unproject,
  viewBounds,
} from "./geometry";

const stage = DEFAULT_STAGE; // 8 × 6 × 4,5
const trusses: Truss[] = [
  { id: "t1", name: null, y: 1.5, z: 4.5 },
  { id: "t2", name: null, y: 4, z: 4.5 },
];

describe("lightPosition", () => {
  it("follows the truss for hung lights", () => {
    const f = light("a1", "pc", 1, { mount: { kind: "truss", trussId: "t2" }, position: { x: 1, y: 0, z: 0 } });
    expect(lightPosition(f, { trusses })).toEqual({ x: 1, y: 4, z: 4.5 });
  });
  it("keeps its own coordinates when floating, on the floor or on a truss that is gone", () => {
    const f = light("a1", "pc", 1, { position: { x: 1, y: 2, z: 3 } });
    expect(lightPosition(f, { trusses })).toEqual({ x: 1, y: 2, z: 3 });
    const g = light("a2", "pc", 1, { mount: { kind: "truss", trussId: "nope" }, position: { x: 1, y: 2, z: 3 } });
    expect(lightPosition(g, { trusses })).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("beamPool", () => {
  it("straight down: a circle under the light of radius h·tan(half angle)", () => {
    const p = beamPool({ x: 1, y: 2, z: 4 }, { x: 1, y: 2, z: 0 }, 30);
    const r = 4 * Math.tan((15 * Math.PI) / 180);
    expect(p.kind).toBe("floor");
    expect(p.cx).toBeCloseTo(1, 6);
    expect(p.cy).toBeCloseTo(2, 6);
    expect(p.rx).toBeCloseTo(r, 6);
    expect(p.ry).toBeCloseTo(r, 6);
    expect(p.end).toEqual({ x: 1, y: 2, z: 0 });
  });

  it("tilted onto the floor: longer along the beam, centre beyond the aim", () => {
    const p = beamPool({ x: 0, y: 0, z: 4 }, { x: 0, y: 3, z: 0 }, 20);
    expect(p.kind).toBe("floor");
    expect(p.rx).toBeGreaterThan(p.ry);
    expect(p.cy).toBeGreaterThan(3);
    expect(p.cx).toBeCloseTo(0, 6);
    expect(p.angle).toBeCloseTo(Math.PI / 2, 6);
    expect(p.end.y).toBeCloseTo(3, 6);
    // Near and far edges are the rays at the depression angle ± half the beam.
    const e = Math.atan2(4, 3);
    const a = (10 * Math.PI) / 180;
    expect(p.cy - p.rx).toBeCloseTo(4 / Math.tan(e + a), 6);
    expect(p.cy + p.rx).toBeCloseTo(4 / Math.tan(e - a), 6);
  });

  it("aimed in the air (a face): drawn at the aim point, stretched by how steeply it comes", () => {
    const p = beamPool({ x: -3, y: -5, z: 5 }, { x: -1.8, y: 1.5, z: 1.6 }, 25);
    expect(p.kind).toBe("aim");
    expect(p.cx).toBe(-1.8);
    expect(p.cy).toBe(1.5);
    expect(p.rx).toBeGreaterThan(p.ry);
    expect(p.rx).toBeLessThanOrEqual(p.ry * 2.5 + 1e-9);
  });

  it("side lights (horizontal or upwards) are a band across the stage", () => {
    const p = beamPool({ x: -4.6, y: 2.5, z: 1.2 }, { x: 4, y: 2.5, z: 2.4 }, 26);
    expect(p.kind).toBe("grazing");
    expect(p.cx).toBeCloseTo(-0.3, 6);
    expect(p.cy).toBeCloseTo(2.5, 6);
    expect(p.rx).toBeCloseTo(4.3, 6);
    expect(p.angle).toBeCloseTo(0, 6);
  });

  it("never returns nonsense for degenerate input", () => {
    for (const p of [beamPool({ x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 3 }, 25), beamPool({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0), beamPool({ x: 0, y: 0, z: 3 }, { x: 0, y: 1, z: 0 }, 400)]) {
      for (const v of [p.cx, p.cy, p.rx, p.ry, p.angle, p.endRadius]) expect(Number.isFinite(v)).toBe(true);
      expect(p.rx).toBeGreaterThan(0);
      expect(p.ry).toBeGreaterThan(0);
    }
  });

  it("outline points lie on the ellipse", () => {
    const p = beamPool({ x: 0, y: 0, z: 4 }, { x: 2, y: 3, z: 0 }, 30);
    for (const q of poolOutline(p, 12)) {
      const dx = q.x - p.cx;
      const dy = q.y - p.cy;
      const u = dx * Math.cos(p.angle) + dy * Math.sin(p.angle);
      const v = -dx * Math.sin(p.angle) + dy * Math.cos(p.angle);
      expect((u / p.rx) ** 2 + (v / p.ry) ** 2).toBeCloseTo(1, 6);
    }
  });
});

describe("defaultAim", () => {
  it("house lights point at the proscenium, spread and not all at the centre", () => {
    const xs = [-3, -1, 1, 3].map((x) => defaultAim({ x, y: -5, z: 5 }, { kind: "floating" }, stage));
    expect(new Set(xs.map((a) => a.x)).size).toBe(4);
    for (const a of xs) {
      expect(a.y).toBeGreaterThan(0);
      expect(a.y).toBeLessThanOrEqual(2);
      expect(Math.abs(a.x)).toBeLessThanOrEqual(stage.width / 2);
    }
  });
  it("over the stage straight down, upstage backlight, on the floor and in the wings horizontal", () => {
    expect(defaultAim({ x: 1, y: 2, z: 4.5 }, { kind: "truss", trussId: "t" }, stage)).toEqual({ x: 1, y: 2, z: 0 });
    const back = defaultAim({ x: 1, y: 5, z: 4.5 }, { kind: "truss", trussId: "t" }, stage);
    expect(back.y).toBeLessThan(5);
    expect(back.z).toBeGreaterThan(0);
    const floor = defaultAim({ x: -4.5, y: 2, z: 1.2 }, { kind: "floor" }, stage);
    expect(floor).toEqual({ x: 4, y: 2, z: 2.4 });
    const wing = defaultAim({ x: 5, y: 3, z: 1.8 }, { kind: "floating" }, stage);
    expect(wing.x).toBe(-4);
    expect(wing.y).toBe(3);
  });
});

describe("resolveDrop (the Sposta tool)", () => {
  const doc = { stage, trusses };
  it("near the floor: on the floor at height 0", () => {
    expect(resolveDrop(doc, { kind: "floating" }, { x: 1, y: 2, z: FLOOR_ZONE - 0.1 })).toEqual({ mount: { kind: "floor" }, position: { x: 1, y: 2, z: 0 } });
  });
  it("a light on the floor stays there below the high zone (a stand)", () => {
    expect(resolveDrop(doc, { kind: "floor" }, { x: 1, y: 2, z: 1.2 }).mount).toEqual({ kind: "floor" });
    expect(resolveDrop(doc, { kind: "floating" }, { x: 1, y: 2, z: 1.2 }).mount).toEqual({ kind: "floating" });
  });
  it("high near a truss: the truss catches it and gives its depth and height", () => {
    const r = resolveDrop(doc, { kind: "floating" }, { x: 2, y: 3.6, z: 4.2 });
    expect(r).toEqual({ mount: { kind: "truss", trussId: "t2" }, position: { x: 2, y: 4, z: 4.5 } });
    expect(trussMagnet(trusses, 1.5 + 0.7, 4.5)).toBeNull();
  });
  it("high over the stage with no truss nearby: a new truss there", () => {
    const r = resolveDrop(doc, { kind: "floating" }, { x: 0, y: 2.8, z: highZone(stage) + 0.1 });
    expect(r.mount).toEqual({ kind: "newTruss", y: 2.8, z: 2.8 });
  });
  it("high in the house: floating (no trusses are invented there)", () => {
    expect(resolveDrop(doc, { kind: "floating" }, { x: 0, y: -4, z: 5 }).mount).toEqual({ kind: "floating" });
  });
});

describe("projections", () => {
  it("plan from above with the audience at the bottom, front from the audience", () => {
    expect(project({ x: 1, y: 2, z: 3 }, "plan")).toEqual({ x: 1, y: -2 });
    expect(project({ x: 1, y: 2, z: 3 }, "front")).toEqual({ x: 1, y: -3 });
    expect(unproject({ x: 1, y: -2 }, "plan", { x: 0, y: 0, z: 9 })).toEqual({ x: 1, y: 2, z: 9 });
    expect(unproject({ x: 1, y: -3 }, "front", { x: 0, y: 7, z: 0 })).toEqual({ x: 1, y: 7, z: 3 });
  });
  it("symbols face where the light points", () => {
    const hung = { x: 0, y: 2, z: 4 };
    expect(facing(hung, { x: 0, y: 2, z: 0 }, "front")).toBe(180);
    expect(facing(hung, { x: 0, y: 2, z: 0 }, "plan", 7)).toBe(7);
    expect(facing({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, "plan")).toBe(90);
    expect(facing({ x: 0, y: 0, z: 0 }, { x: 0, y: -3, z: 0 }, "plan")).toBe(180);
  });
  it("bounds hold the stage and every light", () => {
    const f = light("a1", "pc", 1, { position: { x: -3, y: -5, z: 5 } });
    const b = viewBounds({ stage, trusses, fixtures: [f], scenery: [] }, "plan", 0);
    expect(b).toEqual({ minX: -4, maxX: 4, minY: -6, maxY: 5 });
  });
  it("scenery outlines: a box turned around Z, a cone seen from the front", () => {
    const box = sceneryOutline({ shape: "box", position: { x: 0, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 90 }, size: { x: 2, y: 1, z: 1 } }, "plan");
    const xs = box.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 6);
    const cone = sceneryOutline({ shape: "cone", position: { x: 1, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 2 } }, "front");
    expect(cone).toEqual([
      { x: 0.5, y: -0 },
      { x: 1.5, y: -0 },
      { x: 1, y: -2 },
    ]);
  });
});
