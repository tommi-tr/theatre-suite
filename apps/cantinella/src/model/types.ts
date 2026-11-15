/**
 * Cantinella document, format 1 (see 09_cantinella.md).
 *
 * One file per show production, JSON, readable. Every element that other parts of the
 * suite may link to (people now; dates, scenes, costs later) has a stable `id` that never
 * changes when it is renamed or moved.
 */

export const FILE_FORMAT = "cantinella";
/** Until the suite is published only this format is read (00_indice_e_stato.md). */
export const FILE_FORMAT_VERSION = 1;

/** Preset roles; any other text is a custom role. */
export const PRESET_ROLES = ["actor", "director", "crew", "production"] as const;
export type PresetRole = (typeof PRESET_ROLES)[number];

export interface Person {
  id: string;
  name: string;
  /** Other names that identify the person in pasted messages ("Gio", a phone number…). */
  aliases: string[];
  phone: string;
  email: string;
  /** Preset keys (`actor`, `crew`…) or free text. */
  roles: string[];
  notes: string;
}

/** What a person answered for a date. `none` = the answer was cleared (the history keeps it). */
export type AnswerState = "yes" | "maybe" | "no" | "none";

/** A rehearsal the director can propose. */
export interface RehearsalDate {
  id: string;
  /** Local day, `YYYY-MM-DD`. */
  day: string;
  /** Start time, `HH:MM`. */
  time: string;
  /** Length in minutes. */
  minutes: number;
  place: string;
}

/**
 * One answer to a date. The answers of a person for a date form a history: the **last** one
 * in the list is the current answer, the earlier ones stay for consultation.
 */
export interface Answer {
  id: string;
  personId: string;
  dateId: string;
  state: AnswerState;
  /** Free words after the answer ("esco alle 17"). */
  note: string;
  /** When it was given: local time `YYYY-MM-DDTHH:MM` (message time if known, otherwise when entered). */
  at: string;
  /** `paste` = read from a pasted message, `manual` = set by hand in the table. */
  source: "paste" | "manual";
}

/** Words the director adds to the ones Cantinella already knows ("ok", "x", "boh"). */
export interface CustomWords {
  yes: string[];
  maybe: string[];
  no: string[];
}

/** Rehearsals, section 1 of the app (fase 1: dates and availability). */
export interface Rehearsals {
  dates: RehearsalDate[];
  answers: Answer[];
  words: CustomWords;
  /** First line of the message with the dates (editable). */
  intro: string;
}

/** The five sections of the app. */
export type SectionId = "rehearsals" | "budget" | "departments" | "tour" | "calendar";

export interface CantinellaData {
  /** Stable identifier of this production document. */
  id: string;
  /** Title of the document (the show name comes from the launcher). */
  title: string;
  people: Person[];
  rehearsals: Rehearsals;
  /**
   * Data of the sections that arrive in later versions (rehearsals, budget…) and fields
   * written by newer versions: kept untouched when the file is saved again.
   */
  extra: Record<string, unknown>;
}

export interface CantinellaFile {
  format: typeof FILE_FORMAT;
  formatVersion: number;
  app: { name: string; version: string };
  savedAt: string;
  data: Record<string, unknown>;
}
