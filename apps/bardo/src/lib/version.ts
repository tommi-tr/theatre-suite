import pkg from "../../package.json";

export const APP_VERSION: string = pkg.version;
export const APP_NAME = `Bardo ${APP_VERSION}`;

/** Bardo icon geometry (100×100 box), see 02_design.md. Small version for the title bar. */
export const LOGO = {
  accent: "M20 32H31M20 62H30",
  ink: "M41 32H80M41 46H66M41 62H80M41 76H62",
};
