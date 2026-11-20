import { useEffect } from "react";
import { useT } from "@theatre-suite/core";
import { matchCommand, resolveKeymap, type CommandId } from "../model/keys";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import {
  runBack,
  runBlackout,
  runBlank,
  runEmergencyPress,
  runFadeToBlack,
  runGo,
  runPause,
  runPreset,
  runStopAudio,
  setReserved,
  toggleLock,
  useRun,
} from "./run";

/** The commands the Show listens to (13_cue.md, "Tasti"). */
export const SHOW_COMMANDS: readonly CommandId[] = ["go", "back", "pause", "preset", "blank", "blackout", "ftb", "emergency", "stopAudio", "reserve", "lock"];

export const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");

/**
 * The keys of the Show, from the keymap of the settings (Settings → Tasti can change them). Capture phase, so a
 * focused control never sees them. Nothing fires with a dialog open, or held down (auto-repeat); while typing only
 * the pedal (F13) counts. Lock leaves every show key working (they are what Lock is for), Ctrl L unlocks too.
 */
export function useShowKeys() {
  const t = useT();
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (useUi.getState().dialog) return;
      const typing = isTyping(e.target);
      const keymap = resolveKeymap(useSettings.getState().settings.keys);
      const m = matchCommand(e, keymap, SHOW_COMMANDS, typing);
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      switch (m.id) {
        case "go":
          return runGo(t);
        case "back":
          return runBack(t);
        case "pause":
          return runPause(t);
        case "preset":
          return runPreset(t);
        case "blank":
          return runBlank(t);
        case "blackout":
          return runBlackout(t);
        case "ftb":
          return runFadeToBlack(t);
        case "emergency":
          // A single-press binding (changed by the user) fires at once; the default E E needs two presses.
          if (m.binding.double) return runEmergencyPress(t);
          runEmergencyPress(t, Date.now());
          return runEmergencyPress(t, Date.now());
        case "stopAudio":
          return runStopAudio(t);
        case "reserve":
          return setReserved(true);
        case "lock":
          return toggleLock();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      // A focused button must not be "clicked" by the space bar after a GO (that would be a second action).
      if ((e.code === "Space" || e.key === " ") && !isTyping(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
      const keymap = resolveKeymap(useSettings.getState().settings.keys);
      if (keymap.reserve.some((b) => b.code === e.code)) setReserved(false);
    };
    const onBlur = () => setReserved(false);
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", onBlur);
      setReserved(false);
    };
  }, [t]);
}

/** Lock blocks the app's own shortcuts (other file, settings, undo, other mode); Ctrl S still saves. */
export function lockBlocks(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "code" | "key">): boolean {
  if (!useRun.getState().locked) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  return ["KeyO", "KeyN", "KeyZ", "KeyY", "Comma", "Digit1", "Digit2", "Digit3", "Digit4"].includes(e.code);
}
