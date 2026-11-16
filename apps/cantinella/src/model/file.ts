import { uid } from "@theatre-suite/core";
import { DEFAULT_INTRO, newRehearsals } from "./defaults";
import { isRealDay, parseDay } from "./rehearsals";
import { normalizeScenes } from "./scenes";
import { normalizeBudget } from "./budget";
import { normalizeDepartments } from "./departments";
import { normalizeTour } from "./tour";
import { FILE_FORMAT, FILE_FORMAT_VERSION, type Answer, type CantinellaData, type CustomWords, type Person, type RehearsalDate, type Rehearsals } from "./types";

export type FileProblem = "not-json" | "not-cantinella" | "newer" | "unsupported" | "damaged";

export class CantinellaFileError extends Error {
  constructor(public problem: FileProblem) {
    super(problem);
  }
}

const KNOWN_KEYS = new Set(["id", "title", "people", "rehearsals", "budget", "departments", "tour"]);

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.slice(0, max) : "");
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 50) : [];

function normalizeProd(v: unknown): Person["prod"] {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { sizes: str(r.sizes, 2000), needs: str(r.needs, 2000), documents: str(r.documents, 2000), tour: str(r.tour, 2000) };
}

export function normalizePerson(raw: unknown): Person | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, 200).trim();
  if (!name) return null;
  return {
    id: str(r.id, 100) || uid(),
    name,
    aliases: strList(r.aliases),
    phone: str(r.phone, 100).trim(),
    email: str(r.email, 200).trim(),
    roles: strList(r.roles),
    notes: str(r.notes, 20000),
    prod: normalizeProd(r.prod),
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function normalizeDate(raw: unknown): RehearsalDate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const day = str(r.day, 20);
  if (!DAY_RE.test(day)) return null;
  const { y, m, d } = parseDay(day);
  if (!isRealDay(y, m, d)) return null;
  const time = str(r.time, 5);
  const minutes = typeof r.minutes === "number" && Number.isFinite(r.minutes) ? Math.min(1440, Math.max(15, Math.round(r.minutes))) : 120;
  return { id: str(r.id, 100) || uid(), day, time: TIME_RE.test(time) ? time : "18:00", minutes, place: str(r.place, 200).trim() };
}

const wordList = (v: unknown): string[] => [...new Set(strList(v).map((w) => w.slice(0, 40)))].slice(0, 30);

function normalizeWords(raw: unknown): CustomWords {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { yes: wordList(r.yes), maybe: wordList(r.maybe), no: wordList(r.no) };
}

/** Reads the rehearsals block; answers that point to a missing person or date are dropped. */
export function normalizeRehearsals(raw: unknown, people: Person[]): Rehearsals {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = newRehearsals();
  const seen = new Set<string>();
  for (const d of Array.isArray(r.dates) ? r.dates : []) {
    const date = normalizeDate(d);
    if (!date) continue;
    if (seen.has(date.id)) date.id = uid();
    seen.add(date.id);
    out.dates.push(date);
  }
  const personIds = new Set(people.map((p) => p.id));
  const answerIds = new Set<string>();
  for (const a of Array.isArray(r.answers) ? r.answers : []) {
    if (!a || typeof a !== "object") continue;
    const x = a as Record<string, unknown>;
    const personId = str(x.personId, 100);
    const dateId = str(x.dateId, 100);
    if (!personIds.has(personId) || !seen.has(dateId)) continue;
    if (x.state !== "yes" && x.state !== "maybe" && x.state !== "no" && x.state !== "none") continue;
    let id = str(x.id, 100) || uid();
    if (answerIds.has(id)) id = uid();
    answerIds.add(id);
    const at = str(x.at, 16);
    const answer: Answer = {
      id,
      personId,
      dateId,
      state: x.state,
      note: str(x.note, 2000).trim(),
      at: AT_RE.test(at) ? at : "",
      source: x.source === "paste" ? "paste" : "manual",
    };
    out.answers.push(answer);
  }
  out.words = normalizeWords(r.words);
  out.intro = typeof r.intro === "string" ? r.intro.slice(0, 1000) : DEFAULT_INTRO;
  normalizeScenes(r, out, people);
  return out;
}

/** Reads the `data` block of a file. Missing fields get their defaults; unknown ones are kept. */
export function normalizeData(raw: unknown): CantinellaData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const people: Person[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(r.people) ? r.people : []) {
    const person = normalizePerson(p);
    if (!person) continue;
    // Identifiers must be unique: a duplicate gets a new one rather than being lost.
    if (seen.has(person.id)) person.id = uid();
    seen.add(person.id);
    people.push(person);
  }
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!KNOWN_KEYS.has(k)) extra[k] = v;
  const rehearsals = normalizeRehearsals(r.rehearsals, people);
  const personIds = new Set(people.map((p) => p.id));
  return {
    id: str(r.id, 100) || uid(),
    title: str(r.title, 200),
    people,
    rehearsals,
    budget: normalizeBudget(r.budget),
    departments: normalizeDepartments(r.departments, personIds, new Set(rehearsals.dates.map((d) => d.id))),
    tour: normalizeTour(r.tour, personIds),
    extra,
  };
}

export function serialize(data: CantinellaData, app: { name: string; version: string }, now = new Date()): string {
  const file = {
    format: FILE_FORMAT,
    formatVersion: FILE_FORMAT_VERSION,
    app,
    savedAt: now.toISOString(),
    data: { ...data.extra, id: data.id, title: data.title, people: data.people, rehearsals: data.rehearsals, budget: data.budget, departments: data.departments, tour: data.tour },
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parse(text: string): CantinellaData {
  let v: unknown;
  try {
    v = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new CantinellaFileError("not-json");
  }
  if (!v || typeof v !== "object" || (v as { format?: unknown }).format !== FILE_FORMAT) throw new CantinellaFileError("not-cantinella");
  const f = v as { formatVersion?: unknown; data?: unknown };
  if (typeof f.formatVersion !== "number") throw new CantinellaFileError("damaged");
  if (f.formatVersion > FILE_FORMAT_VERSION) throw new CantinellaFileError("newer");
  // No older formats exist before the suite is published: anything else is refused, not guessed.
  if (f.formatVersion !== FILE_FORMAT_VERSION) throw new CantinellaFileError("unsupported");
  if (f.data !== undefined && (typeof f.data !== "object" || f.data === null || Array.isArray(f.data))) throw new CantinellaFileError("damaged");
  return normalizeData(f.data ?? {});
}
