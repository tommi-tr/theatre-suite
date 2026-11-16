import type { TFunc } from "@theatre-suite/core";
import type { StepTone } from "@theatre-suite/ui";
import { uid } from "@theatre-suite/core";
import { newVenue, type Deal, type DaySchedule, type GearGroup, type Tour, type Venue, type VenueState } from "../model/tour";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

export const changeT = (fn: (t: Tour) => Tour, key?: string) => useDoc.getState().change((d) => ({ ...d, tour: fn(d.tour) }), key);
export const patchVenue = (id: string, patch: Partial<Venue>, key: string) => changeT((t) => ({ ...t, venues: t.venues.map((v) => (v.id === id ? { ...v, ...patch } : v)) }), `${id}.${key}`);

export const VENUE_STATE_LABELS: Record<VenueState, string> = { contact: "Contact", proposal: "Proposal", confirmed: "Confirmed", done: "Done" };
export const VENUE_TONES: StepTone[] = ["draft", "neutral", "info", "ok"];
export const VENUE_PILL: Record<VenueState, string> = { contact: "draft", proposal: "neutral", confirmed: "info", done: "ok" };
export const DEAL_LABELS: Record<Deal, string> = { fee: "Fee", takings: "Takings", split: "Percentage with guarantee", rent: "Theatre rent" };
export const SCHEDULE_LABELS: Record<keyof DaySchedule, string> = {
  depart: "Departure",
  arrive: "Arrival",
  setup: "Set-up",
  check: "Rehearsal",
  doors: "Doors open",
  show: "Show time",
  strike: "Strike",
  back: "Return",
};
export const GEAR_LABELS: Record<GearGroup, string> = { set: "Set", costumes: "Costumes", props: "Props", tech: "Technical" };

export function addVenue(t: TFunc) {
  const v = newVenue({ theatre: t("New venue") });
  changeT((x) => ({ ...x, venues: [...x.venues, v] }));
  useUi.getState().go("tour", "venues");
  useUi.getState().select("venue", v.id);
  requestAnimationFrame(() => document.getElementById("cn-venue-name")?.focus());
}

/** Venues by date (those without a date last). */
export const sortVenues = (vs: Venue[]) => [...vs].sort((a, b) => (a.day || "9999").localeCompare(b.day || "9999"));

/** The selected venue, or the next one to come, or the first. */
export function currentVenue(vs: Venue[], selId: string | null, today: string): Venue | null {
  return vs.find((v) => v.id === selId) ?? sortVenues(vs).find((v) => v.day >= today) ?? sortVenues(vs)[0] ?? null;
}

/** Centimetres ↔ the metres typed ("8,5"). */
export const cmToText = (cm: number) => (cm ? (cm / 100).toLocaleString("it-IT", { maximumFractionDigits: 2 }) : "");
export function textToCm(s: string): number | null {
  const v = Number(s.replace(",", ".").trim());
  return Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v * 100) : null;
}

export { uid };
