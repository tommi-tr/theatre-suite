import pkg from "../../package.json";
import { CUE_LOGO } from "@theatre-suite/ui";

export const APP_VERSION: string = pkg.version;
export const APP_NAME = `Cue ${APP_VERSION}`;

/** Cue icon "Filo" (see 02_design.md): the geometry lives in packages/ui. */
export const LOGO = CUE_LOGO;
