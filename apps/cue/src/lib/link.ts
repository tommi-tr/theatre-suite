import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "./api";
import { NO_LINK, type Holder, type LinkInfo, type LinkOp, type LinkRole, type LinkStatus } from "../model/link";

/**
 * The primary/secondary link (native side: src-tauri/src/net, protocol in docs/cue/NETWORK.md). Two implementations
 * of `LinkApi`: the native one, and a browser simulation for `/?demo` whose state is forced from the address:
 *   `?demo&link=stable|unstable|backup|lost|unavailable|none|pairing` (this computer is the primary),
 *   add `secondary` for the secondary's view (`?demo&link=secondary,lost`), `reserved-me` / `reserved-other`,
 *   `taken` (commands taken away). At run time: `window.__cueLink.set({ status: "lost" })`.
 */

export interface Outcome {
  requestId: string;
  ok: boolean;
  reason?: string;
}

export interface ChatMessage {
  id: string;
  text: string;
  quick: boolean;
  /** Unix ms. */
  at: number;
  from: "primary" | "secondary";
  name: string;
  /** Sent from this computer. */
  mine: boolean;
}

/** Position on the script of the other computer's pointer (page from 1, x/y 0–1); null = hidden. */
export type Pointer = { page: number; x: number; y: number } | null;

/** `cue-link-event`. */
export type LinkEvent =
  /** Primary: the secondary asks; apply it like a local action, then `reply` only if refused later. */
  | { type: "request"; requestId: string; op: LinkOp; from: "secondary"; at: number }
  /** Secondary: the primary's playback state. */
  | { type: "state"; rev: number; state: unknown }
  /** Secondary: an event published by the primary (e.g. `firedEvent`). */
  | { type: "event"; event: unknown }
  /** Secondary: the primary's later answer to a request. */
  | { type: "result"; requestId: string; ok: boolean; reason?: string | null }
  | { type: "paired"; peer: string }
  | { type: "forgotten" };

/** `cue-link-file`. On `received` the secondary opens `path` (and uses `showJson` if present instead of the file's). */
export type FileEvent =
  | { phase: "offered"; transferId: string; files: number; skipped: [string, string][] }
  | { phase: "sending"; transferId: string; files: number }
  | { phase: "receiving"; transferId: string; done: number; total: number }
  | { phase: "received"; transferId: string; showId: string; path: string; showJson: string | null; fetched: string[]; bytes: number; skipped: [string, string][] }
  | { phase: "sent"; transferId: string; ok: true }
  | { phase: "failed"; transferId?: string; error: string };

export interface LinkConfigure {
  role?: LinkRole;
  wifiBackup?: boolean;
  /** "" clears it. */
  manualPeer?: string;
  /** "" = the computer's name. */
  name?: string;
}

export interface SendShow {
  showId: string;
  tcuePath: string;
  /** Source files (.granvelo, .diaframma, Bardo): sent so the secondary can show names and previews. Never videos. */
  extraPaths: string[];
  /** Edits not saved yet. */
  showJson?: string | null;
}

export interface LinkApi {
  info(): Promise<LinkInfo>;
  /** Show the Windows firewall explanation first when `firewallNoticeSeen` is false and the role is not "none". */
  configure(c: LinkConfigure): Promise<LinkInfo>;
  newCode(): Promise<LinkInfo>;
  enterCode(code: string): Promise<LinkInfo>;
  forget(): Promise<LinkInfo>;
  /** Secondary: ask the primary (resolves with its answer, at most ~1.3 s). */
  request(op: LinkOp): Promise<Outcome>;
  /** Primary: a request applied and then refused by the playback rules. */
  reply(requestId: string, ok: boolean, reason?: string): Promise<boolean>;
  /** Primary: the playback snapshot (lastGoId, standbyId, paused, blackout…), after every change. */
  publishState(state: unknown): Promise<boolean>;
  publishEvent(event: unknown): Promise<boolean>;
  /** Key C held / released (on the secondary it becomes a request). */
  reserve(on: boolean): Promise<Outcome>;
  takeCommands(on: boolean): Promise<LinkInfo>;
  chat(text: string, quick: boolean): Promise<unknown>;
  pointer(p: Pointer): Promise<void>;
  sendShow(s: SendShow): Promise<unknown>;
  onState(fn: (i: LinkInfo) => void): Promise<UnlistenFn>;
  onEvent(fn: (e: LinkEvent) => void): Promise<UnlistenFn>;
  onChat(fn: (m: ChatMessage) => void): Promise<UnlistenFn>;
  onPointer(fn: (p: Pointer) => void): Promise<UnlistenFn>;
  onFile(fn: (f: FileEvent) => void): Promise<UnlistenFn>;
}

const on =
  <T>(name: string) =>
  (fn: (v: T) => void) =>
    listen<T>(name, (e) => fn(e.payload));

export const tauriLink: LinkApi = {
  info: () => invoke("link_info"),
  configure: (config) => invoke("link_configure", { config }),
  newCode: () => invoke("link_new_code"),
  enterCode: (code) => invoke("link_enter_code", { code }),
  forget: () => invoke("link_forget"),
  request: (op) => invoke("link_request", { op }),
  reply: (requestId, ok, reason) => invoke("link_reply", { requestId, ok, reason: reason ?? null }),
  publishState: (state) => invoke("link_publish_state", { showState: state }),
  publishEvent: (event) => invoke("link_publish_event", { event }),
  reserve: (on) => invoke("link_reserve", { on }),
  takeCommands: (on) => invoke("link_take_commands", { on }),
  chat: (text, quick) => invoke("link_chat", { text, quick }),
  pointer: (pointer) => invoke("link_pointer", { pointer }),
  sendShow: (request) => invoke("link_send_show", { request }),
  onState: on<LinkInfo>("cue-link-state"),
  onEvent: on<LinkEvent>("cue-link-event"),
  onChat: on<ChatMessage>("cue-link-chat"),
  onPointer: on<Pointer>("cue-link-pointer"),
  onFile: on<FileEvent>("cue-link-file"),
};

const STATUSES: LinkStatus[] = ["stable", "unstable", "backup", "lost", "unavailable", "none"];

/** The forced state of the simulation from `link=` tokens (exported for tests). */
export function simInfo(tokens: string[], now = Date.now()): LinkInfo {
  const role: LinkRole = tokens.includes("secondary") ? "secondary" : tokens.length ? "primary" : "none";
  const status = STATUSES.find((s) => tokens.includes(s)) ?? (tokens.includes("pairing") || role === "none" ? "none" : "stable");
  const other = role === "secondary" ? "Regia" : "Palco";
  const peer = status === "none" ? null : { id: "demo-peer", name: other, paths: [{ address: "169.254.20.7:47810", alive: status !== "lost" && status !== "backup", main: true }] };
  const reservation: Holder = tokens.includes("reserved-me") ? (role === "secondary" ? "secondary" : "primary") : tokens.includes("reserved-other") ? (role === "secondary" ? "primary" : "secondary") : "none";
  return {
    ...NO_LINK,
    role,
    phase: role === "none" ? "off" : status === "none" ? (tokens.includes("pairing") ? "pairing" : "searching") : status === "lost" ? "lost" : "connected",
    status,
    latencyMs: status === "unstable" ? 38 : status === "backup" ? 6.2 : status === "none" || status === "lost" ? null : 0.4,
    lostBeats: status === "unstable" ? 3 : 0,
    lostAt: status === "lost" ? now - 4000 : null,
    me: { id: "demo-me", name: role === "secondary" ? "Palco" : "Regia", paths: [] },
    peer,
    pairedWith: status === "none" && !tokens.includes("pairing") ? null : other,
    pairingCode: role === "primary" && tokens.includes("pairing") ? "482913" : null,
    found: role === "secondary" && tokens.includes("pairing") ? { id: "demo-peer", name: other, address: "169.254.20.7", pairing: true, busy: false } : null,
    reservation,
    commandsTaken: tokens.includes("taken"),
    peerAvailable: status !== "unavailable",
    wifiBackup: status === "backup",
    firewallNoticeSeen: true,
    simulated: true,
  };
}

/** Browser stand-in: answers at once, echoes chat, never touches the network. */
export function createSimLink(initial: LinkInfo): LinkApi & { set(patch: Partial<LinkInfo>): void } {
  let info = initial;
  const subs = { state: new Set<(i: LinkInfo) => void>(), event: new Set<(e: LinkEvent) => void>(), chat: new Set<(m: ChatMessage) => void>(), pointer: new Set<(p: Pointer) => void>(), file: new Set<(f: FileEvent) => void>() };
  const sub =
    <T>(set: Set<(v: T) => void>) =>
    async (fn: (v: T) => void): Promise<UnlistenFn> => {
      set.add(fn);
      return () => set.delete(fn);
    };
  const update = (patch: Partial<LinkInfo>) => {
    info = { ...info, ...patch };
    subs.state.forEach((f) => f(info));
    return info;
  };
  let n = 0;
  const ok = (): Outcome => ({ requestId: `sim-${++n}`, ok: true });
  return {
    set: (patch) => void update(patch),
    info: async () => info,
    configure: async (c) => update({ ...(c.role ? simInfo(c.role === "none" ? [] : [c.role]) : {}), ...(c.wifiBackup !== undefined ? { wifiBackup: c.wifiBackup } : {}), ...(c.manualPeer !== undefined ? { manualPeer: c.manualPeer || null } : {}) }),
    newCode: async () => update({ pairingCode: String(Math.floor(Math.random() * 1e6)).padStart(6, "0") }),
    enterCode: async () => update(simInfo(["secondary", "stable"])),
    forget: async () => update({ pairedWith: null, peer: null, status: "none", phase: info.role === "none" ? "off" : "pairing", pairingCode: info.role === "primary" ? "482913" : null }),
    request: async (op) => {
      if (op.kind === "unavailable") update({ status: "unavailable", peerAvailable: false });
      if (op.kind === "available") update({ status: "stable", peerAvailable: true });
      return ok();
    },
    reply: async () => true,
    publishState: async () => true,
    publishEvent: async () => true,
    reserve: async (r) => (update({ reservation: r ? (info.role === "secondary" ? "secondary" : "primary") : "none" }), ok()),
    takeCommands: async (t) => update({ commandsTaken: t }),
    chat: async (text, quick) => {
      const m: ChatMessage = { id: `sim-${++n}`, text, quick, at: Date.now(), from: info.role === "secondary" ? "secondary" : "primary", name: info.me.name, mine: true };
      subs.chat.forEach((f) => f(m));
      return m;
    },
    pointer: async () => {},
    sendShow: async () => ({}),
    onState: sub(subs.state),
    onEvent: sub(subs.event),
    onChat: sub(subs.chat),
    onPointer: sub(subs.pointer),
    onFile: sub(subs.file),
  };
}

let api: LinkApi | null = null;

export function linkApi(): LinkApi {
  if (api) return api;
  if (isTauri) return (api = tauriLink);
  const raw = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("link");
  const sim = createSimLink(simInfo(raw ? raw.split(",").map((s) => s.trim()) : []));
  if (typeof window !== "undefined") (window as unknown as { __cueLink: typeof sim }).__cueLink = sim;
  return (api = sim);
}
