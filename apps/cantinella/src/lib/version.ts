import pkg from "../../package.json";

export const APP_VERSION: string = pkg.version;
export const APP_NAME = `Cantinella ${APP_VERSION}`;

/** Cantinella icon "I · Telaio" (100×100 box, see 02_design.md): frame in ink, diagonals in slate. */
export const LOGO = {
  accent: "M35 45L65 21M35 79L65 55",
  ink: "M30 16H70V84H30ZM30 50H70",
};
