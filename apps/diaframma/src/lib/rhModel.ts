import { basename, uid } from "@theatre-suite/core";
import { api, type ExtTabs, type PhoneRehearsal, type RhOutput, type RhSnapshot, type RhSource } from "./api";
import { useSettings, type Favorite } from "../state/settings";
import { usePlayer } from "../state/player";

/** Id of Diaframma's own player among the Rehearsal sources. */
export const INTERNAL = "internal";

export const tabIdOf = (id: string) => (id.startsWith("tab:") ? Number(id.slice(4)) : null);

/**
 * The sources of Rehearsal mode as the computer shows them: what Windows reports, with the
 * Chrome tabs (when the extension is connected) in place of the Chrome entry, and
 * Diaframma's own player first. The phone gets this same list, so both always agree.
 */
export function mergeSources(snap: RhSnapshot | null, ext: ExtTabs | null, connected: RhOutput[], tabLabel: string): RhSource[] {
  const player = usePlayer.getState();
  const playerVoice = player.live?.voices.find((v) => v.trackId === `player-${player.index}`) ?? null;
  const chromeSource = (snap?.sources ?? []).find((x) => x.exe === "chrome.exe") ?? null;
  let list = [...(snap?.sources ?? [])];
  if (ext?.connected) {
    list = list.filter((x) => x.exe !== "chrome.exe");
    for (const tab of ext.tabs) {
      const m = tab.media;
      list.push({
        id: `tab:${tab.tabId}`,
        app: tabLabel,
        exe: "chrome.exe",
        kind: "browser",
        title: m?.title || tab.title,
        artist: m?.site || "",
        thumb: null,
        status: m ? (m.paused ? "paused" : "playing") : tab.audible ? "playing" : "stopped",
        canToggle: !!m,
        canNext: !!m,
        canPrev: !!m,
        canSpeed: !!m,
        speed: m?.playbackRate ?? null,
        volume: m ? m.volume : null,
        peak: 0,
        pids: chromeSource?.pids ?? [],
        outputId: chromeSource?.outputId ?? null,
        positionSec: m?.currentTime ?? null,
        durationSec: m?.duration ?? null,
      });
    }
  }
  if (player.playlist.length) {
    const devId = player.device ? connected.find((o) => o.name === player.device)?.id ?? null : null;
    list.unshift({
      id: INTERNAL,
      app: "Diaframma",
      exe: "diaframma.exe",
      kind: "internal",
      title: basename(player.playlist[player.index] ?? ""),
      artist: player.playlist.length > 1 ? `${player.index + 1} / ${player.playlist.length}` : "",
      thumb: null,
      status: playerVoice ? (playerVoice.paused ? "paused" : "playing") : "stopped",
      canToggle: true,
      canNext: player.index + 1 < player.playlist.length,
      canPrev: true,
      canSpeed: true,
      speed: player.speed,
      volume: player.volume,
      peak: 0,
      pids: [],
      outputId: devId,
      positionSec: playerVoice?.positionSec ?? 0,
      durationSec: playerVoice?.durationSec ?? null,
    });
  }
  return list;
}

/** Play / pause / next / previous on any source (Diaframma's player, a Chrome tab or a program). */
export function mediaAction(id: string, action: "toggle" | "next" | "prev" | "pause"): Promise<void> {
  if (id === INTERNAL) {
    const p = usePlayer.getState();
    if (action === "toggle" || action === "pause") p.toggle();
    else if (action === "next") p.next();
    else p.prev();
    return Promise.resolve();
  }
  const tab = tabIdOf(id);
  if (tab !== null) return api.extCommand(tab, action);
  return api.rhMedia(id, action);
}

/** Pauses every source that plays. */
export function pauseAllSources(ext: ExtTabs | null) {
  api.rhPauseAll().catch(() => {});
  const p = usePlayer.getState();
  const v = p.live?.voices.find((x) => !x.paused);
  if (v) api.playerPause(v.trackId).catch(() => {});
  ext?.tabs.forEach((tab) => tab.media && !tab.media.paused && api.extCommand(tab.tabId, "pause").catch(() => {}));
}

/** The ★ of a source. */
export function makeFavorite(s: RhSource): Favorite {
  const p = usePlayer.getState();
  return {
    id: uid(),
    title: s.title || s.app,
    artist: s.artist || (s.kind === "browser" ? s.app : ""),
    source: s.id === INTERNAL ? "Diaframma" : s.app,
    at: new Date().toISOString(),
    positionSec: s.positionSec,
    link: s.id === INTERNAL ? p.playlist[p.index] ?? null : null,
  };
}

export function addFavorite(s: RhSource) {
  const st = useSettings.getState();
  st.update({ favorites: [makeFavorite(s), ...st.settings.favorites].slice(0, 500) });
}

/** What the phone shows in Rehearsal mode. */
export function phoneView(sources: RhSource[], outputs: RhOutput[], levels: Record<string, number>, roles: Record<string, "live" | "pre">): PhoneRehearsal {
  return {
    sources: sources.map((s) => ({
      id: s.id,
      app: s.app,
      title: s.title,
      artist: s.artist,
      status: s.status,
      canToggle: s.canToggle,
      canNext: s.canNext,
      canPrev: s.canPrev,
      volume: s.volume === null ? null : levels[s.id] ?? s.volume,
    })),
    outputs: outputs
      .filter((o) => o.connected !== false)
      .map((o) => ({ id: o.id, name: o.name, description: o.description, kind: o.kind, volume: o.volume, isDefault: o.isDefault, role: roles[o.name] ?? null })),
  };
}
