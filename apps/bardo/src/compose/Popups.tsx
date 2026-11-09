import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { EditorView } from "prosemirror-view";
import { useT } from "@theatre-suite/core";
import { Icon, Kbd, type IconName } from "@theatre-suite/ui";
import { acKey, acceptSuggestion } from "../editor/autocomplete";
import { changeSpeaker, ensureCharacter, fold, makeSpeech, niceName } from "../editor/commands";
import { getData } from "../model/defaults";
import type { CatIcon } from "../model/types";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

export const CAT_ICONS: Record<CatIcon, IconName> = {
  user: "user",
  box: "box",
  set: "set",
  shirt: "shirt",
  bulb: "bulb",
  sound: "volume",
  music: "music",
  sparkle: "sparkle",
  brush: "brush",
  video: "video",
  tag: "tags",
};

function place(view: EditorView, pos: number, height: number): CSSProperties {
  try {
    const c = view.coordsAtPos(Math.min(pos, view.state.doc.content.size));
    const below = c.bottom + 6;
    if (below + height > window.innerHeight - 30) return { left: Math.max(8, Math.min(c.left - 8, window.innerWidth - 300)), bottom: window.innerHeight - c.top + 6 };
    return { left: Math.max(8, Math.min(c.left - 8, window.innerWidth - 300)), top: below };
  } catch {
    return { display: "none" };
  }
}

/** Suggestions while typing (characters at the start of a line, every entry inside the text). */
export function AutocompletePopup({ view }: { view: EditorView }) {
  const t = useT();
  const state = useDoc((s) => s.state);
  const picker = useUi((s) => s.speakerPicker);
  const ac = state ? acKey.getState(state) : null;
  if (!ac || !ac.active || !ac.items.length || picker || !view.hasFocus()) return null;
  const style = place(view, ac.mode === "line" ? ac.from : ac.from, 46 + ac.items.length * 29);
  return (
    <div className="bd-popup" role="listbox" aria-label={t("Suggestions")} style={style} onMouseDown={(e) => e.preventDefault()}>
      {ac.items.map((s, i) => (
        <button key={`${s.kind}-${s.id}-${i}`} type="button" role="option" aria-selected={i === ac.selected} className="bd-popup__row" onClick={() => acceptSuggestion(view, s)}>
          <Icon name={s.kind === "new" ? "plus" : CAT_ICONS[s.icon]} size={14} />
          <span className="bd-popup__name" style={s.cat === "personaggio" ? { letterSpacing: "0.03em" } : undefined}>
            {s.kind === "new" ? t("New character: {name}", { name: s.name.toLocaleUpperCase() }) : s.cat === "personaggio" ? s.name.toLocaleUpperCase() : s.name}
          </span>
          <span className="bd-popup__cat">{s.catName}</span>
        </button>
      ))}
      <div className="bd-popup__foot">
        <Kbd>Tab</Kbd>
        {ac.query ? (
          <>
            {t("or")} <Kbd>{t("Enter")}</Kbd>
          </>
        ) : null}
        {t("chooses")} · <Kbd>Esc</Kbd>
        {ac.mode === "line" ? t("keeps a stage direction") : t("keeps plain text")}
      </div>
    </div>
  );
}

/** Choose who speaks: when a line becomes a speech, or to change the speaker. */
export function SpeakerPickerPopup({ view }: { view: EditorView }) {
  const t = useT();
  const picker = useUi((s) => s.speakerPicker);
  const state = useDoc((s) => s.state);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setQuery("");
    setSel(0);
    if (picker) requestAnimationFrame(() => inputRef.current?.focus());
  }, [picker]);
  const data = state ? getData(state.doc) : null;
  const options = useMemo(() => {
    if (!data) return [];
    const q = fold(query.trim());
    const list = data.characters.filter((c) => !q || fold(c.name).startsWith(q) || fold(c.name).split(/\s+/).some((w) => w.startsWith(q))).map((c) => ({ id: c.id, name: c.name, isNew: false }));
    if (q && !data.characters.some((c) => fold(c.name) === q)) list.push({ id: "", name: niceName(query), isNew: true });
    return list.slice(0, 9);
  }, [data, query]);
  if (!picker || !data) return null;
  const close = () => {
    useUi.getState().setSpeakerPicker(null);
    view.focus();
  };
  const pick = (o: { id: string; name: string; isNew: boolean }) => {
    let sp = { id: o.id, name: o.name };
    if (o.isNew) {
      const tr = view.state.tr;
      sp = ensureCharacter(tr, o.name);
      view.dispatch(tr);
    }
    if (picker.mode === "change") changeSpeaker(view, picker.pos, sp);
    else makeSpeech(view, picker.pos, sp);
    useUi.getState().setSpeakerPicker(null);
    view.focus();
  };
  const style = place(view, picker.pos + 1, 60 + options.length * 29);
  return (
    <div className="bd-popup" role="dialog" aria-label={t("Who speaks?")} style={style}>
      <input
        ref={inputRef}
        className="ts-input"
        placeholder={t("Who speaks? Type a name")}
        value={query}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
          setSel(0);
        }}
        onBlur={() => setTimeout(() => useUi.getState().speakerPicker && close(), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(options.length - 1, s + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
          } else if ((e.key === "Enter" || e.key === "Tab") && options[sel]) {
            e.preventDefault();
            pick(options[sel]);
          }
        }}
      />
      {options.map((o, i) => (
        <button key={`${o.id}-${i}`} type="button" role="option" aria-selected={i === sel} className="bd-popup__row" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>
          <Icon name={o.isNew ? "plus" : "user"} size={14} />
          <span className="bd-popup__name">{o.isNew ? t("New character: {name}", { name: o.name.toLocaleUpperCase() }) : o.name.toLocaleUpperCase()}</span>
        </button>
      ))}
      {!options.length ? <div className="bd-popup__foot">{t("Type the name of a character.")}</div> : null}
    </div>
  );
}
