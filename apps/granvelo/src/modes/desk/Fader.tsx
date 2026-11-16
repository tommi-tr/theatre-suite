import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useT } from "@theatre-suite/core";
import { NumberField, parseNumberText, registerWheel } from "@theatre-suite/ui";
import { fmtLevel } from "../../lib/format";
import type { Units } from "../../store/settings";

/**
 * A vertical fader 0–255 for the desk. Mirrors the faders of Diaframma / `packages/ui` (`VFader`: pointer drag with
 * capture, a click jumps there unless it takes the handle, mouse wheel on hover through `registerWheel`, `role="slider"`),
 * plus what a lighting desk needs: the value on top (click it to type; 0–255 or % like the computer setting), a label
 * with an optional colour swatch, the DMX number below, and a fill in the colour of the light (never on buttons).
 * The height follows the space it is given (flex), so the same fader serves every density.
 */

export interface FaderProps {
  value: number;
  onChange: (v: number) => void;
  /** Name of the channel (also the accessible name). */
  label: string;
  /** Colour of the fill (and of the swatch). */
  color: string;
  /** Show a colour swatch before the label (colour channels). */
  swatch?: boolean;
  /** Small text under the label (the DMX channel). */
  sub?: string;
  units: Units;
  disabled?: boolean;
  /** Narrow column for the compact density. */
  narrow?: boolean;
  /** Text shown instead of the label under the fader (a short name); `label` stays the accessible name. */
  shortLabel?: string;
  /** Double click or Home: the value to go back to. */
  resetTo?: number;
}

const MAX = 255;
const WHEEL_STEP = 5;
const clamp = (v: number) => Math.min(MAX, Math.max(0, Math.round(v)));

export function Fader({ value, onChange, label, color, swatch, sub, units, disabled, narrow, shortLabel, resetTo = 0 }: FaderProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef({ value, onChange, disabled });
  live.current = { value, onChange, disabled };

  useEffect(() => {
    registerWheel(ref.current, (steps, fine) => {
      const c = live.current;
      if (c.disabled) return;
      const next = clamp(c.value + steps * (fine ? 1 : WHEEL_STEP));
      if (next !== c.value) c.onChange(next);
    });
  }, []);

  const fromEvent = (e: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    const r = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
    const v = clamp(r * MAX);
    if (v !== live.current.value) onChange(v);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = e.shiftKey ? 10 : 1;
    const go = (v: number) => {
      e.preventDefault();
      if (clamp(v) !== value) onChange(clamp(v));
    };
    if (e.key === "ArrowUp" || e.key === "ArrowRight") go(value + big);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") go(value - big);
    else if (e.key === "PageUp") go(value + 10);
    else if (e.key === "PageDown") go(value - 10);
    else if (e.key === "Home") go(MAX);
    else if (e.key === "End") go(0);
  };

  const pct = (value / MAX) * 100;
  const text = fmtLevel(value, units);
  const parse = (s: string) => {
    const n = parseNumberText(s);
    return n === null ? null : units === "percent" ? Math.round((n * MAX) / 100) : Math.round(n);
  };
  return (
    <div className={`gv-fader${narrow ? " gv-fader--narrow" : ""}`} data-disabled={disabled ? "" : undefined}>
      <NumberField
        value={value}
        text={text}
        min={0}
        max={MAX}
        parse={parse}
        onCommit={(v) => onChange(clamp(v))}
        label={t("Value of {name}", { name: label })}
        className="gv-fader__val"
        disabled={disabled}
      />
      <div
        ref={ref}
        className="gv-fader__track"
        style={{ opacity: disabled ? 0.45 : 1 }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={MAX}
        aria-valuenow={value}
        aria-valuetext={text}
        aria-orientation="vertical"
        aria-disabled={disabled || undefined}
        onKeyDown={onKey}
        onDoubleClick={() => !disabled && value !== resetTo && onChange(resetTo)}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const rect = ref.current?.getBoundingClientRect();
          // A press on the handle only takes hold of it; elsewhere the fader jumps there.
          if (rect && Math.abs(e.clientY - (rect.top + (1 - value / MAX) * rect.height)) <= 8) return;
          fromEvent(e);
        }}
        onPointerMove={(e) => {
          if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          fromEvent(e);
        }}
      >
        <div className="gv-fader__rail" />
        <div className="gv-fader__fill" style={{ height: `${pct}%`, background: color }} />
        <div className="gv-fader__thumb" style={{ bottom: `${pct}%` }} />
      </div>
      <div className="gv-fader__label" title={label}>
        {swatch ? <span className="gv-swatch gv-fader__sw" style={{ background: color }} aria-hidden /> : null}
        <span className="ts-ellipsis">{shortLabel ?? label}</span>
      </div>
      <div className="gv-fader__sub">{sub ?? " "}</div>
    </div>
  );
}
