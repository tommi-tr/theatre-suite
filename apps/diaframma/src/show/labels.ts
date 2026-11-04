import type { IconName } from "@theatre-suite/ui";
import type { AtEnd, LiveState, OnSpace, OthersOnGo, PendingStep, Track } from "../state/types";
import type { Settings } from "../state/settings";

/** How the track starts when GO plays it. */
export const ON_SPACE: { value: OnSpace; label: string; icon: IconName; title?: string }[] = [
  { value: "play", label: "Play", icon: "playF" },
  { value: "fadeIn", label: "Fade in", icon: "fadeIn" },
  { value: "stopAllPlay", label: "Stop all & play", icon: "stopPlay", title: "Stops every other track, then plays this one" },
];

/** What the track does at its end, or at GO while it plays. */
export const AT_END: { value: AtEnd; label: string; icon: IconName; title: string }[] = [
  { value: "stop", label: "Stop", icon: "stopF", title: "At the end it stops. GO while it plays: stops it (the next track waits for another GO)." },
  { value: "next", label: "Next", icon: "nextF", title: "At the end the track in standby starts. GO while it plays: cuts to the track in standby." },
  { value: "fadeOut", label: "Fade out", icon: "fadeOut", title: "Fades out before the end. GO while it plays: fades it out (the next track waits for another GO)." },
  { value: "crossfade", label: "Crossfade", icon: "crossfade", title: "Crossfades into the track in standby before the end. GO while it plays: crossfades now." },
  { value: "loopAll", label: "Loop all", icon: "repeat", title: "Starts again from IN at the end. GO while it plays: starts again now." },
  { value: "loopCut", label: "Loop cut", icon: "loopCut", title: "Plays to the end, then repeats between the loop points. GO while it plays: goes into the loop now." },
];

type T = (k: string, v?: Record<string, string | number>) => string;

export const secs = (n: number) => `${String(Math.round(n * 10) / 10).replace(".", ",")} s`;

export function startText(t: T, onSpace: OnSpace, s: Settings): string {
  switch (onSpace) {
    case "play":
      return t("Play");
    case "fadeIn":
      return `${t("Fade in")} · ${secs(s.fadeInSec)}`;
    case "stopAllPlay":
      return t("Stop all & play");
  }
}

export function atEndText(t: T, atEnd: AtEnd): string {
  return t(AT_END.find((a) => a.value === atEnd)?.label ?? "Stop");
}

export function atEndIcon(atEnd: AtEnd): IconName {
  return AT_END.find((a) => a.value === atEnd)?.icon ?? "stopF";
}

/** One thing the next GO (or the one after) will do. */
export interface GoStep {
  kind: "resume" | "stop" | "fadeOut" | "loop" | "start" | "next" | "crossfade";
  /** Short verb for the GO button. */
  verb: string;
  icon: IconName;
  trackId: string | null;
}

function pendingStep(t: T, p: PendingStep, s: Settings, trackId: string | null): GoStep {
  switch (p) {
    case "stop":
      return { kind: "stop", verb: t("Stop"), icon: "stopF", trackId };
    case "fadeOut":
      return { kind: "fadeOut", verb: `${t("Fade out")} · ${secs(s.fadeOutSec)}`, icon: "fadeOut", trackId };
    case "loopAll":
      return { kind: "loop", verb: t("Start again"), icon: "repeat", trackId };
    case "loopCut":
      return { kind: "loop", verb: t("Into the loop"), icon: "loopCut", trackId };
  }
}

/**
 * The steps that are in standby, in order: what the next GO does, then (if the
 * next GO only stops or fades the track in front) what the GO after it does.
 */
export function standbySteps(t: T, live: LiveState, tracks: Track[], s: Settings): GoStep[] {
  if (live.pausedAll) return [{ kind: "resume", verb: t("Resume"), icon: "playF", trackId: live.mainId }];
  const steps: GoStep[] = [];
  if (live.pending) steps.push(pendingStep(t, live.pending, s, live.mainId));
  const sb = tracks.find((x) => x.id === live.standbyId && !x.hidden && x.file) ?? null;
  if (sb) {
    const main = !live.pending && live.mainId ? tracks.find((x) => x.id === live.mainId) ?? null : null;
    const mainPlaying = main && live.voices.some((v) => v.trackId === main.id && v.main);
    if (mainPlaying && main.atEnd === "crossfade" && sb.onSpace !== "stopAllPlay") {
      steps.push({ kind: "crossfade", verb: `${t("Crossfade")} · ${secs(s.crossfadeSec)}`, icon: "crossfade", trackId: sb.id });
    } else if (mainPlaying && main.atEnd === "next" && sb.onSpace === "play") {
      steps.push({ kind: "next", verb: t("Next"), icon: "nextF", trackId: sb.id });
    } else {
      steps.push({ kind: "start", verb: startText(t, sb.onSpace, s), icon: ON_SPACE.find((o) => o.value === sb.onSpace)?.icon ?? "playF", trackId: sb.id });
    }
  }
  return steps;
}

/** What the next GO does to a track that is playing now. */
export function nextGoEffect(t: T, live: LiveState, trackId: string, track: Track | null, others: OthersOnGo): string {
  if (live.pausedAll) return t("Next GO: resumes");
  const v = live.voices.find((x) => x.trackId === trackId && x.main);
  if (v && track) {
    if (live.pending === "stop") return t("Next GO: stops");
    if (live.pending === "fadeOut") return t("Next GO: fades out");
    if (live.pending === "loopAll") return t("Next GO: starts again");
    if (live.pending === "loopCut") return t("Next GO: goes into the loop");
    if (!live.standbyId) return t("Next GO: nothing in standby");
    if (track.atEnd === "next") return t("Next GO: cuts to the next track");
    if (track.atEnd === "crossfade") return t("Next GO: crossfades into the next track");
  }
  if (!live.standbyId) return t("Next GO: nothing in standby");
  switch (others) {
    case "pause":
      return t("Next GO: pauses");
    case "fadeOut":
      return t("Next GO: fades out");
    case "keep":
      return t("Next GO: keeps playing");
    case "stop":
      return t("Next GO: stops");
  }
}

export function othersText(t: T, others: OthersOnGo): string {
  switch (others) {
    case "pause":
      return t("GO with Play or Fade in: other tracks pause");
    case "fadeOut":
      return t("GO with Play or Fade in: other tracks fade out");
    case "keep":
      return t("GO with Play or Fade in: other tracks keep playing");
    case "stop":
      return t("GO with Play or Fade in: other tracks stop");
  }
}
