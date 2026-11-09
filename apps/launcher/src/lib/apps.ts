/** The apps of the suite as the interface shows them. A new app = a new row. */
export interface AppDef {
  id: string;
  name: string;
  /** Short English description of what it is for (translated in the dictionary). */
  role: string;
  /** Not released yet: shown as "coming soon". */
  soon: boolean;
  /** Can the launcher create an empty document for it? */
  canCreate: boolean;
  accent: { dark: string; light: string };
  logo: { a: string; b: string; accentColor: string };
}

const bars = (rows: Array<[number, number, number]>) => ({
  a: rows.map(([y, x1, x2]) => `M${x1} ${y}H${x2}`).join(""),
});

export const APPS: AppDef[] = [
  {
    id: "diaframma",
    name: "Diaframma",
    role: "Sound",
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
    soon: true,
    canCreate: false,
    accent: { dark: "#f07cc4", light: "#b02a7f" },
    logo: { a: bars([[30, 18, 30], [50, 18, 30], [70, 18, 30]]).a, b: "M40 30H82M40 50H74M40 70H78", accentColor: "#d9489f" },
  },
  {
    id: "regia",
    name: "Aiuto regia",
    role: "Rehearsals",
    soon: true,
    canCreate: false,
    accent: { dark: "#d2b48c", light: "#8a6a2a" },
    logo: { a: "M30 52L42 64L68 34", b: "M26 24H74V80H26ZM38 24V16H62V24", accentColor: "#c48a12" },
  },
  {
    id: "luci",
    name: "Luci",
    role: "Lighting desk",
    soon: true,
    canCreate: false,
    accent: { dark: "#3fc1c9", light: "#0f7f87" },
    logo: { a: "M18 38H38M42 64H62M66 34H86", b: "M28 16V84M52 16V84M76 16V84", accentColor: "#0f9fa8" },
  },
];

export const appDef = (id: string): AppDef | undefined => APPS.find((a) => a.id === id);
