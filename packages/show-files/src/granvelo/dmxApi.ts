import type { FadePayload } from "./engine";

/**
 * The DMX output engine as the interface sees it, shared by Granvelo and Cue: the native engine
 * (`crates/dmx-engine`, through each app's Tauri commands) and the browser simulator (`dmxSim.ts`) implement the
 * same `DmxApi`. Moved here from Granvelo's `lib/dmx.ts` (which re-exports it) so that Cue drives the same engine
 * with the same types and the same simulator.
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

export type Unlisten = () => void;

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
