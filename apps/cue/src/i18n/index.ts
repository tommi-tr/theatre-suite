import type { Dict, Lang } from "@theatre-suite/core";
import { en } from "./en";
import { it } from "./it";
import { itScript } from "./it_script";

/** The Italian dictionaries, one per group of parts (more files come with the modes). A text must mean the same everywhere. */
export const IT_PARTS: Dict[] = [it, itScript];

/** Keys are the English texts: English needs only the few keys with a context (see en.ts). */
export const DICTS: Record<Lang, Dict> = { en, it: Object.assign({}, ...IT_PARTS) };
