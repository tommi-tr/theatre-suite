import { addressProblems } from "../model/addresses";
import { fixtureType, type SymbolKind } from "../model/fixtureTypes";
import { visibleLight } from "../model/universe";
import { UNIVERSE_SIZE, type Fixture, type GranveloDoc, type Id, type Scenery, type SceneryPlacement, type Vec3 } from "../model/types";
import { beamPool, lightPosition, type Pool } from "./geometry";

/**
 * What the stage views draw, computed once from the document and the light state (pure: shared by the 2D and the 3D
 * views, and by the memory thumbnails of the next phases).
 */

/** The part of the document a stage view needs. */
export type StageDoc = Pick<GranveloDoc, "stage" | "trusses" | "fixtures" | "scenery">;

/** How the symbol is drawn (10_granvelo.md, "Simboli delle luci"). */
export type LightLook = "normal" | "selected" | "conflict" | "unused";

export interface StageLight {
  f: Fixture;
  /** Where it really is (on a truss: the truss's depth and height). */
  pos: Vec3;
  symbol: SymbolKind;
  look: LightLook;
  /** Selected (also when unused: the frame is drawn, the symbol stays dashed). */
  selected: boolean;
  /** The light it makes: colour at full (`#rrggbb`) and brightness 0–1; null = dark (no state, no address, unused, at 0). */
  light: { hue: string; level: number } | null;
  pool: Pool;
}

/** The values of one light read from the 512 channels of the universe (0 past 512 or without address). */
export function lightValues(f: Pick<Fixture, "address" | "channels">, values: ArrayLike<number>): number[] {
  if (f.address === null) return f.channels.map(() => 0);
  return f.channels.map((_, i) => (f.address! + i <= UNIVERSE_SIZE ? (values[f.address! + i - 1] ?? 0) : 0));
}

/**
 * Every light as the views draw it. `values` = the 512 DMX values (index = channel − 1) of the state to show;
 * undefined = no light (only the symbols). `withConflicts` = mark address conflicts in amber (not in thumbnails).
 */
export function stageLights(doc: StageDoc, values: ArrayLike<number> | undefined, selected: readonly Id[] = [], withConflicts = true): StageLight[] {
  const problems = withConflicts ? addressProblems(doc) : null;
  const sel = new Set(selected);
  return doc.fixtures.map((f) => {
    const pos = lightPosition(f, doc);
    const isSel = sel.has(f.id);
    const bad = !!problems && (problems.conflicts.has(f.id) || problems.outOfRange.has(f.id));
    const look: LightLook = f.unused ? "unused" : isSel ? "selected" : bad ? "conflict" : "normal";
    let light: StageLight["light"] = null;
    if (values && !f.unused && f.address !== null) {
      const v = visibleLight(f, lightValues(f, values));
      if (v.hue && v.level > 0.004) light = { hue: v.hue, level: v.level };
    }
    return { f, pos, symbol: fixtureType(f.typeId).symbol, look, selected: isSel, light, pool: beamPool(pos, f.aim, f.beam.angle) };
  });
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

/** "N · nome · 001": the label of a selected light on the stage. */
export function lightLabel(f: Pick<Fixture, "number" | "name" | "address">, typeName: string): string {
  const addr = f.address === null ? "—" : String(f.address).padStart(3, "0");
  return `${f.number} · ${f.name || typeName} · ${addr}`;
}

/** The symbol of the profile spot is drawn facing right; all the others face up. */
export const symbolOffset = (kind: SymbolKind) => (kind === "profile" ? -90 : 0);
