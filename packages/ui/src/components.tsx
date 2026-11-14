import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./icons";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/* ---------------- Button ---------------- */

export type ButtonVariant = "tool" | "ghost" | "primary" | "danger" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  iconColor?: string;
  iconOnly?: boolean;
  on?: boolean;
  kbd?: string;
}

export function Button({ variant = "tool", icon, iconColor, iconOnly, on, kbd, className, children, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx(
        "ts-btn",
        variant !== "tool" && `ts-btn--${variant}`,
        iconOnly && "ts-btn--icon",
        on && "ts-btn--on",
        className,
      )}
      {...rest}
    >
      {icon ? <Icon name={icon} size={variant === "sm" ? 13 : 15} color={iconColor} /> : null}
      {children}
      {kbd ? <Kbd>{kbd}</Kbd> : null}
    </button>
  );
}

export function Kbd({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <kbd className="ts-kbd" style={style}>
      {children}
    </kbd>
  );
}

export function Label({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <span className={cx("ts-label", className)} style={style}>
      {children}
    </span>
  );
}

/* ---------------- Segmented ---------------- */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  small,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  small?: boolean;
}) {
  return (
    <div className={cx("ts-seg", small && "ts-seg--sm")} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" className="ts-seg__btn" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon ? <Icon name={o.icon} size={15} /> : null}
          <span className="ts-seg__label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------- Switch ---------------- */

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="ts-switch"
      onClick={() => onChange(!checked)}
    />
  );
}

/* ---------------- Range (horizontal) ---------------- */

export function Range({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  width = 96,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  width?: number;
  disabled?: boolean;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  const live = useRef({ value, onChange, min, max, step, disabled });
  live.current = { value, onChange, min, max, step, disabled };
  return (
    <input
      ref={(el) =>
        registerWheel(el, (steps, fine) => {
          const c = live.current;
          if (c.disabled) return;
          const next = Math.min(c.max, Math.max(c.min, c.value + steps * c.step * (fine ? 1 : 2)));
          if (next !== c.value) c.onChange(Math.round(next / c.step) * c.step);
        })
      }
      type="range"
      className="ts-range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
      style={{ width, ["--fill" as string]: `${fill}%` }}
    />
  );
}

/* ---------------- Mouse wheel over a fader ---------------- */

type WheelFn = (steps: number, fine: boolean) => void;
const wheelFns = new WeakMap<HTMLElement, WheelFn>();
let wheelAcc = 0;
let wheelEl: HTMLElement | null = null;
let wheelInstalled = false;

/**
 * Makes the mouse wheel move a fader just by passing over it (no click needed),
 * like in Adobe programs. Shift = finer steps. Faders register themselves here.
 */
export function registerWheel(el: HTMLElement | null, fn: WheelFn) {
  if (!el) return;
  wheelFns.set(el, fn);
  el.setAttribute("data-wheelable", "on");
  if (wheelInstalled || typeof window === "undefined") return;
  wheelInstalled = true;
  window.addEventListener(
    "wheel",
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-wheelable]") ?? null;
      const fn = el ? wheelFns.get(el) : undefined;
      if (!el || !fn) {
        wheelEl = null;
        return;
      }
      e.preventDefault();
      if (wheelEl !== el) {
        wheelEl = el;
        wheelAcc = 0;
      }
      // A mouse notch is ~100 px; touchpads send many small deltas.
      wheelAcc += e.deltaY;
      const unit = Math.abs(e.deltaY) >= 50 ? Math.abs(e.deltaY) : 50;
      while (Math.abs(wheelAcc) >= unit * 0.99) {
        const dir = wheelAcc < 0 ? 1 : -1;
        wheelAcc += dir * unit;
        fn(dir, e.shiftKey);
      }
    },
    { passive: false, capture: true },
  );
}

/* ---------------- Number you can type ---------------- */

/** Reads "3", "-2,5", "+1.5 dB", "1:05.3" (minutes:seconds). Null if not a number. */
export function parseNumberText(text: string): number | null {
  const s = text.trim().replace(/,/g, ".").replace(/[^0-9.:+\-−]/g, "").replace("−", "-");
  if (!s) return null;
  if (s.includes(":")) {
    const parts = s.split(":").map((p) => Number(p));
    if (parts.some((p) => !Number.isFinite(p))) return null;
    let total = 0;
    for (const p of parts) total = total * 60 + Math.abs(p);
    return s.startsWith("-") ? -total : total;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/**
 * A value shown as plain text; a click turns it into a field to type a new
 * value (Enter or click away to confirm, Esc to cancel). It looks the same as
 * before until it is clicked.
 */
export function NumberField({
  value,
  text,
  onCommit,
  min,
  max,
  label,
  className,
  style,
  disabled,
  parse = parseNumberText,
  title,
}: {
  value: number | null;
  /** What is shown (formatted value). */
  text: string;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  label: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  parse?: (s: string) => number | null;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  const commit = () => {
    const v = parse(draft);
    setEditing(false);
    if (v === null) return;
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (c !== value) onCommit(c);
  };
  if (editing) {
    return (
      <input
        ref={inputRef}
        className={cx("ts-numedit", className)}
        style={{ ...style, width: `${Math.max(4, draft.length + 1)}ch` }}
        aria-label={label}
        value={draft}
        inputMode="decimal"
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <span
      className={cx("ts-numtext", disabled && "ts-numtext--off", className)}
      style={style}
      role={disabled ? undefined : "button"}
      tabIndex={disabled ? undefined : 0}
      aria-label={disabled ? undefined : `${label}: ${text}`}
      title={disabled ? title : title ?? label}
      onPointerDown={(e) => !disabled && e.stopPropagation()}
      onClick={(e) => {
        if (disabled) return;
        e.stopPropagation();
        setDraft(text.replace(/\s*(dB|s|%|Hz)$/i, ""));
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (!disabled && e.key === "Enter") {
          e.preventDefault();
          setDraft(text);
          setEditing(true);
        }
      }}
    >
      {text}
    </span>
  );
}

/* ---------------- Vertical fader ---------------- */

export function VFader({
  value,
  min,
  max,
  zero,
  step = 0.5,
  onChange,
  onReset,
  label,
  height = 96,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  /** Value drawn as a reference line (for example 0 dB). */
  zero?: number;
  step?: number;
  onChange: (v: number) => void;
  onReset?: () => void;
  label: string;
  height?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const toY = (v: number) => (1 - (v - min) / (max - min)) * height;
  const fromY = (y: number) => {
    const r = Math.min(1, Math.max(0, 1 - y / height));
    const v = min + r * (max - min);
    return Math.round(v / step) * step;
  };
  const setFromEvent = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    onChange(fromY(e.clientY - rect.top));
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(max, value + step * big));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(min, value - step * big));
    } else if (e.key === "Home" && onReset) {
      e.preventDefault();
      onReset();
    }
  };
  const live = useRef({ value, onChange, min, max, step, disabled });
  live.current = { value, onChange, min, max, step, disabled };
  useEffect(() => {
    registerWheel(ref.current, (steps, fine) => {
      const c = live.current;
      if (c.disabled) return;
      const next = Math.min(c.max, Math.max(c.min, c.value + steps * c.step * (fine ? 1 : 2)));
      if (next !== c.value) c.onChange(Math.round(next / c.step) * c.step);
    });
  }, []);
  const ref0 = zero ?? min;
  const yv = toY(value);
  const y0 = toY(ref0);
  return (
    <div
      ref={ref}
      className="ts-vfader"
      style={{ height, opacity: disabled ? 0.45 : 1 }}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-orientation="vertical"
      onKeyDown={onKey}
      onDoubleClick={() => !disabled && onReset?.()}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        // A click on the handle only takes hold of it; elsewhere it jumps there.
        const rect = ref.current?.getBoundingClientRect();
        if (rect && Math.abs(e.clientY - rect.top - yv) <= 7) return;
        setFromEvent(e);
      }}
      onPointerMove={(e) => {
        if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        setFromEvent(e);
      }}
    >
      <div className="ts-vfader__track" />
      {zero !== undefined ? <div className="ts-vfader__zero" style={{ top: y0 }} /> : null}
      <div className="ts-vfader__fill" style={{ top: Math.min(yv, y0), height: Math.abs(y0 - yv) }} />
      <div className="ts-vfader__thumb" style={{ top: yv }} />
    </div>
  );
}

/* ---------------- Dialog ---------------- */

export function Dialog({
  title,
  icon,
  description,
  children,
  footer,
  onClose,
  width = 560,
}: {
  title: string;
  icon?: IconName;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  const boxRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const first = boxRef.current?.querySelector<HTMLElement>("button, input, select, [tabindex='0']");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="ts-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={boxRef} role="dialog" aria-modal="true" aria-label={title} className="ts-dialog" style={{ width }}>
        <div className="ts-dialog__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ts-dialog__title">
              {icon ? <Icon name={icon} size={18} /> : null}
              {title}
            </div>
            {description ? <div className="ts-dialog__desc">{description}</div> : null}
          </div>
          <Button variant="ghost" iconOnly icon="x" aria-label="Close" onClick={onClose} style={{ width: 32, height: 32 }} />
        </div>
        <div className="ts-dialog__body">{children}</div>
        {footer ? <div className="ts-dialog__foot">{footer}</div> : null}
      </section>
    </div>
  );
}

/* ---------------- Toast ---------------- */

export function Toast({ message, kind = "info", onDone, ms = 3500 }: { message: string; kind?: "info" | "error"; onDone: () => void; ms?: number }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(id);
  }, [message, ms, onDone]);
  return (
    <div className={cx("ts-toast", kind === "error" && "ts-toast--error")} role="status">
      <Icon name={kind === "error" ? "alert" : "info"} size={15} color={kind === "error" ? "var(--stop)" : undefined} />
      {message}
    </div>
  );
}

/* ---------------- Title bar ---------------- */

export interface WindowActions {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  maximized?: boolean;
}

export function TitleBar({
  logo,
  appName,
  fileName,
  saveState,
  center,
  actions,
  windowActions,
  labels,
}: {
  logo: ReactNode;
  appName: string;
  fileName?: string;
  saveState?: { text: string; dirty: boolean };
  center?: ReactNode;
  actions?: ReactNode;
  windowActions: WindowActions;
  labels: { minimize: string; maximize: string; restore: string; close: string };
}) {
  return (
    <header className="ts-titlebar" data-tauri-drag-region>
      <div className="ts-titlebar__side" data-tauri-drag-region>
        {logo}
        <span className="ts-titlebar__name" data-tauri-drag-region>
          {appName}
        </span>
        {fileName ? (
          <>
            <span className="ts-titlebar__sep">/</span>
            <span className="ts-titlebar__file" data-tauri-drag-region title={fileName}>
              {fileName}
            </span>
          </>
        ) : null}
        {saveState ? (
          <span className={cx("ts-titlebar__state", saveState.dirty && "ts-titlebar__state--dirty")}>
            {saveState.dirty ? <span className="ts-dot ts-dot--sb" /> : <Icon name="check" size={12} strokeWidth={2.4} />}
            {saveState.text}
          </span>
        ) : null}
      </div>
      {center}
      <div className="ts-titlebar__side ts-titlebar__side--end" data-tauri-drag-region>
        {actions}
        <span className="ts-titlebar__divider" />
        <button type="button" className="ts-win-btn" aria-label={labels.minimize} title={labels.minimize} onClick={windowActions.minimize}>
          <Icon name="minus" size={12} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          className="ts-win-btn"
          aria-label={windowActions.maximized ? labels.restore : labels.maximize}
          title={windowActions.maximized ? labels.restore : labels.maximize}
          onClick={windowActions.toggleMaximize}
        >
          <Icon name={windowActions.maximized ? "restore" : "square"} size={12} strokeWidth={1.6} />
        </button>
        <button type="button" className="ts-win-btn ts-win-btn--close" aria-label={labels.close} title={labels.close} onClick={windowActions.close}>
          <Icon name="x" size={12} strokeWidth={1.6} />
        </button>
      </div>
    </header>
  );
}

export function StatusBar({ children }: { children: ReactNode }) {
  return <footer className="ts-statusbar">{children}</footer>;
}

/* ---------------- Hold-to-confirm button ---------------- */

/** Button that fires only after being held for `holdMs` (used to unlock show mode). */
export function HoldButton({
  holdMs = 800,
  onHold,
  children,
  className,
  style,
  ariaLabel,
}: {
  holdMs?: number;
  onHold: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const timer = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => cancel, [cancel]);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={className}
      style={style}
      onPointerDown={() => {
        cancel();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          onHold();
        }, holdMs);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat && timer.current === null) {
          e.preventDefault();
          timer.current = window.setTimeout(() => {
            timer.current = null;
            onHold();
          }, holdMs);
        }
      }}
      onKeyUp={cancel}
    >
      {children}
    </button>
  );
}
