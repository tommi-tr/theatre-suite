import { makeT } from "@theatre-suite/core";
import { DICTS } from "../i18n";
import { firedEvent, linkUp, playbackRole, refusalText, type LinkInfo } from "../model/link";
import { parseShow, type CueShow } from "../model/show";
import { applySharedRun, handleRequest, onFired, sharedRun, useRun } from "../show/run";
import { useDoc } from "../store/doc";
import { useLibrary } from "../store/library";
import { useLink } from "../store/link";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { pointOnPage, scriptLive, useScriptView } from "../script/view";
import { api } from "./api";
import { linkApi, type FileEvent, type LinkEvent } from "./link";

/**
 * The link at work in the interface (docs/cue/NETWORK.md "What the UI must do"): reports the link state to the
 * stores, the primary publishes its state and events and sends the show, the secondary shows the primary's state and
 * opens the show it receives, and its edits travel as requests (`edit`) to the primary, which applies and re-sends.
 */

const tNow = () => makeT(DICTS, useSettings.getState().settings.language);

/** The parts of the show a secondary may change (last write wins); the rest stays as the primary has it. */
export const EDITABLE: (keyof CueShow)[] = ["gos", "notes", "speedZones", "layout", "projection", "checklist", "settings"];

/** The top-level fields of the show that differ (by reference), restricted to `EDITABLE`. */
export function editPatch(prev: CueShow, next: CueShow): Partial<CueShow> | null {
  const set: Partial<CueShow> = {};
  let any = false;
  for (const k of EDITABLE) {
    if (prev[k] !== next[k]) {
      (set as Record<string, unknown>)[k] = next[k];
      any = true;
    }
  }
  return any ? set : null;
}

/** Primary: applies a secondary's edit (only `EDITABLE` fields). Returns false if it is not an edit it knows. */
export function applyEdit(op: unknown): boolean {
  const o = op as { type?: string; set?: Record<string, unknown> } | null;
  if (!o || o.type !== "patch" || !o.set || typeof o.set !== "object") return false;
  const set = Object.fromEntries(Object.entries(o.set).filter(([k]) => (EDITABLE as string[]).includes(k)));
  if (!Object.keys(set).length) return false;
  useDoc.getState().change((s) => {
    try {
      // parseShow cleans what came over the network like any file.
      const merged = parseShow(JSON.stringify({ ...s, ...set }));
      return { ...merged, id: s.id };
    } catch {
      return s;
    }
  }, "remote-edit");
  return true;
}

/** Applies a show received by the secondary: opens it, or (same file) only refreshes the edited parts. */
async function openReceived(f: Extract<FileEvent, { phase: "received" }>) {
  const doc = useDoc.getState();
  try {
    if (doc.filePath === f.path && doc.show?.id === f.showId && f.showJson) {
      const next = parseShow(f.showJson);
      if (JSON.stringify(next) !== JSON.stringify(doc.show)) {
        // Not an edit of this computer: it must not go back to the primary.
        fromPrimary = true;
        useDoc.setState({ show: next });
        fromPrimary = false;
      }
      return;
    }
    const opened = await api.tcueOpen(f.path);
    const show = parseShow(f.showJson ?? opened.showJson);
    useDoc.getState().load(show, { filePath: f.path, dirty: false, parts: opened.parts, sha256: opened.sha256 });
    useUi.getState().setMode("show");
    useUi.getState().setBanner("showReceived");
  } catch (e) {
    useUi.getState().showToast(String(e), "error");
  }
}

let lastSent = "";
let fromPrimary = false;

let unsavedSaid = false;

/** Primary: sends the show (file, linked sources and unsaved edits) to the secondary. */
export async function sendShowNow(): Promise<void> {
  const { show, filePath } = useDoc.getState();
  const info = useLink.getState().info;
  if (!show || info.role !== "primary" || !linkUp(info)) return;
  if (!filePath) {
    // A new show that was never saved has no file to send: say it once, it goes out at the first save.
    const t = tNow();
    if (!unsavedSaid) useUi.getState().showToast(t("Save the show: the secondary receives it as soon as it has a file."));
    unsavedSaid = true;
    return;
  }
  unsavedSaid = false;
  const extraPaths = useLibrary
    .getState()
    .library.sources.map((s) => s.absPath)
    .filter((p): p is string => !!p);
  const showJson = JSON.stringify(show);
  try {
    await linkApi().sendShow({ showId: show.id, tcuePath: filePath, extraPaths, showJson });
    lastSent = showJson;
  } catch (e) {
    console.error("show not sent", e);
    const t = tNow();
    useUi.getState().showToast(t("The show could not be sent to the secondary: {error}", { error: String(e) }), "error");
  }
}

/** Starts the link in the interface (call once). Returns the cleanup. */
export function startLink(): () => void {
  const link = linkApi();
  const stops: Array<Promise<() => void>> = [];
  let alive = true;
  let editTimer: ReturnType<typeof setTimeout> | null = null;
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingSet: Record<string, unknown> = {};
  let prevInfo: LinkInfo = useLink.getState().info;

  const onInfo = (info: LinkInfo) => {
    useLink.getState().setInfo(info);
    const role = playbackRole(info);
    if (useRun.getState().role !== role) useRun.setState({ role });
    const justUp = linkUp(info) && !linkUp(prevInfo);
    if (justUp && info.role === "primary") {
      void link.publishState(sharedRun(useRun.getState()));
      void sendShowNow();
    }
    if (info.status === "lost" || info.status === "none") useLink.getState().setPointer(null);
    prevInfo = info;
  };
  link.info().then((i) => alive && onInfo(i));
  stops.push(link.onState(onInfo));

  stops.push(
    link.onEvent((e: LinkEvent) => {
      const t = tNow();
      if (e.type === "request") {
        if (e.op.kind === "edit") {
          if (!applyEdit(e.op.op)) void link.reply(e.requestId, false, "unknown");
        } else handleRequest(t, e.requestId, e.op);
      } else if (e.type === "state") applySharedRun(e.state);
      else if (e.type === "result" && !e.ok) useUi.getState().showToast(refusalText(e.reason, t));
    }),
  );
  stops.push(link.onChat((m) => useLink.getState().addChat(m)));
  stops.push(link.onPointer((p) => useLink.getState().setPointer(p)));
  stops.push(
    link.onFile((f) => {
      if (f.phase === "received") void openReceived(f);
      else if (f.phase === "failed") {
        const t = tNow();
        const text =
          useLink.getState().info.role === "primary"
            ? t("The secondary did not receive the show ({error}): it is sent again at the next change or connection.", { error: f.error })
            : t("The show did not arrive from the primary ({error}): it is sent again at the next change or connection.", { error: f.error });
        useUi.getState().showToast(text, "error");
      }
    }),
  );

  // Primary: the state goes out after every change of the evening, the events when a GO fires.
  const unRun = useRun.subscribe((s, prev) => {
    const info = useLink.getState().info;
    if (info.role !== "primary" || !linkUp(info)) return;
    if (s.playback !== prev.playback || s.startedAt !== prev.startedAt || s.pausedAt !== prev.pausedAt || s.pausedMs !== prev.pausedMs || s.preset !== prev.preset || s.autoPending !== prev.autoPending) {
      void link.publishState(sharedRun(s));
    }
  });
  const unFired = onFired((ids, by) => {
    const info = useLink.getState().info;
    if (info.role !== "primary" || !linkUp(info)) return;
    for (const id of ids) void link.publishEvent(firedEvent(id, by, Date.now()));
  });

  // Edits: the secondary asks the primary; the primary sends the new show to the secondary.
  const unDoc = useDoc.subscribe((s, prev) => {
    const info = useLink.getState().info;
    // Primary: a show saved for the first time (or saved elsewhere) is sent at once.
    if (info.role === "primary" && linkUp(info) && s.filePath && s.filePath !== prev.filePath) {
      void sendShowNow();
      return;
    }
    if (fromPrimary || !s.show || !prev.show || s.loadRev !== prev.loadRev || s.show === prev.show || !linkUp(info)) return;
    if (info.role === "secondary" && !info.simulated) {
      const patch = editPatch(prev.show, s.show);
      if (!patch) return;
      Object.assign(pendingSet, patch);
      if (editTimer) clearTimeout(editTimer);
      editTimer = setTimeout(() => {
        const set = { ...pendingSet };
        for (const k of Object.keys(pendingSet)) delete pendingSet[k];
        void link.request({ kind: "edit", op: { type: "patch", set } });
      }, 400);
    } else if (info.role === "primary") {
      if (sendTimer) clearTimeout(sendTimer);
      sendTimer = setTimeout(() => {
        if (JSON.stringify(useDoc.getState().show) !== lastSent) void sendShowNow();
      }, 600);
    }
  });

  // Our pointer on the script goes to the other computer (Show only, 10 Hz at most, only when it moves).
  let lastPtr = "";
  const ptrTimer = setInterval(() => {
    const info = useLink.getState().info;
    if (info.role === "none" || !linkUp(info) || info.simulated || useUi.getState().mode !== "show") return;
    const c = scriptLive.pointer();
    const g = useScriptView.getState().geometry;
    const at = c && g ? pointOnPage(g, c.x, c.y) : null;
    const key = at ? `${at.page}:${at.x.toFixed(3)}:${at.y.toFixed(3)}` : "";
    if (key === lastPtr) return;
    lastPtr = key;
    void link.pointer(at);
  }, 100);

  return () => {
    alive = false;
    clearInterval(ptrTimer);
    if (editTimer) clearTimeout(editTimer);
    if (sendTimer) clearTimeout(sendTimer);
    unRun();
    unFired();
    unDoc();
    stops.forEach((p) => void p.then((f) => f()));
  };
}
