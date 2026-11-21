import { create } from "zustand";
import type { LiveState } from "@theatre-suite/show-files/diaframma";
import { audioApi } from "../lib/audio";
import { dmxApi, type DmxStatus } from "../lib/dmx";

/**
 * What the outputs are doing, for the status pills and the "cable unplugged" band: the DMX link (native engine or
 * the simulator in `/?demo`) and the audio engine's live state (voices playing: the audio boxes turn green while
 * their sound plays).
 */
interface OutputsStore {
  dmx: DmxStatus | null;
  dmxSimulated: boolean;
  audio: LiveState | null;
  audioSimulated: boolean;
}

export const useOutputs = create<OutputsStore>(() => ({ dmx: null, dmxSimulated: false, audio: null, audioSimulated: false }));

/** Watches both engines (call once, at start). */
export function startOutputs(): () => void {
  const stops: (() => void)[] = [];
  let gone = false;
  void dmxApi().then(async (d) => {
    if (gone) return;
    useOutputs.setState({ dmxSimulated: d.simulated });
    stops.push(d.onStatus((dmx) => useOutputs.setState({ dmx })));
    const snap = await d.getStatus().catch(() => null);
    if (snap && !gone) useOutputs.setState({ dmx: snap.status });
  });
  void audioApi().then(async (a) => {
    if (gone) return;
    useOutputs.setState({ audioSimulated: a.simulated });
    stops.push(a.onState((audio) => useOutputs.setState({ audio })));
    const s = await a.state().catch(() => null);
    if (s && !gone) useOutputs.setState({ audio: s });
  });
  return () => {
    gone = true;
    stops.forEach((f) => f());
  };
}

/**
 * The DMX cable is connected the first time the Show needs it (native app only; in `/?demo` the simulator is
 * already on "Uscita simulata"). A cable that is not found leaves the pill red with the reason; nothing else changes.
 */
export async function ensureDmx(): Promise<void> {
  const d = await dmxApi();
  if (d.simulated) return;
  const link = useOutputs.getState().dmx?.link.state ?? "idle";
  if (link !== "idle") return;
  await d.connect({ mode: "auto" }).catch(() => {});
}
