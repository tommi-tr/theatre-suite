/**
 * Anchors: points of the script that GOs and notes are tied to (13_cue.md, "Ancore").
 *
 * An anchor is `{ page, y, x?, quote, before, after }`: the page (from 1), the height on the page (0 top … 1
 * bottom), optionally the position across, and the text at that point (`quote`, the line nearest to it) with a
 * little text before and after. Page and height place it; the text finds it again when the script is replaced
 * by a new edition ("Sostituisci copione"), where lines may have moved, changed page or disappeared.
 *
 * Everything here is pure (no pdf.js): the text of a page comes in as positioned items, already normalised to
 * the page size (see script/text.ts).
 */

/** A run of text on a page, coordinates as fractions of the page (x, y = top-left of the run). */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The text of one page (page from 1). */
export interface PageText {
  page: number;
  items: TextItem[];
}

/** A line of a page: its text and where it is (y = centre of the line). */
export interface TextLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScriptAnchor {
  page: number;
  y: number;
  x?: number;
  /** The line at the point (may be empty: a page without text, a scanned script). */
  quote: string;
  /** Text just before and just after the quote (a few words). */
  before: string;
  after: string;
}

const CONTEXT_CHARS = 80;
const QUOTE_MAX = 90;

/* ------------------------------------------------------------------ */
/* Lines of a page                                                      */
/* ------------------------------------------------------------------ */

/** Groups the runs of a page into lines (reading order: top to bottom, left to right). */
export function pageLines(items: TextItem[]): TextLine[] {
  const runs = items.filter((i) => i.str.trim() !== "" && Number.isFinite(i.y) && Number.isFinite(i.x));
  runs.sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  const lines: { runs: TextItem[]; cy: number; h: number }[] = [];
  for (const r of runs) {
    const cy = r.y + r.h / 2;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.cy - cy) < Math.max(last.h, r.h) * 0.5) {
      last.runs.push(r);
      last.cy = (last.cy * (last.runs.length - 1) + cy) / last.runs.length;
      last.h = Math.max(last.h, r.h);
    } else lines.push({ runs: [r], cy, h: r.h });
  }
  return lines.map((l) => {
    l.runs.sort((a, b) => a.x - b.x);
    let text = "";
    let end = -Infinity;
    for (const r of l.runs) {
      // A visible gap between two runs is a space (PDFs often leave spaces out).
      if (text && !/\s$/.test(text) && !/^\s/.test(r.str) && r.x - end > r.h * 0.15) text += " ";
      text += r.str;
      end = r.x + r.w;
    }
    const x = l.runs[0].x;
    return { text: text.replace(/\s+/g, " ").trim(), x, y: l.cy, w: Math.max(0, end - x), h: l.h };
  });
}

/* ------------------------------------------------------------------ */
/* Making an anchor                                                     */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function tail(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(s.length - n);
  const sp = cut.indexOf(" ");
  return sp > 0 && sp < n / 3 ? cut.slice(sp + 1) : cut;
}

function head(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return sp > n * 0.66 ? cut.slice(0, sp) : cut;
}

/**
 * The anchor of a point of a page: the nearest line is the quote, the lines around it the context (taken from
 * the previous and next page too when the point is near the top or bottom).
 */
export function makeAnchor(page: PageText, at: { x?: number; y: number }, neighbours: { prev?: PageText; next?: PageText } = {}): ScriptAnchor {
  const y = clamp01(at.y);
  const base: ScriptAnchor = { page: page.page, y, quote: "", before: "", after: "" };
  if (at.x !== undefined) base.x = clamp01(at.x);
  const lines = pageLines(page.items);
  if (!lines.length) return base;
  let best = 0;
  let bestD = Infinity;
  lines.forEach((l, i) => {
    const d = Math.abs(l.y - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  let quote = lines[best].text;
  if (quote.length > QUOTE_MAX) {
    // A long line (prose): the words around the point across.
    const line = lines[best];
    const frac = at.x === undefined || line.w <= 0 ? 0.5 : clamp01((at.x - line.x) / line.w);
    const centre = Math.round(frac * quote.length);
    const from = Math.max(0, Math.min(quote.length - QUOTE_MAX, centre - QUOTE_MAX / 2));
    quote = quote.slice(from, from + QUOTE_MAX).trim();
  }
  const prevLines = neighbours.prev ? pageLines(neighbours.prev.items).map((l) => l.text) : [];
  const nextLines = neighbours.next ? pageLines(neighbours.next.items).map((l) => l.text) : [];
  const beforeText = [...prevLines, ...lines.slice(0, best).map((l) => l.text)].join(" ");
  const afterText = [...lines.slice(best + 1).map((l) => l.text), ...nextLines].join(" ");
  return { ...base, quote, before: tail(beforeText, CONTEXT_CHARS), after: head(afterText, CONTEXT_CHARS) };
}

/* ------------------------------------------------------------------ */
/* Normalised words                                                     */
/* ------------------------------------------------------------------ */

/** Lower case, no accents, typographic quotes and dashes unified, only letters and digits. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export const words = (s: string): string[] => {
  const n = normalizeText(s);
  return n ? n.split(" ") : [];
};

/** Where each word of the whole script is. */
interface WordAt {
  w: string;
  page: number;
  y: number;
  x: number;
}

/** The words of a whole script, in reading order, with their position (built once per new script). */
export interface ScriptIndex {
  words: WordAt[];
  positions: Map<string, number[]>;
  pages: number;
}

export function buildIndex(pages: PageText[]): ScriptIndex {
  const out: WordAt[] = [];
  let glueNext = false;
  for (const p of pages) {
    const lines = pageLines(p.items);
    lines.forEach((l, li) => {
      const ws = words(l.text);
      ws.forEach((w, i) => {
        if (i === 0 && glueNext && out.length) out[out.length - 1].w += w;
        else out.push({ w, page: p.page, y: l.y, x: l.x + (l.w * i) / Math.max(1, ws.length) });
      });
      // A word broken at the end of a line ("compra-" / "ta") is one word.
      const next = lines[li + 1];
      glueNext = !!next && /\p{L}-$/u.test(l.text) && /^\p{Ll}/u.test(next.text);
    });
    glueNext = false;
  }
  const positions = new Map<string, number[]>();
  out.forEach((w, i) => {
    const l = positions.get(w.w);
    if (l) l.push(i);
    else positions.set(w.w, [i]);
  });
  return { words: out, positions, pages: pages.reduce((m, p) => Math.max(m, p.page), 0) };
}

/* ------------------------------------------------------------------ */
/* Finding an anchor again in a new script                               */
/* ------------------------------------------------------------------ */

export type RelocationStatus = "sure" | "unsure" | "missing";

export interface Candidate {
  anchor: ScriptAnchor;
  /** 0 … 1: how well quote and context match there. */
  score: number;
}

export interface Relocation {
  status: RelocationStatus;
  /** 0 … 1. */
  confidence: number;
  /** Best first; empty when nothing was found. */
  candidates: Candidate[];
  /** Where the anchor goes if applied: the best candidate, or the old page and height (page within the new script). */
  anchor: ScriptAnchor;
}

/** Similarity of two word lists: 1 − edit distance / longer length. */
export function wordSimilarity(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

const SURE = 0.8;
const UNSURE = 0.4;
const CONTEXT_WORDS = 10;

/** Finds the anchor in a new script (its index). Never throws. */
export function relocate(anchor: ScriptAnchor, index: ScriptIndex): Relocation {
  const fallback: ScriptAnchor = { ...anchor, page: Math.min(Math.max(1, anchor.page), Math.max(1, index.pages)) };
  const q = words(anchor.quote);
  if (!q.length || !index.words.length) return { status: "missing", confidence: 0, candidates: [], anchor: fallback };
  const b = words(anchor.before).slice(-CONTEXT_WORDS);
  const a = words(anchor.after).slice(0, CONTEXT_WORDS);
  const W = index.words;
  const n = W.length;

  // 1. Votes: every word of context + quote found in the script votes for where the quote would start.
  const needle = [...b, ...q, ...a];
  const votes = new Map<number, number>();
  needle.forEach((w, j) => {
    const pos = index.positions.get(w);
    if (!pos || pos.length > 2000) return;
    const weight = (j >= b.length && j < b.length + q.length ? 2 : 1) / pos.length;
    for (const p of pos) {
      const start = p - (j - b.length);
      // Neighbouring starts share their votes (an inserted or removed word shifts the rest).
      for (let d = -2; d <= 2; d++) votes.set(start + d, (votes.get(start + d) ?? 0) + (d === 0 ? weight : weight * 0.5));
    }
  });
  const starts = [...votes.entries()]
    .filter(([s]) => s > -q.length && s < n)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 24)
    .map(([s]) => s);

  // 2. Score each candidate start with quote and context.
  const slice = (from: number, len: number) => W.slice(Math.max(0, from), Math.max(0, Math.min(n, from + len))).map((w) => w.w);
  const scoreAt = (s: number, len: number) => {
    const qs = wordSimilarity(q, slice(s, len));
    const bFrom = Math.max(0, s - b.length);
    const bs = b.length ? wordSimilarity(b, slice(bFrom, s - bFrom)) : qs;
    const as = a.length ? wordSimilarity(a, slice(s + len, a.length)) : qs;
    return 0.6 * qs + 0.2 * bs + 0.2 * as;
  };
  const scored: { start: number; score: number }[] = [];
  for (const s of starts) {
    if (s < 0 || s >= n) continue;
    let best = 0;
    for (let len = Math.max(1, q.length - 2); len <= q.length + 2; len++) best = Math.max(best, scoreAt(s, len));
    scored.push({ start: s, score: best });
  }
  scored.sort((x, y) => y.score - x.score || Math.abs(W[x.start].page - anchor.page) - Math.abs(W[y.start].page - anchor.page));
  // Distinct places only (two starts a few words apart are the same place).
  const distinct: typeof scored = [];
  for (const c of scored) if (!distinct.some((d) => Math.abs(d.start - c.start) <= Math.max(2, q.length / 2))) distinct.push(c);
  const top = distinct.slice(0, 3).filter((c) => c.score >= UNSURE * 0.75);
  if (!top.length) return { status: "missing", confidence: 0, candidates: [], anchor: fallback };

  const candidates: Candidate[] = top.map((c) => {
    const w = W[c.start];
    const next: ScriptAnchor = { ...anchor, page: w.page, y: w.y };
    if (anchor.x !== undefined) next.x = w.x;
    return { anchor: next, score: Math.round(c.score * 1000) / 1000 };
  });
  const s1 = top[0].score;
  const s2 = top[1]?.score ?? 0;
  // Two places that match almost equally well: the text is repeated, the choice is the user's.
  const confidence = Math.round((s2 > s1 - 0.08 ? s1 * 0.7 : s1) * 1000) / 1000;
  const status: RelocationStatus = confidence >= SURE ? "sure" : confidence >= UNSURE ? "unsure" : "missing";
  return { status, confidence, candidates, anchor: status === "missing" ? fallback : candidates[0].anchor };
}
