import { useEffect, useMemo } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, Dialog, Icon, Switch } from "@theatre-suite/ui";
import { DecimalInput } from "../../common/DecimalInput";
import { fmtNum } from "../../lib/format";
import { MAX_TRANSITION, moveInSequence, sequenceMemories, setInSequence, setTransition } from "../../model/sequence";
import type { Memory, Transition } from "../../model/types";
import { useDoc } from "../../store/doc";
import { useShow } from "../../store/show";
import { useUi } from "../../store/ui";
import { showAction } from "./actions";
import "./show.css";

/**
 * Sequence and transitions: the order of the memories in the show and, for each one, how the stage goes to it.
 * Everything is typed (seconds with one decimal); every change is one step of Undo. Memories left out of the sequence
 * stay in the show (Banco, Blind) and can be put back.
 */
export function SequenceDialog() {
  const t = useT();
  const lang = useLang();
  const doc = useDoc((s) => s.doc)!;
  const focusId = useUi((s) => s.sequenceFocusId);
  const liveId = useShow((s) => s.show.liveId);
  const readyId = useShow((s) => s.show.readyId);
  const seq = useMemo(() => sequenceMemories(doc), [doc]);
  const out = useMemo(() => doc.memories.filter((m) => !doc.sequence.includes(m.id)).sort((a, b) => a.number - b.number), [doc]);
  const close = () => useUi.getState().closeDialog();
  const change = (recipe: Parameters<ReturnType<typeof useDoc.getState>["change"]>[0], key?: string) => useDoc.getState().change(recipe, key);

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`gv-seq-${focusId}`);
    el?.scrollIntoView({ block: "center" });
    el?.querySelector<HTMLInputElement>("input")?.focus();
  }, [focusId]);

  const set = (m: Memory, patch: Partial<Transition>, key: string) => change((d) => setTransition(d, m.id, patch), `tr:${m.id}:${key}`);
  const name = (m: Memory) => m.label || t("Memory {n}", { n: m.number });

  return (
    <Dialog
      title={t("Sequence and transitions")}
      icon="listNum"
      width={900}
      onClose={close}
      closeLabel={t("Close")}
      description={t("The order of the show and how the stage goes to each memory. Up: time of the lights that come on or grow; Down: time of those that go off or dim; Delay: wait before starting.")}
      footer={
        <>
          <Button
            icon="reset"
            title={t("The first memory becomes ready again and the clock of the evening starts again at the next GO. The stage does not change.")}
            onClick={() => {
              showAction(t, { type: "restart" });
              useUi.getState().showToast(t("From the top: the first memory is ready."));
            }}
          >
            {t("From the top")}
          </Button>
          <span className="ts-spacer" />
          <Button variant="primary" onClick={close}>
            {t("Done")}
          </Button>
        </>
      }
    >
      <div className="gv-seq">
        <div className="gv-seq__row gv-seq__row--head" aria-hidden>
          <span />
          <span>{t("Memory")}</span>
          <span>{t("Up")}</span>
          <span>{t("Down")}</span>
          <span>{t("Delay")}</span>
          <span>{t("Starts by itself")}</span>
          <span>{t("Moving heads in the dark")}</span>
          <span />
        </div>
        {seq.length === 0 ? <p className="gv-empty">{t("No memories in the sequence yet.")}</p> : null}
        <ol className="gv-seq__list">
          {seq.map((m, i) => (
            <li key={m.id} id={`gv-seq-${m.id}`} className="gv-seq__row" data-live={m.id === liveId ? "" : undefined} data-ready={m.id === readyId ? "" : undefined} data-focus={m.id === focusId ? "" : undefined}>
              <span className="gv-seq__pos">{i + 1}</span>
              <span className="gv-seq__name ts-ellipsis" title={name(m)}>
                <b>{m.number}</b> {name(m)}
                {m.id === liveId ? <span className="gv-seq__tag gv-seq__tag--live">{t("on air")}</span> : m.id === readyId ? <span className="gv-seq__tag gv-seq__tag--ready">{t("ready")}</span> : null}
              </span>
              <DecimalInput value={m.transition.fadeIn} min={0} max={MAX_TRANSITION} decimals={1} unit="s" label={t("Up (seconds) for memory {n}", { n: m.number })} onChange={(v) => set(m, { fadeIn: v }, "in")} />
              <DecimalInput value={m.transition.fadeOut} min={0} max={MAX_TRANSITION} decimals={1} unit="s" label={t("Down (seconds) for memory {n}", { n: m.number })} onChange={(v) => set(m, { fadeOut: v }, "out")} />
              <DecimalInput value={m.transition.delay} min={0} max={MAX_TRANSITION} decimals={1} unit="s" label={t("Delay (seconds) for memory {n}", { n: m.number })} onChange={(v) => set(m, { delay: v }, "delay")} />
              <span className="gv-seq__sw">
                <Switch checked={m.transition.autoFollow} label={t("Starts by itself: at the end, the next memory starts without GO")} onChange={(v) => set(m, { autoFollow: v }, "auto")} />
              </span>
              <span className="gv-seq__sw">
                <Switch checked={m.transition.moveInDark} label={t("Moving heads change position only while they are dark")} onChange={(v) => set(m, { moveInDark: v }, "dark")} />
              </span>
              <span className="gv-seq__tools">
                <Button variant="ghost" iconOnly icon="arrowUp" disabled={i === 0} aria-label={t("Earlier in the show")} title={t("Earlier in the show")} onClick={() => change((d) => moveInSequence(d, m.id, -1))} />
                <Button variant="ghost" iconOnly icon="arrowDown" disabled={i === seq.length - 1} aria-label={t("Later in the show")} title={t("Later in the show")} onClick={() => change((d) => moveInSequence(d, m.id, 1))} />
                <Button variant="ghost" iconOnly icon="eyeOff" aria-label={t("Leave it out of the sequence")} title={t("Leave it out of the sequence (it stays in the show)")} onClick={() => change((d) => setInSequence(d, m.id, false))} />
              </span>
            </li>
          ))}
        </ol>
        {out.length ? (
          <>
            <div className="gv-seq__outhead">{t("Not in the sequence (GO skips them)")}</div>
            <ul className="gv-seq__out">
              {out.map((m) => (
                <li key={m.id} id={`gv-seq-${m.id}`}>
                  <span className="ts-ellipsis">
                    <b>{m.number}</b> {name(m)}
                  </span>
                  <Button variant="sm" icon="plus" onClick={() => change((d) => setInSequence(d, m.id, true))}>
                    {t("Put back at the end")}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="ts-muted gv-seq__note">
          <Icon name="info" size={13} /> {t("New memories take the default crossfade of the Settings ({s} s).", { s: fmtNum(doc.settings.defaultCrossfade, lang, 1) })}
        </p>
      </div>
    </Dialog>
  );
}
