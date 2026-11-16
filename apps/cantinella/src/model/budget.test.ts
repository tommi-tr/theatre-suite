import { describe, expect, it } from "vitest";
import { formatCents, grossOf, netOf, parseCents } from "@theatre-suite/ui";
import {
  averageTicket,
  breakEven,
  capacityOf,
  costTotal,
  evaluate,
  grossOfCost,
  netOfCost,
  newBudget,
  newCost,
  normalizeBudget,
  scenarioTickets,
  seatCounts,
  sectorPrice,
  soldBySector,
  spread,
  type Budget,
} from "./budget";

describe("money", () => {
  it("reads amounts written in the usual ways", () => {
    expect(parseCents("1.234,56")).toBe(123456);
    expect(parseCents("1234,5")).toBe(123450);
    expect(parseCents("1234.56")).toBe(123456);
    expect(parseCents("€ 12")).toBe(1200);
    expect(parseCents("12 €")).toBe(1200);
    expect(parseCents("1.500")).toBe(150000);
    expect(parseCents("0,05")).toBe(5);
    expect(parseCents("-3")).toBe(-300);
    expect(parseCents("dodici")).toBeNull();
    expect(parseCents("")).toBeNull();
  });

  it("writes amounts in Italian", () => {
    expect(formatCents(123456)).toBe("1.234,56");
    expect(formatCents(5)).toBe("0,05");
    expect(formatCents(150000, { decimals: false })).toBe("1.500");
    expect(formatCents(-1999)).toBe("−19,99");
  });

  it("goes from net to gross and back with the VAT rate", () => {
    expect(grossOf(10000, 22)).toBe(12200);
    expect(netOf(12200, 22)).toBe(10000);
    expect(netOf(10000, 22)).toBe(8197);
    const c = newCost({ amount: 12200, entered: "gross", vat: 22 });
    expect(netOfCost(c)).toBe(10000);
    expect(grossOfCost({ ...c, vat: 10 })).toBe(12200); // the typed amount never changes
    expect(grossOfCost({ ...c, entered: "net", amount: 10000, vat: 4 })).toBe(10400);
  });
});

function theatre(): Budget {
  const b = newBudget();
  b.basePrice = 2000;
  b.sectors = [
    { id: "pl", name: "Platea", rows: 10, perRow: 20, seats: 0, level: "stalls", price: { mode: "base", value: 0 } },
    { id: "ga", name: "Galleria", rows: 0, perRow: 0, seats: 100, level: "upper", price: { mode: "percent", value: 2500 } },
  ];
  return b;
}

describe("prices and seats", () => {
  it("computes the price of a sector from the base", () => {
    expect(sectorPrice(2000, { mode: "percent", value: 1500 })).toBe(1700);
    expect(sectorPrice(2000, { mode: "minus", value: 500 })).toBe(1500);
    expect(sectorPrice(2000, { mode: "minus", value: 5000 })).toBe(0);
    expect(sectorPrice(2000, { mode: "fixed", value: 800 })).toBe(800);
    expect(capacityOf(theatre().sectors[0])).toBe(200);
  });

  it("counts the expected share of reduced tickets in the average", () => {
    const b = theatre();
    b.reductions = [{ id: "u26", name: "Under 26", rule: { mode: "percent", value: 5000 }, share: 2000 }];
    // 80% at 20 € and 20% at 10 € → 18 €.
    expect(averageTicket(b, b.sectors[0])).toBe(1800);
  });

  it("spreads tickets over the sectors in proportion to the seats, never more than there are", () => {
    const b = theatre();
    expect(spread(b, 30, 1)).toEqual({ pl: 20, ga: 10 });
    expect(spread(b, 300, 1)).toEqual({ pl: 200, ga: 100 });
    expect(spread(b, 31, 1)).toEqual({ pl: 21, ga: 10 });
  });

  it("counts seat states per performance, with the ones that are the same every night", () => {
    const b = theatre();
    b.performances = [{ id: "r1", day: "2026-12-01", time: "21:00", label: "" }];
    b.seats = { all: { "pl:0:0": "blocked", "pl:0:1": "blocked" }, r1: { "pl:1:0": "sold", "pl:1:1": "sold", "pl:1:2": "comp" } };
    const c = seatCounts(b, "r1");
    expect(c).toMatchObject({ blocked: 2, sold: 2, comp: 1, free: 195 });
    expect(soldBySector(b, "r1")).toEqual({ pl: 2 });
  });
});

describe("costs", () => {
  it("adds every kind of cost the right way", () => {
    const tickets = { pl: 100, ga: 50 };
    const takings = 100000;
    const g = (p: Partial<ReturnType<typeof newCost>>) => costTotal(newCost({ amount: 1000, vat: 0, ...p }), 3, tickets, takings);
    expect(g({ kind: "fixed" })).toBe(1000);
    expect(g({ kind: "perShow" })).toBe(3000);
    expect(g({ kind: "perSeat" })).toBe(150000);
    expect(g({ kind: "perSeat", sectors: ["pl"] })).toBe(100000);
    expect(g({ kind: "percent", percent: 1000 })).toBe(10000);
    expect(g({ kind: "mixed", mix: "max", amount: 15000, percent: 1000 })).toBe(15000);
    expect(g({ kind: "mixed", mix: "max", amount: 5000, percent: 1000 })).toBe(10000);
    expect(g({ kind: "mixed", mix: "plus", amount: 5000, percent: 1000 })).toBe(15000);
  });
});

describe("break-even", () => {
  it("finds the fewest tickets that cover the costs, including the percentages", () => {
    const b = theatre();
    b.sectors = [b.sectors[0]];
    b.costs = [newCost({ kind: "fixed", amount: 90000, vat: 0 }), newCost({ kind: "percent", percent: 1000, vat: 0 })];
    // 900 € of fixed costs, 10% of every 20 € ticket → 18 € left each → 50 tickets.
    const be = breakEven(b, 1);
    expect(be.tickets).toBe(50);
    expect(be.result.balance).toBeGreaterThanOrEqual(0);
    expect(evaluate(b, 1, { pl: 49 }).balance).toBeLessThan(0);
  });

  it("handles the larger of a minimum and a percentage", () => {
    const b = theatre();
    b.sectors = [b.sectors[0]];
    b.costs = [newCost({ kind: "mixed", mix: "max", amount: 15000, percent: 1000, vat: 0 })];
    // Under 75 tickets the minimum (150 €) is larger than 10%: 8 tickets cover it.
    expect(breakEven(b, 1).tickets).toBe(8);
  });

  it("says when not even a full house is enough", () => {
    const b = theatre();
    b.costs = [newCost({ kind: "fixed", amount: 10_000_000, vat: 0 })];
    const be = breakEven(b, 2);
    expect(be.tickets).toBeNull();
    expect(be.capacity).toBe(600);
  });

  it("works per performance", () => {
    const b = theatre();
    b.sectors = [b.sectors[0]];
    b.costs = [newCost({ kind: "perShow", amount: 40000, vat: 0 })];
    expect(breakEven(b, 3)).toMatchObject({ tickets: 60, perShow: 20 });
  });

  it("fills a scenario sector by sector", () => {
    const b = theatre();
    const sc = { id: "s", name: "Pieno", fill: 50, sectorFill: { ga: 100 } };
    expect(scenarioTickets(b, sc, 2)).toEqual({ pl: 200, ga: 200 });
  });
});

describe("reading the budget", () => {
  it("repairs and drops what is wrong", () => {
    const b = normalizeBudget({
      basePrice: -5,
      sectors: [{ id: "a", name: "Platea", rows: 999, perRow: 10 }, { name: "" }],
      costs: [{ id: "c", name: "SIAE", kind: "weird", amount: 1.6, sectors: ["a", "ghost"], state: "paid" }, { name: " " }],
      seats: { all: { "a:0:0": "blocked", "ghost:0:0": "sold", "a:0:1": "stolen" }, ghost: { "a:0:2": "sold" } },
      scenarios: [{ name: "X", fill: 300, sectorFill: { a: 20, z: 3 } }],
    });
    expect(b.basePrice).toBe(0);
    expect(b.sectors).toHaveLength(1);
    expect(b.sectors[0].rows).toBe(60);
    expect(b.costs).toEqual([expect.objectContaining({ name: "SIAE", kind: "fixed", amount: 2, sectors: ["a"], state: "paid" })]);
    expect(b.seats).toEqual({ all: { "a:0:0": "blocked" } });
    expect(b.scenarios).toEqual([expect.objectContaining({ name: "X", fill: 100, sectorFill: { a: 20 } })]);
    expect(normalizeBudget(undefined).scenarios.map((s) => s.name)).toEqual(["Pessimista", "Realistico", "Pieno"]);
  });
});
