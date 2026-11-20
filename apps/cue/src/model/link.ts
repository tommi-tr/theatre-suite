import type { Lang, TFunc } from "@theatre-suite/core";
import type { GivenBy } from "./gos";
import type { Role as PlaybackRole } from "./playback";

/**
 * The primary/secondary link, pure (docs/cue/NETWORK.md, 13_cue.md "Primario e secondario", "Doppio GO").
 * Types of what the native side reports (`cue-link-state`), the panel and border it means (texts exactly as in 13),
 * where an action goes (applied here or asked to the primary), reservation and "given by" rules.
 */

export type LinkRole = "none" | "primary" | "secondary";
export type LinkPhase = "off" | "searching" | "pairing" | "connected" | "lost";
export type LinkStatus = "none" | "stable" | "unstable" | "backup" | "lost" | "unavailable";
export type Holder = "none" | "primary" | "secondary";

export interface LinkPath {
  address: string;
  alive: boolean;
  /** The cable (link-local, typed by hand, loopback). */
  main: boolean;
}

export interface LinkPeer {
  id: string;
  name: string;
  paths: LinkPath[];
}

/** `cue-link-state` / `link_info` (src-tauri/src/net/link.rs `LinkInfo`). */
export interface LinkInfo {
  role: LinkRole;
  phase: LinkPhase;
  status: LinkStatus;
  latencyMs: number | null;
  lostBeats: number;
  /** Unix ms when the link was lost ("Scollegato da 0:04" counts from here). */
  lostAt: number | null;
  me: LinkPeer;
  peer: LinkPeer | null;
  pairedWith: string | null;
  pairingCode: string | null;
  pairingError: "code" | "attempts" | "busy" | "noAnswer" | null;
  attemptsLeft: number | null;
  found: { id: string; name: string; address: string; pairing: boolean; busy: boolean } | null;
  reservation: Holder;
  commandsTaken: boolean;
  peerAvailable: boolean;
  wifiBackup: boolean;
  manualPeer: string | null;
  firewallNoticeSeen: boolean;
  udpPort: number;
  tcpPort: number;
  error: string | null;
  /** Browser simulation (`/?demo`): a secondary applies its actions locally. */
  simulated?: boolean;
}

export const NO_LINK: LinkInfo = {
  role: "none",
  phase: "off",
  status: "none",
  latencyMs: null,
  lostBeats: 0,
  lostAt: null,
  me: { id: "", name: "", paths: [] },
  peer: null,
  pairedWith: null,
  pairingCode: null,
  pairingError: null,
  attemptsLeft: null,
  found: null,
  reservation: "none",
  commandsTaken: false,
  peerAvailable: true,
  wifiBackup: false,
  manualPeer: null,
  firewallNoticeSeen: false,
  udpPort: 47810,
  tcpPort: 47811,
  error: null,
};

/** What the secondary may ask the primary (the same names on the native side). */
export type LinkOp =
  | { kind: "go"; standbyId?: string | null }
  | { kind: "back" }
  | { kind: "pause" }
  | { kind: "blackout"; on?: boolean }
  | { kind: "fadeToBlack" }
  | { kind: "emergency" }
  | { kind: "stopAudio" }
  | { kind: "standby"; goId: string }
  | { kind: "edit"; op: unknown }
  | { kind: "reserve" }
  | { kind: "release" }
  | { kind: "available" }
  | { kind: "unavailable" };

export type Refusal =
  | "reservedByPrimary"
  | "reservedBySecondary"
  | "commandsTaken"
  | "unavailable"
  | "notConnected"
  | "timeout"
  | "alreadyGiven"
  | "unknown";

/** Taken away from the secondary, these still work. */
const ALWAYS_ALLOWED: LinkOp["kind"][] = ["release", "available", "unavailable"];
/** Only the computer holding the reservation (key C) may give these. */
const RESERVABLE: LinkOp["kind"][] = ["go", "back", "standby"];

/** The link carries messages (green, amber or blue: the other computer answers). */
export const linkUp = (i: Pick<LinkInfo, "status">): boolean => i.status === "stable" || i.status === "unstable" || i.status === "backup" || i.status === "unavailable";

/**
 * Role for `model/playback.ts`: "solo" whenever this computer gives every GO — no link, link lost, or the
 * secondary "Non disponibile" ("sei solo"). The secondary keeps "secondary" (it cannot give GOs while lost anyway).
 */
export function playbackRole(i: Pick<LinkInfo, "role" | "status">): PlaybackRole {
  if (i.role === "secondary") return "secondary";
  if (i.role === "primary" && (i.status === "stable" || i.status === "unstable" || i.status === "backup")) return "primary";
  return "solo";
}

export type Route = { kind: "local"; broadcast: boolean } | { kind: "remote" } | { kind: "refuse"; reason: Refusal };

/**
 * Where an action goes. Primary or no link: applied here (same code path as the keys), then — when a secondary is
 * connected — the new state is published (`broadcast`). Secondary: asked to the primary, which applies it and
 * sends the state back; refused here when the answer is already known.
 */
export function routeAction(i: LinkInfo, op: LinkOp): Route {
  if (i.role === "none") return { kind: "local", broadcast: false };
  if (i.role === "primary") {
    if (RESERVABLE.includes(op.kind) && i.reservation === "secondary" && linkUp(i)) return { kind: "refuse", reason: "reservedBySecondary" };
    return { kind: "local", broadcast: linkUp(i) };
  }
  if (i.simulated) return { kind: "local", broadcast: false };
  if (!linkUp(i)) return { kind: "refuse", reason: "notConnected" };
  if (i.commandsTaken && !ALWAYS_ALLOWED.includes(op.kind)) return { kind: "refuse", reason: "commandsTaken" };
  if (i.status === "unavailable" && (RESERVABLE.includes(op.kind) || op.kind === "reserve" || op.kind === "edit")) return { kind: "refuse", reason: "unavailable" };
  if (i.reservation === "primary" && (RESERVABLE.includes(op.kind) || op.kind === "reserve")) return { kind: "refuse", reason: "reservedByPrimary" };
  return { kind: "remote" };
}

/**
 * On the primary, before applying a secondary's GO: it meant the standby it saw. If that GO already started
 * (both pressed at once), the request is refused instead of firing the next one.
 */
export function checkRemoteGo(op: LinkOp, standbyId: string | null): Refusal | null {
  if (op.kind !== "go" || op.standbyId === undefined) return null;
  return op.standbyId === standbyId ? null : "alreadyGiven";
}

/** Who holds the reservation, seen from this computer. */
export interface ReservationView {
  mine: boolean;
  other: boolean;
  /** Blue ribbon above the columns ("Prenotato da te · solo tu puoi dare il GO" + key). */
  ribbon: string | null;
  /** Grey standby button label on the other computer. */
  goLabel: string | null;
}

export function reservationView(i: Pick<LinkInfo, "role" | "reservation">, t: TFunc): ReservationView {
  if (i.role === "none" || i.reservation === "none") return { mine: false, other: false, ribbon: null, goLabel: null };
  const mine = i.reservation === i.role;
  return {
    mine,
    other: !mine,
    ribbon: mine ? t("Reserved by you · only you can give the GO") : null,
    goLabel: mine ? null : i.reservation === "primary" ? t("Reserved by the primary") : t("Reserved by the secondary"),
  };
}

/** The grey label of a GO assigned to the other computer ("lo dà il secondario"), or null if this one gives it. */
export function givenByLabel(givenBy: GivenBy, role: PlaybackRole, t: TFunc): string | null {
  if (role === "primary" && givenBy === "secondary") return t("given by the secondary");
  if (role === "secondary" && givenBy === "primary") return t("given by the primary");
  return null;
}

/** The event the primary publishes when a GO fires (for the secondary and the evening log). */
export interface FiredEvent {
  type: "fired";
  goId: string;
  by: "primary" | "secondary";
  at: number;
}

export const firedEvent = (goId: string, by: "primary" | "secondary", at: number): FiredEvent => ({ type: "fired", goId, by, at });

export function refusalText(reason: string | null | undefined, t: TFunc): string {
  switch (reason) {
    case "reservedByPrimary":
      return t("Reserved by the primary");
    case "reservedBySecondary":
      return t("Reserved by the secondary");
    case "commandsTaken":
      return t("The primary took your commands away");
    case "unavailable":
      return t("You are unavailable");
    case "notConnected":
      return t("The primary does not answer");
    case "timeout":
      return t("The primary did not answer in time");
    case "alreadyGiven":
      return t("That GO has already started");
    default:
      return t("Request not recognised");
  }
}

/** Round trip in the panel: "0,4" (one decimal below 10 ms, Italian comma), "38". */
export function formatLatency(ms: number, lang: Lang): string {
  const s = ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
  return lang === "it" ? s.replace(".", ",") : s;
}

/** "0:04", "12:30", "1:02:03". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export type Tone = "neutral" | "go" | "amber" | "red" | "blue";

/** The right panel and the screen border of Show (13_cue.md, design/README.md). */
export interface LinkPanel {
  tone: Tone;
  /** Full colour background (amber, red, blue) with dark text (white on red); otherwise soft green or neutral. */
  filled: boolean;
  ink: "default" | "dark" | "white";
  /** 6 px screen border: only when a secondary is connected (or was, and is lost). Stable green at 55 %. */
  border: { tone: Exclude<Tone, "neutral">; opacity: number } | null;
  heading: string | null;
  title: string;
  detail: string;
  /** The detail is the main message (primary: "Non disponibile · sei solo"). */
  detailStrong: boolean;
  /** Primary: Togli / Ridai i comandi; secondary: Non disponibile. */
  button: { label: string; action: "takeCommands" | "giveCommands" | "unavailable" } | null;
  /** Secondary unavailable: blue veil over the screen, back with a HoldButton. */
  veil: { title: string; hold: string } | null;
}

export function linkPanel(i: LinkInfo, t: TFunc, lang: Lang, nowMs: number): LinkPanel {
  const primary = i.role === "primary";
  const heading = i.role === "none" ? null : primary ? t("You are the primary · Secondary") : t("You are the secondary · Primary");
  const ms = i.latencyMs === null ? null : formatLatency(i.latencyMs, lang);
  const connectedTitle = ms === null ? t("Connected") : t("Connected · {ms} ms", { ms });
  const base: LinkPanel = { tone: "neutral", filled: false, ink: "default", border: null, heading, title: "", detail: "", detailStrong: false, button: null, veil: null };
  const commandButton: LinkPanel["button"] = primary
    ? i.commandsTaken
      ? { label: t("Give the commands back"), action: "giveCommands" }
      : { label: t("Take the commands away"), action: "takeCommands" }
    : { label: t("Unavailable"), action: "unavailable" };
  const cableDetail = i.commandsTaken ? (primary ? t("Commands taken from the secondary") : t("The primary took your commands away")) : t("By cable · available");

  switch (i.status) {
    case "stable":
      return { ...base, tone: "go", border: { tone: "go", opacity: 0.55 }, title: connectedTitle, detail: cableDetail, button: commandButton };
    case "unstable": {
      const n = i.lostBeats;
      const title =
        n === 0
          ? t("Unstable · {ms} ms", { ms: ms ?? "–" })
          : n === 1
            ? t("Unstable · {ms} ms, 1 heartbeat lost", { ms: ms ?? "–" })
            : t("Unstable · {ms} ms, {n} heartbeats lost", { ms: ms ?? "–", n });
      return { ...base, tone: "amber", filled: true, ink: "dark", border: { tone: "amber", opacity: 1 }, title, detail: cableDetail, button: commandButton };
    }
    case "backup":
      return {
        ...base,
        tone: "amber",
        filled: true,
        ink: "dark",
        border: { tone: "amber", opacity: 1 },
        title: t("Now on the backup Wi-Fi"),
        detail: ms === null ? t("The cable does not answer") : t("The cable does not answer · {ms} ms", { ms }),
        button: commandButton,
      };
    case "lost":
      return {
        ...base,
        tone: "red",
        filled: true,
        ink: "white",
        border: { tone: "red", opacity: 1 },
        title: t("Disconnected for {time}", { time: formatElapsed(i.lostAt === null ? 0 : nowMs - i.lostAt) }),
        detail: primary ? t("The secondary cannot give GOs. You carry on normally.") : t("The primary does not answer. You cannot carry on from here."),
      };
    case "unavailable":
      return {
        ...base,
        tone: "blue",
        filled: true,
        ink: "dark",
        border: { tone: "blue", opacity: 1 },
        title: connectedTitle,
        detail: primary ? t("Unavailable · you are alone") : t("Unavailable"),
        detailStrong: primary,
        button: primary ? commandButton : null,
        veil: primary ? null : { title: t("Unavailable · your shortcuts are off"), hold: t("Hold to become available again") },
      };
    default:
      break;
  }
  // No secondary connected yet: neutral panel.
  if (primary && i.pairingCode) return { ...base, title: t("No secondary"), detail: t("Pairing code {code}", { code: `${i.pairingCode.slice(0, 3)} ${i.pairingCode.slice(3)}` }) };
  if (i.role === "secondary" && i.found?.pairing) return { ...base, title: t("Looking for the primary…"), detail: t("Type the code shown by {name}", { name: i.found.name }) };
  if (i.role === "secondary") return { ...base, title: t("Looking for the primary…"), detail: t("Choose Primary on the other computer") };
  if (primary && i.pairedWith) return { ...base, title: t("No secondary"), detail: t("Looking for the secondary…") };
  return { ...base, title: t("No secondary"), detail: t("Controls → Link to pair one") };
}
