import { Plugin, PluginKey, TextSelection, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { getData, newId } from "../model/defaults";
import { schema } from "../model/schema";
import { CHARACTER_CAT, type CatIcon, type DocData } from "../model/types";
import { ensureCharacter, ensureItem, fold, niceName } from "./commands";

/*
 * Completion while typing.
 * - "line": at the start of a line, the names of the characters (Tab turns
 *   the line into a speech; a name never seen before creates the character).
 * - "word": inside the text, from the second letter, every entry already
 *   used in any category (Tab or Enter marks the word).
 */

export interface Suggestion {
  kind: "character" | "item" | "new";
  id: string;
  cat: string;
  name: string;
  catName: string;
  icon: CatIcon;
}

export interface AcState {
  active: boolean;
  mode: "line" | "word";
  from: number;
  to: number;
  query: string;
  items: Suggestion[];
  selected: number;
  /** Block position, used to anchor the popup in line mode. */
  blockPos: number;
  dismissed: string | null;
  /** The writer moved through the list with the arrows (then Enter accepts too). */
  navigated?: boolean;
}

export const acKey = new PluginKey<AcState>("bardo-autocomplete");

const INACTIVE: AcState = { active: false, mode: "word", from: 0, to: 0, query: "", items: [], selected: 0, blockPos: 0, dismissed: null };
const MAX = 6;

function matches(name: string, q: string): number {
  const n = fold(name);
  if (n.startsWith(q)) return 0;
  if (n.split(/[\s'’-]+/).some((w) => w.startsWith(q))) return 1;
  return -1;
}

/** Characters likely to speak next: whoever spoke before the last speaker, then the last one. */
function likelySpeakers(state: EditorState, blockIndex: number): string[] {
  const out: string[] = [];
  for (let i = blockIndex - 1; i >= 0 && out.length < 6; i--) {
    const n = state.doc.child(i);
    if (n.type.name === "scene" || n.type.name === "act") break;
    if (n.type.name === "speech" && n.attrs.speaker && !out.includes(n.attrs.speaker)) out.push(n.attrs.speaker);
  }
  if (out.length >= 2) [out[0], out[1]] = [out[1], out[0]];
  return out;
}

function characterSuggestions(data: DocData, q: string, likely: string[]): Suggestion[] {
  const catName = data.categories.find((c) => c.id === CHARACTER_CAT)?.name ?? "";
  const list = data.characters
    .map((c) => ({ c, score: q ? matches(c.name, q) : 0 }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => {
      const la = likely.indexOf(a.c.id);
      const lb = likely.indexOf(b.c.id);
      if (a.score !== b.score) return a.score - b.score;
      if (la !== lb) return (la < 0 ? 99 : la) - (lb < 0 ? 99 : lb);
      return 0;
    });
  return list.map(({ c }) => ({ kind: "character" as const, id: c.id, cat: CHARACTER_CAT, name: c.name, catName, icon: "user" as CatIcon }));
}

function compute(state: EditorState, prev: AcState): AcState {
  const sel = state.selection;
  if (!sel.empty || !(sel instanceof TextSelection)) return INACTIVE;
  const $f = sel.$from;
  const block = $f.parent;
  const t = block.type.name;
  if ($f.depth !== 1 || !["direction", "paragraph", "speech"].includes(t)) return INACTIVE;
  const text = block.textBetween(0, block.content.size, "\n", "\n");
  const before = text.slice(0, $f.parentOffset);
  const after = text.slice($f.parentOffset);
  if (/^[\p{L}\p{N}]/u.test(after)) return INACTIVE;
  const data = getData(state.doc);
  const blockPos = $f.before(1);
  const blockIndex = $f.index(0);

  // Line mode: the line holds only what could be a name.
  if (t === "direction" && !after.trim() && !/[.,;:!?«»“”"()]/.test(before) && before.trim().split(/\s+/).length <= 4) {
    const q = fold(before.trim());
    const prevBlock = blockIndex > 0 ? state.doc.child(blockIndex - 1) : null;
    const afterText = prevBlock && (prevBlock.type.name === "speech" || prevBlock.type.name === "direction" || prevBlock.type.name === "scene");
    if (q || (afterText && data.characters.length)) {
      const key = `${blockPos}:line:${before.trim() ? "q" : "empty"}`;
      if (prev.dismissed === key) return { ...INACTIVE, dismissed: key };
      const items = characterSuggestions(data, q, likelySpeakers(state, blockIndex)).slice(0, MAX);
      if (q.length >= 2 && !items.some((s) => fold(s.name) === q)) {
        const catName = data.categories.find((c) => c.id === CHARACTER_CAT)?.name ?? "";
        items.push({ kind: "new", id: "", cat: CHARACTER_CAT, name: niceName(before), catName, icon: "user" });
      }
      if (!items.length) return INACTIVE;
      const same = prev.active && prev.mode === "line" && prev.blockPos === blockPos;
      return { active: true, mode: "line", from: $f.start(), to: sel.from, query: before.trim(), items, selected: same ? Math.min(prev.selected, items.length - 1) : 0, blockPos, dismissed: prev.dismissed };
    }
  }

  // Word mode.
  const m = /[\p{L}][\p{L}'’-]*$/u.exec(before);
  if (!m || m[0].length < 2) return { ...INACTIVE, dismissed: prev.dismissed };
  const from = sel.from - m[0].length;
  if (state.doc.rangeHasMark(from, sel.from, schema.marks.cat)) return INACTIVE;
  const key = `${from}:word`;
  if (prev.dismissed === key) return { ...INACTIVE, dismissed: key };
  const q = fold(m[0]);
  const chars = characterSuggestions(data, q, []).filter((s) => matches(s.name, q) >= 0);
  const items: Suggestion[] = data.items
    .map((i) => ({ i, score: matches(i.name, q) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.i.name.localeCompare(b.i.name))
    .map(({ i }) => {
      const c = data.categories.find((x) => x.id === i.cat);
      return { kind: "item" as const, id: i.id, cat: i.cat, name: i.name, catName: c?.name ?? i.cat, icon: (c?.icon ?? "tag") as CatIcon };
    });
  const all = [...chars, ...items].slice(0, MAX);
  if (!all.length) return INACTIVE;
  const same = prev.active && prev.mode === "word" && prev.from === from;
  return { active: true, mode: "word", from, to: sel.from, query: m[0], items: all, selected: same ? Math.min(prev.selected, all.length - 1) : 0, blockPos, dismissed: prev.dismissed };
}

/** Accepts a suggestion: marks the word, or turns the line into a speech. */
export function acceptSuggestion(view: EditorView, s: Suggestion) {
  const st = acKey.getState(view.state);
  if (!st || !st.active) return;
  const tr = view.state.tr;
  if (st.mode === "line") {
    const sp = s.kind === "new" ? ensureCharacter(tr, s.name) : { id: s.id, name: s.name };
    const block = tr.doc.nodeAt(st.blockPos);
    if (!block) return;
    const speech = schema.nodes.speech.create({ id: newId("sp"), speaker: sp.id, name: sp.name });
    tr.replaceWith(st.blockPos, st.blockPos + block.nodeSize, speech);
    tr.setSelection(TextSelection.create(tr.doc, st.blockPos + 1));
  } else {
    const target = s.kind === "new" ? ensureItem(tr, s.cat, s.name) : { id: s.id, name: s.name };
    const typed = tr.doc.textBetween(st.from, st.to);
    // Keep capitals typed by the writer ("OFELIA"), otherwise use the entry's spelling.
    const text = typed === typed.toLocaleUpperCase() && typed.length > 1 ? target.name.toLocaleUpperCase() : target.name;
    const marks = [...tr.doc.resolve(st.from).marks().filter((m) => m.type !== schema.marks.cat), schema.marks.cat.create({ cat: s.cat, item: target.id })];
    tr.replaceWith(st.from, st.to, schema.text(text, marks));
    tr.setSelection(TextSelection.create(tr.doc, st.from + text.length));
    tr.setStoredMarks(marks.filter((m) => m.type !== schema.marks.cat));
  }
  view.dispatch(tr.scrollIntoView());
}

export function autocompletePlugin() {
  return new Plugin<AcState>({
    key: acKey,
    state: {
      init: () => INACTIVE,
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(acKey) as Partial<AcState> | undefined;
        if (meta) return { ...prev, ...meta };
        if (!tr.docChanged && !tr.selectionSet) return prev;
        return compute(state, prev);
      },
    },
    props: {
      handleKeyDown(view, e) {
        const st = acKey.getState(view.state);
        if (!st || !st.active || !st.items.length) return false;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const d = e.key === "ArrowDown" ? 1 : -1;
          const selected = (st.selected + d + st.items.length) % st.items.length;
          view.dispatch(view.state.tr.setMeta(acKey, { selected, navigated: true }));
          return true;
        }
        if (e.key === "Tab" && !e.shiftKey) {
          acceptSuggestion(view, st.items[st.selected]);
          return true;
        }
        if (e.key === "Enter" && !e.shiftKey && (st.query || st.navigated)) {
          acceptSuggestion(view, st.items[st.selected]);
          return true;
        }
        if (e.key === "Escape") {
          const dismissed = st.mode === "line" ? `${st.blockPos}:line:${st.query ? "q" : "empty"}` : `${st.from}:word`;
          view.dispatch(view.state.tr.setMeta(acKey, { ...INACTIVE, dismissed }));
          return true;
        }
        return false;
      },
    },
  });
}
