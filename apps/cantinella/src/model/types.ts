/**
 * Cantinella document, format 1 (see 09_cantinella.md).
 *
 * One file per show production, JSON, readable. Every element that other parts of the
 * suite may link to (people now; dates, scenes, costs later) has a stable `id` that never
 * changes when it is renamed or moved.
 */

import type { Budget } from "./budget";
import type { Departments } from "./departments";
import type { Tour } from "./tour";

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
  /** Production details, optional: costume sizes, allergies and needs, documents for the permits, availability for the tour. */
  prod: PersonProd;
}

export interface PersonProd {
  sizes: string;
  needs: string;
  documents: string;
  tour: string;
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

/** A character of the show. `actorIds[0]` plays it; the others are understudies, in order. */
export interface Character {
  id: string;
  name: string;
  actorIds: string[];
  /** Id of the character in the linked Bardo script (stable), if it came from there. */
  bardoId: string;
}

/** A scene (or anything to rehearse: "final dance", "bows"). */
export interface Scene {
  id: string;
  name: string;
  /** Act or group, free text ("Atto I"). */
  act: string;
  characterIds: string[];
  /** People whose presence is welcome but not required for this scene. */
  optional: string[];
  /** How many times it should be rehearsed. */
  weight: number;
  /** Rehearsal time it needs, in minutes. */
  minutes: number;
  bardoId: string;
}

/** A scene put on a date of the plan. `locked` = fixed by the director: "recalculate" keeps it. */
export interface PlanItem {
  id: string;
  dateId: string;
  sceneId: string;
  locked: boolean;
}

/** The Bardo script scenes and characters are read from (read only, never written). */
export interface BardoLink {
  path: string;
  title: string;
  /** Fingerprint of the file when it was read: a different one means "the script has changed". */
  hash: string;
  readAt: string;
}

/** Rehearsals, section 1 of the app. */
export interface Rehearsals {
  dates: RehearsalDate[];
  answers: Answer[];
  words: CustomWords;
  /** First line of the message with the dates (editable). */
  intro: string;
  characters: Character[];
  scenes: Scene[];
  plan: PlanItem[];
  /** The plan may convene someone who answered "maybe" (shown in amber). */
  allowMaybe: boolean;
  bardo: BardoLink | null;
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
  budget: Budget;
  departments: Departments;
  tour: Tour;
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
