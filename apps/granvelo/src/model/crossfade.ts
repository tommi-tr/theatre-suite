import { occupiedChannels } from "./addresses";
import { intensityIndexes, isMover } from "./universe";
import { UNIVERSE_SIZE, type GranveloDoc, type Transition } from "./types";

/**
 * Reference implementation of a transition between two states of the universe (GO from one memory to the
 * next). The DMX engine of phase 1 (Rust, its own thread, ~40 frames a second) mirrors this file exactly;
 * `crossfade.test.ts` holds vectors meant to be copied into the Rust tests.
 *
 * Inputs: `from` and `to` (one 0–255 value per channel, any length — 512 on the cable), `t` = seconds since
 * GO (the engine stops `t` while paused), the memory's `Transition`, and a `FadeLayout` that says what each
 * channel is.
 *
 * Rules, channel by channel:
 * 1. Before `delay` nothing moves.
 * 2. An **intensity** channel that rises takes `fadeIn` seconds, one that falls takes `fadeOut` seconds.
 *    Every other channel (pan/tilt, colour wheel, gobo, colour mixing of a light with a Main…) takes `fadeIn`.
 *    Channels that no light uses are treated as intensity (a desk dims what it does not know).
 * 3. Progress p = (t − delay) / duration, clamped to 0…1; a duration of 0 jumps at `delay`.
 * 4. Value = floor(from + (to − from) × p + 0.5). The argument is never negative, so this is the same
 *    rounding in JavaScript and in Rust (`(x + 0.5).floor()`), computed in IEEE double precision.
 * 5. **Move in dark** (`moveInDark`): for the non-intensity channels of a moving head —
 *    - dark at the start (all its intensity channels at 0 in `from`): they jump to `to` at `delay`
 *      (it moves before it lights up, unseen);
 *    - lit at the start and dark at the end: they stay at `from` until `delay + fadeOut` (it has faded out),
 *      then jump to `to`;
 *    - lit at both ends: rule 2 (it moves in view, there is no dark moment).
 *    A moving head without intensity channels is never "dark".
 * The transition is complete at `delay + max(fadeIn, fadeOut)`; then the result equals `to`.
 */

export interface FadeLayout {
  /** 1 = intensity channel (rises with fadeIn, falls with fadeOut), 0 = any other channel (fadeIn). */
  intensity: Uint8Array;
  /** Index into `moverIntensity` of the moving head this (non-intensity) channel belongs to; −1 = none. */
  mover: Int16Array;
  /** For each moving head, its intensity channels (0-based indexes into the universe). */
  moverIntensity: number[][];
}

/** A layout built from plain arrays (for tests and the Rust vectors). */
export function layoutOf(spec: { intensity: number[]; mover?: number[]; moverIntensity?: number[][] }): FadeLayout {
  return {
    intensity: Uint8Array.from(spec.intensity),
    mover: Int16Array.from(spec.mover ?? spec.intensity.map(() => -1)),
    moverIntensity: spec.moverIntensity ?? [],
  };
}

/** The layout of the 512 channels of a document (used lights only; unused and unpatched channels are intensity). */
export function fadeLayout(doc: Pick<GranveloDoc, "fixtures">): FadeLayout {
  const intensity = new Uint8Array(UNIVERSE_SIZE).fill(1);
  const mover = new Int16Array(UNIVERSE_SIZE).fill(-1);
  const moverIntensity: number[][] = [];
  const claimed = new Uint8Array(UNIVERSE_SIZE);
  const isIntensity = new Uint8Array(UNIVERSE_SIZE);
  // First pass: which channels are intensity for at least one used light.
  for (const f of doc.fixtures) {
    if (f.unused) continue;
    const chans = occupiedChannels(f);
    const inten = new Set(intensityIndexes(f));
    chans.forEach((ch, i) => {
      claimed[ch - 1] = 1;
      if (inten.has(i)) isIntensity[ch - 1] = 1;
    });
  }
  for (let i = 0; i < UNIVERSE_SIZE; i++) intensity[i] = claimed[i] ? isIntensity[i] : 1;
  // Second pass: moving heads (the first light claiming a channel wins in a conflict).
  for (const f of doc.fixtures) {
    if (f.unused || !isMover(f)) continue;
    const chans = occupiedChannels(f);
    const inten = new Set(intensityIndexes(f));
    const m = moverIntensity.length;
    moverIntensity.push(chans.filter((_, i) => inten.has(i)).map((ch) => ch - 1));
    chans.forEach((ch, i) => {
      if (!inten.has(i) && intensity[ch - 1] === 0 && mover[ch - 1] === -1) mover[ch - 1] = m;
    });
  }
  return { intensity, mover, moverIntensity };
}

/** Seconds from GO to the end of the transition. */
export function transitionDuration(tr: Pick<Transition, "fadeIn" | "fadeOut" | "delay">): number {
  return Math.max(0, tr.delay) + Math.max(0, tr.fadeIn, tr.fadeOut);
}

/** 0–1 for the bar of the transition box. */
export function transitionProgress(t: number, tr: Pick<Transition, "fadeIn" | "fadeOut" | "delay">): number {
  const total = transitionDuration(tr);
  if (total <= 0) return t >= 0 ? 1 : 0;
  return Math.min(1, Math.max(0, t / total));
}

function progress(t: number, delay: number, duration: number): number {
  if (t < delay) return 0;
  if (duration <= 0) return 1;
  return Math.min(1, (t - delay) / duration);
}

const isDark = (state: ArrayLike<number>, channels: number[]) => channels.length > 0 && channels.every((c) => state[c] === 0);

/** The state of the universe `t` seconds after GO. `from`, `to` and the layout arrays must have the same length. */
export function crossfadeAt(from: ArrayLike<number>, to: ArrayLike<number>, t: number, tr: Transition, layout: FadeLayout): Uint8Array {
  const n = from.length;
  const out = new Uint8Array(n);
  const delay = Math.max(0, tr.delay);
  const fadeIn = Math.max(0, tr.fadeIn);
  const fadeOut = Math.max(0, tr.fadeOut);
  const darkFrom = layout.moverIntensity.map((chs) => isDark(from, chs));
  const darkTo = layout.moverIntensity.map((chs) => isDark(to, chs));
  for (let ch = 0; ch < n; ch++) {
    const a = from[ch];
    const b = to[ch];
    if (a === b) {
      out[ch] = a;
      continue;
    }
    const m = layout.mover[ch];
    if (tr.moveInDark && m >= 0 && layout.intensity[ch] === 0) {
      if (darkFrom[m]) {
        out[ch] = t >= delay ? b : a;
        continue;
      }
      if (darkTo[m]) {
        out[ch] = t >= delay + fadeOut ? b : a;
        continue;
      }
    }
    const duration = layout.intensity[ch] === 1 ? (b > a ? fadeIn : fadeOut) : fadeIn;
    const p = progress(t, delay, duration);
    out[ch] = Math.floor(a + (b - a) * p + 0.5);
  }
  return out;
}
