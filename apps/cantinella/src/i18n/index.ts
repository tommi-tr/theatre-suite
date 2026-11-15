import type { Dict, Lang } from "@theatre-suite/core";
import { it } from "./it";
import { itRehearsals } from "./it_rehearsals";
import { itBudget } from "./it_budget";

/** The Italian dictionaries, one per group of parts. A text must mean the same everywhere it is used. */
export const IT_PARTS: Dict[] = [it, itRehearsals, itBudget];

/** Keys are the English texts: English needs no dictionary. */
export const DICTS: Record<Lang, Dict> = { en: {}, it: Object.assign({}, ...IT_PARTS) };
