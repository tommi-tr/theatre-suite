import { uid } from "@theatre-suite/core";

/* Tour (section 4): venues, one technical sheet of the show, travel, gear, summary. */

export type VenueState = "contact" | "proposal" | "confirmed" | "done";
export const VENUE_STATES: VenueState[] = ["contact", "proposal", "confirmed", "done"];
/** fee = cachet; takings = the company keeps the takings; split = percentage with a guaranteed minimum; rent = the company rents the theatre. */
export type Deal = "fee" | "takings" | "split" | "rent";
export const DEALS: Deal[] = ["fee", "takings", "split", "rent"];

export type Have = "yes" | "no" | "bring";

export interface TechSheet {
  /** Stage size in centimetres (0 = not given). */
  width: number;
  depth: number;
  height: number;
  setupMinutes: number;
  strikeMinutes: number;
  crew: number;
  /** What the show needs, one line each ("12 PC 1 kW", "mixer 8 canali"). */
  needs: Array<{ id: string; text: string }>;
  notes: string;
}

/** The day at the venue, local times `HH:MM` (empty = not set). */
export interface DaySchedule {
  depart: string;
  arrive: string;
  setup: string;
  check: string;
  doors: string;
  show: string;
  strike: string;
  back: string;
}
export const SCHEDULE_KEYS: Array<keyof DaySchedule> = ["depart", "arrive", "setup", "check", "doors", "show", "strike", "back"];

export interface Trip {
  id: string;
  vehicle: string;
  people: string[];
  km: number;
  /** Cents. */
  fuel: number;
  tolls: number;
}

export interface Venue {
  id: string;
  theatre: string;
  city: string;
  address: string;
  day: string;
  contactId: string;
  contact: string;
  state: VenueState;
  deal: Deal;
  /** Fee, guarantee or rent, in cents. */
  amount: number;
  /** Percentage of the takings for `split`, hundredths of a percent. */
  percent: number;
  /** The host theatre: its stage and what it has of the show's needs. */
  hostWidth: number;
  hostDepth: number;
  hostHeight: number;
  has: Record<string, Have>;
  schedule: DaySchedule;
  trips: Trip[];
  rooms: number;
  /** Cost of a room for the night, cents. */
  roomCost: number;
  /** Gear ticks: item id → loaded / unloaded back. */
  gear: Record<string, { out: boolean; back: boolean }>;
  /** After the date. */
  takings: number;
  audience: number;
  siae: string;
  notes: string;
}

export type GearGroup = "set" | "costumes" | "props" | "tech";
export const GEAR_GROUPS: GearGroup[] = ["set", "costumes", "props", "tech"];

export interface GearItem {
  id: string;
  name: string;
  group: GearGroup;
  qty: number;
}

export interface Tour {
  venues: Venue[];
  sheet: TechSheet;
  gear: GearItem[];
}

export const emptySchedule = (): DaySchedule => ({ depart: "", arrive: "", setup: "", check: "", doors: "", show: "21:00", strike: "", back: "" });

export function newSheet(): TechSheet {
  return { width: 0, depth: 0, height: 0, setupMinutes: 240, strikeMinutes: 90, crew: 2, needs: [], notes: "" };
}

export function newTour(): Tour {
  return { venues: [], sheet: newSheet(), gear: [] };
}

export function newVenue(partial: Partial<Venue> = {}): Venue {
  return {
    id: uid(),
    theatre: "",
    city: "",
    address: "",
    day: "",
    contactId: "",
    contact: "",
    state: "contact",
    deal: "fee",
    amount: 0,
    percent: 0,
    hostWidth: 0,
    hostDepth: 0,
    hostHeight: 0,
    has: {},
    schedule: emptySchedule(),
    trips: [],
    rooms: 0,
    roomCost: 0,
    gear: {},
    takings: 0,
    audience: 0,
    siae: "",
    notes: "",
    ...partial,
  };
}

/* ---------------- Reading (format 1) ---------------- */

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, min: number, max: number, def: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => x as Record<string, unknown>) : []);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CENTS = 1_000_000_000_00;

export function normalizeTour(raw: unknown, personIds: Set<string>): Tour {
  const r = obj(raw);
  const out = newTour();
  const seen = new Set<string>();
  const id = (v: unknown) => {
    const s = str(v, 100);
    const x = s && !seen.has(s) ? s : uid();
    seen.add(x);
    return x;
  };
  const sh = obj(r.sheet);
  out.sheet = {
    width: int(sh.width, 0, 10000, 0),
    depth: int(sh.depth, 0, 10000, 0),
    height: int(sh.height, 0, 10000, 0),
    setupMinutes: int(sh.setupMinutes, 0, 2880, 240),
    strikeMinutes: int(sh.strikeMinutes, 0, 2880, 90),
    crew: int(sh.crew, 0, 99, 2),
    needs: list(sh.needs)
      .filter((n) => str(n.text, 300).trim())
      .map((n) => ({ id: id(n.id), text: str(n.text, 300).trim() })),
    notes: str(sh.notes, 20000),
  };
  const needIds = new Set(out.sheet.needs.map((n) => n.id));
  for (const g of list(r.gear)) {
    const name = str(g.name).trim();
    if (!name) continue;
    out.gear.push({ id: id(g.id), name, group: (["set", "costumes", "props", "tech"] as const).includes(g.group as GearGroup) ? (g.group as GearGroup) : "set", qty: int(g.qty, 1, 9999, 1) });
  }
  const gearIds = new Set(out.gear.map((g) => g.id));
  for (const v of list(r.venues)) {
    const sched = obj(v.schedule);
    const schedule = emptySchedule();
    for (const k of SCHEDULE_KEYS) schedule[k] = TIME_RE.test(str(sched[k], 5)) ? str(sched[k], 5) : k === "show" && sched[k] === undefined ? "21:00" : "";
    const has: Record<string, Have> = {};
    for (const [k, x] of Object.entries(obj(v.has))) if (needIds.has(k) && (x === "yes" || x === "no" || x === "bring")) has[k] = x;
    const gear: Venue["gear"] = {};
    for (const [k, x] of Object.entries(obj(v.gear))) if (gearIds.has(k)) gear[k] = { out: obj(x).out === true, back: obj(x).back === true };
    out.venues.push({
      id: id(v.id),
      theatre: str(v.theatre).trim(),
      city: str(v.city).trim(),
      address: str(v.address, 400).trim(),
      day: DAY_RE.test(str(v.day, 10)) ? str(v.day, 10) : "",
      contactId: personIds.has(str(v.contactId, 100)) ? str(v.contactId, 100) : "",
      contact: str(v.contact, 400).trim(),
      state: VENUE_STATES.includes(v.state as VenueState) ? (v.state as VenueState) : "contact",
      deal: DEALS.includes(v.deal as Deal) ? (v.deal as Deal) : "fee",
      amount: int(v.amount, 0, CENTS, 0),
      percent: int(v.percent, 0, 10000, 0),
      hostWidth: int(v.hostWidth, 0, 10000, 0),
      hostDepth: int(v.hostDepth, 0, 10000, 0),
      hostHeight: int(v.hostHeight, 0, 10000, 0),
      has,
      schedule,
      trips: list(v.trips).map((tr) => ({
        id: id(tr.id),
        vehicle: str(tr.vehicle).trim(),
        people: (Array.isArray(tr.people) ? tr.people : []).filter((p): p is string => typeof p === "string" && personIds.has(p)),
        km: int(tr.km, 0, 100000, 0),
        fuel: int(tr.fuel, 0, CENTS, 0),
        tolls: int(tr.tolls, 0, CENTS, 0),
      })),
      rooms: int(v.rooms, 0, 999, 0),
      roomCost: int(v.roomCost, 0, CENTS, 0),
      gear,
      takings: int(v.takings, 0, CENTS, 0),
      audience: int(v.audience, 0, 1_000_000, 0),
      siae: str(v.siae, 2000),
      notes: str(v.notes, 20000),
    });
  }
  return out;
}

/* ---------------- Money and checks ---------------- */

/** Travel and lodging of a date, in cents. */
export function venueCosts(v: Venue): number {
  return v.trips.reduce((a, t) => a + t.fuel + t.tolls, 0) + v.rooms * v.roomCost;
}

/**
 * What the date brings to the company, in cents. Before the date (no takings yet) only what is
 * certain: the fee or the guarantee. Rent is what the company pays to the theatre: takings − rent.
 */
export function venueIncome(v: Venue): number {
  const pct = Math.round((v.takings * v.percent) / 10000);
  switch (v.deal) {
    case "fee":
      return v.amount;
    case "takings":
      return v.takings;
    case "split":
      return Math.max(v.amount, pct);
    case "rent":
      return v.takings - v.amount;
  }
}

export interface TourSummary {
  confirmed: number;
  done: number;
  income: number;
  costs: number;
  balance: number;
  km: number;
}

/** Totals of the dates that are confirmed or done. */
export function tourSummary(t: Tour): TourSummary {
  const s: TourSummary = { confirmed: 0, done: 0, income: 0, costs: 0, balance: 0, km: 0 };
  for (const v of t.venues) {
    if (v.state !== "confirmed" && v.state !== "done") continue;
    if (v.state === "done") s.done += 1;
    else s.confirmed += 1;
    s.income += venueIncome(v);
    s.costs += venueCosts(v);
    s.km += v.trips.reduce((a, x) => a + x.km, 0);
  }
  s.balance = s.income - s.costs;
  return s;
}

/** Travel and lodging of the confirmed and done dates: they go into the Budget. */
export const tourCosts = (t: Tour) => t.venues.filter((v) => v.state === "confirmed" || v.state === "done").reduce((a, v) => a + venueCosts(v), 0);

export interface SheetCheck {
  /** Stage sizes that are smaller than needed: [what, needed, there]. */
  stage: Array<["width" | "depth" | "height", number, number]>;
  /** Needs the theatre does not have (to bring, or missing). */
  bring: string[];
  missing: string[];
  /** Needs not checked yet. */
  unknown: string[];
}

export function checkSheet(sheet: TechSheet, v: Venue): SheetCheck {
  const stage: SheetCheck["stage"] = [];
  const pairs: Array<["width" | "depth" | "height", number, number]> = [
    ["width", sheet.width, v.hostWidth],
    ["depth", sheet.depth, v.hostDepth],
    ["height", sheet.height, v.hostHeight],
  ];
  for (const [k, need, there] of pairs) if (need && there && there < need) stage.push([k, need, there]);
  const bring: string[] = [];
  const missing: string[] = [];
  const unknown: string[] = [];
  for (const n of sheet.needs) {
    const h = v.has[n.id];
    if (h === "bring") bring.push(n.text);
    else if (h === "no") missing.push(n.text);
    else if (!h) unknown.push(n.text);
  }
  return { stage, bring, missing, unknown };
}

/** "8,5 m" from centimetres. */
export const meters = (cm: number) => `${(cm / 100).toLocaleString("it-IT", { maximumFractionDigits: 2 })} m`;

const SCHEDULE_IT: Record<keyof DaySchedule, string> = {
  depart: "Partenza",
  arrive: "Arrivo",
  setup: "Montaggio",
  check: "Prova",
  doors: "Apertura porte",
  show: "Spettacolo",
  strike: "Smontaggio",
  back: "Rientro",
};

/** The call sheet of the day, to copy for the company. Always in Italian. */
export function callSheet(v: Venue, names: (ids: string[]) => string, dayLabel: (d: string) => string): string {
  const lines = [`${v.theatre || "Teatro"}${v.city ? `, ${v.city}` : ""}${v.day ? ` — ${dayLabel(v.day)}` : ""}`];
  if (v.address) lines.push(v.address);
  lines.push("");
  for (const k of SCHEDULE_KEYS) if (v.schedule[k]) lines.push(`${v.schedule[k]}  ${SCHEDULE_IT[k]}`);
  if (v.trips.length) {
    lines.push("", "Viaggio:");
    for (const t of v.trips) lines.push(`- ${t.vehicle || "Mezzo"}: ${names(t.people) || "–"}`);
  }
  if (v.contact) lines.push("", `Referente: ${v.contact}`);
  return lines.join("\n");
}
