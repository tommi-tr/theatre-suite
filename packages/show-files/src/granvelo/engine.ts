/**
 * The shapes of the DMX engine commands that carry a fade (`dmx_fade_to`). The engine (Rust) knows nothing about
 * lights: it receives 512 values and, for a fade, what each channel is. Built by `enginePayload.ts`; sent by
 * Granvelo's `lib/dmx.ts` (and by any other app that drives the same engine).
 */

export interface EngineTransition {
  fadeIn: number;
  fadeOut: number;
  delay: number;
  moveInDark: boolean;
}

/** What each channel is (crossfade.ts `FadeLayout` as plain arrays). */
export interface EngineLayout {
  /** 512 × (1 = intensity, 0 = other). */
  intensity: number[];
  /** 512 × index of the moving head of a non-intensity channel, −1 = none. */
  mover: number[];
  /** For each moving head, its intensity channels (0-based). */
  moverIntensity: number[][];
}

/** The only DMX universe for now (the commands that carry values accept `universe`, default 1). */
export const UNIVERSE_NUMBER = 1;

/** The `fade_to` command (built by enginePayload.ts). */
export interface FadePayload {
  /** DMX universe (default 1, the only one for now). */
  universe?: number;
  /** 512 values (under the output master). */
  target: number[];
  transition: EngineTransition;
  layout: EngineLayout;
}

/** 0–255 integers, at most 512 of them: what the engine accepts as DMX values. */
export const asBytes = (v: ArrayLike<number>): number[] => Array.from(v, (x) => Math.max(0, Math.min(255, Math.round(Number(x) || 0)))).slice(0, 512);
