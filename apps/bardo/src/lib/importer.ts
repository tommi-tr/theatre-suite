import { unzipSync, strFromU8 } from "fflate";
import type { Node as PMNode } from "prosemirror-model";
import { schema } from "../model/schema";
import { DEFAULT_CHARACTERS_CONFIG, DEFAULT_TITLE_CONFIG, emptyData, newId } from "../model/defaults";
import type { Character, DocLang } from "../model/types";

/*
 * Import of an existing script (.docx or .txt).
 *
 * No artificial intelligence: a set of rules plus a little statistics.
 *  1. The file is read as a list of paragraphs, keeping what helps
 *     (italics, centred lines, bold).
 *  2. Every paragraph is matched against the usual ways of writing a
 *     script: "ATTO PRIMO", "Scena II", "AMLETO: testo", a name in capitals
 *     on its own line, a stage direction in brackets or in italics…
 *  3. A word is accepted as a character only if it comes back several
 *     times, or is written in capitals: "Nota: …" does not become a character.
 * Whatever is not recognised stays as normal text, to be fixed by hand.
 */

export interface SourceLine {
  text: string;
  italic: boolean;
  center: boolean;
  bold: boolean;
}

export interface ImportReport {
  characters: number;
  speeches: number;
  directions: number;
  acts: number;
  scenes: number;
  paragraphs: number;
  title: string;
}

export interface ImportResult {
  doc: PMNode;
  report: ImportReport;
}

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

export function linesFromText(text: string): SourceLine[] {
  return text
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .map((l) => ({ text: l.replace(/\s+$/, ""), italic: false, center: /^\s{12,}\S/.test(l), bold: false }))
    .map((l) => ({ ...l, text: l.text.trim() }));
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Paragraphs of a Word file (word/document.xml). */
export function linesFromDocx(bytes: Uint8Array): SourceLine[] {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("not-docx");
  const dom = new DOMParser().parseFromString(strFromU8(xml), "application/xml");
  const out: SourceLine[] = [];
  const paras = dom.getElementsByTagNameNS(W, "p");
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    let text = "";
    let italicChars = 0;
    let boldChars = 0;
    const jc = p.getElementsByTagNameNS(W, "jc")[0]?.getAttributeNS(W, "val") ?? p.getElementsByTagNameNS(W, "jc")[0]?.getAttribute("w:val");
    const runs = p.getElementsByTagNameNS(W, "r");
    for (let k = 0; k < runs.length; k++) {
      const r = runs[k];
      const rPr = r.getElementsByTagNameNS(W, "rPr")[0];
      const on = (tag: string) => {
        const el = rPr?.getElementsByTagNameNS(W, tag)[0];
        if (!el) return false;
        const v = el.getAttributeNS(W, "val") ?? el.getAttribute("w:val");
        return v !== "0" && v !== "false";
      };
      const italic = on("i");
      const bold = on("b");
      for (const child of Array.from(r.childNodes)) {
        const el = child as Element;
        if (el.namespaceURI !== W) continue;
        let piece = "";
        if (el.localName === "t") piece = el.textContent ?? "";
        else if (el.localName === "tab") piece = "\t";
        else if (el.localName === "br" || el.localName === "cr") piece = "\n";
        text += piece;
        const n = piece.replace(/\s/g, "").length;
        if (italic) italicChars += n;
        if (bold) boldChars += n;
      }
    }
    const visible = text.replace(/\s/g, "").length;
    for (const part of text.split("\n")) {
      out.push({ text: part.trim(), italic: visible > 0 && italicChars / visible > 0.8, center: jc === "center", bold: visible > 0 && boldChars / visible > 0.8 });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Recognising                                                          */
/* ------------------------------------------------------------------ */

const ORD = "primo|prima|secondo|seconda|terzo|terza|quarto|quarta|quinto|quinta|sesto|sesta|settimo|settima|ottavo|ottava|nono|nona|decimo|decima|unico|unica|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|\\d+";
const RE_ACT = new RegExp(`^(atto|act)\\s+(${ORD})\\b[\\s.:—–-]*(.*)$`, "i");
const RE_TABLEAU = new RegExp(`^(quadro|tableau)\\s+(${ORD})\\b[\\s.:—–-]*(.*)$`, "i");
const RE_SCENE = new RegExp(`^(scena|scene)\\s+(${ORD})\\b[\\s.:—–-]*(.*)$`, "i");
const RE_PROLOGUE = /^(prologo|epilogo|prologue|epilogue|intermezzo|interlude)\b[\s.:—–-]*(.*)$/i;
const RE_CHAR_LIST = /^(personaggi|personaggi e interpreti|dramatis personae|characters|cast)\s*:?$/i;
/** "AMLETO: testo", "Amleto. testo", "AMLETO — testo", "AMLETO<tab>testo". */
const RE_NAMED = /^([\p{Lu}][\p{L}'’.\s-]{0,38}?)(?:\s*\(([^)]{1,60})\))?\s*(?::|\.(?=\s)|\t+|\s[—–]\s)\s*(.+)$/u;
const RE_DIR = /^\((.+)\)\.?$/s;

function isUpper(s: string) {
  return /\p{L}/u.test(s) && s === s.toLocaleUpperCase();
}

function wordCount(s: string) {
  return s.split(/\s+/).filter(Boolean).length;
}

function nameKey(s: string) {
  return s
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim()
    .toLocaleLowerCase();
}

function niceName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ").replace(/[.:]+$/, "");
  if (isUpper(s)) return s.toLocaleLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase());
  return s;
}

/** A name in capitals alone on its line (the speech follows on the next line). */
function aloneName(l: SourceLine): string | null {
  const m = l.text.match(/^([\p{Lu}][\p{Lu}'’.\s-]{0,38}?)(?:\s*\(([^)]{1,60})\))?\s*[.:]?$/u);
  if (!m || !isUpper(m[1]) || wordCount(m[1]) > 4) return null;
  return m[1].trim();
}

type Kind =
  | { k: "act" | "tableau" | "scene"; title: string }
  | { k: "speech"; name: string; text: string; inline?: string }
  | { k: "nameOnly"; name: string; inline?: string }
  | { k: "direction"; text: string }
  | { k: "charList" }
  | { k: "text"; text: string }
  | { k: "blank" };

/** Counts the names found, to decide which ones are characters. */
function nameStats(lines: SourceLine[]): Map<string, { count: number; upper: boolean; raw: string }> {
  const stats = new Map<string, { count: number; upper: boolean; raw: string }>();
  const add = (raw: string) => {
    const key = nameKey(raw);
    if (!key) return;
    const s = stats.get(key) ?? { count: 0, upper: isUpper(raw), raw: raw.trim() };
    s.count++;
    stats.set(key, s);
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    if (!t || RE_ACT.test(t) || RE_SCENE.test(t) || RE_TABLEAU.test(t)) continue;
    const m = t.match(RE_NAMED);
    if (m && wordCount(m[1]) <= 4) add(m[1]);
    const alone = aloneName(lines[i]);
    if (alone && lines[i + 1]?.text && !aloneName(lines[i + 1])) add(alone);
  }
  return stats;
}

function classify(l: SourceLine, next: SourceLine | undefined, isChar: (name: string) => boolean): Kind {
  const t = l.text;
  if (!t) return { k: "blank" };
  let m = t.match(RE_ACT);
  if (m) return { k: "act", title: m[3]?.trim() ?? "" };
  m = t.match(RE_TABLEAU);
  if (m) return { k: "tableau", title: m[3]?.trim() ?? "" };
  m = t.match(RE_SCENE);
  if (m) return { k: "scene", title: m[3]?.trim() ?? "" };
  m = t.match(RE_PROLOGUE);
  if (m && (l.center || isUpper(m[1]) || wordCount(t) <= 4)) return { k: "scene", title: t };
  if (RE_CHAR_LIST.test(t)) return { k: "charList" };
  const named = t.match(RE_NAMED);
  if (named && wordCount(named[1]) <= 4 && isChar(named[1])) return { k: "speech", name: named[1].trim(), text: named[3].trim(), inline: named[2] };
  const alone = aloneName(l);
  if (alone && isChar(alone) && next?.text) {
    const im = t.match(/\(([^)]{1,60})\)/);
    return { k: "nameOnly", name: alone, inline: im?.[1] };
  }
  const d = t.match(RE_DIR);
  if (d) return { k: "direction", text: d[1].trim() };
  if (l.italic) return { k: "direction", text: t };
  return { k: "text", text: t };
}

/* ------------------------------------------------------------------ */
/* Building the script                                                  */
/* ------------------------------------------------------------------ */

/** Text with "(…)" turned into directions inside the speech. */
function speechContent(text: string, inline?: string): PMNode[] {
  const out: PMNode[] = [];
  const mark = schema.marks.inline_dir.create();
  if (inline) out.push(schema.text(`(${inline})`, [mark]), schema.text(" "));
  const re = /\([^()]{1,200}\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(schema.text(text.slice(last, m.index)));
    out.push(schema.text(m[0], [mark]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(schema.text(text.slice(last)));
  return out;
}

function guessLang(lines: SourceLine[]): DocLang {
  const sample = lines
    .slice(0, 400)
    .map((l) => l.text)
    .join(" ")
    .toLocaleLowerCase();
  const it = (sample.match(/\b(il|che|non|di|una|sono|della|perché|questo|scena|atto)\b/g) ?? []).length;
  const en = (sample.match(/\b(the|and|you|not|of|this|that|is|scene|act)\b/g) ?? []).length;
  return en > it ? "en" : "it";
}

/** Builds a Bardo script from the paragraphs of a file. */
export function importLines(lines: SourceLine[], fallbackTitle = ""): ImportResult {
  const lang = guessLang(lines);
  const data = emptyData(lang);
  const n = schema.nodes;
  const stats = nameStats(lines);
  const accepted = new Set<string>();
  for (const [key, s] of stats) if (s.count >= 2 || (s.upper && s.count >= 1 && key.length > 1)) accepted.add(key);
  const isChar = (name: string) => accepted.has(nameKey(name));
  const characters = new Map<string, Character>();
  const charFor = (raw: string): Character => {
    const key = nameKey(raw);
    let c = characters.get(key);
    if (!c) {
      c = { id: newId("ch"), name: niceName(raw), short: "", long: "", actor: "" };
      characters.set(key, c);
    }
    return c;
  };

  const blocks: PMNode[] = [];
  const report: ImportReport = { characters: 0, speeches: 0, directions: 0, acts: 0, scenes: 0, paragraphs: 0, title: "" };
  let started = false; // the script itself has started (first act, scene or speech)
  let inCharList = false;
  let pendingName: { name: string; inline?: string } | null = null;
  let lastSpeech: { node: PMNode; index: number } | null = null;
  const front: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const kind = classify(l, lines[i + 1], isChar);
    if (kind.k === "blank") {
      lastSpeech = null;
      continue;
    }
    if (kind.k === "charList" && !started) {
      inCharList = true;
      continue;
    }
    if (inCharList && !started && (kind.k === "text" || kind.k === "speech" || kind.k === "nameOnly" || kind.k === "direction")) {
      // "AMLETO, principe di Danimarca" in the list of characters.
      const raw = kind.k === "text" || kind.k === "direction" ? kind.text : kind.k === "speech" ? `${kind.name}, ${kind.text}` : kind.name;
      const parts = raw.split(/\s*[,—–:]\s*|\s+-\s+/);
      const nm = parts[0]?.trim();
      if (nm && wordCount(nm) <= 4) {
        const c = charFor(nm);
        accepted.add(nameKey(nm));
        if (parts.length > 1 && !c.short) c.short = raw.slice(raw.indexOf(parts[1])).trim();
        continue;
      }
    }
    if (pendingName) {
      // The line after a name alone is the speech.
      const c = charFor(pendingName.name);
      const text = kind.k === "text" || kind.k === "direction" ? (kind.k === "direction" && !l.italic ? `(${kind.text})` : kind.text) : l.text;
      const node = n.speech.create({ id: newId("sp"), speaker: c.id, name: c.name }, speechContent(text, pendingName.inline));
      blocks.push(node);
      lastSpeech = { node, index: blocks.length - 1 };
      report.speeches++;
      pendingName = null;
      continue;
    }
    switch (kind.k) {
      case "act":
        started = true;
        inCharList = false;
        blocks.push(n.act.create({ id: newId("act"), title: kind.title }));
        report.acts++;
        lastSpeech = null;
        break;
      case "tableau":
        started = true;
        blocks.push(n.tableau.create({ id: newId("tab"), title: kind.title }));
        lastSpeech = null;
        break;
      case "scene":
        started = true;
        inCharList = false;
        blocks.push(n.scene.create({ id: newId("scene"), place: kind.title }));
        report.scenes++;
        lastSpeech = null;
        break;
      case "speech": {
        started = true;
        inCharList = false;
        const c = charFor(kind.name);
        const node = n.speech.create({ id: newId("sp"), speaker: c.id, name: c.name }, speechContent(kind.text, kind.inline));
        blocks.push(node);
        lastSpeech = { node, index: blocks.length - 1 };
        report.speeches++;
        break;
      }
      case "nameOnly":
        started = true;
        inCharList = false;
        pendingName = { name: kind.name, inline: kind.inline };
        break;
      case "direction":
        if (!started && !blocks.length) {
          front.push(kind.text);
          break;
        }
        blocks.push(n.direction.create({ id: newId("dir") }, kind.text ? [schema.text(kind.text)] : []));
        report.directions++;
        lastSpeech = null;
        break;
      case "text":
        if (!started) {
          front.push(kind.text);
          break;
        }
        if (lastSpeech) {
          // A second paragraph of the same speech (verse, or a new line).
          const sp: PMNode = lastSpeech.node;
          const merged: PMNode = sp.type.create(sp.attrs, [...(sp.content.size ? sp.content.content : []), n.hard_break.create(), ...speechContent(kind.text)]);
          blocks[lastSpeech.index] = merged;
          lastSpeech = { node: merged, index: lastSpeech.index };
        } else {
          blocks.push(n.paragraph.create(null, [schema.text(kind.text)]));
          report.paragraphs++;
        }
        break;
      case "charList":
        break;
    }
  }

  // Before the script: title, subtitle, author.
  const frontLines = front.filter(Boolean);
  data.meta.title = frontLines[0] ?? fallbackTitle;
  const byLine = frontLines.find((f) => /^(di|by)\s+\S/i.test(f));
  if (byLine) data.meta.authors = byLine.replace(/^(di|by)\s+/i, "");
  const subtitle = frontLines.slice(1).find((f) => f !== byLine && wordCount(f) <= 12);
  if (subtitle) data.meta.subtitle = subtitle;
  const extra = frontLines.slice(1).filter((f) => f !== byLine && f !== subtitle);
  report.title = data.meta.title;

  data.characters = [...characters.values()];
  report.characters = data.characters.length;

  const content: PMNode[] = [
    n.auto.create({ id: newId("auto"), kind: "title", config: DEFAULT_TITLE_CONFIG }),
    n.auto.create({ id: newId("auto"), kind: "characters", config: DEFAULT_CHARACTERS_CONFIG(lang) }),
    ...extra.map((t) => n.paragraph.create(null, [schema.text(t)])),
  ];
  if (!blocks.some((b) => b.type === n.act || b.type === n.scene)) content.push(n.scene.create({ id: newId("scene") }));
  content.push(...blocks);
  if (!blocks.length) content.push(n.direction.create({ id: newId("dir") }));
  return { doc: n.doc.create({ data }, content), report };
}

/** Reads a file chosen by the user. */
export function importFile(name: string, bytes: Uint8Array): ImportResult {
  const lower = name.toLowerCase();
  const title = name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  if (lower.endsWith(".docx")) return importLines(linesFromDocx(bytes), title);
  if (lower.endsWith(".txt") || lower.endsWith(".fountain") || lower.endsWith(".md")) return importLines(linesFromText(new TextDecoder("utf-8").decode(bytes)), title);
  throw new Error("unsupported");
}
