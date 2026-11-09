import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { DocAttrStep } from "prosemirror-transform";
import type { Node as PMNode } from "prosemirror-model";
import { newId } from "../model/defaults";
import { deriveIndex, type DocIndex } from "../model/derive";
import { ID_NODES } from "../model/schema";

/* ------------------------------------------------------------------ */
/* Stable ids: every act, scene, speech… keeps a unique id.            */
/* ------------------------------------------------------------------ */

const PREFIX: Record<string, string> = { act: "act", tableau: "tab", scene: "scene", speech: "sp", direction: "dir", auto: "auto" };

export const uniqueIdsPlugin = new Plugin({
  appendTransaction(trs, _old, state) {
    if (!trs.some((t) => t.docChanged)) return null;
    const seen = new Set<string>();
    let tr: Transaction | null = null;
    state.doc.forEach((node, pos) => {
      if (!ID_NODES.has(node.type.name)) return;
      const id = node.attrs.id as string;
      if (id && !seen.has(id)) {
        seen.add(id);
        return;
      }
      const fresh = newId(PREFIX[node.type.name] ?? "el");
      seen.add(fresh);
      tr = (tr ?? state.tr).setNodeAttribute(pos, "id", fresh);
    });
    if (tr) (tr as Transaction).setMeta("addToHistory", false);
    return tr;
  },
});

/* ------------------------------------------------------------------ */
/* Index of the script, kept up to date with every change.             */
/* ------------------------------------------------------------------ */

export interface IndexState {
  index: DocIndex;
  /** Increments when the document data (title, characters, format…) changes. */
  dataRev: number;
  /** Increments on every change of the document. */
  rev: number;
  /** Page version used by automatic lists (set by pagination). */
  pagesRev: number;
}

export const indexKey = new PluginKey<IndexState>("bardo-index");

function dataChanged(tr: Transaction): boolean {
  return tr.steps.some((s) => s instanceof DocAttrStep);
}

export const indexPlugin = new Plugin<IndexState>({
  key: indexKey,
  state: {
    init: (_c, state) => ({ index: deriveIndex(state.doc), dataRev: 0, rev: 0, pagesRev: 0 }),
    apply(tr, prev, _old, state) {
      const pagesRev = (tr.getMeta(indexKey) as { pagesRev?: number } | undefined)?.pagesRev ?? prev.pagesRev;
      if (!tr.docChanged) return pagesRev === prev.pagesRev ? prev : { ...prev, pagesRev };
      return { index: deriveIndex(state.doc), dataRev: prev.dataRev + (dataChanged(tr) ? 1 : 0), rev: prev.rev + 1, pagesRev };
    },
  },
  props: {
    decorations(state) {
      const st = indexKey.getState(state);
      if (!st) return null;
      return buildIndexDecorations(state.doc, st);
    },
  },
});

let cacheKey: unknown = null;
let cacheSet: DecorationSet = DecorationSet.empty;

/**
 * Node decorations that carry what depends on the rest of the script:
 * heading numbers, speech numbers, the version of automatic blocks.
 * A changed value makes the node view redraw.
 */
function buildIndexDecorations(doc: PMNode, st: IndexState): DecorationSet {
  if (cacheKey === st) return cacheSet;
  const decos: Decoration[] = [];
  const idx = st.index;
  const every = (doc.attrs.data?.format?.options?.lineNumbersEvery as number) || 1;
  const showNums = doc.attrs.data?.format?.options?.lineNumbers !== false;
  for (const p of idx.parts) {
    const node = doc.child(p.idx);
    decos.push(Decoration.node(p.pos, p.pos + node.nodeSize, { "data-label": p.label, "data-n": String(p.number) }));
  }
  for (const a of idx.autos) {
    const node = doc.child(a.idx);
    decos.push(Decoration.node(a.pos, a.pos + node.nodeSize, { "data-v": `${st.rev}.${st.pagesRev}` }));
  }
  if (showNums) {
    for (const [pos, n] of idx.speechNumber) {
      if (n % every !== 0 && n !== 1) continue;
      const node = doc.nodeAt(pos);
      if (node) decos.push(Decoration.node(pos, pos + node.nodeSize, { "data-num": String(n) }));
    }
  }
  cacheKey = st;
  cacheSet = DecorationSet.create(doc, decos);
  return cacheSet;
}

export function getIndex(state: EditorState): DocIndex {
  return indexKey.getState(state)!.index;
}

/* ------------------------------------------------------------------ */
/* Hints in empty lines.                                               */
/* ------------------------------------------------------------------ */

export const hintKey = new PluginKey<{ texts: Record<string, string> }>("bardo-hints");

/** Shows a grey hint in the empty line where the cursor is. */
export function hintPlugin(texts: () => Record<string, string>) {
  return new Plugin({
    key: hintKey,
    props: {
      decorations(state) {
        const { $from, empty } = state.selection;
        if (!empty) return null;
        const node = $from.parent;
        if (!node.isTextblock || node.content.size > 0) return null;
        const t = texts();
        const prev = $from.index(0) > 0 ? state.doc.child($from.index(0) - 1) : null;
        let hint = "";
        if (node.type.name === "direction") hint = prev?.type.name === "speech" || prev?.type.name === "direction" ? t.afterSpeech : t.direction;
        else if (node.type.name === "speech") hint = t.speech;
        else if (node.type.name === "paragraph") hint = t.paragraph;
        else if (node.type.name === "section") hint = t.section;
        if (!hint) return null;
        const start = $from.before();
        return DecorationSet.create(state.doc, [Decoration.node(start, start + node.nodeSize, { class: "b-empty", "data-hint": hint })]);
      },
    },
  });
}

/* ------------------------------------------------------------------ */
/* Find and replace highlights.                                        */
/* ------------------------------------------------------------------ */

export interface SearchState {
  query: string;
  matches: { from: number; to: number }[];
  current: number;
  caseSensitive: boolean;
}

export const searchKey = new PluginKey<SearchState>("bardo-search");

function normalize(s: string, cs: boolean) {
  return cs ? s : s.toLocaleLowerCase();
}

export function findMatches(doc: PMNode, query: string, caseSensitive: boolean): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  if (!query) return out;
  const q = normalize(query, caseSensitive);
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Text of the block with a map from string index to document position.
    let text = "";
    const map: number[] = [];
    node.forEach((child, off) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) map.push(pos + 1 + off + i);
        text += child.text;
      } else {
        map.push(pos + 1 + off);
        text += "\n";
      }
    });
    const hay = normalize(text, caseSensitive);
    let i = hay.indexOf(q);
    while (i >= 0) {
      out.push({ from: map[i], to: map[i + q.length - 1] + 1 });
      i = hay.indexOf(q, i + q.length);
    }
    return false;
  });
  return out;
}

export const searchPlugin = new Plugin<SearchState>({
  key: searchKey,
  state: {
    init: () => ({ query: "", matches: [], current: -1, caseSensitive: false }),
    apply(tr, prev, _o, state) {
      const meta = tr.getMeta(searchKey) as Partial<SearchState> | undefined;
      if (meta) {
        const next = { ...prev, ...meta };
        const matches = findMatches(state.doc, next.query, next.caseSensitive);
        const current = matches.length ? Math.min(Math.max(meta.current ?? 0, 0), matches.length - 1) : -1;
        return { ...next, matches, current };
      }
      if (tr.docChanged && prev.query) {
        const matches = findMatches(state.doc, prev.query, prev.caseSensitive);
        return { ...prev, matches, current: matches.length ? Math.min(prev.current, matches.length - 1) : -1 };
      }
      return prev;
    },
  },
  props: {
    decorations(state) {
      const s = searchKey.getState(state);
      if (!s || !s.matches.length) return null;
      return DecorationSet.create(
        state.doc,
        s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? "b-find b-find--on" : "b-find" })),
      );
    },
  },
});
