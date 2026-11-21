import type { TFunc } from "@theatre-suite/core";
import type { ShowAction, ShowNotice } from "../../model/show";
import { useDesk } from "../../store/desk";
import { useSettings } from "../../store/settings";
import { useShow } from "../../store/show";
import { useUi, type Mode } from "../../store/ui";
import { exitBlindAsk, toggleBlind } from "../desk/actions";

/** What the Show buttons and keys do, with the messages for the operator (the store itself never talks). */

export function noticeText(t: TFunc, n: ShowNotice): string {
  switch (n) {
    case "emptySequence":
      return t("The sequence is empty: add memories with the Sequence button.");
    case "endOfSequence":
      return t("This is the last memory of the sequence: there is nothing after it.");
    case "firstMemory":
      return t("This is the first memory: there is nothing before it.");
    case "nothingToPause":
      return t("Nothing is changing now: there is no transition to pause.");
    case "inEmergency":
      return t("Emergency is on: press “Back to the show” first.");
    case "emergencyArmed":
      return t("Press E again within 3 seconds to turn on the emergency lights.");
    case "notInSequence":
      return t("That memory is not in the sequence.");
  }
}

/** Runs an action of the Show and tells the operator why nothing happened, when that is the case. */
export function showAction(t: TFunc, action: ShowAction): void {
  const n = useShow.getState().dispatch(action);
  if (n) useUi.getState().showToast(noticeText(t, n));
}

export const go = (t: TFunc) => showAction(t, { type: "go" });
export const back = (t: TFunc) => showAction(t, { type: "back" });
export const pause = (t: TFunc) => showAction(t, { type: "pause" });
export const blackout = (t: TFunc) => showAction(t, { type: "blackout" });
export const fadeToBlack = (t: TFunc) => showAction(t, { type: "ftb", seconds: useSettings.getState().settings.ftbSeconds });
export function emergency(t: TFunc) {
  showAction(t, { type: "emergency" });
  // Fired: the "press E again" message has done its job.
  if (useShow.getState().show.emergency) useUi.getState().clearToast();
}
export const leaveEmergency = (t: TFunc) => showAction(t, { type: "leaveEmergency" });

/** Says that Lock is on (for anything Lock blocks). Returns true when locked. */
export function lockedSays(t: TFunc): boolean {
  if (!useShow.getState().locked) return false;
  useUi.getState().showToast(t("Lock is on: hold the Lock button or press Ctrl L to unlock."));
  return true;
}

export function toggleLock() {
  const s = useShow.getState();
  s.setLocked(!s.locked);
}

/** Blind in the Show: on the memory ready for the next GO (or the one chosen in the list), blocked by Lock. */
export async function showBlind(t: TFunc): Promise<void> {
  if (lockedSays(t)) return;
  if (useDesk.getState().blind) return exitBlindAsk(t);
  const ready = useShow.getState().show.readyId;
  await toggleBlind(t, ready ?? undefined);
}

/**
 * Changes the mode of work (selector at the top, Ctrl 1–3). Refused while Lock or the emergency is on; Blind is left
 * first (asking to save), so the output is never left frozen and the faders always say what the lights do.
 */
export async function switchMode(t: TFunc, m: Mode): Promise<void> {
  const ui = useUi.getState();
  if (ui.mode === m) return;
  if (lockedSays(t)) return;
  if (useShow.getState().show.emergency) {
    ui.showToast(t("Emergency is on: press “Back to the show” first."));
    return;
  }
  if (useDesk.getState().blind) {
    await exitBlindAsk(t);
    if (useDesk.getState().blind) return;
  }
  useUi.getState().setMode(m);
}
