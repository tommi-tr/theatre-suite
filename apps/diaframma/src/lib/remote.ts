import { uid } from "@theatre-suite/core";
import { api, isTauri, onEvent } from "./api";
import { useDoc } from "../state/doc";
import { useSettings } from "../state/settings";
import { useRh } from "../state/rehearsal";

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
    if (n.favorites !== s.favorites || n.rhMain !== s.rhMain) push();
    s = n;
  });
  const un4 = useRh.subscribe(() => push());
  let locked = useDoc.getState().locked;
  const un2 = useDoc.subscribe((d) => {
    if (d.locked !== locked) {
      locked = d.locked;
      push();
    }
  });
  let timer: number | null = null;
  const push = () => {
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      const st = useSettings.getState().settings;
      api.phoneUpdate(useDoc.getState().locked, st.favorites.slice(0, 50), useRh.getState().levels, st.rhMain).catch(() => {});
    }, 150);
  };
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
  // Main volume of the show moved on the phone.
  const un5 = onEvent<number>("phone-main-volume", (db) => useSettings.getState().update({ mainDb: Math.max(-60, Math.min(10, db)) }));
  // A favorite removed on the phone.
  const un6 = onEvent<string>("phone-unstar", (id) => {
    const favs = useSettings.getState().settings.favorites;
    useSettings.getState().update({ favorites: favs.filter((f) => f.id !== id) });
  });
  // Volume of a rehearsal source moved on the phone.
  const un7 = onEvent<{ id: string; v: number }>("phone-rh-volume", async ({ id, v }) => {
    try {
      const snap = await api.rhSnapshot();
      const src = snap.sources.find((x) => x.id === id);
      if (src) useRh.getState().setLevel(src, v);
    } catch {
      /* ignore */
    }
  });
  return () => {
    un1();
    un2();
    un3.then((f) => f());
    un4();
    un5.then((f) => f());
    un6.then((f) => f());
    un7.then((f) => f());
  };
}
