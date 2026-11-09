import type { Node as PMNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";
import { getData } from "../model/defaults";
import { indexKey } from "./plugins";
import { renderAuto, esc } from "./autoRender";
import { pageOfPos, requestRepaginate } from "./paginate";
import { useDoc } from "../store/doc";
import { useUi, type DialogKind } from "../store/ui";
import type { TFunc } from "@theatre-suite/core";

/** Interface texts used inside the page (set by the app when the language changes). */
let T: TFunc = (k) => k;
export function setNodeViewTranslator(t: TFunc) {
  T = t;
}

const PENCIL = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>`;

function lane(label: string, caption: string): string {
  return `<div class="b-lane" contenteditable="false"><span class="b-lane-br"></span><div class="b-lane-body"><button type="button" class="b-lane-chip" tabindex="-1">${PENCIL}<span>${esc(label)}</span></button>${caption ? `<span class="b-lane-cap">${esc(caption)}</span>` : ""}</div></div>`;
}

export function posById(doc: PMNode, id: string): number {
  let found = -1;
  doc.forEach((n, pos) => {
    if (found < 0 && n.attrs.id === id) found = pos;
  });
  return found;
}

function openFor(view: EditorView, node: PMNode, kind: DialogKind) {
  const pos = posById(view.state.doc, node.attrs.id);
  if (pos < 0) return;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  useUi.getState().openDialog(kind, pos);
}

/** Act, tableau and scene headings: numbered by Bardo, edited in their sheet. */
class PartView implements NodeView {
  dom: HTMLElement;
  private html = "";
  constructor(
    private node: PMNode,
    private view: EditorView,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = `b-${node.type.name} b-part`;
    this.dom.contentEditable = "false";
    this.dom.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      openFor(this.view, this.node, this.node.type.name as DialogKind);
    });
    this.render();
  }
  private render() {
    const idx = indexKey.getState(this.view.state)?.index;
    const info = idx?.parts.find((p) => p.id === this.node.attrs.id);
    const label = info?.label ?? "";
    const type = this.node.type.name;
    const title = this.node.attrs.title as string;
    let html: string;
    if (type === "scene") {
      const place = this.node.attrs.place as string;
      const caption = place || title ? T("title, place and data of the scene") : T("click to add place and time");
      html = `<div class="b-scene-h">${esc(label)}</div>${place ? `<div class="b-place">${esc(place)}</div>` : ""}${lane(label, caption)}`;
    } else {
      html = `<div class="b-${type}-h">${esc(label)}</div>${title ? `<div class="b-part-title">${esc(title)}</div>` : ""}${lane(label, T("automatic number"))}`;
    }
    if (html !== this.html) {
      this.dom.innerHTML = html;
      this.html = html;
    }
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
  stopEvent() {
    return true;
  }
  ignoreMutation() {
    return true;
  }
}

const AUTO_DIALOG: Record<string, DialogKind> = { title: "title", characters: "characters", cast: "cast", list: "autolist" };

/** Automatic blocks ("macro"): title page, characters, cast and crew, lists. */
class AutoView implements NodeView {
  dom: HTMLElement;
  private body: HTMLElement;
  private laneEl: HTMLElement;
  private html = "";
  constructor(
    private node: PMNode,
    private view: EditorView,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = `b-auto b-auto--${node.attrs.kind}`;
    this.dom.contentEditable = "false";
    this.body = document.createElement("div");
    this.body.className = "b-auto-body";
    this.laneEl = document.createElement("div");
    this.dom.append(this.body, this.laneEl);
    this.dom.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      openFor(this.view, this.node, AUTO_DIALOG[this.node.attrs.kind] ?? "autolist");
    });
    this.render(false);
  }
  private render(notify: boolean) {
    const state = this.view.state;
    const data = getData(state.doc);
    const index = indexKey.getState(state)!.index;
    const pages = useDoc.getState().pages;
    const html = renderAuto(this.node.attrs.kind, this.node.attrs.config, data, index, (pos) => pageOfPos(pages, index, pos), true);
    if (html !== this.html) {
      this.body.innerHTML = html;
      this.html = html;
      if (notify) requestRepaginate(this.view);
    }
    const kind = this.node.attrs.kind as string;
    const cfg = (this.node.attrs.config ?? {}) as { title?: string };
    const label = kind === "title" ? T("Title") : kind === "characters" ? T("Characters") : kind === "cast" ? T("Cast and crew") : cfg.title || T("Automatic list");
    const count = kind === "characters" ? ` · ${data.characters.length}` : "";
    const laneHtml = lane(label, (kind === "title" ? T("title page") : T("automatic list")) + count);
    if (this.laneEl.innerHTML !== laneHtml) this.laneEl.innerHTML = laneHtml;
  }
  update(node: PMNode) {
    if (node.type !== this.node.type || node.attrs.kind !== this.node.attrs.kind) return false;
    this.node = node;
    this.render(true);
    return true;
  }
  stopEvent() {
    return true;
  }
  ignoreMutation() {
    return true;
  }
}

export const nodeViews = {
  act: (node: PMNode, view: EditorView) => new PartView(node, view),
  tableau: (node: PMNode, view: EditorView) => new PartView(node, view),
  scene: (node: PMNode, view: EditorView) => new PartView(node, view),
  auto: (node: PMNode, view: EditorView) => new AutoView(node, view),
};
