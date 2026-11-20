import { create } from "zustand";
import type { TFunc } from "@theatre-suite/core";
import { api, emitEvent, isDemo, isTauri, onEvent, type MonitorInfo } from "./api";
import { pptDo } from "./ppt";
import { dropImageCache } from "./projMedia";
import { BLACK_OUT, effectiveColor, nextItem, NEUTRAL, stepTarget, type ImageRef, type OutMedia, type OutState } from "../model/projection";
import type { PowerPointAction, ProjectionAction } from "../model/gos";
import type { ProjectionItem } from "../model/show";
import { useDoc } from "../store/doc";

/**
 * What is on the output screen, and the output window itself. One controller in the main window: the GO actions, the
 * Tappo key and the Proiezioni mode all go through here. The output window (and the preview in Proiezioni) only draw
 * the `OutState` they are given; the window gets it as the event `proj:state`, and asks for it again with `proj:ready`.
 */
interface ProjStore {
  /** The item on screen (null: nothing yet). Blank does not change it: Tappo is lifted back to it. */
  current: string | null;
  blank: boolean;
  out: OutState;
  windowOpen: boolean;
  /** The test pattern is on. */
  testing: boolean;
  monitors: MonitorInfo[];
  /** Fired items count (makes `OutState.key` new each time). */
  fired: number;
}

export const useProj = create<ProjStore>(() => ({ current: null, blank: false, out: BLACK_OUT, windowOpen: false, testing: false, monitors: [], fired: 0 }));

const doc = () => useDoc.getState();
const projection = () => doc().show?.projection ?? null;

const imageRef = (part: string): ImageRef => ({ file: doc().filePath, staged: doc().pending[part] ?? null, part });

/** The picture of an item as it is stored (a video's poster is its thumbnail). */
export const posterOf = (item: ProjectionItem): ImageRef | null => {
  const part = item.kind === "video" ? item.thumb : item.part;
  return part ? imageRef(part) : null;
};

/** The address of a video: authorised by the native side for files of the show folder. In the demo, a stand-in. */
async function videoSrc(item: ProjectionItem): Promise<string> {
  if (!item.path) throw new Error("missing: the video has no file");
  if (!isTauri) return isDemo ? `demo:${item.path}` : Promise.reject(new Error("missing: no video in the preview"));
  const file = doc().filePath;
  if (!file) throw new Error("unsaved: save the show first");
  return api.projVideoUrl(file, item.path);
}

async function mediaOf(item: ProjectionItem): Promise<OutMedia> {
  if (item.kind === "video") return { type: "video", src: await videoSrc(item), atEnd: item.atEnd ?? "hold", poster: posterOf(item) ?? undefined };
  if (!item.part) throw new Error("missing: the image has no file");
  return { type: "image", image: imageRef(item.part) };
}

function blankMedia(): OutMedia {
  const b = projection()?.blank;
  return b && b.kind === "image" ? { type: "image", image: imageRef(b.part) } : { type: "black" };
}

function send(out: OutState) {
  useProj.setState({ out });
  void emitEvent("proj:state", out);
}

/** Puts an item on the output with its own transition and colour. */
export async function fireItem(itemId: string): Promise<void> {
  const p = projection();
  const item = p?.items.find((i) => i.id === itemId);
  if (!p || !item) throw new Error("missing-item");
  const media = await mediaOf(item);
  const fired = useProj.getState().fired + 1;
  useProj.setState({ current: item.id, blank: false, fired });
  send({ key: `${item.id}#${fired}`, media, color: effectiveColor(p, item), transition: item.transition, test: useProj.getState().testing });
}

/** "Passo successivo / precedente": false when the sequence has no such step. */
export async function stepItem(dir: "next" | "previous"): Promise<boolean> {
  const p = projection();
  if (!p) return false;
  const target = stepTarget(p.items, useProj.getState().current, dir);
  if (!target) return false;
  await fireItem(target.id);
  return true;
}

/** Tappo: the blank image over everything (cut), or back to what was on screen. */
export async function setBlank(on: boolean): Promise<void> {
  const p = projection();
  const { current, fired } = useProj.getState();
  if (on) {
    useProj.setState({ blank: true, fired: fired + 1 });
    send({ key: `blank#${fired + 1}`, media: blankMedia(), color: NEUTRAL, transition: { kind: "cut" }, test: useProj.getState().testing });
    return;
  }
  const item = p?.items.find((i) => i.id === current);
  if (!p || !item) {
    useProj.setState({ blank: false });
    send({ ...BLACK_OUT, key: `black#${fired}`, test: useProj.getState().testing });
    return;
  }
  await fireItem(item.id);
}

export const toggleBlank = () => setBlank(!useProj.getState().blank);

/** A projection command of a GO (see model/playback.ts): `null` action = the blank image. */
export async function runProjection(action: ProjectionAction | PowerPointAction | null): Promise<void> {
  if (!action) return setBlank(true);
  if (action.kind === "powerpoint") return pptDo(action.powerpoint === "next" || action.powerpoint === "previous" ? action.powerpoint : Number(action.powerpoint));
  if (action.projectionItemId) return fireItem(action.projectionItemId);
  if (action.step) {
    if (!(await stepItem(action.step))) throw new Error("end-of-sequence");
  }
}

/* ------------------------------------------------------------------ */
/* The output window                                                    */
/* ------------------------------------------------------------------ */

export async function refreshMonitors(): Promise<MonitorInfo[]> {
  const monitors = await api.projMonitors().catch(() => []);
  useProj.setState({ monitors });
  return monitors;
}

/** The screen to use: the one chosen last time (by name), else the first that is not the one Cue is on. */
export function chooseMonitor(monitors: readonly MonitorInfo[], name: string | null): MonitorInfo | null {
  return monitors.find((m) => m.name === name) ?? monitors.find((m) => !m.current) ?? null;
}

/** Opens the output window (only when the user asks): fullscreen on the screen, or `windowed` on any. */
export async function openOutput(opts: { windowed?: boolean } = {}): Promise<void> {
  const monitors = await refreshMonitors();
  const name = projection()?.screen ?? null;
  const m = chooseMonitor(monitors, name);
  if (!opts.windowed && !m) throw new Error("single-monitor");
  await api.projOpen(m?.index ?? null, !!opts.windowed);
  useProj.setState({ windowOpen: true });
  if (!isTauri) return;
  // The window asks for the state when it is ready (listener below); send it now too in case it already is.
  void emitEvent("proj:state", useProj.getState().out);
}

export async function closeOutput(): Promise<void> {
  await api.projClose();
  useProj.setState({ windowOpen: false, testing: false });
}

/** Settings → "Prova schema": the test pattern on the output (opens it if needed). */
export async function toggleTest(): Promise<void> {
  const testing = !useProj.getState().testing;
  useProj.setState({ testing });
  send({ ...useProj.getState().out, test: testing });
}

let wired = false;
/** Listens to the output window (call once at start). */
export function startProjectionLink(): void {
  if (wired) return;
  wired = true;
  void onEvent("proj:ready", () => void emitEvent("proj:state", useProj.getState().out));
  void onEvent("proj:closed", () => useProj.setState({ windowOpen: false, testing: false }));
  void onEvent("proj:request", () => void emitEvent("proj:state", useProj.getState().out));
}

/** The output follows the open show: a new show starts with nothing on screen. Returns the stop function. */
export function startProjectionSync(): () => void {
  startProjectionLink();
  let rev = useDoc.getState().loadRev;
  return useDoc.subscribe((s) => {
    if (s.loadRev === rev) return;
    rev = s.loadRev;
    resetProjection();
    dropImageCache();
  });
}

/** Back to nothing on screen when a show is closed or loaded. */
export function resetProjection(): void {
  useProj.setState({ current: null, blank: false, out: BLACK_OUT, testing: false });
  void emitEvent("proj:state", BLACK_OUT);
}

/** A sentence for a projection problem. */
export function projErrorText(t: TFunc, e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  const c = m.split(":")[0];
  switch (c) {
    case "missing-item":
      return t("That image is no longer in the projections.");
    case "end-of-sequence":
      return t("There is no further image in the sequence.");
    case "single-monitor":
      return t("There is only one screen: connect the projector, or use the preview window.");
    case "unsaved":
      return t("Save the show first: videos are found next to the show file.");
    case "missing":
      return t("The file is not there: check the show folder.");
    case "outside":
      return t("The video is not in the show folder.");
    case "not-video":
      return t("This file is not a video Cue can play (MP4).");
    default:
      return t("The projection did not answer: {error}", { error: m });
  }
}

export { nextItem };
