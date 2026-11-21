import { useEffect, useState } from "react";
import { audioApi, type LiveState } from "../lib/audio";
import { dmxApi, type DmxStatus } from "../lib/dmx";
import { useSettings } from "../store/settings";

/** The state of the sound output (the engine's own report), updated while the component is shown. */
export function useAudioStatus(): { simulated: boolean; engine: LiveState["engine"] | null } {
  const [st, setSt] = useState<{ simulated: boolean; engine: LiveState["engine"] | null }>({ simulated: false, engine: null });
  useEffect(() => {
    let off: (() => void) | null = null;
    let gone = false;
    void audioApi().then(async (api) => {
      if (gone) return;
      const first = await api.state().catch(() => null);
      if (!gone) setSt({ simulated: api.simulated, engine: first?.engine ?? null });
      off = api.onState((s) => setSt({ simulated: api.simulated, engine: s.engine }));
    });
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  return st;
}

/** The state of the DMX cable. */
export function useDmxStatus(): { simulated: boolean; status: DmxStatus | null } {
  const [st, setSt] = useState<{ simulated: boolean; status: DmxStatus | null }>({ simulated: false, status: null });
  useEffect(() => {
    let off: (() => void) | null = null;
    let gone = false;
    void dmxApi().then(async (api) => {
      if (gone) return;
      const snap = await api.getStatus().catch(() => null);
      if (!gone) setSt({ simulated: api.simulated, status: snap?.status ?? null });
      off = api.onStatus((status) => setSt({ simulated: api.simulated, status }));
    });
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  return st;
}

/** At start: the sound output chosen last time (settings) is asked of the engine. Errors are not fatal: the default stays. */
export async function applySavedOutputs(): Promise<void> {
  const name = useSettings.getState().settings.audioDevice;
  if (!name) return;
  try {
    await (await audioApi()).setDevice(name);
  } catch (e) {
    console.warn("saved sound output not available", e);
  }
}
