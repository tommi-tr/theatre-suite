import { uid } from "@theatre-suite/core";
import { api, isTauri, onEvent } from "./api";
import { useDoc } from "../state/doc";
import { useSettings } from "../state/settings";

/**
 * Keeps the native connections in step with the settings (they stay off
 * until the user turns them on) and gives the phone what it needs to show.
 */
export function startRemoteSync(): () => void {
  if (!isTauri) return () => {};
  let s = useSettings.getState().settings;
  api.extEnable(s.extensionBridgeEnabled).catch(() => {});
  if (s.phoneEnabled) api.phoneEnable(true).catch(() => {});
  const un1 = useSettings.subscribe((st) => {
    const n = st.settings;
    if (n.extensionBridgeEnabled !== s.extensionBridgeEnabled) api.extEnable(n.extensionBridgeEnabled).catch(() => {});
    if (n.phoneEnabled !== s.phoneEnabled) api.phoneEnable(n.phoneEnabled).catch(() => {});
    if (n.favorites !== s.favorites) push();
    s = n;
  });
  let locked = useDoc.getState().locked;
  const un2 = useDoc.subscribe((d) => {
    if (d.locked !== locked) {
      locked = d.locked;
      push();
    }
  });
  const push = () => api.phoneUpdate(useDoc.getState().locked, useSettings.getState().settings.favorites.slice(0, 50)).catch(() => {});
  push();
  // ★ pressed on the phone.
  const un3 = onEvent<string>("phone-star", async (id) => {
    try {
      const snap = await api.rhSnapshot();
      const src = snap.sources.find((x) => x.id === id);
      if (!src) return;
      const favs = useSettings.getState().settings.favorites;
      useSettings.getState().update({
        favorites: [{ id: uid(), title: src.title || src.app, artist: src.artist, source: src.app, at: new Date().toISOString(), positionSec: src.positionSec, link: null }, ...favs].slice(0, 500),
      });
    } catch {
      /* ignore */
    }
  });
  return () => {
    un1();
    un2();
    un3.then((f) => f());
  };
}
