import type { LiveState, Voice } from "@theatre-suite/show-files/diaframma";
import { engineId, type AudioApi, type SyncSource } from "./audio";

/**
 * The audio engine in the browser (outside Tauri and always in `/?demo`): no sound at all, only the live state the
 * native engine would send — voices with their position, fades and pause — so the screens can be tried and
 * screenshotted. Same rules as Cue's use of the engine: `playNow` restarts a track already playing and, while
 * "pause all" is on, only resumes; other tracks are left alone; `stopTrack` fades one out.
 */

/** The only output of the simulator. */
export const SIMULATED_OUTPUT = "Uscita simulata";
/** Length of a simulated track whose length is unknown (seconds). */
export const SIM_UNKNOWN_SEC = 45;
const QUICK_SEC = 0.02;
const STOP_ALL_SEC = 1.5;

interface SimTrack {
  id: string;
  durationSec: number;
  loop: boolean;
  fadeInSec: number;
}

interface SimVoice {
  trackId: string;
  pos: number;
  duration: number;
  loop: boolean;
  paused: boolean;
  /** Remaining fade-in seconds. */
  fadeIn: number;
  /** Remaining fade-out seconds (null = not leaving). */
  fadeOut: number | null;
  /** Went round the loop at least once. */
  looped: boolean;
}

export interface SimAudioOptions {
  /** Clock in seconds (default performance.now). */
  now?: () => number;
  /** Run the clock with a timer (default true); tests call `tick()`. */
  timer?: boolean;
}

export type SimAudio = AudioApi & { tick(now?: number): void };

export function createSimAudio(opts: SimAudioOptions = {}): SimAudio {
  const clock = opts.now ?? (() => performance.now() / 1000);
  let tracks = new Map<string, SimTrack>();
  let voices: SimVoice[] = [];
  let pausedAll = false;
  let device = SIMULATED_OUTPUT;
  let last = clock();
  let lastJson = "";
  let lastEmit = -1;
  const fns = new Set<(s: LiveState) => void>();

  const live = (): LiveState => {
    const vs: Voice[] = voices.map((v, i) => ({
      trackId: v.trackId,
      positionSec: Math.round(v.pos * 20) / 20,
      durationSec: v.duration,
      paused: v.paused,
      fading: v.fadeOut !== null ? "out" : v.fadeIn > 0 ? "in" : null,
      looping: v.loop,
      inLoop: v.looped,
      main: i === voices.length - 1,
    }));
    return { standbyId: null, mainId: voices.length ? voices[voices.length - 1].trackId : null, autoStart: false, pausedAll, voices: vs, engine: { ready: true, device, sampleRate: 48000, error: null } };
  };

  const emit = (force = false) => {
    const s = live();
    const json = JSON.stringify(s);
    if (!force && json === lastJson) return;
    lastJson = json;
    fns.forEach((f) => f(s));
  };

  const tick = (at?: number) => {
    const now = at ?? clock();
    const dt = Math.max(0, now - last);
    last = now;
    if (dt > 0) {
      for (const v of voices) {
        if (v.paused) continue;
        v.pos += dt;
        if (v.fadeIn > 0) v.fadeIn = Math.max(0, v.fadeIn - dt);
        if (v.fadeOut !== null) v.fadeOut -= dt;
        if (v.pos >= v.duration) {
          if (v.loop && v.duration > 0) {
            v.pos %= v.duration;
            v.looped = true;
          } else v.pos = v.duration;
        }
      }
      voices = voices.filter((v) => (v.fadeOut === null || v.fadeOut > 0) && (v.loop || v.pos < v.duration));
    }
    // ≈ 10 times a second while something plays, otherwise only on change (as the engine).
    if (voices.some((v) => !v.paused) ? now - lastEmit >= 0.1 : true) {
      lastEmit = now;
      emit();
    }
  };

  const act = (fn: () => void) => {
    tick();
    fn();
    emit();
    return Promise.resolve();
  };

  const api: SimAudio = {
    simulated: true,
    tick,
    listDevices: () => Promise.resolve([SIMULATED_OUTPUT]),
    setDevice: (name) => act(() => (device = name ?? SIMULATED_OUTPUT)),
    sync: (sources: SyncSource[]) =>
      act(() => {
        const next = new Map<string, SimTrack>();
        for (const s of sources)
          for (const t of s.tracks) {
            const play = typeof t.playSec === "number" && t.playSec > 0 ? t.playSec : t.outSec !== null && t.outSec > t.inSec ? t.outSec - t.inSec : SIM_UNKNOWN_SEC;
            next.set(engineId(s.sourceId, t.id), { id: engineId(s.sourceId, t.id), durationSec: play, loop: t.loopOn, fadeInSec: t.entry === "fadeIn" ? (t.entrySec ?? 3) : 0 });
          }
        tracks = next;
      }),
    playNow: (sourceId, trackId) => {
      const id = engineId(sourceId, trackId);
      const t = tracks.get(id);
      if (!t) return Promise.reject(new Error(`unknown track ${id}`));
      return act(() => {
        if (pausedAll) {
          pausedAll = false;
          voices.forEach((v) => (v.paused = false));
          return;
        }
        voices = voices.filter((v) => v.trackId !== id);
        voices.push({ trackId: id, pos: 0, duration: t.durationSec, loop: t.loop, paused: false, fadeIn: t.fadeInSec, fadeOut: null, looped: false });
      });
    },
    stopTrack: (sourceId, trackId, fadeSec) =>
      act(() => {
        const id = engineId(sourceId, trackId);
        for (const v of voices) if (v.trackId === id) v.fadeOut = Math.max(QUICK_SEC, fadeSec ?? 0);
      }),
    stopAll: (immediate) =>
      act(() => {
        if (immediate) voices = [];
        else for (const v of voices) v.fadeOut = Math.min(v.fadeOut ?? Infinity, STOP_ALL_SEC);
      }),
    setPaused: (paused) =>
      act(() => {
        pausedAll = paused;
        voices.forEach((v) => (v.paused = paused));
      }),
    state: () => {
      tick();
      return Promise.resolve(live());
    },
    onState: (fn) => {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
  if (opts.timer !== false && typeof window !== "undefined") window.setInterval(() => tick(), 50);
  return api;
}
