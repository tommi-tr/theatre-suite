import type { ShowInfo } from "@theatre-suite/core";
import { newData, newPerson } from "./defaults";
import { uid } from "@theatre-suite/core";
import { addDays, todayKey } from "./rehearsals";
import type { Answer, AnswerState, CantinellaData, RehearsalDate } from "./types";

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
  return d;
}
