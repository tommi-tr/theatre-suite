import { api, isTauri, onEvent, type ExtTabs, type PhoneRehearsal, type RhSource } from "./api";
import { addFavorite, mediaAction, mergeSources, pauseAllSources, phoneView } from "./rhModel";
import { useDoc } from "../state/doc";
import { useSettings } from "../state/settings";
import { useRh } from "../state/rehearsal";
import { startPlayerEvents } from "../state/player";

/**
 * Keeps the native connections in step with the settings (they stay off
 * until the user turns them on) and gives the phone what it needs to show.
 *
 * The phone sees the same Rehearsal sources as the computer (Chrome tabs and Diaframma's
 * own player included) and its buttons go through the same code as the buttons on screen.
 */
export function startRemoteSync(): () => void {
  if (!isTauri) return () => {};
  let s = useSettings.getState().settings;
  let view: PhoneRehearsal | null = null;
  let sources: RhSource[] = [];
  let ext: ExtTabs | null = null;
  let pollTimer: number | null = null;

  const poll = async () => {
    const st = useSettings.getState().settings;
    if (!st.phoneEnabled) return;
    startPlayerEvents();
    const [snap, tabs] = await Promise.all([api.rhSnapshot().catch(() => null), st.extensionBridgeEnabled ? api.extTabs().catch(() => null) : Promise.resolve(null)]);
    ext = tabs;
    const connected = (snap?.outputs ?? []).filter((o) => o.connected !== false);
    sources = mergeSources(snap, tabs, connected, st.language === "it" ? "Scheda Chrome" : "Chrome tab");
    useRh.getState().adopt(sources);
    view = phoneView(sources, snap?.outputs ?? [], useRh.getState().levels, st.outputRoles);
    push();
  };
  const startPolling = () => {
    if (pollTimer !== null) return;
    void poll();
    pollTimer = window.setInterval(() => void poll(), 1000);
  };
  const stopPolling = () => {
    if (pollTimer !== null) window.clearInterval(pollTimer);
    pollTimer = null;
    view = null;
    push();
  };

  api.extEnable(s.extensionBridgeEnabled).catch(() => {});
  if (s.phoneEnabled) {
    api.phoneEnable(true).catch(() => {});
    startPolling();
  }
  const un1 = useSettings.subscribe((st) => {
    const n = st.settings;
    if (n.extensionBridgeEnabled !== s.extensionBridgeEnabled) api.extEnable(n.extensionBridgeEnabled).catch(() => {});
    if (n.phoneEnabled !== s.phoneEnabled) {
      api.phoneEnable(n.phoneEnabled).catch(() => {});
      if (n.phoneEnabled) startPolling();
      else stopPolling();
    }
    if (n.favorites !== s.favorites || n.rhMain !== s.rhMain || n.outputRoles !== s.outputRoles) push();
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
  function push() {
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      const st = useSettings.getState().settings;
      // The levels the computer shows (volume faders) travel with the sources.
      const live = view
        ? { ...view, sources: view.sources.map((x) => ({ ...x, volume: x.volume === null ? null : useRh.getState().levels[x.id] ?? x.volume })) }
        : null;
      api.phoneUpdate(useDoc.getState().locked, st.favorites.slice(0, 50), useRh.getState().levels, st.rhMain, live).catch(() => {});
    }, 150);
  }
  push();

  const find = (id: string) => sources.find((x) => x.id === id) ?? null;
  // ★ pressed on the phone.
  const un3 = onEvent<string>("phone-star", (id) => {
    const src = find(id);
    if (src) addFavorite(src);
  });
  // A favorite removed on the phone.
  const un6 = onEvent<string>("phone-unstar", (id) => {
    const favs = useSettings.getState().settings.favorites;
    useSettings.getState().update({ favorites: favs.filter((f) => f.id !== id) });
  });
  // Main volume of the show moved on the phone.
  const un5 = onEvent<number>("phone-main-volume", (db) => useSettings.getState().update({ mainDb: Math.max(-60, Math.min(10, db)) }));
  // Rehearsal: the buttons of a source, the volume of a source, of an output and the main one, pause all.
  const un7 = onEvent<{ id: string; v: number }>("phone-rh-volume", ({ id, v }) => {
    const src = find(id);
    if (src) useRh.getState().setLevel(src, v);
  });
  const un8 = onEvent<{ id: string; op: "toggle" | "next" | "prev" | "pause" }>("phone-rh-media", ({ id, op }) => {
    mediaAction(id, op).catch(() => {});
    window.setTimeout(() => void poll(), 350);
  });
  const un9 = onEvent<null>("phone-rh-pauseall", () => {
    pauseAllSources(ext);
    window.setTimeout(() => void poll(), 350);
  });
  const un10 = onEvent<number>("phone-rh-main", (v) => {
    useSettings.getState().update({ rhMain: Math.max(0, Math.min(1, v)) });
    useRh.getState().resend(sources);
  });
  const un11 = onEvent<{ id: string; v: number }>("phone-rh-output-volume", ({ id, v }) => {
    api.rhSetOutputVolume(id, v).catch(() => {});
  });
  return () => {
    if (pollTimer !== null) window.clearInterval(pollTimer);
    un1();
    un2();
    un4();
    for (const u of [un3, un5, un6, un7, un8, un9, un10, un11]) u.then((f) => f());
  };
}
