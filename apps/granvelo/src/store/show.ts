import { create } from "zustand";
import { transitionDuration } from "../model/crossfade";
import { deskUniverse } from "../model/desk";
import type { FadePayload } from "../lib/dmx";
import { fadePayload, intensityMask, memoryFadePayload } from "../model/enginePayload";
import { stateUniverse } from "../model/memories";
import { sequenceMemories } from "../model/sequence";
import { initialShow, showReduce, type ShowAction, type ShowEffect, type ShowNotice, type ShowState } from "../model/show";
import { emergencyValues, patchValues } from "../model/universe";
import { DMX_MAX, type FixtureValues, type GranveloDoc } from "../model/types";
import { useDesk } from "./desk";
import { useDoc } from "./doc";
import { useOutput } from "./output";

/**
 * The Show of the evening: the pure state machine of `model/show.ts` plus the clock and the execution of its effects
 * through `store/output.ts` (the only door to the lights). The interface calls `dispatch`; nothing here asks questions
 * or draws anything.
 *
 * - **Clock**: a timer (`TICK_MS`) runs while a transition or the first press of Emergenza is pending, for "parte da
 *   sola" and to disarm E. A fade sent to the engine finishes in the engine even if this timer stops.
 * - **Desk**: every memory called (GO, Indietro, parte da sola) is handed to the desk (`followShow`), so the faders —
 *   in Show and in Banco — start from what is on stage.
 * - **Emergency**: all white at full (or the emergency memory of the Settings, as saved: groups and Grand Master do
 *   not dim it), Blackout and Fade to black released at once, Grand Master at full; meanwhile the desk is not active
 *   (it sends nothing, whatever changes). Leaving it brings the stage back to
 *   the desk (the memory on air, with any change made on the faders) in the default crossfade, the Grand Master of the
 *   desk, and Blackout / Fade to black as they were.
 * - **Lock** (`locked`): checked by the interface; this store never refuses an action because of it.
 */

export const TICK_MS = 100;

interface ShowStore {
  show: ShowState;
  locked: boolean;
  /** Runs an action now; returns the notice for the operator, if any. */
  dispatch: (action: ShowAction) => ShowNotice | undefined;
  setLocked: (locked: boolean) => void;
}

const report = (e: unknown) => console.error("[show]", e);
const run = (p: Promise<unknown> | undefined) => void p?.catch?.(report);

function context(doc: GranveloDoc | null, now: number) {
  const emergencyMemoryId = doc?.settings.emergencyMemoryId ?? null;
  return {
    now,
    sequence: doc ? sequenceMemories(doc) : [],
    emergencyMemoryId: emergencyMemoryId && doc?.memories.some((m) => m.id === emergencyMemoryId) ? emergencyMemoryId : null,
  };
}

/** The 512 values of the emergency: the chosen memory as saved, or every used light white at full. */
export function emergencyUniverse(doc: GranveloDoc, memoryId: string | null, current: FixtureValues = {}): Uint8Array {
  const m = memoryId ? doc.memories.find((x) => x.id === memoryId) : undefined;
  if (m) return stateUniverse(doc, m.state);
  // Positions, gobos… stay where the desk has them: moving heads do not swing around.
  return patchValues(doc, emergencyValues(doc, current));
}

/**
 * Sends a transition and says at once that it is running: the engine reports it only at its next progress (≤ 10 a
 * second), and until then a fader moved on the desk would otherwise cut it (`store/desk.ts`, `push`).
 */
function sendFade(payload: FadePayload) {
  const out = useOutput.getState();
  const p = out.fadeTo(payload);
  const total = transitionDuration(payload.transition);
  if (total <= 0) return run(p);
  const fade = { ...out.live.fade, active: true, paused: false, progress: 0, elapsed: 0, total };
  useOutput.setState({ live: { ...useOutput.getState().live, fade } });
  void p?.catch?.((err: unknown) => {
    report(err);
    // Never sent: do not leave the desk believing a transition is running.
    const live = useOutput.getState().live;
    if (live.fade === fade) useOutput.setState({ live: { ...live, fade: { ...fade, active: false } } });
  });
}

function execute(doc: GranveloDoc | null, e: ShowEffect) {
  const out = useOutput.getState();
  switch (e.kind) {
    case "fade": {
      const m = doc?.memories.find((x) => x.id === e.memoryId);
      if (!doc || !m) return;
      sendFade(memoryFadePayload(doc, m));
      useDesk.getState().followShow(m.id);
      return;
    }
    case "pause":
      return run(out.pause());
    case "resume":
      return run(out.resume());
    case "blackout":
      return run(out.blackout(e.on));
    case "fadeToBlack":
      return run(out.fadeToBlack(e.seconds));
    case "releaseBlack":
      return run(out.releaseBlack(e.seconds));
    case "emergencyOn": {
      if (!doc) return;
      // The emergency takes the output from the desk: nothing of it (a document change, Ctrl Z) may replace these lights.
      useDesk.setState({ active: false });
      run(out.setUniverse(emergencyUniverse(doc, e.memoryId, useDesk.getState().values)));
      run(out.blackout(false));
      run(out.releaseBlack(0));
      run(out.setGrandMaster(DMX_MAX, intensityMask(doc)));
      return;
    }
    case "emergencyOff": {
      if (!doc) return;
      useDesk.setState({ active: true });
      const d = useDesk.getState();
      const time = Math.max(0, doc.settings.defaultCrossfade);
      sendFade(fadePayload(doc, deskUniverse(doc, d.values), { fadeIn: time, fadeOut: time, delay: 0, moveInDark: false }));
      run(out.setGrandMaster(d.grandMaster, intensityMask(doc)));
      if (e.blackout) run(out.blackout(true));
      if (e.ftb) run(out.fadeToBlack(0));
      return;
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** The clock runs only while something is pending. */
function updateTimer(s: ShowState) {
  const needed = !!s.fade || s.armedAt !== null;
  if (needed && !timer) timer = setInterval(() => useShow.getState().dispatch({ type: "tick" }), TICK_MS);
  else if (!needed && timer) {
    clearInterval(timer);
    timer = null;
  }
}

export const useShow = create<ShowStore>((set, get) => ({
  show: initialShow(),
  locked: false,
  dispatch: (action) => {
    const doc = useDoc.getState().doc;
    const r = showReduce(get().show, action, context(doc, Date.now()));
    if (r.state !== get().show) set({ show: r.state });
    for (const e of r.effects) {
      try {
        execute(doc, e);
      } catch (err) {
        report(err);
      }
    }
    updateTimer(r.state);
    return r.notice;
  },
  setLocked: (locked) => set({ locked }),
}));

// Follow the document: a new show starts from the top (unlocked); any other change keeps the evening going.
let lastDoc: GranveloDoc | null = null;
let lastRev = -1;
useDoc.subscribe((s) => {
  if (s.doc === lastDoc && s.loadRev === lastRev) return;
  const loaded = s.loadRev !== lastRev;
  lastDoc = s.doc;
  lastRev = s.loadRev;
  if (loaded) {
    const wasEmergency = !!useShow.getState().show.emergency;
    useShow.setState({ show: initialShow(), locked: false });
    updateTimer(useShow.getState().show);
    // The emergency had taken the output from the desk: give it back, or the faders would do nothing.
    if (wasEmergency) useDesk.getState().activate();
  }
  useShow.getState().dispatch({ type: "sync" });
});
