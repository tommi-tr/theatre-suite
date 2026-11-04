import { formatTime, useT } from "@theatre-suite/core";
import { Icon, NumberField, Range } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { stopEverything } from "../lib/launchpad";
import { useUi } from "../state/ui";
import { effectiveOut, trackDuration, useDoc } from "../state/doc";
import { useSettings } from "../state/settings";
import { atEndIcon, atEndText, nextGoEffect, standbySteps, type GoStep } from "./labels";

const go = () => api.engineGo().catch((e) => useUi.getState().showToast(String(e), "error"));

/** Main volume: fader position (0…100) ↔ dB. */
const toDb = (p: number) => (p <= 0 ? -60 : Math.round(((p / 100) * 70 - 60) * 2) / 2);
const toPos = (db: number) => Math.max(0, Math.min(100, ((db + 60) / 70) * 100));
const dbText = (db: number) => (db <= -60 ? "−∞ dB" : `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(1).replace(".", ",")} dB`);

export function GoBar({ numbers, typed }: { numbers: Map<string, number>; typed: string }) {
  const t = useT();
  const tracks = useDoc((s) => s.tracks);
  const live = useDoc((s) => s.live);
  const infos = useDoc((s) => s.infos);
  const settings = useSettings((s) => s.settings);
  const steps = standbySteps(t, live, tracks, settings);
  const first: GoStep | null = steps[0] ?? null;
  const goTrack = first?.trackId ? tracks.find((x) => x.id === first.trackId) ?? null : null;

  // The track in front: the main one, else the newest that plays.
  const current =
    live.voices.find((v) => v.main) ?? [...live.voices].reverse().find((v) => !v.paused && v.fading !== "out") ?? live.voices[live.voices.length - 1] ?? null;
  const curTrack = current ? tracks.find((x) => x.id === current.trackId) ?? null : null;
  const curDur = curTrack ? trackDuration(curTrack, infos) ?? current?.durationSec ?? null : null;
  const curOut = curTrack ? effectiveOut(curTrack, curDur) : null;
  const left = current && curOut !== null ? Math.max(0, curOut - current.positionSec) : null;
  const others = new Set(live.voices.map((v) => v.trackId)).size - (current ? 1 : 0);
  const anyPlaying = live.voices.some((v) => !v.paused);
  const pausedAll = live.pausedAll;

  const kicker = !current
    ? ""
    : pausedAll || current.paused
      ? t("PAUSED")
      : current.fading === "in"
        ? t("FADING IN")
        : current.fading === "out"
          ? t("FADING OUT")
          : current.inLoop
            ? t("LOOPING")
            : t("PLAYING");

  return (
    <section className="df-gobar" aria-label={t("Transport")}>
      <div className="df-gobar__left">
        <button
          type="button"
          className="df-stopall"
          onClick={() => stopEverything(false)}
          onDoubleClick={() => stopEverything(true)}
          onKeyDown={(e) => e.key === " " && e.preventDefault()}
          title={t("Fades out everything · twice: stops at once")}
        >
          <span className="df-stopall__label">
            <Icon name="stopAll" size={15} />
            {t("Stop all")}
          </span>
          <span className="df-kbd-stop">Esc</span>
        </button>
        <button
          type="button"
          className={pausedAll ? "df-pauseall df-pauseall--on" : "df-pauseall"}
          disabled={!anyPlaying && !pausedAll}
          onClick={() => api.enginePauseAll().catch(() => {})}
          onKeyDown={(e) => e.key === " " && e.preventDefault()}
          aria-pressed={pausedAll}
          title={pausedAll ? t("Resume everything (P, or GO)") : t("Pause everything that plays (P)")}
        >
          <span className="df-stopall__label">
            <Icon name={pausedAll ? "playF" : "pauseF"} size={14} />
            {pausedAll ? t("Resume") : t("Pause all")}
          </span>
          <span className="df-kbd-pause">P</span>
        </button>
      </div>

      {current && curTrack ? (
        <div className={pausedAll ? "df-gobox df-gobox--go df-blink" : current.paused ? "df-gobox df-gobox--go df-gobox--paused" : "df-gobox df-gobox--go"}>
          <div className="df-bigbadge" style={{ background: "var(--go-fill)", color: "var(--go-ink)" }}>
            {numbers.get(curTrack.id) ?? "–"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="df-gobox__kicker" style={{ color: "var(--go)" }}>
              <span className="ts-dot ts-dot--go" style={{ width: 7, height: 7 }} />
              {kicker}
              {others > 0 ? <span style={{ color: "var(--text-3)", letterSpacing: 0 }}>· {t("+{n} more", { n: others })}</span> : null}
            </div>
            <div className="df-gobox__title">{curTrack.file?.name}</div>
            <div className="df-gobox__meta">
              <Icon name={atEndIcon(curTrack.atEnd)} size={12} />
              {t("At end or Space")} <b style={{ color: "var(--text)", fontWeight: 600 }}>{atEndText(t, curTrack.atEnd)}</b>
              <span style={{ color: "var(--text-3)" }}>· {nextGoEffect(t, live, curTrack.id, curTrack, settings.othersOnGo)}</span>
            </div>
          </div>
          <div className="mono" style={{ flex: "none", textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{formatTime(current.positionSec)}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>{left !== null ? `${formatTime(-left)} ${t("left")}` : ""}</div>
          </div>
        </div>
      ) : (
        <div className="df-gobox df-gobox--empty df-gobox--go-empty">
          <span className="ts-dot" />
          <span>{t("Nothing is playing")}</span>
        </div>
      )}

      <div className="df-gobar__center">
        <button
          type="button"
          className={first?.kind === "stop" || first?.kind === "fadeOut" ? "df-go df-go--step" : "df-go"}
          disabled={!first || (!live.engine.ready && first.kind !== "resume")}
          aria-label={first ? `GO: ${first.verb}${goTrack ? ` ${numbers.get(goTrack.id) ?? ""}` : ""}` : t("GO")}
          onClick={go}
          onKeyDown={(e) => e.key === " " && e.preventDefault()}
        >
          <span className="df-go__main">
            <Icon name="playF" size={20} />
            <span className="df-go__label">GO</span>
            <span className="df-go__kbd">Space</span>
          </span>
          <span className="df-go__sub">
            {first ? <Icon name={first.icon} size={11} strokeWidth={2.4} /> : null}
            <span className="ts-ellipsis">
              {first ? `${first.verb}${goTrack ? ` ${numbers.get(goTrack.id) ?? ""}` : ""}` : t("Nothing in standby")}
            </span>
          </span>
        </button>
        <MainVolume />
      </div>

      <div className={steps.length || typed ? "df-gobox df-gobox--sb" : "df-gobox df-gobox--empty df-gobox--sb-empty"}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <div className="df-gobox__kicker" style={{ color: steps.length || typed ? "var(--sb)" : "var(--text-3)" }}>
            {typed ? t("TYPE THE NUMBER, THEN ENTER") : steps.length > 1 ? t("STANDBY · 2 STEPS") : t("STANDBY")}
          </div>
          {typed ? (
            <div className="df-sbstep df-sbstep--first">
              <span className="df-sbstep__n">{typed}</span>
              <span className="df-sbstep__name">…</span>
            </div>
          ) : steps.length ? (
            steps.map((st, i) => {
              const tr = st.trackId ? tracks.find((x) => x.id === st.trackId) ?? null : null;
              return (
                <div key={i} className={i === 0 ? "df-sbstep df-sbstep--first" : "df-sbstep"}>
                  {steps.length > 1 ? <span className="df-sbstep__ord">{i + 1}</span> : null}
                  <span className="df-sbstep__verb">
                    <Icon name={st.icon} size={11} strokeWidth={2.4} />
                    {st.verb}
                  </span>
                  {tr ? <span className="df-sbstep__n">{numbers.get(tr.id) ?? "–"}</span> : null}
                  <span className="df-sbstep__name">{tr?.file?.name ?? ""}</span>
                </div>
              );
            })
          ) : (
            <span style={{ fontSize: 12 }}>{t("Click a track, or type its number and Enter, to put it in standby.")}</span>
          )}
        </div>
        <div className="df-sbnav">
          <button type="button" className="ts-btn ts-btn--sm" onClick={() => api.engineStandbyStep(-1).catch(() => {})} onKeyDown={(e) => e.key === " " && e.preventDefault()} title="↑">
            <Icon name="arrowUp" size={12} />
            {t("Previous track")}
          </button>
          <button type="button" className="ts-btn ts-btn--sm" onClick={() => api.engineStandbyStep(1).catch(() => {})} onKeyDown={(e) => e.key === " " && e.preventDefault()} title="↓">
            <Icon name="arrowDown" size={12} />
            {t("Next track")}
          </button>
        </div>
      </div>
    </section>
  );
}

function MainVolume() {
  const t = useT();
  const db = useSettings((s) => s.settings.mainDb);
  const set = (v: number) => useSettings.getState().update({ mainDb: Math.max(-60, Math.min(10, v)) });
  return (
    <div className="df-mainvol" title={t("Main volume of the show (double-click: 0 dB)")} onDoubleClick={() => set(0)}>
      <Icon name="volume" size={12} />
      <Range label={t("Main volume")} value={Math.round(toPos(db))} min={0} max={100} width={74} onChange={(p) => set(toDb(p))} />
      <NumberField className="df-mainvol__val" value={db} text={dbText(db)} label={t("Main volume")} min={-60} max={10} onCommit={set} />
    </div>
  );
}
