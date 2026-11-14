import { useEffect, useRef, useState } from "react";
import { TextSelection } from "prosemirror-state";
import { useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { searchKey } from "../editor/plugins";
import { scrollToPos } from "../editor/commands";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

/** Find (Ctrl F) and replace (Ctrl H) over the whole script. */
export function FindBar() {
  const t = useT();
  const find = useUi((s) => s.find);
  const view = useDoc((s) => s.view);
  const state = useDoc((s) => s.state);
  const search = state ? searchKey.getState(state) : null;
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (find.open) {
      setQuery(search?.query ?? "");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [find.open]);

  if (!find.open || !view || !search) return null;
  const set = (q: string, current = 0) => view.dispatch(view.state.tr.setMeta(searchKey, { query: q, current }));
  const go = (delta: number) => {
    const s = searchKey.getState(view.state)!;
    if (!s.matches.length) return;
    const current = (s.current + delta + s.matches.length) % s.matches.length;
    view.dispatch(view.state.tr.setMeta(searchKey, { current }));
    const m = s.matches[current];
    scrollToPos(view, m.from - 1, false);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)));
    inputRef.current?.focus();
  };
  const close = () => {
    set("");
    useUi.getState().setFind({ open: false, replace: false });
    view.focus();
  };
  const replaceOne = () => {
    const s = searchKey.getState(view.state)!;
    const m = s.matches[s.current];
    if (!m) return;
    view.dispatch(view.state.tr.insertText(replace, m.from, m.to));
    go(0);
  };
  const replaceAll = () => {
    const s = searchKey.getState(view.state)!;
    if (!s.matches.length) return;
    const tr = view.state.tr;
    for (const m of [...s.matches].reverse()) tr.insertText(replace, m.from, m.to);
    view.dispatch(tr);
    useUi.getState().showToast(t("{n} replaced.", { n: s.matches.length }));
  };
  const count = search.matches.length;
  return (
    <div className="bd-findbar" role="search">
      <div className="bd-findbar__row">
        <Icon name="search" size={14} color="var(--text-3)" />
        <input
          ref={inputRef}
          className="ts-input"
          aria-label={t("Find")}
          placeholder={t("Find in the script")}
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            set(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <span className="ts-muted mono" style={{ width: 56, textAlign: "center", fontSize: 11.5 }}>
          {query ? (count ? `${search.current + 1}/${count}` : "0") : ""}
        </span>
        <Button variant="ghost" iconOnly icon="chevUp" aria-label={t("Previous")} onClick={() => go(-1)} />
        <Button variant="ghost" iconOnly icon="chevDown" aria-label={t("Next")} onClick={() => go(1)} />
        <Button variant="ghost" iconOnly icon="sync" aria-label={t("Replace")} on={find.replace} onClick={() => useUi.getState().setFind({ open: true, replace: !find.replace })} />
        <Button variant="ghost" iconOnly icon="x" aria-label={t("Close")} onClick={close} />
      </div>
      {find.replace ? (
        <div className="bd-findbar__row">
          <Icon name="sync" size={14} color="var(--text-3)" />
          <input className="ts-input" aria-label={t("Replace with")} placeholder={t("Replace with")} value={replace} onChange={(e) => setReplace(e.currentTarget.value)} />
          <Button variant="sm" onClick={replaceOne} disabled={!count}>
            {t("Replace")}
          </Button>
          <Button variant="sm" onClick={replaceAll} disabled={!count}>
            {t("All")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
