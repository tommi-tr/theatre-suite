import { create } from "zustand";
import { api, isTauri, onEvent, type EngineConfig, type EngineTrack } from "./api";
import { useSettings, type Pad } from "../state/settings";
import { newTrack, type LiveState } from "../state/types";

/**
 * Launchpad: sounds fired with keys chosen by the user (or with the mouse),
 * in Show and Rehearsal mode. They play on their own engine, on the Show
 * output, on top of everything else. Space always stays GO.
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
  "F1",
  "F4",
  "ControlLeft",
  "ControlRight",
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

/** Why a combination cannot be used (English key of the dictionary), or null if it is fine. */
export function comboProblem(keys: string[], pads: Pad[], selfId: string | null): string | null {
  if (!keys.length) return null;
  if (keys.some((k) => FORBIDDEN_KEYS.has(k))) return "This key is reserved (GO, Stop all, Pause all, standby or Windows). Choose another one.";
  if (keys.length === 1 && DIGITS.has(keys[0])) return "The number keys alone choose the standby track. Use the numeric keypad, or a key + number.";
  const same = pads.find((p) => p.id !== selfId && p.keys.length === keys.length && p.keys.every((k) => keys.includes(k)));
  if (same) return "Another sound already uses these keys.";
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
  const map: Record<string, string> = {
    ShiftLeft: "Shift",
    ShiftRight: "Shift",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
    Backslash: "\\",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Insert: "Ins",
    Delete: "Del",
    PageUp: "PgUp",
    PageDown: "PgDn",
  };
  return map[code] ?? code;
}

export function comboLabel(keys: string[]): string {
  return keys.map(keyLabel).join(" + ");
}

/** Suggestions offered when choosing keys: the first free combination of each family. */
export function suggestions(pads: Pad[], selfId: string | null): { label: string; keys: string[] }[] {
  const free = (keys: string[]) => comboProblem(keys, pads, selfId) === null;
  const families: { label: string; list: string[][] }[] = [
    { label: "Numeric keypad", list: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "Add", "Subtract", "Multiply", "Divide", "Decimal"].map((k) => [`Numpad${k}`]) },
    { label: "L + number", list: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((k) => ["KeyL", `Digit${k}`]) },
    { label: "Letters", list: ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "A", "S", "D", "F", "G", "H", "J", "K", "Z", "X", "C", "V", "B", "N", "M"].map((k) => [`Key${k}`]) },
    { label: "Shift + letter", list: ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "A", "S", "D", "F", "G", "H", "J", "K"].map((k) => ["ShiftLeft", `Key${k}`]) },
  ];
  return families
    .map((f) => {
      const k = f.list.find(free);
      return k ? { label: f.label, keys: k } : null;
    })
    .filter((x): x is { label: string; keys: string[] } => x !== null);
}

export function padPath(p: Pad): string | null {
  if (p.path) return p.path;
  const dir = usePads.getState().dir;
  if (p.builtin && dir) return `${dir}${dir.includes("\\") ? "\\" : "/"}${p.builtin}.ogg`;
  return null;
}

const CONFIG: EngineConfig = { othersOnGo: "keep", autoAdvance: false, fadeInSec: 0, fadeOutSec: 0.3, crossfadeSec: 0, stopAllSec: 0.4, steps: false };

function engineTracks(pads: Pad[]): EngineTrack[] {
  return pads.map((p) => {
    const { file: _f, ...rest } = newTrack(p.id);
    return { ...rest, path: padPath(p), atEnd: p.loop ? "loopAll" : "stop", volumeDb: p.volumeDb };
  });
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

const held = new Set<string>();
/** Pads fired by the keys held now (to stop "hold" pads on release). */
const firedBy = new Map<string, Pad>();

function matchPad(e: KeyboardEvent): Pad | null {
  const s = useSettings.getState().settings;
  if (!s.launchpadOn || usePads.getState().capturing) return null;
  const keys = new Set(held);
  keys.add(e.code);
  return s.pads.find((p) => p.keys.length > 0 && p.keys.length === keys.size && p.keys.every((k) => keys.has(k)) && p.keys.includes(e.code)) ?? null;
}

function typing(el: EventTarget | null) {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable);
}

/**
 * True if this key press belongs to the launchpad (the modes then ignore it).
 * A key that starts a combination of two keys (L in "L + 1") is not claimed alone.
 */
export function launchpadClaims(e: KeyboardEvent): boolean {
  if (typing(e.target) || e.ctrlKey || e.altKey || e.metaKey) return false;
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
    if (st.settings.launchpadOn !== prev.launchpadOn && !st.settings.launchpadOn) {
      held.clear();
      firedBy.clear();
    }
    prev = st.settings;
  });
  const un2 = onEvent<LiveState>("pads-state", (live) => usePads.setState({ live }));

  const onDown = (e: KeyboardEvent) => {
    if (typing(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.repeat) {
      if (matchPad(e)) e.preventDefault();
      return;
    }
    const p = matchPad(e);
    held.add(e.code);
    if (!p) return;
    e.preventDefault();
    firedBy.set(e.code, p);
    padDown(p);
  };
  const onUp = (e: KeyboardEvent) => {
    held.delete(e.code);
    for (const [code, p] of [...firedBy]) {
      if (code === e.code || p.keys.includes(e.code)) {
        firedBy.delete(code);
        padUp(p);
      }
    }
  };
  const onBlur = () => {
    held.clear();
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
