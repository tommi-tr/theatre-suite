import { CUE_LOGO, GRANVELO_LOGO } from "@theatre-suite/ui";

/** The apps of the suite as the interface shows them. A new app = a new row. */
export interface AppDef {
  id: string;
  name: string;
  /** Short English description of what it is for (translated in the dictionary). */
  role: string;
  /** One sentence on what the app does, shown in "Explore, install and update" (translated in the dictionary). */
  about: string;
  /** Not released yet: shown as "coming soon". */
  soon: boolean;
  /** Can the launcher create an empty document for it? */
  canCreate: boolean;
  accent: { dark: string; light: string };
  /** `stroke`: line width on the 100×100 grid for a tile of that size (default: AppLogo's own). */
  logo: { a: string; b: string; accentColor: string; dots?: readonly { cx: number; cy: number; r: number }[]; stroke?: (size: number) => number };
}

export const APPS: AppDef[] = [
  {
    id: "diaframma",
    name: "Diaframma",
    role: "Sound",
    about: "Plays the sound of a show: music and effects on cue, with entrances, exits, loops and a launchpad.",
    soon: false,
    canCreate: true,
    accent: { dark: "#8e80ff", light: "#5442e0" },
    logo: {
      a: "M20 34V38M25 32V40M30 29V43M35 31V41M40 26V46M45 23V49M50 27V45M55 30V42M60 28V44M65 31V41M70 33V39M75 32V40M80 34V38",
      b: "M20 64V68M25 63V69M30 61V71M35 62V70M40 60V72M45 58V74M50 60V72M55 56V76M60 54V78M65 59V73M70 61V71M75 63V69M80 64V68",
      accentColor: "#6b5bef",
    },
  },
  {
    id: "bardo",
    name: "Bardo",
    role: "Scripts",
    about: "Writes and keeps the script: scenes, characters and lines, with export to PDF and Word.",
    soon: false,
    canCreate: true,
    // Copper, as in the app itself (02_design.md). Same drawing as the app icon: character names in copper, lines in ink.
    accent: { dark: "#f2955e", light: "#a9501f" },
    logo: { a: "M18 28H31M18 50H29M18 72H33", b: "M41 28H82M41 36H66M41 50H82M41 58H74M41 72H78", accentColor: "#c8642c" },
  },
  {
    id: "cantinella",
    name: "Cantinella",
    role: "Production",
    about: "Organises the production: rehearsals and availability, budget, departments and contacts, tour.",
    soon: false,
    canCreate: true,
    // Slate (ardesia), as in the app (02_design.md). Same drawing as the app icon: frame in ink, braces in slate.
    accent: { dark: "#a9b6cf", light: "#3f4c66" },
    logo: { a: "M35 45L65 21M35 79L65 55", b: "M30 16H70V84H30ZM30 50H70", accentColor: "#55627e" },
  },
  {
    id: "luci",
    name: "Luci",
    role: "Lighting desk",
    about: "The lighting desk: scenes and cues for the lights. Still being designed.",
    soon: true,
    canCreate: false,
    // Gelatina (magenta), as Granvelo itself (02_design.md). Same drawing as the app icon "Banco", thick stroke.
    accent: { dark: "#f06fcf", light: "#a3218a" },
    logo: { a: GRANVELO_LOGO.accent, b: GRANVELO_LOGO.ink, accentColor: "#c2349f", stroke: GRANVELO_LOGO.stroke },
  },
  {
    id: "cue",
    name: "Cue",
    role: "Show control",
    about: "The digital prompt book: GO on the script, lights, sound and projections live.",
    soon: false,
    canCreate: true,
    // Gesso (chalk), as in the app (docs/cue/13_cue.md). Same drawing as the app icon "Filo": a dot, a line and the GO button.
    accent: { dark: "#e2ded4", light: "#4b4840" },
    logo: { a: CUE_LOGO.accent, b: CUE_LOGO.ink, accentColor: "#77726a", dots: CUE_LOGO.dots, stroke: CUE_LOGO.stroke },
  },
];

export const appDef = (id: string): AppDef | undefined => APPS.find((a) => a.id === id);
