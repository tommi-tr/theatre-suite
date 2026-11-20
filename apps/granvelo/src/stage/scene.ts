import { addressProblems } from "../model/addresses";
import { COLOR_FUNCTIONS, fixtureType, type SymbolKind } from "../model/fixtureTypes";
import { visibleLight } from "../model/universe";
import type { Fixture, GranveloDoc, Id, Vec3 } from "../model/types";
import { beamPool, lightPosition, type Pool } from "./geometry";
import { lightValues, sceneryOnStage } from "@theatre-suite/show-files/granvelo/stage";

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

export { lightValues };

/** Does the light have colour channels (red, green, blue, white, amber, UV)? A halogen or a spot has none. */
export const hasColourChannels = (f: Pick<Fixture, "channels">) => f.channels.some((c) => COLOR_FUNCTIONS.includes(c.function));

const WARM = { r: 255, g: 112, b: 24 };
const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

/**
 * A halogen that is dimmed gets warmer (its filament cools: orange, then red). Mixes the colour of the light towards a deep
 * orange as the level falls: full level = unchanged, level 0 = 85 % of the way. Only for lights without colour channels.
 */
export function warmWhenDimmed(hue: string, level: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hue);
  if (!m) return hue;
  const n = parseInt(m[1], 16);
  const k = 0.85 * Math.pow(1 - Math.min(1, Math.max(0, level)), 1.4);
  const mix = (a: number, b: number) => a + (b - a) * k;
  return `#${hex2(mix((n >> 16) & 255, WARM.r))}${hex2(mix((n >> 8) & 255, WARM.g))}${hex2(mix(n & 255, WARM.b))}`;
}

/**
 * Every light as the views draw it. `values` = the 512 DMX values (index = channel − 1) of the state to show;
 * undefined = no light (only the symbols). `withConflicts` = mark address conflicts in amber (not in thumbnails).
 * `warmHalogens` ("Alta"): lights without colour channels turn warmer as they are dimmed.
 */
export function stageLights(doc: StageDoc, values: ArrayLike<number> | undefined, selected: readonly Id[] = [], withConflicts = true, warmHalogens = false): StageLight[] {
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
      if (v.hue && v.level > 0.004) light = { hue: warmHalogens && !hasColourChannels(f) ? warmWhenDimmed(v.hue, v.level) : v.hue, level: v.level };
    }
    return { f, pos, symbol: fixtureType(f.typeId).symbol, look, selected: isSel, light, pool: beamPool(pos, f.aim, f.beam.angle) };
  });
}

export { sceneryOnStage };

/** "N · nome · 001": the label of a selected light on the stage. */
export function lightLabel(f: Pick<Fixture, "number" | "name" | "address">, typeName: string): string {
  const addr = f.address === null ? "—" : String(f.address).padStart(3, "0");
  return `${f.number} · ${f.name || typeName} · ${addr}`;
}

/** The symbol of the profile spot is drawn facing right; all the others face up. */
export const symbolOffset = (kind: SymbolKind) => (kind === "profile" ? -90 : 0);
