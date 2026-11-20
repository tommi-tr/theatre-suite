import { UNIVERSE_SIZE, type Fixture, type GranveloDoc, type Mount, type Scenery, type SceneryPlacement, type Stage, type Vec3 } from "./types";

/**
 * The few pieces of stage geometry the document itself needs (reading a file fills in a missing aim) and that a
 * reader outside Granvelo needs to place lights and scenery (memory thumbnails). Granvelo's `stage/geometry.ts` and
 * `stage/scene.ts` re-export them. Coordinates as in types.ts (metres, X left → right seen from the audience,
 * Y depth from the proscenium, Z height).
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Where a light really is: a light on a truss follows the truss (its own `y`/`z` are only a copy). */
export function lightPosition(f: Pick<Fixture, "mount" | "position">, doc: Pick<GranveloDoc, "trusses">): Vec3 {
  if (f.mount.kind === "truss") {
    const id = f.mount.trussId;
    const t = doc.trusses.find((x) => x.id === id);
    if (t) return { x: f.position.x, y: t.y, z: t.z };
  }
  return { ...f.position };
}

/** The "high" zone of the stage, where trusses hang: from 60 % of the stage height, at least 2 m. */
export const highZone = (stage: Stage) => Math.max(2, stage.height * 0.6);

/**
 * Default aim by place (10_granvelo.md): lights in the house point at the proscenium, spread (not all at the centre:
 * each keeps 60 % of its sideways offset); on the floor, or floating in the wings (outside the width of the stage,
 * below the trusses), they cut across horizontally towards the other side; upstage (the last 30 % of the depth) they
 * are backlights, pointing down and towards the audience; elsewhere above the stage they point straight down.
 */
export function defaultAim(position: Vec3, mount: Mount, stage: Stage): Vec3 {
  const half = stage.width / 2;
  if (position.y < 0) return { x: round2(Math.max(-half * 0.7, Math.min(half * 0.7, position.x * 0.6))), y: round2(Math.min(1.5, stage.depth / 3)), z: 1.6 };
  const inWings = mount.kind === "floating" && Math.abs(position.x) > half && position.z < highZone(stage);
  if (mount.kind === "floor" || inWings) return { x: position.x <= 0 ? round2(half) : round2(-half), y: position.y, z: round2(Math.min(position.z, 1.5) + 1.2) };
  if (position.y > stage.depth * 0.7) return { x: position.x, y: round2(Math.max(0, position.y - 2.5)), z: 1.5 };
  return { x: position.x, y: position.y, z: 0 };
}

/** The values of one light read from the 512 channels of the universe (0 past 512 or without address). */
export function lightValues(f: Pick<Fixture, "address" | "channels">, values: ArrayLike<number>): number[] {
  if (f.address === null) return f.channels.map(() => 0);
  return f.channels.map((_, i) => (f.address! + i <= UNIVERSE_SIZE ? (values[f.address! + i - 1] ?? 0) : 0));
}

/** The scenery on stage: every piece where it was built ("all"), or the pieces of a memory where they stand then. */
export function sceneryOnStage(doc: Pick<GranveloDoc, "scenery">, placements: readonly SceneryPlacement[] | "all" = "all"): Scenery[] {
  if (placements === "all") return doc.scenery;
  const out: Scenery[] = [];
  for (const p of placements) {
    const s = doc.scenery.find((x) => x.id === p.sceneryId);
    if (s) out.push({ ...s, position: p.position, rotation: p.rotation });
  }
  return out;
}
