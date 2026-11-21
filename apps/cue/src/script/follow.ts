import { create } from "zustand";
import { compareAnchors, type Go } from "../model/gos";
import type { SpeedZone } from "../model/show";
import { useDoc } from "../store/doc";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { onStandbyChange, useRun } from "../show/run";
import { anchorTop, READING_LINE, scriptLive, useScriptView, type Geometry } from "./view";

/**
 * The script follows the show (13_cue.md, "Il copione"):
 * - **after a GO** (and after a click that changes the standby) it glides so the standby GO is in view (setting
 *   "follow the standby", on by default);
 * - **auto scroll**: a general speed (the show's `settings.autoScrollSpeed`, lines per second) times the **speed
 *   zone** the reading line is in (`speedZones`: from a point, or from a GO, until the next zone) times this
 *   computer's on-the-fly factor (+/−). Scrolling by hand (wheel, keys, scroll bar) suspends it; "Segui" resumes it.
 *   Each computer scrolls on its own. Only in the Show, never during a peek or a glide.
 */

/** A line of a script in PDF points (12 pt type, a little leading). */
export const LINE_PT = 14;
export const FACTOR_MIN = 0.2;
export const FACTOR_MAX = 3;
export const FACTOR_STEP = 0.1;

interface AutoScrollStore {
  on: boolean;
  /** Scrolled by hand: waiting for "Segui". */
  suspended: boolean;
  /** This computer's factor on the general speed. */
  factor: number;
  /** The speed zone now (its factor; 1 = none). */
  zone: number;
  setOn: (on: boolean) => void;
  setFactor: (f: number) => void;
  resume: () => void;
}

export const useAutoScroll = create<AutoScrollStore>((set) => ({
  on: false,
  suspended: false,
  factor: 1,
  zone: 1,
  setOn: (on) => set({ on, suspended: false }),
  setFactor: (f) => set({ factor: Math.round(Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, f)) * 10) / 10 }),
  resume: () => set({ suspended: false }),
}));

/** Where each zone starts (content px), in order. A zone from a GO starts at the GO's point. */
export function zoneStarts(zones: readonly SpeedZone[], gos: readonly Go[], g: Geometry): { y: number; speed: number }[] {
  const byId = new Map(gos.map((x) => [x.id, x]));
  return zones
    .map((z) => {
      const from = (z.fromGoId && byId.get(z.fromGoId)?.anchor) || z.from;
      return { from, y: anchorTop(g, from), speed: z.speed };
    })
    .filter((z): z is { from: typeof z.from; y: number; speed: number } => z.y !== null)
    .sort((a, b) => compareAnchors(a.from, b.from))
    .map(({ y, speed }) => ({ y, speed }));
}

/** The factor of the zone at content height `y` (1 before the first zone). */
export function zoneAt(starts: readonly { y: number; speed: number }[], y: number): number {
  let f = 1;
  for (const z of starts) {
    if (z.y <= y) f = z.speed;
    else break;
  }
  return f;
}

/** Pixels per second of the auto scroll. */
export const autoSpeedPx = (linesPerSec: number, g: Geometry, zone: number, factor: number): number => linesPerSec * LINE_PT * g.scale * zone * factor;

/** The scrollTop that brings content height `y` to the reading line, or null when `y` is already well in view. */
export function followTarget(y: number, top: number, viewH: number): number | null {
  if (y >= top + viewH * 0.12 && y <= top + viewH * 0.78) return null;
  return Math.max(0, y - viewH * READING_LINE);
}

/** The standby GO's point, in content px. */
function standbyY(): number | null {
  const g = useScriptView.getState().geometry;
  const show = useDoc.getState().show;
  const id = useRun.getState().playback.standbyId;
  if (!g || !show || !id) return null;
  const go = show.gos.find((x) => x.id === id);
  return go ? anchorTop(g, go.anchor) : null;
}

/** Glides to the standby GO (also "Segui" with the auto scroll off). */
export function followStandby(force = false) {
  const y = standbyY();
  if (y === null) return;
  const h = scriptLive.viewHeight();
  const top = scriptLive.scrollTop();
  const target = force ? Math.max(0, y - h * READING_LINE) : followTarget(y, top, h);
  if (target === null) return;
  const st = useScriptView.getState();
  // During a peek the script stays where the user looks: releasing Ctrl brings it to the standby.
  if (st.peek && !st.peek.returning) return st.setPeek({ ...st.peek, fromTop: Math.min(target, scriptLive.maxTop()), moved: true });
  scriptLive.tweenTo(target);
}

let raf: number | null = null;
let last = 0;
let pos = 0;
let expected: number | null = null;

function frame(now: number) {
  raf = requestAnimationFrame(frame);
  const a = useAutoScroll.getState();
  const g = useScriptView.getState().geometry;
  const show = useDoc.getState().show;
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (!a.on || a.suspended || !g || !show || useUi.getState().mode !== "show" || scriptLive.tweening() || useScriptView.getState().peek) {
    expected = null;
    return;
  }
  const top = scriptLive.scrollTop();
  if (expected !== null && Math.abs(top - expected) > 2) {
    // Moved by hand: wait for "Segui".
    expected = null;
    useAutoScroll.setState({ suspended: true });
    return;
  }
  if (expected === null) pos = top;
  const zone = zoneAt(zoneStarts(show.speedZones, show.gos, g), pos + scriptLive.viewHeight() * READING_LINE);
  if (zone !== a.zone) useAutoScroll.setState({ zone });
  const max = scriptLive.maxTop();
  pos = Math.min(max, pos + autoSpeedPx(show.settings.autoScrollSpeed, g, zone, a.factor) * dt);
  scriptLive.setTop(pos);
  expected = scriptLive.scrollTop();
}

/** Starts following (call once): the glide after GOs and the auto scroll loop (only while on). */
export function startFollow(): () => void {
  const stopStandby = onStandbyChange(() => {
    if (useUi.getState().mode !== "show" || !useSettings.getState().settings.followStandby) return;
    // Let the timeline paint the new colours first.
    requestAnimationFrame(() => followStandby());
  });
  const loop = (on: boolean) => {
    if (on && raf === null) {
      last = performance.now();
      expected = null;
      raf = requestAnimationFrame(frame);
    } else if (!on && raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  };
  loop(useAutoScroll.getState().on);
  const stopAuto = useAutoScroll.subscribe((s, prev) => {
    if (s.on !== prev.on) loop(s.on);
    if (s.suspended !== prev.suspended || s.on !== prev.on) expected = null;
  });
  const stopDoc = useDoc.subscribe((s, prev) => {
    if (s.loadRev !== prev.loadRev) useAutoScroll.setState({ on: false, suspended: false, factor: 1, zone: 1 });
  });
  return () => {
    stopStandby();
    stopAuto();
    stopDoc();
    loop(false);
  };
}
