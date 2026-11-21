import { memo, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLang, useT, type TFunc } from "@theatre-suite/core";
import { Icon } from "@theatre-suite/ui";
import { StageView2D } from "../../stage";
import { stateUniverse } from "../../model/memories";
import { sequenceMemories } from "../../model/sequence";
import { fadeElapsed, fadeProgress, type ShowFade } from "../../model/show";
import type { GranveloDoc, Memory } from "../../model/types";
import { useDoc } from "../../store/doc";
import { useShow } from "../../store/show";
import { useUi } from "../../store/ui";
import { transitionParts } from "../transitionText";
import { lockedSays, showAction } from "./actions";

/**
 * "Nastro": the strip of the Show. From the left: the memory on air (green), the transition box (fills while the
 * transition runs), the memory ready for the next GO (amber), then the following ones, smaller and fading to the right.
 * On GO the strip slides left in the time of the transition (back: right); Pausa stops it where it is.
 */

/** Slot sizes in pixels (the strip is laid out here so that every card can move from its old slot to its new one). */
const LIVE_W = 250;
const TRANS_W = 196;
const READY_W = 216;
const NEXT_W = 150;
const GAP = 10;
const FOLLOWING = 6;

/** Rank in the strip: −1 before the live one (gone), 0 live, 1 ready, 2… the following ones. */
function slot(rank: number): { x: number; w: number } {
  if (rank < 0) return { x: -(LIVE_W + GAP), w: LIVE_W };
  if (rank === 0) return { x: 0, w: LIVE_W };
  if (rank === 1) return { x: LIVE_W + TRANS_W + 2 * GAP, w: READY_W };
  return { x: LIVE_W + TRANS_W + READY_W + 3 * GAP + (rank - 2) * (NEXT_W + GAP), w: NEXT_W };
}

const title = (t: TFunc, m: Pick<Memory, "number" | "label">) => m.label || t("Memory {n}", { n: m.number });

/** Minutes:seconds (or h:mm:ss). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The current time, refreshed every `ms` while `on` (for elapsed times and bars). */
export function useNow(ms: number, on = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, on]);
  return now;
}

const fadeElapsedNow = (f: ShowFade) => fadeElapsed(f, Date.now());

const Thumb = memo(function Thumb({ doc, m }: { doc: GranveloDoc; m: Memory }) {
  const values = useMemo(() => stateUniverse(doc, m.state), [doc.fixtures, m.state]);
  const stageDoc = useMemo(() => ({ stage: doc.stage, trusses: doc.trusses, fixtures: doc.fixtures, scenery: doc.scenery }), [doc.stage, doc.trusses, doc.fixtures, doc.scenery]);
  return (
    <span className="gv-stagebox gv-nastro__thumb" aria-hidden>
      <StageView2D doc={stageDoc} view="plan" values={values} scenery={m.scenery} compact />
    </span>
  );
});

export function Nastro() {
  const t = useT();
  const lang = useLang();
  const doc = useDoc((s) => s.doc)!;
  const st = useShow((s) => s.show);
  const locked = useShow((s) => s.locked);
  const seq = useMemo(() => sequenceMemories(doc), [doc]);
  const byId = useMemo(() => new Map(doc.memories.map((m) => [m.id, m])), [doc.memories]);
  const fade = st.fade;
  const running = !!fade && fade.pausedAt === null;
  const now = useNow(running ? 50 : 1000);
  const live = st.liveId ? byId.get(st.liveId) : undefined;
  const ready = st.readyId ? byId.get(st.readyId) : undefined;
  const progress = fadeProgress(fade, now);

  // What the strip shows now (live, ready, following) and, during a transition, what it showed before it.
  const after = (id: string | null | undefined, n: number) => {
    const i = id ? seq.findIndex((m) => m.id === id) : -1;
    return i >= 0 ? seq.slice(i + 1, i + 1 + n).map((m) => m.id) : [];
  };
  const shown: Array<string | null> = [st.liveId, st.readyId, ...after(st.readyId, FOLLOWING)];
  const before: Array<string | null> | null = fade ? (fade.back ? [fade.fromId, ...after(fade.fromId, FOLLOWING + 1)] : [fade.fromId, fade.toId, ...after(fade.toId, FOLLOWING)]) : null;
  const gone = before?.[0] && !shown.includes(before[0]) ? before[0] : null;

  // Every card moves from its old slot to its new one in the time of the transition (Pausa stops it). The start is
  // taken once, when the transition starts (or when the Show is opened during one), so the strip is where the lights are.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const startOffset = useMemo(() => (fade ? Math.min(fade.durationMs, fadeElapsedNow(fade)) : 0), [fade?.toId, fade?.startedAt]);
  const motion = (id: string | null, rank: number): CSSProperties => {
    const to = slot(rank);
    const base: CSSProperties = { left: to.x, width: to.w };
    if (!fade || !before || !id) return base;
    // On Indietro the memory coming back was just before the one on air (off the strip, on the left).
    const old = fade.back && id === fade.toId ? -1 : before.indexOf(id);
    const from = old >= 0 || (fade.back && id === fade.toId) ? slot(old) : slot(rank + 1);
    if (from.x === to.x && from.w === to.w) return base;
    return {
      ...base,
      ["--gv-dx" as string]: `${from.x - to.x}px`,
      ["--gv-w0" as string]: `${from.w}px`,
      animationName: "gv-nastro-move",
      animationDuration: `${Math.max(1, fade.durationMs)}ms`,
      animationDelay: `-${startOffset}ms`,
      animationPlayState: fade.pausedAt !== null ? "paused" : "running",
    };
  };
  const moveKey = fade ? `:${fade.startedAt}` : "";

  const choose = (m: Memory) => {
    if (lockedSays(t)) return;
    showAction(t, { type: "setReady", id: m.id });
  };
  const edit = (m: Memory | undefined) => {
    if (lockedSays(t)) return;
    useUi.getState().openSequence(m?.id ?? null);
  };

  const card = (m: Memory, rank: number) => {
    const role = rank === 0 ? "live" : rank === 1 ? "ready" : rank < 0 ? "past" : "next";
    if (role === "past")
      return (
        <div key={m.id + moveKey} className="gv-nastro__box gv-nastro__card" style={{ ...motion(m.id, rank), opacity: 0.6 }} aria-hidden>
          <Thumb doc={doc} m={m} />
          <span className="gv-nastro__name ts-ellipsis">
            <b>{m.number}</b> {title(t, m)}
          </span>
        </div>
      );
    if (role === "next")
      return (
        <button
          key={m.id + moveKey}
          type="button"
          className="gv-nastro__next gv-nastro__card"
          style={{ ...motion(m.id, rank), opacity: Math.max(0.25, 0.9 - (rank - 2) * 0.14) }}
          disabled={locked}
          title={locked ? undefined : t("Make it the next memory")}
          onClick={() => choose(m)}
        >
          <span className="gv-nastro__name ts-ellipsis">
            <b>{m.number}</b> {title(t, m)}
          </span>
          <span className="gv-nastro__meta ts-ellipsis">{transitionParts(t, lang, m.transition).main}</span>
        </button>
      );
    return (
      <div key={m.id + moveKey} className={`gv-nastro__box gv-nastro__card gv-nastro__box--${role}`} style={motion(m.id, rank)} aria-live={role === "live" ? "polite" : undefined}>
        {role === "live" ? (
          <span className="gv-nastro__tag gv-nastro__tag--live">
            <span className="ts-dot ts-dot--go" />
            {t("ON AIR")}
            {st.liveSince !== null ? <span className="gv-nastro__since">{t("for {time}", { time: clock(now - st.liveSince) })}</span> : null}
          </span>
        ) : (
          <span className="gv-nastro__tag gv-nastro__tag--ready">
            <span className="ts-dot ts-dot--sb" />
            {t("READY")}
            <span className="gv-nastro__since">{t("at the next GO")}</span>
          </span>
        )}
        <Thumb doc={doc} m={m} />
        <span className="gv-nastro__name ts-ellipsis" title={title(t, m)}>
          <b>{m.number}</b> {title(t, m)}
        </span>
      </div>
    );
  };

  /**
   * A transition box between two cards. While the strip moves, the running one travels with the memory it brings on
   * stage (it slides out on the left as it fills; on Indietro it opens between the two), and the box of the next GO
   * opens between the new live and ready cards (on Indietro, the old one closes): nothing ever covers the cards.
   */
  const tMove = (x0: number, w0: number, x1: number, w1: number, kind: "travel" | "open" | "close" = "travel"): CSSProperties => {
    if (!fade || (x0 === x1 && w0 === w1)) return { left: x1, width: w1 };
    // A box that opens or closes is only seen when it is (nearly) open: a half-open one would squeeze its text, also while paused.
    const names = kind === "travel" ? "gv-nastro-move" : `gv-nastro-move, gv-nastro-${kind}`;
    const rep = (v: string) => (kind === "travel" ? v : `${v}, ${v}`);
    return {
      left: x1,
      width: w1,
      ["--gv-dx" as string]: `${x0 - x1}px`,
      ["--gv-w0" as string]: `${w0}px`,
      animationName: names,
      animationDuration: rep(`${Math.max(1, fade.durationMs)}ms`),
      animationDelay: rep(`-${startOffset}ms`),
      animationPlayState: rep(fade.pausedAt !== null ? "paused" : "running"),
    };
  };
  const transBox = (m: Memory | undefined, isRunning: boolean, style: CSSProperties, key: string) => {
    const parts = m ? transitionParts(t, lang, m.transition) : null;
    const paused = isRunning && fade?.pausedAt != null;
    return (
      <div key={key + moveKey} className="gv-nastro__trans gv-nastro__card" style={style} data-paused={paused ? "" : undefined} data-running={isRunning ? "" : undefined}>
        <div className="gv-nastro__trin">
          {parts ? (
            <>
              <span className="gv-nastro__trmain">{parts.main}</span>
              <span className="gv-nastro__bar" role={isRunning ? "progressbar" : undefined} aria-valuemin={0} aria-valuemax={100} aria-valuenow={isRunning ? Math.round(progress * 100) : undefined} aria-label={t("Transition")}>
                <span style={{ width: `${(isRunning ? progress : 0) * 100}%` }} />
              </span>
              <span className="gv-nastro__trstate">{isRunning ? (paused ? t("PAUSED · P to go on") : t("in progress · {p} %", { p: Math.round(progress * 100) })) : t("at the next GO")}</span>
              <span className="gv-nastro__trextra" title={parts.extra.join(" · ")}>
                {parts.extra.length ? parts.extra.join(" · ") : t("no delay, no options")}
              </span>
              {!locked && m ? (
                <button type="button" className="gv-nastro__edit" onClick={() => edit(m)} title={t("Change the transition")} aria-label={t("Change the transition")}>
                  <Icon name="pencil" size={13} />
                </button>
              ) : null}
            </>
          ) : (
            <span className="gv-nastro__trstate">{t("No transition")}</span>
          )}
        </div>
      </div>
    );
  };

  const goneMemory = gone ? byId.get(gone) : undefined;
  return (
    <section className="gv-nastro" aria-label={t("Sequence")} data-locked={locked ? "" : undefined}>
      <div className="gv-nastro__track">
        {goneMemory ? card(goneMemory, -1) : null}
        {live ? (
          card(live, 0)
        ) : (
          <div className="gv-nastro__box gv-nastro__card gv-nastro__box--live" style={{ left: 0, width: LIVE_W }}>
            <span className="gv-nastro__tag gv-nastro__tag--live">
              <span className="ts-dot ts-dot--go" />
              {t("ON AIR")}
            </span>
            <span className="gv-nastro__empty">{t("Nothing called yet: press GO to start.")}</span>
          </div>
        )}
        {ready ? (
          card(ready, 1)
        ) : (
          <div className="gv-nastro__box gv-nastro__card gv-nastro__box--ready" style={{ left: slot(1).x, width: READY_W }}>
            <span className="gv-nastro__tag gv-nastro__tag--ready">
              <span className="ts-dot ts-dot--sb" />
              {t("READY")}
            </span>
            <span className="gv-nastro__empty">{seq.length ? t("End of the sequence: no more memories.") : t("The sequence is empty.")}</span>
          </div>
        )}
        {shown.slice(2).map((id, i) => {
          const m = id ? byId.get(id) : undefined;
          return m ? card(m, i + 2) : null;
        })}

        {fade && before ? (
          <>
            {transBox(byId.get(fade.toId), true, fade.back ? tMove(0, 0, LIVE_W + GAP, TRANS_W) : tMove(LIVE_W + GAP, TRANS_W, -(TRANS_W + GAP), TRANS_W), "run")}
            {fade.back
              ? transBox(before[1] ? byId.get(before[1]) : undefined, false, tMove(LIVE_W + GAP, TRANS_W, slot(2).x - GAP, 0, "close"), "old")
              : transBox(ready, false, tMove(slot(1).x + READY_W + GAP, 0, LIVE_W + GAP, TRANS_W, "open"), "next")}
          </>
        ) : (
          transBox(ready, false, { left: LIVE_W + GAP, width: TRANS_W }, "idle")
        )}
      </div>
    </section>
  );
}
