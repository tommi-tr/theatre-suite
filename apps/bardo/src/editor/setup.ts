import type { Node as PMNode } from "prosemirror-model";
import { history } from "prosemirror-history";
import { EditorState } from "prosemirror-state";
import { autocompletePlugin } from "./autocomplete";
import { bardoInputRules, bardoKeymaps } from "./keys";
import { paginatePlugin, type Pagination } from "./paginate";
import { hintPlugin, indexPlugin, searchPlugin, uniqueIdsPlugin } from "./plugins";

export interface SetupOptions {
  hints: () => Record<string, string>;
  onPages: (p: Pagination) => void;
  contLabel: () => string;
}

/** Editor state with every Bardo behaviour (order matters for keys). */
export function createEditorState(doc: PMNode, opts: SetupOptions): EditorState {
  return EditorState.create({
    doc,
    plugins: [
      autocompletePlugin(),
      bardoInputRules(),
      ...bardoKeymaps(),
      history({ depth: 500, newGroupDelay: 600 }),
      uniqueIdsPlugin,
      indexPlugin,
      hintPlugin(opts.hints),
      searchPlugin,
      paginatePlugin({ onResult: opts.onPages, contLabel: opts.contLabel }),
    ],
  });
}
