import { formatTime, useT } from "@theatre-suite/core";
import { Icon } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { useUi } from "../state/ui";
import { effectiveOut, trackDuration, useDoc } from "../state/doc";
import { useSettings } from "../state/settings";
import { AT_END, ON_SPACE, atEndText, goActionText, nextGoEffect } from "./labels";

export function GoBar({ numbers, typed }: { numbers: Map<string, number>; typed: string }) {
  const t = useT();
  const tracks = useDoc((s) => s.tracks);
  const live = useDoc((s) => s.live);
  const infos = useDoc((s) => s.infos);
  const settings = useSettings((s) => s.settings);
  const sb = tracks.find((x) => x.id === live.standbyId && !x.hidden && x.file) ?? null;
  const onSpaceIcon = sb ? ON_SPACE.find((o) => o.value === sb.onSpace)!.icon : "playF";
  const active = live.voices.filter((v) => !v.paused && v.fading !== "out");
  const current = active[active.length - 1] ?? live.voices.filter((v) => !v.paused)[0] ?? live.voices[live.voices.length - 1] ?? null;
  const curTrack = current ? tracks.find((x) => x.id === current.trackId) ?? null : null;
  const curDur = curTrack ? trackDuration(curTrack, infos) ?? current?.durationSec ?? null : null;
  const curOut = curTrack ? effectiveOut(curTrack, curDur) : null;
  const left = current && curOut !== null ? Math.max(0, curOut - current.positionSec) : null;
  const others = live.voices.length - (current ? 1 : 0);

  return (
    <section className="df-gobar" aria-label={t("Transport")}>
      <button
        type="button"
        className="df-go"
        disabled={!sb || !live.engine.ready}
        aria-label={sb ? t("GO: {action} track {n}", { action: goActionText(t, sb.onSpace, settings), n: numbers.get(sb.id) ?? "" }) : t("GO")}
        onClick={() => api.engineGo().catch((e) => useUi.getState().showToast(String(e), "error"))}
        onKeyDown={(e) => e.key === " " && e.preventDefault()}
      >
        <span className="df-go__main">
          <Icon name="playF" size={20} />
          <span className="df-go__label">GO</span>
          <span className="df-go__kbd">Space</span>
        </span>
        <span className="df-go__sub">
          <Icon name={onSpaceIcon} size={11} strokeWidth={2.4} />
          {sb ? goActionText(t, sb.onSpace, settings) : t("Nothing in standby")}
        </span>
      </button>

      {sb || typed ? (
        <div className="df-gobox df-gobox--sb">
          <div className="df-bigbadge" style={{ background: "var(--sb-fill)", color: "var(--sb-ink)" }}>
            {typed ? typed : sb ? numbers.get(sb.id) : ""}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="df-gobox__kicker" style={{ color: "var(--sb)" }}>
              {typed ? t("TYPE THE NUMBER, THEN ENTER") : t("STANDBY")}
            </div>
            <div className="df-gobox__title">{sb?.file?.name ?? ""}</div>
          </div>
          {sb ? (
            <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
              <span className="df-gobox__meta">
                <Icon name={onSpaceIcon} size={12} />
                {t("On Space")} <b style={{ color: "var(--text)", fontWeight: 600 }}>{goActionText(t, sb.onSpace, settings)}</b>
              </span>
              <span className="df-gobox__meta">
                <Icon name={AT_END.find((a) => a.value === sb.atEnd)!.icon} size={12} />
                {t("At end")} <b style={{ color: "var(--text)", fontWeight: 600 }}>{atEndText(t, sb.atEnd)}</b>
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="df-gobox df-gobox--empty" style={{ flex: "1.25 1 0" }}>
          <Icon name="info" size={16} />
          <span>{t("Click a track name, or type its number and Enter, to put it in standby.")}</span>
        </div>
      )}

      {current && curTrack ? (
        <div className="df-gobox df-gobox--go">
          <div className="df-bigbadge" style={{ background: "var(--go-fill)", color: "var(--go-ink)" }}>
            {numbers.get(curTrack.id) ?? "–"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="df-gobox__kicker" style={{ color: "var(--go)" }}>
              <span className="ts-dot ts-dot--go" style={{ width: 7, height: 7 }} />
              {current.paused ? t("PAUSED") : current.fading === "in" ? t("FADING IN") : current.fading === "out" ? t("FADING OUT") : t("PLAYING")}
              {others > 0 ? <span style={{ color: "var(--text-3)", letterSpacing: 0 }}>· {t("+{n} more", { n: others })}</span> : null}
            </div>
            <div className="df-gobox__title">{curTrack.file?.name}</div>
            <div className="df-gobox__meta">
              <Icon name="chevRight" size={12} />
              {nextGoEffect(t, sb?.onSpace ?? null, settings.othersOnGo)}
            </div>
          </div>
          <div className="mono" style={{ flex: "none", textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{formatTime(current.positionSec)}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>{left !== null ? `${formatTime(-left)} ${t("left")}` : ""}</div>
          </div>
        </div>
      ) : (
        <div className="df-gobox df-gobox--empty">
          <span className="ts-dot" />
          <span>{t("Nothing is playing")}</span>
        </div>
      )}

      <button type="button" className="df-stopall" onClick={() => api.engineStopAll(false).catch(() => {})} onDoubleClick={() => api.engineStopAll(true).catch(() => {})} onKeyDown={(e) => e.key === " " && e.preventDefault()}>
        <span className="df-stopall__label">
          <Icon name="stopAll" size={15} />
          {t("Stop all")}
        </span>
        <span className="df-kbd-stop">Esc</span>
      </button>
    </section>
  );
}
