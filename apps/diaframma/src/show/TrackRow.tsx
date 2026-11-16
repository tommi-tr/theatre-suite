import { memo, useEffect, useMemo, useRef, useState } from "react";
import { formatDb, formatTime, useT } from "@theatre-suite/core";
import { Button, Icon, Kbd, Label, NumberField, VFader, type IconName } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { confirmClearTrack, confirmDeleteTrack, pickAudioFiles, locateMissing } from "../lib/files";
import { effectiveIn, effectiveOut, useDoc, type InfoState } from "../state/doc";
import { useSettings } from "../state/settings";
import { useUi } from "../state/ui";
import { EQ_BANDS, FLAT_EQ, type Entry, type Eq, type Exit, type Track, type Voice } from "../state/types";
import { ENTRIES, EXITS, entrySeconds, exitSeconds, secs } from "./labels";
import { WaveEditor, wavePath, type EditPhase } from "./WaveEditor";
import { seekAllowed } from "./seek";

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
const bandLabel = (f: number) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`);
const panText = (p: number) => (p === 0 ? "C" : p > 0 ? `R ${Math.round(p * 100)}` : `L ${Math.round(-p * 100)}`);

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
  const settings = useSettings((x) => x.settings);
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
              {formatTime(out ? out - effectiveIn(track) : dur)}
            </span>
          ) : null}
        </div>
        {!locked ? (
          <Button variant="sm" icon="eye" onClick={() => doc.toggleHidden(track.id)}>
            {t("Unhide")}
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
          label={t("Entry")}
          value={track.entry ?? "none"}
          options={[
            { value: "none", label: "No entry", icon: "playF" },
            ...ENTRIES.map((o) => ({ value: o.value as string, label: `${t(o.label)} · ${secs(entrySeconds(track, settings))}`, icon: o.icon })),
          ]}
          onChange={(v: string) => doc.patchTrack(track.id, { entry: v === "none" ? null : (v as Entry) })}
          tone={standby ? "sb" : null}
        />
        <MiniWave track={track} dur={dur} out={out} peaks={infoObj?.peaks ?? null} voice={voice} locked={locked} compact />
        <ChoiceChip
          label={t("Exit")}
          value={track.exit ?? "none"}
          options={[
            { value: "none", label: "No exit", icon: "stopF" },
            ...EXITS.map((o) => ({ value: o.value as string, label: o.value === "next" ? t(o.label) : `${t(o.label)} · ${secs(exitSeconds({ ...track, exit: o.value }, settings))}`, icon: o.icon })),
          ]}
          onChange={(v: string) => doc.patchTrack(track.id, { exit: v === "none" ? null : (v as Exit) })}
          tone={main ? "go" : null}
        />
        <span className="mono df-row__ctime">{voice && out !== null ? `−${formatTime(Math.max(0, out - voice.positionSec))}` : out !== null ? formatTime(out - effectiveIn(track)) : "--:--"}</span>
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
              <Button variant="sm" icon="eraser" onClick={async () => (await confirmClearTrack(t, track, number)) && doc.clearTrack(track.id)} disabled={!!voice}>
                {t("Clear")}
              </Button>
              <Button variant="sm" icon="duplicate" onClick={() => doc.duplicateTrack(track.id)} title={t("A copy right below, with its own settings (same audio file)")}>
                {t("Duplicate")}
              </Button>
            </>
          ) : null}
          <Button variant="sm" icon="trash" iconColor="var(--stop)" onClick={async () => (await confirmDeleteTrack(t, track, number)) && doc.deleteTrack(track.id)} disabled={!!voice}>
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
      <div className="df-col df-col--entry">
        <Label className={standby ? "df-label-sb" : undefined}>{t("Entry")}</Label>
        {ENTRIES.map((o) => (
          <OptionRow
            key={o.value}
            icon={o.icon}
            label={t(o.label)}
            title={t(o.title)}
            on={track.entry === o.value}
            tone={standby ? "sb" : null}
            seconds={entrySeconds(track, settings)}
            locked={locked}
            onToggle={() => doc.patchTrack(track.id, { entry: track.entry === o.value ? null : o.value })}
            onSeconds={(v) => doc.patchTrack(track.id, { entry: o.value, entrySec: v === settings.fadeInSec ? null : v })}
          />
        ))}
      </div>
      <div className="df-col df-col--manual">
        <Label>{t("Manual")}</Label>
        <div className="df-grid2">
          <button type="button" className="ts-opt" data-nosb aria-disabled={!voice} disabled={!voice} title={t("Pause this track (and resume it)")} onClick={() => api.enginePause(track.id).catch(() => {})}>
            <Icon name={paused ? "playF" : "pauseF"} size={12} />
            <span>{paused ? t("Resume") : t("Pause")}</span>
          </button>
          <button type="button" className="ts-opt" data-nosb aria-disabled={!voice} disabled={!voice} title={t("Stop this track at once")} onClick={() => api.engineStopTrack(track.id).catch(() => {})}>
            <Icon name="stopF" size={12} />
            <span>{t("Stop")}</span>
          </button>
          <button
            type="button"
            className="ts-opt"
            data-nosb
            disabled={!voice || locked}
            title={t("Puts a marker at the play position (M). Markers help to line up IN, OUT, loop points and curve points in the editor.")}
            onClick={() => voice && doc.addMarker(track.id, voice.positionSec)}
          >
            <Icon name="flag" size={12} />
            <span>{t("Marker")}</span>
          </button>
        </div>
      </div>
      <MiniWave track={track} dur={dur} out={out} peaks={infoObj?.peaks ?? null} voice={voice} locked={locked} />
      <div className="df-col df-col--exit">
        <Label className={main ? "df-label-go" : undefined}>{t("Exit")}</Label>
        <div className="df-grid2">
          {EXITS.map((o) => (
            <OptionRow
              key={o.value}
              icon={o.icon}
              label={t(o.label)}
              title={t(o.title)}
              on={track.exit === o.value}
              tone={main ? "go" : null}
              seconds={o.value === "next" ? null : exitSeconds({ ...track, exit: o.value }, settings)}
              locked={locked}
              onToggle={() => doc.patchTrack(track.id, { exit: track.exit === o.value ? null : o.value })}
              onSeconds={(v) =>
                doc.patchTrack(track.id, { exit: o.value, exitSec: v === (o.value === "crossfade" ? settings.crossfadeSec : settings.fadeOutSec) ? null : v })
              }
            />
          ))}
          <button
            type="button"
            className={track.loopOn ? "ts-opt ts-opt--strong df-loopbtn df-loopbtn--on" : "ts-opt df-loopbtn"}
            aria-pressed={track.loopOn}
            disabled={locked}
            title={t(track.loop ? "Repeats between the loop points until GO" : "Repeats the whole track until GO")}
            onClick={() => doc.patchTrack(track.id, { loopOn: !track.loopOn })}
          >
            <Icon name="repeat" size={12} />
            <span>{t("Loop")}</span>
          </button>
        </div>
      </div>
      {expanded && !locked ? <TrackPanel track={track} dur={dur} peaks={infoObj?.peaks ?? null} voice={voice} failed={info === "error"} /> : null}
    </article>
  );
});

/** An optional behaviour (Entry / Exit): a toggle and, when it has a length, the length to edit right there. */
function OptionRow({
  icon,
  label,
  title,
  on,
  tone,
  seconds,
  locked,
  onToggle,
  onSeconds,
}: {
  icon: IconName;
  label: string;
  title: string;
  on: boolean;
  tone: "go" | "sb" | null;
  seconds: number | null;
  locked: boolean;
  onToggle: () => void;
  onSeconds: (v: number) => void;
}) {
  const t = useT();
  return (
    <div className="df-optrow">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`ts-opt ${tone === "go" ? "ts-opt--go" : tone === "sb" ? "ts-opt--sb" : "ts-opt--strong"} df-optrow__btn`}
        title={title}
        onClick={onToggle}
        onKeyDown={(e) => e.key === " " && e.preventDefault()}
      >
        <Icon name={icon} size={12} />
        <span>{label}</span>
      </button>
      {seconds !== null ? (
        <NumberField
          className={on ? "df-optrow__sec" : "df-optrow__sec df-optrow__sec--off"}
          value={seconds}
          text={secs(seconds)}
          label={`${label} · ${t("seconds")}`}
          min={0}
          max={60}
          disabled={locked}
          onCommit={(v) => onSeconds(Math.round(v * 10) / 10)}
        />
      ) : null}
    </div>
  );
}

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

/** The part of the waveform that will play (IN → OUT). A click moves the play position (Settings → Show). */
function MiniWave({ track, dur, out, peaks, voice, locked, compact }: { track: Track; dur: number | null; out: number | null; peaks: number[] | null; voice: Voice | null; locked: boolean; compact?: boolean }) {
  const t = useT();
  const bars = compact ? 120 : 180;
  const waveStyle = useSettings((x) => x.settings.waveStyle);
  const seekClick = useSettings((x) => x.settings.seekClick);
  const a = effectiveIn(track);
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
  const played = useMemo(() => (slice && split ? wavePath(slice, bars, 0, split, waveStyle) : ""), [slice, split, bars, waveStyle]);
  const rest = useMemo(() => (slice ? wavePath(slice, bars, split, bars, waveStyle) : ""), [slice, split, bars, waveStyle]);
  const canSeek = span > 0 && seekAllowed(voice, seekClick, locked);
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSeek) return;
    const r = e.currentTarget.getBoundingClientRect();
    const sec = a + ((e.clientX - r.left) / r.width) * span;
    api.engineSeek(track.id, sec).catch(() => {});
  };
  const loopIn = track.loop && track.loopVisible && !track.ignoreLoop && track.loop.inSec >= a && track.loop.inSec <= b ? track.loop.inSec : null;
  const loopOut = track.loop && track.loopVisible && !track.ignoreLoop && track.loop.outSec >= a && track.loop.outSec <= b ? track.loop.outSec : null;
  const marks = track.markers.filter((m) => m >= a && m <= b);
  const waveEl = (
    <div
      className={["df-mini-wave", compact ? "df-mini-wave--compact" : "", canSeek ? "df-mini-wave--seekable" : "", canSeek && voice?.paused ? "df-mini-wave--seek" : ""].join(" ")}
      onClick={onClick}
      title={canSeek ? (voice?.paused ? t("Paused: click to move the play position, then GO or P to go on from there") : t("Click to move the play position")) : undefined}
    >
      <svg viewBox={`0 0 ${bars} 100`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
        {played ? <path d={played} stroke="var(--go)" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
        <path d={rest} stroke={voice ? "var(--wave)" : "var(--wave-hi)"} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      {loopIn !== null ? <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(loopIn), borderLeft: "1.5px dashed var(--accent)" }} /> : null}
      {loopOut !== null ? <div style={{ position: "absolute", top: 0, bottom: 0, left: pct(loopOut), borderLeft: "1.5px dashed var(--accent)" }} /> : null}
      {marks.map((m) => (
        <div key={m} className="df-wave__mk" style={{ left: pct(m) }}>
          <span className="df-wave__mkflag" />
        </div>
      ))}
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
    <div className="df-col df-col--wave">
      {/* The play position sits above the waveform; IN and OUT below it, with the length of the track between them. */}
      <div className="df-times df-times--top">
        {pos !== null && span ? (
          <span style={{ left: pct(pos), transform: `translateX(-${Math.round(frac(pos) * 100)}%)`, color: "var(--go)", fontWeight: 600 }}>{formatTime(pos)}</span>
        ) : null}
      </div>
      {waveEl}
      <div className="df-times">
        <span style={{ left: 0 }}>{formatTime(a)}</span>
        {span ? (
          <span className="df-times__len" style={{ left: "50%", transform: "translateX(-50%)" }} title={t("Length of the track")}>
            {formatTime(span)}
          </span>
        ) : null}
        <span style={{ right: 0 }}>{formatTime(out)}</span>
      </div>
    </div>
  );
}

function TrackPanel({ track, dur, peaks, voice, failed }: { track: Track; dur: number | null; peaks: number[] | null; voice: Voice | null; failed: boolean }) {
  const t = useT();
  const waveStyle = useSettings((x) => x.settings.waveStyle);
  const cur = () => useDoc.getState().tracks.find((x) => x.id === track.id) ?? track;
  const setBand = (i: number, v: number, phase: EditPhase) => {
    const eq = [...cur().eq] as Eq;
    eq[i] = Math.max(-12, Math.min(12, Math.round(v * 2) / 2));
    edit(track.id, { eq }, phase);
  };
  const setPan = (v: number, phase: EditPhase) => edit(track.id, { pan: Math.max(-100, Math.min(100, Math.round(v))) / 100 }, phase);
  const panPct = Math.round(track.pan * 100);
  const curveOn = track.panEnvelope.length > 0 && !track.ignorePan;
  return (
    <div className="df-panel">
      <div className="df-faders">
        <div className="df-fgroup">
          <div className="df-fgroup__head">
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
                  label={`${t("Equalizer")} ${bandLabel(f)}`}
                  min={-12}
                  max={12}
                  onCommit={(v) => setBand(i, v, "start")}
                />
                <VFader
                  label={`${t("Equalizer")} ${bandLabel(f)}`}
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
        <div className="df-fgroup">
          <div className="df-fgroup__head">
            <Label>{t("Volume")}</Label>
          </div>
          <div className="df-fader-col">
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
            <span className="df-fader-col__name">dB</span>
          </div>
        </div>
        <div className="df-fgroup" title={curveOn ? t("A pan curve is active: it takes over from this fader") : undefined} style={curveOn ? { opacity: 0.55 } : undefined}>
          <div className="df-fgroup__head">
            <Label>{t("Pan")}</Label>
          </div>
          <div className="df-fader-col">
            <NumberField className="df-fader-col__val" value={panPct} text={panText(track.pan)} label={t("Pan")} min={-100} max={100} onCommit={(v) => setPan(v, "start")} />
            <VFader label={t("Pan")} value={panPct} min={-100} max={100} zero={0} step={1} onChange={(v) => setPan(v, "move")} onReset={() => setPan(0, "start")} />
            <span className="df-fader-col__name">L · R</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: 24 }}>
          <Label>{t("EDITING")}</Label>
          <span className="ts-ellipsis" style={{ fontSize: 11, color: "var(--text-3)", flex: 1, minWidth: 0 }}>
            {t("Click the waveform to edit it · start & end cut, volume curve, loop cut and pan")}
          </span>
          <Button variant="sm" icon="pencil" onClick={() => useUi.getState().openEditor(track.id)}>
            {t("Edit")}
          </Button>
        </div>
        <WaveEditor
          track={track}
          duration={dur}
          peaks={peaks}
          height={132}
          panHeight={track.panVisible && track.panEnvelope.length ? 34 : 0}
          playheadSec={voice?.positionSec ?? null}
          editing={null}
          waveStyle={waveStyle}
          onChange={() => {}}
          onOpen={() => useUi.getState().openEditor(track.id)}
          snap={false}
          t={t}
          failed={failed}
        />
      </div>
    </div>
  );
}
