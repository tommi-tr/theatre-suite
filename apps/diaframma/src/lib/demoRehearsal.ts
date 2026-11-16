import type { RhSnapshot } from "./api";

/** Fake Rehearsal data for previewing the layout in a browser (`?demo`). */
export function demoSnapshot(): RhSnapshot {
  const base = { thumb: null, canSpeed: false, speed: null, peak: 0.3, pids: [1], positionSec: null, durationSec: null, artist: "" };
  return {
    supported: true,
    routingAvailable: true,
    pendingRestore: 0,
    outputs: [
      { id: "hp", name: "Headphones (WH-1000XM4 Stereo)", description: "Headphones", kind: "headphones", connected: true, volume: 0.6, isDefault: false, peakL: 0.4, peakR: 0.36 },
      { id: "spk", name: "Speakers (Realtek Audio)", description: "Speakers", kind: "speakers", connected: true, volume: 0.8, isDefault: true, peakL: 0.5, peakR: 0.46 },
      { id: "hdmi", name: "DELL U2419H (NVIDIA High Definition Audio)", description: "DELL U2419H", kind: "hdmi", connected: true, volume: 1, isDefault: false, peakL: 0, peakR: 0 },
      { id: "usb", name: "Speakers (USB Audio Interface)", description: "Speakers", kind: "speakers", connected: false, volume: null, isDefault: false, peakL: 0, peakR: 0 },
    ],
    sources: [
      { ...base, id: "m:spotify", app: "Spotify", exe: "spotify.exe", kind: "spotify", title: "Gymnopédie No. 1", artist: "Erik Satie", status: "playing", canToggle: true, canNext: true, canPrev: true, volume: 0.8, outputId: "hp", positionSec: 61, durationSec: 196 },
      { ...base, id: "m:chrome", app: "Google Chrome", exe: "chrome.exe", kind: "browser", title: "Rain on a tin roof — 1 hour", artist: "YouTube", status: "paused", canToggle: true, canNext: true, canPrev: false, volume: 1, outputId: null },
      { ...base, id: "m:zune", app: "Media Player", exe: "microsoft.media.player.exe", kind: "media", title: "Prova voce.m4a", status: "playing", canToggle: true, canNext: false, canPrev: false, volume: 1, outputId: "hp" },
      { ...base, id: "p:vlc.exe", app: "VLC", exe: "vlc.exe", kind: "vlc", title: "VLC", status: "playing", canToggle: true, canNext: true, canPrev: true, volume: 1, outputId: "spk" },
    ],
  };
}
