import { useEffect, useMemo, useRef, useState } from "react";
import { basename, uid, useT } from "@theatre-suite/core";
import { Button, Dialog, Icon, NumberField, Range, Segmented, Switch, type IconName } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { pickAudioFiles } from "../lib/files";
import { APP_CTRL_KEYS, assignPad, isPadPlaying, keyLabel, padAt, padDown, padPath, padUp, slotLabel, slotProblem, stopEverything, usePads } from "../lib/launchpad";
import { BUILTIN_SOUNDS, defaultPads, useSettings, type Pad, type PadMode } from "../state/settings";
import { useUi } from "../state/ui";

const MODE_ICON: Record<PadMode, IconName> = { hold: "hand", toEnd: "toEnd", toggle: "toggle" };

export function padName(t: (k: string) => string, p: Pad): string {
  if (p.name) return p.name;
  const b = BUILTIN_SOUNDS.find((x) => x.file === p.builtin);
  return b ? t(b.name) : p.path ? basename(p.path) : "—";
}

function modeText(t: (k: string) => string, m: PadMode): string {
  return m === "hold" ? t("While held") : m === "toEnd" ? t("To the end") : t("Press again to stop");
}

// ---------------- The drawn keyboard ----------------

interface KeyDef {
  code: string;
  /** Width in key units. */
  w?: number;
}
const gap = (w: number): KeyDef => ({ code: `gap${w}`, w });

const MAIN_ROWS: KeyDef[][] = [
  [{ code: "Escape" }, gap(0.5), ...["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"].map((c) => ({ code: c }))],
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((c) => ({ code: `Digit${c}` })),
  [gap(0.5), ..."QWERTYUIOP".split("").map((c) => ({ code: `Key${c}` }))],
  [gap(0.75), ..."ASDFGHJKL".split("").map((c) => ({ code: `Key${c}` }))],
  [gap(1.25), ..."ZXCVBNM".split("").map((c) => ({ code: `Key${c}` }))],
  [gap(2), { code: "Space", w: 6 }],
];
const NUM_ROWS: KeyDef[][] = [
  [{ code: "NumpadDivide" }, { code: "NumpadMultiply" }, { code: "NumpadSubtract" }],
  [{ code: "Numpad7" }, { code: "Numpad8" }, { code: "Numpad9" }, { code: "NumpadAdd" }],
  [{ code: "Numpad4" }, { code: "Numpad5" }, { code: "Numpad6" }],
  [{ code: "Numpad1" }, { code: "Numpad2" }, { code: "Numpad3" }],
  [{ code: "Numpad0", w: 2 }, { code: "NumpadDecimal" }],
];

const RESERVED_NAMES: Record<string, string> = { Space: "GO", Escape: "Stop all", KeyP: "Pause" };

interface Drag {
  padId: string;
  from: "library" | "key";
  x: number;
  y: number;
}

/** Launchpad mode: library of sounds on top, drawn keyboard below. */
export function LaunchpadMode() {
  const t = useT();
  const pads = useSettings((s) => s.settings.pads);
  const on = useSettings((s) => s.settings.launchpadOn);
  const live = usePads((s) => s.live);
  const [level, setLevel] = useState<"plain" | "ctrl">("plain");
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const ctrl = level === "ctrl";

  // Holding Ctrl shows its level while it is held.
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === "Control" && setLevel("ctrl");
    const up = (e: KeyboardEvent) => e.key === "Control" && setLevel("plain");
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Space is still GO, Esc stops everything, P pauses everything (as in the other modes).
  useEffect(() => {
    let lastEsc = 0;
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().dialog || useUi.getState().mode !== "launchpad") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (e.code === "Space") {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) api.engineGo().catch((err) => useUi.getState().showToast(String(err), "error"));
      } else if (e.code === "Escape" && !e.repeat) {
        e.preventDefault();
        const now = Date.now();
        stopEverything(now - lastEsc < 900);
        lastEsc = now;
      } else if (e.code === "KeyP" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        e.preventDefault();
        api.enginePauseAll().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const playing = (id: string) => !!live?.voices.some((v) => v.trackId === id && v.fading !== "out");
  const slotOf = useMemo(() => new Map(pads.filter((p) => p.key).map((p) => [`${p.ctrl ? "c" : "p"}:${p.key}`, p])), [pads]);

  const add = async () => {
    const files = await pickAudioFiles(t, true);
    if (!files.length) return;
    const list = [...useSettings.getState().settings.pads];
    const fresh: Pad[] = files.map((f) => ({ id: uid(), name: null, builtin: null, path: f, key: null, ctrl: false, mode: "toEnd", loop: false, volumeDb: 0 }));
    useSettings.getState().update({ pads: [...list, ...fresh].slice(0, 96) });
    if (fresh.length === 1) setEditing(fresh[0].id);
  };

  // Pointer drag: a native drop of files disables the HTML drag-and-drop, so it is done by hand.
  const startDrag = (e: React.PointerEvent, padId: string, from: "library" | "key") => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      moved = true;
      const d = { padId, from, x: ev.clientX, y: ev.clientY };
      dragRef.current = d;
      setDrag(d);
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      setOver(el?.closest<HTMLElement>("[data-slot]")?.dataset.slot ?? null);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragRef.current = null;
      setDrag(null);
      setOver(null);
      if (!moved) {
        setEditing(padId);
        return;
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const slot = el?.closest<HTMLElement>("[data-slot]")?.dataset.slot;
      if (slot) {
        const err = assignPad(padId, slot, levelRef.current === "ctrl");
        if (err) useUi.getState().showToast(t(err), "error");
      } else if (from === "key" && !el?.closest("[data-keyboard]")) {
        assignPad(padId, null, false);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const levelRef = useRef(level);
  levelRef.current = level;

  const hovered = hover ? pads.find((p) => p.id === hover) ?? null : null;
  const dragged = drag ? pads.find((p) => p.id === drag.padId) ?? null : null;

  const renderKey = (k: KeyDef, i: number) => {
    if (k.code.startsWith("gap")) return <span key={`${k.code}-${i}`} style={{ width: `calc(${k.w} * var(--kb-u))`, flex: "none" }} />;
    const w = k.w ?? 1;
    const style = { width: `calc(${w} * var(--kb-u) - var(--kb-gap))` };
    const reservedName = RESERVED_NAMES[k.code];
    const problem = slotProblem(k.code, ctrl);
    const pad = slotOf.get(`${ctrl ? "c" : "p"}:${k.code}`) ?? null;
    const label = k.code.startsWith("F") && /^F\d+$/.test(k.code) ? k.code : k.code === "Escape" ? "Esc" : k.code === "Space" ? "Space" : keyLabel(k.code);
    if (problem && !pad) {
      return (
        <div key={k.code} className="df-kb-key df-kb-key--reserved" style={style} title={reservedName ? `${label} · ${t(reservedName)}` : t(problem)}>
          <span className="df-kb-key__label">{label}</span>
          {reservedName ? <span className="df-kb-key__sound">{t(reservedName)}</span> : <Icon name="lock" size={11} color="var(--text-3)" />}
        </div>
      );
    }
    const isOver = over === k.code && drag;
    const onlyHere = ctrl && APP_CTRL_KEYS.has(k.code);
    return (
      <div
        key={k.code}
        data-slot={k.code}
        className={["df-kb-key", pad ? "df-kb-key--used" : "", pad && playing(pad.id) ? "df-kb-key--on" : "", isOver ? "df-kb-key--over" : "", drag?.padId === pad?.id && drag ? "df-kb-key--lifted" : ""].join(" ")}
        style={style}
        title={pad ? `${padName(t, pad)} · ${modeText(t, pad.mode)}${pad.loop ? ` · ${t("Loop")}` : ""}` : `${slotLabel(k.code, ctrl)} · ${t("free")}`}
        onPointerDown={pad ? (e) => startDrag(e, pad.id, "key") : undefined}
        onPointerEnter={() => pad && setHover(pad.id)}
        onPointerLeave={() => setHover(null)}
      >
        <span className="df-kb-key__label">
          {label}
          {onlyHere ? <span title={t("The Ctrl level of this key plays only in Launchpad mode")}> ·</span> : null}
        </span>
        {pad ? (
          <>
            <span className="df-kb-key__sound">{padName(t, pad)}</span>
            <span className="df-kb-key__icons">
              <Icon name={MODE_ICON[pad.mode]} size={10} />
              {pad.loop ? <Icon name="repeat" size={10} /> : null}
            </span>
          </>
        ) : null}
      </div>
    );
  };

  return (
    <main className="df-lpmode" aria-label={t("Launchpad")}>
      <div className="df-lpmode__top">
        <div className="df-lpmode__switch">
          <Switch checked={on} onChange={(v) => useSettings.getState().update({ launchpadOn: v })} label={t("Launchpad active")} />
          <div>
            <div style={{ fontWeight: 600 }}>{t("Launchpad active")}</div>
            <div className="ts-field__hint">
              {on ? t("The keys play their sounds also in Show and Rehearsal mode.") : t("The keys play their sounds only in this screen.")}
            </div>
          </div>
        </div>
        <span className="ts-spacer" />
        <Segmented
          small
          ariaLabel={t("Key level")}
          value={level}
          onChange={setLevel}
          options={[
            { value: "plain", label: t("Key"), icon: "keyboard" },
            { value: "ctrl", label: "Ctrl + " + t("key"), icon: "keyboard" },
          ]}
        />
      </div>

      <section className="df-lpmode__lib" aria-label={t("Sounds")}>
        <div className="df-lpmode__libhead">
          <span className="ts-label" style={{ color: "var(--text)" }}>
            {t("Sounds")}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{t("Drag a sound onto a key. Click it to change its settings.")}</span>
          <span className="ts-spacer" />
          <Button variant="sm" icon="plus" onClick={add}>
            {t("Add sound")}
          </Button>
        </div>
        <div className="df-lpmode__chips">
          {pads.map((p) => (
            <div
              key={p.id}
              className={["df-snd", playing(p.id) ? "df-snd--on" : "", drag?.padId === p.id ? "df-snd--lifted" : "", padPath(p) ? "" : "df-snd--missing"].join(" ")}
              title={`${padName(t, p)} · ${modeText(t, p.mode)}`}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest("[data-try]")) return;
                startDrag(e, p.id, "library");
              }}
            >
              <button
                type="button"
                className="df-snd__try"
                data-try
                aria-label={t("Try")}
                title={t("Try")}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  padDown({ ...p, mode: p.mode === "toggle" ? "toggle" : "hold" });
                }}
                onPointerUp={() => padUp({ ...p, mode: p.mode === "toggle" ? "toggle" : "hold" })}
                onPointerCancel={() => padUp({ ...p, mode: "hold" })}
              >
                <Icon name="playF" size={10} />
              </button>
              <span className="df-snd__name">{padName(t, p)}</span>
              {p.key ? <span className="df-snd__key">{slotLabel(p.key, p.ctrl)}</span> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="df-kb-wrap" aria-label={t("Keyboard")}>
        <div className="df-kb" data-keyboard>
          <div className="df-kb__main">
            {MAIN_ROWS.map((row, r) => (
              <div key={r} className="df-kb__row">
                {row.map(renderKey)}
              </div>
            ))}
          </div>
          <div className="df-kb__num">
            {NUM_ROWS.map((row, r) => (
              <div key={r} className="df-kb__row">
                {row.map(renderKey)}
              </div>
            ))}
          </div>
        </div>
        <div className="df-kb-info" aria-live="polite">
          {hovered ? (
            <>
              <b>{padName(t, hovered)}</b>
              <span>
                {modeText(t, hovered.mode)}
                {hovered.loop ? ` · ${t("Loop")}` : ""}
                {hovered.key ? ` · ${slotLabel(hovered.key, hovered.ctrl)}` : ""}
              </span>
            </>
          ) : (
            <span style={{ color: "var(--text-3)" }}>
              {t("Drag a key's sound onto another key to move it, or off the keyboard to remove it. Dashed keys are reserved.")}
            </span>
          )}
        </div>
      </section>

      {dragged && drag ? (
        <div className="df-drag-ghost" style={{ left: drag.x + 10, top: drag.y + 10 }}>
          <Icon name="music" size={12} />
          {padName(t, dragged)}
        </div>
      ) : null}
      {editing ? <PadDialog padId={editing} onClose={() => setEditing(null)} /> : null}
    </main>
  );
}

// ---------------- Sound settings ----------------

function PadDialog({ padId, onClose }: { padId: string; onClose: () => void }) {
  const t = useT();
  const all = useSettings((s) => s.settings.pads);
  const pad = all.find((x) => x.id === padId);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const patch = (changes: Partial<Pad>) => useSettings.getState().update({ pads: useSettings.getState().settings.pads.map((x) => (x.id === padId ? { ...x, ...changes } : x)) });

  // Key capture: the next key pressed (with or without Ctrl) becomes the key of the sound.
  useEffect(() => {
    if (!listening) return;
    usePads.setState({ capturing: true });
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || ["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight"].includes(e.code)) return;
      if (e.code === "Escape") {
        setListening(false);
        return;
      }
      const err = assignPad(padId, e.code, e.ctrlKey);
      setProblem(err);
      if (!err) setListening(false);
    };
    window.addEventListener("keydown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      usePads.setState({ capturing: false });
    };
  }, [listening, padId]);

  useEffect(() => {
    const id = window.setInterval(() => setLive(isPadPlaying(padId)), 150);
    return () => window.clearInterval(id);
  }, [padId]);

  if (!pad) return null;
  return (
    <Dialog
      title={padName(t, pad)}
      icon="music"
      width={560}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="sm"
            icon="trash"
            iconColor="var(--stop)"
            onClick={() => {
              useSettings.getState().update({ pads: useSettings.getState().settings.pads.filter((x) => x.id !== padId) });
              onClose();
            }}
          >
            {t("Remove sound")}
          </Button>
          <span className="ts-spacer" />
          <Button variant="primary" icon="check" onClick={onClose}>
            {t("Done")}
          </Button>
        </>
      }
    >
      <div className="df-set-row">
        <div style={{ flex: 1 }}>
          <div className="df-set-row__label">{t("Name")}</div>
        </div>
        <input className="ts-input" style={{ width: 280 }} value={pad.name ?? padName(t, pad)} onChange={(e) => patch({ name: e.currentTarget.value || null })} aria-label={t("Name")} />
      </div>
      <div className="df-set-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="df-set-row__label">{t("Sound")}</div>
          <div className="ts-field__hint ts-ellipsis">{pad.path ?? (pad.builtin ? t("Standard sound of Diaframma") : "—")}</div>
        </div>
        <Button
          variant="sm"
          icon="fileAdd"
          onClick={async () => {
            const [f] = await pickAudioFiles(t, false);
            if (f) patch({ path: f, builtin: null });
          }}
        >
          {t("Choose file…")}
        </Button>
        <Button variant="sm" icon={live ? "stopF" : "playF"} onClick={() => (live ? padUp({ ...pad, mode: "hold" }) : padDown({ ...pad, mode: "toEnd" }))}>
          {t("Try")}
        </Button>
      </div>
      <div className="df-set-row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="df-set-row__label">{t("Key")}</div>
          <div className="ts-field__hint">{t("Press the key you want, alone or with Ctrl. Space, Esc, Enter, P, the arrows and the number keys alone are reserved.")}</div>
          {problem ? <div style={{ marginTop: 6, fontSize: 12, color: "var(--stop)" }}>{t(problem)}</div> : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <button type="button" className={listening ? "df-keycap df-keycap--listening" : "df-keycap"} onClick={() => (setListening(!listening), setProblem(null))}>
            <Icon name="keyboard" size={14} />
            {listening ? t("Press the key…") : pad.key ? slotLabel(pad.key, pad.ctrl) : t("Choose key")}
          </button>
          {pad.key ? (
            <Button variant="sm" icon="x" onClick={() => assignPad(padId, null, false)}>
              {t("Take it off the keyboard")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="df-set-row">
        <div style={{ flex: 1 }}>
          <div className="df-set-row__label">{t("It plays")}</div>
        </div>
        <Segmented
          small
          ariaLabel={t("It plays")}
          value={pad.mode}
          onChange={(v: PadMode) => patch({ mode: v })}
          options={[
            { value: "hold", label: t("While held"), icon: "hand" },
            { value: "toEnd", label: t("To the end"), icon: "toEnd" },
            { value: "toggle", label: t("Press again to stop"), icon: "toggle" },
          ]}
        />
      </div>
      <div className="df-set-row">
        <div style={{ flex: 1 }}>
          <div className="df-set-row__label">{t("Loop")}</div>
          <div className="ts-field__hint">{t("Starts again when it ends (for alarms, rain, ringing…).")}</div>
        </div>
        <Switch checked={pad.loop} onChange={(v) => patch({ loop: v })} label={t("Loop")} />
      </div>
      <div className="df-set-row">
        <div style={{ flex: 1 }}>
          <div className="df-set-row__label">{t("Volume")}</div>
        </div>
        <NumberField
          className="mono"
          value={pad.volumeDb}
          text={`${pad.volumeDb > 0 ? "+" : ""}${pad.volumeDb.toFixed(1)} dB`}
          label={t("Volume")}
          min={-40}
          max={10}
          onCommit={(v) => patch({ volumeDb: Math.round(v * 2) / 2 })}
        />
        <Range label={t("Volume")} value={pad.volumeDb} min={-40} max={10} step={0.5} width={160} onChange={(v) => patch({ volumeDb: v })} />
      </div>
    </Dialog>
  );
}

/** "Put back the standard sounds" (keeps the user's own). */
export function restoreStandardPads() {
  const s = useSettings.getState().settings;
  const own = s.pads.filter((p) => !p.builtin);
  const std = defaultPads().map((d) => {
    const existing = s.pads.find((p) => p.id === d.id);
    return existing ?? d;
  });
  useSettings.getState().update({ pads: [...std, ...own] });
}

// Kept for other screens: the pad on a slot.
export { padAt };
