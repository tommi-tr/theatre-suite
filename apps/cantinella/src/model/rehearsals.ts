import { uid } from "@theatre-suite/core";
import type { Answer, AnswerState, Person, RehearsalDate, Rehearsals } from "./types";

/* ---------------- Italian dates ----------------
 * Messages for the company are always in Italian: the replies are recognised in Italian. Days are
 * handled as `YYYY-MM-DD` strings and calendar arithmetic uses UTC, so the time zone of the
 * computer never changes a date. */

export const WEEKDAYS = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"] as const;
export const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"] as const;

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export function parseDay(day: string): Ymd {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

export function formatDayKey({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string): number {
  const { y, m, d } = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(day: string, n: number): string {
  const { y, m, d } = parseDay(day);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return formatDayKey({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** Is `day` a real calendar day (30 February is not)? */
export function isRealDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "lunedì 4 novembre" */
export function dayLabel(day: string): string {
  const { m, d } = parseDay(day);
  return `${WEEKDAYS[weekdayOf(day)]} ${d} ${MONTHS[m - 1]}`;
}

/** "lun 4 nov" */
export function dayShort(day: string): string {
  const { m, d } = parseDay(day);
  return `${WEEKDAYS[weekdayOf(day)].slice(0, 3)} ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

/** The line of the message: "Lunedì 4 novembre ore 16:00". Kept like this so that it is still recognised after the actor edits it. */
export function dateLine(date: RehearsalDate): string {
  return `${cap(dayLabel(date.day))} ore ${date.time}`;
}

/** "2 h", "1 h 30", "45 min" */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

export function sortDates(dates: RehearsalDate[]): RehearsalDate[] {
  return [...dates].sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
}

/** Local day of a Date object, `YYYY-MM-DD`. */
export function todayKey(now = new Date()): string {
  return formatDayKey({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

/** Local time of a Date object, `YYYY-MM-DDTHH:MM`. */
export function nowKey(now = new Date()): string {
  return `${todayKey(now)}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** "15 nov, 20:05" for the time stored with an answer; "" if it is not known. */
export function atLabel(at: string): string {
  if (!at) return "";
  const [day, time] = at.split("T");
  const { m, d } = parseDay(day);
  return `${d} ${MONTHS[m - 1].slice(0, 3)}, ${time}`;
}

export const isPast = (date: RehearsalDate, today: string): boolean => date.day < today;

/** "Enrico, Stefania e Paolo" */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export function newDate(partial: Partial<RehearsalDate> = {}): RehearsalDate {
  return { id: uid(), day: todayKey(), time: "18:00", minutes: 120, place: "", ...partial };
}

/** A suggestion for the next date to add: the day after the last one, at the same time. */
export function nextDateSuggestion(dates: RehearsalDate[], today = todayKey()): RehearsalDate {
  const last = sortDates(dates).pop();
  if (!last) return newDate({ day: addDays(today, 1) });
  return newDate({ day: addDays(last.day > today ? last.day : today, 1), time: last.time, minutes: last.minutes, place: last.place });
}

/* ---------------- Answers ---------------- */

const cellKey = (personId: string, dateId: string) => `${personId}|${dateId}`;

/** The current answer of every person for every date (the last one in the history). */
export function currentAnswers(answers: Answer[]): Map<string, Answer> {
  const map = new Map<string, Answer>();
  for (const a of answers) map.set(cellKey(a.personId, a.dateId), a);
  return map;
}

export const cellOf = (map: Map<string, Answer>, personId: string, dateId: string): Answer | undefined => map.get(cellKey(personId, dateId));

export const stateOf = (map: Map<string, Answer>, personId: string, dateId: string): AnswerState => map.get(cellKey(personId, dateId))?.state ?? "none";

/** All the answers given for a cell, the newest first. */
export function historyOf(answers: Answer[], personId: string, dateId: string): Answer[] {
  return answers.filter((a) => a.personId === personId && a.dateId === dateId).reverse();
}

/** Click on a cell: empty → yes → maybe → no → empty. */
export function nextState(s: AnswerState): AnswerState {
  return s === "none" ? "yes" : s === "yes" ? "maybe" : s === "maybe" ? "no" : "none";
}

/**
 * Sets the answer of a cell by hand. If the current answer was also set by hand it is replaced
 * (a few clicks are not a history); an answer that came from a message is never overwritten: the
 * new one is added after it.
 */
export function setCell(r: Rehearsals, personId: string, dateId: string, state: AnswerState, now = nowKey()): Rehearsals {
  const cur = cellOf(currentAnswers(r.answers), personId, dateId);
  if ((cur?.state ?? "none") === state) return r;
  if (cur && cur.source === "manual") {
    return { ...r, answers: r.answers.map((a) => (a.id === cur.id ? { ...a, state, at: now, note: state === "none" ? "" : a.note } : a)) };
  }
  if (!cur && state === "none") return r;
  const answer: Answer = { id: uid(), personId, dateId, state, note: "", at: now, source: "manual" };
  return { ...r, answers: [...r.answers, answer] };
}

/** Changes the note of the current answer (a correction, not a new answer). */
export function setCellNote(r: Rehearsals, personId: string, dateId: string, note: string): Rehearsals {
  const cur = cellOf(currentAnswers(r.answers), personId, dateId);
  if (!cur || cur.state === "none" || cur.note === note) return r;
  return { ...r, answers: r.answers.map((a) => (a.id === cur.id ? { ...a, note } : a)) };
}

/** People of the table: the actors, plus whoever has answered. Alphabetical. */
export function tablePeople(people: Person[], answers: Answer[]): Person[] {
  const answered = new Set(answers.map((a) => a.personId));
  return people
    .filter((p) => p.roles.includes("actor") || answered.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));
}

export interface DateTotals {
  yes: number;
  maybe: number;
  no: number;
  none: number;
  total: number;
}

export function totalsFor(people: Person[], map: Map<string, Answer>, dateId: string): DateTotals {
  const t: DateTotals = { yes: 0, maybe: 0, no: 0, none: 0, total: people.length };
  for (const p of people) t[stateOf(map, p.id, dateId)]++;
  return t;
}

/** Who still has to answer, and for which of the coming dates. Dates already past are not asked. */
export function missing(people: Person[], dates: RehearsalDate[], answers: Answer[], today = todayKey()): { people: Person[]; dates: RehearsalDate[] } {
  const map = currentAnswers(answers);
  const coming = sortDates(dates).filter((d) => !isPast(d, today));
  const gaps = (p: Person) => coming.filter((d) => stateOf(map, p.id, d.id) === "none");
  const list = people.filter((p) => gaps(p).length > 0);
  const wanted = new Set(list.flatMap((p) => gaps(p).map((d) => d.id)));
  return { people: list, dates: coming.filter((d) => wanted.has(d.id)) };
}

/* ---------------- Messages to copy ---------------- */

export interface DatesMessageOptions {
  intro: string;
  /** Add the place after the time. Off by default: text after the time can be mistaken for the reply. */
  withPlace?: boolean;
}

/** One line per date, with the intro above. */
export function datesMessage(dates: RehearsalDate[], { intro, withPlace }: DatesMessageOptions): string {
  const lines = sortDates(dates).map((d) => (withPlace && d.place ? `${dateLine(d)} (${d.place})` : dateLine(d)));
  const head = intro.trim();
  return [head, ...lines].filter(Boolean).join("\n");
}

/** A reminder for those who have not answered; names only. */
export function reminderMessage(people: Person[], dates: RehearsalDate[]): string {
  if (!people.length || !dates.length) return "";
  const names = joinNames(people.map((p) => p.name));
  const verb = people.length === 1 ? "la risposta" : "le risposte";
  const lines = dates.map(dateLine);
  return [`Mancano ancora ${verb} di ${names}. Scrivete accanto a ogni data sì, no o forse:`, ...lines].join("\n");
}
