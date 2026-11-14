import type { FormatModel } from "../format/model";

/** Language of the script itself (labels like "Atto primo", hyphenation, spelling). */
export type DocLang = "it" | "en";

/** How acts, tableaux and scenes are numbered: "primo", "I" or "1". */
export type Numbering = "words" | "roman" | "arabic";

/** Title page data ("Titolo" sheet). */
export interface Meta {
  title: string;
  subtitle: string;
  /** "Liberamente ispirato a…" */
  basedOn: string;
  authors: string;
  /** Translation or adaptation credits. */
  translation: string;
}

/** A character. Its id never changes, the name can be changed everywhere at once. */
export interface Character {
  id: string;
  name: string;
  /** Short description, e.g. "re di Danimarca". */
  short: string;
  /** Long description, for the director and the company. */
  long: string;
  /** Actor or actress playing the part (Cast e troupe). */
  actor: string;
}

/** A role of the company (Regia, Luci, Audio…). */
export interface CastRole {
  id: string;
  role: string;
  people: string;
}

export type CatIcon = "user" | "box" | "set" | "shirt" | "bulb" | "sound" | "music" | "sparkle" | "brush" | "video" | "tag";

/** Category of things the text mentions: objects, lights, sounds… */
export interface Category {
  id: string;
  name: string;
  icon: CatIcon;
  /** Built-in categories cannot be deleted. */
  builtin: boolean;
}

/** An entry of a category (the "lanterna" object, the "ambra" light…). */
export interface CatItem {
  id: string;
  cat: string;
  name: string;
  description: string;
}

/** A working note anchored to some text (not printed unless asked). */
export interface Note {
  id: string;
  text: string;
  author: string;
  created: string;
}

/** Record of an export: who received which version. */
export interface SendRecord {
  at: string;
  version: string;
  format: string;
  audience: string;
}

/** Everything that is not running text: kept in the document attributes so undo covers it. */
export interface DocData {
  lang: DocLang;
  meta: Meta;
  characters: Character[];
  cast: CastRole[];
  categories: Category[];
  items: CatItem[];
  notes: Note[];
  /** Text version, e.g. "2.3". */
  version: string;
  /** Free label shown next to the version, e.g. "bozza". */
  versionLabel: string;
  format: FormatModel;
  sends: SendRecord[];
}

/** The id of the built-in characters category (its entries are the characters). */
export const CHARACTER_CAT = "personaggio";

/** Kinds of automatic blocks ("macro") Bardo writes by itself. */
export type AutoKind = "title" | "characters" | "cast" | "list";

/** What an automatic list shows (the "Elenco automatico" window). */
export interface ListConfig {
  /** Category ids, or "scenes" for acts and scenes (a table of contents). */
  what: string[];
  form: "list" | "table";
  order: "alpha" | "entry";
  group: "none" | "act" | "scene";
  /** Next to every entry. */
  description: boolean;
  where: "none" | "every" | "first" | "firstLast";
  pages: boolean;
  /** For scenes: characters on stage. */
  present: boolean;
  /** Table columns: one per scene or one per act. */
  columns: "scene" | "act";
  title: string;
}

export interface CharactersConfig {
  show: "name" | "short" | "long";
  order: "manual" | "alpha" | "entry";
  title: string;
}

export interface CastConfig {
  showActors: boolean;
  title: string;
}

export interface TitleConfig {
  showSubtitle: boolean;
  showBasedOn: boolean;
  showAuthors: boolean;
  showTranslation: boolean;
  showVersion: boolean;
}
