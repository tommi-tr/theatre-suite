import { create } from "zustand";
import type { TFunc } from "@theatre-suite/core";
import { numberGos, sortGos, type Go, type LightAction } from "../model/gos";
import {
  back,
  blackout,
  canGive,
  click,
  columns,
  emergency,
  fadeToBlack,
  fireAuto,
  go,
  initialState,
  leaveEmergency,
  lightTimes,
  restore,
  snapshot,
  stopAudio,
  togglePause,
  type EngineCommand,
  type PlaybackSnapshot,
  type PlaybackState,
  type Refusal,
  type Role,
  type Schedule,
  type StepResult,
} from "../model/playback";
import { checkRemoteBack, checkRemoteGo, remoteToggleApplies, refusalText as linkRefusalText, routeAction, type LinkOp } from "../model/link";
import { doublePress } from "./keys";
import { linkApi } from "../lib/link";
import { linkInfo } from "../store/link";
import { audioApi, engineId } from "../lib/audio";
import { dmxApi } from "../lib/dmx";
import { pptErrorText } from "../lib/ppt";
import { projErrorText, runProjection, setBlank, useProj } from "../lib/projection";
import { runCommands } from "../lib/showRunner";
import { useDoc } from "../store/doc";
import { useLibrary } from "../store/library";
import { useOutputs } from "../store/outputs";
import { useUi } from "../store/ui";

/**
 * The evening on this computer: the playback state of model/playback.ts and what is around it — running time, Lock,
 * Piazzato, Tappo, the reservation (C held, phase 3), the timers of the GOs that start by themselves. Every action
 * runs the engine commands through lib/showRunner.ts and says in words why nothing happened, when that is the case.
 */
export interface RunStore {
  playback: PlaybackState;
  /** Who this computer is: `solo` until a secondary is paired (phase 3). */
  role: Role;
  /** Lock (Ctrl L): only the show keys work; clicks are blocked; unlock by holding. */
  locked: boolean;
  /** C held: this computer reserves the GO (phase 3 hook: local only for now). */
  reserved: boolean;
  /** First E pressed (ms), waiting for the second within 1 s. */
  emergencyArmedAt: number | null;
  /** Piazzato rapido (Q) is on stage. */
  preset: boolean;
  /** Running time: the first GO starts it; Pausa stops it. */
  startedAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
  /** A GO that will start by itself: which and when (for the button). */
  autoPending: { goId: string; at: number | null } | null;
}

const initial = (gos: readonly Go[] = []): RunStore => ({
  playback: initialState(gos),
  role: "solo",
  locked: false,
  reserved: false,
  emergencyArmedAt: null,
  preset: false,
  startedAt: null,
  pausedAt: null,
  pausedMs: 0,
  autoPending: null,
});

export const useRun = create<RunStore>(() => initial());

const gosNow = (): readonly Go[] => useDoc.getState().show?.gos ?? [];

/** Running time in ms (0 before the first GO). */
export function runningMs(s: Pick<RunStore, "startedAt" | "pausedAt" | "pausedMs">, now = Date.now()): number {
  if (s.startedAt === null) return 0;
  return Math.max(0, (s.pausedAt ?? now) - s.startedAt - s.pausedMs);
}

/** "1:12:40" / "12:40". */
export function clockText(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/* ------------------------------------------------------------------ */
/* Running commands                                                     */
/* ------------------------------------------------------------------ */

let toastT: TFunc | null = null;

function say(message: string, kind: "info" | "error" = "info") {
  useUi.getState().showToast(message, kind);
}

async function run(commands: readonly EngineCommand[]) {
  if (!commands.length) return;
  // The secondary never drives the engines: it only shows what the primary does.
  const li = linkInfo();
  if (li.role === "secondary" && !li.simulated) return;
  const [dmx, audio] = await Promise.all([dmxApi(), audioApi()]);
  await runCommands(commands, {
    dmx,
    audio,
    library: useLibrary.getState().library,
    projection: (cmd) => runProjection(cmd.action),
    onError: (cmd, e) => {
      console.error("engine command failed", cmd, e);
      const t = toastT;
      if (!t) return;
      if (cmd.kind === "light" || cmd.kind.startsWith("dmx")) say(t("The lights did not answer: check the DMX output (status bar)."), "error");
      else if (cmd.kind.startsWith("audio")) say(t("The sound did not answer: check the audio output (status bar)."), "error");
      else if (cmd.kind === "projection") say(cmd.action?.kind === "powerpoint" ? pptErrorText(t, e) : projErrorText(t, e), "error");
    },
  });
}

export function refusalText(t: TFunc, r: Refusal): string {
  switch (r) {
    case "end":
      return t("That was the last GO: there is nothing after it.");
    case "emergency":
      return t("Emergency is on: press “Back to the show” first.");
    case "givenBySecondary":
      return t("This GO is given by the secondary.");
    case "givenByPrimary":
      return t("This GO is given by the primary.");
    case "start":
      return t("No GO has been given yet: there is nothing to go back to.");
    case "past":
      return t("This GO has already been given: use Back (Backspace) to go back.");
    default:
      return "";
  }
}

/** Applies a step of playback: new state, engine commands, running time, auto GO timer, words when refused. */
function apply(t: TFunc, res: StepResult, opts: { quiet?: Refusal[]; silent?: boolean; by?: "primary" | "secondary" } = {}): Refusal | null {
  toastT = t;
  if (res.refused) {
    if (!opts.silent && !opts.quiet?.includes(res.refused)) {
      const text = refusalText(t, res.refused);
      if (text) say(text);
    }
    return res.refused;
  }
  const prev = useRun.getState();
  const now = Date.now();
  const patch: Partial<RunStore> = { playback: res.state };
  if (res.fired.length) {
    if (prev.startedAt === null) patch.startedAt = now;
    patch.preset = false;
  }
  // Pausa stops the running time.
  if (res.state.paused && !prev.playback.paused) patch.pausedAt = now;
  if (!res.state.paused && prev.playback.paused && prev.pausedAt !== null) {
    patch.pausedMs = prev.pausedMs + (now - prev.pausedAt);
    patch.pausedAt = null;
  }
  if (res.state.standbyId !== prev.playback.standbyId || res.fired.length) {
    clearAuto();
    patch.autoPending = null;
  }
  useRun.setState(patch);
  if (res.schedule) scheduleAuto(t, res.schedule);
  if (res.skipped.length) say(t("Some actions of this GO were skipped: their memory or track is missing."), "error");
  void run(res.commands);
  if (res.fired.length || res.state.standbyId !== prev.playback.standbyId) afterStandbyChange(res.fired.length > 0);
  if (res.fired.length) for (const f of firedListeners) f(res.fired, opts.by ?? "primary");
  return null;
}

/** Told after a GO fires on this computer (the link publishes the event to the secondary). */
type FiredListener = (goIds: string[], by: "primary" | "secondary") => void;
const firedListeners = new Set<FiredListener>();
export function onFired(fn: FiredListener): () => void {
  firedListeners.add(fn);
  return () => firedListeners.delete(fn);
}

/**
 * Where a Show action goes (model/link.ts `routeAction`): applied here (no link, or this is the primary, whose
 * state the link then publishes), asked to the primary (secondary), or refused in words.
 */
function routed(t: TFunc, op: LinkOp, local: () => void) {
  const r = routeAction(linkInfo(), op);
  if (r.kind === "local") return local();
  if (r.kind === "refuse") return say(linkRefusalText(r.reason, t));
  linkApi()
    .request(op)
    .then((o) => {
      if (!o.ok) say(linkRefusalText(o.reason, t));
    })
    .catch(() => say(linkRefusalText("timeout", t)));
}

/* ------------------------------------------------------------------ */
/* GOs that start by themselves                                         */
/* ------------------------------------------------------------------ */

let autoTimer: ReturnType<typeof setTimeout> | null = null;
let autoWatch: (() => void) | null = null;

function clearAuto() {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null;
  autoWatch?.();
  autoWatch = null;
}

function scheduleAuto(t: TFunc, s: Schedule) {
  clearAuto();
  const fire = () => {
    clearAuto();
    const st = useRun.getState();
    if (st.playback.standbyId !== s.goId) return;
    apply(t, fireAuto(st.playback, gosNow(), s.goId, { lookup: useLibrary.getState().library.lookup }), { quiet: ["notStandby", "notAuto", "unknownGo", "emergency"] });
  };
  if (s.afterSec !== null) {
    useRun.setState({ autoPending: { goId: s.goId, at: Date.now() + s.afterSec * 1000 } });
    autoTimer = setTimeout(fire, Math.max(0, s.afterSec * 1000));
    return;
  }
  useRun.setState({ autoPending: { goId: s.goId, at: null } });
  const end = s.trackEnd;
  if (!end) return;
  // Length unknown: watch the sound; it fires when the sound is near its end, or gone after having played.
  const id = engineId(end.ref.sourceId, end.engineTrackId);
  let seen = false;
  autoWatch = useOutputs.subscribe((o) => {
    const v = o.audio?.voices.find((x) => x.trackId === id);
    if (v) {
      seen = true;
      if (!v.looping && v.durationSec - v.positionSec <= end.beforeEndSec + 0.05) fire();
    } else if (seen) fire();
  });
}

/* ------------------------------------------------------------------ */
/* The commands of the Show                                             */
/* ------------------------------------------------------------------ */

const lookup = () => useLibrary.getState().library.lookup;

/** GO (Space, pedal): fires the standby. */
export function runGo(t: TFunc) {
  const st = useRun.getState();
  const gos = gosNow();
  if (!gos.length) return say(t("This show has no GOs yet: create them in Prepare by dragging memories and tracks onto the script."));
  const sb = gos.find((g) => g.id === st.playback.standbyId);
  const can = sb ? canGive(sb, st.role) : { ok: true as const };
  if (!can.ok) return say(refusalText(t, can.reason));
  routed(t, { kind: "go", standbyId: st.playback.standbyId }, () => void apply(t, go(st.playback, gos, { role: st.role, lookup: lookup() })));
}

/** Indietro (Backspace). */
export function runBack(t: TFunc) {
  routed(t, { kind: "back", fromLastGoId: useRun.getState().playback.lastGoId }, () => void apply(t, back(useRun.getState().playback, gosNow(), { lookup: lookup() })));
}

/** A click on a GO button: a future GO becomes standby. */
export function runClick(t: TFunc, goId: string) {
  routed(t, { kind: "standby", goId }, () => void apply(t, click(useRun.getState().playback, gosNow(), goId), { quiet: ["alreadyStandby"] }));
}

export function runPause(t: TFunc) {
  routed(t, { kind: "pause", on: !useRun.getState().playback.paused }, () => void apply(t, togglePause(useRun.getState().playback)));
}

export function runBlackout(t: TFunc) {
  routed(t, { kind: "blackout", on: !useRun.getState().playback.blackout }, () => void apply(t, blackout(useRun.getState().playback)));
}

/** Fade to black in the time of the show (Settings; default 3 s); again = back up in the same time. */
export function runFadeToBlack(t: TFunc) {
  routed(t, { kind: "fadeToBlack", on: !useRun.getState().playback.ftb }, () => void apply(t, fadeToBlack(useRun.getState().playback, ftbSeconds())));
}

const ftbSeconds = () => useDoc.getState().show?.settings.ftbSeconds ?? 3;

export function runStopAudio(t: TFunc) {
  routed(t, { kind: "stopAudio" }, () => void apply(t, stopAudio(useRun.getState().playback)));
}

/** E: the first press arms (the command blinks), a second within 1 s turns the emergency on. */
export function runEmergencyPress(t: TFunc, now = Date.now()) {
  const st = useRun.getState();
  if (st.playback.emergency) return;
  const d = doublePress(st.emergencyArmedAt, now);
  useRun.setState({ emergencyArmedAt: d.armedAt });
  if (!d.fire) {
    // The blinking stops by itself when the second press does not come.
    setTimeout(() => {
      if (useRun.getState().emergencyArmedAt === d.armedAt) useRun.setState({ emergencyArmedAt: null });
    }, 1050);
    return;
  }
  routed(t, { kind: "emergency", on: true }, () => {
    clearAuto();
    apply(t, emergency(st.playback));
    useRun.setState({ preset: false, autoPending: null });
  });
}

export function runLeaveEmergency(t: TFunc) {
  routed(t, { kind: "emergency", on: false }, () => void apply(t, leaveEmergency(useRun.getState().playback, gosNow(), { lookup: lookup() })));
}

/** The memory in scene now (for Piazzato off), or null. */
function lightInScene(): { goId: string; action: LightAction } | null {
  const gos = gosNow();
  const slot = columns(useRun.getState().playback, gos).lights.inScene;
  if (!slot) return null;
  const action = gos.find((g) => g.id === slot.goId)?.actions.find((a): a is LightAction => a.id === slot.actionIds[0] && a.kind === "light");
  return action ? { goId: slot.goId, action } : null;
}

/** Q: Piazzato rapido on (the memory chosen in the settings, with its times) and off (back to the memory in scene). */
export function runPreset(t: TFunc) {
  toastT = t;
  if (linkInfo().role === "secondary" && !linkInfo().simulated) return say(t("The preset is for the primary computer."));
  const st = useRun.getState();
  if (st.playback.emergency) return say(refusalText(t, "emergency"));
  const ref = useDoc.getState().show?.settings.presetRef ?? null;
  if (!ref) return say(t("No preset chosen yet: choose its memory in Settings → Outputs."));
  const lib = useLibrary.getState().library;
  const mem = lib.lookup.memory(ref);
  if (!mem) return say(t("The preset memory is missing from its Granvelo file: choose it again in Settings → Outputs."), "error");
  if (!st.preset) {
    useRun.setState({ preset: true });
    void run([{ kind: "light", goId: null, actionId: null, ref, transition: mem }]);
    return;
  }
  useRun.setState({ preset: false });
  const live = lightInScene();
  const liveMem = live ? lib.lookup.memory(live.action.ref) : null;
  void run([
    live && liveMem
      ? { kind: "light", goId: live.goId, actionId: live.action.id, ref: live.action.ref, transition: lightTimes(live.action, liveMem) }
      : { kind: "light", goId: null, actionId: null, ref: null, transition: mem },
  ]);
}

/** T: Tappo, the blank image on the output and back (Emergenza and Back also blank it). */
export function runBlank(t: TFunc) {
  toastT = t;
  const on = !useProj.getState().blank;
  void setBlank(on).catch((e) => say(projErrorText(t, e), "error"));
}

export function setLocked(locked: boolean) {
  useRun.setState({ locked });
}

export const toggleLock = () => setLocked(!useRun.getState().locked);

/**
 * C held / released: asks for the reservation (arbitrated on the primary, the first wins) and releases it. The blue
 * outline follows what the link reports (`reservation`), not the key alone.
 */
export function setReserved(reserved: boolean) {
  if (useRun.getState().reserved === reserved) return;
  useRun.setState({ reserved });
  if (linkInfo().role === "none") return;
  // Refused (the other holds it, or unavailable): the grey button already says so.
  void linkApi().reserve(reserved).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* The link: state published by the primary, requests applied by it     */
/* ------------------------------------------------------------------ */

/** What the primary publishes and the secondary shows. */
export interface SharedRun {
  playback: PlaybackState;
  startedAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
  preset: boolean;
  autoPending: RunStore["autoPending"];
}

export const sharedRun = (s: RunStore): SharedRun => ({
  playback: s.playback,
  startedAt: s.startedAt,
  pausedAt: s.pausedAt,
  pausedMs: s.pausedMs,
  preset: s.preset,
  autoPending: s.autoPending,
});

/** Secondary: shows the primary's state (buttons, columns, running time). Anything that is not a state is ignored. */
export function applySharedRun(raw: unknown): boolean {
  const x = raw as Partial<SharedRun> | null;
  const p = x?.playback;
  if (!p || typeof p !== "object" || !Array.isArray(p.history) || typeof p.paused !== "boolean") return false;
  const prev = useRun.getState().playback;
  useRun.setState({
    playback: { ...p, emergencyArmedAt: null },
    startedAt: x.startedAt ?? null,
    pausedAt: x.pausedAt ?? null,
    pausedMs: x.pausedMs ?? 0,
    preset: !!x.preset,
    autoPending: x.autoPending ?? null,
  });
  if (p.standbyId !== prev.standbyId || p.lastGoId !== prev.lastGoId) afterStandbyChange(p.lastGoId !== prev.lastGoId);
  return true;
}

/**
 * Primary: a request of the secondary, applied through the same code as the keys (as the secondary). Refused by
 * the playback rules → `reply(requestId, false, reason)`: the secondary shows it.
 */
export function handleRequest(t: TFunc, requestId: string, op: LinkOp): void {
  const st = useRun.getState();
  const gos = gosNow();
  const by = { silent: true, by: "secondary" } as const;
  let refused: string | null = null;
  switch (op.kind) {
    case "go":
      refused = checkRemoteGo(op, st.playback.standbyId) ?? apply(t, go(st.playback, gos, { role: "secondary", lookup: lookup() }), by);
      break;
    case "back":
      refused = checkRemoteBack(op, st.playback.lastGoId) ?? apply(t, back(st.playback, gos, { lookup: lookup() }), by);
      break;
    case "standby":
      refused = apply(t, click(st.playback, gos, op.goId), { ...by, quiet: ["alreadyStandby"] });
      if (refused === "alreadyStandby") refused = null;
      break;
    // Safety commands: applied only if they still change something (both computers pressing at once do not cancel out).
    case "pause":
      if (remoteToggleApplies(op.on, st.playback.paused)) apply(t, togglePause(st.playback), by);
      break;
    case "blackout":
      if (remoteToggleApplies(op.on, st.playback.blackout)) apply(t, blackout(st.playback), by);
      break;
    case "fadeToBlack":
      if (remoteToggleApplies(op.on, st.playback.ftb)) apply(t, fadeToBlack(st.playback, ftbSeconds()), by);
      break;
    case "stopAudio":
      apply(t, stopAudio(st.playback), by);
      break;
    case "emergency":
      if (!remoteToggleApplies(op.on, st.playback.emergency)) break;
      if (st.playback.emergency) apply(t, leaveEmergency(st.playback, gos, { lookup: lookup() }), by);
      else {
        clearAuto();
        apply(t, emergency(st.playback), by);
        useRun.setState({ preset: false, autoPending: null });
      }
      break;
    default:
      break;
  }
  if (refused) void linkApi().reply(requestId, false, refused);
}

/* ------------------------------------------------------------------ */
/* Following the show, the show changing, recovery                      */
/* ------------------------------------------------------------------ */

type StandbyListener = (fired: boolean) => void;
const standbyListeners = new Set<StandbyListener>();

/** Called after a GO or a change of standby (the script follows: script/follow.ts). */
export function onStandbyChange(fn: StandbyListener): () => void {
  standbyListeners.add(fn);
  return () => standbyListeners.delete(fn);
}

function afterStandbyChange(fired: boolean) {
  for (const f of standbyListeners) f(fired);
}

/** The evening from the beginning (a show opened). */
export function resetRun(gos: readonly Go[], snap?: PlaybackSnapshot | null) {
  clearAuto();
  const s = initial(gos);
  if (snap) s.playback = restore(snap, gos);
  useRun.setState({ ...s, role: useRun.getState().role });
}

/**
 * GOs edited during the evening (Prepara, on-the-fly edits): ids stay; a standby that was deleted becomes the GO
 * after the last one given; the history forgets deleted GOs.
 */
export function reconcile(state: PlaybackState, gos: readonly Go[]): PlaybackState {
  const ids = new Set(gos.map((g) => g.id));
  const history = state.history.filter((id) => ids.has(id));
  const lastGoId = state.lastGoId && ids.has(state.lastGoId) ? state.lastGoId : (history[history.length - 1] ?? null);
  let standbyId = state.standbyId && ids.has(state.standbyId) ? state.standbyId : null;
  if (!standbyId) {
    const list = sortGos(gos);
    const i = lastGoId ? list.findIndex((g) => g.id === lastGoId) : -1;
    standbyId = list[i + 1]?.id ?? null;
  }
  if (standbyId === state.standbyId && lastGoId === state.lastGoId && history.length === state.history.length) return state;
  return { ...state, history, lastGoId, standbyId, audioClearedAt: Math.min(state.audioClearedAt, history.length) };
}

/** What the autosave keeps of the evening (crash recovery restarts on that standby, firing nothing). */
export const runSnapshot = (): PlaybackSnapshot => snapshot(useRun.getState().playback);

/** Text of a GO for messages: "GO 7", "GO 4.1", or its label. */
export function goName(gos: readonly Go[], goId: string | null): string | null {
  if (!goId) return null;
  const n = numberGos(gos).find((x) => x.id === goId);
  return n ? n.text : null;
}

/** Keeps the evening in step with the open show (call once, at start). */
export function startRunSync(): () => void {
  resetRun(gosNow());
  return useDoc.subscribe((s, prev) => {
    if (s.loadRev !== prev.loadRev) {
      resetRun(s.show?.gos ?? []);
      return;
    }
    if (s.show?.gos !== prev.show?.gos) {
      const st = useRun.getState();
      const gos = s.show?.gos ?? [];
      // Before the first GO a standby on the first GO stays on the first GO (a GO added before it takes its place).
      const wasFirst = st.playback.lastGoId === null && st.playback.standbyId === (sortGos(prev.show?.gos ?? [])[0]?.id ?? null);
      const first = sortGos(gos)[0]?.id ?? null;
      const next = wasFirst && first !== st.playback.standbyId ? { ...st.playback, standbyId: first } : reconcile(st.playback, gos);
      if (next !== st.playback && next.standbyId !== st.playback.standbyId) clearAuto();
      if (next !== st.playback) useRun.setState({ playback: next });
    }
  });
}
