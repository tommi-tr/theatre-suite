import type { IconName } from "@theatre-suite/ui";
import type { SectionId } from "../model/types";

/** Parts of every section, in the order of the column on the left (09_cantinella.md, Design). */
export type PartId =
  | "dates"
  | "availability"
  | "scenes"
  | "plan"
  | "costs"
  | "seats"
  | "breakeven"
  | "departments"
  | "people"
  | "reports"
  | "venues"
  | "techSheet"
  | "travel"
  | "gear"
  | "summary"
  | "month"
  | "week"
  | "list";

export interface PartDef {
  id: PartId;
  /** English text, translated by the dictionary. */
  label: string;
  /** Version that brings this part; null = available now. */
  arrives: string | null;
  /** What the part will do (English, translated). */
  about: string[];
}

export interface SectionDef {
  id: SectionId;
  label: string;
  /** Short label for narrow windows. */
  short: string;
  icon: IconName;
  parts: PartDef[];
}


export const SECTIONS: SectionDef[] = [
  {
    id: "rehearsals",
    label: "Rehearsals",
    short: "Rehearsals",
    icon: "users",
    parts: [
      { id: "dates", label: "Dates", arrives: null, about: [] },
      { id: "availability", label: "Availability", arrives: null, about: [] },
      { id: "scenes", label: "Scenes and roles", arrives: null, about: [] },
      { id: "plan", label: "Plan", arrives: null, about: [] },
    ],
  },
  {
    id: "budget",
    label: "Budget",
    short: "Budget",
    icon: "euro",
    parts: [
      { id: "costs", label: "Costs", arrives: null, about: [] },
      { id: "seats", label: "Theatre and seats", arrives: null, about: [] },
      { id: "breakeven", label: "Break-even", arrives: null, about: [] },
    ],
  },
  {
    id: "departments",
    label: "Departments and contacts",
    short: "Departments",
    icon: "trafficLight",
    parts: [
      { id: "departments", label: "Departments", arrives: null, about: [] },
      { id: "people", label: "Contacts", arrives: null, about: [] },
      { id: "reports", label: "Rehearsal reports", arrives: null, about: [] },
    ],
  },
  {
    id: "tour",
    label: "Tour",
    short: "Tour",
    icon: "truck",
    parts: [
      { id: "venues", label: "Venues", arrives: null, about: [] },
      { id: "techSheet", label: "Technical sheet", arrives: null, about: [] },
      { id: "travel", label: "Travel", arrives: null, about: [] },
      { id: "gear", label: "Gear", arrives: null, about: [] },
      { id: "summary", label: "Summary", arrives: null, about: [] },
    ],
  },
  {
    id: "calendar",
    label: "Calendar",
    short: "Calendar",
    icon: "calendar",
    parts: [
      { id: "month", label: "Month", arrives: null, about: [] },
      { id: "week", label: "Week", arrives: null, about: [] },
      { id: "list", label: "List", arrives: null, about: [] },
    ],
  },
];

export const DEFAULT_PARTS: Record<SectionId, PartId> = {
  rehearsals: "dates",
  budget: "costs",
  departments: "people",
  tour: "venues",
  calendar: "month",
};

export const sectionDef = (id: SectionId): SectionDef => SECTIONS.find((s) => s.id === id)!;
export const partDef = (section: SectionId, part: PartId): PartDef =>
  sectionDef(section).parts.find((p) => p.id === part) ?? sectionDef(section).parts[0];
