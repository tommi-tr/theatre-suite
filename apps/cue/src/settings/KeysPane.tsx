import { Fragment, useMemo, useState } from "react";
import { create } from "zustand";
import { useT } from "@theatre-suite/core";
import { Button, Icon, Kbd } from "@theatre-suite/ui";
import {
  chordFromEvent,
  chordParts,
  cloneKeymap,
  DEFAULT_KEYMAP,
  findConflicts,
  keyActionInfo,
  KEY_ACTIONS,
  PEDAL_CHORD,
  sameKeymap,
  type KeyAction,
  type KeyGroup,
  type Keymap,
} from "../model/keys";
import { useSettings } from "../store/settings";
import "./settings.css";

const GROUPS: { id: KeyGroup; label: string }[] = [
  { id: "show", label: "During the show" },
  { id: "script", label: "Script" },
  { id: "prepare", label: "In Prepare" },
];

/** The keymap being edited (until it is saved: it survives a change of category in Settings). */
const useKeyDraft = create<{ draft: Keymap | null; set: (k: Keymap | null) => void }>((set) => ({ draft: null, set: (draft) => set({ draft }) }));

/** The way a chord is written on key caps, for a label. */
const chordText = (chord: string, space: string) => chordParts(chord, space).join(" + ");

/**
 * Settings → Tasti: every action with its keys. Click a key and press the new one; "+" adds an alternative. Keys shared by two
 * actions that work at the same time are red, with the name of the other one, and Save waits until they are resolved.
 */
export function KeysPane() {
  const t = useT();
  const saved = useSettings((s) => s.settings.keymap);
  const stored = useKeyDraft((s) => s.draft);
  const draft = stored ?? saved;
  const dirty = !sameKeymap(draft, saved);
  const conflicts = useMemo(() => findConflicts(draft), [draft]);
  const [capturing, setCapturing] = useState<{ action: KeyAction; index: number } | null>(null);
  const space = t("Space");

  const edit = (fn: (k: Keymap) => void) => {
    const next = cloneKeymap(draft);
    fn(next);
    useKeyDraft.getState().set(sameKeymap(next, saved) ? null : next);
  };
  const setChord = (action: KeyAction, index: number, chord: string) =>
    edit((k) => {
      const list = k[action];
      const at = Math.min(index, list.length);
      list[at] = chord;
      // The same key twice on one action is one key.
      k[action] = list.filter((c, i) => c !== chord || i === at);
    });
  const removeChord = (action: KeyAction, index: number) => edit((k) => void k[action].splice(index, 1));

  const conflictOf = (action: KeyAction, chord: string) => conflicts.find((c) => c.action === action && c.chord === chord);
  const save = () => {
    useSettings.getState().update({ keymap: cloneKeymap(draft) });
    useKeyDraft.getState().set(null);
  };

  return (
    <>
      <div className="cue-set-intro">
        <span>{t("Click a key and press the new one. A key cannot do two things at the same time.")}</span>
      </div>
      <div className="cue-keyedit__bar">
        <Button variant="ghost" icon="reset" disabled={sameKeymap(draft, DEFAULT_KEYMAP)} onClick={() => useKeyDraft.getState().set(sameKeymap(DEFAULT_KEYMAP, saved) ? null : cloneKeymap(DEFAULT_KEYMAP))}>
          {t("Restore the defaults")}
        </Button>
        <span className="ts-spacer" style={{ flex: 1 }} />
        {conflicts.length > 0 ? <span className="cue-keyedit__msg">{t("Fix the red keys to save.")}</span> : null}
        {dirty ? (
          <Button variant="ghost" onClick={() => useKeyDraft.getState().set(null)}>
            {t("Discard changes")}
          </Button>
        ) : null}
        <Button variant="primary" icon="check" disabled={!dirty || conflicts.length > 0} onClick={save}>
          {t("Save the keys")}
        </Button>
      </div>
      <div className="cue-keyedit">
        {GROUPS.map((g) => (
          <Fragment key={g.id}>
            <div className="ts-label cue-keys__group">{t(g.label)}</div>
            {KEY_ACTIONS.filter((a) => a.group === g.id).map((a) => {
              const list = draft[a.id];
              const bad = list.some((c) => conflictOf(a.id, c));
              return (
                <div key={a.id} className={`cue-keyedit__row${a.danger ? " cue-keyedit__row--danger" : ""}${bad ? " cue-keyedit__row--bad" : ""}`}>
                  <div className="cue-keyedit__name">
                    <div>{t(a.label)}</div>
                    {list.map((c) => {
                      const k = conflictOf(a.id, c);
                      if (!k) return null;
                      return (
                        <div key={c} className="cue-keyedit__msg" role="alert">
                          {k.other ? t("{key} is already used by {name}", { key: chordText(c, space), name: t(keyActionInfo(k.other).label) }) : t("{key} is used by Cue itself", { key: chordText(c, space) })}
                        </div>
                      );
                    })}
                    {a.id === "go" ? <div className="cue-keyedit__fixed">{t("F13 (the pedal) is always GO")}</div> : null}
                  </div>
                  <span className="cue-keyedit__keys">
                    {list.length === 0 ? <span className="ts-muted">{t("no key")}</span> : null}
                    {list.map((chord, i) => {
                      const on = capturing?.action === a.id && capturing.index === i;
                      const k = conflictOf(a.id, chord);
                      return (
                        <span key={`${chord}:${i}`} className="cue-keyedit__keys">
                          <button
                            type="button"
                            className={`cue-chip${on ? " cue-chip--on" : ""}${k ? " cue-chip--bad" : ""}`}
                            aria-label={`${t(a.label)}: ${chordText(chord, space)}`}
                            title={t("Click, then press the new key")}
                            onClick={() => setCapturing(on ? null : { action: a.id, index: i })}
                            onBlur={() => setCapturing((c) => (c?.action === a.id && c.index === i ? null : c))}
                            onKeyDown={(e) => {
                              if (!on) return;
                              e.preventDefault();
                              e.stopPropagation();
                              const c = chordFromEvent(e.nativeEvent);
                              if (!c) return;
                              setChord(a.id, i, c);
                              setCapturing(null);
                            }}
                          >
                            {on ? (
                              <span className="ts-muted">{t("Press a key…")}</span>
                            ) : (
                              <>
                                {chordParts(chord, space).map((p, j) => (
                                  <Kbd key={j}>{p}</Kbd>
                                ))}
                                {a.double ? <Kbd>{chordParts(chord, space).at(-1) ?? ""}</Kbd> : null}
                              </>
                            )}
                          </button>
                          {list.length > 1 || a.id !== "go" ? (
                            <button type="button" className="cue-chip__x" title={t("Remove this key")} aria-label={`${t("Remove this key")}: ${chordText(chord, space)}`} onClick={() => removeChord(a.id, i)}>
                              <Icon name="x" size={11} />
                            </button>
                          ) : null}
                        </span>
                      );
                    })}
                    {capturing?.action === a.id && capturing.index === list.length ? (
                      <button
                        type="button"
                        autoFocus
                        className="cue-chip cue-chip--on"
                        onBlur={() => setCapturing(null)}
                        onKeyDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const c = chordFromEvent(e.nativeEvent);
                          if (!c) return;
                          setChord(a.id, list.length, c);
                          setCapturing(null);
                        }}
                      >
                        <span className="ts-muted">{t("Press a key…")}</span>
                      </button>
                    ) : (
                      <button type="button" className="cue-chip__add" title={t("Add another key")} aria-label={`${t("Add another key")}: ${t(a.label)}`} onClick={() => setCapturing({ action: a.id, index: list.length })}>
                        <Icon name="plus" size={12} />
                      </button>
                    )}
                    {a.held ? <span className="ts-muted">{t("held down")}</span> : null}
                  </span>
                </div>
              );
            })}
            {g.id === "script" ? (
              <div className="cue-keyedit__fixed">
                <Kbd>Ctrl</Kbd> <span>{t("Peek at the script")}</span> <span className="ts-muted">{t("held down")}</span>
              </div>
            ) : null}
          </Fragment>
        ))}
      </div>
      <div className="cue-pedal">
        <span className="cue-pedal__icon">
          <Icon name="flag" size={18} />
        </span>
        <div>
          <div className="ts-set-row__label">
            {t("Pedal")} · <span className="ts-muted">{t("Coming soon")}</span>
          </div>
          <div className="ts-field__hint">{t("A pedal that types {key} already works as GO, even while the chat is open. The pedal itself comes later.", { key: PEDAL_CHORD })}</div>
        </div>
      </div>
    </>
  );
}
