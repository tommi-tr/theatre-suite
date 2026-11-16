import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { checkLook, checkPlan, restorePoint, runStep, setBroken, startRun, summarize, type CheckColor, type RunAction, type Verdict } from "../../model/check";
import { useDoc } from "../../store/doc";
import { isSending, useOutput } from "../../store/output";
import { useUi } from "../../store/ui";
import { Intro, LightStep, Strip, Summary } from "./CheckParts";
import "./check.css";

/** Level of the lights during the check: full, or half "so as not to dazzle". */
export type CheckLevel = 1 | 0.5;

const SILENCE = new Uint8Array(512);

/**
 * "Controllo luci" — turns on one light at a time (through the output store, the single door to the lights), goes
 * forward and back, lets the person say "Funziona" or "Non va" (a mark on the light in the document, undoable) and
 * ends with a summary. Self-contained: Allestimento opens it with `openDialog("check")`, Show can do the same.
 *
 * Stage safety: nothing is sent before the person presses "Inizia il controllo"; at that moment the values under the
 * output master are remembered, and they are sent back exactly when the dialog closes in any way.
 */
export function CheckDialog() {
  const t = useT();
  const doc = useDoc((s) => s.doc);
  const sending = useOutput((s) => isSending(s.status));
  const plan = useMemo(() => checkPlan(doc ?? { fixtures: [] }), [doc?.fixtures]); // eslint-disable-line react-hooks/exhaustive-deps
  const [started, setStarted] = useState(false);
  const [run, dispatch] = useReducer((r: ReturnType<typeof startRun>, a: RunAction) => runStep(r, a, plan.steps.length), undefined, startRun);
  const [level, setLevel] = useState<CheckLevel>(1);
  // The colour asked belongs to one light: another light starts again from white.
  const [asked, setAsked] = useState<{ id: string | null; color: CheckColor }>({ id: null, color: "white" });

  // What the stage looked like before the first light (null = nothing was touched yet).
  const before = useRef<{ values: Uint8Array; testChannels: number | null } | null>(null);

  const restore = useCallback(() => {
    const b = before.current;
    before.current = null;
    if (!b) return;
    const out = useOutput.getState();
    void out
      .setUniverse(b.values)
      .then(() => (b.testChannels ? out.startTest(b.testChannels) : undefined))
      .catch((e) => console.error("[check] restore", e));
  }, []);

  const exit = useCallback(() => {
    restore();
    useUi.getState().closeDialog();
  }, [restore]);

  // Closing in any other way (another show opened, the window closing) also gives the stage back.
  useEffect(() => restore, [restore]);

  const begin = useCallback(() => {
    const out = useOutput.getState();
    before.current = { values: restorePoint(out.under), testChannels: out.live.test ? out.live.test.of : null };
    if (out.live.test) void out.stopTest();
    setStarted(true);
  }, []);

  const lightId = started && run.view === "light" ? (plan.steps[run.index] ?? null) : null;
  const fixture = lightId ? doc?.fixtures.find((f) => f.id === lightId) : undefined;
  const signature = fixture ? JSON.stringify([fixture.address, fixture.channels, fixture.unused]) : "";

  const color: CheckColor = asked.id === lightId ? asked.color : "white";
  const setColor = useCallback((c: CheckColor) => setAsked({ id: lightId, color: c }), [lightId]);

  // The output follows what is on screen.
  useEffect(() => {
    if (!started) return;
    const d = useDoc.getState().doc;
    const values = lightId && d ? checkLook(d, lightId, level, color) : SILENCE;
    useOutput
      .getState()
      .setUniverse(values)
      .catch((e) => useUi.getState().showToast(String(e), "error"));
  }, [started, lightId, level, color, signature, sending]);

  const mark = useCallback(
    (id: string, verdict: Verdict, advance: boolean) => {
      useDoc.getState().change((d) => setBroken(d, id, verdict === "broken"), `check:${id}`);
      dispatch({ type: "verdict", id, verdict, advance });
    },
    [],
  );

  const act = useCallback((a: RunAction) => dispatch(a), []);

  // Keyboard: ← → Space, Esc. In the capture phase, so a focused button does not also react to Space.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        exit();
        return;
      }
      if (!started || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      let a: RunAction | null = null;
      if (e.key === "ArrowRight" || e.key === " ") a = { type: "next" };
      else if (e.key === "ArrowLeft") a = { type: "back" };
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) dispatch(a);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [started, exit]);

  if (!doc) return null;
  const summary = summarize(plan, run.verdicts);

  return (
    <div className="ts-overlay gv-chk-overlay">
      <section role="dialog" aria-modal="true" aria-label={t("Light check")} className="ts-dialog gv-chk">
        <header className="gv-chk__head">
          <span className="gv-chk__title">
            <Icon name="bulb" size={18} />
            {t("Light check")}
          </span>
          {started && plan.steps.length > 0 ? (
            <span className="gv-chk__pos" aria-live="polite">
              {run.view === "summary" ? t("Summary") : t("{n} of {total}", { n: run.index + 1, total: plan.steps.length })}
            </span>
          ) : null}
          <span className="ts-spacer" />
          <Button variant="ghost" icon="x" kbd="Esc" onClick={exit} title={t("Finish the check: the lights go back as they were")}>
            {started ? t("Finish") : t("Close")}
          </Button>
        </header>
        {!started ? (
          <Intro plan={plan} onStart={begin} onClose={exit} />
        ) : (
          <>
            {plan.steps.length > 0 ? <Strip plan={plan} run={run} fixtures={doc.fixtures} onGo={(i) => act({ type: "goto", index: i })} onSummary={() => act({ type: "summary" })} /> : null}
            {run.view === "summary" || plan.steps.length === 0 ? (
              <Summary plan={plan} summary={summary} onGo={(i) => act({ type: "goto", index: i })} onRestart={() => act({ type: "restart" })} onExit={exit} />
            ) : fixture ? (
              <LightStep
                key={fixture.id}
                doc={doc}
                fixture={fixture}
                verdict={run.verdicts[fixture.id]}
                level={level}
                color={color}
                last={run.index === plan.steps.length - 1}
                first={run.index === 0}
                onLevel={setLevel}
                onColor={setColor}
                onAct={act}
                onVerdict={(v) => mark(fixture.id, v, true)}
              />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
