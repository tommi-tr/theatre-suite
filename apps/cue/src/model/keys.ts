/**
 * The keys of Cue (13_cue.md, "Tasti"). Pure, no React.
 *
 * - A **chord** is a string: modifiers in the order `Ctrl`, `Alt`, `Shift`, then the key, joined with `+`:
 *   `"Space"`, `"P"`, `"Ctrl+L"`, `"Escape"`, `"ArrowUp"`, `"F13"`. Letters are upper case, the space bar is `"Space"`;
 *   other keys keep the name of `KeyboardEvent.key`. `chordFromEvent` makes one from a key press.
 * - A **keymap** gives every action a list of alternative chords (`DEFAULT_KEYMAP`). It is stored in the computer's
 *   settings (`settings.keymap`, store/settings.ts) and read by whoever handles the keys (`matchAction`).
 * - **F13 is always GO** (the foot pedal types it): it is not in the keymap and cannot be given to another action.
 * - `emergency` is pressed twice (`double`): its chord is the key, the double press is the runner's business
 *   (`emergencyPress` of model/playback.ts). `reserve` works while the key is held (`held`).
 * - **Conflicts**: two actions may not share a chord when they can be used at the same time (`scopes`): the Show keys
 *   and the script keys are both live in Show, the Prepara keys and the script keys in Prepara; a Show key and a
 *   Prepara key never meet, so they may share a key.
 */

export type KeyGroup = "show" | "script" | "prepare";
/** The screens where keys of a group work (Show, Prepara). */
export type KeyScope = "show" | "prepare";

export type KeyAction =
  | "go"
  | "back"
  | "pause"
  | "preset"
  | "blank"
  | "blackout"
  | "fadeToBlack"
  | "emergency"
  | "stopAudio"
  | "reserve"
  | "lock"
  | "newGo"
  | "note"
  | "zoomIn"
  | "zoomOut"
  | "scrollUp"
  | "scrollDown";

export interface KeyActionInfo {
  id: KeyAction;
  group: KeyGroup;
  /** English text of the dictionary. */
  label: string;
  /** Works while the key is held down (Prenota). */
  held?: boolean;
  /** Pressed twice (Emergenza). */
  double?: boolean;
  /** Red in the interface (Emergenza). */
  danger?: boolean;
}

/** Every action, in the order of Settings → Tasti. */
export const KEY_ACTIONS: readonly KeyActionInfo[] = [
  { id: "go", group: "show", label: "GO" },
  { id: "back", group: "show", label: "Back (previous GO)" },
  { id: "pause", group: "show", label: "Pause" },
  { id: "preset", group: "show", label: "Preset (house lights)" },
  { id: "blank", group: "show", label: "Blank image" },
  { id: "blackout", group: "show", label: "Blackout" },
  { id: "fadeToBlack", group: "show", label: "Fade to black" },
  { id: "emergency", group: "show", label: "Emergency", double: true, danger: true },
  { id: "stopAudio", group: "show", label: "Stop audio" },
  { id: "reserve", group: "show", label: "Reserve the GO", held: true },
  { id: "lock", group: "show", label: "Lock" },
  { id: "scrollUp", group: "script", label: "Scroll up" },
  { id: "scrollDown", group: "script", label: "Scroll down" },
  { id: "zoomIn", group: "script", label: "Zoom in (or next page)" },
  { id: "zoomOut", group: "script", label: "Zoom out (or previous page)" },
  { id: "newGo", group: "prepare", label: "New GO here" },
  { id: "note", group: "prepare", label: "Note" },
];

const INFO = new Map<KeyAction, KeyActionInfo>(KEY_ACTIONS.map((a) => [a.id, a]));
export const keyActionInfo = (id: KeyAction): KeyActionInfo => INFO.get(id)!;

/** The screens where an action works. */
export function scopesOf(id: KeyAction): KeyScope[] {
  const g = keyActionInfo(id).group;
  return g === "show" ? ["show"] : g === "prepare" ? ["prepare"] : ["show", "prepare"];
}

/** What every action is called when the keys are changed: alternatives, in order of preference. */
export type Keymap = Record<KeyAction, string[]>;

/** The pedal: always GO, in every keymap. */
export const PEDAL_CHORD = "F13";
/** Ctrl held alone is the peek at the script (not a key of the keymap, not changeable). */
export const PEEK_KEY = "Ctrl";

export const DEFAULT_KEYMAP: Keymap = {
  go: ["Space"],
  back: ["Backspace"],
  pause: ["P"],
  preset: ["Q"],
  blank: ["T"],
  blackout: ["B"],
  fadeToBlack: ["F"],
  emergency: ["E"],
  stopAudio: ["Escape"],
  reserve: ["C"],
  lock: ["Ctrl+L"],
  newGo: ["N"],
  note: ["K"],
  zoomIn: ["ArrowRight", "D"],
  zoomOut: ["ArrowLeft", "A"],
  scrollUp: ["ArrowUp", "W"],
  scrollDown: ["ArrowDown", "S"],
};

export const cloneKeymap = (k: Keymap): Keymap => Object.fromEntries(Object.entries(k).map(([id, v]) => [id, [...v]])) as Keymap;

/** Chords the app keeps for itself (save, open, undo, settings, modes): not for the keymap. */
const RESERVED = new Set(["Ctrl+S", "Ctrl+Shift+S", "Ctrl+O", "Ctrl+N", "Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z", "Ctrl+,", "Ctrl+1", "Ctrl+2", "Ctrl+3", "Ctrl+4"]);

/** True for a chord Cue itself uses (and F13): it cannot be given to an action. */
export const isReservedChord = (chord: string): boolean => RESERVED.has(chord) || chord === PEDAL_CHORD;

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "OS", "CapsLock", "NumLock", "ScrollLock", "Dead", "Unidentified"]);

/** The chord of a key press (null: only a modifier, or a key that cannot be used). */
export function chordFromEvent(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  let key = e.key === " " ? "Space" : e.key === "Esc" ? "Escape" : e.key;
  if (key.length === 1) key = key.toUpperCase();
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  // Shift changes a letter ("p" → "P") and a symbol: it counts only for letters, digits and named keys.
  if (e.shiftKey && (key.length > 1 || /[A-Z0-9]/.test(key))) mods.push("Shift");
  return [...mods, key].join("+");
}

/** True when `s` has the shape of a chord (for settings read from disk). */
export function isChord(s: unknown): s is string {
  return typeof s === "string" && /^((Ctrl|Alt|Shift)\+){0,3}[^+\s]+$|^((Ctrl|Alt|Shift)\+){0,3}\+$/.test(s) && s.length <= 24;
}

/** Settings read from disk: every action present, nothing unknown, bad values replaced by the default. */
export function normalizeKeymap(raw: unknown): Keymap {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = cloneKeymap(DEFAULT_KEYMAP);
  for (const a of KEY_ACTIONS) {
    const v = r[a.id];
    if (!Array.isArray(v)) continue;
    const chords = [...new Set(v.filter(isChord))].slice(0, 4);
    // A list that was emptied on purpose stays empty, except for GO (F13 still works, but Space is the safe default).
    if (chords.length === 0 && v.length > 0) continue;
    if (chords.length === 0 && a.id === "go") continue;
    if (chords.some(isReservedChord)) continue;
    out[a.id] = chords;
  }
  return out;
}

export const sameKeymap = (a: Keymap, b: Keymap): boolean => KEY_ACTIONS.every((k) => a[k.id].length === b[k.id].length && a[k.id].every((c, i) => c === b[k.id][i]));

/** Two actions that share a chord while both can be used at once; `other` = null for a chord reserved by the app. */
export interface KeyConflict {
  action: KeyAction;
  chord: string;
  /** The other action. */
  other: KeyAction | null;
}

const overlap = (a: KeyScope[], b: KeyScope[]) => a.some((s) => b.includes(s));

/** Every conflict of the keymap: one entry per action and chord involved (both sides are listed). */
export function findConflicts(map: Keymap): KeyConflict[] {
  const out: KeyConflict[] = [];
  for (const a of KEY_ACTIONS) {
    for (const chord of map[a.id]) {
      if (isReservedChord(chord)) {
        out.push({ action: a.id, chord, other: null });
        continue;
      }
      for (const b of KEY_ACTIONS) {
        if (b.id === a.id || !map[b.id].includes(chord) || !overlap(scopesOf(a.id), scopesOf(b.id))) continue;
        out.push({ action: a.id, chord, other: b.id });
      }
    }
  }
  return out;
}

/** True when the keymap can be saved. */
export const keymapIsValid = (map: Keymap): boolean => findConflicts(map).length === 0;

/**
 * The action a chord does on a screen (null: none). F13 is GO anywhere. When a keymap has a conflict (it should
 * not be saved so), the first action in the order of `KEY_ACTIONS` wins.
 */
export function matchAction(map: Keymap, chord: string, scope: KeyScope): KeyAction | null {
  if (chord === PEDAL_CHORD) return "go";
  for (const a of KEY_ACTIONS) if (scopesOf(a.id).includes(scope) && map[a.id].includes(chord)) return a.id;
  return null;
}

/** The key as written on a key cap ("Escape" → "Esc", "ArrowUp" → "↑"). `space` is the translated word. */
export function chordParts(chord: string, space = "Space"): string[] {
  return chord.split(/\+(?=.)/).map((p) => (p === "Space" ? space : p === "Escape" ? "Esc" : p === "ArrowUp" ? "↑" : p === "ArrowDown" ? "↓" : p === "ArrowLeft" ? "←" : p === "ArrowRight" ? "→" : p));
}
