import { uid } from "@theatre-suite/core";
import { FILE_FORMAT, FILE_FORMAT_VERSION, type CantinellaData, type Person } from "./types";

export type FileProblem = "not-json" | "not-cantinella" | "newer" | "unsupported" | "damaged";

export class CantinellaFileError extends Error {
  constructor(public problem: FileProblem) {
    super(problem);
  }
}

const KNOWN_KEYS = new Set(["id", "title", "people"]);

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.slice(0, max) : "");
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 50) : [];

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
  };
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
  return { id: str(r.id, 100) || uid(), title: str(r.title, 200), people, extra };
}

export function serialize(data: CantinellaData, app: { name: string; version: string }, now = new Date()): string {
  const file = {
    format: FILE_FORMAT,
    formatVersion: FILE_FORMAT_VERSION,
    app,
    savedAt: now.toISOString(),
    data: { ...data.extra, id: data.id, title: data.title, people: data.people },
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
