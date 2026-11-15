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

const soon = (id: PartId, label: string, arrives: string, ...about: string[]): PartDef => ({ id, label, arrives, about });

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
      soon("costs", "Costs", "0.4", "Costs and quotes: fixed, per performance, per seat, a percentage of the takings.", "Net and gross with VAT, from estimate to paid."),
      soon("seats", "Theatre and seats", "0.5", "Sectors, prices and a seat map drawn by itself, one per performance."),
      soon("breakeven", "Break-even", "0.5", "How many tickets you need to break even, and what a full or half-empty house brings in.", "Scenarios side by side."),
    ],
  },
  {
    id: "departments",
    label: "Departments and contacts",
    short: "Departments",
    icon: "trafficLight",
    parts: [
      soon(
        "departments",
        "Departments",
        "0.6",
        "Every department with its light (all right, in progress, blocked), its person in charge and the things to do.",
        "What is due this week and what is overdue, inside the app.",
      ),
      { id: "people", label: "Contacts", arrives: null, about: [] },
      soon("reports", "Rehearsal reports", "0.6", "After a rehearsal, notes by department that can become things to do."),
    ],
  },
  {
    id: "tour",
    label: "Tour",
    short: "Tour",
    icon: "truck",
    parts: [
      soon("venues", "Venues", "0.8", "Every date of the tour: theatre, contact, state of the negotiation, fee."),
      soon("techSheet", "Technical sheet", "0.8", "One technical sheet of the show, compared with the sheet of each theatre."),
      soon("travel", "Travel", "0.8", "Who travels how, kilometres, costs and rooms; the costs go into the Budget."),
      soon("gear", "Gear", "0.8", "Load list with ticks for loading and unloading."),
      soon("summary", "Summary", "0.8", "Confirmed dates, fees, costs and balance of the tour."),
    ],
  },
  {
    id: "calendar",
    label: "Calendar",
    short: "Calendar",
    icon: "calendar",
    parts: [
      soon("month", "Month", "0.7", "Rehearsals, performances, tour days and deadlines in one calendar.", "Filter by person and export to your phone's calendar (.ics)."),
      soon("week", "Week", "0.7", "The week at a glance, by day and time."),
      soon("list", "List", "0.7", "Everything that is coming, in order."),
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
