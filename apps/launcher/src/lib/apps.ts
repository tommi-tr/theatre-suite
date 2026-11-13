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
  logo: { a: string; b: string; accentColor: string };
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
    // Name not chosen yet: "Produzione" is a placeholder.
    id: "produzione",
    name: "Produzione",
    role: "Production and logistics",
    about: "For the production and logistics of the show. Still being designed.",
    soon: true,
    canCreate: false,
    accent: { dark: "#d2b48c", light: "#8a6a2a" },
    // A calendar: days in sand, frame in ink.
    logo: { a: "M33 52H41M50 52H58M67 52H71M33 66H41M50 66H58", b: "M22 26H78V80H22ZM22 40H78M36 18V30M64 18V30", accentColor: "#c48a12" },
  },
  {
    id: "luci",
    name: "Luci",
    role: "Lighting desk",
    about: "The lighting desk: scenes and cues for the lights. Still being designed.",
    soon: true,
    canCreate: false,
    accent: { dark: "#3fc1c9", light: "#0f7f87" },
    logo: { a: "M18 38H38M42 64H62M66 34H86", b: "M28 16V84M52 16V84M76 16V84", accentColor: "#0f9fa8" },
  },
];

export const appDef = (id: string): AppDef | undefined => APPS.find((a) => a.id === id);
