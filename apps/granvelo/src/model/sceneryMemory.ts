import type { GranveloDoc, Id, Memory, SceneryPlacement, Vec3 } from "./types";

/**
 * Scenery per memory (format 1 already stores it: `memory.scenery` = the pieces on stage in that memory and where they
 * stand; pieces not listed are off stage). Pure operations of the document, one call = one step of undo. The piece
 * itself (name, shape, size, colour) is shared by every memory; only whether it is on stage and where it stands changes.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;
const wrap = (a: number) => round2(((((a + 180) % 360) + 360) % 360) - 180);

/** Where a piece stands in a memory, or null when it is off stage there. */
export function placementIn(doc: Pick<GranveloDoc, "memories">, memoryId: Id, sceneryId: Id): SceneryPlacement | null {
  return doc.memories.find((m) => m.id === memoryId)?.scenery.find((p) => p.sceneryId === sceneryId) ?? null;
}

function withMemory(doc: GranveloDoc, memoryId: Id, edit: (m: Memory) => Memory): GranveloDoc {
  let changed = false;
  const memories = doc.memories.map((m) => {
    if (m.id !== memoryId) return m;
    const n = edit(m);
    if (n !== m) changed = true;
    return n;
  });
  return changed ? { ...doc, memories } : doc;
}

/** The piece enters the stage in this memory (where it was built, or at `at`), or leaves it. Nothing changes if it already is so. */
export function setSceneryOnStage(doc: GranveloDoc, memoryId: Id, sceneryId: Id, on: boolean, at?: Partial<SceneryPlacement>): GranveloDoc {
  const piece = doc.scenery.find((s) => s.id === sceneryId);
  if (!piece) return doc;
  return withMemory(doc, memoryId, (m) => {
    const here = m.scenery.some((p) => p.sceneryId === sceneryId);
    if (on === here) return m;
    if (!on) return { ...m, scenery: m.scenery.filter((p) => p.sceneryId !== sceneryId) };
    // Keep the order of the document's pieces, so that files stay stable.
    const placement: SceneryPlacement = { sceneryId, position: { ...(at?.position ?? piece.position) }, rotation: { ...(at?.rotation ?? piece.rotation) } };
    const order = (id: Id) => doc.scenery.findIndex((s) => s.id === id);
    return { ...m, scenery: [...m.scenery, placement].sort((a, b) => order(a.sceneryId) - order(b.sceneryId)) };
  });
}

/** Moves and/or turns a piece in one memory (metres, degrees kept in −180…180). Ignored if it is off stage there or the values make no sense. */
export function moveSceneryInMemory(doc: GranveloDoc, memoryId: Id, sceneryId: Id, patch: { position?: Vec3; rotation?: Vec3 }): GranveloDoc {
  const ok = (v?: Vec3) => !v || [v.x, v.y, v.z].every(Number.isFinite);
  if (!ok(patch.position) || !ok(patch.rotation)) return doc;
  return withMemory(doc, memoryId, (m) => {
    if (!m.scenery.some((p) => p.sceneryId === sceneryId)) return m;
    return {
      ...m,
      scenery: m.scenery.map((p) =>
        p.sceneryId !== sceneryId
          ? p
          : {
              ...p,
              position: patch.position ? { x: round2(patch.position.x), y: round2(patch.position.y), z: round2(Math.max(-50, patch.position.z)) } : p.position,
              rotation: patch.rotation ? { x: wrap(patch.rotation.x), y: wrap(patch.rotation.y), z: wrap(patch.rotation.z) } : p.rotation,
            },
      ),
    };
  });
}

/** The scenery of another memory is copied to this one (to start from the same set and change it). */
export function copySceneryFrom(doc: GranveloDoc, memoryId: Id, fromId: Id): GranveloDoc {
  const from = doc.memories.find((m) => m.id === fromId);
  if (!from || memoryId === fromId) return doc;
  return withMemory(doc, memoryId, (m) => ({ ...m, scenery: from.scenery.map((p) => ({ sceneryId: p.sceneryId, position: { ...p.position }, rotation: { ...p.rotation } })) }));
}

/** What happens to a piece when the show goes to a memory, compared with the memory before it in the show. */
export type SceneryChange = "off" | "stays" | "enters" | "leaves" | "moves";

const same = (a: Vec3, b: Vec3) => a.x === b.x && a.y === b.y && a.z === b.z;

/**
 * For each piece: off stage in both (`off`), on stage in both and in the same place (`stays`), `enters`, `leaves` (it was
 * on stage in the memory before and is not now) or `moves`. The first memory of the show is compared with nothing: its
 * pieces `enter`. `previousId` null = no memory before.
 */
export function sceneryChanges(doc: GranveloDoc, memoryId: Id, previousId: Id | null): Record<Id, SceneryChange> {
  const now = doc.memories.find((m) => m.id === memoryId)?.scenery ?? [];
  const before = previousId ? (doc.memories.find((m) => m.id === previousId)?.scenery ?? []) : [];
  const out: Record<Id, SceneryChange> = {};
  for (const s of doc.scenery) {
    const a = before.find((p) => p.sceneryId === s.id);
    const b = now.find((p) => p.sceneryId === s.id);
    out[s.id] = !a && !b ? "off" : !a ? "enters" : !b ? "leaves" : same(a.position, b.position) && same(a.rotation, b.rotation) ? "stays" : "moves";
  }
  return out;
}

/** The memory before this one in the show (null for the first, or one that is not in the show). */
export function previousInSequence(doc: Pick<GranveloDoc, "sequence">, memoryId: Id): Id | null {
  const i = doc.sequence.indexOf(memoryId);
  return i > 0 ? doc.sequence[i - 1] : null;
}
