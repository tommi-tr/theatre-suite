import type { IconName } from "@theatre-suite/ui";
import type { AtEnd, OnSpace, OthersOnGo } from "../state/types";
import type { Settings } from "../state/settings";

export const ON_SPACE: { value: OnSpace; label: string; icon: IconName; title?: string }[] = [
  { value: "play", label: "Play", icon: "playF" },
  { value: "fadeIn", label: "Fade in", icon: "fadeIn" },
  { value: "crossfade", label: "Crossfade", icon: "crossfade" },
  { value: "stopAllPlay", label: "Stop all & play", icon: "stopPlay", title: "Stops every other track, then plays this one" },
];

export const AT_END: { value: AtEnd; label: string; icon: IconName }[] = [
  { value: "stop", label: "Stop", icon: "stopF" },
  { value: "next", label: "Next", icon: "nextF" },
  { value: "fadeOut", label: "Fade out", icon: "fadeOut" },
  { value: "crossfade", label: "Crossfade", icon: "crossfade" },
  { value: "loopAll", label: "Loop all", icon: "repeat" },
  { value: "loopCut", label: "Loop cut", icon: "loopCut" },
];

type T = (k: string, v?: Record<string, string | number>) => string;

const secs = (n: number) => `${String(Math.round(n * 10) / 10).replace(".", ",")} s`;

export function goActionText(t: T, onSpace: OnSpace, s: Settings): string {
  switch (onSpace) {
    case "play":
      return t("Play");
    case "fadeIn":
      return `${t("Fade in")} · ${secs(s.fadeInSec)}`;
    case "crossfade":
      return `${t("Crossfade")} · ${secs(s.crossfadeSec)}`;
    case "stopAllPlay":
      return t("Stop all & play");
  }
}

export function atEndText(t: T, atEnd: AtEnd): string {
  return t(AT_END.find((a) => a.value === atEnd)?.label ?? "Stop");
}

/** What the next GO will do to a track that is playing now. */
export function nextGoEffect(t: T, standbyOnSpace: OnSpace | null, others: OthersOnGo): string {
  if (!standbyOnSpace) return t("Next GO: nothing in standby");
  if (standbyOnSpace === "crossfade") return t("Next GO: crossfades out");
  if (standbyOnSpace === "stopAllPlay") return t("Next GO: stops");
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
