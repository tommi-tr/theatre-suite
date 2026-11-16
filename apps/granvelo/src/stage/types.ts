import type { Id, SceneryPlacement, Vec3 } from "../model/types";
import type { StageDoc } from "./scene";

/**
 * The contract of the stage views (2D and 3D): what they draw and how they report the mouse. The views know nothing of
 * the stores: the screen that uses them gives the document, the light state and the handlers.
 */

/** What is under the mouse. */
export type StageHit = { kind: "light"; id: Id } | { kind: "aim"; id: Id } | { kind: "scenery"; id: Id } | { kind: "truss"; id: Id } | { kind: "empty" };

/**
 * Which coordinates a drag changes: `xy` = on a horizontal plane (plan, perspective), `xz` = on a vertical plane facing
 * the audience (front), `z` = height only (perspective with Shift).
 */
export type DragAxes = "xy" | "xz" | "z";

/**
 * A drag started by a press. The view moves the point `from` with the mouse (keeping the distance between the mouse and
 * the point where the press happened) and calls `move` with the new world point; `end` with the last point when the
 * button is released after a real movement, with null when nothing moved (a simple click) or on Esc.
 */
export interface StageDrag {
  from: Vec3;
  move: (to: Vec3, axes: DragAxes) => void;
  end: (to: Vec3 | null, axes: DragAxes) => void;
}

export interface PressInfo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/** A press on the stage: return a drag to follow the mouse, or null. */
export type OnStagePress = (hit: StageHit, info: PressInfo) => StageDrag | null;

/** Detail of the preview (computer setting): flat ellipses, or soft pools and beams. */
export type StageDetail = "essential" | "medium";

export type StageCamera = "perspective" | "plan" | "front";

/** Which things answer the mouse (the others are only drawn). */
export interface StagePick {
  lights?: boolean;
  aims?: boolean;
  scenery?: boolean;
  trusses?: boolean;
}

export interface StageViewProps {
  doc: StageDoc;
  /** The 512 DMX values to show (index = channel − 1); omitted = no light, only the symbols. */
  values?: ArrayLike<number>;
  /** Selected lights: accent frame and label, beam outline. */
  selected?: readonly Id[];
  /** Scenery on stage: "all" (default: every piece where it was built) or the placements of a memory. */
  scenery?: readonly SceneryPlacement[] | "all";
  /** Selected scenery piece (outlined in the accent). */
  selectedScenery?: Id | null;
  detail?: StageDetail;
  /** Show the aim points of the selected lights as handles ("Orienta"). */
  showAims?: boolean;
  pick?: StagePick;
  onPress?: OnStagePress;
  /** A thumbnail: no labels, no conflicts, thinner lines. */
  compact?: boolean;
  className?: string;
  /** Accessible name of the view. */
  label?: string;
}
