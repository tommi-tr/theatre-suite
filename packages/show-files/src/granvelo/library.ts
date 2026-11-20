import { transitionDuration } from "./crossfade";
import { fadeToArgs, memoryFadePayload } from "./enginePayload";
import { parse } from "./file";
import { fixtureType, type SymbolKind } from "./fixtureTypes";
import { litCount, memoriesInOrder, stateUniverse } from "./memories";
import { lightPosition, lightValues, sceneryOnStage } from "./stage";
import { visibleLight } from "./universe";
import type { GranveloDoc, Id, Memory, SceneryShape, Transition } from "./types";

/**
 * A Granvelo show seen from outside Granvelo (Cue's lights library): the memories as plain summaries, what GO to a
 * memory sends to the DMX engine, and what a memory thumbnail draws.
 */

export interface MemorySummary {
  /** Stable id of the memory (kept in the file; independent of its number, name and place in the sequence). */
  id: Id;
  /** Number chosen by the user (unique, can change). */
  number: number;
  label: string;
  note: string;
  /** Place in the show sequence (0-based); null = not in the sequence (Granvelo's GO skips it). */
  sequenceIndex: number | null;
  /** Times of the transition to this memory (seconds): fade in (rising channels), fade out (falling), delay. */
  transition: Transition;
  /** Seconds from GO to the end of the transition (delay + the longer fade). */
  durationSec: number;
  /** "Parte da sola": at the end of its transition the next memory of the sequence starts by itself. */
  autoFollow: boolean;
  /** It starts by itself: the memory before it in the sequence has "parte da sola". */
  startsByItself: boolean;
  /** How many used lights give light in it. */
  litCount: number;
  /** It is the memory of "Emergenza". */
  emergency: boolean;
}

/** The memories in show order (the sequence first, then the others by number), as summaries. */
export function listMemories(doc: GranveloDoc): MemorySummary[] {
  const seqIndex = new Map(doc.sequence.map((id, i) => [id, i]));
  const byId = new Map(doc.memories.map((m) => [m.id, m]));
  return memoriesInOrder(doc).map((m) => {
    const i = seqIndex.get(m.id);
    const before = i !== undefined && i > 0 ? byId.get(doc.sequence[i - 1]) : undefined;
    return {
      id: m.id,
      number: m.number,
      label: m.label,
      note: m.note,
      sequenceIndex: i ?? null,
      transition: { ...m.transition },
      durationSec: transitionDuration(m.transition),
      autoFollow: m.transition.autoFollow,
      startsByItself: !!before?.transition.autoFollow,
      litCount: litCount(doc, m.state),
      emergency: doc.settings.emergencyMemoryId === m.id,
    };
  });
}

/** Reads the text of a `.granvelo` file (format 1 only; throws `GranveloFileError`) and lists its memories. */
export function readShow(text: string): { doc: GranveloDoc; memories: MemorySummary[] } {
  const doc = parse(text);
  return { doc, memories: listMemories(doc) };
}

/** The memory with this stable id, or undefined. */
export const memoryById = (doc: Pick<GranveloDoc, "memories">, id: Id): Memory | undefined => doc.memories.find((m) => m.id === id);

/**
 * The arguments of the native `dmx_fade_to` command for a GO to this memory, exactly as Granvelo's Show sends them:
 * the memory's 512 values with the groups at their saved levels (no tracking: a memory is the whole stage), its own
 * transition, the channel layout of the document. The Grand Master is not in it (the engine's output master).
 */
export function memoryGoArgs(doc: Pick<GranveloDoc, "fixtures" | "groups">, memory: Pick<Memory, "state" | "transition">) {
  return fadeToArgs(memoryFadePayload(doc, memory));
}

/* ------------------------------------------------------------------ */
/* Thumbnail                                                            */
/* ------------------------------------------------------------------ */

export interface ThumbLight {
  id: Id;
  number: number;
  symbol: SymbolKind;
  /** Plan position in metres (x left → right seen from the audience, y depth from the proscenium, house < 0). */
  x: number;
  y: number;
  /** Where it points (metres) and its full beam angle, for drawing the pool of light. */
  aim: { x: number; y: number; z: number };
  beam: number;
  /** Height of the light (metres). */
  z: number;
  /** Not used in this production: Granvelo draws it dashed and it makes no light. */
  unused: boolean;
  /** The light it makes in this memory: colour at full (`#RRGGBB`) and brightness 0–1; null = dark. */
  light: { hue: string; level: number; color: string } | null;
}

export interface ThumbScenery {
  id: Id;
  shape: SceneryShape;
  /** Centre of the base (metres) and rotation around Z (degrees). */
  x: number;
  y: number;
  rotation: number;
  /** Width (X) and depth (Y) in metres (a plane has depth 0; cone, sphere, cylinder use X as diameter). */
  width: number;
  depth: number;
  color: string;
}

export interface MemoryThumbnail {
  /** Stage width and depth (the floor spans x −width/2 … +width/2, y 0 … depth). */
  stage: { width: number; depth: number };
  /**
   * The area Granvelo frames in its plan thumbnails (stage, trusses, lights and scenery, 0,8 m margin), in plan
   * coordinates. Draw with y growing upstage upwards: the audience is at the bottom.
   */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Depth of every truss (drawn as a line across the whole width). */
  trusses: { id: Id; y: number }[];
  scenery: ThumbScenery[];
  lights: ThumbLight[];
}

/** Below this brightness a light counts as dark in the thumbnail (as Granvelo's stage views). */
const DARK = 0.004;
const MARGIN = 0.8;

/**
 * What Granvelo's memory thumbnail draws (the stage plan with the lights of the memory, `StageView2D compact`): the
 * memory's own values (the groups and the Grand Master are not applied, as in Granvelo's lists), the scenery where it
 * stands in that memory, every light with the colour and brightness it makes.
 */
export function memoryThumbnail(doc: Pick<GranveloDoc, "stage" | "trusses" | "fixtures" | "scenery">, memory: Pick<Memory, "state" | "scenery">): MemoryThumbnail {
  const values = stateUniverse(doc, memory.state);
  const lights: ThumbLight[] = doc.fixtures.map((f) => {
    const pos = lightPosition(f, doc);
    let light: ThumbLight["light"] = null;
    if (!f.unused && f.address !== null) {
      const v = visibleLight(f, lightValues(f, values));
      if (v.hue && v.level > DARK) light = { hue: v.hue, level: v.level, color: v.color };
    }
    return { id: f.id, number: f.number, symbol: fixtureType(f.typeId).symbol, x: pos.x, y: pos.y, z: pos.z, aim: { ...f.aim }, beam: f.beam.angle, unused: f.unused, light };
  });
  const scenery: ThumbScenery[] = sceneryOnStage(doc, memory.scenery).map((s) => ({
    id: s.id,
    shape: s.shape,
    x: s.position.x,
    y: s.position.y,
    rotation: s.rotation.z,
    width: s.size.x,
    depth: s.size.y,
    color: s.color,
  }));
  // The same framing as Granvelo's plan (`viewBounds`): every piece of scenery as built, not only those on stage.
  const { width, depth } = doc.stage;
  const xs = [-width / 2, width / 2, ...lights.map((l) => l.x)];
  const ys = [0, depth, ...doc.trusses.map((t) => t.y), ...lights.map((l) => l.y)];
  for (const s of doc.scenery) {
    const r = Math.max(s.size.x, s.size.y) / 2;
    xs.push(s.position.x - r, s.position.x + r);
    ys.push(s.position.y - r, s.position.y + r);
  }
  return {
    stage: { width, depth },
    bounds: { minX: Math.min(...xs) - MARGIN, maxX: Math.max(...xs) + MARGIN, minY: Math.min(...ys) - MARGIN, maxY: Math.max(...ys) + MARGIN },
    trusses: doc.trusses.map((t) => ({ id: t.id, y: t.y })),
    scenery,
    lights,
  };
}
