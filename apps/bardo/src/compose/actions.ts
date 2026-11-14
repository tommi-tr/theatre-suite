import type { EditorView } from "prosemirror-view";
import type { TFunc } from "@theatre-suite/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { addNote, markAll, markCategory, unmarkedOccurrences } from "../editor/commands";
import { searchKey } from "../editor/plugins";
import { getData } from "../model/defaults";
import { isTauri } from "../lib/api";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

/** Marks the word or selection with a category, then offers to mark the other occurrences. */
export function markWithCategory(view: EditorView, t: TFunc, cat: string) {
  const res = markCategory(view, cat);
  if (!res) {
    useUi.getState().showToast(t("Select a word, or put the cursor on it, then choose the category."));
    return;
  }
  const others = unmarkedOccurrences(view.state.doc, res.text).length;
  const catName = getData(view.state.doc).categories.find((c) => c.id === cat)?.name ?? cat;
  if (others > 0) {
    useUi.getState().showToast(t("“{word}” is now {cat}. It appears {n} more times.", { word: res.text, cat: catName, n: others }), "info", {
      label: t("Mark them all"),
      run: () => {
        const n = markAll(view, res.text, cat, res.id);
        useUi.getState().showToast(t("{n} more marked.", { n }));
      },
    });
  }
}

export function newNote(view: EditorView, t: TFunc) {
  const id = addNote(view, useSettings.getState().settings.author);
  if (!id) {
    useUi.getState().showToast(t("Select some text, or put the cursor on a word, then add the note."));
    return;
  }
  useUi.getState().openDialog("note", undefined, id);
}

export function copyCut(view: EditorView, cut: boolean) {
  view.focus();
  document.execCommand(cut ? "cut" : "copy");
}

export async function paste(view: EditorView, t: TFunc, plain: boolean) {
  view.focus();
  try {
    const text = isTauri ? await readText() : await navigator.clipboard.readText();
    if (!text) return;
    if (plain) view.dispatch(view.state.tr.insertText(text).scrollIntoView());
    else view.pasteText(text);
  } catch {
    useUi.getState().showToast(t("Use Ctrl+V to paste."));
  }
}

/** Opens the find bar with a word already searched. */
export function findText(view: EditorView, text: string) {
  useUi.getState().setFind({ open: true, replace: false });
  view.dispatch(view.state.tr.setMeta(searchKey, { query: text, current: 0 }));
}
