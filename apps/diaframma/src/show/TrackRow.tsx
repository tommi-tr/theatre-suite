import { memo, useEffect, useMemo, useRef, useState } from "react";
import { formatDb, formatTime, useT } from "@theatre-suite/core";
import { Button, Icon, Kbd, Label, NumberField, VFader, type IconName } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { pickAudioFiles, locateMissing } from "../lib/files";
import { effectiveOut, useDoc, type InfoState } from "../state/doc";
import { useSettings } from "../state/settings";
import { useUi } from "../state/ui";
import { EQ_BANDS, FLAT_EQ, type AtEnd, type EnvPoint, type Eq, type OnSpace, type Track, type Voice } from "../state/types";
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

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
const bandLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

export interface RowProps {
  track: Track;
  number: number | null;
  standby: boolean;
  /** The track GO acts on now. */
  main: boolean;
  pausedAll: boolean;
  voice: Voice | null;
  info: InfoState | undefined;
  missing: boolean;
  locked: boolean;
  expanded: boolean;
  compact: boolean;
}

export const TrackRow = memo(function TrackRow(p: RowProps) {
  const t = useT();
  const { track, number, standby, main, pausedAll, voice, info, missing, locked, expanded, compact } = p;
  const doc = useDoc.getState();
  const infoObj = info && typeof info === "object" ? info : null;
  const dur = infoObj?.durationSec ?? track.file?.durationSec ?? null;
  const out = effectiveOut(track, dur);
  const playing = !!voice && !voice.paused;
  const paused = !!voice && voice.paused;

  if (track.hidden) {
    return (
      <article className={compact ? "df-hidden-row df-hidden-row--compact" : "df-hidden-row"} data-track-id={track.id} aria-label={t("Hidden track")}>
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

  const rowClass = [
    "df-row",
    compact ? "df-row--compact" : "",
    playing ? "df-row--go" : paused ? "df-row--go df-row--paused" : standby ? "df-row--sb" : "",
    paused && pausedAll ? "df-blink" : "",
  ].join(" ");
  const badgeClass = ["df-badge", voice ? "df-badge--go" : standby ? "df-badge--sb" : !track.file ? "df-badge--empty" : ""].join(" ");
  const setStandby = () => api.engineSetStandby(track.id).catch(() => {});
  /** Whatever is touched goes in standby (not a track that is playing, not the row buttons). */
  const touch = (e: React.PointerEvent) => {
    if (!track.file || missing || voice) return;
    if ((e.target as HTMLElement).closest("[data-nosb]")) return;
    if (!standby) setStandby();
  };

  const statusPill = playing ? (
    <span className="ts-pill ts-pill--go">
      <Icon name={voice?.inLoop ? "repeat" : "playF"} size={9} />
      {voice?.fading === "in" ? t("FADING IN") : voice?.fading === "out" ? t("FADING OUT") : voice?.inLoop ? t("LOOPING") : t("PLAYING")}
    </span>
  ) : paused ? (
    <span className="ts-pill ts-pill--paused">
      <Icon name="pauseF" size={9} />
      {t("PAUSED")}
    </span>
  ) : null;

  const nameBtn = track.file ? (
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
  );

  if (compact && track.file) {
    return (
      <article className={rowClass} data-track-id={track.id} aria-label={t("Track {n}", { n: number ?? "" })} onPointerDownCapture={touch}>
        <div className={badgeClass}>{number}</div>
        <div className="df-row__cname">
          {nameBtn}
          {statusPill}
          {standby && !voice ? <span className="ts-pill ts-pill--sb">{t("STANDBY")}</span> : null}
          {missing ? (
            <span className="ts-pill" style={{ borderColor: "var(--stop)", color: "var(--stop)" }}>
              <Icon name="alert" size={11} />
              {t("FILE NOT FOUND")}
            </span>
          ) : null}
        </div>
        <ChoiceChip
          label={t("At end or Space")}
          value={track.atEnd}
          options={AT_END.map((o) => ({ ...o, disabled: o.value === "loopCut" && !track.loop }))}
          onChange={(v: AtEnd) => doc.patchTrack(track.id, { atEnd: v })}
          tone={main ? "go" : null}
        />
        <ChoiceChip label={t("Start")} value={track.onSpace} options={ON_SPACE} onChange={(v: OnSpace) => doc.patchTrack(track.id, { onSpace: v })} tone={standby ? "sb" : null} />
        <MiniWave track={track} dur={dur} out={out} peaks={infoObj?.peaks ?? null} voice={voice} compact />
        <span className="mono df-row__ctime">{voice && out !== null ? `−${formatTime(Math.max(0, out - voice.positionSec))}` : out !== null ? formatTime(out - track.inSec) : "--:--"}</span>
      </article>
    );
  }

  const head = (
    <div className="df-row__head">
      {nameBtn}
      {statusPill}
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
        <div style={{ display: "flex", gap: 4 }} data-nosb>
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
            <>
              <Button variant="sm" icon="eraser" onClick={() => doc.clearTrack(track.id)} disabled={!!voice}>
                {t("Clear")}
              </Button>
              <Button variant="sm" icon="duplicate" onClick={() => doc.duplicateTrack(track.id)} title={t("A copy right below, with its own settings (same audio file)")}>
                {t("Duplicate")}
              </Button>
            </>
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
      <article className={compact ? "df-row df-row--compact df-row--emptyc" : "df-row"} data-track-id={track.id} aria-label={t("Empty slot {n}", { n: number ?? "" })}>
        {compact ? <div className={badgeClass}>{number}</div> : numCol}
        {compact ? <div className="df-row__cname">{nameBtn}</div> : head}
        {!locked ? (
          <div className={compact ? "df-drop df-drop--compact" : "df-drop"}>
            <Icon name="fileAdd" size={16} />
            {t("Drop an audio file here, or")}
            <Button
              variant={compact ? "sm" : undefined}
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
    <article className={rowClass} data-track-id={track.id} aria-label={t("Track {n}", { n: number ?? "" })} onPointerDownCapture={touch}>
      {numCol}
      {head}
      <div className="df-col">
        <Label className={main ? "df-label-go" : undefined}>{t("At end or Space")}</Label>
        <div role="radiogroup" aria-label={t("At end or Space")} className="df-grid3">
          {AT_END.map((o) => {
            const disabled = o.value === "loopCut" && !track.loop;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={track.atEnd === o.value}
                aria-disabled={disabled}
                className={[disabled ? "ts-opt ts-opt--dashed" : "ts-opt", main ? "ts-opt--go" : "ts-opt--strong"].join(" ")}
                title={disabled ? t("Set loop points first") : t(o.title)}
                onClick={() => !disabled && doc.patchTrack(track.id, { atEnd: o.value })}
              >
                <Icon name={o.icon} size={12} />
                <span>{t(o.label)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="df-col df-col--manual">
        <Label>{t("Manual")}</Label>
        <button type="button" className="ts-opt" data-nosb aria-disabled={!voice} disabled={!voice} onClick={() => api.enginePause(track.id).catch(() => {})}>
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
        <Label className={standby ? "df-label-sb" : undefined}>{t("Start")}</Label>
        <div role="radiogroup" aria-label={t("Start")} className="df-grid1">
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
      {expanded && !locked ? <TrackPanel track={track} dur={dur} peaks={infoObj?.peaks ?? null} voice={voice} failed={info === "error"} /> : null}
    </article>
  );
});

/** A chosen option shown as a chip (compact rows); a click opens the choices. */
function ChoiceChip<V extends string>({
  label,
  value,
  options,
  onChange,
  tone,
}: {
  label: string;
  value: V;
  options: { value: V; label: string; icon: IconName; disabled?: boolean }[];
  onChange: (v: V) => void;
  tone: "go" | "sb" | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  const cur = options.find((o) => o.value === value) ?? options[0];
  return (
    <div ref={ref} style={{ position: "relative", minWidth: 0 }}>
      <button
        type="button"
        className={["df-chip", tone === "go" ? "df-chip--go" : tone === "sb" ? "df-chip--sb" : ""].join(" ")}
        title={`${label}: ${t(cur.label)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => e.key === " " && e.preventDefault()}
      >
        <Icon name={cur.icon} size={11} />
        <span className="ts-ellipsis">{t(cur.label)}</span>
      </button>
      {open ? (
        <div className="df-menu" role="menu" style={{ left: 0, right: "auto", minWidth: 190 }}>
          <div style={{ padding: "4px 10px 6px", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-3)", textTransform: "uppercase" }}>{label}</div>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className="df-menu__item"
              disabled={o.disabled}
              style={o.disabled ? { opacity: 0.4 } : o.value === value ? { fontWeight: 600 } : undefined}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <Icon name={o.icon} size={13} />
              <span style={{ flex: 1 }}>{t(o.label)}</span>
              {o.value === value ? <Icon name="check" size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The part of the waveform that will play (IN → OUT). While paused, a click moves the play position. */
function MiniWave({ track, dur, out, peaks, voice, compact }: { track: Track; dur: number | null; out: number | null; peaks: number[] | null; voice: Voice | null; compact?: boolean }) {
  const t = useT();
  const bars = compact ? 120 : 180;
  const a = track.inSec;
  const b = out ?? dur ?? 0;
  const span = b > a ? b - a : 0;
  const pos = voice?.positionSec ?? null;
  const frac = (s: number) => (span ? Math.min(1, Math.max(0, (s - a) / span)) : 0);
  const pct = (s: number) => `${frac(s) * 100}%`;
  const slice = useMemo(() => {
    if (!peaks || !dur || !span) return null;
    const i0 = Math.max(0, Math.floor((a / dur) * peaks.length));
    const i1 = Math.min(peaks.length, Math.max(i0 + 1, Math.ceil((b / dur) * peaks.length)));
    return peaks.slice(i0, i1);
  }, [peaks, dur, a, b, span]);
  const split = pos !== null ? Math.round(frac(pos) * bars) : 0;
  const played = useMemo(() => (slice && split ? wavePath(slice, bars, 0, split) : ""), [slice, split, bars]);
  const rest = useMemo(() => (slice ? wavePath(slice, bars, split, bars) : ""), [slice, split, bars]);
  const canSeek = !!voice && voice.paused && span > 0;
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (canSeek) {
      const r = e.currentTarget.getBoundingClientRect();
      const sec = a + ((e.clientX - r.left) / r.width) * span;
      api.engineSeek(track.id, sec).catch(() => {});
      return;
    }
    if (!compact) useDoc.getState().toggleExpanded(track.id);
  };
  const loopIn = track.loop && track.loopVisible && track.loop.inSec >= a && track.loop.inSec <= b ? track.loop.inSec : null;
  const loopOut = track.loop && track.loopVisible && track.loop.outSec >= a && track.loop.outSec <= b ? track.loop.outSec : null;
  const waveEl = (
    <div
      className={["df-mini-wave", compact ? "df-mini-wave--compact" : "", canSeek ? "df-mini-wave--seek" : ""].join(" ")}
      onClick={onClick}
      title={canSeek ? t("Paused: click to move the play position, then GO or P to go on from there") : compact ? undefined : t("Click to open the settings")}
    >
      <svg viewBox={`0 0 ${bars} 100`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
        {played ? <path d={played} stroke="var(--go)" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
        <path d={rest} stroke={voice ? "var(--wave)" : "var(--wave-hi)"} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      {loopIn !== null ? <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(loopIn), borderLeft: "1.5px dashed var(--accent)" }} /> : null}
      {loopOut !== null ? <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(loopOut), borderLeft: "1.5px dashed var(--accent)" }} /> : null}
      {pos !== null && span ? (
        <>
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: pct(pos), background: "var(--go-soft)" }} />
          <div className={voice?.paused ? "df-cursor df-cursor--paused" : "df-cursor"} style={{ left: pct(pos) }} />
        </>
      ) : null}
    </div>
  );
  if (compact) return waveEl;
  return (
    <div className="df-col" style={{ paddingTop: 16 }}>
      {waveEl}
      <div className="df-times">
        <span style={{ left: 0 }}>{formatTime(a)}</span>
        {pos !== null && span ? (
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
  const out = effectiveOut(track, dur);
  const cur = () => useDoc.getState().tracks.find((x) => x.id === track.id) ?? track;
  const setBand = (i: number, v: number, phase: EditPhase) => {
    const eq = [...cur().eq] as Eq;
    eq[i] = Math.max(-12, Math.min(12, Math.round(v * 2) / 2));
    edit(track.id, { eq }, phase);
  };
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
          <Button variant="sm" iconOnly icon="reset" aria-label={t("Reset equalizer")} title={t("Reset equalizer")} onClick={() => useDoc.getState().patchTrack(track.id, { eq: [...FLAT_EQ] })} />
        </div>
        <div className="df-eq5">
          {EQ_BANDS.map((f, i) => (
            <div key={f} className="df-fader-col">
              <NumberField
                className="df-fader-col__val"
                value={track.eq[i]}
                text={signed(track.eq[i])}
                label={`${t("Equalizer")} ${bandLabel(f)} Hz`}
                min={-12}
                max={12}
                onCommit={(v) => setBand(i, v, "start")}
              />
              <VFader
                label={`${t("Equalizer")} ${bandLabel(f)} Hz`}
                value={track.eq[i]}
                min={-12}
                max={12}
                zero={0}
                step={0.5}
                onChange={(v) => setBand(i, v, "move")}
                onReset={() => setBand(i, 0, "start")}
              />
              <span className="df-fader-col__name">{bandLabel(f)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="df-fader-col">
        <Label>{t("Volume")}</Label>
        <NumberField
          className="df-fader-col__val"
          value={track.volumeDb}
          text={formatDb(track.volumeDb)}
          label={t("Track volume")}
          min={-40}
          max={10}
          onCommit={(v) => edit(track.id, { volumeDb: Math.round(v * 2) / 2 }, "start")}
        />
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
            {voice?.paused
              ? t("Paused: click the waveform to move the play position")
              : t("Drag IN and OUT · click the line to add a point · double-click a point to remove it")}
          </span>
        </div>
        <WaveEditor
          track={track}
          duration={dur}
          peaks={peaks}
          height={150}
          playheadSec={voice?.positionSec ?? null}
          onChange={(patch, phase) => edit(track.id, patch, phase)}
          onSeek={voice?.paused ? (sec) => api.engineSeek(track.id, sec).catch(() => {}) : undefined}
          t={t}
          failed={failed}
        />
      </div>
      <div className="df-panel__buttons">
        <Button variant="sm" icon="zoom" className="df-wide" onClick={() => useUi.getState().openEditor(track.id)}>
          {t("Zoom")}
        </Button>
        <Button variant="sm" icon="edges" className="df-wide" disabled={track.inSec === 0 && track.outSec === null} onClick={() => useDoc.getState().patchTrack(track.id, { inSec: 0, outSec: null })}>
          {t("Reset IN & OUT")}
        </Button>
        <Button variant="sm" icon="reset" className="df-wide" disabled={!track.envelope.length} onClick={() => useDoc.getState().patchTrack(track.id, { envelope: [] })}>
          {t("Remove volume curve")}
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
