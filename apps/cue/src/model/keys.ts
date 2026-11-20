/**
 * The keys of Cue (13_cue.md, "Tasti"): one **keymap** (command → keys) that the Show, Prepara and the key editor of
 * Settings → Tasti all read, so a key changed there changes everywhere. Pure, no React.
 *
 * - A binding is a physical key (`KeyboardEvent.code`, so it does not depend on the keyboard layout) with the exact
 *   modifiers: Ctrl L is Ctrl + L only (Ctrl Shift L is "back to the launcher" in the suite).
 * - `double`: the key must be pressed twice within `DOUBLE_PRESS_MS` (Emergenza, E E).
 * - `held` commands act while the key is down (Prenota, C).
 * - While typing in a field nothing matches, except the **pedal** keys (F13–F24): a pedal that sends F13 gives the
 *   GO even with the chat open.
 * - Fixed keys (scrolling, zoom, peek, the app shortcuts Ctrl S, Ctrl O…) cannot be taken by a command:
 *   `keymapConflicts` reports them with the clashes between commands.
 */

export type KeyGroup = "show" | "script" | "prepare";

/** The commands whose keys can be changed. */
export type CommandId = "go" | "back" | "pause" | "preset" | "blank" | "blackout" | "ftb" | "emergency" | "stopAudio" | "reserve" | "lock" | "newGo" | "note";

export const COMMAND_IDS: readonly CommandId[] = ["go", "back", "pause", "preset", "blank", "blackout", "ftb", "emergency", "stopAudio", "reserve", "lock", "newGo", "note"];

export interface KeyBinding {
  /** `KeyboardEvent.code`: "Space", "KeyP", "F13", "Backspace", "Escape", "Digit1"… */
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Pressed twice within `DOUBLE_PRESS_MS`. */
  double?: boolean;
}

export type Keymap = Record<CommandId, KeyBinding[]>;

/** Two presses of a `double` binding within this time fire the command (E E: within 1 s). */
export const DOUBLE_PRESS_MS = 1000;

export const DEFAULT_KEYMAP: Keymap = {
  go: [{ code: "Space" }, { code: "F13" }],
  back: [{ code: "Backspace" }],
  pause: [{ code: "KeyP" }],
  preset: [{ code: "KeyQ" }],
  blank: [{ code: "KeyT" }],
  blackout: [{ code: "KeyB" }],
  ftb: [{ code: "KeyF" }],
  emergency: [{ code: "KeyE", double: true }],
  stopAudio: [{ code: "Escape" }],
  reserve: [{ code: "KeyC" }],
  lock: [{ code: "KeyL", ctrl: true }],
  newGo: [{ code: "KeyN" }],
  note: [{ code: "KeyK" }],
};

export interface CommandInfo {
  id: CommandId;
  group: KeyGroup;
  /** English key of the dictionary. */
  label: string;
  /** Acts while held down. */
  held?: boolean;
  /** Red in the interface (Emergenza). */
  danger?: boolean;
}

export const COMMANDS: readonly CommandInfo[] = [
  { id: "go", group: "show", label: "GO" },
  { id: "back", group: "show", label: "Back (previous GO)" },
  { id: "pause", group: "show", label: "Pause" },
  { id: "preset", group: "show", label: "Preset (house lights)" },
  { id: "blank", group: "show", label: "Blank image" },
  { id: "blackout", group: "show", label: "Blackout" },
  { id: "ftb", group: "show", label: "Fade to black" },
  { id: "emergency", group: "show", label: "Emergency", danger: true },
  { id: "stopAudio", group: "show", label: "Stop audio" },
  { id: "reserve", group: "show", label: "Reserve the GO", held: true },
  { id: "lock", group: "show", label: "Lock" },
  { id: "newGo", group: "prepare", label: "New GO here" },
  { id: "note", group: "prepare", label: "Note" },
];

/** Keys that belong to the script or to the app and cannot be given to a command. */
export interface FixedKey {
  id: string;
  /** English key of the dictionary. */
  label: string;
  /** Where it works: the script keys in Show and Prepara, the app shortcuts everywhere. */
  group: KeyGroup | "app";
  bindings: KeyBinding[];
}

export const FIXED_KEYS: readonly FixedKey[] = [
  { id: "peek", label: "Peek at the script", group: "script", bindings: [{ code: "ControlLeft" }, { code: "ControlRight" }] },
  { id: "scroll", label: "Scroll the script", group: "script", bindings: ["ArrowUp", "ArrowDown", "KeyW", "KeyS", "PageUp", "PageDown"].map((code) => ({ code })) },
  { id: "zoom", label: "Zoom or change page", group: "script", bindings: ["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].map((code) => ({ code })) },
  {
    id: "app",
    label: "Shortcuts of the app",
    group: "app",
    bindings: [
      ...["KeyS", "KeyO", "KeyN", "KeyZ", "KeyY", "Comma", "Digit1", "Digit2", "Digit3", "Digit4"].map((code) => ({ code, ctrl: true })),
      { code: "KeyS", ctrl: true, shift: true },
      { code: "KeyZ", ctrl: true, shift: true },
      { code: "KeyL", ctrl: true, shift: true },
      { code: "F5" },
    ],
  },
];

/** Where each group of keys works. */
const GROUP_MODES: Record<KeyGroup | "app", ("show" | "prepare")[]> = { show: ["show"], prepare: ["prepare"], script: ["show", "prepare"], app: ["show", "prepare"] };

/* ------------------------------------------------------------------ */
/* Keymap                                                               */
/* ------------------------------------------------------------------ */

const CODE_RE = /^[A-Za-z0-9]{1,24}$/;

function cleanBinding(v: unknown): KeyBinding | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.code !== "string" || !CODE_RE.test(o.code)) return null;
  const b: KeyBinding = { code: o.code };
  if (o.ctrl === true) b.ctrl = true;
  if (o.shift === true) b.shift = true;
  if (o.alt === true) b.alt = true;
  if (o.double === true) b.double = true;
  return b;
}

/** The keys changed by the user (settings), cleaned: unknown commands and broken bindings are dropped. */
export function normalizeKeymap(raw: unknown): Partial<Keymap> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Keymap> = {};
  for (const id of COMMAND_IDS) {
    const v = (raw as Record<string, unknown>)[id];
    if (!Array.isArray(v)) continue;
    out[id] = v.map(cleanBinding).filter((b): b is KeyBinding => !!b).slice(0, 4);
  }
  return out;
}

/** The keymap in force: the defaults with the user's changes on top (an empty list = no key). */
export function resolveKeymap(user: Partial<Keymap> | undefined): Keymap {
  return { ...DEFAULT_KEYMAP, ...(user ?? {}) };
}

export const sameBinding = (a: KeyBinding, b: KeyBinding): boolean => a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt;

/** A pedal key (F13–F24): accepted even while typing. */
export const isPedalCode = (code: string): boolean => /^F(1[3-9]|2[0-4])$/.test(code);

export interface Conflict {
  /** The binding both use. */
  binding: KeyBinding;
  /** The two users: command ids or fixed key ids. */
  a: string;
  b: string;
}

const modesOf = (id: string): ("show" | "prepare")[] => {
  const c = COMMANDS.find((x) => x.id === id);
  if (c) return GROUP_MODES[c.group];
  const f = FIXED_KEYS.find((x) => x.id === id);
  return f ? GROUP_MODES[f.group] : [];
};

/**
 * Clashes in a keymap: two commands (or a command and a fixed key) on the same key and modifiers in a mode where both
 * work. A `double` binding clashes with a single press of the same key (the first press would do the other thing).
 */
export function keymapConflicts(keymap: Keymap): Conflict[] {
  const all: { id: string; b: KeyBinding }[] = [];
  for (const id of COMMAND_IDS) for (const b of keymap[id] ?? []) all.push({ id, b });
  for (const f of FIXED_KEYS) for (const b of f.bindings) all.push({ id: f.id, b });
  const out: Conflict[] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const x = all[i];
      const y = all[j];
      if (x.id === y.id || !sameBinding(x.b, y.b)) continue;
      // Ctrl held alone (peek) never clashes with Ctrl + a letter: they are different bindings already.
      const mx = modesOf(x.id);
      if (!modesOf(y.id).some((m) => mx.includes(m))) continue;
      out.push({ binding: x.b, a: x.id, b: y.id });
    }
  return out;
}

/** The conflicts a new binding for `id` would make (for the key editor, before saving it). */
export function conflictsOf(keymap: Keymap, id: CommandId, binding: KeyBinding): Conflict[] {
  const trial: Keymap = { ...keymap, [id]: [...(keymap[id] ?? []).filter((b) => !sameBinding(b, binding)), binding] };
  return keymapConflicts(trial).filter((c) => c.a === id || c.b === id);
}

/* ------------------------------------------------------------------ */
/* Matching key presses                                                 */
/* ------------------------------------------------------------------ */

/** What matching needs of a KeyboardEvent. */
export interface KeyPress {
  code: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** The code of a press (some keyboards leave `code` empty for the space bar). */
const codeOf = (e: KeyPress): string => e.code || (e.key === " " ? "Space" : e.key === "Escape" ? "Escape" : e.key === "Backspace" ? "Backspace" : "");

export function pressMatches(e: KeyPress, b: KeyBinding): boolean {
  if (codeOf(e) !== b.code) return false;
  return (e.ctrlKey || e.metaKey) === !!b.ctrl && e.shiftKey === !!b.shift && e.altKey === !!b.alt;
}

/**
 * The command of a key press among `ids` (the commands of the mode), or null. `typing` = the focus is in a text
 * field: only pedal keys count then.
 */
export function matchCommand(e: KeyPress, keymap: Keymap, ids: readonly CommandId[], typing = false): { id: CommandId; binding: KeyBinding } | null {
  for (const id of ids)
    for (const b of keymap[id] ?? [])
      if (pressMatches(e, b) && (!typing || isPedalCode(b.code))) return { id, binding: b };
  return null;
}

/**
 * A press of a `double` binding: fires when the previous press was within `windowMs` (and not in the future: a
 * clock that went back arms again). Returns the new "armed at" (null after firing).
 */
export function doublePress(armedAt: number | null, now: number, windowMs = DOUBLE_PRESS_MS): { fire: boolean; armedAt: number | null } {
  if (armedAt !== null && now >= armedAt && now - armedAt <= windowMs) return { fire: true, armedAt: null };
  return { fire: false, armedAt: now };
}

/* ------------------------------------------------------------------ */
/* Showing keys                                                         */
/* ------------------------------------------------------------------ */

const NAMES: Record<string, string> = {
  Space: "Space",
  Backspace: "Backspace",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: "PgUp",
  PageDown: "PgDn",
  ControlLeft: "Ctrl",
  ControlRight: "Ctrl",
  Comma: ",",
  Period: ".",
  Minus: "-",
  Equal: "=",
  Delete: "Canc",
  Insert: "Ins",
  Home: "Home",
  End: "End",
};

/** The key as written on the keyboard: "KeyP" → "P", "Digit1" → "1", "Escape" → "Esc". */
export function codeLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  return NAMES[code] ?? code;
}

/** The caps of a binding: ["Ctrl", "L"], ["E", "E"], ["Space"]. */
export function bindingCaps(b: KeyBinding): string[] {
  const k = codeLabel(b.code);
  return [...(b.ctrl ? ["Ctrl"] : []), ...(b.alt ? ["Alt"] : []), ...(b.shift ? ["Shift"] : []), k, ...(b.double ? [k] : [])];
}

/** The first binding of a command as one string for a key cap ("E E", "Ctrl L"); "" when it has no key. */
export function commandKeyText(keymap: Keymap, id: CommandId): string {
  const b = keymap[id]?.[0];
  return b ? bindingCaps(b).join(" ") : "";
}

/* ------------------------------------------------------------------ */
/* The list of Settings → Tasti                                          */
/* ------------------------------------------------------------------ */

export interface KeyInfo {
  id: string;
  group: KeyGroup;
  label: string;
  /** Keys as written on the keyboard: several = alternatives, each a list of caps. */
  keys: string[][];
  held?: boolean;
  danger?: boolean;
  /** A fixed key (cannot be changed). */
  fixed?: boolean;
}

/** Every key of Cue for the list in the Settings (commands of `keymap`, then the script's fixed keys). */
export function keyList(keymap: Keymap = DEFAULT_KEYMAP): KeyInfo[] {
  const commands: KeyInfo[] = COMMANDS.map((c) => ({ id: c.id, group: c.group, label: c.label, keys: (keymap[c.id] ?? []).map(bindingCaps), held: c.held, danger: c.danger }));
  const script: KeyInfo[] = [
    { id: "peek", group: "script", label: "Peek at the script", keys: [["Ctrl"]], held: true, fixed: true },
    { id: "scroll", group: "script", label: "Scroll the script", keys: [["↑", "↓"], ["W", "S"]], fixed: true },
    { id: "zoom", group: "script", label: "Zoom or change page", keys: [["←", "→"], ["A", "D"]], fixed: true },
  ];
  // Script keys between the show and the prepare ones, as before.
  return [...commands.filter((k) => k.group === "show"), ...script, ...commands.filter((k) => k.group === "prepare")];
}

/** The default list (Settings → Tasti before the key editor). */
export const KEYS: KeyInfo[] = keyList();
