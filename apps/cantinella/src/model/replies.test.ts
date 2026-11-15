import { describe, expect, it } from "vitest";
import { aliasesToLearn, classifyRows, matchPerson, needsCheck, parseHeader, parseReplies, readAnswer, buildLexicon, rowsToAnswers, type ParseContext } from "./replies";
import { newPerson } from "./defaults";
import type { Answer, RehearsalDate } from "./types";

// Lunedì 16, martedì 17 and giovedì 19 November 2026.
const d1: RehearsalDate = { id: "d1", day: "2026-11-16", time: "16:00", minutes: 120, place: "" };
const d2: RehearsalDate = { id: "d2", day: "2026-11-17", time: "18:00", minutes: 120, place: "" };
const d3: RehearsalDate = { id: "d3", day: "2026-11-19", time: "21:00", minutes: 120, place: "" };

const person = (id: string, name: string, aliases: string[] = [], phone = "") => ({ ...newPerson(name), id, aliases, phone, roles: ["actor"] });
const people = [
  person("giovanni", "Giovanni Rota", ["Gio", "Giovi"], "+39 347 555 0103"),
  person("enrico", "Enrico Sala", [], "+39 347 555 0102"),
  person("stefania", "Stefania Neri", ["Stefi"], "+39 347 555 0106"),
  person("giulia", "Giulia Ferri", ["Giuli"], "+39 347 555 0101"),
];
const ctx = (extra: Partial<ParseContext> = {}): ParseContext => ({ people, dates: [d1, d2, d3], ...extra });

describe("WhatsApp headers", () => {
  it("reads iPhone, Android and WhatsApp Web", () => {
    expect(parseHeader("[16/11/26, 10:12:33] Giovanni: ciao")).toEqual({ at: "2026-11-16T10:12", rest: "Giovanni: ciao" });
    expect(parseHeader("16/11/2026, 10:12 - Giovanni: ciao")).toEqual({ at: "2026-11-16T10:12", rest: "Giovanni: ciao" });
    expect(parseHeader("[10:12, 16/11/2026] Giovanni: ciao")).toEqual({ at: "2026-11-16T10:12", rest: "Giovanni: ciao" });
    expect(parseHeader("[16/11/26, 10:12:33 PM] A: b")?.at).toBe("2026-11-16T22:12");
    expect(parseHeader("Lunedì 16 novembre ore 16:00")).toBeNull();
  });
});

describe("the whole chat", () => {
  const chat = [
    "[15/11/26, 20:01:12] Anna Morelli: Ecco le date delle prove. Scrivete accanto a ogni data sì, no o forse:",
    "Lunedì 16 novembre ore 16:00",
    "Martedì 17 novembre ore 18:00",
    "Giovedì 19 novembre ore 21:00",
    "[15/11/26, 20:05:40] Giovanni Rota: Lunedì 16 novembre ore 16:00 sì",
    "Martedì 17 novembre ore 18:00 no",
    "Giovedì 19 novembre ore 21:00 forse, esco alle 17",
    "[15/11/26, 20:09:02] ~ Stefi: Lunedì 16 novembre ore 16:00 Sì!",
    "[15/11/26, 20:10:00] Enrico Sala: Ragazzi sono in ritardo col lavoro, vi dico domani",
    "‎[15/11/26, 20:11:00] Giulia Ferri: ‎immagine omessa",
    "15/11/2026, 20:12 - I messaggi e le chiamate sono crittografati end-to-end.",
  ].join("\n");

  it("reads who wrote what, with the time of the message", () => {
    const { rows } = parseReplies(chat, ctx());
    expect(rows.map((r) => [r.personId, r.dateId, r.state, r.note])).toEqual([
      ["giovanni", "d1", "yes", ""],
      ["giovanni", "d2", "no", ""],
      ["giovanni", "d3", "maybe", "esco alle 17"],
      ["stefania", "d1", "yes", ""],
    ]);
    expect(rows.every((r) => !needsCheck(r))).toBe(true);
    expect(rows[0].at).toBe("2026-11-15T20:05");
    expect(rows[3].personHow).toBe("alias");
  });

  it("does not take the message of the director for replies, and shows what it did not read", () => {
    const { ignored } = parseReplies(chat, ctx());
    expect(ignored.map((i) => i.author)).toEqual(["Enrico Sala", "Giulia Ferri"]);
  });
});

describe("who writes", () => {
  it("name, alias, number, part of the name", () => {
    expect(matchPerson("Giovanni Rota", people)).toMatchObject({ id: "giovanni", how: "name" });
    expect(matchPerson("Giovi 🎭", people)).toMatchObject({ id: "giovanni", how: "alias" });
    expect(matchPerson("+39 347 555 0102", people)).toMatchObject({ id: "enrico", how: "phone" });
    expect(matchPerson("3475550106", people)).toMatchObject({ id: "stefania", how: "phone" });
    expect(matchPerson("Enrico", people)).toMatchObject({ id: "enrico", how: "part" });
    expect(matchPerson("~ Enrico Sala Teatro", people)).toMatchObject({ id: "enrico", how: "part" });
  });
  it("two possible people are not guessed", () => {
    const two = [person("a", "Marco Bellini"), person("b", "Marco Rossi")];
    expect(matchPerson("Marco", two)).toMatchObject({ id: null, how: "ambiguous", candidates: ["a", "b"] });
  });
  it("an unknown sender needs to be assigned", () => {
    const { rows } = parseReplies("[15/11/26, 20:05:40] Zio Mario: Lunedì 16 novembre sì", ctx());
    expect(rows[0]).toMatchObject({ personId: null, personHow: "none", state: "yes" });
    expect(rows[0].check).toEqual({ person: true, date: false, answer: false });
  });
  it("remembers the names assigned by hand as aliases", () => {
    const { rows } = parseReplies("[15/11/26, 20:05:40] Zio Mario: Lunedì 16 novembre sì", ctx());
    rows[0].personId = "enrico";
    expect(aliasesToLearn(rows, people)).toEqual(new Map([["enrico", ["Zio Mario"]]]));
    rows[0].author = "Enrico Sala";
    expect(aliasesToLearn(rows, people).size).toBe(0);
  });
});

describe("the date", () => {
  const one = (text: string) => parseReplies(text, ctx()).rows;
  it("accepts many ways to write it", () => {
    for (const t of ["Lunedì 16 novembre ore 16:00 sì", "lunedi 16 novembre si", "16/11 sì", "16/11/26 sì", "16/11/2026 sì", "il 16 nov. sì", "16 Novembre: sì", "16-11 sì", "16 novemb sì", "16 novenbre sì", "lun 16/11 ore 16 sì", "il 16 novembre alle 16.00 sì"]) {
      const [r] = one(`Giovanni Rota: ${t}`);
      expect(r, t).toBeDefined();
      expect([r.dateId, r.state, needsCheck(r)], t).toEqual(["d1", "yes", false]);
    }
  });
  it("a date that was not sent is not guessed", () => {
    const [r] = one("Giovanni Rota: Venerdì 20 novembre sì");
    expect(r).toMatchObject({ dateId: null, dateHow: "none", state: "yes" });
    expect(r.check.date).toBe(true);
  });
  it("a wrong weekday makes the row doubtful", () => {
    const [r] = one("Giovanni Rota: Martedì 16 novembre sì");
    expect(r).toMatchObject({ dateId: "d1", dateHow: "weekday-mismatch" });
    expect(r.check.date).toBe(true);
  });
  it("only the weekday is accepted but has to be confirmed", () => {
    const rows = one("Giovanni Rota: Lunedì sì, martedì no, giovedì forse");
    expect(rows.map((r) => [r.dateId, r.state, r.check.date])).toEqual([["d1", "yes", true], ["d2", "no", true], ["d3", "maybe", true]]);
  });
  it("hours such as 10-12 are not dates", () => {
    expect(one("Giovanni Rota: sono libero dalle 10-12").length).toBe(0);
    expect(one("Giovanni Rota: sono libero dalle 10-12 ma 16/11 sì").map((r) => r.dateId)).toEqual(["d1"]);
  });
  it("two rehearsals on the same day are told apart by the time", () => {
    const evening = { ...d1, id: "d1b", time: "21:00" };
    const c = ctx({ dates: [d1, evening, d2] });
    expect(parseReplies("Giovanni Rota: 16/11 ore 21:00 no", c).rows[0].dateId).toBe("d1b");
    const [r] = parseReplies("Giovanni Rota: 16/11 no", c).rows;
    expect(r).toMatchObject({ dateId: null, dateHow: "ambiguous", dateCandidates: ["d1", "d1b"] });
  });
  it("a year that does not match is not the same date", () => {
    expect(one("Giovanni Rota: 16/11/2025 sì")[0].dateId).toBeNull();
  });
  it("several dates in one line, date first or answer first", () => {
    expect(one("Giovanni Rota: 16 novembre sì, 17 novembre no, 19 novembre forse").map((r) => [r.dateId, r.state])).toEqual([["d1", "yes"], ["d2", "no"], ["d3", "maybe"]]);
    expect(one("Giovanni Rota: sì 16 novembre, no 17 novembre, forse 19 novembre").map((r) => [r.dateId, r.state])).toEqual([["d1", "yes"], ["d2", "no"], ["d3", "maybe"]]);
    expect(one("Giovanni Rota: Ok per lunedì 16 novembre").map((r) => [r.dateId, r.state, needsCheck(r)])).toEqual([["d1", "yes", false]]);
  });
});

describe("the answer", () => {
  const lex = buildLexicon();
  const read = (s: string) => readAnswer(s, lex);
  it("sì / no / forse in any way", () => {
    for (const s of ["sì", "si", "SI", "Sì!", "s", "S", "siii", "ok", "OK", "Certo", "ci sono", "👍", "Presente", "va bene"]) expect(read(s)?.state, s).toBe("yes");
    for (const s of ["no", "No", "NO", "n", "N", "noooo", "non posso", "Non ci sono", "purtroppo no", "Purtroppo non posso", "❌"]) expect(read(s)?.state, s).toBe("no");
    for (const s of ["forse", "Forse", "f", "F", "fors", "non so", "Dipende", "se riesco", "🤷"]) expect(read(s)?.state, s).toBe("maybe");
  });
  it("keeps what follows as a note", () => {
    expect(read("forse, esco alle 17")).toMatchObject({ state: "maybe", note: "esco alle 17", how: "word" });
    expect(read("sì (ma arrivo tardi)")).toMatchObject({ state: "yes", note: "ma arrivo tardi" });
    expect(read(" - no, ho lavoro")).toMatchObject({ state: "no", note: "ho lavoro" });
  });
  it("the first letter is a guess to be checked", () => {
    expect(read("sono libero")).toMatchObject({ state: "yes", how: "letter" });
    expect(read("nemmeno morto")).toMatchObject({ state: "no", how: "letter" });
    expect(read("fatemi sapere")).toMatchObject({ state: "maybe", how: "letter" });
    expect(read("non credo")).toMatchObject({ state: "no", how: "negation" });
    expect(read("teatro Verdi")).toMatchObject({ state: null, how: "none" });
  });
  it("nothing after the date is no reply", () => {
    expect(read("")).toBeNull();
    expect(read("  -  ")).toBeNull();
  });
  it("the director can add words", () => {
    const custom = buildLexicon({ yes: ["x", "Eccomi"], maybe: ["boh"], no: [] });
    expect(readAnswer("x", custom)?.state).toBe("yes");
    expect(readAnswer("eccomi!", custom)).toMatchObject({ state: "yes", how: "word" });
    expect(readAnswer("boh", custom)).toMatchObject({ state: "maybe", how: "word" });
    expect(readAnswer("x", lex)).toMatchObject({ how: "none" });
  });
  it("uses them when reading the chat", () => {
    const rows = parseReplies("Giovanni Rota: 16/11 x\nGiovanni Rota: 17/11 boh", ctx({ words: { yes: ["x"], maybe: ["boh"], no: [] } })).rows;
    expect(rows.map((r) => [r.state, r.answerHow])).toEqual([["yes", "word"], ["maybe", "word"]]);
  });
  it("a doubtful answer makes the row doubtful", () => {
    const [r] = parseReplies("Giovanni Rota: 16/11 sono libero", ctx()).rows;
    expect(r.check).toEqual({ person: false, date: false, answer: true });
    expect(r.state).toBe("yes");
  });
});

describe("pastes without headers", () => {
  it("a single message from one person to assign", () => {
    const { rows } = parseReplies("Lunedì 16 novembre sì\nMartedì 17 novembre no", ctx());
    expect(rows.map((r) => [r.personId, r.dateId, r.state])).toEqual([[null, "d1", "yes"], [null, "d2", "no"]]);
    expect(rows.every((r) => r.check.person)).toBe(true);
  });
  it("'Name: text' counts when the name is known", () => {
    const { rows } = parseReplies("Giovanni: lunedì 16 novembre sì\nEnrico: 16/11 no\n\nlunedì 16 novembre forse", ctx());
    expect(rows.map((r) => [r.personId, r.state])).toEqual([["giovanni", "yes"], ["enrico", "no"], [null, "maybe"]]);
  });
  it("Windows line ends and invisible marks", () => {
    const t = "‎[15/11/26, 20:05:40] Giovanni Rota: Lunedì 16 novembre ore 16:00 sì\r\n‎[15/11/26, 20:06:40] Enrico Sala: 17/11 no\r\n";
    expect(parseReplies(t, ctx()).rows.map((r) => [r.personId, r.state])).toEqual([["giovanni", "yes"], ["enrico", "no"]]);
  });
});

describe("against what is already there", () => {
  const rows = () =>
    parseReplies("[15/11/26, 20:05:40] Giovanni Rota: 16/11 sì\n[15/11/26, 20:06:40] Giovanni Rota: 16/11 no\n[15/11/26, 20:07:00] Enrico Sala: 16/11 forse", ctx()).rows;
  it("the last reply of a person for a date is the one that counts", () => {
    const r = rows();
    const status = classifyRows(r, []);
    expect([...status.values()]).toEqual(["superseded", "new", "new"]);
  });
  it("the same chat pasted twice adds nothing", () => {
    const r = rows();
    const added = rowsToAnswers(r, "2026-11-15T21:00");
    // The reply that was replaced stays in the history; the last one counts.
    expect(added.map((a) => [a.personId, a.state, a.at, a.source])).toEqual([
      ["giovanni", "yes", "2026-11-15T20:05", "paste"],
      ["giovanni", "no", "2026-11-15T20:06", "paste"],
      ["enrico", "maybe", "2026-11-15T20:07", "paste"],
    ]);
    const status = classifyRows(r, added);
    expect([...status.values()]).toEqual(["already", "already", "already"]);
  });
  it("without the time of the message a reply equal to the current one is not added again", () => {
    const answers: Answer[] = [{ id: "a", personId: "giovanni", dateId: "d1", state: "yes", note: "", at: "2026-11-14T10:00", source: "paste" }];
    const r = parseReplies("Giovanni: 16/11 sì\nEnrico: 16/11 sì", ctx()).rows;
    expect([...classifyRows(r, answers).values()]).toEqual(["already", "new"]);
  });
});
