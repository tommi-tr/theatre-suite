import { useEffect, useRef, useState } from "react";
import type { EditorView } from "prosemirror-view";
import { useT } from "@theatre-suite/core";
import { Icon, Kbd } from "@theatre-suite/ui";
import { currentBlock, insertPart, removeCategory, selectionOrWord, setBlockType } from "../editor/commands";
import { getData } from "../model/defaults";
import { schema } from "../model/schema";
import { useUi } from "../store/ui";
import { copyCut, findText, markWithCategory, newNote, paste } from "./actions";
import { CAT_ICONS } from "./Popups";

/** Right-click menu: clipboard, categories, element type, a few writing helpers. */
export function ContextMenu({ view }: { view: EditorView }) {
  const t = useT();
  const pos = useUi((s) => s.contextMenu);
  const [sub, setSub] = useState<"cat" | "type" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSub(null);
    if (!pos) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) useUi.getState().setContextMenu(null);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && useUi.getState().setContextMenu(null);
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [pos]);
  if (!pos) return null;
  const state = view.state;
  const data = getData(state.doc);
  const range = selectionOrWord(state);
  let marked: { cat: string; item: string } | null = null;
  if (range) {
    state.doc.nodesBetween(range.from, range.to, (n) => {
      const m = n.marks.find((x) => x.type === schema.marks.cat);
      if (m && !marked) marked = { cat: m.attrs.cat, item: m.attrs.item };
    });
  }
  const mk = marked as { cat: string; item: string } | null;
  const block = currentBlock(state);
  const word = range ? state.doc.textBetween(range.from, range.to, " ").trim() : "";
  const close = () => useUi.getState().setContextMenu(null);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const left = Math.min(pos.x, window.innerWidth - 250);
  const top = Math.min(pos.y, window.innerHeight - 420);
  const item = (icon: Parameters<typeof Icon>[0]["name"], label: string, fn: () => void, opts: { kbd?: string; disabled?: boolean } = {}) => (
    <button type="button" className="bd-menu__item" disabled={opts.disabled} onClick={run(fn)}>
      <Icon name={icon} size={15} />
      {label}
      {opts.kbd ? <Kbd>{opts.kbd}</Kbd> : null}
    </button>
  );
  const sheetOf = () => {
    if (!block) return null;
    const k = block.node.type.name;
    if (k === "auto") return () => useUi.getState().openDialog(({ title: "title", characters: "characters", cast: "cast" } as const)[block.node.attrs.kind as "title"] ?? "autolist", block.pos);
    if (k === "act" || k === "scene" || k === "tableau") return () => useUi.getState().openDialog(k, block.pos);
    if (k === "speech") return () => useUi.getState().openDialog("characters", undefined, block.node.attrs.speaker);
    return null;
  };
  const openSheet = sheetOf();
  return (
    <div ref={ref} className="bd-menu" role="menu" style={{ position: "fixed", left, top }} onMouseDown={(e) => e.preventDefault()}>
      {item("scissors", t("Cut"), () => copyCut(view, true), { kbd: "Ctrl X", disabled: state.selection.empty })}
      {item("copy", t("Copy"), () => copyCut(view, false), { kbd: "Ctrl C", disabled: state.selection.empty })}
      {item("clipboard", t("Paste"), () => paste(view, t, false), { kbd: "Ctrl V" })}
      {item("clipboard", t("Paste text only"), () => paste(view, t, true))}
      <div className="bd-menu__sep" />
      <button type="button" className="bd-menu__item" disabled={!range} onMouseEnter={() => setSub("cat")} onClick={() => setSub(sub === "cat" ? null : "cat")}>
        <Icon name="tags" size={15} />
        {t("Mark as")}
        <Icon name="chevRight" size={13} style={{ marginLeft: "auto" }} />
      </button>
      {sub === "cat" && range ? (
        <div style={{ paddingLeft: 14 }}>
          {data.categories.map((c, i) =>
            item(CAT_ICONS[c.icon], c.name, () => markWithCategory(view, t, c.id), { kbd: i < 9 ? `Ctrl ${i + 1}` : undefined }),
          )}
        </div>
      ) : null}
      {mk ? item("eraser", t("Remove mark"), () => removeCategory(view), { kbd: "Ctrl 0" }) : null}
      <button type="button" className="bd-menu__item" onMouseEnter={() => setSub("type")} onClick={() => setSub(sub === "type" ? null : "type")} disabled={!block?.node.isTextblock}>
        <Icon name="layers" size={15} />
        {t("Turn into")}
        <Icon name="chevRight" size={13} style={{ marginLeft: "auto" }} />
      </button>
      {sub === "type" && block?.node.isTextblock ? (
        <div style={{ paddingLeft: 14 }}>
          {item("speech", t("Speech"), () => useUi.getState().setSpeakerPicker({ pos: block.pos, mode: block.node.type.name === "speech" ? "change" : "convert" }), { kbd: "Tab" })}
          {item("italic", t("Stage direction"), () => setBlockType(view, "direction"), { kbd: "Ctrl D" })}
          {item("title", t("Plain text"), () => setBlockType(view, "paragraph"))}
          {item("type", t("Section title"), () => setBlockType(view, "section"))}
        </div>
      ) : null}
      <div className="bd-menu__sep" />
      {mk ? item("pencil", t("Rename everywhere…"), () => useUi.getState().openDialog("rename", undefined, mk.item)) : null}
      {block?.node.type.name === "speech" && !mk ? item("pencil", t("Rename this character everywhere…"), () => useUi.getState().openDialog("rename", undefined, block.node.attrs.speaker)) : null}
      {word ? item("search", t("Show where it appears"), () => findText(view, word)) : null}
      {openSheet ? item("pencil", t("Open its sheet"), openSheet) : null}
      {item("note", t("Add a note"), () => newNote(view, t), { disabled: !range })}
      {item("door", t("Start a new scene here"), () => insertPart(view, "scene"))}
    </div>
  );
}
