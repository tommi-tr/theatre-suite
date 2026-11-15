import { addDays, sortDates, weekdayOf } from "./rehearsals";
import { convened } from "./plan";
import type { IcsEvent } from "./ics";
import type { CantinellaData } from "./types";

/* The calendar (section 5): one read-only view of the dates of every section. Nothing is entered
 * here, so nothing is entered twice: rehearsals come from the plan, performances from the Budget,
 * tour days from Tour, deadlines from Departments. */

export type EventKind = "rehearsal" | "show" | "venue" | "due";

export interface CalEvent {
  id: string;
  kind: EventKind;
  day: string;
  /** `HH:MM` or empty for all-day things. */
  time: string;
  minutes: number;
  /** Italian text, as it is shown and exported. */
  title: string;
  detail: string;
  place: string;
  /** People concerned (convened, travelling, in charge); empty = everyone. */
  people: string[];
  overdue: boolean;
  /** Where to open it: section and part. */
  open: { section: "rehearsals" | "budget" | "tour" | "departments"; part: string; sel?: [string, string] };
}

export function calendarEvents(d: CantinellaData, today: string): CalEvent[] {
  const out: CalEvent[] = [];
  const r = d.rehearsals;
  const scenes = new Map(r.scenes.map((s) => [s.id, s]));
  for (const date of sortDates(r.dates)) {
    const items = r.plan.filter((p) => p.dateId === date.id);
    const who = items.length ? convened(items, r) : null;
    out.push({
      id: `r-${date.id}`,
      kind: "rehearsal",
      day: date.day,
      time: date.time,
      minutes: date.minutes,
      title: items.length ? `Prova: ${items.map((p) => scenes.get(p.sceneId)?.name ?? "").join(", ")}` : "Prova",
      detail: who ? `${who.required.length} convocati` : "",
      place: date.place,
      people: who ? [...who.required, ...who.optional] : [],
      overdue: false,
      open: { section: "rehearsals", part: "plan" },
    });
  }
  for (const p of d.budget.performances) {
    out.push({ id: `s-${p.id}`, kind: "show", day: p.day, time: p.time, minutes: 120, title: p.label ? `Spettacolo · ${p.label}` : "Spettacolo", detail: "", place: "", people: [], overdue: false, open: { section: "budget", part: "seats", sel: ["perf", p.id] } });
  }
  for (const v of d.tour.venues) {
    if (!v.day || (v.state !== "confirmed" && v.state !== "done")) continue;
    const time = v.schedule.depart || v.schedule.show;
    out.push({
      id: `v-${v.id}`,
      kind: "venue",
      day: v.day,
      time,
      minutes: 0,
      title: `Tournée: ${v.theatre}${v.city ? `, ${v.city}` : ""}`,
      detail: v.schedule.show ? `spettacolo ore ${v.schedule.show}` : "",
      place: v.address,
      people: [...new Set(v.trips.flatMap((x) => x.people))],
      overdue: false,
      open: { section: "tour", part: "venues", sel: ["venue", v.id] },
    });
  }
  for (const dept of d.departments.list)
    for (const t of dept.todos) {
      if (!t.due || t.done) continue;
      const overdue = t.due < today;
      out.push({
        id: `t-${t.id}`,
        kind: "due",
        day: t.due,
        time: "",
        minutes: 0,
        title: `${overdue ? "Scaduta" : "Scade"} · ${t.text}`,
        detail: dept.name,
        place: "",
        people: [t.personId || dept.ownerId].filter(Boolean),
        overdue,
        open: { section: "departments", part: "departments", sel: ["dept", dept.id] },
      });
    }
  const order: Record<EventKind, number> = { due: 0, venue: 1, rehearsal: 2, show: 3 };
  return out.sort((a, b) => a.day.localeCompare(b.day) || (a.time || "00:00").localeCompare(b.time || "00:00") || order[a.kind] - order[b.kind]);
}

/** Only what concerns one person: things with them among the people, and things for everyone (performances). */
export function forPerson(events: CalEvent[], personId: string | null): CalEvent[] {
  if (!personId) return events;
  return events.filter((e) => e.people.includes(personId) || (e.people.length === 0 && e.kind === "show"));
}

/** The 6 × 7 days of the month grid (Monday first) for month `ym` (`YYYY-MM`). */
export function monthGrid(ym: string): string[] {
  const first = `${ym}-01`;
  const wd = (weekdayOf(first) + 6) % 7; // Monday = 0
  const start = addDays(first, -wd);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Monday of the week of `day`. */
export const weekStart = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));

export function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function toIcs(events: CalEvent[]): IcsEvent[] {
  return events.map((e) => ({ uid: e.id, day: e.day, time: e.time, minutes: e.minutes || 60, title: e.title, place: e.place, description: e.detail }));
}
