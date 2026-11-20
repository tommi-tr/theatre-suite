import type { Lang } from "@theatre-suite/core";

/** Seconds as the interface writes them: "2,0 s" in Italian, "2.0 s" in English. */
export function fmtSec(n: number, lang: Lang): string {
  const v = Math.round(n * 10) / 10;
  const text = v.toFixed(1);
  return `${lang === "it" ? text.replace(".", ",") : text} s`;
}

/** Decibels with a sign: "-3 dB", "+2 dB", "0 dB". */
export function fmtDb(n: number, lang: Lang): string {
  const v = Math.round(n * 10) / 10;
  const text = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return `${v > 0 ? "+" : ""}${lang === "it" ? text.replace(".", ",") : text} dB`;
}

/** A speed factor: "0,6×". */
export function fmtSpeed(n: number, lang: Lang): string {
  const text = String(Math.round(n * 100) / 100);
  return `${lang === "it" ? text.replace(".", ",") : text}×`;
}

/** A length: "0:42", "1:35", "1:02:10". */
export function fmtDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return "";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
