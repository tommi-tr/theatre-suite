import { describe, expect, it } from "vitest";
import { calendarEvents, forPerson, monthGrid, shiftMonth, weekStart } from "./calendar";
import { newData, newPerson } from "./defaults";
import { newDepartment, newTodo } from "./departments";
import { parse, serialize } from "./file";
import { callSheet, checkSheet, newSheet, newVenue, normalizeTour, tourCosts, tourSummary, venueCosts, venueIncome } from "./tour";

describe("tour money", () => {
  it("counts what each deal brings", () => {
    expect(venueIncome(newVenue({ deal: "fee", amount: 150000 }))).toBe(150000);
    expect(venueIncome(newVenue({ deal: "takings", takings: 230000 }))).toBe(230000);
    expect(venueIncome(newVenue({ deal: "split", amount: 80000, percent: 6000, takings: 100000 }))).toBe(80000);
    expect(venueIncome(newVenue({ deal: "split", amount: 80000, percent: 6000, takings: 200000 }))).toBe(120000);
    expect(venueIncome(newVenue({ deal: "rent", amount: 50000, takings: 30000 }))).toBe(-20000);
  });

  it("adds travel and rooms, and only confirmed or done dates go into the totals", () => {
    const a = newVenue({ state: "confirmed", deal: "fee", amount: 100000, rooms: 3, roomCost: 6000, trips: [{ id: "t", vehicle: "Furgone", people: [], km: 240, fuel: 4500, tolls: 1800 }] });
    const b = newVenue({ state: "proposal", deal: "fee", amount: 999999, rooms: 9, roomCost: 9999 });
    expect(venueCosts(a)).toBe(24300);
    const s = tourSummary({ venues: [a, b], sheet: newSheet(), gear: [] });
    expect(s).toMatchObject({ confirmed: 1, income: 100000, costs: 24300, balance: 75700, km: 240 });
    expect(tourCosts({ venues: [a, b], sheet: newSheet(), gear: [] })).toBe(24300);
  });
});

describe("technical sheet against the theatre", () => {
  it("finds a stage that is too small and what is missing or to bring", () => {
    const sheet = { ...newSheet(), width: 800, depth: 600, needs: [{ id: "n1", text: "12 PC" }, { id: "n2", text: "Mixer" }, { id: "n3", text: "Quinte nere" }] };
    const v = newVenue({ hostWidth: 700, hostDepth: 650, has: { n1: "yes", n2: "bring" } });
    expect(checkSheet(sheet, v)).toEqual({ stage: [["width", 800, 700]], bring: ["Mixer"], missing: [], unknown: ["Quinte nere"] });
  });

  it("writes the call sheet in Italian with the times that are set", () => {
    const v = newVenue({ theatre: "Teatro Verdi", city: "Pisa", day: "2026-12-05", contact: "Laura · 333 1", schedule: { depart: "13:00", arrive: "15:30", setup: "", check: "", doors: "20:30", show: "21:00", strike: "", back: "" }, trips: [{ id: "t", vehicle: "Furgone", people: ["p1", "p2"], km: 0, fuel: 0, tolls: 0 }] });
    expect(callSheet(v, (ids) => ids.join(", "), () => "sabato 5 dicembre")).toBe(
      ["Teatro Verdi, Pisa — sabato 5 dicembre", "", "13:00  Partenza", "15:30  Arrivo", "20:30  Apertura porte", "21:00  Spettacolo", "", "Viaggio:", "- Furgone: p1, p2", "", "Referente: Laura · 333 1"].join("\n"),
    );
  });

  it("reads back what it wrote and drops what points nowhere", () => {
    const tour = {
      venues: [{ ...newVenue({ theatre: "X", day: "2026-12-05", contactId: "ghost", has: { n1: "yes", zz: "yes" }, gear: { g1: { out: true, back: false }, zz: { out: true, back: false } } }), trips: [{ id: "t", people: ["p1", "ghost"], km: 3 }] }],
      sheet: { ...newSheet(), needs: [{ id: "n1", text: "PC" }, { text: "" }] },
      gear: [{ id: "g1", name: "Bancone", group: "set", qty: 1 }, { name: "" }],
    };
    const back = normalizeTour(JSON.parse(JSON.stringify(tour)), new Set(["p1"]));
    expect(back.venues[0]).toMatchObject({ contactId: "", has: { n1: "yes" }, gear: { g1: { out: true, back: false } } });
    expect(back.venues[0].trips[0].people).toEqual(["p1"]);
    expect(back.sheet.needs).toHaveLength(1);
    expect(back.gear).toHaveLength(1);
  });
});

describe("calendar", () => {
  it("gathers rehearsals, performances, confirmed tour dates and deadlines in order", () => {
    const d = newData();
    d.people = [{ ...newPerson("Giulia"), id: "p1" }];
    d.rehearsals.dates = [{ id: "d1", day: "2026-11-20", time: "18:00", minutes: 120, place: "Sala" }];
    d.budget.performances = [{ id: "s1", day: "2026-12-01", time: "21:00", label: "" }];
    d.tour.venues = [newVenue({ id: "v1", theatre: "Verdi", day: "2026-12-05", state: "confirmed", trips: [{ id: "t", vehicle: "", people: ["p1"], km: 0, fuel: 0, tolls: 0 }] }), newVenue({ id: "v2", theatre: "Forse", day: "2026-12-06", state: "proposal" })];
    d.departments.list = [newDepartment({ name: "Luci", todos: [newTodo({ id: "x", text: "Gelatine", due: "2026-11-10" }), newTodo({ id: "y", text: "Fatto", due: "2026-11-11", done: true })] })];
    const ev = calendarEvents(d, "2026-11-15");
    expect(ev.map((e) => [e.kind, e.day, e.title])).toEqual([
      ["due", "2026-11-10", "Scaduta · Gelatine"],
      ["rehearsal", "2026-11-20", "Prova"],
      ["show", "2026-12-01", "Spettacolo"],
      ["venue", "2026-12-05", "Tournée: Verdi"],
    ]);
    expect(forPerson(ev, "p1").map((e) => e.kind)).toEqual(["show", "venue"]);
  });

  it("draws months from Monday and moves between them", () => {
    const g = monthGrid("2026-11");
    expect(g[0]).toBe("2026-10-26");
    expect(g).toHaveLength(42);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
  });
});

describe("the whole file", () => {
  it("keeps every section when saved and opened again", () => {
    const d = newData("Prova");
    d.tour.venues = [newVenue({ theatre: "Verdi", day: "2026-12-05", state: "done", takings: 123400 })];
    d.departments.list = [newDepartment({ name: "Luci", light: "warn" })];
    const back = parse(serialize(d, { name: "Cantinella", version: "test" }));
    expect(back.tour.venues[0]).toMatchObject({ theatre: "Verdi", takings: 123400, state: "done" });
    expect(back.departments.list[0]).toMatchObject({ name: "Luci", light: "warn" });
  });
});
