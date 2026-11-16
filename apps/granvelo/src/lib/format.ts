import type { Lang } from "@theatre-suite/core";

/** A number written the way the user reads it ("4,5" in Italian), at most `decimals` decimals. */
export function fmtNum(v: number, lang: Lang, decimals = 2): string {
  return new Intl.NumberFormat(lang === "it" ? "it-IT" : "en-GB", { maximumFractionDigits: decimals }).format(v);
}

/** DMX value in the chosen units: "255" or "100%". */
export function fmtLevel(v: number, units: "dmx" | "percent"): string {
  return units === "percent" ? `${Math.round((v / 255) * 100)}%` : String(Math.round(v));
}

/** Address written as on the lights' keypad: three digits. */
export const fmtAddress = (a: number) => String(a).padStart(3, "0");
