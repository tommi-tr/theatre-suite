import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText as clipboardWrite } from "@tauri-apps/plugin-clipboard-manager";
import { isTauri } from "./api";
import { cleanSeconds, fadeToArgs } from "../model/enginePayload";
import { asBytes, UNIVERSE_NUMBER, type FadePayload } from "@theatre-suite/show-files/granvelo/engine";

/** The payload shapes of the engine commands live in the shared package (Cue sends the same fades). */
export { UNIVERSE_NUMBER, type EngineLayout, type EngineTransition, type FadePayload } from "@theatre-suite/show-files/granvelo/engine";

/**
 * The DMX output engine, typed. Two implementations of the same interface:
 * - `tauriDmx`: the native engine (Rust, its own thread, src-tauri/src/dmx);
 * - `createSimDmx()` (dmxSim.ts): a browser simulator running the same fades with crossfade.ts,
 *   used outside Tauri and always in `/?demo`, so every phase works in the browser preview.
 * The app reaches the output only through `store/output.ts`, which picks one with `dmxApi()`.
 */

export type CableKind = "pro" | "open";
export type DmxKind = CableKind | "simulated";

/** The engine's guess about a serial port. */
export type DeviceGuess = "pro" | "ftdi" | "otherUsb" | "notUsb";

export interface DmxDevice {
  /** "COM3", "/dev/ttyUSB0"… */
  port: string;
  usb: boolean;
  vid: number | null;
  pid: number | null;
  manufacturer: string | null;
  product: string | null;
  serial: string | null;
  /** The chip known from VID/PID ("FTDI FT232R / FT245R"…). */
  chip: string | null;
  guess: DeviceGuess;
  /** A short name to show. */
  name: string;
}

/** `chooseCable`: several possible cables, none answered as a Pro (choose one in the Settings).
 *  `engineStopped`: the engine had an internal error; it restarted without sending. */
export type DmxErrorCode = "noCable" | "notFound" | "busy" | "openFailed" | "chooseCable" | "engineStopped";

export type LinkState =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "connected"; device: string; kind: CableKind }
  | { state: "simulated" }
  | { state: "lost"; device: string; kind: CableKind; sinceMs: number; attempts: number }
  | { state: "error"; code: DmxErrorCode; message: string };

export interface DmxStatus {
  link: LinkState;
  device: DmxDevice | null;
  /** "firmware 1.44 · serial 12345678" when a Pro answered. */
  detail: string | null;
  lastError: string | null;
}

export interface FadeState {
  /** Id of the running fade (as returned by `fadeTo`), or of the last one. */
  id: number;
  active: boolean;
  paused: boolean;
  /** 0–1. */
  progress: number;
  elapsed: number;
  total: number;
  /** Id of the last fade that reached its end (0 = none). */
  doneId: number;
}

export interface MasterState {
  blackout: boolean;
  grandMaster: number;
  /** 1 = full, 0 = black. */
  ftbLevel: number;
  /** 0 = going to black, 1 = released. */
  ftbTarget: number;
}

export interface TestState {
  /** 1-based channel being raised. */
  channel: number;
  of: number;
}

export interface DmxLive {
  fade: FadeState;
  master: MasterState;
  test: TestState | null;
  /** Frames per second actually sent (0 when not sending). */
  fps: number;
  framesSent: number;
}

export interface DmxSnapshot {
  status: DmxStatus;
  live: DmxLive;
  /** 512 values on the cable (after the output master). */
  output: number[];
  /** 512 values under the output master. */
  under: number[];
}

export type ConnectRequest =
  | { mode: "auto"; prefer?: string | null; kind?: CableKind | null }
  | { mode: "port"; port: string; kind: CableKind }
  | { mode: "simulated" };

type Unlisten = () => void;

export interface DmxApi {
  /** True for the browser simulator. */
  readonly simulated: boolean;
  listDevices(): Promise<DmxDevice[]>;
  connect(request: ConnectRequest): Promise<void>;
  /** Stops sending; no blackout is sent. */
  disconnect(): Promise<void>;
  /** Immediate values; ends a running fade. */
  setUniverse(values: ArrayLike<number>, universe?: number): Promise<void>;
  /** Starts a transition from the current values; resolves to its id. */
  fadeTo(payload: FadePayload): Promise<number>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stopFade(): Promise<void>;
  blackout(on: boolean): Promise<void>;
  fadeToBlack(seconds: number): Promise<void>;
  releaseBlack(seconds: number): Promise<void>;
  /** 0–255 on the intensity channels; `mask` (512 × 0/1) replaces the intensity mask. */
  grandMaster(level: number, mask?: number[], universe?: number): Promise<void>;
  getStatus(): Promise<DmxSnapshot>;
  testOutput(on: boolean, channels?: number, level?: number): Promise<void>;
  onStatus(fn: (s: DmxStatus) => void): Unlisten;
  onProgress(fn: (l: DmxLive) => void): Unlisten;
  onOutput(fn: (output: Uint8Array, under: Uint8Array) => void): Unlisten;
}

function subscribe<T>(name: string, fn: (p: T) => void): Unlisten {
  let stop: Unlisten | null = null;
  let gone = false;
  void listen<T>(name, (e) => fn(e.payload)).then((u) => {
    if (gone) u();
    else stop = u;
  });
  return () => {
    gone = true;
    stop?.();
  };
}

/** The native engine. */
export const tauriDmx: DmxApi = {
  simulated: false,
  listDevices: () => invoke<DmxDevice[]>("dmx_list_devices"),
  connect: (request) => invoke("dmx_connect", { request }),
  disconnect: () => invoke("dmx_disconnect"),
  setUniverse: (values, universe = UNIVERSE_NUMBER) => invoke("dmx_set_universe", { values: asBytes(values), universe }),
  fadeTo: (p) => invoke<number>("dmx_fade_to", fadeToArgs(p)),
  pause: () => invoke("dmx_pause"),
  resume: () => invoke("dmx_resume"),
  stopFade: () => invoke("dmx_stop_fade"),
  blackout: (on) => invoke("dmx_blackout", { on }),
  fadeToBlack: (seconds) => invoke("dmx_fade_to_black", { seconds: cleanSeconds(seconds) }),
  releaseBlack: (seconds) => invoke("dmx_release_black", { seconds: cleanSeconds(seconds) }),
  grandMaster: (level, mask, universe = UNIVERSE_NUMBER) =>
    invoke("dmx_grand_master", { level: Number.isFinite(level) ? Math.max(0, Math.min(255, Math.round(level))) : 255, mask: mask ? asBytes(mask) : null, universe }),
  getStatus: () => invoke<DmxSnapshot>("dmx_get_status"),
  testOutput: (on, channels, level) => invoke("dmx_test_output", { on, channels: channels ?? null, level: level ?? null }),
  onStatus: (fn) => subscribe<DmxStatus>("dmx-status", fn),
  onProgress: (fn) => subscribe<DmxLive>("dmx-progress", fn),
  onOutput: (fn) => subscribe<{ output: number[]; under: number[] }>("dmx-output", (p) => fn(Uint8Array.from(p.output), Uint8Array.from(p.under))),
};

/** Is this the browser demo (`/?demo`)? Then the output is always simulated. */
export const isDemo = () => typeof location !== "undefined" && location.search.includes("demo");

let chosen: DmxApi | null = null;

/** The engine to use: native in the app, the simulator in the browser and in `/?demo`. */
export async function dmxApi(): Promise<DmxApi> {
  if (chosen) return chosen;
  if (isTauri && !isDemo()) chosen = tauriDmx;
  else {
    const { createSimDmx } = await import("./dmxSim");
    const sim = createSimDmx({ exampleDevices: typeof location !== "undefined" && location.search.includes("dmxdevices") });
    // Preview tooling: `__granveloSim.pullCable()` / `.plugCable()` show the "cable unplugged" states.
    if (typeof window !== "undefined") (window as unknown as { __granveloSim?: unknown }).__granveloSim = sim;
    chosen = sim;
  }
  return chosen;
}

/** Copies text to the system clipboard (the browser one in the preview). */
export async function copyText(text: string): Promise<void> {
  if (isTauri) await clipboardWrite(text);
  else await navigator.clipboard?.writeText(text);
}

const hex4 = (n: number | null) => (n === null ? "----" : n.toString(16).toUpperCase().padStart(4, "0"));

/** The device list as plain text, to paste to the developers ("Copia i dettagli del cavo"). */
export function devicesReport(devices: DmxDevice[], status: DmxStatus | null, about: string): string {
  const lines = [`${about} · serial ports found: ${devices.length}`];
  if (status) {
    const l = status.link;
    const state = l.state === "connected" ? `connected (${l.kind}) to ${l.device}` : l.state === "lost" ? `lost (${l.kind}) ${l.device}, ${l.attempts} attempts` : l.state === "error" ? `error ${l.code}: ${l.message}` : l.state;
    lines.push(`Output: ${state}${status.device ? ` on ${status.device.port}` : ""}${status.detail ? ` · ${status.detail}` : ""}${status.lastError ? ` · last error: ${status.lastError}` : ""}`);
  }
  for (const d of devices) {
    const parts = [d.port, d.name];
    if (d.usb) parts.push(`USB ${hex4(d.vid)}:${hex4(d.pid)}`);
    else parts.push("not USB");
    if (d.manufacturer) parts.push(`manufacturer "${d.manufacturer}"`);
    if (d.product) parts.push(`product "${d.product}"`);
    if (d.serial) parts.push(`serial "${d.serial}"`);
    if (d.chip) parts.push(`chip ${d.chip}`);
    parts.push(`guess ${d.guess}`);
    lines.push(`- ${parts.join(" · ")}`);
  }
  return lines.join("\n");
}
