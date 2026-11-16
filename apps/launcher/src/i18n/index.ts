import { makeT, type Dict, type Lang, type TFunc } from "@theatre-suite/core";
import { it } from "./it";

/** Keys are the English texts: English needs no dictionary. */
export const DICTS: Record<Lang, Dict> = { en: {}, it };

let current: Lang = "it";

/** Called by the app when the language changes, so code outside React can translate too. */
export function setStaticLang(lang: Lang) {
  current = lang;
}

export const tr: TFunc = (key, vars) => makeT(DICTS, current)(key, vars);
