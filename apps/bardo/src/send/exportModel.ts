import type { Mark, Node as PMNode } from "prosemirror-model";
import { getData } from "../model/defaults";
import { DEFAULT_CAST_CONFIG, DEFAULT_CHARACTERS_CONFIG, DEFAULT_TITLE_CONFIG, defaultListConfig } from "../model/defaults";
import { deriveIndex, type DocIndex } from "../model/derive";
import { buildList, orderedCharacters, type PageOf } from "../model/lists";
import type { CastConfig, CharactersConfig, DocData, ListConfig, TitleConfig } from "../model/types";
import { DOC_WORDS } from "../editor/autoRender";
import type { Align, Caps, CatStyle, FontKey, FormatModel, StyleKey } from "../format/model";

/*
 * A neutral description of the script used by every exporter (Word,
 * LibreOffice, plain text). It contains only the current text: the old
 * versions kept inside the .bardo file are never exported.
 */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  caps?: Caps | "lower";
  color?: string;
  /** Points. */
  size?: number;
  font?: FontKey;
  highlight?: string;
  /** A line break inside the paragraph (text is empty). */
  br?: boolean;
}

export type XBlock =
  | { kind: "para"; style: StyleKey; runs: Run[]; align?: Align; indent?: number; list?: "bullet" | "number"; pageBefore?: boolean; tabRight?: boolean }
  | { kind: "speech"; name: string; speaker: string; runs: Run[]; num?: number; pageBefore?: boolean; highlight?: boolean }
  | { kind: "table"; corner: string; columns: string[]; rows: { name: string; cells: boolean[] }[] };

export interface ExportOptions {
  /** Copy for an actor: their speeches are highlighted. */
  actor?: string;
  /** Copy for a department: words of this category are highlighted. */
  category?: string;
  /** Text written on every page (watermark). */
  watermark?: string;
}

export interface ExportDoc {
  data: DocData;
  format: FormatModel;
  blocks: XBlock[];
  /** Short label used in headers ("Amleto"). */
  title: string;
  options: ExportOptions;
}

export const HIGHLIGHT = "#fff2a8";

function catStyleRun(c: CatStyle | undefined): Partial<Run> {
  if (!c) return {};
  const r: Partial<Run> = {};
  if (c.caps !== "normal") r.caps = c.caps;
  if (c.italic) r.italic = true;
  if (c.bold) r.bold = true;
  return r;
}

/** Runs of a text block, with marks turned into simple formatting. */
export function runsOf(node: PMNode, f: FormatModel, opts: ExportOptions): Run[] {
  const runs: Run[] = [];
  node.forEach((child) => {
    if (child.type.name === "hard_break") {
      runs.push({ text: "", br: true });
      return;
    }
    if (!child.isText || !child.text) return;
    const r: Run = { text: child.text };
    for (const m of child.marks as readonly Mark[]) {
      switch (m.type.name) {
        case "inline_dir": {
          const s = f.styles.inline;
          if (s.italic) r.italic = true;
          if (s.bold) r.bold = true;
          if (s.color && s.color.toLowerCase() !== "#1b1c21") r.color = s.color;
          if (s.caps !== "normal") r.caps = s.caps;
          break;
        }
        case "cat":
          Object.assign(r, catStyleRun(f.cats[m.attrs.cat as string]));
          if (opts.category && m.attrs.cat === opts.category) r.highlight = HIGHLIGHT;
          break;
        case "strong":
          r.bold = true;
          break;
        case "em":
          r.italic = !r.italic;
          break;
        case "underline":
          r.underline = true;
          break;
        case "color":
          r.color = m.attrs.color as string;
          break;
        case "highlight":
          r.highlight = m.attrs.color as string;
          break;
        case "fontsize":
          r.size = m.attrs.size as number;
          break;
        case "font":
          r.font = m.attrs.font as FontKey;
          break;
        case "caps":
          r.caps = m.attrs.mode as Caps | "lower";
          break;
      }
    }
    runs.push(r);
  });
  return runs;
}

const plain = (text: string, extra: Partial<Run> = {}): Run[] => (text ? [{ text, ...extra }] : []);

function autoBlocks(node: PMNode, data: DocData, index: DocIndex, pageOf: PageOf): XBlock[] {
  const cfg = (node.attrs.config && typeof node.attrs.config === "object" ? node.attrs.config : {}) as Record<string, unknown>;
  const w = DOC_WORDS[data.lang];
  const f = data.format;
  const charStyle = catStyleRun(f.cats.personaggio);
  const out: XBlock[] = [];
  const para = (style: StyleKey, runs: Run[], extra: Partial<Extract<XBlock, { kind: "para" }>> = {}) => {
    if (runs.length) out.push({ kind: "para", style, runs, ...extra });
  };
  switch (node.attrs.kind) {
    case "title": {
      const c: TitleConfig = { ...DEFAULT_TITLE_CONFIG, ...(cfg as Partial<TitleConfig>) };
      const m = data.meta;
      para("title", plain(m.title));
      if (c.showSubtitle) para("subtitle", plain(m.subtitle));
      if (c.showBasedOn && m.basedOn) para("credits", plain(`${w.basedOn} ${m.basedOn}`));
      if (c.showAuthors && m.authors) para("credits", plain(`${w.by} ${m.authors}`));
      if (c.showTranslation) para("credits", plain(m.translation));
      if (c.showVersion) para("credits", plain(`${w.version} ${data.version}${data.versionLabel ? ` · ${data.versionLabel}` : ""}`));
      break;
    }
    case "characters": {
      const c: CharactersConfig = { ...DEFAULT_CHARACTERS_CONFIG(data.lang), ...(cfg as Partial<CharactersConfig>) };
      para("section", plain(c.title));
      for (const ch of orderedCharacters(data, index, c.order)) {
        const runs: Run[] = [{ text: ch.name, ...charStyle }];
        if (c.show !== "name" && ch.short) runs.push({ text: `, ${ch.short}` });
        para("list", runs);
        if (c.show === "long" && ch.long) para("body", plain(ch.long), { indent: 1 });
      }
      break;
    }
    case "cast": {
      const c: CastConfig = { ...DEFAULT_CAST_CONFIG(data.lang), ...(cfg as Partial<CastConfig>) };
      para("section", plain(c.title));
      for (const r of data.cast.filter((x) => x.role.trim())) para("list", [{ text: r.role, bold: true }, { text: `\t${r.people}` }]);
      const actors = c.showActors ? data.characters.filter((ch) => ch.actor.trim()) : [];
      if (actors.length) {
        para("list", [{ text: w.actors, bold: true }]);
        for (const ch of actors) para("list", [{ text: ch.name, ...charStyle }, { text: `\t${ch.actor}` }]);
      }
      break;
    }
    default: {
      const c: ListConfig = { ...defaultListConfig(data.lang), ...(cfg as Partial<ListConfig>) };
      for (const b of buildList(c, data, index, pageOf)) {
        switch (b.type) {
          case "title":
            para("section", plain(b.text));
            break;
          case "group":
            para("list", [{ text: b.text, bold: true }]);
            break;
          case "entry":
            para("list", [{ text: b.name, ...(b.character ? charStyle : {}) }, ...(b.refs ? [{ text: `\t${b.refs}` }] : [])], { tabRight: !!b.refs });
            if (b.desc) para("list", plain(b.desc, { italic: true }), { indent: 1 });
            if (b.present) para("list", plain(b.present, { italic: true }), { indent: 1 });
            break;
          case "table":
            out.push({ kind: "table", corner: b.corner, columns: b.columns, rows: b.rows.map((r) => ({ name: r.name, cells: r.cells })) });
            break;
          case "empty":
            break;
        }
      }
    }
  }
  return out;
}

/** Describes the current script for the exporters. */
export function buildExport(doc: PMNode, opts: ExportOptions, pageOf: PageOf = () => null): ExportDoc {
  const data = getData(doc);
  const f = data.format;
  const index = deriveIndex(doc);
  const blocks: XBlock[] = [];
  let pageNext = false;
  let prevType = "";
  let prevAutoTitle = false;
  doc.forEach((node, pos) => {
    const type = node.type.name;
    const hasContent = blocks.length > 0;
    let pageBefore =
      hasContent &&
      (pageNext ||
        (type === "act" && f.partition.actNewPage) ||
        (type === "scene" && f.partition.sceneNewPage && prevType !== "act" && prevType !== "tableau") ||
        prevAutoTitle ||
        (type === "auto" && node.attrs.kind === "title"));
    pageNext = false;
    const part = index.parts.find((p) => p.pos === pos);
    const push = (b: XBlock) => {
      if (pageBefore && b.kind !== "table") {
        (b as { pageBefore?: boolean }).pageBefore = true;
        pageBefore = false;
      }
      blocks.push(b);
    };
    switch (type) {
      case "paragraph":
        push({ kind: "para", style: "body", runs: runsOf(node, f, opts), align: (node.attrs.align as Align) ?? undefined, indent: node.attrs.indent || undefined, list: node.attrs.list ?? undefined });
        break;
      case "section":
        push({ kind: "para", style: "section", runs: runsOf(node, f, opts) });
        break;
      case "act":
      case "tableau":
        push({ kind: "para", style: type, runs: plain(part?.label ?? "") });
        if (node.attrs.title) push({ kind: "para", style: "place", runs: plain(node.attrs.title as string), align: f.styles[type].align });
        break;
      case "scene":
        push({ kind: "para", style: "scene", runs: plain(part?.label ?? "") });
        if (node.attrs.place) push({ kind: "para", style: "place", runs: plain(node.attrs.place as string) });
        break;
      case "speech": {
        const n = index.speechNumber.get(pos);
        const every = f.options.lineNumbersEvery;
        push({
          kind: "speech",
          name: (node.attrs.name as string) || "?",
          speaker: node.attrs.speaker as string,
          runs: runsOf(node, f, opts),
          num: f.options.lineNumbers && n && n % every === 0 ? n : undefined,
          highlight: !!opts.actor && node.attrs.speaker === opts.actor,
        });
        break;
      }
      case "direction":
        push({ kind: "para", style: "direction", runs: runsOf(node, f, opts) });
        break;
      case "auto":
        for (const b of autoBlocks(node, data, index, pageOf)) push(b);
        break;
      case "page_break":
        pageNext = hasContent;
        break;
    }
    prevType = type;
    prevAutoTitle = type === "auto" && node.attrs.kind === "title";
  });
  return { data, format: f, blocks, title: data.meta.title.trim(), options: opts };
}

/** Text of runs, with capitals applied (for formats that cannot draw them). */
export function runText(r: Run): string {
  if (r.br) return "\n";
  if (r.caps === "upper") return r.text.toLocaleUpperCase();
  if (r.caps === "lower") return r.text.toLocaleLowerCase();
  return r.text;
}
