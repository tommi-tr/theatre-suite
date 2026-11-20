import type { DmxApi } from "@theatre-suite/show-files/granvelo/dmxApi";
import type { Go } from "../model/gos";
import { go, initialState, type PlaybackState } from "../model/playback";
import type { Library } from "../model/sources";
import type { AudioApi } from "./audio";
import { runCommands } from "./showRunner";

/**
 * Settings → Test: the reliability test (13, "Affidabilità"). It gives `count` GOs in a row, in silence: the same
 * code as a real GO (playback rules, the memory and track of every action looked up, the DMX payload built, every
 * engine command run) but on outputs that send nothing. The live evening is not touched: the test works on its
 * own copy of the playback state, from the first GO, starting again at the end of the show.
 */

export interface ReliabilityResult {
  /** GOs timed. */
  gos: number;
  /** Times the show ran to its end and started again. */
  laps: number;
  meanMs: number;
  maxMs: number;
  /** 95 out of 100 GOs took at most this. */
  p95Ms: number;
  /** Engine commands that failed (a memory or a track that cannot be found, for example). */
  errors: number;
  /** Actions skipped because their memory or track is missing from its file. */
  skipped: number;
  /** Mean ≤ 5 ms and maximum ≤ 50 ms: well under what a person can notice. */
  ok: boolean;
}

export const MEAN_LIMIT_MS = 5;
export const MAX_LIMIT_MS = 50;

/** Outputs that accept every command and send nothing anywhere. */
export function silentOutputs(): { dmx: DmxApi; audio: AudioApi; commands: () => number } {
  let n = 0;
  const handler: ProxyHandler<object> = {
    get: (_t, key) => {
      if (key === "simulated") return true;
      if (key === "then") return undefined; // not a promise
      if (key === "state") return async () => ({ voices: [] });
      if (typeof key === "string" && key.startsWith("on")) return () => () => {};
      return async () => {
        n++;
        return 0;
      };
    },
  };
  return { dmx: new Proxy({}, handler) as DmxApi, audio: new Proxy({}, handler) as AudioApi, commands: () => n };
}

export function summarize(times: readonly number[], laps: number, errors: number, skipped: number): ReliabilityResult {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const max = sorted.length ? sorted[sorted.length - 1] : 0;
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0;
  return { gos: times.length, laps, meanMs: mean, maxMs: max, p95Ms: p95, errors, skipped, ok: times.length > 0 && errors === 0 && mean <= MEAN_LIMIT_MS && max <= MAX_LIMIT_MS };
}

export interface ReliabilityOptions {
  count?: number;
  now?: () => number;
  /** Called every few GOs (the interface shows "120 of 200"). */
  onProgress?: (done: number, total: number) => void;
  /** Lets the interface breathe between GOs (not timed). Default: a 0 ms timer every 10 GOs. */
  pause?: (done: number) => Promise<void>;
}

export async function silentGoTest(gos: readonly Go[], library: Library, opts: ReliabilityOptions = {}): Promise<ReliabilityResult> {
  const count = opts.count ?? 200;
  const now = opts.now ?? (() => performance.now());
  const pause = opts.pause ?? ((done: number) => (done % 10 === 0 ? new Promise<void>((r) => setTimeout(r, 0)) : Promise.resolve()));
  const out = silentOutputs();
  let errors = 0;
  let skipped = 0;
  const deps = {
    dmx: out.dmx,
    audio: out.audio,
    library,
    projection: () => {},
    later: () => {},
    onError: () => {
      errors++;
    },
  };
  const ctx = { role: "solo" as const, lookup: library.lookup };
  const times: number[] = [];
  let laps = 0;
  let state: PlaybackState = initialState(gos);
  if (!gos.length) return summarize([], 0, 0, 0);
  while (times.length < count) {
    const t0 = now();
    let res = go(state, gos, ctx);
    if (res.refused === "end") {
      // The end of the show: from the first GO again (the restart is part of the time of this GO).
      laps++;
      state = initialState(gos);
      res = go(state, gos, ctx);
    }
    if (res.refused) {
      // A GO this computer cannot give (it cannot happen with role "solo"): counted as an error, the test goes on.
      errors++;
      state = { ...state, standbyId: null };
      times.push(now() - t0);
      continue;
    }
    await runCommands(res.commands, deps);
    times.push(now() - t0);
    skipped += res.skipped.length;
    state = res.state;
    opts.onProgress?.(times.length, count);
    await pause(times.length);
  }
  return summarize(times, laps, errors, skipped);
}

/** "0,4 ms" / "12 ms". */
export function msText(ms: number, lang: string): string {
  const s = ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
  return lang === "it" ? s.replace(".", ",") : s;
}
