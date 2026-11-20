import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText as clipboardWrite } from "@tauri-apps/plugin-clipboard-manager";
import { isTauri } from "./api";
import { cleanSeconds, fadeToArgs } from "../model/enginePayload";
import { asBytes, UNIVERSE_NUMBER } from "@theatre-suite/show-files/granvelo/engine";

/** The payload shapes of the engine commands live in the shared package (Cue sends the same fades). */
export { UNIVERSE_NUMBER, type EngineLayout, type EngineTransition, type FadePayload } from "@theatre-suite/show-files/granvelo/engine";

/**
 * The DMX output engine, typed. Two implementations of the same interface:
 * - `tauriDmx`: the native engine (Rust, its own thread, src-tauri/src/dmx);
 * - `createSimDmx()` (dmxSim.ts): a browser simulator running the same fades with crossfade.ts,
 *   used outside Tauri and always in `/?demo`, so every phase works in the browser preview.
 * The app reaches the output only through `store/output.ts`, which picks one with `dmxApi()`.
 */

/** The engine's types are shared with Cue (`@theatre-suite/show-files/granvelo/dmxApi`). */
export type {
  CableKind,
  DmxKind,
  DeviceGuess,
  DmxDevice,
  DmxErrorCode,
  LinkState,
  DmxStatus,
  FadeState,
  MasterState,
  TestState,
  DmxLive,
  DmxSnapshot,
  ConnectRequest,
  DmxApi,
} from "@theatre-suite/show-files/granvelo/dmxApi";
import type { DmxApi, DmxDevice, DmxLive, DmxSnapshot, DmxStatus } from "@theatre-suite/show-files/granvelo/dmxApi";

type Unlisten = () => void;

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
