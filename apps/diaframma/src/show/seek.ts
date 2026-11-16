import type { Voice } from "../state/types";

/** May a click on a waveform move the play position of this track? (Settings → Show → "Click on the waveform".) */
export function seekAllowed(voice: Voice | null, mode: "paused" | "always" | "never", locked: boolean): boolean {
  if (!voice || locked || mode === "never") return false;
  return mode === "always" || voice.paused;
}
