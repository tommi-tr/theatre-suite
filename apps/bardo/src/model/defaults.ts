import { uid } from "@theatre-suite/core";
import type { Node as PMNode } from "prosemirror-model";
import { classico } from "../format/model";
import { schema } from "./schema";
import { CHARACTER_CAT, type Category, type CastConfig, type CharactersConfig, type DocData, type DocLang, type ListConfig, type TitleConfig } from "./types";

/** Short random id (stable for the life of the element). */
export function newId(prefix: string): string {
  return `${prefix}-${uid().replace(/-/g, "").slice(0, 12)}`;
}

/** Built-in categories. Names are stored in the document language. */
export function defaultCategories(lang: DocLang): Category[] {
  const it = lang === "it";
  return [
    { id: CHARACTER_CAT, name: it ? "Personaggio" : "Character", icon: "user", builtin: true },
    { id: "oggetto", name: it ? "Oggetto" : "Prop", icon: "box", builtin: true },
    { id: "scenografia", name: it ? "Scenografia" : "Set", icon: "set", builtin: true },
    { id: "costume", name: it ? "Costume" : "Costume", icon: "shirt", builtin: true },
    { id: "luce", name: it ? "Luce" : "Light", icon: "bulb", builtin: true },
    { id: "suono", name: it ? "Suono" : "Sound", icon: "sound", builtin: true },
  ];
}

/** Extra categories offered under "Altre". */
export function extraCategories(lang: DocLang): Category[] {
  const it = lang === "it";
  return [
    { id: "musica", name: it ? "Musica" : "Music", icon: "music", builtin: false },
    { id: "effetto", name: it ? "Effetto" : "Effect", icon: "sparkle", builtin: false },
    { id: "trucco", name: it ? "Trucco" : "Make-up", icon: "brush", builtin: false },
    { id: "video", name: "Video", icon: "video", builtin: false },
  ];
}

export function defaultCastRoles(lang: DocLang): { role: string }[] {
  const it = lang === "it";
  return (it
    ? ["Autore", "Regia", "Aiuto regia", "Scenografia", "Costumi", "Luci", "Audio", "Direzione di scena"]
    : ["Author", "Director", "Assistant director", "Set design", "Costumes", "Lighting", "Sound", "Stage manager"]
  ).map((role) => ({ role }));
}

export function emptyData(lang: DocLang): DocData {
  return {
    lang,
    meta: { title: "", subtitle: "", basedOn: "", authors: "", translation: "" },
    characters: [],
    cast: [],
    categories: defaultCategories(lang),
    items: [],
    notes: [],
    version: "0.1",
    versionLabel: lang === "it" ? "bozza" : "draft",
    format: classico(),
    sends: [],
  };
}

export const DEFAULT_TITLE_CONFIG: TitleConfig = { showSubtitle: true, showBasedOn: true, showAuthors: true, showTranslation: true, showVersion: false };
export const DEFAULT_CHARACTERS_CONFIG = (lang: DocLang): CharactersConfig => ({ show: "short", order: "manual", title: lang === "it" ? "Personaggi" : "Characters" });
export const DEFAULT_CAST_CONFIG = (lang: DocLang): CastConfig => ({ showActors: true, title: lang === "it" ? "Cast e troupe" : "Cast and crew" });

export function defaultListConfig(lang: DocLang, preset: "list" | "index" | "toc" | "table" | "presence" = "list"): ListConfig {
  const it = lang === "it";
  const base: ListConfig = {
    what: ["oggetto"],
    form: "list",
    order: "alpha",
    group: "none",
    description: false,
    where: "none",
    pages: false,
    present: false,
    columns: "scene",
    title: it ? "Oggetti di scena" : "Props",
  };
  switch (preset) {
    case "index":
      return { ...base, where: "every", pages: true, title: it ? "Indice degli oggetti" : "Index of props" };
    case "toc":
      return { ...base, what: ["scenes"], order: "entry", pages: true, title: it ? "Sommario" : "Contents" };
    case "table":
    case "presence":
      return { ...base, what: [CHARACTER_CAT], form: "table", order: "entry", columns: "scene", title: it ? "Presenze per scena" : "Who is in each scene" };
    default:
      return base;
  }
}

/** A new, empty script: title page, characters, first act and scene, an empty line. */
export function newScriptDoc(lang: DocLang): PMNode {
  const data = emptyData(lang);
  const n = schema.nodes;
  return n.doc.create({ data }, [
    n.auto.create({ id: newId("auto"), kind: "title", config: DEFAULT_TITLE_CONFIG }),
    n.auto.create({ id: newId("auto"), kind: "characters", config: DEFAULT_CHARACTERS_CONFIG(lang) }),
    n.act.create({ id: newId("act") }),
    n.scene.create({ id: newId("scene") }),
    n.direction.create({ id: newId("dir") }),
  ]);
}

export function getData(doc: PMNode): DocData {
  return (doc.attrs.data as DocData | null) ?? emptyData("it");
}
