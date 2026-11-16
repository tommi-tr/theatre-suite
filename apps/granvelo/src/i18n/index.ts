import type { Dict, Lang } from "@theatre-suite/core";
import { en } from "./en";
import { it } from "./it";
import { itSetup } from "./it_setup";
import { itDmx } from "./it_dmx";
import { itCheck } from "./it_check";
import { itStage } from "./it_stage";
import { itDesk } from "./it_desk";
import { itShow } from "./it_show";
import { itPrint } from "./it_print";

/** The Italian dictionaries, one per group of parts. A text must mean the same everywhere it is used. */
export const IT_PARTS: Dict[] = [it, itSetup, itDmx, itCheck, itStage, itDesk, itShow, itPrint];

/** Keys are the English texts: English needs only the few keys with a context (see en.ts). */
export const DICTS: Record<Lang, Dict> = { en, it: Object.assign({}, ...IT_PARTS) };
