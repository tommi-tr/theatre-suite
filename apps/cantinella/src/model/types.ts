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

/** The five sections of the app. */
export type SectionId = "rehearsals" | "budget" | "departments" | "tour" | "calendar";

export interface CantinellaData {
  /** Stable identifier of this production document. */
  id: string;
  /** Title of the document (the show name comes from the launcher). */
  title: string;
  people: Person[];
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
