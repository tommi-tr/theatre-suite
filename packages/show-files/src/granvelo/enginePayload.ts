import { occupiedChannels } from "./addresses";
import { fadeLayout } from "./crossfade";
import { stateUniverse } from "./memories";
import { applyMasters, intensityIndexes } from "./universe";
import { UNIVERSE_SIZE, type GranveloDoc, type Memory, type Transition } from "./types";
import { asBytes, UNIVERSE_NUMBER, type EngineLayout, type EngineTransition, type FadePayload } from "./engine";

/**
 * From the document to the commands of the DMX engine. Pure functions: the engine knows nothing about lights,
 * it receives 512 values and, for a fade, what each channel is.
 *
 * - **Layout** (`engineLayout`): intensity / other / moving-head channel with the intensity channels of its head
 *   (crossfade.ts `fadeLayout` as plain arrays). "Dark at the start / at the end" is decided by the engine from
 *   the values it really has when the fade starts: a GO given during another fade (or "Indietro") starts from the
 *   current output, which only the engine knows exactly.
 * - **Target** (`memoryTarget`): the memory's 512 values with the **groups** applied (their saved levels). The
 *   **Grand Master** is not applied here: it is the engine's output master (`grandMaster` + `intensityMask`),
 *   applied after everything, so a fade never has to be recomputed when the GM moves.
 * - **Intensity mask** (`intensityMask`): the channels the output master scales — intensity channels of used
 *   lights (`dimmer`, or the colours of a light without a `dimmer`), as universe.ts. Channels of no light are not
 *   scaled; positions, gobos, smoke… never.
 */

/** The longest time the engine accepts (24 h), as `MAX_SECONDS` in the DMX engine (`fade.rs`). */
export const MAX_SECONDS = 86_400;

/**
 * A time in seconds as the engine uses it: NaN and −∞ → 0, +∞ → `MAX_SECONDS`, clamped to 0…`MAX_SECONDS`.
 * (JSON turns NaN and Infinity into `null`: they must never reach the engine as such.)
 */
export function cleanSeconds(v: number): number {
  if (Number.isNaN(v) || typeof v !== "number") return 0;
  return Math.min(MAX_SECONDS, Math.max(0, v));
}

/** Transition times made safe for the engine (see `cleanSeconds`). */
export const cleanTransition = (tr: Pick<EngineTransition, "fadeIn" | "fadeOut" | "delay" | "moveInDark">): EngineTransition => ({
  fadeIn: cleanSeconds(tr.fadeIn),
  fadeOut: cleanSeconds(tr.fadeOut),
  delay: cleanSeconds(tr.delay),
  moveInDark: !!tr.moveInDark,
});

/** Finite times for the engine: NaN → 0, Infinity → 24 h (JSON would turn them into null and the command would fail). */
const plainTransition = (tr: Pick<Transition, "fadeIn" | "fadeOut" | "delay" | "moveInDark">): EngineTransition => cleanTransition(tr);

/** What each of the 512 channels is, for the engine. */
export function engineLayout(doc: Pick<GranveloDoc, "fixtures">): EngineLayout {
  const l = fadeLayout(doc);
  return { intensity: Array.from(l.intensity), mover: Array.from(l.mover), moverIntensity: l.moverIntensity.map((c) => [...c]) };
}

/** 512 × (1 = the output master scales it). */
export function intensityMask(doc: Pick<GranveloDoc, "fixtures">): number[] {
  const mask = new Array<number>(UNIVERSE_SIZE).fill(0);
  for (const f of doc.fixtures) {
    if (f.unused) continue;
    const chans = occupiedChannels(f);
    for (const i of intensityIndexes(f)) if (chans[i] !== undefined) mask[chans[i] - 1] = 1;
  }
  return mask;
}

/** The 512 values a memory brings on stage, groups applied, Grand Master not (the engine applies it). */
export function memoryTarget(doc: Pick<GranveloDoc, "fixtures" | "groups">, memory: Pick<Memory, "state">): Uint8Array {
  return applyMasters(doc, stateUniverse(doc, memory.state), { grandMaster: 255 });
}

/** The `fadeTo` payload: from whatever is on stage now to `target` with `transition`. */
export function fadePayload(doc: Pick<GranveloDoc, "fixtures">, target: ArrayLike<number>, transition: Pick<Transition, "fadeIn" | "fadeOut" | "delay" | "moveInDark">): FadePayload {
  const t = new Array<number>(UNIVERSE_SIZE).fill(0);
  for (let i = 0; i < Math.min(UNIVERSE_SIZE, target.length); i++) t[i] = Number.isFinite(target[i]) ? Math.max(0, Math.min(255, Math.round(target[i]))) : 0;
  return { target: t, transition: plainTransition(transition), layout: engineLayout(doc) };
}

/** GO to a memory: its values (groups applied) with its own transition. */
export function memoryFadePayload(doc: Pick<GranveloDoc, "fixtures" | "groups">, memory: Pick<Memory, "state" | "transition">): FadePayload {
  return fadePayload(doc, memoryTarget(doc, memory), memory.transition);
}

/** The arguments of the native `dmx_fade_to` command for a payload (values as bytes, times cleaned, universe 1 by default). */
export function fadeToArgs(p: FadePayload): { target: number[]; transition: EngineTransition; layout: EngineLayout; universe: number } {
  return { target: asBytes(p.target), transition: cleanTransition(p.transition), layout: p.layout, universe: p.universe ?? UNIVERSE_NUMBER };
}
