import { memo, useMemo } from "react";
import { formatDb, formatTime, useT } from "@theatre-suite/core";
import { Button, Icon, Kbd, Label, VFader } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { pickAudioFiles, locateMissing } from "../lib/files";
import { effectiveOut, useDoc, type InfoState } from "../state/doc";
import { useSettings } from "../state/settings";
import { useUi } from "../state/ui";
import type { EnvPoint, Track, Voice } from "../state/types";
import { AT_END, ON_SPACE } from "./labels";
import { WaveEditor, wavePath, type EditPhase } from "./WaveEditor";

let lastEdit = 0;
/** Continuous edits (drags, faders) make a single undo step. */
function edit(id: string, patch: Partial<Track>, phase: EditPhase) {
  const doc = useDoc.getState();
  const now = Date.now();
  if (phase === "start" || now - lastEdit > 800) doc.history.record(doc.tracks);
  lastEdit = now;
  doc.patchTrack(id, patch, { record: false });
}

export { edit as editTrack };

export interface RowProps {
  track: Track;
  number: number | null;
  standby: boolean;
  voice: Voice | null;
  info: InfoState | undefined;
  missing: boolean;
  locked: boolean;
  expanded: boolean;
}

export const TrackRow = memo(function TrackRow(p: RowProps) {
  const t = useT();
  const { track, number, standby, voice, info, missing, locked, expanded } = p;
  const doc = useDoc.getState();
  const infoObj = info && typeof info === "object" ? info : null;
  const dur = infoObj?.durationSec ?? track.file?.durationSec ?? null;
  const out = effectiveOut(track, dur);
  const playing = !!voice && !voice.paused;
  const paused = !!voice && voice.paused;

  if (track.hidden) {
    return (
      <article className="df-hidden-row" data-track-id={track.id} aria-label={t("Hidden track")}>
        <div className="df-hidden-row__body">
          <span className="mono" style={{ width: 36, flex: "none", textAlign: "center", fontSize: 15, color: "var(--text-3)" }}>
            –
          </span>
          <span className="ts-ellipsis" style={{ fontSize: 13.5, color: "var(--text-2)" }}>
            {track.file?.name ?? t("Empty slot")}
          </span>
          <span className="ts-pill">
            <Icon name="eyeOff" size={11} />
            {t("HIDDEN · no number")}
          </span>
          {dur ? (
            <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              {formatTime(out ? out - track.inSec : dur)}
            </span>
          ) : null}
        </div>
        {!locked ? (
          <Button variant="sm" icon="eye" onClick={() => doc.toggleHidden(track.id)}>
            {t("Show")}
          </Button>
        ) : null}
      </article>
    );
  }

  const rowClass = ["df-row", playing ? "df-row--go" : paused ? "df-row--go df-row--paused" : standby ? "df-row--sb" : ""].join(" ");
  const badgeClass = ["df-badge", voice ? "df-badge--go" : standby ? "df-badge--sb" : !track.file ? "df-badge--empty" : ""].join(" ");
  const setStandby = () => api.engineSetStandby(track.id).catch(() => {});

  const head = (
    <div className="df-row__head">
      {track.file ? (
        <button
          type="button"
          className={missing ? "df-name df-name--missing" : "df-name"}
          title={standby ? t("In standby: press Space to play") : t("Click, or type {n} and Enter, to put in standby", { n: number ?? "" })}
          onClick={setStandby}
        >
          {track.file.name}
        </button>
      ) : (
        <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-3)" }}>{t("Empty slot")}</span>
      )}
      {playing ? (
        <span className="ts-pill ts-pill--go">
          <Icon name="playF" size={9} />
          {voice?.fading === "in" ? t("FADING IN") : voice?.fading === "out" ? t("FADING OUT") : t("PLAYING")}
        </span>
      ) : paused ? (
        <span className="ts-pill ts-pill--paused">
          <Icon name="pauseF" size={9} />
          {t("PAUSED")}
        </span>
      ) : null}
      {standby && !voice ? (
        <>
          <span className="ts-pill ts-pill--sb">{t("STANDBY")}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-2)", whiteSpace: "nowrap" }}>
            {t("next on")} <Kbd>Space</Kbd>
          </span>
        </>
      ) : null}
      {info === "error" && !missing ? (
        <span className="ts-pill" style={{ borderColor: "var(--stop)", color: "var(--stop)" }}>
          <Icon name="alert" size={11} />
          {t("CANNOT READ FILE")}
        </span>
      ) : null}
      {missing ? (
        <>
          <span className="ts-pill" style={{ borderColor: "var(--stop)", color: "var(--stop)" }}>
            <Icon name="alert" size={11} />
            {t("FILE NOT FOUND")}
          </span>
          {!locked ? (
            <Button variant="sm" icon="search" onClick={() => locateMissing(t)}>
              {t("Find files…")}
            </Button>
          ) : null}
        </>
      ) : null}
      <span className="ts-spacer" />
      {!locked ? (
        <div style={{ display: "flex", gap: 4 }}>
          <Button
            variant="sm"
            icon="fileAdd"
            onClick={async () => {
              const [f] = await pickAudioFiles(t, false);
              if (f) doc.loadIntoTrack(track.id, f);
            }}
          >
            {t("Load")}
          </Button>
          {track.file ? (
            <Button variant="sm" icon="eraser" onClick={() => doc.clearTrack(track.id)} disabled={!!voice}>
              {t("Clear")}
            </Button>
          ) : null}
          <Button variant="sm" icon="trash" iconColor="var(--stop)" onClick={() => doc.deleteTrack(track.id)} disabled={!!voice}>
            {t("Delete")}
          </Button>
          <Button variant="sm" icon="eyeOff" onClick={() => doc.toggleHidden(track.id)} disabled={!!voice}>
            {t("Hide")}
          </Button>
        </div>
      ) : null}
    </div>
  );

  const numCol = (
    <div className="df-row__num">
      <div className={badgeClass}>{number}</div>
      {!locked && track.file ? (
        <button
          type="button"
          className="df-chev"
          aria-expanded={expanded}
          aria-label={expanded ? t("Hide settings of track {n}", { n: number ?? "" }) : t("Show settings of track {n}", { n: number ?? "" })}
          title={expanded ? t("Hide settings") : t("Track settings")}
          onClick={() => doc.toggleExpanded(track.id)}
        >
          <Icon name={expanded ? "chevUp" : "chevDown"} size={15} />
        </button>
      ) : null}
    </div>
  );

  if (!track.file) {
    return (
      <article className="df-row" data-track-id={track.id} aria-label={t("Empty slot {n}", { n: number ?? "" })}>
        {numCol}
        {head}
        {!locked ? (
          <div className="df-drop">
            <Icon name="fileAdd" size={16} />
            {t("Drop an audio file here, or")}
            <Button
              icon="folderOpen"
              onClick={async () => {
                const files = await pickAudioFiles(t, true);
                if (files.length) doc.addFiles(files, track.id);
              }}
            >
              {t("Load file")}
            </Button>
          </div>
        ) : (
          <div className="df-drop">{t("Empty")}</div>
        )}
      </article>
    );
  }

  return (
    <article className={rowClass} data-track-id={track.id} aria-label={t("Track {n}", { n: number ?? "" })}>
      {numCol}
      {head}
      <div className="df-col">
        <Label className={standby ? "df-label-sb" : undefined}>{t("On Space · GO")}</Label>
        <div role="radiogroup" aria-label={t("On Space")} className="df-grid2">
          {ON_SPACE.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={track.onSpace === o.value}
              className={`ts-opt ${standby ? "ts-opt--sb" : "ts-opt--strong"}`}
              title={o.title ? t(o.title) : undefined}
              onClick={() => doc.patchTrack(track.id, { onSpace: o.value })}
            >
              <Icon name={o.icon} size={12} />
              <span>{t(o.label)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="df-col df-col--manual">
        <Label>{t("Manual")}</Label>
        <button type="button" className="ts-opt" aria-disabled={!voice} disabled={!voice} onClick={() => api.enginePause(track.id).catch(() => {})}>
          <Icon name={paused ? "playF" : "pauseF"} size={12} />
          <span>{paused ? t("Resume") : t("Pause")}</span>
        </button>
        <button
          type="button"
          className="ts-opt"
          aria-pressed={track.ignoreVolume}
          disabled={locked}
          title={t("Plays at full volume, ignoring the track volume and the volume curve")}
          onClick={() => doc.patchTrack(track.id, { ignoreVolume: !track.ignoreVolume })}
        >
          <Icon name="ignoreVol" size={12} />
          <span>{t("Ignore volume")}</span>
        </button>
      </div>
      <MiniWave track={track} dur={dur} out={out} peaks={infoObj?.peaks ?? null} voice={voice} />
      <div className="df-col">
        <Label>{t("At end")}</Label>
        <div role="radiogroup" aria-label={t("At end")} className="df-grid3">
          {AT_END.map((o) => {
            const disabled = o.value === "loopCut" && !track.loop;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={track.atEnd === o.value}
                aria-disabled={disabled}
                className={disabled ? "ts-opt ts-opt--dashed" : "ts-opt"}
                title={disabled ? t("Set loop points first") : undefined}
                onClick={() => !disabled && doc.patchTrack(track.id, { atEnd: o.value })}
              >
                <Icon name={o.icon} size={12} />
                <span>{t(o.label)}</span>
              </button>
            );
          })}
        </div>
      </div>
      {expanded && !locked ? <TrackPanel track={track} dur={dur} peaks={infoObj?.peaks ?? null} voice={voice} failed={info === "error"} /> : null}
    </article>
  );
});

function MiniWave({ track, dur, out, peaks, voice }: { track: Track; dur: number | null; out: number | null; peaks: number[] | null; voice: Voice | null }) {
  const bars = 180;
  const pos = voice?.positionSec ?? null;
  const split = dur && pos !== null ? Math.round((pos / dur) * bars) : 0;
  const played = useMemo(() => (peaks && split ? wavePath(peaks, bars, 0, split) : ""), [peaks, split]);
  const rest = useMemo(() => (peaks ? wavePath(peaks, bars, split, bars) : ""), [peaks, split]);
  const pct = (s: number) => (dur ? `${Math.min(100, Math.max(0, (s / dur) * 100))}%` : "0%");
  return (
    <div className="df-col" style={{ paddingTop: 16 }}>
      <div className="df-mini-wave" onClick={() => useDoc.getState().toggleExpanded(track.id)} title={dur ? undefined : undefined}>
        <svg viewBox={`0 0 ${bars} 100`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
          {played ? <path d={played} stroke="var(--go)" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
          <path d={rest} stroke={voice ? "var(--wave)" : "var(--wave-hi)"} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        {dur && track.inSec > 0 ? <div className="df-wave__dim" style={{ left: 0, width: pct(track.inSec) }} /> : null}
        {dur && out !== null && out < dur ? <div className="df-wave__dim" style={{ left: pct(out), right: 0 }} /> : null}
        {track.loop && track.loopVisible ? (
          <>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(track.loop.inSec), borderLeft: "1.5px dashed var(--accent)" }} />
            <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(track.loop.outSec), borderLeft: "1.5px dashed var(--accent)" }} />
          </>
        ) : null}
        {pos !== null && dur ? (
          <>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: pct(pos), background: "var(--go-soft)" }} />
            <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(pos), width: 2, marginLeft: -1, background: "var(--text)" }} />
          </>
        ) : null}
      </div>
      <div className="df-times">
        <span style={{ left: 0 }}>{formatTime(track.inSec)}</span>
        {pos !== null && dur ? (
          <span style={{ left: pct(pos), transform: "translateX(-50%)", color: "var(--go)", fontWeight: 600 }}>{formatTime(pos)}</span>
        ) : null}
        <span style={{ right: 0 }}>{formatTime(out)}</span>
      </div>
    </div>
  );
}

function TrackPanel({ track, dur, peaks, voice, failed }: { track: Track; dur: number | null; peaks: number[] | null; voice: Voice | null; failed: boolean }) {
  const t = useT();
  const s = useSettings((x) => x.settings);
  const eqBands: Array<{ key: "low" | "mid" | "high"; label: string }> = [
    { key: "low", label: t("Low") },
    { key: "mid", label: t("Mid") },
    { key: "high", label: t("High") },
  ];
  const fmt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
  const out = effectiveOut(track, dur);
  const addFade = (kind: "in" | "out") => {
    if (!dur || out === null) return;
    const len = kind === "in" ? s.fadeInSec : s.fadeOutSec;
    let pts: EnvPoint[] = [...track.envelope];
    if (kind === "in") {
      const end = Math.min(out, track.inSec + len);
      pts = pts.filter((p) => p.t > end + 0.01 || p.t < track.inSec - 0.01);
      pts.push({ t: track.inSec, v: 0 }, { t: end, v: 1 });
    } else {
      const start = Math.max(track.inSec, out - len);
      pts = pts.filter((p) => p.t < start - 0.01 || p.t > out + 0.01);
      pts.push({ t: start, v: 1 }, { t: out, v: 0 });
    }
    pts.sort((a, b) => a.t - b.t);
    useDoc.getState().patchTrack(track.id, { envelope: pts });
  };
  return (
    <div className="df-panel">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Label>{t("Equalizer")}</Label>
          <Button variant="sm" iconOnly icon="reset" aria-label={t("Reset equalizer")} title={t("Reset equalizer")} onClick={() => useDoc.getState().patchTrack(track.id, { eq: { low: 0, mid: 0, high: 0 } })} />
        </div>
        <div className="df-grid3" style={{ gap: 6 }}>
          {eqBands.map((b) => (
            <div key={b.key} className="df-fader-col">
              <span className="df-fader-col__val">{fmt(track.eq[b.key])}</span>
              <VFader
                label={`${t("Equalizer")} ${b.label}`}
                value={track.eq[b.key]}
                min={-12}
                max={12}
                zero={0}
                step={0.5}
                onChange={(v) => edit(track.id, { eq: { ...useDoc.getState().tracks.find((x) => x.id === track.id)!.eq, [b.key]: v } }, "move")}
                onReset={() => useDoc.getState().patchTrack(track.id, { eq: { ...track.eq, [b.key]: 0 } })}
              />
              <span className="df-fader-col__name">{b.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="df-fader-col">
        <Label>{t("Volume")}</Label>
        <span className="df-fader-col__val">{formatDb(track.volumeDb)}</span>
        <VFader
          label={t("Track volume")}
          value={track.volumeDb}
          min={-40}
          max={10}
          zero={0}
          step={0.5}
          onChange={(v) => edit(track.id, { volumeDb: v }, "move")}
          onReset={() => useDoc.getState().patchTrack(track.id, { volumeDb: 0 })}
        />
        <span className="df-fader-col__name">{t("Track")}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: 24 }}>
          <Label>{t("Volume & cut")}</Label>
          <span className="ts-ellipsis" style={{ fontSize: 11, color: "var(--text-3)" }}>
            {t("Drag IN and OUT · click the line to add a point")}
          </span>
          <span className="ts-spacer" />
          <Button variant="sm" icon="zoom" onClick={() => useUi.getState().openEditor(track.id)}>
            {t("Zoom")}
          </Button>
        </div>
        <WaveEditor track={track} duration={dur} peaks={peaks} playheadSec={voice?.positionSec ?? null} onChange={(patch, phase) => edit(track.id, patch, phase)} t={t} failed={failed} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 30 }}>
        <Button variant="sm" icon="edges" className="df-wide" onClick={() => useDoc.getState().patchTrack(track.id, { inSec: 0, outSec: null })}>
          {t("IN / OUT to the edges")}
        </Button>
        <Button variant="sm" icon="fadeIn" className="df-wide" disabled={!dur} onClick={() => addFade("in")}>
          {t("Add default fade in")}
        </Button>
        <Button variant="sm" icon="fadeOut" className="df-wide" disabled={!dur} onClick={() => addFade("out")}>
          {t("Add default fade out")}
        </Button>
        {track.loop ? (
          <div style={{ display: "flex", gap: 4 }}>
            <Button
              variant="sm"
              icon={track.loopVisible ? "eye" : "eyeOff"}
              on={track.loopVisible}
              className="df-wide"
              style={{ flex: 1, minWidth: 0, width: "auto" }}
              aria-pressed={track.loopVisible}
              onClick={() => useDoc.getState().patchTrack(track.id, { loopVisible: !track.loopVisible })}
            >
              {track.loopVisible ? t("Loop points: shown") : t("Loop points: hidden")}
            </Button>
            <Button
              variant="sm"
              iconOnly
              icon="trash"
              aria-label={t("Remove loop points")}
              title={t("Remove loop points")}
              onClick={() => useDoc.getState().patchTrack(track.id, { loop: null, atEnd: track.atEnd === "loopCut" ? "stop" : track.atEnd })}
            />
          </div>
        ) : (
          <Button
            variant="sm"
            icon="repeat"
            className="df-wide"
            disabled={!dur || out === null}
            onClick={() => {
              if (!dur || out === null) return;
              const len = out - track.inSec;
              useDoc.getState().patchTrack(track.id, {
                loop: { inSec: Math.round((track.inSec + len * 0.4) * 100) / 100, outSec: Math.round((track.inSec + len * 0.8) * 100) / 100 },
                loopVisible: true,
              });
            }}
          >
            {t("Add loop points")}
          </Button>
        )}
      </div>
    </div>
  );
}
