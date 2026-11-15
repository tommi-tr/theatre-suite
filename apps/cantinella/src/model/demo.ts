import type { ShowInfo } from "@theatre-suite/core";
import { newData, newPerson } from "./defaults";
import { uid } from "@theatre-suite/core";
import { addDays, todayKey } from "./rehearsals";
import { proposePlan } from "./plan";
import type { Answer, AnswerState, CantinellaData, RehearsalDate } from "./types";
import { newBudget, newCost, type Budget, type Cost, type SeatState } from "./budget";
import { newTodo, noteToTodo, presetDepartments, type Departments } from "./departments";
import { newTour, newVenue, type Tour } from "./tour";

/** "La locandiera": the company of the design preview, for `/?demo`. */
export const DEMO_SHOW: ShowInfo = { id: "demo", title: "La locandiera", color: "#6d5a3a" };

/** y = yes, m = maybe, n = no, - = no reply, one letter per date. */
const DEMO_REPLIES: Array<[string, string]> = [
  ["Giulia Ferri", "yymyy"],
  ["Enrico Sala", "ynyyy"],
  ["Giovanni Rota", "yymny"],
  ["Marco Bellini", "yyyyn"],
  ["Luca Fadda", "myy--"],
  ["Stefania Neri", "y----"],
  ["Chiara Valli", "yynyy"],
  ["Paolo Greco", "-----"],
];

/** Dates in the days to come (from today), so that the preview never shows past rehearsals. */
export function demoDates(today = todayKey()): RehearsalDate[] {
  const d = (n: number, time: string, minutes: number, place: string): RehearsalDate => ({ id: `demo-d${n}`, day: addDays(today, n), time, minutes, place });
  return [d(1, "18:00", 120, "Sala prove"), d(3, "18:00", 120, "Sala prove"), d(5, "21:00", 150, "Teatro comunale"), d(8, "18:00", 120, "Sala prove"), d(10, "16:00", 180, "Teatro comunale")];
}

export function demoData(): CantinellaData {
  const d = newData("Produzione");
  const p = (name: string, roles: string[], phone: string, email: string, aliases: string[] = [], notes = "") => ({
    ...newPerson(name),
    roles,
    phone,
    email,
    aliases,
    notes,
  });
  d.people = [
    p("Giulia Ferri", ["actor"], "+39 347 555 0101", "giulia.ferri@example.it", ["Giuli"], "Mirandolina"),
    p("Enrico Sala", ["actor"], "+39 347 555 0102", "enrico.sala@example.it", [], "Il Cavaliere di Ripafratta"),
    p("Giovanni Rota", ["actor"], "+39 347 555 0103", "", ["Gio", "Giovi"], "Il Marchese di Forlipopoli"),
    p("Marco Bellini", ["actor"], "+39 347 555 0104", "marco.bellini@example.it", [], "Il Conte d'Albafiorita"),
    p("Luca Fadda", ["actor"], "+39 347 555 0105", "", [], "Fabrizio"),
    p("Stefania Neri", ["actor"], "+39 347 555 0106", "stefania.neri@example.it", ["Stefi"], "Ortensia"),
    p("Chiara Valli", ["actor"], "+39 347 555 0107", "", [], "Dejanira"),
    p("Paolo Greco", ["actor"], "+39 347 555 0108", "", [], "Servitore del Cavaliere"),
    p("Anna Morelli", ["director", "production"], "+39 347 555 0109", "anna.morelli@example.it", [], "Regia e organizzazione"),
    p("Davide Conti", ["crew"], "+39 347 555 0110", "davide.conti@example.it", [], "Luci e fonica"),
  ];
  const dates = demoDates();
  const states: Record<string, AnswerState> = { y: "yes", m: "maybe", n: "no" };
  const answers: Answer[] = [];
  for (const [name, row] of DEMO_REPLIES) {
    const person = d.people.find((p) => p.name === name)!;
    [...row].forEach((c, i) => {
      if (c === "-") return;
      answers.push({ id: uid(), personId: person.id, dateId: dates[i].id, state: states[c], note: "", at: `${addDays(todayKey(), -1)}T20:${String(10 + answers.length).padStart(2, "0")}`, source: "paste" });
    });
  }
  // A reply that was changed (it stays in the history) and one with a note.
  const giovanni = d.people.find((p) => p.name === "Giovanni Rota")!;
  const luca = d.people.find((p) => p.name === "Luca Fadda")!;
  answers.splice(0, 0, { id: uid(), personId: luca.id, dateId: dates[0].id, state: "no", note: "", at: `${addDays(todayKey(), -2)}T09:30`, source: "paste" });
  const g3 = answers.find((a) => a.personId === giovanni.id && a.dateId === dates[2].id);
  if (g3) g3.note = "esco alle 17";
  d.rehearsals = { ...d.rehearsals, dates, answers };
  // Scenes and characters of act I, and a proposed plan.
  const who = (n: string) => d.people.find((p) => p.name === n)!.id;
  const C = (id: string, name: string, actor: string, sub?: string) => ({ id, name, actorIds: sub ? [who(actor), who(sub)] : [who(actor)], bardoId: "" });
  d.rehearsals.characters = [
    C("ch-mir", "Mirandolina", "Giulia Ferri"),
    C("ch-cav", "Il Cavaliere di Ripafratta", "Enrico Sala"),
    C("ch-mar", "Il Marchese di Forlipopoli", "Giovanni Rota"),
    C("ch-con", "Il Conte d'Albafiorita", "Marco Bellini"),
    C("ch-fab", "Fabrizio", "Luca Fadda"),
    C("ch-ort", "Ortensia", "Stefania Neri"),
    C("ch-dej", "Dejanira", "Chiara Valli"),
    C("ch-ser", "Servitore del Cavaliere", "Paolo Greco", "Luca Fadda"),
  ];
  const S = (n: number, title: string, chars: string[], weight: number, minutes: number, act = "Atto I") => ({
    id: `sc-${n}`,
    name: title ? `Scena ${n} · ${title}` : `Scena ${n}`,
    act,
    characterIds: chars.map((c) => `ch-${c}`),
    optional: [] as string[],
    weight,
    minutes,
    bardoId: "",
  });
  d.rehearsals.scenes = [
    S(1, "Il Marchese e il Conte", ["mar", "con"], 2, 30),
    S(2, "Arriva il Cavaliere", ["mar", "con", "cav"], 2, 30),
    S(3, "Mirandolina", ["mar", "con", "cav", "mir"], 3, 45),
    S(4, "Fabrizio", ["mir", "fab"], 2, 20),
    S(5, "Il Cavaliere solo", ["cav", "ser"], 1, 15),
    S(6, "Le commedianti", ["ort", "dej", "fab"], 2, 30),
    { ...S(7, "Saluti", [], 1, 15, ""), name: "Saluti finali", optional: [] },
  ];
  d.rehearsals.scenes[6].characterIds = d.rehearsals.characters.map((c) => c.id);
  d.rehearsals.plan = proposePlan(d.rehearsals);
  d.budget = demoBudget();
  d.departments = demoDepartments(d);
  d.tour = demoTour(d);
  return d;
}

/** Costs, a theatre with stalls and gallery, four performances (two weekends after the rehearsals). */
export function demoBudget(today = todayKey()): Budget {
  const b = newBudget();
  const c = (name: string, category: string, p: Partial<Cost>) => newCost({ name, category, ...p });
  b.costs = [
    c("SIAE", "siae", { kind: "mixed", mix: "max", amount: 15000, entered: "gross", vat: 22, percent: 1000, state: "confirmed", supplier: "SIAE Mandato di Firenze" }),
    c("Affitto del teatro", "rent", { kind: "perShow", amount: 45000, entered: "net", vat: 22, state: "quote", supplier: "Teatro comunale" }),
    c("Service audio e luci", "service", { kind: "perShow", amount: 35000, entered: "net", vat: 22, state: "confirmed", supplier: "Fonica Davide" }),
    c("Scenografie", "set", { amount: 120000, entered: "gross", vat: 22, state: "paid", supplier: "Laboratorio Ferri" }),
    c("Costumi", "costumes", { amount: 80000, entered: "gross", vat: 22, state: "paid" }),
    c("Pubblicità e stampa", "promo", { amount: 30000, entered: "gross", vat: 22, state: "estimate" }),
    c("Programma di sala", "promo", { kind: "perSeat", amount: 30, entered: "gross", vat: 4, state: "estimate", notes: "Un foglio piegato a ogni spettatore" }),
    c("Assicurazione", "insurance", { amount: 18000, entered: "gross", vat: 0, state: "paid" }),
  ];
  b.basePrice = 1800;
  b.sectors = [
    { id: "sec-pl", name: "Platea", rows: 12, perRow: 20, seats: 0, level: "stalls", price: { mode: "base", value: 0 } },
    { id: "sec-ga", name: "Galleria", rows: 4, perRow: 16, seats: 0, level: "upper", price: { mode: "percent", value: 2500 } },
  ];
  b.costs[6].sectors = ["sec-pl"];
  b.reductions = [{ id: "red-u26", name: "Under 26", rule: { mode: "percent", value: 3000 }, share: 1500 }];
  b.performances = [16, 17, 23, 24].map((n, i) => ({ id: `perf-${i + 1}`, day: addDays(today, n), time: i % 2 ? "17:00" : "21:00", label: "" }));
  const all: Record<string, SeatState> = {};
  for (let n = 8; n < 12; n++) all[`sec-pl:11:${n}`] = "blocked";
  for (let n = 0; n < 20; n += 19) all[`sec-pl:0:${n}`] = "limited";
  const first: Record<string, SeatState> = {};
  for (let r = 1; r < 8; r++) for (let n = 2; n < 18; n++) if ((r * 7 + n * 3) % 5 !== 0) first[`sec-pl:${r}:${n}`] = "sold";
  for (let n = 6; n < 14; n++) first[`sec-pl:0:${n}`] = "reserved";
  first["sec-pl:8:9"] = "comp";
  first["sec-pl:8:10"] = "comp";
  for (let n = 3; n < 13; n++) first[`sec-ga:0:${n}`] = "sold";
  b.seats = { all, "perf-1": first };
  return b;
}

/** Departments with a few things to do (one overdue, some due this week) and a report. */
export function demoDepartments(d: CantinellaData, today = todayKey()): Departments {
  const who = (n: string) => d.people.find((p) => p.name === n)?.id ?? "";
  const list = presetDepartments();
  const by = (key: string) => list.find((x) => x.key === key)!;
  const todo = (text: string, days: number | null, person = "", done = false) => newTodo({ text, due: days === null ? "" : addDays(today, days), personId: who(person), done });
  Object.assign(by("direction"), { light: "ok", ownerId: who("Anna Morelli"), todos: [todo("Piano prove della settimana", 1, "Anna Morelli"), todo("Filata del primo atto", 9, "Anna Morelli")] });
  Object.assign(by("set"), { light: "warn", todos: [todo("Bancone della locanda", -2), todo("Porta praticabile", 4), todo("Disegno della scena", -10, "", true)] });
  Object.assign(by("lights"), { light: "info", ownerId: who("Davide Conti"), todos: [todo("Pianta luci", 6, "Davide Conti")] });
  Object.assign(by("costumes"), { light: "stop", todos: [todo("Prendere le taglie", 2), todo("Stoffa per Mirandolina", 12)], comments: [{ id: uid(), at: `${addDays(today, -1)}T22:10`, text: "La sarta è ferma fino a lunedì." }] });
  Object.assign(by("sound"), { light: "ok", ownerId: who("Davide Conti") });
  Object.assign(by("promo"), { light: "warn", todos: [todo("Locandina", 5), todo("Comunicato stampa", 14)] });
  Object.assign(by("admin"), { light: "info", todos: [todo("Pagare l'assicurazione", -5, "", true)] });
  const rep = { id: "demo-rep", day: addDays(today, -1), dateId: "", general: "Primo atto filato due volte. Il ritmo della scena 3 va ancora trovato.", notes: [] as Departments["reports"][number]["notes"] };
  const deps: Departments = { list, reports: [rep] };
  rep.notes.push(
    { id: uid(), deptId: by("lights").id, text: "Serve più luce sul bancone nella scena 3", todoId: "" },
    { id: uid(), deptId: by("set").id, text: "La porta sbatte: fermarla", todoId: "" },
    { id: uid(), deptId: by("costumes").id, text: "Ortensia ha bisogno di un cambio veloce", todoId: "" },
  );
  return noteToTodo(deps, rep.id, rep.notes[1].id, addDays(today, 3));
}

/** Three venues (one done, one confirmed, one being negotiated), the technical sheet and the gear. */
export function demoTour(d: CantinellaData, today = todayKey()): Tour {
  const who = (n: string) => d.people.find((p) => p.name === n)?.id ?? "";
  const t = newTour();
  t.sheet = {
    ...t.sheet,
    width: 800,
    depth: 600,
    height: 500,
    needs: [
      { id: "need-pc", text: "12 PC 1 kW" },
      { id: "need-mix", text: "Mixer 8 canali" },
      { id: "need-black", text: "Quinte e fondale neri" },
      { id: "need-dress", text: "Due camerini" },
    ],
    notes: "Buio in sala completo. Una presa da 32 A vicino al palco.",
  };
  t.gear = [
    { id: "g1", name: "Bancone della locanda", group: "set", qty: 1 },
    { id: "g2", name: "Porta praticabile", group: "set", qty: 1 },
    { id: "g3", name: "Bauli costumi", group: "costumes", qty: 3 },
    { id: "g4", name: "Vassoi e bicchieri", group: "props", qty: 1 },
    { id: "g5", name: "Mixer e cavi", group: "tech", qty: 1 },
  ];
  const car = (vehicle: string, people: string[], km: number, fuel: number, tolls: number) => ({ id: uid(), vehicle, people: people.map(who), km, fuel, tolls });
  t.venues = [
    newVenue({
      theatre: "Teatro Verdi",
      city: "Pisa",
      address: "Via Palestro 40",
      day: addDays(today, -12),
      contact: "Laura · 333 555 0201",
      state: "done",
      deal: "fee",
      amount: 120000,
      hostWidth: 900,
      hostDepth: 700,
      hostHeight: 600,
      has: { "need-pc": "yes", "need-mix": "bring", "need-black": "yes", "need-dress": "yes" },
      schedule: { depart: "13:00", arrive: "14:30", setup: "15:00", check: "18:00", doors: "20:30", show: "21:00", strike: "23:00", back: "00:30" },
      trips: [car("Furgone", ["Davide Conti", "Paolo Greco"], 160, 3200, 900), car("Auto di Anna", ["Anna Morelli", "Giulia Ferri", "Enrico Sala", "Marco Bellini"], 160, 2400, 900)],
      takings: 0,
      audience: 212,
      siae: "Borderò n. 1187",
      notes: "Camerini al primo piano: servono 10 minuti per scendere.",
      gear: { g1: { out: true, back: true }, g2: { out: true, back: true }, g3: { out: true, back: true }, g4: { out: true, back: true }, g5: { out: true, back: true } },
    }),
    newVenue({
      theatre: "Teatro dei Rinnovati",
      city: "Siena",
      address: "Piazza del Campo 1",
      day: addDays(today, 30),
      contact: "Marco · 333 555 0202",
      state: "confirmed",
      deal: "split",
      amount: 80000,
      percent: 6000,
      hostWidth: 750,
      hostDepth: 650,
      hostHeight: 0,
      has: { "need-pc": "yes", "need-mix": "bring", "need-black": "no" },
      schedule: { depart: "12:00", arrive: "13:30", setup: "14:00", check: "17:30", doors: "20:30", show: "21:00", strike: "", back: "" },
      trips: [car("Furgone", ["Davide Conti", "Paolo Greco"], 230, 4600, 1500)],
      rooms: 4,
      roomCost: 7000,
      gear: { g1: { out: true, back: false } },
    }),
    newVenue({ theatre: "Teatro Comunale", city: "Lucca", day: addDays(today, 44), contact: "Ufficio programmazione", state: "proposal", deal: "takings" }),
  ];
  return t;
}
