import { create } from "zustand";
import type { Go } from "../model/gos";
import { numberGos } from "../model/gos";
import type { LogEntry, LogKind } from "../model/evening";
import { onFired, useRun } from "../show/run";
import { useLink } from "./link";
import { useDoc } from "./doc";

/**
 * The log of the evening (13, "Registro della serata"): kept in memory on this computer from the opening of the
 * show until "Fine spettacolo"; exported as a show report. `baseline` is the GOs at the first GO of the evening, to
 * find the changes made during the show ("modificato in serata").
 */
interface EveningStore {
  log: LogEntry[];
  baseline: Go[] | null;
  /** Interval running since (ms), or null. */
  intervalSince: number | null;
  ended: boolean;
}

export const useEvening = create<EveningStore>(() => ({ log: [], baseline: null, intervalSince: null, ended: false }));

export function logEvent(kind: LogKind, text: string, by?: string): void {
  useEvening.setState((s) => ({ log: [...s.log, { at: Date.now(), kind, text, by }].slice(-5000) }));
}

export function startInterval(text: string): void {
  if (useEvening.getState().intervalSince) return;
  useEvening.setState({ intervalSince: Date.now() });
  logEvent("interval", text);
}

export function endInterval(text: string): void {
  if (!useEvening.getState().intervalSince) return;
  useEvening.setState({ intervalSince: null });
  logEvent("resume", text);
}

/** After "Fine spettacolo": a new evening starts clean. */
export function resetEvening(): void {
  useEvening.setState({ log: [], baseline: null, intervalSince: null, ended: false });
}

/** Watches the show while Cue is open: GOs, pause, blackout, link problems, chat. Returns the cleanup. */
export function startEvening(t: (s: string) => string): () => void {
  const stops: (() => void)[] = [];
  stops.push(
    onFired((goIds, by) => {
      const gos = useDoc.getState().show?.gos ?? [];
      const ev = useEvening.getState();
      if (!ev.baseline) {
        useEvening.setState({ baseline: structuredClone(gos) as Go[] });
        logEvent("start", t("Show started"));
      }
      const numbers = new Map(numberGos(gos).map((n) => [n.id, n.text]));
      for (const id of goIds) logEvent("go", `GO ${numbers.get(id) ?? "?"}`, by);
    }),
  );
  let prev = useRun.getState().playback;
  stops.push(
    useRun.subscribe((s) => {
      const p = s.playback;
      if (p.paused !== prev.paused) logEvent("safety", p.paused ? t("General pause") : t("Pause ended"));
      if (p.blackout !== prev.blackout) logEvent("safety", p.blackout ? "Blackout" : t("Blackout ended"));
      prev = p;
    }),
  );
  let prevStatus = useLink.getState().info.status;
  let prevChat = useLink.getState().chat.length;
  stops.push(
    useLink.subscribe((s) => {
      const st = s.info.status;
      if (st !== prevStatus && ["lost", "unstable", "backup", "unavailable", "stable"].includes(st) && prevStatus !== "none") {
        logEvent("link", `${t("Link")}: ${linkWord(t, st)}`);
      }
      prevStatus = st;
      if (s.chat.length > prevChat) for (const m of s.chat.slice(prevChat)) logEvent("chat", `${t("Chat")}: ${m.text}`, m.from);
      prevChat = s.chat.length;
    }),
  );
  return () => stops.forEach((f) => f());
}

function linkWord(t: (s: string) => string, st: string): string {
  switch (st) {
    case "lost":
      return t("disconnected");
    case "unstable":
      return t("unstable");
    case "backup":
      return t("on the Wi-Fi backup");
    case "unavailable":
      return t("secondary not available");
    default:
      return t("stable");
  }
}
