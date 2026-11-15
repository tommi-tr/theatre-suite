import { describe, expect, it } from "vitest";
import { newPerson, newRehearsals } from "./defaults";
import { addDays, cellOf, currentAnswers, dateLine, datesMessage, dayLabel, dayShort, durationLabel, historyOf, joinNames, missing, nextDateSuggestion, nextState, reminderMessage, setCell, setCellNote, stateOf, tablePeople, totalsFor, weekdayOf } from "./rehearsals";
import type { Answer, RehearsalDate } from "./types";

const d1: RehearsalDate = { id: "d1", day: "2026-11-16", time: "16:00", minutes: 120, place: "Sala prove" };
const d2: RehearsalDate = { id: "d2", day: "2026-11-17", time: "18:30", minutes: 90, place: "" };
const ans = (id: string, personId: string, dateId: string, state: Answer["state"], source: Answer["source"] = "paste", note = ""): Answer => ({ id, personId, dateId, state, note, at: "2026-11-15T20:00", source });

describe("Italian dates", () => {
  it("weekday and day", () => {
    expect(weekdayOf("2026-11-16")).toBe(1);
    expect(weekdayOf("2026-02-28")).toBe(6);
    expect(dayLabel("2026-11-16")).toBe("lunedì 16 novembre");
    expect(dayShort("2026-11-19")).toBe("gio 19 nov");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("the line of the message", () => {
    expect(dateLine(d1)).toBe("Lunedì 16 novembre ore 16:00");
    expect(dateLine({ ...d2, day: "2026-11-17" })).toBe("Martedì 17 novembre ore 18:30");
  });
  it("durations and lists", () => {
    expect(durationLabel(120)).toBe("2 h");
    expect(durationLabel(90)).toBe("1 h 30");
    expect(durationLabel(45)).toBe("45 min");
    expect(joinNames(["Enrico"])).toBe("Enrico");
    expect(joinNames(["Enrico", "Stefania", "Paolo"])).toBe("Enrico, Stefania e Paolo");
  });
  it("the next date follows the last one", () => {
    const n = nextDateSuggestion([d2, d1], "2026-11-15");
    expect([n.day, n.time, n.minutes, n.place]).toEqual(["2026-11-18", "18:30", 90, ""]);
    expect(nextDateSuggestion([], "2026-11-15").day).toBe("2026-11-16");
  });
});

describe("the message with the dates", () => {
  it("one line per date, in order, after the intro", () => {
    const text = datesMessage([d2, d1], { intro: "Ciao a tutti!" });
    expect(text).toBe("Ciao a tutti!\nLunedì 16 novembre ore 16:00\nMartedì 17 novembre ore 18:30");
  });
  it("the place only if asked", () => {
    expect(datesMessage([d1], { intro: "", withPlace: true })).toBe("Lunedì 16 novembre ore 16:00 (Sala prove)");
    expect(datesMessage([d1], { intro: "" })).toBe("Lunedì 16 novembre ore 16:00");
  });
});

describe("answers", () => {
  it("the last one is the current one, the others are the history", () => {
    const list = [ans("1", "p", "d1", "yes"), ans("2", "p", "d1", "no"), ans("3", "q", "d1", "maybe")];
    const map = currentAnswers(list);
    expect(stateOf(map, "p", "d1")).toBe("no");
    expect(stateOf(map, "p", "d2")).toBe("none");
    expect(historyOf(list, "p", "d1").map((a) => a.id)).toEqual(["2", "1"]);
  });
  it("a click goes yes → maybe → no → empty", () => {
    let s = nextState("none");
    const seen = [s];
    for (let i = 0; i < 4; i++) seen.push((s = nextState(s)));
    expect(seen).toEqual(["yes", "maybe", "no", "none", "yes"]);
  });
  it("by hand: a reply from a message is not overwritten, the new one follows it", () => {
    const r = { ...newRehearsals(), dates: [d1], answers: [ans("1", "p", "d1", "yes")] };
    const a = setCell(r, "p", "d1", "no", "2026-11-16T09:00");
    expect(a.answers.map((x) => [x.state, x.source])).toEqual([["yes", "paste"], ["no", "manual"]]);
    // A second click on a manual answer replaces it: a few clicks are not a history.
    const b = setCell(a, "p", "d1", "maybe", "2026-11-16T09:01");
    expect(b.answers.map((x) => [x.state, x.source])).toEqual([["yes", "paste"], ["maybe", "manual"]]);
    expect(setCell(b, "p", "d1", "maybe")).toBe(b);
  });
  it("clearing an empty cell does nothing; clearing keeps the history", () => {
    const r = { ...newRehearsals(), dates: [d1], answers: [ans("1", "p", "d1", "yes")] };
    expect(setCell(r, "q", "d1", "none")).toBe(r);
    const c = setCell(r, "p", "d1", "none");
    expect(stateOf(currentAnswers(c.answers), "p", "d1")).toBe("none");
    expect(c.answers.length).toBe(2);
  });
  it("the note belongs to the current answer", () => {
    const r = { ...newRehearsals(), answers: [ans("1", "p", "d1", "yes")] };
    const n = setCellNote(r, "p", "d1", "esco alle 17");
    expect(cellOf(currentAnswers(n.answers), "p", "d1")?.note).toBe("esco alle 17");
    expect(setCellNote(r, "q", "d1", "x")).toBe(r);
  });
});

describe("the table", () => {
  const actor = (id: string, name: string) => ({ ...newPerson(name), id, roles: ["actor"] });
  const people = [actor("b", "Stefania Neri"), actor("a", "Enrico Sala"), { ...newPerson("Davide Conti"), id: "t", roles: ["crew"] }];
  it("actors, plus whoever has answered, alphabetical", () => {
    expect(tablePeople(people, []).map((p) => p.id)).toEqual(["a", "b"]);
    expect(tablePeople(people, [ans("1", "t", "d1", "yes")]).map((p) => p.id)).toEqual(["t", "a", "b"]);
  });
  it("totals per date", () => {
    const map = currentAnswers([ans("1", "a", "d1", "yes"), ans("2", "b", "d1", "maybe")]);
    expect(totalsFor(people.slice(0, 2), map, "d1")).toEqual({ yes: 1, maybe: 1, no: 0, none: 0, total: 2 });
    expect(totalsFor(people.slice(0, 2), map, "d2")).toEqual({ yes: 0, maybe: 0, no: 0, none: 2, total: 2 });
  });
  it("who has still to answer, only for the dates to come", () => {
    const a = people.slice(0, 2);
    const answers = [ans("1", "a", "d1", "yes"), ans("2", "a", "d2", "no"), ans("3", "b", "d1", "maybe")];
    const m = missing(a, [d1, d2], answers, "2026-11-15");
    expect(m.people.map((p) => p.id)).toEqual(["b"]);
    expect(m.dates.map((d) => d.id)).toEqual(["d2"]);
    // After the first date it is past nobody is asked about it.
    expect(missing(a, [d1, d2], [], "2026-11-17").dates.map((d) => d.id)).toEqual(["d2"]);
    expect(missing(a, [d1, d2], [], "2026-11-18").people).toEqual([]);
  });
  it("the reminder names the people and lists the dates", () => {
    const text = reminderMessage(people.slice(0, 2), [d1, d2]);
    expect(text).toBe("Mancano ancora le risposte di Stefania Neri e Enrico Sala. Scrivete accanto a ogni data sì, no o forse:\nLunedì 16 novembre ore 16:00\nMartedì 17 novembre ore 18:30");
    expect(reminderMessage([people[0]], [d1])).toMatch(/^Mancano ancora la risposta di Stefania Neri\./);
    expect(reminderMessage([], [d1])).toBe("");
  });
});
