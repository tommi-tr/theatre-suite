import { create } from "zustand";
import { dmxApi, isDemo, type ConnectRequest, type DmxApi, type DmxDevice, type DmxLive, type DmxStatus, type FadePayload } from "../lib/dmx";
import { useSettings, type Settings } from "./settings";

/**
 * The DMX output as the interface sees it — **the single door to the lights**. Every later part (Controllo luci,
 * Banco, Show) reaches the output only through these actions; none calls the engine directly.
 *
 * - `status`: the connection (idle, connecting, connected, simulated, lost, error) and the device.
 * - `output`: what is on stage now (512 values on the cable, after the output master), kept current also during
 *   fades (≤ 20 updates a second); `under`: the same before the output master (what Blackout gives back).
 * - `live`: the running fade (progress, paused), the output master (Blackout, Fade to black, Grand Master),
 *   the test pattern, frames per second.
 * Nothing is sent until `connect`; in `/?demo` the output is simulated from the start.
 */

const IDLE: DmxStatus = { link: { state: "idle" }, device: null, detail: null, lastError: null };
const LIVE0: DmxLive = {
  fade: { id: 0, active: false, paused: false, progress: 0, elapsed: 0, total: 0, doneId: 0 },
  master: { blackout: false, grandMaster: 255, ftbLevel: 1, ftbTarget: 1 },
  test: null,
  fps: 0,
  framesSent: 0,
};

interface OutputStore {
  ready: boolean;
  /** True when the output is the browser simulator (preview, `/?demo`). */
  browser: boolean;
  status: DmxStatus;
  live: DmxLive;
  output: Uint8Array;
  under: Uint8Array;
  devices: DmxDevice[];
  devicesLoading: boolean;
  /** Set when "Connetti" found no cable or failed: the chip explains what to do. Cleared by the next connect. */
  problemOpen: boolean;
  init: () => Promise<void>;
  refreshDevices: () => Promise<DmxDevice[]>;
  /** Connects with the choices of the Settings (or with an explicit request). */
  connect: (request?: ConnectRequest) => Promise<void>;
  useSimulated: () => Promise<void>;
  disconnect: () => Promise<void>;
  setProblemOpen: (open: boolean) => void;
  setUniverse: (values: ArrayLike<number>) => Promise<void>;
  fadeTo: (payload: FadePayload) => Promise<number>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stopFade: () => Promise<void>;
  blackout: (on: boolean) => Promise<void>;
  fadeToBlack: (seconds: number) => Promise<void>;
  releaseBlack: (seconds: number) => Promise<void>;
  setGrandMaster: (level: number, mask?: number[]) => Promise<void>;
  startTest: (channels: number) => Promise<void>;
  stopTest: () => Promise<void>;
}

/** The connection the Settings ask for (type Automatico/Pro/Open DMX, device Automatico or a port). */
export function requestFromSettings(s: Pick<Settings, "dmxDevice" | "dmxType">): ConnectRequest {
  if (s.dmxType === "auto") return { mode: "auto", prefer: s.dmxDevice };
  if (s.dmxDevice) return { mode: "port", port: s.dmxDevice, kind: s.dmxType };
  return { mode: "auto", kind: s.dmxType };
}

/** Level of the test pattern: about half, enough to see a light without dazzling anyone. */
export const TEST_LEVEL = 128;

let engine: DmxApi | null = null;
let starting: Promise<void> | null = null;

async function api(): Promise<DmxApi> {
  if (!engine) await useOutput.getState().init();
  return engine!;
}

const report = (e: unknown) => console.error("[dmx]", e);

export const useOutput = create<OutputStore>((set, get) => ({
  ready: false,
  browser: false,
  status: IDLE,
  live: LIVE0,
  output: new Uint8Array(512),
  under: new Uint8Array(512),
  devices: [],
  devicesLoading: false,
  problemOpen: false,
  init: () => {
    if (starting) return starting;
    starting = (async () => {
      const a = await dmxApi();
      engine = a;
      a.onStatus((status) => {
        set({ status });
        if (status.link.state === "error") set({ problemOpen: true });
      });
      a.onProgress((live) => set({ live }));
      a.onOutput((output, under) => set({ output, under }));
      try {
        const s = await a.getStatus();
        set({ status: s.status, live: s.live, output: Uint8Array.from(s.output), under: Uint8Array.from(s.under) });
      } catch (e) {
        report(e);
      }
      set({ ready: true, browser: a.simulated });
      if (isDemo() && get().status.link.state === "idle") await a.connect({ mode: "simulated" });
    })();
    return starting;
  },
  refreshDevices: async () => {
    set({ devicesLoading: true });
    try {
      const devices = await (await api()).listDevices();
      set({ devices });
      return devices;
    } catch (e) {
      report(e);
      return get().devices;
    } finally {
      set({ devicesLoading: false });
    }
  },
  connect: async (request) => {
    set({ problemOpen: false });
    const req = request ?? requestFromSettings(useSettings.getState().settings);
    await (await api()).connect(req);
  },
  useSimulated: async () => {
    set({ problemOpen: false });
    await (await api()).connect({ mode: "simulated" });
  },
  disconnect: async () => {
    set({ problemOpen: false });
    await (await api()).disconnect();
  },
  setProblemOpen: (problemOpen) => set({ problemOpen }),
  setUniverse: async (values) => (await api()).setUniverse(values),
  fadeTo: async (payload) => (await api()).fadeTo(payload),
  pause: async () => (await api()).pause(),
  resume: async () => (await api()).resume(),
  stopFade: async () => (await api()).stopFade(),
  blackout: async (on) => (await api()).blackout(on),
  fadeToBlack: async (seconds) => (await api()).fadeToBlack(seconds),
  releaseBlack: async (seconds) => (await api()).releaseBlack(seconds),
  setGrandMaster: async (level, mask) => (await api()).grandMaster(level, mask),
  startTest: async (channels) => (await api()).testOutput(true, channels, TEST_LEVEL),
  stopTest: async () => (await api()).testOutput(false),
}));

/** Is something actually going out (a cable, or the simulated output)? */
export const isSending = (s: DmxStatus) => s.link.state === "connected" || s.link.state === "simulated";
