import { Schema, type DOMOutputSpec, type Node as PMNode } from "prosemirror-model";

/**
 * The document of a script. Text is typed into speeches, stage directions
 * and paragraphs; acts, tableaux, scenes and the automatic blocks (title,
 * characters, lists…) are single objects whose content Bardo writes itself.
 * Everything that is not running text lives in the `data` attribute of the
 * document (see DocData), so that undo/redo covers it too.
 */
export const schema = new Schema({
  nodes: {
    doc: {
      content: "block+",
      attrs: { data: { default: null } },
    },
    paragraph: {
      content: "inline*",
      group: "block",
      attrs: { align: { default: null }, list: { default: null }, indent: { default: 0 } },
      parseDOM: [
        {
          tag: "p",
          getAttrs: (dom) => {
            const el = dom as HTMLElement;
            if (el.classList.contains("b-dir")) return false;
            return { align: el.dataset.align || null, list: el.dataset.list || null, indent: Number(el.dataset.indent) || 0 };
          },
        },
      ],
      toDOM: (node): DOMOutputSpec => [
        "p",
        {
          class: "b-par",
          "data-align": node.attrs.align ?? undefined,
          "data-list": node.attrs.list ?? undefined,
          "data-indent": node.attrs.indent ? String(node.attrs.indent) : undefined,
        },
        0,
      ],
    },
    section: {
      content: "inline*",
      group: "block",
      defining: true,
      attrs: { level: { default: 1 } },
      parseDOM: [
        { tag: "h2.b-section", attrs: { level: 1 } },
        { tag: "h3.b-section", attrs: { level: 2 } },
      ],
      toDOM: (node): DOMOutputSpec => [node.attrs.level === 2 ? "h3" : "h2", { class: "b-section", "data-level": String(node.attrs.level) }, 0],
    },
    act: {
      group: "block",
      atom: true,
      selectable: true,
      attrs: { id: { default: "" }, title: { default: "" }, desc: { default: "" } },
      parseDOM: [{ tag: "div.b-act", getAttrs: (d) => ({ id: (d as HTMLElement).dataset.id ?? "" }) }],
      toDOM: (node): DOMOutputSpec => ["div", { class: "b-act", "data-id": node.attrs.id }],
    },
    tableau: {
      group: "block",
      atom: true,
      selectable: true,
      attrs: { id: { default: "" }, title: { default: "" }, desc: { default: "" } },
      parseDOM: [{ tag: "div.b-tableau", getAttrs: (d) => ({ id: (d as HTMLElement).dataset.id ?? "" }) }],
      toDOM: (node): DOMOutputSpec => ["div", { class: "b-tableau", "data-id": node.attrs.id }],
    },
    scene: {
      group: "block",
      atom: true,
      selectable: true,
      attrs: {
        id: { default: "" },
        /** Short title used in the structure, lists and headers. */
        title: { default: "" },
        /** Place and time, printed under the heading. */
        place: { default: "" },
        /** Not printed: used by lists and the director. */
        desc: { default: "" },
        /** Characters on stage without lines (ids). */
        silent: { default: [] },
      },
      parseDOM: [{ tag: "div.b-scene", getAttrs: (d) => ({ id: (d as HTMLElement).dataset.id ?? "" }) }],
      toDOM: (node): DOMOutputSpec => ["div", { class: "b-scene", "data-id": node.attrs.id }],
    },
    speech: {
      content: "inline*",
      group: "block",
      defining: true,
      attrs: { id: { default: "" }, speaker: { default: "" }, name: { default: "" } },
      parseDOM: [
        {
          tag: "div.b-speech",
          contentElement: ".b-speech-text",
          getAttrs: (d) => {
            const el = d as HTMLElement;
            return { id: el.dataset.id ?? "", speaker: el.dataset.speaker ?? "", name: el.querySelector(".b-speaker")?.textContent ?? "" };
          },
        },
      ],
      toDOM: (node): DOMOutputSpec => [
        "div",
        { class: "b-speech", "data-id": node.attrs.id, "data-speaker": node.attrs.speaker },
        ["span", { class: "b-speaker", contenteditable: "false" }, node.attrs.name || "?"],
        ["div", { class: "b-speech-text" }, 0],
      ],
    },
    direction: {
      content: "inline*",
      group: "block",
      attrs: { id: { default: "" } },
      parseDOM: [{ tag: "p.b-dir", getAttrs: (d) => ({ id: (d as HTMLElement).dataset.id ?? "" }) }],
      toDOM: (node): DOMOutputSpec => ["p", { class: "b-dir", "data-id": node.attrs.id }, 0],
    },
    auto: {
      group: "block",
      atom: true,
      selectable: true,
      attrs: { id: { default: "" }, kind: { default: "list" }, config: { default: {} } },
      parseDOM: [{ tag: "div.b-auto", getAttrs: (d) => ({ id: (d as HTMLElement).dataset.id ?? "", kind: (d as HTMLElement).dataset.kind ?? "list" }) }],
      toDOM: (node): DOMOutputSpec => ["div", { class: "b-auto", "data-id": node.attrs.id, "data-kind": node.attrs.kind }],
    },
    page_break: {
      group: "block",
      atom: true,
      selectable: true,
      parseDOM: [{ tag: "div.b-pagebreak" }],
      toDOM: (): DOMOutputSpec => ["div", { class: "b-pagebreak" }],
    },
    text: { group: "inline" },
    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM: (): DOMOutputSpec => ["br"],
    },
  },
  marks: {
    /** A word marked as part of a category (character, object, light…). */
    cat: {
      attrs: { cat: { default: "" }, item: { default: "" } },
      inclusive: false,
      excludes: "cat",
      parseDOM: [{ tag: "span.b-cat", getAttrs: (d) => ({ cat: (d as HTMLElement).dataset.cat ?? "", item: (d as HTMLElement).dataset.item ?? "" }) }],
      toDOM: (mark): DOMOutputSpec => ["span", { class: "b-cat", "data-cat": mark.attrs.cat, "data-item": mark.attrs.item }, 0],
    },
    /** Stage direction inside a speech, between parentheses. */
    inline_dir: {
      inclusive: false,
      parseDOM: [{ tag: "span.b-inl" }],
      toDOM: (): DOMOutputSpec => ["span", { class: "b-inl" }, 0],
    },
    /** Anchor of a working note. */
    note: {
      attrs: { id: { default: "" } },
      inclusive: false,
      excludes: "",
      parseDOM: [{ tag: "span.b-note", getAttrs: (d) => ({ id: (d as HTMLElement).dataset.note ?? "" }) }],
      toDOM: (mark): DOMOutputSpec => ["span", { class: "b-note", "data-note": mark.attrs.id }, 0],
    },
    // Manual formatting (to be used as little as possible).
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: (): DOMOutputSpec => ["strong", 0],
    },
    em: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM: (): DOMOutputSpec => ["em", 0],
    },
    underline: {
      parseDOM: [{ tag: "u" }],
      toDOM: (): DOMOutputSpec => ["u", 0],
    },
    color: {
      attrs: { color: { default: "#1b1c21" } },
      parseDOM: [{ tag: "span.b-color", getAttrs: (d) => ({ color: (d as HTMLElement).style.color }) }],
      toDOM: (mark): DOMOutputSpec => ["span", { class: "b-color", style: `color:${mark.attrs.color}` }, 0],
    },
    highlight: {
      attrs: { color: { default: "#fff2a8" } },
      parseDOM: [{ tag: "mark", getAttrs: (d) => ({ color: (d as HTMLElement).style.backgroundColor || "#fff2a8" }) }],
      toDOM: (mark): DOMOutputSpec => ["mark", { style: `background:${mark.attrs.color}` }, 0],
    },
    fontsize: {
      attrs: { size: { default: 12 } },
      parseDOM: [{ tag: "span.b-size", getAttrs: (d) => ({ size: parseFloat((d as HTMLElement).dataset.size ?? "12") }) }],
      toDOM: (mark): DOMOutputSpec => ["span", { class: "b-size", "data-size": String(mark.attrs.size), style: `font-size:${mark.attrs.size}pt` }, 0],
    },
    font: {
      attrs: { font: { default: "serif" } },
      parseDOM: [{ tag: "span.b-font", getAttrs: (d) => ({ font: (d as HTMLElement).dataset.font ?? "serif" }) }],
      toDOM: (mark): DOMOutputSpec => ["span", { class: "b-font", "data-font": mark.attrs.font }, 0],
    },
    caps: {
      attrs: { mode: { default: "upper" } },
      parseDOM: [{ tag: "span.b-caps", getAttrs: (d) => ({ mode: (d as HTMLElement).dataset.mode ?? "upper" }) }],
      toDOM: (mark): DOMOutputSpec => ["span", { class: "b-caps", "data-mode": mark.attrs.mode }, 0],
    },
  },
});

export type NodeName = keyof typeof schema.nodes;

/** Block types that belong to the script itself (as opposed to the documentation pages). */
export const SCRIPT_BLOCKS = new Set(["act", "tableau", "scene", "speech", "direction"]);

/** Nodes that carry a stable id. */
export const ID_NODES = new Set(["act", "tableau", "scene", "speech", "direction", "auto"]);

export function isTextBlock(node: PMNode): boolean {
  return node.isTextblock;
}
