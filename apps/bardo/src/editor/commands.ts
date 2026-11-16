import { Fragment, type Mark, type MarkType, type Node as PMNode } from "prosemirror-model";
import { NodeSelection, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { getData, newId } from "../model/defaults";
import { schema } from "../model/schema";
import { CHARACTER_CAT, type CatItem, type Character, type DocData } from "../model/types";

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

const WORD_CHAR = /[\p{L}\p{N}'’-]/u;

/** "OFELIA" → "Ofelia", "LO SPETTRO" → "Lo Spettro"; mixed case is kept. */
export function niceName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  if (s && s === s.toLocaleUpperCase() && s !== s.toLocaleLowerCase()) {
    return s.toLocaleLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase());
  }
  return s;
}

/** Same as the original casing pattern: all caps stays all caps. */
export function matchCase(original: string, replacement: string): string {
  if (original && original === original.toLocaleUpperCase() && original !== original.toLocaleLowerCase()) return replacement.toLocaleUpperCase();
  return replacement;
}

export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

export function setData(view: EditorView, fn: (d: DocData) => DocData, tr?: Transaction): Transaction {
  const t = tr ?? view.state.tr;
  const next = fn(getData(t.doc));
  t.setDocAttribute("data", next);
  return t;
}

export function updateData(view: EditorView, fn: (d: DocData) => DocData) {
  view.dispatch(setData(view, fn));
}

/** Range of the selection, or of the word under the cursor. */
export function selectionOrWord(state: EditorState): { from: number; to: number } | null {
  const { from, to, empty, $from } = state.selection;
  if (!empty) return { from, to };
  const parent = $from.parent;
  if (!parent.isTextblock) return null;
  const text = parent.textBetween(0, parent.content.size, "\n", "\n");
  let a = $from.parentOffset;
  let b = $from.parentOffset;
  while (a > 0 && WORD_CHAR.test(text[a - 1])) a--;
  while (b < text.length && WORD_CHAR.test(text[b])) b++;
  if (a === b) return null;
  const start = $from.start();
  return { from: start + a, to: start + b };
}

/** Top-level block containing the selection. */
export function currentBlock(state: EditorState): { node: PMNode; pos: number; index: number } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.$from.depth === 0) return { node: sel.node, pos: sel.from, index: sel.$from.index(0) };
  const $f = sel.$from;
  if ($f.depth < 1) return null;
  const index = $f.index(0);
  return { node: state.doc.child(index), pos: $f.before(1), index };
}

export function scrollToPos(view: EditorView, pos: number, select = true) {
  const max = view.state.doc.content.size;
  const p = Math.max(0, Math.min(pos, max));
  const tr = view.state.tr;
  if (select) {
    const node = view.state.doc.nodeAt(p);
    if (node && node.isAtom && node.isBlock) tr.setSelection(NodeSelection.create(view.state.doc, p));
    else tr.setSelection(TextSelection.near(view.state.doc.resolve(Math.min(p + 1, max))));
  }
  view.dispatch(tr.scrollIntoView());
  // Bring the place to the upper part of the window.
  requestAnimationFrame(() => {
    try {
      const coords = view.coordsAtPos(Math.min(p + 1, view.state.doc.content.size));
      const scroller = view.dom.closest(".b-canvas") as HTMLElement | null;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        scroller.scrollTop += coords.top - r.top - r.height * 0.22;
      }
    } catch {
      /* position not drawn */
    }
  });
  view.focus();
}

/* ------------------------------------------------------------------ */
/* Characters and category items                                        */
/* ------------------------------------------------------------------ */

export function findCharacter(data: DocData, name: string): Character | undefined {
  const f = fold(niceName(name));
  return data.characters.find((c) => fold(c.name) === f);
}

export function findItem(data: DocData, cat: string, name: string): CatItem | undefined {
  const f = fold(name.trim());
  return data.items.find((i) => i.cat === cat && fold(i.name) === f);
}

/** Adds a character (or returns the existing one with that name). */
export function ensureCharacter(tr: Transaction, name: string): { id: string; name: string } {
  const data = getData(tr.doc);
  const existing = findCharacter(data, name);
  if (existing) return { id: existing.id, name: existing.name };
  const c: Character = { id: newId("ch"), name: niceName(name), short: "", long: "", actor: "" };
  tr.setDocAttribute("data", { ...data, characters: [...data.characters, c] });
  return { id: c.id, name: c.name };
}

export function ensureItem(tr: Transaction, cat: string, name: string): { id: string; name: string } {
  if (cat === CHARACTER_CAT) return ensureCharacter(tr, name);
  const data = getData(tr.doc);
  const clean = name.trim().replace(/\s+/g, " ");
  const existing = findItem(data, cat, clean);
  if (existing) return { id: existing.id, name: existing.name };
  const item: CatItem = { id: newId("it"), cat, name: clean === clean.toLocaleUpperCase() ? clean.toLocaleLowerCase() : clean, description: "" };
  tr.setDocAttribute("data", { ...data, items: [...data.items, item] });
  return { id: item.id, name: item.name };
}

/** Marks the selection (or the word under the cursor) as part of a category. Returns the item id. */
export function markCategory(view: EditorView, cat: string): { id: string; text: string } | null {
  const range = selectionOrWord(view.state);
  if (!range) return null;
  const text = view.state.doc.textBetween(range.from, range.to, " ").trim();
  if (!text) return null;
  const tr = view.state.tr;
  const item = ensureItem(tr, cat, text);
  tr.removeMark(range.from, range.to, schema.marks.cat);
  tr.addMark(range.from, range.to, schema.marks.cat.create({ cat, item: item.id }));
  tr.setSelection(TextSelection.create(tr.doc, range.to));
  view.dispatch(tr.scrollIntoView());
  return { id: item.id, text };
}

export function removeCategory(view: EditorView) {
  const range = selectionOrWord(view.state);
  if (!range) return;
  // Extend to the whole marked word.
  let { from, to } = range;
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.marks.some((m) => m.type === schema.marks.cat)) {
      from = Math.min(from, pos);
      to = Math.max(to, pos + node.nodeSize);
    }
  });
  view.dispatch(view.state.tr.removeMark(from, to, schema.marks.cat));
}

/** Unmarked places where `text` appears as a whole word. */
export function unmarkedOccurrences(doc: PMNode, text: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const target = fold(text);
  if (!target) return out;
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (node.marks.some((m) => m.type === schema.marks.cat)) return false;
    const s = node.text!;
    const f = fold(s);
    let i = f.indexOf(target);
    while (i >= 0) {
      const before = i > 0 ? s[i - 1] : "";
      const after = s[i + target.length] ?? "";
      if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) out.push({ from: pos + i, to: pos + i + target.length });
      i = f.indexOf(target, i + target.length);
    }
    return false;
  });
  return out;
}

export function markAll(view: EditorView, text: string, cat: string, item: string): number {
  const places = unmarkedOccurrences(view.state.doc, text);
  if (!places.length) return 0;
  const tr = view.state.tr;
  const mark = schema.marks.cat.create({ cat, item });
  for (const p of places) tr.addMark(p.from, p.to, mark);
  view.dispatch(tr);
  return places.length;
}

/** Renames a character everywhere: list, speeches and stage directions. */
export function renameCharacter(view: EditorView, id: string, name: string) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return;
  const tr = view.state.tr;
  const data = getData(tr.doc);
  tr.setDocAttribute("data", { ...data, characters: data.characters.map((c) => (c.id === id ? { ...c, name: clean } : c)) });
  renameMarkedText(tr, CHARACTER_CAT, id, clean);
  tr.doc.forEach((node, pos) => {
    if (node.type === schema.nodes.speech && node.attrs.speaker === id && node.attrs.name !== clean) tr.setNodeAttribute(pos, "name", clean);
  });
  view.dispatch(tr);
}

export function renameItem(view: EditorView, id: string, name: string) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return;
  const tr = view.state.tr;
  const data = getData(tr.doc);
  const item = data.items.find((i) => i.id === id);
  if (!item) return;
  tr.setDocAttribute("data", { ...data, items: data.items.map((i) => (i.id === id ? { ...i, name: clean } : i)) });
  renameMarkedText(tr, item.cat, id, clean);
  view.dispatch(tr);
}

function renameMarkedText(tr: Transaction, cat: string, id: string, name: string) {
  const ranges: { from: number; to: number; text: string; marks: readonly Mark[] }[] = [];
  let cur: { from: number; to: number; text: string; marks: readonly Mark[] } | null = null;
  tr.doc.descendants((node, pos) => {
    if (!node.isText) {
      cur = null;
      return true;
    }
    const m = node.marks.find((x) => x.type === schema.marks.cat && x.attrs.cat === cat && x.attrs.item === id);
    if (!m) {
      cur = null;
      return false;
    }
    if (cur && cur.to === pos) {
      cur.to = pos + node.nodeSize;
      cur.text += node.text;
    } else {
      cur = { from: pos, to: pos + node.nodeSize, text: node.text!, marks: node.marks };
      ranges.push(cur);
    }
    return false;
  });
  for (const r of ranges.reverse()) {
    const replacement = matchCase(r.text, name);
    if (replacement !== r.text) tr.replaceWith(r.from, r.to, schema.text(replacement, r.marks));
  }
}

/** Removes a character from the list (its speeches become stage directions). */
export function deleteCharacter(view: EditorView, id: string) {
  const tr = view.state.tr;
  const data = getData(tr.doc);
  tr.setDocAttribute("data", { ...data, characters: data.characters.filter((c) => c.id !== id) });
  const spans: number[] = [];
  tr.doc.forEach((node, pos) => {
    if (node.type === schema.nodes.speech && node.attrs.speaker === id) spans.push(pos);
  });
  for (const pos of spans.reverse()) tr.setNodeMarkup(pos, schema.nodes.direction, { id: newId("dir") });
  tr.doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((m) => m.type === schema.marks.cat && m.attrs.item === id)) tr.removeMark(pos, pos + node.nodeSize, schema.marks.cat);
    return true;
  });
  view.dispatch(tr);
}

export function deleteItem(view: EditorView, id: string) {
  const tr = view.state.tr;
  const data = getData(tr.doc);
  tr.setDocAttribute("data", { ...data, items: data.items.filter((i) => i.id !== id) });
  tr.doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((m) => m.type === schema.marks.cat && m.attrs.item === id)) tr.removeMark(pos, pos + node.nodeSize, schema.marks.cat);
    return true;
  });
  view.dispatch(tr);
}

/* ------------------------------------------------------------------ */
/* Blocks                                                               */
/* ------------------------------------------------------------------ */

/** Turns the block at `pos` into a speech of `speaker` (text kept). */
export function makeSpeech(view: EditorView, pos: number, speaker: { id: string; name: string }, opts: { dropText?: boolean } = {}) {
  const tr = view.state.tr;
  const node = tr.doc.nodeAt(pos);
  if (!node || !node.isTextblock) return;
  const content = opts.dropText ? Fragment.empty : node.content;
  const speech = schema.nodes.speech.create({ id: node.type === schema.nodes.speech ? node.attrs.id : newId("sp"), speaker: speaker.id, name: speaker.name }, cleanInline(content, true));
  tr.replaceWith(pos, pos + node.nodeSize, speech);
  tr.setSelection(TextSelection.create(tr.doc, pos + speech.nodeSize - 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Line → speech with a new or existing character typed by name. */
export function makeSpeechByName(view: EditorView, pos: number, name: string, dropText: boolean) {
  const tr = view.state.tr;
  const sp = ensureCharacter(tr, name);
  view.dispatch(tr);
  makeSpeech(view, pos, sp, { dropText });
}

export function changeSpeaker(view: EditorView, pos: number, speaker: { id: string; name: string }) {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type !== schema.nodes.speech) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, speaker: speaker.id, name: speaker.name }));
}

/** Removes inline-direction marks when the text leaves a speech (they only make sense there). */
function cleanInline(content: Fragment, inSpeech: boolean): Fragment {
  if (inSpeech) return content;
  const nodes: PMNode[] = [];
  content.forEach((n) => nodes.push(n.isText ? n.mark(n.marks.filter((m) => m.type !== schema.marks.inline_dir)) : n));
  return Fragment.from(nodes);
}

export function setBlockType(view: EditorView, type: "direction" | "paragraph" | "section") {
  const b = currentBlock(view.state);
  if (!b || !b.node.isTextblock) return;
  const nodeType = schema.nodes[type];
  const attrs = type === "direction" ? { id: newId("dir") } : type === "section" ? { level: 1 } : {};
  const tr = view.state.tr;
  const sel = view.state.selection;
  tr.replaceWith(b.pos, b.pos + b.node.nodeSize, nodeType.create(attrs, cleanInline(b.node.content, false)));
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(sel.from, b.pos + b.node.content.size + 1))));
  view.dispatch(tr);
  view.focus();
}

/** Inserts a block after the current one (or in place of an empty line). */
function insertBlocks(view: EditorView, nodes: PMNode[], focusIndex: number) {
  const state = view.state;
  const b = currentBlock(state);
  const tr = state.tr;
  let at: number;
  if (!b) at = state.doc.content.size;
  else if (b.node.isTextblock && b.node.content.size === 0) {
    tr.delete(b.pos, b.pos + b.node.nodeSize);
    at = b.pos;
  } else if (b.node.isTextblock && state.selection.empty && state.selection.$from.parentOffset === 0 && state.selection.$from.depth === 1) at = b.pos;
  else at = b.pos + b.node.nodeSize;
  tr.insert(at, nodes);
  let p = at;
  for (let i = 0; i < focusIndex; i++) p += nodes[i].nodeSize;
  const focusNode = nodes[focusIndex];
  if (focusNode.isTextblock) tr.setSelection(TextSelection.create(tr.doc, p + 1));
  else tr.setSelection(NodeSelection.create(tr.doc, p));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return p;
}

export function insertPart(view: EditorView, kind: "act" | "tableau" | "scene") {
  const n = schema.nodes;
  const prefix = kind === "tableau" ? "tab" : kind;
  const heading = n[kind].create({ id: newId(prefix) });
  const line = n.direction.create({ id: newId("dir") });
  insertBlocks(view, [heading, line], 1);
}

export function insertAuto(view: EditorView, kind: string, config: unknown): number {
  const node = schema.nodes.auto.create({ id: newId("auto"), kind, config });
  return insertBlocks(view, [node], 0);
}

export function insertPageBreak(view: EditorView) {
  insertBlocks(view, [schema.nodes.page_break.create(), schema.nodes.paragraph.create()], 1);
}

export function setNodeAttrs(view: EditorView, pos: number, attrs: Record<string, unknown>) {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
}

export function deleteNodeAt(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  const tr = view.state.tr.delete(pos, pos + node.nodeSize);
  if (tr.doc.childCount === 0) tr.insert(0, schema.nodes.direction.create({ id: newId("dir") }));
  view.dispatch(tr);
}

/** Moves top-level blocks [from, to) before block `before` (structure panel drag and drop). */
export function moveBlocks(view: EditorView, fromIdx: number, toIdx: number, beforeIdx: number) {
  if (beforeIdx >= fromIdx && beforeIdx <= toIdx) return;
  const doc = view.state.doc;
  const pos = (i: number) => {
    let p = 0;
    for (let k = 0; k < i && k < doc.childCount; k++) p += doc.child(k).nodeSize;
    return p;
  };
  const start = pos(fromIdx);
  const end = pos(toIdx);
  const slice = doc.slice(start, end);
  const target = pos(beforeIdx);
  const tr = view.state.tr;
  if (target > end) {
    tr.insert(target, slice.content);
    tr.delete(start, end);
  } else {
    tr.delete(start, end);
    tr.insert(target, slice.content);
  }
  view.dispatch(tr.scrollIntoView());
}

/* ------------------------------------------------------------------ */
/* Inline                                                               */
/* ------------------------------------------------------------------ */

/** Puts the selection between parentheses as an inline stage direction. */
export function inlineDirection(view: EditorView) {
  const { state } = view;
  const { from, to, empty, $from } = state.selection;
  if ($from.parent.type !== schema.nodes.speech) return false;
  const mark = schema.marks.inline_dir.create();
  const tr = state.tr;
  if (empty) {
    tr.insert(from, schema.text("()", [mark]));
    tr.setSelection(TextSelection.create(tr.doc, from + 1));
    tr.setStoredMarks([mark]);
  } else {
    const text = state.doc.textBetween(from, to);
    const hasParens = text.startsWith("(") && text.endsWith(")");
    if (!hasParens) {
      tr.insert(to, schema.text(")", [mark]));
      tr.insert(from, schema.text("(", [mark]));
      tr.addMark(from, to + 2, mark);
    } else tr.addMark(from, to, mark);
  }
  view.dispatch(tr);
  view.focus();
  return true;
}

export function toggleMarkType(view: EditorView, type: MarkType, attrs?: Record<string, unknown>) {
  const { from, to, empty } = view.state.selection;
  const tr = view.state.tr;
  if (empty) {
    const has = type.isInSet(view.state.storedMarks ?? view.state.selection.$from.marks());
    if (has) tr.removeStoredMark(type);
    else tr.addStoredMark(type.create(attrs));
  } else if (!attrs && view.state.doc.rangeHasMark(from, to, type)) tr.removeMark(from, to, type);
  else tr.addMark(from, to, type.create(attrs));
  view.dispatch(tr);
  view.focus();
}

/** Removes every manual formatting from the selection. */
export function clearManualFormatting(view: EditorView) {
  const { from, to } = view.state.selection;
  const m = schema.marks;
  const tr = view.state.tr;
  for (const t of [m.strong, m.em, m.underline, m.color, m.highlight, m.fontsize, m.font, m.caps]) tr.removeMark(from, to, t);
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === schema.nodes.paragraph && (node.attrs.align || node.attrs.list || node.attrs.indent)) tr.setNodeMarkup(pos, undefined, { align: null, list: null, indent: 0 });
    return false;
  });
  view.dispatch(tr);
}

export function setParagraphAttr(view: EditorView, attr: "align" | "list" | "indent", value: unknown) {
  const { from, to } = view.state.selection;
  const tr = view.state.tr;
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === schema.nodes.paragraph) {
      const cur = node.attrs[attr];
      let v = value;
      if (attr === "indent") v = Math.max(0, Math.min(6, (cur as number) + (value as number)));
      else if (cur === value) v = null;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: v });
    }
    return false;
  });
  view.dispatch(tr);
  view.focus();
}

export function insertTextAtCursor(view: EditorView, text: string) {
  view.dispatch(view.state.tr.insertText(text).scrollIntoView());
  view.focus();
}

/* ------------------------------------------------------------------ */
/* Notes                                                                */
/* ------------------------------------------------------------------ */

export function addNote(view: EditorView, author: string): string | null {
  const range = selectionOrWord(view.state);
  if (!range) return null;
  const id = newId("note");
  const tr = view.state.tr;
  const data = getData(tr.doc);
  tr.setDocAttribute("data", { ...data, notes: [...data.notes, { id, text: "", author, created: new Date().toISOString() }] });
  tr.addMark(range.from, range.to, schema.marks.note.create({ id }));
  view.dispatch(tr);
  return id;
}

export function deleteNote(view: EditorView, id: string) {
  const tr = view.state.tr;
  const data = getData(tr.doc);
  tr.setDocAttribute("data", { ...data, notes: data.notes.filter((n) => n.id !== id) });
  tr.doc.descendants((node, pos) => {
    if (node.isText) {
      const m = node.marks.find((x) => x.type === schema.marks.note && x.attrs.id === id);
      if (m) tr.removeMark(pos, pos + node.nodeSize, m);
    }
    return true;
  });
  view.dispatch(tr);
}

/** First position of a note's anchor (or -1). */
export function notePos(doc: PMNode, id: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.marks.some((m) => m.type === schema.marks.note && m.attrs.id === id)) found = pos;
    return found < 0;
  });
  return found;
}
