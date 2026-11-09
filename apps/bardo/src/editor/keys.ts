import { baseKeymap, chainCommands, exitCode } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { InputRule, inputRules } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { Fragment, Slice, type ResolvedPos } from "prosemirror-model";
import { TextSelection, type Command, type EditorState } from "prosemirror-state";
import { getData, newId } from "../model/defaults";
import { schema } from "../model/schema";
import { makeSpeechByName, setBlockType, toggleMarkType } from "./commands";
import { useUi } from "../store/ui";

const n = schema.nodes;

/** Enter: a new line after a speech or a stage direction; in the middle, splits it. */
const enter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1) return false;
  const node = $from.parent;
  if (node.type !== n.speech && node.type !== n.direction) return false;
  const atEnd = $from.parentOffset === node.content.size;
  if (!dispatch) return true;
  const tr = state.tr;
  if (atEnd) {
    const after = $from.after(1);
    tr.insert(after, n.direction.create({ id: newId("dir") }));
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
  } else {
    const attrs = node.type === n.speech ? { ...node.attrs, id: newId("sp") } : { id: newId("dir") };
    tr.split($from.pos, 1, [{ type: node.type, attrs }]);
  }
  dispatch(tr.scrollIntoView());
  return true;
};

/** Tab at the start of the script line: the line becomes a speech. */
const tab: Command = (state, _dispatch, view) => {
  const { $from } = state.selection;
  if (!view || $from.depth !== 1) return true;
  const node = $from.parent;
  const pos = $from.before(1);
  if (node.type === n.direction) {
    const text = node.textContent.trim();
    if (text && text.split(/\s+/).length <= 4 && !/[.,;:!?«»“”"()]/.test(text)) {
      makeSpeechByName(view, pos, text, true);
      return true;
    }
    useUi.getState().setSpeakerPicker({ pos, mode: "convert" });
    return true;
  }
  if (node.type === n.speech && $from.parentOffset === 0) {
    useUi.getState().setSpeakerPicker({ pos, mode: "change" });
    return true;
  }
  // Tab never leaves the page.
  return true;
};

/** Shift+Tab in a speech, or Backspace at its start: back to a stage direction. */
const speechToDirection: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1 || $from.parent.type !== n.speech || $from.parentOffset !== 0) return false;
  if (dispatch) {
    const pos = $from.before(1);
    const node = $from.parent;
    const tr = state.tr.setNodeMarkup(pos, n.direction, { id: newId("dir") });
    // Inline directions only make sense in speeches.
    tr.removeMark(pos, pos + node.nodeSize, schema.marks.inline_dir);
    dispatch(tr);
  }
  return true;
};

const shiftTab: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.depth !== 1 || $from.parent.type !== n.speech) return true;
  if (dispatch) {
    const pos = $from.before(1);
    dispatch(state.tr.setNodeMarkup(pos, n.direction, { id: newId("dir") }));
  }
  return true;
};

const hardBreak: Command = chainCommands(exitCode, (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(n.hard_break.create()).scrollIntoView());
  return true;
});

export function bardoKeymaps() {
  return [
    keymap({
      Enter: enter,
      "Shift-Enter": hardBreak,
      Tab: tab,
      "Shift-Tab": shiftTab,
      Backspace: speechToDirection,
      "Mod-z": undo,
      "Mod-y": redo,
      "Shift-Mod-z": redo,
      "Mod-d": (_s, _d, view) => {
        if (view) setBlockType(view, "direction");
        return true;
      },
      "Mod-b": (_s, _d, view) => {
        if (view) toggleMarkType(view, schema.marks.strong);
        return true;
      },
      "Mod-i": (_s, _d, view) => {
        if (view) toggleMarkType(view, schema.marks.em);
        return true;
      },
      "Mod-u": (_s, _d, view) => {
        if (view) toggleMarkType(view, schema.marks.underline);
        return true;
      },
    }),
    keymap(baseKeymap),
  ];
}

/* ------------------------------------------------------------------ */
/* Typographic input: quotes, apostrophes, ellipsis, dashes, (…)        */
/* ------------------------------------------------------------------ */

function smart(state: EditorState): boolean {
  return getData(state.doc).format.options.smartPunctuation !== false;
}

function lang(state: EditorState) {
  return getData(state.doc).lang;
}

function replaceRule(re: RegExp, pick: (state: EditorState, match: RegExpMatchArray) => string) {
  return new InputRule(re, (state, match, start, end) => {
    if (!smart(state)) return null;
    const insert = pick(state, match);
    const offset = match[0].lastIndexOf(match[match.length - 1] ?? match[0]);
    return state.tr.insertText(insert, start + Math.max(0, offset), end);
  });
}

/** Closing parenthesis in a speech: the text between ( and ) becomes an inline direction. */
const closeParen = new InputRule(/\)$/, (state, _match, start, end) => {
  const $s = state.doc.resolve(start);
  if ($s.parent.type !== n.speech) return null;
  const before = $s.parent.textBetween(0, $s.parentOffset, "\n", "\n");
  const open = before.lastIndexOf("(");
  if (open < 0 || before.lastIndexOf(")") > open) return null;
  const mark = schema.marks.inline_dir.create();
  const from = $s.start() + open;
  const tr = state.tr.insertText(")", start, end);
  tr.addMark(from, start + 1, mark);
  tr.removeStoredMark(mark);
  return tr;
});

export function bardoInputRules() {
  return inputRules({
    rules: [
      replaceRule(/\.\.\.$/, () => "…"),
      replaceRule(/(?:^|[^-])(--)$/, () => "—"),
      replaceRule(/(?:^|[\s{[(<'"‘“«])(")$/, (s) => (lang(s) === "it" ? "«" : "“")),
      replaceRule(/(")$/, (s) => (lang(s) === "it" ? "»" : "”")),
      replaceRule(/(?:^|[\s{[(<"“«])(')$/, () => "‘"),
      replaceRule(/(')$/, () => "’"),
      closeParen,
    ],
  });
}

/** Plain text pasted inside the script becomes stage directions (never loose paragraphs). */
export function clipboardTextParser(text: string, $context: ResolvedPos): Slice {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const inScript = $context.parent.type === n.speech || $context.parent.type === n.direction;
  const blocks = lines.map((l) => {
    const content = l ? schema.text(l) : null;
    return inScript ? n.direction.create({ id: newId("dir") }, content) : n.paragraph.create(null, content);
  });
  return new Slice(Fragment.from(blocks), 1, 1);
}
