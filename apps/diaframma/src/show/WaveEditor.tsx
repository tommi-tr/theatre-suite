import { useMemo, useRef, type PointerEvent as RPointerEvent } from "react";
import { clamp, formatTime } from "@theatre-suite/core";
import { Icon, NumberField } from "@theatre-suite/ui";
import type { EnvPoint, Track } from "../state/types";

export type EditPhase = "start" | "move" | "end";
/** The groups of the editor: only the one being edited answers to the mouse. */
export type EditGroup = "cut" | "volume" | "loop" | "pan";
export type WaveStyle = "mirror" | "bottom";

const Y = (v: number) => 8 + (1 - v) * 84;
/** Pan lane: +1 (right) at the top, −1 (left) at the bottom. */
const PY = (v: number) => 50 - v * 42;

/** Bars of the waveform as one path (viewBox height 100). */
export function wavePath(peaks: number[], bars: number, from = 0, to = bars, style: WaveStyle = "mirror"): string {
  if (!peaks.length) return "";
  let d = "";
  for (let i = from; i < to; i++) {
    const a = Math.floor((i * peaks.length) / bars);
    const b = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / bars));
    let m = 0;
    for (let k = a; k < b && k < peaks.length; k++) m = Math.max(m, peaks[k]);
    if (style === "bottom") {
      const h = Math.max(1.5, Math.min(94, m * 94));
      d += `M${(i + 0.5).toFixed(1)} 98V${(98 - h).toFixed(1)}`;
    } else {
      const h = Math.max(1.5, Math.min(46, m * 46));
      d += `M${(i + 0.5).toFixed(1)} ${(50 - h).toFixed(1)}V${(50 + h).toFixed(1)}`;
    }
  }
  return d;
}

function curvePath(points: EnvPoint[], dur: number, y: (v: number) => number): { line: string; area: string } {
  if (!points.length || dur <= 0) return { line: "", area: "" };
  const X = (t: number) => clamp((t / dur) * 1000, 0, 1000);
  let d = `M0 ${y(points[0].v).toFixed(1)} L${X(points[0].t).toFixed(1)} ${y(points[0].v).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const x0 = X(points[i - 1].t);
    const y0 = y(points[i - 1].v);
    const x1 = X(points[i].t);
    const y1 = y(points[i].v);
    const mx = (x0 + x1) / 2;
    d += ` C${mx.toFixed(1)} ${y0.toFixed(1)} ${mx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L1000 ${y(last.v).toFixed(1)}`;
  return { line: d, area: `${d} L1000 100 L0 100 Z` };
}

/** Value of a curve at time t (same shape as the audio engine). */
function valueAt(points: EnvPoint[], t: number, def: number): number {
  if (!points.length) return def;
  if (t <= points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (t >= last.t) return last.v;
  const i = points.findIndex((p) => p.t > t);
  const a = points[i - 1];
  const b = points[i];
  const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return a.v + (b.v - a.v) * u * u * (3 - 2 * u);
}

export function rulerTicks(dur: number, maxTicks = 6): number[] {
  if (!dur || dur <= 0) return [];
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  const step = steps.find((s) => dur / s <= maxTicks) ?? 3600;
  const out: number[] = [];
  for (let t = step; t < dur - step * 0.4; t += step) out.push(t);
  return out;
}

type Drag = { kind: "in" | "out" | "lin" | "lout" } | { kind: "pt"; index: number } | { kind: "pan"; index: number };

export function WaveEditor({
  track,
  duration,
  peaks,
  height = 118,
  panHeight = 0,
  playheadSec,
  editing = null,
  waveStyle = "mirror",
  onChange,
  onSeek,
  onOpen,
  onRemoveMarker,
  snap = false,
  t,
  failed,
}: {
  track: Track;
  duration: number | null;
  peaks: number[] | null;
  height?: number;
  /** Height of the pan lane under the waveform; 0 = no lane. */
  panHeight?: number;
  playheadSec?: number | null;
  /** The group being edited; null = a preview that cannot be changed. */
  editing?: EditGroup | null;
  waveStyle?: WaveStyle;
  onChange: (patch: Partial<Track>, phase: EditPhase) => void;
  /** Given while the track is paused: a click away from the markers moves the play position. */
  onSeek?: (sec: number) => void;
  /** Given by the preview: a click away from the markers opens the large editor. */
  onOpen?: () => void;
  /** Given by the large editor: the marker flags can be clicked to remove the marker. */
  onRemoveMarker?: (index: number) => void;
  /** Dragged points stick to the markers. */
  snap?: boolean;
  t: (k: string) => string;
  /** The file could not be read. */
  failed?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const panRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** Last press on a point, to recognise a double click. */
  const lastDot = useRef<{ key: string; at: number } | null>(null);
  const dur = duration && duration > 0 ? duration : 0;
  const inSec = clamp(track.inSec, 0, dur || 0);
  const outSec = dur ? clamp(track.outSec ?? dur, 0, dur) : 0;
  const pct = (s: number) => (dur ? `${clamp((s / dur) * 100, 0, 100)}%` : "0%");
  const big = height > 200;
  const bars = big ? 1000 : 260;
  const wave = useMemo(() => (peaks ? wavePath(peaks, bars, 0, bars, waveStyle) : ""), [peaks, bars, waveStyle]);
  const env = useMemo(() => curvePath(track.envelope, dur, Y), [track.envelope, dur]);
  const panCurve = useMemo(() => curvePath(track.panEnvelope, dur, PY), [track.panEnvelope, dur]);
  // A hidden group is hidden everywhere (it keeps working); "Edit" shows it again.
  const showLoop = !!track.loop && track.loopVisible;
  const showCut = track.cutVisible;
  const showEnv = track.envelopeVisible;
  const showPan = panHeight > 0 && track.panVisible;
  const can = (g: EditGroup) =>
    editing === g && dur > 0 && (g === "cut" ? showCut : g === "volume" ? showEnv : g === "loop" ? showLoop : showPan);
  const markers = dur ? track.markers.filter((m) => m >= 0 && m <= dur) : [];

  /** Sticks a time to the nearest marker (within a few pixels) when that option is on. */
  const snapTime = (tm: number, el: HTMLElement | null) => {
    if (!snap || !markers.length || !el || !dur) return tm;
    const w = el.getBoundingClientRect().width || 1;
    let best = tm;
    let bd = (9 / w) * dur;
    for (const m of markers) {
      const d = Math.abs(m - tm);
      if (d <= bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  };

  const toTime = (el: HTMLElement | null, clientX: number) => {
    const r = el!.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * dur, 0, dur);
  };
  const toLevel = (clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    return clamp(1 - (((clientY - r.top) / r.height) * 100 - 8) / 84, 0, 1);
  };
  const toPan = (clientY: number) => {
    const r = panRef.current!.getBoundingClientRect();
    return clamp((50 - ((clientY - r.top) / r.height) * 100) / 42, -1, 1);
  };

  const apply = (d: Drag, e: RPointerEvent, phase: EditPhase) => {
    const lane = d.kind === "pan" ? panRef.current : ref.current;
    const tm = Math.round(snapTime(toTime(lane, e.clientX), lane) * 100) / 100;
    if (d.kind === "in") onChange({ inSec: clamp(tm, 0, Math.max(0, outSec - 0.1)) }, phase);
    else if (d.kind === "out") {
      const o = clamp(tm, inSec + 0.1, dur);
      onChange({ outSec: Math.abs(o - dur) < 0.02 ? null : o }, phase);
    } else if (d.kind === "lin" && track.loop) onChange({ loop: { inSec: clamp(tm, 0, track.loop.outSec - 0.1), outSec: track.loop.outSec } }, phase);
    else if (d.kind === "lout" && track.loop) onChange({ loop: { inSec: track.loop.inSec, outSec: clamp(tm, track.loop.inSec + 0.1, dur) } }, phase);
    else if (d.kind === "pt") {
      const pts = [...track.envelope];
      const lo = d.index > 0 ? pts[d.index - 1].t + 0.01 : 0;
      const hi = d.index < pts.length - 1 ? pts[d.index + 1].t - 0.01 : dur;
      pts[d.index] = { t: clamp(tm, lo, hi), v: Math.round(toLevel(e.clientY) * 100) / 100 };
      onChange({ envelope: pts }, phase);
    } else if (d.kind === "pan") {
      const pts = [...track.panEnvelope];
      const lo = d.index > 0 ? pts[d.index - 1].t + 0.01 : 0;
      const hi = d.index < pts.length - 1 ? pts[d.index + 1].t - 0.01 : dur;
      const v = Math.round(toPan(e.clientY) * 50) / 50;
      pts[d.index] = { t: clamp(tm, lo, hi), v: Math.abs(v) < 0.04 ? 0 : v };
      onChange({ panEnvelope: pts }, phase);
    }
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dur || e.button !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-drag]");
    let d: Drag | null = null;
    if (el) {
      const k = el.dataset.drag!;
      if (k === "pt") {
        const index = Number(el.dataset.index);
        const now = Date.now();
        if (lastDot.current && lastDot.current.key === `v${index}` && now - lastDot.current.at < 400) {
          lastDot.current = null;
          onChange({ envelope: track.envelope.filter((_, i) => i !== index) }, "start");
          return;
        }
        lastDot.current = { key: `v${index}`, at: now };
        d = { kind: "pt", index };
      } else d = { kind: k as "in" | "out" | "lin" | "lout" };
    } else {
      const tm = toTime(ref.current, e.clientX);
      if (can("volume")) {
        const r = ref.current!.getBoundingClientRect();
        const lineY = r.top + (Y(valueAt(track.envelope, tm, 1)) / 100) * r.height;
        if (Math.abs(e.clientY - lineY) <= 14) {
          const v = toLevel(e.clientY);
          const rt = Math.round(snapTime(tm, ref.current) * 100) / 100;
          const pts = [...track.envelope, { t: rt, v: Math.round(v * 100) / 100 }].sort((a, b) => a.t - b.t);
          onChange({ envelope: pts }, "start");
          drag.current = { kind: "pt", index: pts.findIndex((p) => p.t === rt) };
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }
      // Away from any handle: move the play position there (when allowed) or open the large editor.
      if (onSeek) onSeek(tm);
      else onOpen?.();
      return;
    }
    drag.current = d;
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(d, e, "start");
  };

  const onPanDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!can("pan")) {
      if (onOpen && !onSeek) onOpen();
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-drag='pan']");
    if (el) {
      const index = Number(el.dataset.index);
      const now = Date.now();
      if (lastDot.current && lastDot.current.key === `p${index}` && now - lastDot.current.at < 400) {
        lastDot.current = null;
        onChange({ panEnvelope: track.panEnvelope.filter((_, i) => i !== index) }, "start");
        return;
      }
      lastDot.current = { key: `p${index}`, at: now };
      drag.current = { kind: "pan", index };
    } else {
      const tm = Math.round(snapTime(toTime(panRef.current, e.clientX), panRef.current) * 100) / 100;
      const v = Math.round(toPan(e.clientY) * 50) / 50;
      const pts = [...track.panEnvelope, { t: tm, v: Math.abs(v) < 0.04 ? 0 : v }].sort((a, b) => a.t - b.t);
      onChange({ panEnvelope: pts }, "start");
      drag.current = { kind: "pan", index: pts.findIndex((p) => p.t === tm) };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (el) apply(drag.current!, e, "start");
  };

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId)) apply(drag.current, e, "move");
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      apply(drag.current, e, "end");
      drag.current = null;
    }
  };

  const fadedCut = track.ignoreCut;
  const dim = (on: boolean) => (on ? { opacity: 0.35 } : undefined);
  const pe = (g: EditGroup) => ({ pointerEvents: editing === g ? ("auto" as const) : ("none" as const) });
  const cursor = !dur ? "default" : editing === "volume" && showEnv ? "crosshair" : onSeek || onOpen ? "pointer" : "default";

  return (
    <div>
      <div
        ref={ref}
        className={big ? "df-wave df-wave--big" : "df-wave"}
        style={{ height, cursor }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        aria-label={t("EDITING")}
      >
        <svg viewBox={`0 0 ${bars} 100`} preserveAspectRatio="none" width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
          <path d={wave} stroke="var(--wave-hi)" strokeWidth={2} vectorEffect="non-scaling-stroke" fill="none" />
        </svg>
        {dur && showCut && !fadedCut ? (
          <>
            <div className="df-wave__dim" style={{ left: 0, width: pct(inSec) }} />
            <div className="df-wave__dim" style={{ left: pct(outSec), right: 0 }} />
          </>
        ) : null}
        {!env.line && dur && editing === "volume" ? (
          <div title={t("Click the line to add a volume point")} style={{ position: "absolute", left: 0, right: 0, top: "8%", borderTop: "2px dashed var(--accent-line)", pointerEvents: "none" }} />
        ) : null}
        {env.line && showEnv ? (
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none", ...dim(track.ignoreEnvelope) }} aria-hidden="true">
            <path d={env.area} fill="var(--accent-soft)" stroke="none" />
            <path d={env.line} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray={track.ignoreEnvelope ? "5 4" : undefined} />
          </svg>
        ) : null}
        {dur && showEnv
          ? track.envelope.map((p, i) => (
              <div
                key={i}
                className="df-wave__dot"
                data-drag="pt"
                data-index={i}
                title={t("Drag to move · double-click to remove")}
                style={{ left: pct(p.t), top: `${Y(p.v)}%`, ...pe("volume"), ...(editing === "volume" ? undefined : { transform: "scale(0.75)", opacity: 0.8 }) }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (can("volume")) onChange({ envelope: track.envelope.filter((_, k) => k !== i) }, "start");
                }}
              />
            ))
          : null}
        {dur && showLoop && track.loop ? (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", ...dim(track.ignoreLoop) }}>
            <div className="df-wave__marker df-wave__marker--loop" data-drag="lin" style={{ left: pct(track.loop.inSec), ...pe("loop") }} title={t("Loop in")} />
            <span className="df-wave__looptag" style={{ left: pct(track.loop.inSec), marginLeft: 6 }}>
              <Icon name="repeat" size={10} strokeWidth={2.4} />
              {t("LOOP IN")}
            </span>
            <div className="df-wave__marker df-wave__marker--loop" data-drag="lout" style={{ left: pct(track.loop.outSec), ...pe("loop") }} title={t("Loop out")} />
            <span className="df-wave__looptag" style={{ left: pct(track.loop.outSec), transform: "translateX(-100%)", marginLeft: -6 }}>
              {t("LOOP OUT")}
              <Icon name="repeat" size={10} strokeWidth={2.4} />
            </span>
          </div>
        ) : null}
        {dur && showCut ? (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", ...dim(fadedCut) }}>
            <div className="df-wave__marker" data-drag="in" style={{ left: pct(inSec), ...pe("cut") }} title={t("Drag IN (start)")} />
            <span className={editing === "cut" ? "df-wave__tag df-wave__tag--edit" : "df-wave__tag"} style={{ left: pct(inSec), marginLeft: 5 }}>
              IN{" "}
              <NumberField
                value={inSec}
                text={formatTime(inSec, true)}
                label={t("IN (start)")}
                min={0}
                max={Math.max(0, outSec - 0.1)}
                disabled={editing !== "cut"}
                onCommit={(v) => onChange({ inSec: Math.round(v * 100) / 100 }, "start")}
              />
            </span>
            <div className="df-wave__marker" data-drag="out" style={{ left: pct(outSec), ...pe("cut") }} title={t("Drag OUT (end)")} />
            <span className={editing === "cut" ? "df-wave__tag df-wave__tag--edit" : "df-wave__tag"} style={{ left: pct(outSec), transform: "translateX(-100%)", marginLeft: -5 }}>
              OUT{" "}
              <NumberField
                value={outSec}
                text={formatTime(outSec, true)}
                label={t("OUT (end)")}
                min={inSec + 0.1}
                max={dur}
                disabled={editing !== "cut"}
                onCommit={(v) => onChange({ outSec: Math.abs(v - dur) < 0.02 ? null : Math.round(v * 100) / 100 }, "start")}
              />
            </span>
          </div>
        ) : null}
        {markers.map((m) => {
          const i = track.markers.indexOf(m);
          return (
            <div key={`${m}-${i}`} className="df-wave__mk" style={{ left: pct(m) }}>
              {onRemoveMarker ? (
                <button
                  type="button"
                  className="df-wave__mkflag df-wave__mkflag--btn"
                  title={`${t("Marker")} ${formatTime(m, true)} · ${t("Click to remove")}`}
                  aria-label={`${t("Marker")} ${formatTime(m, true)} · ${t("Click to remove")}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onRemoveMarker(i)}
                />
              ) : (
                <span className="df-wave__mkflag" />
              )}
            </div>
          );
        })}
        {dur && playheadSec !== null && playheadSec !== undefined ? <div className="df-wave__playhead" style={{ left: pct(playheadSec) }} /> : null}
        {!dur ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 12 }}>
            {failed ? t("This file cannot be read. Load another file.") : t("Reading the file…")}
          </div>
        ) : null}
      </div>
      {showPan ? (
        <div
          ref={panRef}
          className="df-wave df-wave--pan"
          style={{ height: panHeight, marginTop: 4, cursor: can("pan") ? "crosshair" : "default" }}
          onPointerDown={onPanDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-label={t("Pan")}
        >
          <div style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: "1px dashed var(--border)", pointerEvents: "none" }} />
          <span className="df-wave__lane">R</span>
          <span className="df-wave__lane df-wave__lane--bottom">L</span>
          {panCurve.line ? (
            <svg viewBox="0 0 1000 100" preserveAspectRatio="none" width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none", ...dim(track.ignorePan) }} aria-hidden="true">
              <path d={panCurve.line} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray={track.ignorePan ? "5 4" : undefined} />
            </svg>
          ) : null}
          {dur
            ? track.panEnvelope.map((p, i) => (
                <div
                  key={i}
                  className="df-wave__dot"
                  data-drag="pan"
                  data-index={i}
                  title={t("Drag to move · double-click to remove")}
                  style={{ left: pct(p.t), top: `${PY(p.v)}%`, ...pe("pan") }}
                />
              ))
            : null}
          {markers.map((m) => (
            <div key={m} className="df-wave__mk df-wave__mk--lane" style={{ left: pct(m) }} />
          ))}
          {dur && playheadSec !== null && playheadSec !== undefined ? <div className="df-wave__playhead" style={{ left: pct(playheadSec) }} /> : null}
        </div>
      ) : null}
      <div className="df-times" style={{ marginTop: 4 }}>
        <span style={{ left: 0 }}>00:00</span>
        {rulerTicks(dur).map((s) => (
          <span key={s} style={{ left: pct(s), transform: "translateX(-50%)" }}>
            {formatTime(s)}
          </span>
        ))}
        <span style={{ right: 0 }}>{formatTime(dur)}</span>
      </div>
    </div>
  );
}
