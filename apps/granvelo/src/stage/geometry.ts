import type { GranveloDoc, Id, Mount, Scenery, Stage, Truss, Vec3 } from "../model/types";
import { defaultAim, highZone, lightPosition } from "@theatre-suite/show-files/granvelo/stage";

/**
 * Geometry of the stage, pure (no React, no three.js): used by the 2D views, the 3D view and the operations of the
 * document. Coordinates are those of the document (types.ts): metres, X left → right seen from the audience,
 * Y depth (0 at the proscenium, positive upstage, house < 0), Z height above the stage floor.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;
const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Where a light is, default aim                                        */
/* ------------------------------------------------------------------ */

/**
 * `lightPosition` (a light on a truss follows the truss), `defaultAim` (by place, 10_granvelo.md) and `highZone` live
 * in the shared package `@theatre-suite/show-files` (reading a file needs the default aim; Cue draws thumbnails).
 */
export { lightPosition, defaultAim };

/* ------------------------------------------------------------------ */
/* The light on the floor                                               */
/* ------------------------------------------------------------------ */

/**
 * The pool of light of a beam, as an ellipse on the floor plan:
 * centre (`cx`, `cy`), half axes `rx` (along the direction the light travels, seen from above) and `ry` (across),
 * `angle` = direction of `rx` in radians in the XY plane (0 = towards +X, π/2 = towards +Y).
 *
 * - `floor`: the aim is on the floor (z ≤ 5 cm) and the whole cone reaches it: the exact ellipse cut by the cone.
 * - `aim`: the aim is in the air (a face, a piece of scenery): the light is drawn where it points, a disc of the beam's
 *   width there, stretched along its direction by 1/sin(how steeply it comes down), at most 1,6 times.
 * - `grazing`: the light is almost horizontal or points a little upwards (side lights, a cone that would not close on
 *   the floor): a band from under the light to the aim point.
 * - `up`: the light points steeply upwards (more than 30°: a cyclorama light at the foot of the backdrop): no light on
 *   the floor; the ellipse is the beam's width where it points, drawn as an outline only.
 *
 * `end` is where the axis of the beam ends (for beams drawn as cones) and `endRadius` the radius of the beam there.
 */
export interface Pool {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
  kind: "floor" | "aim" | "grazing" | "up";
  end: Vec3;
  endRadius: number;
}

/** Below this angle (degrees) under the horizon a beam counts as grazing. */
export const GRAZING_DEG = 8;
const MIN_HALF = 0.5 * DEG;
const MAX_HALF = 80 * DEG;

export function beamPool(pos: Vec3, aim: Vec3, beamDeg: number, maxReach = 40): Pool {
  let dx = aim.x - pos.x;
  let dy = aim.y - pos.y;
  let dz = aim.z - pos.z;
  let len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) {
    dx = 0;
    dy = 0;
    dz = -Math.max(pos.z, 1);
    len = Math.abs(dz);
  }
  const a = Math.min(MAX_HALF, Math.max(MIN_HALF, ((Number.isFinite(beamDeg) ? beamDeg : 25) / 2) * DEG));
  const hlen = Math.hypot(dx, dy);
  const angle = hlen < 1e-6 ? Math.PI / 2 : Math.atan2(dy, dx);
  const hx = Math.cos(angle);
  const hy = Math.sin(angle);
  const e = Math.atan2(-dz, hlen); // how steeply the beam comes down (radians, + = downwards)
  const h = pos.z;

  if (aim.z <= 0.05 && h > 0.01 && e - a > 3 * DEG) {
    const cot = (x: number) => Math.cos(x) / Math.sin(x);
    const near = h * cot(e + a);
    const far = h * cot(e - a);
    if (far <= maxReach) {
      const along = (near + far) / 2;
      const sa = Math.sin(a);
      const se = Math.sin(e);
      const ry = (h * sa) / Math.sqrt(Math.max(1e-9, se * se - sa * sa));
      const end = { x: aim.x, y: aim.y, z: 0 };
      return { cx: pos.x + hx * along, cy: pos.y + hy * along, rx: (far - near) / 2, ry, angle, kind: "floor", end, endRadius: Math.hypot(end.x - pos.x, end.y - pos.y, h) * Math.tan(a) };
    }
  }
  const r = Math.max(0.15, len * Math.tan(a));
  if (e >= GRAZING_DEG * DEG) {
    const stretch = Math.min(1.6, 1 / Math.sin(e));
    return { cx: aim.x, cy: aim.y, rx: r * stretch, ry: r, angle, kind: "aim", end: { ...aim }, endRadius: r };
  }
  if (e < -30 * DEG) return { cx: aim.x, cy: aim.y, rx: r, ry: r, angle, kind: "up", end: { ...aim }, endRadius: r };
  // Grazing: a band on the floor from under the light to the aim (where a side light crosses the stage).
  const end = len < 1e-6 ? { ...pos } : { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz };
  return { cx: (pos.x + end.x) / 2, cy: (pos.y + end.y) / 2, rx: Math.max(r, hlen / 2), ry: r, angle, kind: "grazing", end, endRadius: r };
}

/** Points of an ellipse (for outlines and tests). */
export function poolOutline(p: Pick<Pool, "cx" | "cy" | "rx" | "ry" | "angle">, steps = 32): { x: number; y: number }[] {
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  return Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * Math.PI * 2;
    const u = Math.cos(t) * p.rx;
    const v = Math.sin(t) * p.ry;
    return { x: p.cx + u * c - v * s, y: p.cy + u * s + v * c };
  });
}

/* ------------------------------------------------------------------ */
/* Dropping a light: trusses, floating, floor                          */
/* ------------------------------------------------------------------ */

/**
 * Thresholds of the "Sposta" tool (documented in docs/granvelo/README.md):
 * - dropped lower than `FLOOR_ZONE` (0,5 m) → **on the floor**, height 0;
 * - a light already on the floor stays on the floor while it is lower than the "high" zone (a stand, a ladder);
 * - dropped in the high zone (`highZone`: from 60 % of the stage height, at least 2 m) → the nearest **truss** within
 *   `TRUSS_MAGNET_Y` (0,6 m) in depth and `TRUSS_MAGNET_Z` (1 m) in height takes it (magnet); with no truss nearby, over
 *   the stage (0 ≤ Y ≤ depth, at most `WING_ROOM` beyond the sides) **a new truss is created** at that depth and height;
 * - anything else → **floating** (in the house, in the wings, under the trusses).
 */
export const FLOOR_ZONE = 0.5;
export const TRUSS_MAGNET_Y = 0.6;
export const TRUSS_MAGNET_Z = 1;
export const WING_ROOM = 1;
export { highZone };

export type DropMount = { kind: "truss"; trussId: Id } | { kind: "newTruss"; y: number; z: number } | { kind: "floating" } | { kind: "floor" };

export interface Drop {
  mount: DropMount;
  position: Vec3;
}

/** The truss that catches a light dropped at (y, z), if any (the nearest in depth). */
export function trussMagnet(trusses: Truss[], y: number, z: number): Truss | null {
  let best: Truss | null = null;
  for (const t of trusses) {
    if (Math.abs(t.y - y) > TRUSS_MAGNET_Y || Math.abs(t.z - z) > TRUSS_MAGNET_Z) continue;
    if (!best || Math.abs(t.y - y) < Math.abs(best.y - y)) best = t;
  }
  return best;
}

/** Is (x, y) over the stage, where a new truss may be born? */
export const overStage = (stage: Stage, x: number, y: number) => y >= 0 && y <= stage.depth && Math.abs(x) <= stage.width / 2 + WING_ROOM;

/** Where a light dropped at `to` ends up (see the thresholds above). `current` is how it is mounted now. */
export function resolveDrop(doc: Pick<GranveloDoc, "stage" | "trusses">, current: Mount, to: Vec3): Drop {
  const x = round2(to.x);
  const y = round2(to.y);
  const z = round2(Math.max(0, to.z));
  if (z < FLOOR_ZONE) return { mount: { kind: "floor" }, position: { x, y, z: 0 } };
  const high = highZone(doc.stage);
  if (current.kind === "floor" && z < high) return { mount: { kind: "floor" }, position: { x, y, z } };
  if (z >= high) {
    const t = trussMagnet(doc.trusses, y, z);
    if (t) return { mount: { kind: "truss", trussId: t.id }, position: { x, y: t.y, z: t.z } };
    if (overStage(doc.stage, x, y)) return { mount: { kind: "newTruss", y, z }, position: { x, y, z } };
  }
  return { mount: { kind: "floating" }, position: { x, y, z } };
}

/* ------------------------------------------------------------------ */
/* Views: plan and front                                                */
/* ------------------------------------------------------------------ */

export type View2D = "plan" | "front";

/** A point of the world on the drawing (SVG units = metres; screen y goes down). Plan: from above, audience at the bottom. Front: from the audience. */
export function project(v: Vec3, view: View2D): { x: number; y: number } {
  return view === "plan" ? { x: v.x, y: -v.y } : { x: v.x, y: -v.z };
}

/** Back from the drawing to the world: the coordinate the view does not show is taken from `keep`. */
export function unproject(p: { x: number; y: number }, view: View2D, keep: Vec3): Vec3 {
  return view === "plan" ? { x: p.x, y: -p.y, z: keep.z } : { x: p.x, y: keep.y, z: -p.y };
}

/**
 * Rotation (degrees, clockwise on screen) that turns a symbol drawn facing up so that it faces the direction from
 * `from` to `to` on the drawing. When the direction does not show in this view (a light pointing straight down, seen
 * from above) the symbol keeps `fallback`.
 */
export function facing(from: Vec3, to: Vec3, view: View2D, fallback = 0): number {
  const a = project(from, view);
  const b = project(to, view);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 0.05) return fallback;
  return Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
}

export interface Box2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** What a view must show: the stage, every light and every scenery piece, with a margin (metres, drawing units). */
export function viewBounds(doc: Pick<GranveloDoc, "stage" | "trusses" | "fixtures" | "scenery">, view: View2D, margin = 0.8): Box2 {
  const { width, depth, height } = doc.stage;
  const pts: Vec3[] = [
    { x: -width / 2, y: 0, z: 0 },
    { x: width / 2, y: depth, z: height },
  ];
  for (const t of doc.trusses) pts.push({ x: 0, y: t.y, z: t.z });
  for (const f of doc.fixtures) pts.push(lightPosition(f, doc));
  for (const s of doc.scenery) {
    const r = Math.max(s.size.x, s.size.y) / 2;
    pts.push({ x: s.position.x - r, y: s.position.y - r, z: s.position.z }, { x: s.position.x + r, y: s.position.y + r, z: s.position.z + s.size.z });
  }
  const b: Box2 = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const v of pts) {
    const p = project(v, view);
    b.minX = Math.min(b.minX, p.x);
    b.maxX = Math.max(b.maxX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return { minX: b.minX - margin, minY: b.minY - margin, maxX: b.maxX + margin, maxY: b.maxY + margin };
}

/* ------------------------------------------------------------------ */
/* Scenery                                                              */
/* ------------------------------------------------------------------ */

/** A believable size for a new piece of each shape (metres: width X × depth Y × height Z). */
export function defaultScenerySize(shape: Scenery["shape"]): Vec3 {
  switch (shape) {
    case "box":
      return { x: 1.2, y: 0.8, z: 0.8 };
    case "cone":
      return { x: 0.8, y: 0.8, z: 1.2 };
    case "sphere":
      return { x: 0.8, y: 0.8, z: 0.8 };
    case "plane":
      return { x: 3, y: 0, z: 2.5 };
    default:
      return { x: 0.5, y: 0.5, z: 2 };
  }
}

/**
 * The outline of a piece seen from above (plan) or from the audience (front), as a polygon in world units of the
 * view (x and the second coordinate of `project`, before the screen flip). Only the turn around Z counts in the plan
 * (a box tilted forwards is still drawn by its footprint): enough to place things, not a renderer.
 */
export function sceneryOutline(s: Pick<Scenery, "shape" | "position" | "rotation" | "size">, view: View2D): { x: number; y: number }[] {
  const { x, y, z } = s.position;
  const w = s.size.x;
  const d = s.shape === "plane" ? 0.04 : s.shape === "box" ? s.size.y : s.size.x;
  const h = s.shape === "sphere" ? s.size.x : s.size.z;
  const rz = (s.rotation.z || 0) * DEG;
  if (view === "plan") {
    if (s.shape === "box" || s.shape === "plane") {
      const c = Math.cos(rz);
      const sn = Math.sin(rz);
      return [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
      ].map(([u, v]) => project({ x: x + u * c - v * sn, y: y + u * sn + v * c, z }, "plan"));
    }
    return Array.from({ length: 24 }, (_, i) => {
      const t = (i / 24) * Math.PI * 2;
      return project({ x: x + (Math.cos(t) * w) / 2, y: y + (Math.sin(t) * w) / 2, z }, "plan");
    });
  }
  // Front: the width seen from the audience of a piece turned around Z.
  const seen = s.shape === "box" || s.shape === "plane" ? Math.abs(w * Math.cos(rz)) + Math.abs(d * Math.sin(rz)) : w;
  const P = (u: number, v: number) => project({ x: x + u, y, z: z + v }, "front");
  if (s.shape === "cone") return [P(-seen / 2, 0), P(seen / 2, 0), P(0, h)];
  if (s.shape === "sphere")
    return Array.from({ length: 24 }, (_, i) => {
      const t = (i / 24) * Math.PI * 2;
      return P((Math.cos(t) * w) / 2, h / 2 + (Math.sin(t) * w) / 2);
    });
  return [P(-seen / 2, 0), P(seen / 2, 0), P(seen / 2, h), P(-seen / 2, h)];
}
