import type { IconName } from "@theatre-suite/ui";
import type { Entry, Exit, LiveState, OthersOnGo, Track } from "../state/types";
import type { Settings } from "../state/settings";

type T = (k: string, v?: Record<string, string | number>) => string;

export const secs = (n: number) => `${String(Math.round(n * 10) / 10).replace(".", ",")} s`;

/** Entrata: how the track begins when GO starts it (optional). */
export const ENTRIES: { value: Entry; label: string; icon: IconName; title: string }[] = [
  { value: "fadeIn", label: "Fade in", icon: "fadeIn", title: "The track fades in when GO starts it" },
];

/** Uscita: how the track leaves, at GO or at its end (optional). */
export const EXITS: { value: Exit; label: string; icon: IconName; title: string }[] = [
  { value: "fadeOut", label: "Fade out", icon: "fadeOut", title: "At GO the track fades out. At its end it fades out before the end." },
  { value: "crossfade", label: "Crossfade", icon: "crossfade", title: "The next track starts and the two cross. At the end it starts by itself." },
  { value: "next", label: "Next", icon: "nextF", title: "At GO the track stops and the next one starts. At the end the next one starts by itself." },
];

export function entryIcon(e: Entry | null): IconName {
  return e ? ENTRIES.find((x) => x.value === e)?.icon ?? "playF" : "playF";
}

export function exitIcon(e: Exit | null): IconName {
  return e ? EXITS.find((x) => x.value === e)?.icon ?? "stopF" : "stopF";
}

/** Length of the entry fade, seconds. */
export function entrySeconds(track: Track, s: Settings): number {
  return track.entrySec ?? s.fadeInSec;
}

/** Length of the exit fade / crossfade, seconds. */
export function exitSeconds(track: Track, s: Settings): number {
  return track.exitSec ?? (track.exit === "crossfade" ? s.crossfadeSec : s.fadeOutSec);
}

export function entryText(t: T, track: Track, s: Settings): string {
  return track.entry ? `${t("Fade in")} · ${secs(entrySeconds(track, s))}` : t("No entry");
}

export function exitText(t: T, track: Track, s: Settings): string {
  if (!track.exit) return t("No exit");
  const label = t(EXITS.find((x) => x.value === track.exit)?.label ?? "Stop");
  return track.exit === "next" ? label : `${label} · ${secs(exitSeconds(track, s))}`;
}

/** What GO does to a track that has no exit (the general setting). */
export function othersText(t: T, others: OthersOnGo, s?: Settings): string {
  switch (others) {
    case "fadeOut":
      return s ? `${t("Quick fade")} · ${secs(s.quickFadeSec)}` : t("Quick fade");
    case "stop":
      return t("Stop");
    case "keep":
      return t("Keep playing");
  }
}

/** The symbol in the middle of the top bar: what the track in front does when GO comes. */
export interface Transition {
  icon: IconName;
  /** "Crossfade · 4 s". */
  name: string;
  /** "al GO" or "alla fine · 01:20". */
  when: string;
  /** The attention track will start by itself. */
  auto: boolean;
}

export function transition(t: T, live: LiveState, tracks: Track[], s: Settings, leftSec: number | null, fmt: (sec: number) => string): Transition | null {
  const main = live.mainId ? tracks.find((x) => x.id === live.mainId) ?? null : null;
  const playing = main && live.voices.some((v) => v.trackId === main.id && v.main);
  if (!main || !playing) return null;
  const auto = live.autoStart;
  const exit = main.exit;
  const name = exit ? exitText(t, main, s) : othersText(t, s.othersOnGo, s);
  const icon: IconName = exit
    ? exitIcon(exit)
    : s.othersOnGo === "fadeOut"
      ? "fadeOut"
      : s.othersOnGo === "keep"
        ? "playF"
        : "stopF";
  const when = auto && leftSec !== null ? `${t("at the end")} · ${fmt(leftSec)}` : t("at GO");
  return { icon, name, when, auto };
}
