import { showEngineConfig, engineTracks as tracksForEngine } from "@theatre-suite/show-files/diaframma/engine";
import { api, isTauri, type EngineConfig, type EngineTrack } from "./api";
import { useDoc } from "../state/doc";
import { useSettings } from "../state/settings";

export function engineConfig(): EngineConfig {
  return showEngineConfig(useSettings.getState().settings);
}

export function engineTracks(): EngineTrack[] {
  const { tracks, missing } = useDoc.getState();
  return tracksForEngine(tracks, missing);
}

/**
 * Keeps the native engine in step with the document and the settings.
 * The engine is the single source of truth for what is playing and for standby.
 */
export function startEngineSync(): () => void {
  if (!isTauri) return () => {};
  let pending = false;
  const push = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      api.engineSync(engineTracks(), engineConfig()).catch((e) => console.error("engine sync failed", e));
    });
  };
  push();
  let prevTracks = useDoc.getState().tracks;
  let prevMissing = useDoc.getState().missing;
  const un1 = useDoc.subscribe((s) => {
    if (s.tracks !== prevTracks || s.missing !== prevMissing) {
      prevTracks = s.tracks;
      prevMissing = s.missing;
      push();
    }
  });
  let prevSettings = useSettings.getState().settings;
  const un2 = useSettings.subscribe((s) => {
    if (s.settings !== prevSettings) {
      const deviceChanged = s.settings.outputDevice !== prevSettings.outputDevice;
      prevSettings = s.settings;
      push();
      if (deviceChanged) {
        api.engineSetDevice(s.settings.outputDevice).catch((e) => console.error(e));
        api.padsSetDevice(s.settings.outputDevice).catch(() => {});
      }
    }
  });
  api.engineSetDevice(useSettings.getState().settings.outputDevice).catch((e) => console.error(e));
  return () => {
    un1();
    un2();
  };
}
