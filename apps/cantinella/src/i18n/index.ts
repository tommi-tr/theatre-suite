import type { Dict, Lang } from "@theatre-suite/core";
import { it } from "./it";
import { itRehearsals } from "./it_rehearsals";

/** Keys are the English texts: English needs no dictionary. */
export const DICTS: Record<Lang, Dict> = { en: {}, it: { ...it, ...itRehearsals } };
