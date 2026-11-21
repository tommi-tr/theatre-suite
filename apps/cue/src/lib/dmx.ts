import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TFunc } from "@theatre-suite/core";
import { cleanSeconds, fadeToArgs } from "@theatre-suite/show-files/granvelo";
import { asBytes, UNIVERSE_NUMBER } from "@theatre-suite/show-files/granvelo/engine";
import type { DmxApi, DmxErrorCode, DmxLive, DmxSnapshot, DmxStatus, DmxDevice, LinkState } from "@theatre-suite/show-files/granvelo/dmxApi";
import { isTauri } from "./api";

export type { CableKind, ConnectRequest, DmxApi, DmxDevice, DmxErrorCode, DmxLive, DmxSnapshot, DmxStatus, LinkState } from "@theatre-suite/show-files/granvelo/dmxApi";
export type { FadePayload } from "@theatre-suite/show-files/granvelo/engine";

/**
 * Cue's DMX output, typed: the same `DmxApi` as Granvelo (shared in `@theatre-suite/show-files/granvelo/dmxApi`).
 * - `tauriDmx`: Cue's native engine (src-tauri/src/dmx.rs; events `cue-dmx-status`, `cue-dmx-progress`,
 *   `cue-dmx-output`);
 * - the browser simulator shared with Granvelo (`createSimDmx`), used outside Tauri and always in `/?demo`, where it
 *   is connected at once to "Uscita simulata" so the screens show lights moving.
 * Fades come from `Library.fadePayload` (model/sources.ts), built with Granvelo's own code.
 */

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

/** The native engine of Cue. */
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
  onStatus: (fn) => subscribe<DmxStatus>("cue-dmx-status", fn),
  onProgress: (fn) => subscribe<DmxLive>("cue-dmx-progress", fn),
  onOutput: (fn) => subscribe<{ output: number[]; under: number[] }>("cue-dmx-output", (p) => fn(Uint8Array.from(p.output), Uint8Array.from(p.under))),
};

const isDemoUrl = () => typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");

let chosen: Promise<DmxApi> | null = null;

/** The engine to use: native in the app, the simulator in the browser and in `/?demo` (connected to "Uscita simulata"). */
export function dmxApi(): Promise<DmxApi> {
  if (!chosen)
    chosen = (async () => {
      if (isTauri && !isDemoUrl()) return tauriDmx;
      const { createSimDmx } = await import("@theatre-suite/show-files/granvelo/dmxSim");
      const sim = createSimDmx({ exampleDevices: typeof location !== "undefined" && location.search.includes("dmxdevices") });
      // Preview tooling: `__cueDmx.pullCable()` / `.plugCable()` show the "cable unplugged" states.
      if (typeof window !== "undefined") (window as unknown as { __cueDmx?: unknown }).__cueDmx = sim;
      if (isDemoUrl()) await sim.connect({ mode: "simulated" });
      return sim;
    })();
  return chosen;
}

/** What went wrong connecting the DMX cable, in plain words (title and what to do). */
export function dmxProblemText(t: TFunc, code: DmxErrorCode): { title: string; text: string } {
  switch (code) {
    case "busy":
      return {
        title: t("The DMX cable is used by another program (maybe Granvelo): close it and try again"),
        text: t("Only one program at a time can send to the DMX cable. Close Granvelo (or the other lighting program), then press Connect."),
      };
    case "noCable":
      return { title: t("No USB-DMX cable found"), text: t("Plug the cable into a USB port of the computer and press Connect again.") };
    case "notFound":
      return { title: t("The chosen DMX cable is not there"), text: t("Check that the cable is plugged in, or choose the automatic choice in Settings → Outputs.") };
    case "openFailed":
      return { title: t("The DMX cable does not answer"), text: t("Unplug the cable, plug it back in and try again.") };
    case "chooseCable":
      return { title: t("Which one is the DMX cable?"), text: t("Several USB adapters could be the cable: choose it in Settings → Outputs, then press Connect.") };
    case "engineStopped":
      return { title: t("The DMX output stopped after an internal error"), text: t("The lights keep their last state. Cue restarted the output without sending anything: press Connect to go on.") };
  }
}

/** A short line for the state of the DMX output (status pill, Controlli). */
export function dmxLinkText(t: TFunc, link: LinkState): string {
  switch (link.state) {
    case "idle":
      return t("Not connected");
    case "connecting":
      return t("Connecting…");
    case "connected":
      return t("Connected · {device}", { device: link.device });
    case "simulated":
      return t("Simulated output");
    case "lost":
      return t("DMX cable unplugged: plug it back in");
    case "error":
      return dmxProblemText(t, link.code).title;
  }
}
