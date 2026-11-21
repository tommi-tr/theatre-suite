import { actionDept, audioEngineTrackId, goDepts, sortGos, type Action, type AudioAction, type Dept, type Go, type ItemRef, type LightAction, type PowerPointAction, type ProjectionAction } from "./gos";

/**
 * The evening: what GO, a click on a GO, Indietro, Pausa, Blackout, Fade to black, Emergenza and Stop audio do
 * (13_cue.md, "Schermata Show", "I GO", "Affidabilità"). Pure: every call gets the state and the GOs and returns the
 * new state and the **engine commands** to run (`EngineCommand`, executed by lib/showRunner.ts). No clock, no stores.
 *
 * Rules:
 * - **GO** fires the standby GO (never what is on screen), then the next GO in script order becomes standby. A GO
 *   during Pausa first resumes (the audio engine would otherwise only resume). Refused during the emergency, at the
 *   end, or when the GO is given by the other computer (`givenBy` and the local role).
 * - **Starts by itself** (`auto`): when the GO before it fires, the result carries `schedule` (seconds after which
 *   it starts, or `null` when a sound of unknown length decides: then `trackEnd` says which). The interface sets a
 *   timer and calls `fireAuto`, which fires it only if it is still the standby (a click, GO or Indietro in the
 *   meantime cancel it). GO pressed before the timer fires it at once.
 * - **Click** on a future GO makes it standby (it never fires); on the standby, or on a past GO, nothing happens.
 * - **Indietro** undoes the last GO fired (one step, as Granvelo's): lights go back to the memory that was in scene
 *   before it, **with that memory's times** (dark, with the undone memory's times, if there was none); the sounds it
 *   started stop (`BACK_AUDIO_FADE` s); the projection goes back to the previous one; the undone GO becomes standby.
 *   Sounds it stopped are not restarted.
 * - **What is in scene** per column is the last GO *fired* (history, not script order: GOs skipped with a click are
 *   not in scene) with an action of that column, even many GOs before; for audio, every sound started and not
 *   stopped since (by a stop action, Stop audio or the emergency). **Standby** per column = the standby GO's actions
 *   of that column.
 * - **Pausa**, **Blackout**, **Fade to black** are toggles and always work from both computers; Blackout and Fade to
 *   black act on the lights' output master only; Emergenza needs two presses within `EMERGENCY_WINDOW_MS`.
 * - **Crash recovery**: `snapshot()` is saved often; `restore()` gives the state back on the same standby **without
 *   any command**.
 */

/** Second press of E within this time fires the emergency (13_cue.md, "Tasti": E E, two presses within 1 s). */
export const EMERGENCY_WINDOW_MS = 1000;
/** Fade out of the sounds of a GO undone by Indietro (seconds). */
export const BACK_AUDIO_FADE = 1.5;

/** Who this computer is. `solo` = no secondary connected: it gives every GO. */
export type Role = "solo" | "primary" | "secondary";

/** Times of a light transition (seconds), as the DMX engine takes them. */
export interface LightTimes {
  fadeIn: number;
  fadeOut: number;
  delay: number;
  moveInDark: boolean;
}

/** What playback needs to know about the items of the sources (from lib/sources: the library). */
export interface PlaybackLookup {
  /** The memory's own transition; null = the memory is missing. */
  memory(ref: ItemRef): LightTimes | null;
  /** The track; null = missing. `playSec` null = length unknown. */
  track(ref: ItemRef): { playSec: number | null; exit: "fadeOut" | "crossfade" | "next" | null; exitSec: number; loop: boolean } | null;
}

export type EngineCommand =
  /** Lights to a memory (`ref`) or to dark (`ref` null) with these times. */
  | { kind: "light"; goId: string | null; actionId: string | null; ref: ItemRef | null; transition: LightTimes }
  | { kind: "audioPlay"; goId: string; actionId: string; ref: ItemRef; engineTrackId: string; delaySec: number }
  /** Stops a sound: one engine copy (`engineTrackId`), every copy of a track (`ref`), or every sound (`ref` null). `fadeSec` null = the general stop fade. */
  | { kind: "audioStop"; goId: string | null; ref: ItemRef | null; engineTrackId?: string; fadeSec: number | null }
  | { kind: "audioStopAll"; immediate: boolean }
  | { kind: "audioPause"; paused: boolean }
  | { kind: "dmxPause"; paused: boolean }
  | { kind: "dmxBlackout"; on: boolean }
  /** `on`: output master to black in `seconds`; off: back up in `seconds`. */
  | { kind: "dmxFadeToBlack"; on: boolean; seconds: number }
  /** Emergency on: emergency light at once. Off: give back Blackout / Fade to black as they were. */
  | { kind: "dmxEmergency"; on: boolean; blackout?: boolean; ftb?: boolean }
  /** A projection / PowerPoint action (phase 4); `action` null = the blank image. */
  | { kind: "projection"; goId: string | null; action: ProjectionAction | PowerPointAction | null };

export interface PlaybackState {
  /** The last GO fired (null before the first). */
  lastGoId: string | null;
  /** The GO the next GO fires (null = the end). */
  standbyId: string | null;
  /** Ids of the GOs fired, oldest first (Indietro removes the last). */
  history: string[];
  /** Length of `history` when every sound was last stopped (Stop audio, emergency). */
  audioClearedAt: number;
  paused: boolean;
  blackout: boolean;
  ftb: boolean;
  emergency: boolean;
  /** When E was pressed once (ms), waiting for the second press. */
  emergencyArmedAt: number | null;
}

export type Refusal =
  | "end"
  | "emergency"
  /** Given only by the primary, this is the secondary. */
  | "givenByPrimary"
  | "givenBySecondary"
  | "notStandby"
  | "notAuto"
  | "start"
  | "past"
  | "alreadyStandby"
  | "unknownGo";

export interface Schedule {
  goId: string;
  /** Seconds from now; null = when the sound in `trackEnd` ends (length unknown). */
  afterSec: number | null;
  trackEnd?: { ref: ItemRef; engineTrackId: string; beforeEndSec: number };
}

export interface StepResult {
  state: PlaybackState;
  commands: EngineCommand[];
  /** GOs fired by this step. */
  fired: string[];
  /** Actions skipped because their item is missing from its source. */
  skipped: { goId: string; actionId: string }[];
  /** The new standby starts by itself: when. */
  schedule?: Schedule;
  /** Nothing happened, and why. */
  refused?: Refusal;
}

export interface PlaybackContext {
  role: Role;
  lookup: PlaybackLookup;
}

/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */

/** Before the show: nothing fired, the first GO in standby. */
export function initialState(gos: readonly Go[]): PlaybackState {
  const list = sortGos(gos);
  return { lastGoId: null, standbyId: list[0]?.id ?? null, history: [], audioClearedAt: 0, paused: false, blackout: false, ftb: false, emergency: false, emergencyArmedAt: null };
}

const indexOf = (list: readonly Go[], id: string | null) => (id === null ? -1 : list.findIndex((g) => g.id === id));

/** Indices in script order: last fired (−1 before the start) and standby (−1 = the end). */
export function indices(state: PlaybackState, gos: readonly Go[]): { lastGoIndex: number; standbyIndex: number } {
  const list = sortGos(gos);
  return { lastGoIndex: indexOf(list, state.lastGoId), standbyIndex: indexOf(list, state.standbyId) };
}

/** Can this computer give this GO? */
export function canGive(go: Pick<Go, "givenBy">, role: Role): { ok: true } | { ok: false; reason: "givenByPrimary" | "givenBySecondary" } {
  if (role === "primary" && go.givenBy === "secondary") return { ok: false, reason: "givenBySecondary" };
  if (role === "secondary" && go.givenBy === "primary") return { ok: false, reason: "givenByPrimary" };
  return { ok: true };
}

const nothing = (state: PlaybackState, refused?: Refusal): StepResult => ({ state, commands: [], fired: [], skipped: [], refused });

/* ------------------------------------------------------------------ */
/* Firing                                                               */
/* ------------------------------------------------------------------ */

/** The times of a light action: the memory's own, changed by the action's `times`. */
export function lightTimes(action: Pick<LightAction, "times">, memory: LightTimes): LightTimes {
  const t = action.times ?? {};
  const pick = (v: number | undefined, def: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : def);
  return {
    fadeIn: pick(t.fadeIn, pick(t.fade, memory.fadeIn)),
    fadeOut: pick(t.fadeOut, pick(t.fade, memory.fadeOut)),
    delay: pick(t.delay, memory.delay),
    moveInDark: memory.moveInDark,
  };
}

const DARK: LightTimes = { fadeIn: 0, fadeOut: 3, delay: 0, moveInDark: false };

/** The commands of one GO. */
export function goCommands(go: Go, lookup: PlaybackLookup): { commands: EngineCommand[]; skipped: { goId: string; actionId: string }[] } {
  const commands: EngineCommand[] = [];
  const skipped: { goId: string; actionId: string }[] = [];
  for (const a of go.actions) {
    switch (a.kind) {
      case "light": {
        const m = lookup.memory(a.ref);
        if (!m) skipped.push({ goId: go.id, actionId: a.id });
        else commands.push({ kind: "light", goId: go.id, actionId: a.id, ref: a.ref, transition: lightTimes(a, m) });
        break;
      }
      case "audio":
        if (!lookup.track(a.ref)) skipped.push({ goId: go.id, actionId: a.id });
        else commands.push({ kind: "audioPlay", goId: go.id, actionId: a.id, ref: a.ref, engineTrackId: audioEngineTrackId(a), delaySec: Math.max(0, a.times?.delay ?? 0) });
        break;
      case "audioStop":
        commands.push({ kind: "audioStop", goId: go.id, ref: a.ref ?? null, fadeSec: typeof a.times?.fade === "number" ? Math.max(0, a.times.fade) : null });
        break;
      case "projection":
      case "powerpoint":
        commands.push({ kind: "projection", goId: go.id, action: a });
        break;
    }
  }
  return { commands, skipped };
}

/**
 * How long after `prev` fires the auto GO `next` starts: the end of what `prev` does in the columns of `next` (all
 * columns if `next` has no actions, or shares none with `prev`): light transition (delay + longer fade); sound to
 * its end (minus the crossfade with Exit "Crossfade"); stop fade. `afterSec` null when a sound's length is unknown or
 * it loops (then `trackEnd` names the sound, unless it loops).
 */
export function autoWait(prev: Go, next: Go, lookup: PlaybackLookup): Omit<Schedule, "goId"> {
  const depts = goDepts(next);
  let relevant = prev.actions.filter((a) => depts.includes(actionDept(a)));
  if (!relevant.length) relevant = prev.actions;
  let wait = 0;
  let unknown: Schedule["trackEnd"] | null | undefined;
  for (const a of relevant) {
    if (a.kind === "light") {
      const m = lookup.memory(a.ref);
      if (!m) continue;
      const t = lightTimes(a, m);
      wait = Math.max(wait, t.delay + Math.max(t.fadeIn, t.fadeOut));
    } else if (a.kind === "audio") {
      const tr = lookup.track(a.ref);
      if (!tr) continue;
      const delay = Math.max(0, a.times?.delay ?? 0);
      const before = tr.exit === "crossfade" ? tr.exitSec : 0;
      if (tr.loop) unknown = null;
      else if (tr.playSec === null) {
        if (unknown === undefined) unknown = { ref: a.ref, engineTrackId: audioEngineTrackId(a), beforeEndSec: before };
      } else wait = Math.max(wait, delay + Math.max(0, tr.playSec - before));
    } else if (a.kind === "audioStop") wait = Math.max(wait, a.times?.fade ?? 0);
  }
  if (unknown !== undefined) return unknown ? { afterSec: null, trackEnd: unknown } : { afterSec: null };
  return { afterSec: Math.round(wait * 1000) / 1000 };
}

/** Fires `go` (already checked): commands, new state, schedule of the next one if it starts by itself. */
function fire(state: PlaybackState, list: readonly Go[], go: Go, lookup: PlaybackLookup): StepResult {
  const commands: EngineCommand[] = [];
  let s = state;
  if (s.paused) {
    commands.push({ kind: "dmxPause", paused: false }, { kind: "audioPause", paused: false });
    s = { ...s, paused: false };
  }
  const own = goCommands(go, lookup);
  commands.push(...own.commands);
  const i = list.indexOf(go);
  const next = list[i + 1] ?? null;
  const history = [...s.history, go.id];
  // A stop of every sound clears the audio column from here.
  const clears = go.actions.some((a) => a.kind === "audioStop" && !a.ref);
  s = { ...s, lastGoId: go.id, standbyId: next?.id ?? null, history, audioClearedAt: clears ? history.length : s.audioClearedAt };
  const res: StepResult = { state: s, commands, fired: [go.id], skipped: own.skipped };
  if (next?.auto) res.schedule = { goId: next.id, ...autoWait(go, next, lookup) };
  return res;
}

/** GO (Space, pedal): fires the standby GO. */
export function go(state: PlaybackState, gos: readonly Go[], ctx: PlaybackContext): StepResult {
  if (state.emergency) return nothing(state, "emergency");
  const list = sortGos(gos);
  const g = list.find((x) => x.id === state.standbyId);
  if (!g) return nothing(state, "end");
  const can = canGive(g, ctx.role);
  if (!can.ok) return nothing(state, can.reason);
  return fire(state, list, g, ctx.lookup);
}

/** The timer of a GO that starts by itself ran out: it fires if it is still the standby (else nothing). */
export function fireAuto(state: PlaybackState, gos: readonly Go[], goId: string, ctx: Pick<PlaybackContext, "lookup">): StepResult {
  if (state.emergency) return nothing(state, "emergency");
  if (state.standbyId !== goId) return nothing(state, "notStandby");
  const list = sortGos(gos);
  const g = list.find((x) => x.id === goId);
  if (!g) return nothing(state, "unknownGo");
  if (!g.auto) return nothing(state, "notAuto");
  return fire(state, list, g, ctx.lookup);
}

/** A click on a GO button: a future GO becomes standby (never fires). */
export function click(state: PlaybackState, gos: readonly Go[], goId: string): StepResult {
  const list = sortGos(gos);
  const i = indexOf(list, goId);
  if (i < 0) return nothing(state, "unknownGo");
  if (goId === state.standbyId) return nothing(state, "alreadyStandby");
  if (i <= indexOf(list, state.lastGoId)) return nothing(state, "past");
  return { state: { ...state, standbyId: goId }, commands: [], fired: [], skipped: [] };
}

/* ------------------------------------------------------------------ */
/* What is in scene                                                     */
/* ------------------------------------------------------------------ */

export interface Slot {
  goId: string;
  actionIds: string[];
}

export interface AudioPlaying {
  goId: string;
  actionId: string;
  ref: ItemRef;
  engineTrackId: string;
}

export interface Columns {
  lights: { inScene: Slot | null; standby: Slot | null };
  audio: { inScene: AudioPlaying[]; standby: Slot | null };
  video: { inScene: Slot | null; standby: Slot | null };
}

const slotOf = (g: Go | undefined, dept: Dept): Slot | null => {
  if (!g) return null;
  const ids = g.actions.filter((a) => actionDept(a) === dept).map((a) => a.id);
  return ids.length ? { goId: g.id, actionIds: ids } : null;
};

/** The last GO of `history` (from the end) with an action of `dept`. */
function lastWith(history: readonly string[], byId: Map<string, Go>, dept: Dept, kinds?: Action["kind"][]): Slot | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const g = byId.get(history[i]);
    if (!g) continue;
    const ids = g.actions.filter((a) => actionDept(a) === dept && (!kinds || kinds.includes(a.kind))).map((a) => a.id);
    if (ids.length) return { goId: g.id, actionIds: ids };
  }
  return null;
}

/** The sounds started and not stopped since (history from the last clear). */
function audioInScene(state: PlaybackState, byId: Map<string, Go>): AudioPlaying[] {
  let out: AudioPlaying[] = [];
  for (let i = Math.min(state.audioClearedAt, state.history.length); i < state.history.length; i++) {
    const g = byId.get(state.history[i]);
    if (!g) continue;
    for (const a of g.actions) {
      if (a.kind === "audio") {
        const id = audioEngineTrackId(a);
        out = out.filter((p) => p.engineTrackId !== id);
        out.push({ goId: g.id, actionId: a.id, ref: a.ref, engineTrackId: id });
      } else if (a.kind === "audioStop") {
        const ref = a.ref;
        out = ref ? out.filter((p) => !(p.ref.sourceId === ref.sourceId && p.ref.itemId === ref.itemId)) : [];
      }
    }
  }
  return out;
}

/** What each column shows in scene (green) and in standby (amber). */
export function columns(state: PlaybackState, gos: readonly Go[]): Columns {
  const byId = new Map(gos.map((g) => [g.id, g]));
  const sb = state.standbyId ? byId.get(state.standbyId) : undefined;
  return {
    lights: { inScene: lastWith(state.history, byId, "lights"), standby: slotOf(sb, "lights") },
    audio: { inScene: audioInScene(state, byId), standby: slotOf(sb, "audio") },
    video: { inScene: lastWith(state.history, byId, "video"), standby: slotOf(sb, "video") },
  };
}

export type GoStatus = "past" | "last" | "standby" | "future";

export interface GoView {
  id: string;
  status: GoStatus;
  /** This computer can give it (always true for GOs that are not standby or future). */
  fireable: boolean;
  /** Why not: given only by the other computer. */
  reason?: "givenByPrimary" | "givenBySecondary";
}

/** Button state of every GO (script order): grey past, green last, amber standby, neutral future. */
export function goViews(state: PlaybackState, gos: readonly Go[], role: Role): GoView[] {
  const list = sortGos(gos);
  const last = indexOf(list, state.lastGoId);
  return list.map((g, i) => {
    const status: GoStatus = g.id === state.lastGoId ? "last" : g.id === state.standbyId ? "standby" : i < last ? "past" : "future";
    const can = canGive(g, role);
    return can.ok || status === "past" || status === "last" ? { id: g.id, status, fireable: true } : { id: g.id, status, fireable: false, reason: can.reason };
  });
}

/* ------------------------------------------------------------------ */
/* Indietro                                                             */
/* ------------------------------------------------------------------ */

/** Indietro (Backspace): undoes the last GO fired. */
export function back(state: PlaybackState, gos: readonly Go[], ctx: Pick<PlaybackContext, "lookup">): StepResult {
  if (state.emergency) return nothing(state, "emergency");
  if (!state.history.length) return nothing(state, "start");
  const byId = new Map(gos.map((g) => [g.id, g]));
  const undoneId = state.history[state.history.length - 1];
  const undone = byId.get(undoneId);
  const history = state.history.slice(0, -1);
  const commands: EngineCommand[] = [];
  if (undone) {
    const light = undone.actions.find((a): a is LightAction => a.kind === "light");
    if (light) {
      const prev = lastWith(history, byId, "lights");
      const prevAction = prev ? (byId.get(prev.goId)?.actions.find((a) => a.id === prev.actionIds[0]) as LightAction | undefined) : undefined;
      const prevMem = prevAction ? ctx.lookup.memory(prevAction.ref) : null;
      if (prev && prevAction && prevMem) commands.push({ kind: "light", goId: prev.goId, actionId: prevAction.id, ref: prevAction.ref, transition: lightTimes(prevAction, prevMem) });
      else {
        const m = ctx.lookup.memory(light.ref);
        commands.push({ kind: "light", goId: null, actionId: null, ref: null, transition: m ? lightTimes(light, m) : DARK });
      }
    }
    for (const a of undone.actions)
      if (a.kind === "audio") commands.push({ kind: "audioStop", goId: undone.id, ref: a.ref, engineTrackId: audioEngineTrackId(a as AudioAction), fadeSec: BACK_AUDIO_FADE });
    if (undone.actions.some((a) => a.kind === "projection" || a.kind === "powerpoint")) {
      const prev = lastWith(history, byId, "video");
      const prevAction = prev ? (byId.get(prev.goId)?.actions.find((a) => a.id === prev.actionIds[0]) as ProjectionAction | PowerPointAction | undefined) : undefined;
      commands.push({ kind: "projection", goId: prev?.goId ?? null, action: prevAction ?? null });
    }
  }
  const lastGoId = history.length ? history[history.length - 1] : null;
  const s: PlaybackState = { ...state, lastGoId, standbyId: undone ? undoneId : state.standbyId, history, audioClearedAt: Math.min(state.audioClearedAt, history.length) };
  return { state: s, commands, fired: [], skipped: [] };
}

/* ------------------------------------------------------------------ */
/* Safety commands                                                      */
/* ------------------------------------------------------------------ */

/** Pausa on: light fades and every sound stop where they are. */
export function pause(state: PlaybackState): StepResult {
  if (state.paused) return nothing(state);
  return { state: { ...state, paused: true }, commands: [{ kind: "dmxPause", paused: true }, { kind: "audioPause", paused: true }], fired: [], skipped: [] };
}

/** Pausa off: they go on. */
export function resume(state: PlaybackState): StepResult {
  if (!state.paused) return nothing(state);
  return { state: { ...state, paused: false }, commands: [{ kind: "dmxPause", paused: false }, { kind: "audioPause", paused: false }], fired: [], skipped: [] };
}

/** P: Pausa or back on. */
export const togglePause = (state: PlaybackState): StepResult => (state.paused ? resume(state) : pause(state));

/** B: Blackout on/off (lights' output master; what is underneath goes on). Refused during the emergency. */
export function blackout(state: PlaybackState, on = !state.blackout): StepResult {
  if (state.emergency) return nothing(state, "emergency");
  if (on === state.blackout) return nothing(state);
  return { state: { ...state, blackout: on }, commands: [{ kind: "dmxBlackout", on }], fired: [], skipped: [] };
}

/** F: Fade to black in `seconds`, or back up in the same time when already black. Refused during the emergency. */
export function fadeToBlack(state: PlaybackState, seconds: number): StepResult {
  if (state.emergency) return nothing(state, "emergency");
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const on = !state.ftb;
  return { state: { ...state, ftb: on }, commands: [{ kind: "dmxFadeToBlack", on, seconds: s }], fired: [], skipped: [] };
}

/** Esc: every sound out with the general stop fade. */
export function stopAudio(state: PlaybackState): StepResult {
  return { state: { ...state, audioClearedAt: state.history.length }, commands: [{ kind: "audioStopAll", immediate: false }], fired: [], skipped: [] };
}

/** Emergenza now: emergency light, every sound out at once, blank projection. */
export function emergency(state: PlaybackState): StepResult {
  if (state.emergency) return nothing(state);
  return {
    state: { ...state, emergency: true, emergencyArmedAt: null, paused: false, audioClearedAt: state.history.length },
    commands: [{ kind: "dmxEmergency", on: true }, { kind: "audioStopAll", immediate: true }, { kind: "projection", goId: null, action: null }],
    fired: [],
    skipped: [],
  };
}

/** E: the first press arms (result `armed`), a second press within `EMERGENCY_WINDOW_MS` fires the emergency. */
export function emergencyPress(state: PlaybackState, nowMs: number): StepResult & { armed: boolean } {
  if (state.emergency) return { ...nothing(state), armed: false };
  if (state.emergencyArmedAt !== null && nowMs - state.emergencyArmedAt >= 0 && nowMs - state.emergencyArmedAt <= EMERGENCY_WINDOW_MS) return { ...emergency(state), armed: false };
  return { ...nothing({ ...state, emergencyArmedAt: nowMs }), armed: true };
}

/** Leaves the emergency: Blackout / Fade to black as they were, lights back to the memory in scene (its times), or dark. */
export function leaveEmergency(state: PlaybackState, gos: readonly Go[], ctx: Pick<PlaybackContext, "lookup">): StepResult {
  if (!state.emergency) return nothing(state);
  const byId = new Map(gos.map((g) => [g.id, g]));
  const commands: EngineCommand[] = [{ kind: "dmxEmergency", on: false, blackout: state.blackout, ftb: state.ftb }];
  const slot = lastWith(state.history, byId, "lights");
  const action = slot ? (byId.get(slot.goId)?.actions.find((a) => a.id === slot.actionIds[0]) as LightAction | undefined) : undefined;
  const m = action ? ctx.lookup.memory(action.ref) : null;
  if (slot && action && m) commands.push({ kind: "light", goId: slot.goId, actionId: action.id, ref: action.ref, transition: lightTimes(action, m) });
  else commands.push({ kind: "light", goId: null, actionId: null, ref: null, transition: DARK });
  return { state: { ...state, emergency: false }, commands, fired: [], skipped: [] };
}

/* ------------------------------------------------------------------ */
/* Crash recovery                                                       */
/* ------------------------------------------------------------------ */

export interface PlaybackSnapshot {
  standbyId: string | null;
  lastGoId: string | null;
  /** Optional: the GOs fired (to show what is in scene after a restart). */
  history?: string[];
}

export const snapshot = (s: PlaybackState): PlaybackSnapshot => ({ standbyId: s.standbyId, lastGoId: s.lastGoId, history: [...s.history] });

/**
 * The state after a restart: on the same standby, **nothing fired**. Ids that no longer exist are dropped; a lost
 * standby becomes the GO after the last fired one (or the first).
 */
export function restore(snap: PlaybackSnapshot, gos: readonly Go[]): PlaybackState {
  const list = sortGos(gos);
  const ids = new Set(list.map((g) => g.id));
  const lastGoId = snap.lastGoId && ids.has(snap.lastGoId) ? snap.lastGoId : null;
  let history = (snap.history ?? []).filter((id) => ids.has(id));
  if (lastGoId && history[history.length - 1] !== lastGoId) history = [...history, lastGoId];
  if (!lastGoId) history = [];
  let standbyId = snap.standbyId && ids.has(snap.standbyId) ? snap.standbyId : null;
  if (!standbyId) {
    const i = indexOf(list, lastGoId);
    standbyId = list[i + 1]?.id ?? null;
  }
  return { ...initialState([]), lastGoId, standbyId, history };
}
