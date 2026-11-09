import type { Numbering } from "../model/types";

export type FontKey = "serif" | "sans" | "mono";
export type Caps = "normal" | "small" | "upper";
export type Align = "left" | "center" | "right" | "justify";

/** Style of one element of the script (applied everywhere it appears). */
export interface TextStyle {
  font: FontKey;
  /** Points. */
  size: number;
  bold: boolean;
  italic: boolean;
  caps: Caps;
  /** Letter spacing in thousandths of an em (50 = +5 %). */
  tracking: number;
  align: Align;
  /** Space before and after, in points. */
  before: number;
  after: number;
  lineHeight: number;
  color: string;
}

export type StyleKey =
  | "title"
  | "subtitle"
  | "credits"
  | "section"
  | "body"
  | "act"
  | "tableau"
  | "scene"
  | "place"
  | "speaker"
  | "speech"
  | "inline"
  | "direction"
  | "number"
  | "header"
  | "list";

export const STYLE_KEYS: StyleKey[] = [
  "title", "subtitle", "credits", "section", "body", "act", "tableau", "scene", "place",
  "speaker", "speech", "inline", "direction", "number", "header", "list",
];

/** Page margins in millimetres. Inner/outer become left/right when pages are not mirrored. */
export interface Margins {
  top: number;
  bottom: number;
  inner: number;
  outer: number;
}

export type PageSize = "A4" | "A5" | "Letter";
export const PAGE_SIZES: Record<PageSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  Letter: { w: 215.9, h: 279.4 },
};

export type HeaderField = "none" | "title" | "actScene" | "page" | "pageOfTotal" | "version" | "characters";

export interface HeaderFooter {
  left: HeaderField;
  center: HeaderField;
  right: HeaderField;
}

/** How a category is written on paper. */
export interface CatStyle {
  caps: Caps;
  italic: boolean;
  bold: boolean;
}

export interface FormatModel {
  /** Id of the preset or saved model this format started from. */
  base: string;
  /** Name shown in the Formatta bar. */
  name: string;
  /** True after the first change to a preset ("Personalizzato"). */
  custom: boolean;
  page: { size: PageSize; doc: Margins; script: Margins; mirror: boolean };
  styles: Record<StyleKey, TextStyle>;
  cats: Record<string, CatStyle>;
  speech: {
    /** Where the character's name goes. */
    namePos: "left" | "above" | "inline";
    /** Distance of the speech text from the margin (mm), when the name is on the left. */
    indent: number;
    /** Widen the name column to the longest name. */
    autoIndent: boolean;
  };
  partition: {
    numbering: Numbering;
    actNewPage: boolean;
    sceneNewPage: boolean;
    /** Lines of text that must follow a heading on the same page. */
    keepLines: number;
    /** Scenes restart from 1 at every act. */
    sceneResetPerAct: boolean;
  };
  options: {
    lineNumbers: boolean;
    lineNumbersEvery: 1 | 5 | 10;
    /** A speech split over two pages repeats the name with "(segue)". */
    continued: boolean;
    /** No single lines at the top or bottom of a page. */
    widows: boolean;
    /** A stage direction stays with the speech that follows. */
    keepDirection: boolean;
    hyphenate: boolean;
    smartPunctuation: boolean;
  };
  header: HeaderFooter & { onDocPages: boolean };
  footer: HeaderFooter & { onFirstPage: boolean };
  /** Text written across every page (empty = none). */
  watermark: string;
}

function st(p: Partial<TextStyle>): TextStyle {
  return {
    font: "serif",
    size: 12,
    bold: false,
    italic: false,
    caps: "normal",
    tracking: 0,
    align: "left",
    before: 0,
    after: 0,
    lineHeight: 1.35,
    color: "#1b1c21",
    ...p,
  };
}

const DEFAULT_CATS: Record<string, CatStyle> = {
  personaggio: { caps: "small", italic: false, bold: false },
  oggetto: { caps: "upper", italic: false, bold: false },
  scenografia: { caps: "normal", italic: false, bold: false },
  costume: { caps: "normal", italic: false, bold: false },
  luce: { caps: "normal", italic: false, bold: false },
  suono: { caps: "normal", italic: false, bold: false },
};

/** "Classico": the default, set like a well printed theatre edition. */
export function classico(): FormatModel {
  return {
    base: "classico",
    name: "Classico",
    custom: false,
    page: {
      size: "A4",
      doc: { top: 25, bottom: 25, inner: 25, outer: 25 },
      script: { top: 22, bottom: 20, inner: 25, outer: 25 },
      mirror: false,
    },
    styles: {
      title: st({ size: 30, caps: "small", tracking: 60, align: "center", lineHeight: 1.15, after: 6 }),
      subtitle: st({ size: 14, italic: true, align: "center", after: 30, color: "#33363d" }),
      credits: st({ size: 12, align: "center", after: 4 }),
      section: st({ size: 15, caps: "small", tracking: 160, align: "center", before: 6, after: 14 }),
      body: st({ size: 12, after: 6, align: "justify" }),
      act: st({ size: 15, caps: "small", tracking: 160, align: "center", before: 0, after: 14 }),
      tableau: st({ size: 13, caps: "small", tracking: 120, align: "center", before: 10, after: 10 }),
      scene: st({ size: 12.5, caps: "small", tracking: 100, align: "center", before: 14, after: 2 }),
      place: st({ size: 11.5, italic: true, align: "center", after: 12, color: "#33363d" }),
      speaker: st({ size: 11.5, bold: true, caps: "small", tracking: 50 }),
      speech: st({ size: 12, after: 3 }),
      inline: st({ italic: true, color: "#33363d" }),
      direction: st({ size: 11.5, italic: true, before: 4, after: 7, color: "#2b2e35" }),
      number: st({ font: "serif", size: 8.5, color: "#6f737d" }),
      header: st({ size: 9, italic: true, color: "#6f737d" }),
      list: st({ size: 12, lineHeight: 1.5 }),
    },
    cats: { ...DEFAULT_CATS },
    speech: { namePos: "left", indent: 34, autoIndent: true },
    partition: { numbering: "words", actNewPage: true, sceneNewPage: false, keepLines: 3, sceneResetPerAct: true },
    options: { lineNumbers: true, lineNumbersEvery: 1, continued: true, widows: true, keepDirection: true, hyphenate: true, smartPunctuation: true },
    header: { left: "title", center: "none", right: "actScene", onDocPages: false },
    footer: { left: "none", center: "page", right: "none", onFirstPage: false },
    watermark: "",
  };
}

/** "Contemporaneo": a clean sans serif, names above the speech. */
export function contemporaneo(): FormatModel {
  const m = classico();
  const sans = (s: TextStyle): TextStyle => ({ ...s, font: "sans" });
  const styles = Object.fromEntries(Object.entries(m.styles).map(([k, v]) => [k, sans(v)])) as Record<StyleKey, TextStyle>;
  styles.title = { ...styles.title, caps: "upper", tracking: 20, size: 26, bold: true };
  styles.speaker = { ...styles.speaker, caps: "upper", tracking: 60, size: 10.5 };
  styles.speech = { ...styles.speech, size: 11, lineHeight: 1.45, after: 8 };
  styles.direction = { ...styles.direction, size: 10.5, color: "#4a4e58" };
  styles.act = { ...styles.act, caps: "upper", bold: true, tracking: 120, size: 13 };
  styles.scene = { ...styles.scene, caps: "upper", bold: true, tracking: 80, size: 11 };
  return {
    ...m,
    base: "contemporaneo",
    name: "Contemporaneo",
    styles,
    speech: { namePos: "above", indent: 34, autoIndent: false },
    partition: { ...m.partition, numbering: "arabic" },
  };
}

/** "Leggio": large type for reading at rehearsals. */
export function leggio(): FormatModel {
  const m = classico();
  const bigger = (s: TextStyle): TextStyle => ({ ...s, size: Math.round(s.size * 1.25 * 2) / 2 });
  const styles = Object.fromEntries(Object.entries(m.styles).map(([k, v]) => [k, k === "number" || k === "header" ? v : bigger(v)])) as Record<StyleKey, TextStyle>;
  styles.speech = { ...styles.speech, lineHeight: 1.45, after: 6 };
  return {
    ...m,
    base: "leggio",
    name: "Leggio",
    styles,
    speech: { namePos: "left", indent: 40, autoIndent: true },
    page: { ...m.page, script: { top: 18, bottom: 18, inner: 22, outer: 30 } },
  };
}

/** "Dattiloscritto": monospaced, like a typewritten script. */
export function dattiloscritto(): FormatModel {
  const m = classico();
  const mono = (s: TextStyle): TextStyle => ({ ...s, font: "mono", tracking: 0, lineHeight: 1.2, size: s.size >= 14 ? 14 : 12 });
  const styles = Object.fromEntries(Object.entries(m.styles).map(([k, v]) => [k, mono(v)])) as Record<StyleKey, TextStyle>;
  styles.speaker = { ...styles.speaker, caps: "upper", bold: false };
  styles.act = { ...styles.act, caps: "upper", align: "center" };
  styles.scene = { ...styles.scene, caps: "upper" };
  styles.body = { ...styles.body, align: "left" };
  styles.direction = { ...styles.direction, italic: false, color: "#1b1c21" };
  styles.inline = { ...styles.inline, italic: false, color: "#1b1c21" };
  styles.number = { ...styles.number, size: 9 };
  styles.header = { ...styles.header, size: 10, italic: false };
  return {
    ...m,
    base: "dattiloscritto",
    name: "Dattiloscritto",
    styles,
    speech: { namePos: "above", indent: 38, autoIndent: false },
    partition: { ...m.partition, numbering: "arabic" },
    cats: { ...m.cats, personaggio: { caps: "upper", italic: false, bold: false } },
    options: { ...m.options, hyphenate: false },
  };
}

export const PRESETS: { id: string; make: () => FormatModel; descKey: string }[] = [
  { id: "classico", make: classico, descKey: "Serif type, names on the left: like a printed edition." },
  { id: "contemporaneo", make: contemporaneo, descKey: "Clean sans serif, names above the speech." },
  { id: "leggio", make: leggio, descKey: "Large type to read from the music stand at rehearsals." },
  { id: "dattiloscritto", make: dattiloscritto, descKey: "Monospaced, like a typewritten script." },
];

export function presetById(id: string): FormatModel | null {
  const p = PRESETS.find((x) => x.id === id);
  return p ? p.make() : null;
}

/** Fills missing fields of a format read from a file (older or damaged files). */
export function normalizeFormat(raw: unknown): FormatModel {
  const def = classico();
  if (!raw || typeof raw !== "object") return def;
  const r = raw as Partial<FormatModel>;
  const styles = { ...def.styles };
  if (r.styles && typeof r.styles === "object") {
    for (const k of STYLE_KEYS) {
      const s = (r.styles as Record<string, Partial<TextStyle>>)[k];
      if (s && typeof s === "object") styles[k] = { ...def.styles[k], ...s };
    }
  }
  return {
    ...def,
    ...r,
    page: { ...def.page, ...(r.page ?? {}), doc: { ...def.page.doc, ...(r.page?.doc ?? {}) }, script: { ...def.page.script, ...(r.page?.script ?? {}) } },
    styles,
    cats: { ...def.cats, ...(r.cats ?? {}) },
    speech: { ...def.speech, ...(r.speech ?? {}) },
    partition: { ...def.partition, ...(r.partition ?? {}) },
    options: { ...def.options, ...(r.options ?? {}) },
    header: { ...def.header, ...(r.header ?? {}) },
    footer: { ...def.footer, ...(r.footer ?? {}) },
    watermark: typeof r.watermark === "string" ? r.watermark : "",
    name: typeof r.name === "string" && r.name ? r.name : def.name,
    base: typeof r.base === "string" && r.base ? r.base : def.base,
    custom: !!r.custom,
  };
}
