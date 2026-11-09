import { api, isTauri, type EngineConfig, type EngineTrack } from "./api";
import { useDoc } from "../state/doc";
import { useSettings } from "../state/settings";

export function engineConfig(): EngineConfig {
  const s = useSettings.getState().settings;
  return {
    othersOnGo: s.othersOnGo,
    autoAdvance: s.autoAdvance,
    fadeInSec: s.fadeInSec,
    fadeOutSec: s.fadeOutSec,
    crossfadeSec: s.crossfadeSec,
    quickFadeSec: s.quickFadeSec,
    stopAllSec: s.stopAllSec,
    mainDb: s.mainDb,
    numberFrom: s.numberFrom,
    steps: true,
  };
}

export function engineTracks(): EngineTrack[] {
  const { tracks, missing } = useDoc.getState();
  return tracks.map(({ file, ...rest }) => ({ ...rest, path: file && !missing[rest.id] ? file.path : null }));
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
