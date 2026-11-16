import { crossfadeAt, transitionDuration, type FadeLayout } from "../model/crossfade";
import { UNIVERSE_SIZE } from "../model/types";
import type { ConnectRequest, DmxApi, DmxDevice, DmxLive, DmxStatus, EngineLayout, EngineTransition, FadePayload, LinkState, MasterState, TestState } from "./dmx";

/**
 * The DMX engine in the browser: the same layers and rules as the Rust engine (src-tauri/src/dmx/core.rs),
 * with the fades of crossfade.ts. Nothing ever leaves the page. Used outside Tauri and always in `/?demo`.
 *
 * Layers: playback (setUniverse / fadeTo, pause, resume, stopFade) → output master (Grand Master and Fade to
 * black on the intensity mask, Blackout) → test pattern (replaces everything while active).
 * value = floor(v × gm/255 × ftb + 0.5), as in the engine.
 */

export const SIM_PERIOD = 1 / 40;
export const TEST_STEP = 1.5;
export const TEST_RISE = 0.5;

interface RunningFade {
  id: number;
  from: Uint8Array;
  to: Uint8Array;
  tr: EngineTransition;
  layout: FadeLayout;
  elapsed: number;
  total: number;
  paused: boolean;
}

const clean = (v: number) => (Number.isFinite(v) ? Math.max(0, v) : 0);

function toLayout(l: EngineLayout): FadeLayout {
  const intensity = new Uint8Array(UNIVERSE_SIZE).fill(1);
  const mover = new Int16Array(UNIVERSE_SIZE).fill(-1);
  l.intensity.slice(0, UNIVERSE_SIZE).forEach((v, i) => (intensity[i] = v ? 1 : 0));
  l.mover.slice(0, UNIVERSE_SIZE).forEach((v, i) => (mover[i] = v >= 0 && v < l.moverIntensity.length ? v : -1));
  return { intensity, mover, moverIntensity: l.moverIntensity };
}

const bytes = (v: ArrayLike<number>) => {
  const u = new Uint8Array(UNIVERSE_SIZE);
  for (let i = 0; i < Math.min(UNIVERSE_SIZE, v.length); i++) u[i] = Math.max(0, Math.min(255, Math.round(Number(v[i]) || 0)));
  return u;
};

/** Mirror of the Rust `Core`: pure, driven by `advance(now)` (seconds). */
export class SimCore {
  private playback: Uint8Array = new Uint8Array(UNIVERSE_SIZE);
  private fade: RunningFade | null = null;
  private lastFadeId = 0;
  private doneId = 0;
  private mask = new Uint8Array(UNIVERSE_SIZE).fill(1);
  private gm = 255;
  private bo = false;
  private ftbLevel = 1;
  private ftbTarget = 1;
  private ftbRate = 0;
  private test: { channels: number; level: number; t: number } | null = null;
  private now: number | null = null;

  advance(now: number) {
    const dt = this.now !== null && now > this.now ? now - this.now : 0;
    if (this.now === null || now > this.now) this.now = now;
    if (dt > 0) {
      if (this.fade && !this.fade.paused) this.fade.elapsed += dt;
      if (this.ftbLevel !== this.ftbTarget) {
        const step = this.ftbRate * dt;
        this.ftbLevel = this.ftbLevel < this.ftbTarget ? Math.min(this.ftbTarget, this.ftbLevel + step) : Math.max(this.ftbTarget, this.ftbLevel - step);
      }
      if (this.test) this.test.t += dt;
    }
    this.finishIfDone();
  }

  private finishIfDone() {
    if (this.fade && this.fade.elapsed >= this.fade.total) {
      this.playback = this.fade.to;
      this.doneId = this.fade.id;
      this.fade = null;
    }
  }

  playbackNow(): Uint8Array {
    if (!this.fade) return new Uint8Array(this.playback);
    const f = this.fade;
    return crossfadeAt(f.from, f.to, f.elapsed, { ...f.tr, autoFollow: false }, f.layout);
  }

  frame(): Uint8Array {
    if (this.test) {
      const out = new Uint8Array(UNIVERSE_SIZE);
      const tp = this.test;
      const ch = Math.floor(tp.t / TEST_STEP) % tp.channels;
      const k = Math.min(1, (tp.t % TEST_STEP) / TEST_RISE);
      out[ch] = Math.floor(tp.level * k + 0.5);
      return out;
    }
    const out = this.playbackNow();
    const factor = (this.gm / 255) * this.ftbLevel;
    if (factor >= 1 && !this.bo) return out;
    for (let i = 0; i < UNIVERSE_SIZE; i++) if (this.mask[i]) out[i] = this.bo ? 0 : Math.min(255, Math.floor(out[i] * factor + 0.5));
    return out;
  }

  setUniverse(values: ArrayLike<number>) {
    this.fade = null;
    this.playback = bytes(values);
  }

  fadeTo(target: ArrayLike<number>, tr: EngineTransition, layout: EngineLayout, id = 0): number {
    const from = this.playbackNow();
    const fid = id || this.lastFadeId + 1;
    this.lastFadeId = Math.max(this.lastFadeId, fid);
    this.playback = new Uint8Array(from);
    const t = { fadeIn: clean(tr.fadeIn), fadeOut: clean(tr.fadeOut), delay: clean(tr.delay), moveInDark: !!tr.moveInDark };
    this.fade = { id: fid, from, to: bytes(target), tr: t, layout: toLayout(layout), elapsed: 0, total: transitionDuration(t), paused: false };
    this.finishIfDone();
    return fid;
  }

  pause() {
    if (this.fade) this.fade.paused = true;
  }

  resume() {
    if (this.fade) this.fade.paused = false;
  }

  stopFade() {
    if (!this.fade) return;
    this.playback = this.playbackNow();
    this.fade = null;
  }

  blackout(on: boolean) {
    this.bo = on;
  }

  fadeToBlack(seconds: number) {
    this.ftbTo(0, seconds);
  }

  releaseBlack(seconds: number) {
    this.ftbTo(1, seconds);
  }

  private ftbTo(target: number, seconds: number) {
    this.ftbTarget = target;
    if (!Number.isFinite(seconds) || seconds <= 0) {
      this.ftbLevel = target;
      this.ftbRate = 0;
    } else this.ftbRate = 1 / seconds;
  }

  grandMaster(level: number, mask?: ArrayLike<number>) {
    if (mask) for (let i = 0; i < UNIVERSE_SIZE; i++) this.mask[i] = i < mask.length && mask[i] ? 1 : 0;
    this.gm = Math.max(0, Math.min(255, Math.round(level)));
  }

  startTest(channels: number, level: number) {
    this.test = { channels: Math.max(1, Math.min(UNIVERSE_SIZE, Math.round(channels))), level: Math.max(0, Math.min(255, Math.round(level))), t: 0 };
  }

  stopTest() {
    this.test = null;
  }

  fadeState() {
    const f = this.fade;
    if (f) return { id: f.id, active: true, paused: f.paused, progress: f.total > 0 ? Math.min(1, Math.max(0, f.elapsed / f.total)) : 1, elapsed: Math.min(f.elapsed, f.total), total: f.total, doneId: this.doneId };
    return { id: this.lastFadeId, active: false, paused: false, progress: this.doneId > 0 ? 1 : 0, elapsed: 0, total: 0, doneId: this.doneId };
  }

  masterState(): MasterState {
    return { blackout: this.bo, grandMaster: this.gm, ftbLevel: this.ftbLevel, ftbTarget: this.ftbTarget };
  }

  testState(): TestState | null {
    return this.test ? { channel: (Math.floor(this.test.t / TEST_STEP) % this.test.channels) + 1, of: this.test.channels } : null;
  }
}

/** Two cables and a built-in port, to try the Settings in the preview (`/?demo&dmxdevices`). */
export const EXAMPLE_DEVICES: DmxDevice[] = [
  { port: "COM3", usb: true, vid: 0x0403, pid: 0x6001, manufacturer: "ENTTEC", product: "DMX USB PRO", serial: "EN123456", chip: "FTDI FT232R / FT245R", guess: "pro", name: "DMX USB PRO" },
  { port: "COM4", usb: true, vid: 0x0403, pid: 0x6001, manufacturer: "FTDI", product: "USB Serial Port", serial: "A10KXYZ9", chip: "FTDI FT232R / FT245R", guess: "ftdi", name: "FTDI FT232R / FT245R" },
  { port: "COM1", usb: false, vid: null, pid: null, manufacturer: null, product: null, serial: null, chip: null, guess: "notUsb", name: "COM1" },
];

export interface SimOptions {
  /** List EXAMPLE_DEVICES and pretend to connect to them (preview of the Settings and of the chip states). */
  exampleDevices?: boolean;
  /** Clock in seconds (default: performance.now). */
  now?: () => number;
  /** Run the frame loop with a timer (default true); tests call `tick()` themselves. */
  timer?: boolean;
}

export type SimDmx = DmxApi & {
  /** One frame at `now` (default: the clock). */
  tick(now?: number): void;
  /** Preview only: the example cable is pulled out / plugged back in. */
  pullCable(): void;
  plugCable(): void;
  core: SimCore;
};

export function createSimDmx(opts: SimOptions = {}): SimDmx {
  const clock = opts.now ?? (() => performance.now() / 1000);
  const core = new SimCore();
  let status: DmxStatus = { link: { state: "idle" }, device: null, detail: null, lastError: null };
  let framesSent = 0;
  let windowStart = clock();
  let windowFrames = 0;
  let fps = 0;
  let unplugged = false;
  let lastOutput: Uint8Array = new Uint8Array(UNIVERSE_SIZE);
  let lastUnder: Uint8Array = new Uint8Array(UNIVERSE_SIZE);
  let lastOutputEmit = -1;
  let lastProgressEmit = -1;
  let lastLiveJson = "";
  let nextRetry = 0;
  const statusFns = new Set<(s: DmxStatus) => void>();
  const progressFns = new Set<(l: DmxLive) => void>();
  const outputFns = new Set<(o: Uint8Array, u: Uint8Array) => void>();

  const sending = () => status.link.state === "connected" || status.link.state === "simulated";
  const setStatus = (link: LinkState, device: DmxDevice | null = null, detail: string | null = null) => {
    status = { link, device, detail, lastError: status.lastError };
    fps = 0;
    windowFrames = 0;
    windowStart = clock();
    statusFns.forEach((f) => f(status));
  };
  const live = (): DmxLive => ({ fade: core.fadeState(), master: core.masterState(), test: core.testState(), fps: sending() ? fps : 0, framesSent });

  const tick = (at?: number) => {
    const now = at ?? clock();
    core.advance(now);
    const frame = core.frame();
    if (sending()) {
      framesSent++;
      windowFrames++;
    }
    if (now - windowStart >= 1) {
      fps = windowFrames / (now - windowStart);
      windowStart = now;
      windowFrames = 0;
    }
    const l = status.link;
    if (l.state === "lost" && !unplugged && now >= nextRetry) {
      const dev = EXAMPLE_DEVICES.find((d) => d.name === l.device) ?? null;
      setStatus({ state: "connected", device: l.device, kind: l.kind }, dev);
    } else if (l.state === "lost" && now >= nextRetry) {
      nextRetry = now + 1;
      setStatus({ ...l, attempts: l.attempts + 1 }, status.device);
    }
    // Output ≤ 20 Hz, progress ≤ 10 Hz, only when they change.
    if (now - lastOutputEmit >= 0.05) {
      const under = core.playbackNow();
      if (!same(frame, lastOutput) || !same(under, lastUnder)) {
        lastOutput = frame;
        lastUnder = under;
        lastOutputEmit = now;
        outputFns.forEach((f) => f(frame, under));
      }
    }
    if (now - lastProgressEmit >= 0.1) {
      const l2 = live();
      const json = JSON.stringify(l2);
      if (json !== lastLiveJson) {
        lastLiveJson = json;
        lastProgressEmit = now;
        progressFns.forEach((f) => f(l2));
      }
    }
  };

  const act = (fn: () => void) => {
    core.advance(clock());
    fn();
    return Promise.resolve();
  };

  const connectExample = (req: ConnectRequest) => {
    const cables = EXAMPLE_DEVICES.filter((d) => d.guess === "pro" || d.guess === "ftdi");
    if (req.mode === "port") {
      const d = EXAMPLE_DEVICES.find((x) => x.port === req.port);
      if (!d) return setStatus({ state: "error", code: "notFound", message: `${req.port} not found` });
      return setStatus({ state: "connected", device: d.name, kind: req.kind }, d, req.kind === "pro" && d.guess === "pro" ? "firmware 1.44 · serial 12345678" : null);
    }
    if (req.mode !== "auto") return;
    const d = cables.find((x) => x.port === req.prefer) ?? cables[0];
    const kind = req.kind ?? (d.guess === "pro" ? "pro" : "open");
    setStatus({ state: "connected", device: d.name, kind }, d, kind === "pro" && d.guess === "pro" ? "firmware 1.44 · serial 12345678" : null);
  };

  const api: SimDmx = {
    simulated: true,
    core,
    tick,
    listDevices: () => Promise.resolve(opts.exampleDevices ? EXAMPLE_DEVICES.map((d) => ({ ...d })) : []),
    connect: (req) =>
      act(() => {
        unplugged = false;
        if (req.mode === "simulated") setStatus({ state: "simulated" });
        else if (opts.exampleDevices) connectExample(req);
        // A plain browser has no serial ports.
        else if (req.mode === "auto") setStatus({ state: "error", code: "noCable", message: "no USB-DMX cable found" });
        else setStatus({ state: "error", code: "notFound", message: `${req.port} not found` });
        if (sending()) tick();
      }),
    disconnect: () => act(() => setStatus({ state: "idle" })),
    setUniverse: (values) => act(() => core.setUniverse(values)),
    fadeTo: (p: FadePayload) => {
      core.advance(clock());
      return Promise.resolve(core.fadeTo(p.target, p.transition, p.layout));
    },
    pause: () => act(() => core.pause()),
    resume: () => act(() => core.resume()),
    stopFade: () => act(() => core.stopFade()),
    blackout: (on) => act(() => core.blackout(on)),
    fadeToBlack: (s) => act(() => core.fadeToBlack(s)),
    releaseBlack: (s) => act(() => core.releaseBlack(s)),
    grandMaster: (level, mask) => act(() => core.grandMaster(level, mask)),
    getStatus: () => {
      core.advance(clock());
      return Promise.resolve({ status, live: live(), output: Array.from(core.frame()), under: Array.from(core.playbackNow()) });
    },
    testOutput: (on, channels = 24, level = 128) => act(() => (on ? core.startTest(channels, level) : core.stopTest())),
    onStatus: (fn) => (statusFns.add(fn), () => statusFns.delete(fn)),
    onProgress: (fn) => (progressFns.add(fn), () => progressFns.delete(fn)),
    onOutput: (fn) => (outputFns.add(fn), () => outputFns.delete(fn)),
    pullCable: () => {
      const l = status.link;
      if (l.state !== "connected") return;
      unplugged = true;
      nextRetry = clock() + 1;
      status = { ...status, lastError: "device removed" };
      setStatus({ state: "lost", device: l.device, kind: l.kind, sinceMs: Date.now(), attempts: 0 }, status.device);
    },
    plugCable: () => {
      unplugged = false;
    },
  };
  if (opts.timer !== false && typeof window !== "undefined") window.setInterval(() => tick(), SIM_PERIOD * 1000);
  return api;
}

function same(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
