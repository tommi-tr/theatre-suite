import { useEffect } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { fmtAddress } from "../../lib/format";
import { useDoc } from "../../store/doc";
import { useUi } from "../../store/ui";
import { hasRoom, undoLast } from "./numbering";
import { commitNumbering, numberingGuard, useSetup } from "./store";

/**
 * The floating bar of "Numera a clic": the next address, "Annulla l'ultima" and "Fine". While it runs, Esc ends it and
 * Ctrl+Z takes back the last click. If the document changes in any other way (undo from the top bar, another
 * edit) the run ends, so what the bar says is always true.
 */
export function NumberingBar() {
  const t = useT();
  const state = useSetup((s) => s.numbering);
  const active = state !== null;

  // Anything that changes the document other than the run itself ends the run.
  useEffect(() => {
    if (!active) return;
    return useDoc.subscribe((s) => {
      if (s.doc !== numberingGuard.doc) {
        useSetup.getState().setNumbering(null);
        useUi.getState().showToast(t("Numbering ended: the lights were changed in another way."));
      }
    });
  }, [active, t]);

  const takeBack = () => {
    const s = useSetup.getState().numbering;
    if (!s || s.steps.length === 0) return;
    const r = undoLast(useDoc.getState().doc!, s);
    commitNumbering(r.doc, r.state);
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().dialog) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        useSetup.getState().setNumbering(null);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopImmediatePropagation();
        takeBack();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!state) return null;
  const full = !hasRoom(state, 1);
  return (
    <div className="gv-numbar" role="status" aria-live="polite">
      <Icon name="listNum" size={16} />
      <span className="gv-numbar__text">
        {full ? (
          <b>{t("No more room: the last channel is 512")}</b>
        ) : (
          <>
            {t("Next address")}: <b className="gv-numbar__addr">{fmtAddress(state.next)}</b> · {t("click the next light")}
          </>
        )}
      </span>
      <span className="gv-numbar__count">{state.steps.length === 1 ? t("1 light numbered") : t("{n} lights numbered", { n: state.steps.length })}</span>
      <Button variant="sm" icon="reset" disabled={state.steps.length === 0} onClick={takeBack} title={`${t("Undo the last")} · Ctrl Z`}>
        {t("Undo the last")}
      </Button>
      <Button variant="primary" icon="check" kbd="Esc" onClick={() => useSetup.getState().setNumbering(null)}>
        {t("Done")}
      </Button>
    </div>
  );
}
