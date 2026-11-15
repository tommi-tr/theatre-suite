import { uid } from "@theatre-suite/core";
import { nameKey, phoneKey } from "./defaults";
import { MONTHS, currentAnswers, weekdayOf, cellOf } from "./rehearsals";
import type { Answer, CustomWords, Person, RehearsalDate } from "./types";

/**
 * Reading of the replies pasted from WhatsApp (see 09_cantinella.md, 1b).
 *
 * Pure functions, no screen: the interface shows what is read and the director confirms. Nothing
 * here changes the document. What is certain is told apart from what needs a look:
 * a reply is "sure" only if the sender, the date and the answer are all recognised.
 */

/* ---------------- Text helpers ---------------- */

const FOLD: Record<string, string> = {
  à: "a", á: "a", â: "a", ä: "a", è: "e", é: "e", ê: "e", ë: "e", ì: "i", í: "i", î: "i", ï: "i",
  ò: "o", ó: "o", ô: "o", ö: "o", ù: "u", ú: "u", û: "u", ü: "u", ç: "c", ñ: "n",
};

/** Lower case without accents, **same length as the input**, so positions can be reused on the original. */
export function fold(s: string): string {
  let out = "";
  for (const ch of s) {
    const low = ch.toLowerCase();
    const c = low.length === ch.length ? low : ch;
    out += FOLD[c] ?? c;
  }
  return out;
}

/** Invisible marks WhatsApp adds, and spaces of other kinds. */
function clean(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/[\u00a0\u202f]/g, " ")
    .normalize("NFC");
}

/* ---------------- Words of the answers ---------------- */

export type Reply = "yes" | "maybe" | "no";

/** What Cantinella understands without being told (accents are ignored: "sì" = "si"). */
export const DEFAULT_WORDS: Record<Reply, string[]> = {
  yes: ["sì", "s", "ok", "okay", "certo", "certamente", "ci sono", "ci sarò", "presente", "vengo", "ci vengo", "confermo", "confermato", "volentieri", "perfetto", "va bene", "sicuro", "yes", "sii", "ci sto"],
  maybe: ["forse", "f", "fors", "non so", "non lo so", "dipende", "vediamo", "da vedere", "probabilmente", "magari", "se riesco", "spero"],
  no: ["no", "n", "non posso", "non ci sono", "non vengo", "non riesco", "non ci riesco", "non ci sarò", "assente", "impossibile", "niente", "nope"],
};

/** Words that open a reply without meaning anything ("purtroppo no"). */
const FILLERS = new Set(["purtroppo", "ahime", "scusa", "scusate", "ehm", "mmm", "mh", "beh", "allora", "dunque", "comunque", "ragazzi", "grazie", "ciao", "eh", "ah", "ma"]);
/** Words between the answer and the date in "ok per lunedì". */
const STOPWORDS = new Set(["per", "il", "lo", "la", "a", "del", "dello", "di", "in", "giorno"]);

const SYMBOLS: Record<Reply, string[]> = {
  yes: ["👍", "✅", "✔", "👌", "🙌"],
  no: ["👎", "❌", "✖", "🚫"],
  maybe: ["🤷", "🤔", "❓", "❔"],
};

interface Phrase {
  words: string[];
  state: Reply;
}
export interface Lexicon {
  phrases: Phrase[];
  symbols: Array<{ text: string; state: Reply }>;
}

const WORD_RE = /[a-z0-9']+/g;
const collapse = (w: string) => w.replace(/(.)\1{2,}/g, "$1");

export function buildLexicon(custom: CustomWords = { yes: [], maybe: [], no: [] }): Lexicon {
  const phrases: Phrase[] = [];
  const symbols: Lexicon["symbols"] = [];
  for (const state of ["yes", "maybe", "no"] as const) {
    for (const raw of [...DEFAULT_WORDS[state], ...custom[state]]) {
      const f = fold(raw.trim());
      const words = f.match(WORD_RE);
      if (words) phrases.push({ words, state });
      else if (raw.trim()) symbols.push({ text: raw.trim(), state });
    }
    for (const text of SYMBOLS[state]) symbols.push({ text, state });
  }
  phrases.sort((a, b) => b.words.length - a.words.length || b.words.join("").length - a.words.join("").length);
  return { phrases, symbols };
}

export type AnswerHow = "word" | "letter" | "negation" | "none";

export interface ReadAnswer {
  state: Reply | null;
  note: string;
  how: AnswerHow;
}

function trimNote(s: string): string {
  let n = s.replace(/^[\s,;:.\-–—!?)]+/, "").trim();
  if (n.startsWith("(") && n.endsWith(")") && n.indexOf("(", 1) < 0) n = n.slice(1, -1).trim();
  return n;
}

const LEAD_SEP = /^[\s,;:.\-–—_()[\]!?*"'«»=>~•·|/\\]+/;

/** Reads the words after a date. Returns `null` when there is nothing there (no reply). */
export function readAnswer(segment: string, lex: Lexicon): ReadAnswer | null {
  const t = segment.replace(LEAD_SEP, "").trim();
  if (!t) return null;
  for (const s of lex.symbols) {
    if (t.startsWith(s.text)) return { state: s.state, note: trimNote(t.slice(s.text.length)), how: "word" };
  }
  const f = fold(t);
  const words = [...f.matchAll(WORD_RE)].map((m) => ({ w: m[0], collapsed: collapse(m[0]), start: m.index!, end: m.index! + m[0].length }));
  let i = 0;
  while (i < words.length && FILLERS.has(words[i].collapsed)) i++;
  if (i >= words.length) return { state: null, note: t, how: "none" };
  for (const p of lex.phrases) {
    if (i + p.words.length > words.length) continue;
    let ok = true;
    for (let k = 0; k < p.words.length; k++) {
      const w = words[i + k];
      if (w.w !== p.words[k] && w.collapsed !== collapse(p.words[k])) {
        ok = false;
        break;
      }
    }
    if (ok) return { state: p.state, note: trimNote(t.slice(words[i + p.words.length - 1].end)), how: "word" };
  }
  const first = words[i];
  const rest = t.slice(first.start).trim();
  if (first.collapsed === "non") return { state: "no", note: rest, how: "negation" };
  const letter = first.collapsed[0];
  if (letter === "s") return { state: "yes", note: rest, how: "letter" };
  if (letter === "n") return { state: "no", note: rest, how: "letter" };
  if (letter === "f") return { state: "maybe", note: rest, how: "letter" };
  return { state: null, note: rest, how: "none" };
}

/** Does the text start with a known answer word? (Used to tell "ok per lunedì" from "lunedì ok".) */
function startsWithKnownWord(text: string, lex: Lexicon): boolean {
  const a = readAnswer(text, lex);
  return !!a && a.how === "word";
}

/* ---------------- Who writes ---------------- */

export type PersonHow = "name" | "alias" | "phone" | "part" | "ambiguous" | "none";

export interface PersonMatch {
  id: string | null;
  how: PersonHow;
  candidates: string[];
}

const PHONE_LIKE = /^[+\d][\d\s\-().]{6,}$/;
const tokens = (s: string) => nameKey(s).split(" ").filter(Boolean);

/** Finds the person a WhatsApp name or number belongs to: name, alias (also numbers), then part of the name. */
export function matchPerson(author: string, people: Person[]): PersonMatch {
  const a = author.replace(/^[~\s]+/, "").trim();
  if (!a) return { id: null, how: "none", candidates: [] };
  const done = (list: Person[], how: PersonHow): PersonMatch | null =>
    list.length === 1 ? { id: list[0].id, how, candidates: [] } : list.length > 1 ? { id: null, how: "ambiguous", candidates: list.map((p) => p.id) } : null;

  if (PHONE_LIKE.test(a)) {
    const pk = phoneKey(a);
    const hit = people.filter((p) => (p.phone && phoneKey(p.phone) === pk) || p.aliases.some((x) => PHONE_LIKE.test(x) && phoneKey(x) === pk));
    return done(hit, "phone") ?? { id: null, how: "none", candidates: [] };
  }
  const key = nameKey(a);
  if (!key) return { id: null, how: "none", candidates: [] };
  const byName = done(people.filter((p) => nameKey(p.name) === key), "name");
  if (byName) return byName;
  const byAlias = done(people.filter((p) => p.aliases.some((x) => nameKey(x) === key)), "alias");
  if (byAlias) return byAlias;
  const t = tokens(a);
  const part = people.filter((p) => {
    const n = tokens(p.name);
    return n.length > 0 && (t.every((x) => n.includes(x)) || n.every((x) => t.includes(x)));
  });
  return done(part, "part") ?? { id: null, how: "none", candidates: [] };
}

/* ---------------- Dates in the text ---------------- */

const WEEKDAY_NAMES = ["domenica", "lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato"];
const WEEKDAY_ABBR = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const MONTH_NAMES = MONTHS.map((m) => fold(m));
const WEEKDAY_PREFIX = /(domenica|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|dom|lun|mar|mer|gio|ven|sab)\.?[\s,]*(?:il\s+)?$/;

function editDistanceOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** 1–12 for "nov", "novemb", "novenbre"; 0 if the word is not a month. */
export function monthOf(word: string): number {
  if (word.length < 3) return 0;
  for (let i = 0; i < 12; i++) {
    const m = MONTH_NAMES[i];
    if (m.startsWith(word)) return i + 1;
  }
  if (word.length >= 5) for (let i = 0; i < 12; i++) if (editDistanceOne(word, MONTH_NAMES[i])) return i + 1;
  return 0;
}

interface Mention {
  start: number;
  end: number;
  kind: "dm" | "weekday";
  sep: "slash" | "dash" | "text" | "weekday";
  day: number;
  month: number;
  year: number | null;
  weekday: number | null;
  /** Hour written right after the date, `HH:MM`. */
  time: string | null;
  /** Where the words of the reply can start. */
  after: number;
}

const year4 = (y: number) => (y < 100 ? 2000 + y : y);

function weekdayBefore(f: string, start: number): { at: number; weekday: number } | null {
  const m = f.slice(0, start).match(WEEKDAY_PREFIX);
  if (!m) return null;
  const idx = WEEKDAY_NAMES.indexOf(m[1]);
  return { at: start - m[0].length, weekday: idx >= 0 ? idx : WEEKDAY_ABBR.indexOf(m[1]) };
}

function timeAfter(f: string, end: number): { time: string | null; next: number } {
  const rest = f.slice(end);
  let m = rest.match(/^\s*[,;]?\s*(?:alle(?:\s+ore)?|ore|h)?\s*(\d{1,2})\s*[:.h]\s*(\d{2})(?!\d)/);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return { time: `${m[1].padStart(2, "0")}:${m[2]}`, next: end + m[0].length };
  m = rest.match(/^\s*[,;]?\s*(?:alle(?:\s+ore)?|ore|h)\s*(\d{1,2})(?![\d:.\/])/);
  if (m && Number(m[1]) < 24) return { time: `${m[1].padStart(2, "0")}:00`, next: end + m[0].length };
  return { time: null, next: end };
}

/** Finds the dates written in a line: "4/11", "lunedì 4 novembre ore 16:00", "4 nov", or just "martedì". */
function findMentions(line: string): Mention[] {
  const f = fold(line);
  const found: Mention[] = [];
  const push = (start: number, end: number, p: Omit<Mention, "start" | "end" | "weekday" | "time" | "after"> & { weekday?: number | null }) => {
    const wd = p.kind === "dm" ? weekdayBefore(f, start) : null;
    const s = wd ? wd.at : start;
    const t = timeAfter(f, end);
    found.push({ ...p, start: s, end, weekday: p.weekday ?? wd?.weekday ?? null, time: t.time, after: t.next });
  };

  for (const m of f.matchAll(/(?<![\d/])(\d{1,2})\s*([/-])\s*(\d{1,2})(?:\s*\2\s*(\d{4}|\d{2}))?(?![\d/])/g)) {
    let d = Number(m[1]);
    let mo = Number(m[3]);
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    push(m.index!, m.index! + m[0].length, { kind: "dm", sep: m[2] === "/" ? "slash" : "dash", day: d, month: mo, year: m[4] ? year4(Number(m[4])) : null });
  }
  for (const m of f.matchAll(/(?<![\d/])(\d{1,2})\s*[°º]?\s*(?:di\s+)?([a-z]{3,10})\.?(?:\s+(\d{4})(?!\d))?/g)) {
    const mo = monthOf(m[2]);
    const d = Number(m[1]);
    if (!mo || d < 1 || d > 31) continue;
    // The dot after an abbreviation belongs to the date; the year only if it is written with 4 digits.
    push(m.index!, m.index! + m[0].length, { kind: "dm", sep: "text", day: d, month: mo, year: m[3] ? Number(m[3]) : null });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Mention[] = [];
  for (const m of found) if (!kept.length || m.start >= kept[kept.length - 1].end) kept.push(m);

  for (const m of f.matchAll(/\b(domenica|lunedi|martedi|mercoledi|giovedi|venerdi|sabato)\b/g)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (kept.some((k) => start < k.end && end > k.start)) continue;
    const t = timeAfter(f, end);
    kept.push({ start, end, kind: "weekday", sep: "weekday", day: 0, month: 0, year: null, weekday: WEEKDAY_NAMES.indexOf(m[1]), time: t.time, after: t.next });
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

export type DateHow = "date" | "weekday" | "weekday-mismatch" | "ambiguous" | "none";

interface DateMatch {
  id: string | null;
  how: DateHow;
  candidates: string[];
}

function resolveDate(m: Mention, dates: RehearsalDate[]): DateMatch {
  if (m.kind === "weekday") {
    const c = dates.filter((d) => weekdayOf(d.day) === m.weekday);
    if (c.length === 1) return { id: c[0].id, how: "weekday", candidates: [] };
    return { id: null, how: c.length ? "ambiguous" : "none", candidates: c.map((d) => d.id) };
  }
  let c = dates.filter((d) => {
    const [y, mo, da] = d.day.split("-").map(Number);
    return mo === m.month && da === m.day && (m.year === null || y === m.year);
  });
  if (c.length > 1 && m.time) {
    const byTime = c.filter((d) => d.time === m.time);
    if (byTime.length) c = byTime;
  }
  if (c.length === 1) {
    const wrongWeekday = m.weekday !== null && m.weekday !== weekdayOf(c[0].day);
    return { id: c[0].id, how: wrongWeekday ? "weekday-mismatch" : "date", candidates: [] };
  }
  return { id: null, how: c.length ? "ambiguous" : "none", candidates: c.map((d) => d.id) };
}

/* ---------------- Messages ---------------- */

interface RawMessage {
  author: string;
  /** Local time of the message, `YYYY-MM-DDTHH:MM`, or "". */
  at: string;
  system: boolean;
  lines: string[];
}

function stamp(d: number, mo: number, y: number, h: number, mi: number, ampm?: string): string {
  if (mo > 12 && d <= 12) [d, mo] = [mo, d];
  let hh = h;
  if (ampm) {
    const pm = ampm.toLowerCase().startsWith("p");
    if (pm && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
  }
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(year4(y), 4)}-${p(mo)}-${p(d)}T${p(hh)}:${p(mi)}`;
}

/** Reads the start of a WhatsApp message (iPhone, Android or WhatsApp Web), if the line has one. */
export function parseHeader(line: string): { at: string; rest: string } | null {
  let m = line.match(/^\[(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s*(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap]\.?m\.?)?\]\s*(.*)$/i);
  if (m) return { at: stamp(+m[1], +m[2], +m[3], +m[4], +m[5], m[6]), rest: m[7] };
  m = line.match(/^\[(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap]\.?m\.?)?,\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\]\s*(.*)$/i);
  if (m) return { at: stamp(+m[4], +m[5], +m[6], +m[1], +m[2], m[3]), rest: m[7] };
  m = line.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s*(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap]\.?m\.?)?\s+[-–—]\s+(.*)$/i);
  if (m) return { at: stamp(+m[1], +m[2], +m[3], +m[4], +m[5], m[6]), rest: m[7] };
  return null;
}

function splitMessages(text: string, people: Person[]): RawMessage[] {
  type Open = RawMessage & { headed: boolean };
  const out: RawMessage[] = [];
  let cur: Open | null = null;
  const begin = (m: Open): Open => {
    out.push(m);
    return m;
  };
  for (const line of clean(text).split("\n")) {
    const h = parseHeader(line.trim());
    if (h) {
      const sp = h.rest.match(/^([^:]{1,80}?):\s*(.*)$/);
      cur = begin({ author: sp ? sp[1].replace(/^[~\s]+/, "").trim() : "", at: h.at, system: !sp, lines: sp && sp[2] ? [sp[2]] : [], headed: true });
      continue;
    }
    if (cur?.headed) {
      cur.lines.push(line);
      continue;
    }
    if (!line.trim()) {
      cur = null;
      continue;
    }
    // Without headers: "Giovanni: sì lunedì" starts a message only if Giovanni is somebody we know.
    const sp = line.match(/^([^:\d\n][^:\n]{0,40}):\s+(.+)$/);
    if (sp && matchPerson(sp[1], people).how !== "none") {
      cur = begin({ author: sp[1].trim(), at: "", system: false, lines: [sp[2]], headed: false });
    } else if (cur) {
      cur.lines.push(line);
    } else {
      cur = begin({ author: "", at: "", system: false, lines: [line], headed: false });
    }
  }
  return out;
}

/* ---------------- Result ---------------- */

export interface ReplyRow {
  id: string;
  /** Name or number as it appears in WhatsApp ("" if the text had no header). */
  author: string;
  /** Local time of the message, or "". */
  at: string;
  /** What was written, as the actor wrote it. */
  excerpt: string;
  /** The date as the actor wrote it ("4/11", "lunedì"). */
  dateText: string;
  personId: string | null;
  personHow: PersonHow;
  personCandidates: string[];
  dateId: string | null;
  dateHow: DateHow;
  dateCandidates: string[];
  state: Reply | null;
  answerHow: AnswerHow;
  note: string;
  /** What still needs a look. Choosing the value by hand clears the flag. */
  check: { person: boolean; date: boolean; answer: boolean };
}

export interface IgnoredMessage {
  author: string;
  at: string;
  text: string;
}

export interface ParseResult {
  rows: ReplyRow[];
  /** Messages with no date in them: shown so the director can see what was not read. */
  ignored: IgnoredMessage[];
}

export interface ParseContext {
  people: Person[];
  dates: RehearsalDate[];
  words?: CustomWords;
}

export const needsCheck = (r: ReplyRow): boolean => r.check.person || r.check.date || r.check.answer;

/** Reads everything pasted: one or many messages, with or without WhatsApp headers. */
export function parseReplies(text: string, ctx: ParseContext): ParseResult {
  const lex = buildLexicon(ctx.words);
  const rows: ReplyRow[] = [];
  const ignored: IgnoredMessage[] = [];
  splitMessages(text, ctx.people).forEach((msg, mi) => {
    if (msg.system) return;
    const who = matchPerson(msg.author, ctx.people);
    let mentions = 0;
    msg.lines.forEach((line, li) => {
      const found = findMentions(line);
      // "10-12" (hours) is a date only if it is one of the dates we sent.
      const list = found.filter((m) => !(m.sep === "dash" && resolveDate(m, ctx.dates).id === null && resolveDate(m, ctx.dates).how === "none"));
      mentions += list.length;
      if (!list.length) return;
      const leading = line.slice(0, list[0].start).split(/\s+/).filter((w) => w && !STOPWORDS.has(fold(w))).join(" ");
      const answerFirst = leading !== "" && startsWithKnownWord(leading, lex);
      list.forEach((m, k) => {
        let from: number;
        let to: number;
        if (answerFirst) {
          from = k === 0 ? 0 : list[k - 1].after;
          to = m.start;
        } else {
          from = m.after;
          to = k + 1 < list.length ? list[k + 1].start : line.length;
        }
        const segment = line.slice(from, to);
        const reading = readAnswer(segment, lex);
        if (!reading) return;
        const date = resolveDate(m, ctx.dates);
        const excerpt = (answerFirst ? line.slice(from, m.end) : line.slice(m.start, to)).trim();
        rows.push({
          id: `${mi}:${li}:${k}`,
          author: msg.author,
          at: msg.at,
          excerpt,
          dateText: line.slice(m.start, m.end).trim(),
          personId: who.id,
          personHow: who.how,
          personCandidates: who.candidates,
          dateId: date.id,
          dateHow: date.how,
          dateCandidates: date.candidates,
          state: reading.state,
          answerHow: reading.how,
          note: reading.note,
          check: {
            person: who.id === null,
            date: date.id === null || date.how !== "date",
            answer: reading.state === null || reading.how !== "word",
          },
        });
      });
    });
    const body = msg.lines.join("\n").trim();
    if (!mentions && body) ignored.push({ author: msg.author, at: msg.at, text: body });
  });
  return { rows, ignored };
}

/* ---------------- Against what is already in the table ---------------- */

export type RowStatus = "new" | "already" | "superseded";

/**
 * `already`: this reply is already in the history (the same chat pasted twice): it is not added again.
 * `superseded`: the same person wrote the same date again later in this paste: the last one counts, this one
 * still goes into the history.
 */
export function classifyRows(rows: ReplyRow[], answers: Answer[]): Map<string, RowStatus> {
  const out = new Map<string, RowStatus>();
  const current = currentAnswers(answers);
  const lastOf = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.personId && r.dateId) lastOf.set(`${r.personId}|${r.dateId}`, i);
  });
  rows.forEach((r, i) => {
    if (!r.personId || !r.dateId || !r.state) return void out.set(r.id, "new");
    const same = (a: Answer) => a.personId === r.personId && a.dateId === r.dateId && a.state === r.state && a.note === r.note;
    const cur = cellOf(current, r.personId, r.dateId);
    const dup = r.at ? answers.some((a) => same(a) && a.at === r.at) : !!cur && same(cur);
    if (dup) out.set(r.id, "already");
    else out.set(r.id, lastOf.get(`${r.personId}|${r.dateId}`) !== i ? "superseded" : "new");
  });
  return out;
}

/** The answers to add, in the order they were written. `at` falls back to `now` for messages without a time. */
export function rowsToAnswers(rows: ReplyRow[], now: string): Answer[] {
  return rows
    .filter((r) => r.personId && r.dateId && r.state)
    .map((r) => ({ id: uid(), personId: r.personId!, dateId: r.dateId!, state: r.state!, note: r.note, at: r.at || now, source: "paste" as const }));
}

/** Names to remember as aliases: the WhatsApp names the director assigned by hand. */
export function aliasesToLearn(rows: ReplyRow[], people: Person[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.personId || !r.author || r.personHow !== "none" && r.personHow !== "ambiguous") continue;
    const p = people.find((x) => x.id === r.personId);
    const a = r.author.replace(/^[~\s]+/, "").trim();
    if (!p || !a) continue;
    const key = PHONE_LIKE.test(a) ? phoneKey(a) : nameKey(a);
    const known = [p.name, ...p.aliases].some((x) => (PHONE_LIKE.test(x) ? phoneKey(x) : nameKey(x)) === key) || (p.phone && phoneKey(p.phone) === key);
    if (known) continue;
    const list = out.get(p.id) ?? [];
    if (!list.includes(a)) list.push(a);
    out.set(p.id, list);
  }
  return out;
}
