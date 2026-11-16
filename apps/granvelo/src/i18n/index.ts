import type { Dict, Lang } from "@theatre-suite/core";
import { en } from "./en";
import { it } from "./it";

/** The Italian dictionaries (one for now; split by part when it grows). A text must mean the same everywhere it is used. */
export const IT_PARTS: Dict[] = [it];

/** Keys are the English texts: English needs only the few keys with a context (see en.ts). */
export const DICTS: Record<Lang, Dict> = { en, it: Object.assign({}, ...IT_PARTS) };
