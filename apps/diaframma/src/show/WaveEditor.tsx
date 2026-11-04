import { useMemo, useRef, type PointerEvent as RPointerEvent } from "react";
import { clamp, formatTime } from "@theatre-suite/core";
import { Icon } from "@theatre-suite/ui";
import type { EnvPoint, Track } from "../state/types";

export type EditPhase = "start" | "move" | "end";

const Y = (v: number) => 8 + (1 - v) * 84;

export function wavePath(peaks: number[], bars: number, from = 0, to = bars): string {
  if (!peaks.length) return "";
  let d = "";
  for (let i = from; i < to; i++) {
    const a = Math.floor((i * peaks.length) / bars);
    const b = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / bars));
    let m = 0;
    for (let k = a; k < b && k < peaks.length; k++) m = Math.max(m, peaks[k]);
    const h = Math.max(1.5, Math.min(46, m * 46));
    d += `M${(i + 0.5).toFixed(1)} ${(50 - h).toFixed(1)}V${(50 + h).toFixed(1)}`;
  }
  return d;
}

function envelopePath(points: EnvPoint[], dur: number): { line: string; area: string } {
  if (!points.length || dur <= 0) return { line: "", area: "" };
  const X = (t: number) => clamp((t / dur) * 1000, 0, 1000);
  let d = `M0 ${Y(points[0].v).toFixed(1)} L${X(points[0].t).toFixed(1)} ${Y(points[0].v).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const x0 = X(points[i - 1].t);
    const y0 = Y(points[i - 1].v);
    const x1 = X(points[i].t);
    const y1 = Y(points[i].v);
    const mx = (x0 + x1) / 2;
    d += ` C${mx.toFixed(1)} ${y0.toFixed(1)} ${mx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L1000 ${Y(last.v).toFixed(1)}`;
  return { line: d, area: `${d} L1000 100 L0 100 Z` };
}

export function rulerTicks(dur: number, maxTicks = 6): number[] {
  if (!dur || dur <= 0) return [];
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  const step = steps.find((s) => dur / s <= maxTicks) ?? 3600;
  const out: number[] = [];
  for (let t = step; t < dur - step * 0.4; t += step) out.push(t);
  return out;
}

type Drag = { kind: "in" | "out" | "lin" | "lout" } | { kind: "pt"; index: number };

export function WaveEditor({
  track,
  duration,
  peaks,
  height = 118,
  playheadSec,
  readOnly,
  onChange,
  t,
}: {
  track: Track;
  duration: number | null;
  peaks: number[] | null;
  height?: number;
  playheadSec?: number | null;
  readOnly?: boolean;
  onChange: (patch: Partial<Track>, phase: EditPhase) => void;
  t: (k: string) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const dur = duration && duration > 0 ? duration : 0;
  const inSec = clamp(track.inSec, 0, dur || 0);
  const outSec = dur ? clamp(track.outSec ?? dur, 0, dur) : 0;
  const pct = (s: number) => (dur ? `${clamp((s / dur) * 100, 0, 100)}%` : "0%");
  const bars = height > 200 ? 1000 : 260;
  const wave = useMemo(() => (peaks ? wavePath(peaks, bars) : ""), [peaks, bars]);
  const env = useMemo(() => envelopePath(track.envelope, dur), [track.envelope, dur]);
  const showLoop = track.loop && track.loopVisible;

  const toTime = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * dur, 0, dur);
  };
  const toLevel = (clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const yPct = ((clientY - r.top) / r.height) * 100;
    return clamp(1 - (yPct - 8) / 84, 0, 1);
  };

  const apply = (d: Drag, e: RPointerEvent, phase: EditPhase) => {
    const tm = Math.round(toTime(e.clientX) * 100) / 100;
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
    }
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (readOnly || !dur || e.button !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-drag]");
    let d: Drag | null = null;
    if (el) {
      const k = el.dataset.drag!;
      if (k === "pt") d = { kind: "pt", index: Number(el.dataset.index) };
      else d = { kind: k as "in" | "out" | "lin" | "lout" };
    } else {
      // Click on the line area: add a volume point.
      const tm = toTime(e.clientX);
      const v = toLevel(e.clientY);
      const pts = [...track.envelope, { t: Math.round(tm * 100) / 100, v: Math.round(v * 100) / 100 }].sort((a, b) => a.t - b.t);
      const index = pts.findIndex((p) => p.t === Math.round(tm * 100) / 100);
      onChange({ envelope: pts }, "start");
      d = { kind: "pt", index };
      drag.current = d;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    drag.current = d;
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(d, e, "start");
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
  const removePoint = (i: number) => {
    if (readOnly) return;
    onChange({ envelope: track.envelope.filter((_, k) => k !== i) }, "start");
  };

  return (
    <div>
      <div
        ref={ref}
        className={height > 200 ? "df-wave df-wave--big" : "df-wave"}
        style={{ height, cursor: readOnly || !dur ? "default" : "crosshair" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        aria-label={t("Volume & cut")}
      >
        <svg viewBox={`0 0 ${bars} 100`} preserveAspectRatio="none" width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
          <path d={wave} stroke="var(--wave-hi)" strokeWidth={2} vectorEffect="non-scaling-stroke" fill="none" />
        </svg>
        {dur ? (
          <>
            <div className="df-wave__dim" style={{ left: 0, width: pct(inSec) }} />
            <div className="df-wave__dim" style={{ left: pct(outSec), right: 0 }} />
          </>
        ) : null}
        {env.line ? (
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
            <path d={env.area} fill="var(--accent-soft)" stroke="none" />
            <path d={env.line} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
        {dur
          ? track.envelope.map((p, i) => (
              <div
                key={i}
                className="df-wave__dot"
                data-drag="pt"
                data-index={i}
                title={t("Drag to move · double-click to remove")}
                style={{ left: pct(p.t), top: `${Y(p.v)}%` }}
                onDoubleClick={() => removePoint(i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  removePoint(i);
                }}
              />
            ))
          : null}
        {dur && showLoop && track.loop ? (
          <>
            <div className="df-wave__marker df-wave__marker--loop" data-drag="lin" style={{ left: pct(track.loop.inSec) }} title={t("Loop in")} />
            <span className="df-wave__looptag" style={{ left: pct(track.loop.inSec), marginLeft: 6 }}>
              <Icon name="repeat" size={10} strokeWidth={2.4} />
              {t("LOOP IN")}
            </span>
            <div className="df-wave__marker df-wave__marker--loop" data-drag="lout" style={{ left: pct(track.loop.outSec) }} title={t("Loop out")} />
            <span className="df-wave__looptag" style={{ left: pct(track.loop.outSec), transform: "translateX(-100%)", marginLeft: -6 }}>
              {t("LOOP OUT")}
              <Icon name="repeat" size={10} strokeWidth={2.4} />
            </span>
          </>
        ) : null}
        {dur ? (
          <>
            <div className="df-wave__marker" data-drag="in" style={{ left: pct(inSec) }} title={t("Drag IN (start)")} />
            <span className="df-wave__tag" style={{ left: pct(inSec), marginLeft: 5 }}>
              IN {formatTime(inSec, true)}
            </span>
            <div className="df-wave__marker" data-drag="out" style={{ left: pct(outSec) }} title={t("Drag OUT (end)")} />
            <span className="df-wave__tag" style={{ left: pct(outSec), transform: "translateX(-100%)", marginLeft: -5 }}>
              OUT {formatTime(outSec, true)}
            </span>
          </>
        ) : null}
        {dur && playheadSec !== null && playheadSec !== undefined ? <div className="df-wave__playhead" style={{ left: pct(playheadSec) }} /> : null}
        {!dur ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 12 }}>
            {t("Reading the file…")}
          </div>
        ) : null}
      </div>
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
