import type { EditorView } from "prosemirror-view";
import { getData } from "../model/defaults";
import type { FormatModel, StyleKey, TextStyle, CatStyle } from "./model";

/** Changes the format of the script; the first change turns a model into "Personalizzato". */
export function updateFormat(view: EditorView, fn: (f: FormatModel) => FormatModel, customName: string) {
  const data = getData(view.state.doc);
  const next = fn(data.format);
  const custom = { ...next, custom: true, name: customName };
  view.dispatch(view.state.tr.setDocAttribute("data", { ...data, format: custom }));
}

export function setStyle(view: EditorView, key: StyleKey, patch: Partial<TextStyle>, customName: string) {
  updateFormat(view, (f) => ({ ...f, styles: { ...f.styles, [key]: { ...f.styles[key], ...patch } } }), customName);
}

export function setCatStyle(view: EditorView, cat: string, patch: Partial<CatStyle>, customName: string) {
  updateFormat(view, (f) => ({ ...f, cats: { ...f.cats, [cat]: { ...(f.cats[cat] ?? { caps: "normal", italic: false, bold: false }), ...patch } } }), customName);
}

/** Uses a model as it is (not customised). The watermark belongs to the script and is kept. */
export function applyModel(view: EditorView, model: FormatModel) {
  const data = getData(view.state.doc);
  const format: FormatModel = { ...structuredClone(model), custom: false, watermark: data.format.watermark };
  view.dispatch(view.state.tr.setDocAttribute("data", { ...data, format }));
}
