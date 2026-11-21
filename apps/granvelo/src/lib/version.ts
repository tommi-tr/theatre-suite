import pkg from "../../package.json";
import { GRANVELO_LOGO } from "@theatre-suite/ui";

export const APP_VERSION: string = pkg.version;
export const APP_NAME = `Granvelo ${APP_VERSION}`;

/** Granvelo icon "Banco" (see 02_design.md): the geometry lives in packages/ui. */
export const LOGO = GRANVELO_LOGO;
