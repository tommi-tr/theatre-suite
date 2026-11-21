import type { StageDetail } from "./types";

/**
 * "Automatica": which level of the preview a computer can keep up with. Pure (the measuring itself is in benchmark.ts).
 * The richest preview ("Alta") is drawn for a short while; its typical time per picture decides.
 */

export const DETAIL_LEVELS: readonly StageDetail[] = ["essential", "medium", "high"];

/** Up to this time per picture (ms) the richest preview is smooth (about 55 pictures a second). */
export const HIGH_MAX_MS = 18;
/** Up to this time the middle level is smooth (about 25 a second); slower than that, the plainest one. */
export const MEDIUM_MAX_MS = 40;

/** The typical (middle) time of a list of measures; the slowest tenth is ignored, so one hiccup does not decide. */
export function typicalMs(times: readonly number[]): number {
  const t = times.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (t.length === 0) return Infinity;
  const kept = t.slice(0, Math.max(1, Math.ceil(t.length * 0.9)));
  const mid = Math.floor(kept.length / 2);
  return kept.length % 2 ? kept[mid] : (kept[mid - 1] + kept[mid]) / 2;
}

/** The level to use for a typical time per picture of the richest preview. No measure (Infinity) = the plainest. */
export function levelForMs(ms: number): StageDetail {
  if (ms <= HIGH_MAX_MS) return "high";
  // "Media" costs about half of "Alta": it is smooth up to twice the time.
  if (ms <= MEDIUM_MAX_MS) return "medium";
  return "essential";
}

/** Pictures a second for a time per picture (for the plain words in the Settings). */
export const picturesPerSecond = (ms: number) => (ms > 0 && Number.isFinite(ms) ? Math.min(60, Math.round(1000 / ms)) : 0);
