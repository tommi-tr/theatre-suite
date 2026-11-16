import type { Lang, TFunc } from "@theatre-suite/core";
import type { Transition } from "../model/types";
import { fmtNum } from "../lib/format";

/** "Crossfade 3 s" or "Up 5 s · down 3 s", then delay and the two options, in plain words. */
export function transitionParts(t: TFunc, lang: Lang, tr: Transition): { main: string; extra: string[] } {
  const s = (v: number) => fmtNum(v, lang, 1);
  const main = tr.fadeIn === tr.fadeOut ? t("Crossfade {s} s", { s: s(tr.fadeIn) }) : t("Up {a} s · down {b} s", { a: s(tr.fadeIn), b: s(tr.fadeOut) });
  const extra: string[] = [];
  if (tr.delay > 0) extra.push(t("delay {s} s", { s: s(tr.delay) }));
  if (tr.moveInDark) extra.push(t("moving heads move in the dark"));
  if (tr.autoFollow) extra.push(t("the next one starts by itself"));
  return { main, extra };
}
