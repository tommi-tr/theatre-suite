import { create } from "zustand";
import { api, isTauri, onEvent, type EngineConfig, type EngineTrack } from "./api";
import { useSettings, type Pad } from "../state/settings";
import { useUi } from "../state/ui";
import { newTrack, type LiveState } from "../state/types";

/**
 * Launchpad: sounds fired with the keys of the keyboard (each key has two levels:
 * the key alone, and Ctrl + the key) or with the mouse. They play on their own
 * engine, on the Show output, on top of everything else. Space always stays GO.
 *
 * The keys work in Launchpad mode; with "Launchpad active" they work also in
 * Show and Rehearsal mode (only on the keys that do not clash with the app).
 */

interface PadsStore {
  live: LiveState | null;
  dir: string | null;
  /** Key capture in progress (the pad dialog is listening): pads do not fire. */
  capturing: boolean;
}

export const usePads = create<PadsStore>(() => ({ live: null, dir: null, capturing: false }));

/** Keys that must never fire a pad (they belong to the show or to Windows). */
export const FORBIDDEN_KEYS = new Set([
  "Space",
  "Escape",
  "Enter",
  "NumpadEnter",
  "Tab",
  "Backspace",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyP",
  "KeyM",
  "F1",
  "F4",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "ContextMenu",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "PrintScreen",
  "Pause",
]);

const DIGITS = new Set(["Digit0", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"]);

/** Ctrl + key that belong to Windows or to the web view: the Ctrl level of these keys is never available. */
export const SYSTEM_CTRL_KEYS = new Set(["KeyC", "KeyV", "KeyX", "KeyA", "KeyW", "KeyQ", "KeyR", "KeyT", "KeyF", "KeyH", "KeyU", "KeyI", "KeyG", "KeyB", "KeyD", "KeyE", "KeyJ", "KeyK", "KeyM"]);
/** Ctrl + key that are Diaframma's own shortcuts: free in Launchpad mode, the app wins in Show and Rehearsal mode. */
export const APP_CTRL_KEYS = new Set(["KeyS", "KeyO", "KeyN", "KeyL", "KeyZ", "KeyY", "Comma"]);

/** Why a key cannot hold a sound on this level (English key of the dictionary), or null if it is fine. */
export function slotProblem(key: string, ctrl: boolean): string | null {
  if (FORBIDDEN_KEYS.has(key)) return "This key is reserved (GO, Stop all, Pause all, markers, standby or Windows). Choose another one.";
  if (!ctrl && DIGITS.has(key)) return "The number keys alone choose the standby track. Use the numeric keypad, or Ctrl + number.";
  if (ctrl && SYSTEM_CTRL_KEYS.has(key)) return "Ctrl + this key belongs to Windows. Choose another one.";
  return null;
}

/** Ctrl level of a key the app also uses: it plays only in Launchpad mode. */
export function slotOnlyInLaunchpad(key: string, ctrl: boolean): boolean {
  return ctrl && APP_CTRL_KEYS.has(key);
}

/** The sound on a key level, if any. */
export function padAt(pads: Pad[], key: string, ctrl: boolean): Pad | null {
  return pads.find((p) => p.key === key && p.ctrl === ctrl) ?? null;
}

/**
 * Puts a sound on a key level (null = off the keyboard). A sound that is already
 * there goes to the place the first one leaves. Returns a problem (dictionary key) or null.
 */
export function assignPad(padId: string, key: string | null, ctrl: boolean): string | null {
  const pads = useSettings.getState().settings.pads;
  const me = pads.find((p) => p.id === padId);
  if (!me) return null;
  if (key) {
    const err = slotProblem(key, ctrl);
    if (err) return err;
  }
  const other = key ? pads.find((p) => p.id !== padId && p.key === key && p.ctrl === ctrl) : undefined;
  const prev = { key: me.key, ctrl: me.ctrl };
  useSettings.getState().update({
    pads: pads.map((p) => {
      if (p.id === padId) return { ...p, key, ctrl: key ? ctrl : false };
      if (other && p.id === other.id) return { ...p, key: prev.key, ctrl: prev.key ? prev.ctrl : false };
      return p;
    }),
  });
  return null;
}

/** "Numpad1" → "Num 1", "KeyL" → "L", "Digit3" → "3". */
export function keyLabel(code: string): string {
  if (code.startsWith("Numpad")) {
    const r = code.slice(6);
    const sym: Record<string, string> = { Add: "+", Subtract: "−", Multiply: "×", Divide: "÷", Decimal: "," };
    return `Num ${sym[r] ?? r}`;
  }
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/** "Ctrl + C", "Num 1". */
export function slotLabel(key: string, ctrl: boolean): string {
  return ctrl ? `Ctrl + ${keyLabel(key)}` : keyLabel(key);
}

export function padPath(p: Pad): string | null {
  if (p.path) return p.path;
  const dir = usePads.getState().dir;
  if (p.builtin && dir) return `${dir}${dir.includes("\\") ? "\\" : "/"}${p.builtin}.ogg`;
  return null;
}

const CONFIG: EngineConfig = { othersOnGo: "keep", autoAdvance: false, fadeInSec: 0, fadeOutSec: 0.3, crossfadeSec: 0, quickFadeSec: 0.3, stopAllSec: 0.4, steps: false };

/** The soft sound of "Test output" (Settings → Show). It is not a pad: it never shows on the keyboard. */
const OUTPUT_CHECK_ID = "__output-check__";

function engineTracks(pads: Pad[]): EngineTrack[] {
  const list: EngineTrack[] = pads.map((p) => {
    const { file: _f, ...rest } = newTrack(p.id);
    return { ...rest, path: padPath(p), exit: null, loopOn: p.loop, ignoreLoop: true, volumeDb: p.volumeDb };
  });
  const dir = usePads.getState().dir;
  const { file: _f, ...check } = newTrack(OUTPUT_CHECK_ID);
  list.push({ ...check, path: dir ? `${dir}${dir.includes("\\") ? "\\" : "/"}output-check.ogg` : null, exit: null, loopOn: false, ignoreLoop: true, volumeDb: 0 });
  return list;
}

/**
 * Plays a short, soft chime on the Show output: left, then right, then both.
 * Throws if the sound is not available (for example outside the app).
 */
export async function testOutput(): Promise<void> {
  if (!isTauri || !usePads.getState().dir) throw new Error("The test sound is not available here.");
  await api.padsSetDevice(useSettings.getState().settings.outputDevice).catch(() => {});
  await api.padsPlay(OUTPUT_CHECK_ID);
}

export function isPadPlaying(id: string): boolean {
  return !!usePads.getState().live?.voices.some((v) => v.trackId === id && v.fading !== "out");
}

export function padDown(p: Pad) {
  if (!padPath(p)) return;
  if (p.mode === "toggle" && isPadPlaying(p.id)) {
    api.padsStop(p.id, 0.15).catch(() => {});
    return;
  }
  api.padsSetDevice(useSettings.getState().settings.outputDevice).catch(() => {});
  api.padsPlay(p.id).catch(() => {});
}

export function padUp(p: Pad) {
  if (p.mode === "hold") api.padsStop(p.id, 0.06).catch(() => {});
}

/** Stop all: the show and the launchpad. */
export function stopEverything(immediate: boolean) {
  api.engineStopAll(immediate).catch(() => {});
  api.padsStopAll().catch(() => {});
}

// ---------------- Keys ----------------

/** Pads fired by the keys held now (to stop "hold" pads on release). */
const firedBy = new Map<string, Pad>();

function typing(el: EventTarget | null) {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable);
}

/** The pad this key press plays, if the launchpad is listening and the key is free. */
function matchPad(e: KeyboardEvent): Pad | null {
  const s = useSettings.getState().settings;
  const ui = useUi.getState();
  const inLaunchpad = ui.mode === "launchpad";
  if ((!inLaunchpad && !s.launchpadOn) || usePads.getState().capturing || ui.dialog) return null;
  if (e.altKey || e.metaKey || e.shiftKey) return null;
  const ctrl = e.ctrlKey;
  if (slotProblem(e.code, ctrl)) return null;
  if (!inLaunchpad && slotOnlyInLaunchpad(e.code, ctrl)) return null;
  const p = padAt(s.pads, e.code, ctrl);
  return p && padPath(p) ? p : null;
}

/** True if this key press belongs to the launchpad (the modes then ignore it). */
export function launchpadClaims(e: KeyboardEvent): boolean {
  if (typing(e.target)) return false;
  return matchPad(e) !== null;
}

let started = false;
export function startLaunchpad(): () => void {
  if (started || !isTauri) return () => {};
  started = true;
  const push = () => {
    const s = useSettings.getState().settings;
    api.padsSync(engineTracks(s.pads), CONFIG).catch(() => {});
  };
  api
    .builtinSoundsDir()
    .then((dir) => {
      usePads.setState({ dir });
      push();
    })
    .catch(() => push());
  let prev = useSettings.getState().settings;
  const un1 = useSettings.subscribe((st) => {
    if (st.settings.pads !== prev.pads) push();
    prev = st.settings;
  });
  const un2 = onEvent<LiveState>("pads-state", (live) => usePads.setState({ live }));

  const onDown = (e: KeyboardEvent) => {
    if (typing(e.target)) return;
    const p = matchPad(e);
    if (e.repeat) {
      if (p) e.preventDefault();
      return;
    }
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    firedBy.set(e.code, p);
    padDown(p);
  };
  const onUp = (e: KeyboardEvent) => {
    const p = firedBy.get(e.code);
    if (p) {
      firedBy.delete(e.code);
      padUp(p);
    }
  };
  const onBlur = () => {
    for (const p of firedBy.values()) padUp(p);
    firedBy.clear();
  };
  window.addEventListener("keydown", onDown, true);
  window.addEventListener("keyup", onUp, true);
  window.addEventListener("blur", onBlur);
  return () => {
    un1();
    un2.then((f) => f());
    window.removeEventListener("keydown", onDown, true);
    window.removeEventListener("keyup", onUp, true);
    window.removeEventListener("blur", onBlur);
    started = false;
  };
}
