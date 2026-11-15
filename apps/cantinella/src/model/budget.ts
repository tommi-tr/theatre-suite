import { uid } from "@theatre-suite/core";

/* Budget (section 2): costs, the theatre with its sectors and seats, break-even and scenarios.
 * Money is always in whole cents. Costs are compared with the takings in gross terms: what you
 * pay and what the audience pays. */

export type CostKind = "fixed" | "perShow" | "perSeat" | "percent" | "mixed";
export type CostState = "estimate" | "quote" | "confirmed" | "paid";
export const COST_STATES: CostState[] = ["estimate", "quote", "confirmed", "paid"];
export const VAT_RATES = [22, 10, 4, 0] as const;

export interface Cost {
  id: string;
  name: string;
  /** Preset key (`siae`, `rent`…) or free text. */
  category: string;
  supplier: string;
  kind: CostKind;
  /** The amount typed (cents): fixed, per performance, per spectator, or the minimum of a mixed cost. */
  amount: number;
  /** Which of net / gross was typed: that one is "true". */
  entered: "net" | "gross";
  /** VAT in percent (0 = exempt or not applicable). */
  vat: number;
  /** Percentage of the takings, in hundredths of a percent (1000 = 10%). */
  percent: number;
  /** Mixed costs: fixed + percentage, or the larger of the two. */
  mix: "plus" | "max";
  /** Per-spectator costs: only these sectors (empty = all). */
  sectors: string[];
  state: CostState;
  /** Path of a file or a web address of the quote. */
  link: string;
  notes: string;
}

/** Price of a sector relative to the base price. */
export interface PriceRule {
  mode: "base" | "percent" | "minus" | "fixed";
  /** percent: hundredths of a percent off; minus/fixed: cents. */
  value: number;
}

export interface Sector {
  id: string;
  name: string;
  /** Rows × seats per row; with 0 rows only `seats` counts and there is no map. */
  rows: number;
  perRow: number;
  seats: number;
  level: "stalls" | "upper";
  price: PriceRule;
}

/** A reduced ticket and the share of the audience expected to use it (hundredths of a percent). */
export interface Reduction {
  id: string;
  name: string;
  rule: PriceRule;
  share: number;
}

export interface Performance {
  id: string;
  day: string;
  time: string;
  label: string;
}

export type SeatState = "sold" | "reserved" | "comp" | "blocked" | "limited";
export const SEAT_STATES: SeatState[] = ["sold", "reserved", "comp", "blocked", "limited"];

export interface Scenario {
  id: string;
  name: string;
  /** Fill per sector, in percent (0–100); missing sectors use `fill`. */
  sectorFill: Record<string, number>;
  fill: number;
}

export interface Budget {
  costs: Cost[];
  /** Base ticket price (cents). */
  basePrice: number;
  sectors: Sector[];
  reductions: Reduction[];
  performances: Performance[];
  /**
   * Seat states: key = performance id, or `all` for what is the same every night (blocked seats,
   * reduced view); value = seat key (`sectorId:row:seat`) → state.
   */
  seats: Record<string, Record<string, SeatState>>;
  scenarios: Scenario[];
  /** How many performances, when they are not listed one by one. */
  showCount: number;
}

export const PRESET_CATEGORIES = [
  "siae",
  "rights",
  "actors",
  "crew",
  "direction",
  "rent",
  "service",
  "set",
  "costumes",
  "promo",
  "transport",
  "lodging",
  "insurance",
  "contributions",
  "contingency",
  "tour",
] as const;

export function newBudget(): Budget {
  return { costs: [], basePrice: 0, sectors: [], reductions: [], performances: [], seats: {}, scenarios: defaultScenarios(), showCount: 1 };
}

export function defaultScenarios(): Scenario[] {
  return [
    { id: "pessimistic", name: "Pessimista", sectorFill: {}, fill: 40 },
    { id: "realistic", name: "Realistico", sectorFill: {}, fill: 65 },
    { id: "full", name: "Pieno", sectorFill: {}, fill: 95 },
  ];
}

export function newCost(partial: Partial<Cost> = {}): Cost {
  return { id: uid(), name: "", category: "", supplier: "", kind: "fixed", amount: 0, entered: "gross", vat: 22, percent: 0, mix: "max", sectors: [], state: "estimate", link: "", notes: "", ...partial };
}

/** The suggested items, as estimates without an amount (deletable). Category key → Italian name. */
export const SUGGESTED: Array<[string, string, Partial<Cost>]> = [
  ["siae", "SIAE", { kind: "mixed", mix: "max", percent: 1000, vat: 22 }],
  ["rights", "Diritti d'autore", { kind: "percent", percent: 1000, vat: 0 }],
  ["actors", "Attori", { kind: "perShow", vat: 0 }],
  ["crew", "Maestranze e tecnici", { kind: "perShow", vat: 0 }],
  ["direction", "Regia", { vat: 0 }],
  ["rent", "Affitto del teatro", { kind: "perShow" }],
  ["service", "Service audio e luci", { kind: "perShow" }],
  ["set", "Scenografie", {}],
  ["costumes", "Costumi", {}],
  ["promo", "Pubblicità e stampa", {}],
  ["transport", "Trasporti", { kind: "perShow" }],
  ["lodging", "Alloggi", { kind: "perShow", vat: 10 }],
  ["insurance", "Assicurazione", { vat: 0 }],
  ["contributions", "Agibilità e contributi", { kind: "perShow", vat: 0 }],
  ["contingency", "Imprevisti", { vat: 0 }],
];

export function suggestedCosts(): Cost[] {
  return SUGGESTED.map(([category, name, p]) => newCost({ category, name, ...p }));
}

/* ---------------- Reading (format 1) ---------------- */

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, min: number, max: number, def: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
const MAX_CENTS = 1_000_000_000_00;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => x as Record<string, unknown>) : []);
const oneOf = <T extends string>(v: unknown, all: readonly T[], def: T): T => (all.includes(v as T) ? (v as T) : def);

function ids() {
  const seen = new Set<string>();
  return (v: unknown) => {
    const s = str(v, 100);
    const id = s && !seen.has(s) ? s : uid();
    seen.add(id);
    return id;
  };
}

function normalizeRule(v: unknown): PriceRule {
  const r = obj(v);
  const mode = oneOf(r.mode, ["base", "percent", "minus", "fixed"] as const, "base");
  return { mode, value: mode === "percent" ? int(r.value, 0, 10000, 0) : int(r.value, 0, MAX_CENTS, 0) };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeBudget(raw: unknown): Budget {
  const r = obj(raw);
  const b = newBudget();
  const id = ids();
  b.basePrice = int(r.basePrice, 0, MAX_CENTS, 0);
  b.showCount = int(r.showCount, 1, 500, 1);
  for (const s of list(r.sectors)) {
    const name = str(s.name).trim();
    if (!name) continue;
    b.sectors.push({ id: id(s.id), name, rows: int(s.rows, 0, 60, 0), perRow: int(s.perRow, 0, 80, 0), seats: int(s.seats, 0, 20000, 0), level: s.level === "upper" ? "upper" : "stalls", price: normalizeRule(s.price) });
  }
  const sectorIds = new Set(b.sectors.map((s) => s.id));
  for (const c of list(r.costs)) {
    const name = str(c.name).trim();
    if (!name) continue;
    b.costs.push({
      id: id(c.id),
      name,
      category: str(c.category, 100),
      supplier: str(c.supplier).trim(),
      kind: oneOf(c.kind, ["fixed", "perShow", "perSeat", "percent", "mixed"] as const, "fixed"),
      amount: int(c.amount, 0, MAX_CENTS, 0),
      entered: c.entered === "net" ? "net" : "gross",
      vat: int(c.vat, 0, 100, 22),
      percent: int(c.percent, 0, 10000, 0),
      mix: c.mix === "plus" ? "plus" : "max",
      sectors: (Array.isArray(c.sectors) ? c.sectors : []).filter((x): x is string => typeof x === "string" && sectorIds.has(x)),
      state: oneOf(c.state, COST_STATES, "estimate"),
      link: str(c.link, 2000).trim(),
      notes: str(c.notes, 5000),
    });
  }
  for (const x of list(r.reductions)) {
    const name = str(x.name).trim();
    if (name) b.reductions.push({ id: id(x.id), name, rule: normalizeRule(x.rule), share: int(x.share, 0, 10000, 0) });
  }
  for (const p of list(r.performances)) {
    const day = str(p.day, 10);
    if (!DAY_RE.test(day)) continue;
    const time = str(p.time, 5);
    b.performances.push({ id: id(p.id), day, time: TIME_RE.test(time) ? time : "21:00", label: str(p.label).trim() });
  }
  const perfIds = new Set(["all", ...b.performances.map((p) => p.id)]);
  const seatRe = /^([^:]+):(\d+):(\d+)$/;
  for (const [k, v] of Object.entries(obj(r.seats))) {
    if (!perfIds.has(k)) continue;
    const m: Record<string, SeatState> = {};
    for (const [seat, state] of Object.entries(obj(v))) {
      const x = seatRe.exec(seat);
      if (x && sectorIds.has(x[1]) && SEAT_STATES.includes(state as SeatState)) m[seat] = state as SeatState;
    }
    if (Object.keys(m).length) b.seats[k] = m;
  }
  if (Array.isArray(r.scenarios)) {
    b.scenarios = [];
    for (const s of list(r.scenarios)) {
      const name = str(s.name).trim();
      if (!name) continue;
      const fills: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj(s.sectorFill))) if (sectorIds.has(k)) fills[k] = int(v, 0, 100, 0);
      b.scenarios.push({ id: id(s.id), name, sectorFill: fills, fill: int(s.fill, 0, 100, 50) });
    }
  }
  return b;
}

/* ---------------- Amounts ---------------- */

export const grossOfCost = (c: Cost) => (c.entered === "gross" ? c.amount : Math.round((c.amount * (100 + c.vat)) / 100));
export const netOfCost = (c: Cost) => (c.entered === "net" ? c.amount : Math.round((c.amount * 100) / (100 + c.vat)));

/** Price of a sector (full ticket), in cents. */
export function sectorPrice(base: number, rule: PriceRule): number {
  switch (rule.mode) {
    case "percent":
      return Math.round((base * (10000 - rule.value)) / 10000);
    case "minus":
      return Math.max(0, base - rule.value);
    case "fixed":
      return rule.value;
    default:
      return base;
  }
}

export const capacityOf = (s: Sector) => (s.rows > 0 ? s.rows * s.perRow : s.seats);

/** Average ticket in a sector, counting the expected share of reduced tickets. */
export function averageTicket(b: Budget, s: Sector): number {
  const full = sectorPrice(b.basePrice, s.price);
  let shareLeft = 10000;
  let sum = 0;
  for (const r of b.reductions) {
    const share = Math.min(r.share, shareLeft);
    shareLeft -= share;
    sum += sectorPrice(full, r.rule) * share;
  }
  return Math.round((sum + full * shareLeft) / 10000);
}

/** Tickets sold, by sector, for one or more performances. */
export type Tickets = Record<string, number>;

export interface CostLine {
  cost: Cost;
  /** Gross total of the cost for the given performances and tickets. */
  total: number;
}

export interface Result {
  takings: number;
  costs: number;
  /** Takings − costs. */
  balance: number;
  lines: CostLine[];
  tickets: number;
}

/** What a cost amounts to for `shows` performances with these tickets and these takings. */
export function costTotal(c: Cost, shows: number, tickets: Tickets, takings: number): number {
  const unit = grossOfCost(c);
  const pct = Math.round((takings * c.percent) / 10000);
  switch (c.kind) {
    case "fixed":
      return unit;
    case "perShow":
      return unit * shows;
    case "perSeat": {
      const n = Object.entries(tickets).reduce((acc, [sid, t]) => acc + (c.sectors.length === 0 || c.sectors.includes(sid) ? t : 0), 0);
      return unit * n;
    }
    case "percent":
      return pct;
    case "mixed":
      return c.mix === "plus" ? unit + pct : Math.max(unit, pct);
  }
}

export function takingsOf(b: Budget, tickets: Tickets): number {
  return b.sectors.reduce((acc, s) => acc + (tickets[s.id] ?? 0) * averageTicket(b, s), 0);
}

export function evaluate(b: Budget, shows: number, tickets: Tickets): Result {
  const takings = takingsOf(b, tickets);
  const lines = b.costs.map((cost) => ({ cost, total: costTotal(cost, shows, tickets, takings) }));
  const costs = lines.reduce((a, l) => a + l.total, 0);
  return { takings, costs, balance: takings - costs, lines, tickets: Object.values(tickets).reduce((a, n) => a + n, 0) };
}

/** Tickets per sector for a total, spread in proportion to the seats (largest remainders). */
export function spread(b: Budget, total: number, shows: number): Tickets {
  const caps = b.sectors.map((s) => capacityOf(s) * shows);
  const all = caps.reduce((a, n) => a + n, 0);
  const out: Tickets = {};
  if (!all) return out;
  const raw = caps.map((c) => (total * c) / all);
  const base = raw.map(Math.floor);
  let left = total - base.reduce((a, n) => a + n, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, z) => z[0] - a[0] || a[1] - z[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    if (base[i] < caps[i]) {
      base[i] += 1;
      left -= 1;
    }
  }
  b.sectors.forEach((s, i) => (out[s.id] = base[i]));
  return out;
}

export interface BreakEven {
  /** Tickets needed in all; null = not even a full house is enough. */
  tickets: number | null;
  capacity: number;
  perShow: number | null;
  bySector: Tickets;
  /** Result with the tickets found (or with a full house when null). */
  result: Result;
}

/** The smallest number of tickets (spread over the sectors) for which takings cover the costs. */
export function breakEven(b: Budget, shows: number): BreakEven {
  const capacity = b.sectors.reduce((a, s) => a + capacityOf(s), 0) * shows;
  // Takings minus costs grows with the tickets as long as a ticket brings more than it costs:
  // binary search, then a short check on the neighbours for rounding.
  const ok = (n: number) => evaluate(b, shows, spread(b, n, shows)).balance >= 0;
  if (!capacity || !ok(capacity)) {
    const full = spread(b, capacity, shows);
    return { tickets: null, capacity, perShow: null, bySector: full, result: evaluate(b, shows, full) };
  }
  let lo = 0;
  let hi = capacity;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid;
    else lo = mid + 1;
  }
  const bySector = spread(b, lo, shows);
  return { tickets: lo, capacity, perShow: shows ? Math.ceil(lo / shows) : null, bySector, result: evaluate(b, shows, bySector) };
}

/** Tickets of a scenario: every sector filled at its percentage, for every performance. */
export function scenarioTickets(b: Budget, sc: Scenario, shows: number): Tickets {
  const out: Tickets = {};
  for (const s of b.sectors) out[s.id] = Math.round((capacityOf(s) * shows * (sc.sectorFill[s.id] ?? sc.fill)) / 100);
  return out;
}

/** Totals for the four boxes of Costs (gross). */
export function costSummary(b: Budget, shows: number) {
  let fixed = 0;
  let perShow = 0;
  let onTakings = 0;
  let minimums = 0;
  let paid = 0;
  for (const c of b.costs) {
    const g = grossOfCost(c);
    if (c.kind === "fixed") fixed += g;
    else if (c.kind === "perShow") perShow += g;
    else if (c.kind === "percent" || c.kind === "mixed" || c.kind === "perSeat") {
      onTakings += 1;
      if (c.kind === "mixed") minimums += g;
    }
    if (c.state === "paid") paid += c.kind === "perShow" ? g * shows : c.kind === "fixed" || c.kind === "mixed" ? g : 0;
  }
  return { fixed, perShow, onTakings, minimums, paid };
}

/** Totals by state and by category, for `shows` performances and an expected audience. */
export function costTotals(b: Budget, shows: number, tickets: Tickets) {
  const r = evaluate(b, shows, tickets);
  const byState: Record<CostState, number> = { estimate: 0, quote: 0, confirmed: 0, paid: 0 };
  const byCategory = new Map<string, number>();
  for (const l of r.lines) {
    byState[l.cost.state] += l.total;
    const k = l.cost.category || "";
    byCategory.set(k, (byCategory.get(k) ?? 0) + l.total);
  }
  return { byState, byCategory, total: r.costs };
}

/** Number of performances: the ones entered, otherwise the number written by hand. */
export const showsOf = (b: Budget) => (b.performances.length ? b.performances.length : Math.max(1, b.showCount));

/* ---------------- Seats ---------------- */

export const ROW_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const rowName = (i: number) => (i < 26 ? ROW_LETTERS[i] : `${ROW_LETTERS[Math.floor(i / 26) - 1]}${ROW_LETTERS[i % 26]}`);
export const seatKey = (sectorId: string, row: number, seat: number) => `${sectorId}:${row}:${seat}`;

/** State of a seat on a performance: its own state, otherwise the one that is the same every night. */
export function seatState(b: Budget, perfId: string | null, key: string): SeatState | null {
  return (perfId ? b.seats[perfId]?.[key] : undefined) ?? b.seats.all?.[key] ?? null;
}

/** Counts of the seat states of a performance (only sectors with a map). */
export function seatCounts(b: Budget, perfId: string | null): Record<SeatState | "free", number> {
  const out: Record<SeatState | "free", number> = { free: 0, sold: 0, reserved: 0, comp: 0, blocked: 0, limited: 0 };
  for (const s of b.sectors) {
    if (s.rows <= 0) continue;
    for (let r = 0; r < s.rows; r++)
      for (let n = 0; n < s.perRow; n++) {
        const st = seatState(b, perfId, seatKey(s.id, r, n));
        out[st ?? "free"] += 1;
      }
  }
  return out;
}

/** Tickets of a performance counted on the map (sold seats), by sector. */
export function soldBySector(b: Budget, perfId: string): Tickets {
  const out: Tickets = {};
  for (const [k, st] of Object.entries(b.seats[perfId] ?? {})) {
    if (st !== "sold") continue;
    const sid = k.split(":")[0];
    out[sid] = (out[sid] ?? 0) + 1;
  }
  return out;
}
