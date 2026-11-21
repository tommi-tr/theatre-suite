import { chordFromEvent, keyActionInfo, matchAction, PEDAL_CHORD, type KeyAction, type Keymap } from "../model/keys";

/**
 * The Show's reading of a key press, pure (tested): the chord of the press through the keymap of the settings
 * (model/keys.ts). Only Show actions (the script's keys stay with the script view). While typing in a field only the
 * pedal (F13) counts: it gives the GO even with the chat open.
 */
export function showKeyAction(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, keymap: Keymap, typing: boolean): KeyAction | null {
  const chord = chordFromEvent(e);
  if (!chord) return null;
  if (typing) return chord === PEDAL_CHORD ? "go" : null;
  const a = matchAction(keymap, chord, "show");
  return a && keyActionInfo(a).group === "show" ? a : null;
}

/** Two presses of Emergenza within this time fire it (E E, within 1 s). */
export const DOUBLE_PRESS_MS = 1000;

/**
 * A press of a double key: fires when the previous press was within `windowMs` (and not in the future: a clock
 * that went back arms again). Returns the new "armed at" (null after firing).
 */
export function doublePress(armedAt: number | null, now: number, windowMs = DOUBLE_PRESS_MS): { fire: boolean; armedAt: number | null } {
  if (armedAt !== null && now >= armedAt && now - armedAt <= windowMs) return { fire: true, armedAt: null };
  return { fire: false, armedAt: now };
}

/** The keys of an action as one string for a key cap ("E E", "Ctrl+L" → "Ctrl L"); "" when it has none. */
export function actionKeyText(keymap: Keymap, id: KeyAction, space = "Space"): string {
  const c = keymap[id]?.[0];
  if (!c) return "";
  const parts = c.split(/\+(?=.)/).map((p) => (p === "Space" ? space : p === "Escape" ? "Esc" : p));
  return keyActionInfo(id).double ? [...parts, ...parts].join(" ") : parts.join(" ");
}
