/**
 * GOs: the points of the script that fire lights, sound and projections (13_cue.md, "I GO"). Pure, no React.
 *
 * - A GO has a point of the script (`anchor`), one or more actions, who gives it (`givenBy`), and may start by
 *   itself after the GO before it (`auto`: Diaframma's Next/Crossfade, Granvelo's "parte da sola").
 * - **Order** = order of the script: page, then height on the page (then across, then the order of the list).
 *   Every function here returns the list in that order.
 * - **Numbering** (derived, never stored): the GOs given by hand are 1…N in script order; a GO that starts by
 *   itself takes the number of the GO before it plus a point: 4, 4.1, 4.2, 5. A stored `label` ("14.5", "Sipario")
 *   is shown instead of the number and does not shift the others.
 * - **Merge**: an item dropped within `thresholdPx` (default 12 px, measured on the script as the user sees it) of
 *   an existing GO becomes one more action of that GO. A GO has at most one light action (a Granvelo memory is the
 *   whole stage) and at most one projection/PowerPoint action: a second one replaces the first. The same sound twice
 *   in one GO is ignored.
 *
 * Field names are those of the file (docs/cue/FORMAT.md): `givenBy`, `ref`, `times`, `levelDb`. Unknown fields of a
 * GO or of an action are kept: every change copies the object (`{ ...go, x }`).
 */

/**
 * A point of the script. Same shape as `ScriptAnchor` of model/anchor.ts (phase 1): when that lands in cue-dev,
 * this becomes `import type { ScriptAnchor as GoAnchor } from "./anchor"`. Only `page` and `y` are used here.
 */
export interface GoAnchor {
  /** Page, from 1. */
  page: number;
  /** Height on the page: 0 top … 1 bottom. */
  y: number;
  /** Position across the page, 0 … 1 (optional). */
  x?: number;
  /** The line at the point and a few words around it (to find it again in a new edition of the script). */
  quote: string;
  before: string;
  after: string;
  /** With a Bardo script: the id of the line (phase 5). */
  lineId?: string;
}

/** A point of the script with only what ordering needs. */
export type AnchorPos = Pick<GoAnchor, "page" | "y" | "x">;

/** An item of a source: a Granvelo memory, a Diaframma track (stable ids). */
export interface ItemRef {
  sourceId: string;
  itemId: string;
}

/**
 * Times changed in Cue (seconds). Unset = the time of the source file.
 * - light: `fadeIn` / `fadeOut` (or `fade` for both), `delay`;
 * - audio: `fade` = fade in, `delay` = wait before it starts;
 * - audioStop: `fade` = fade out.
 */
export interface ActionTimes {
  fade?: number;
  fadeIn?: number;
  fadeOut?: number;
  delay?: number;
}

export interface LightAction {
  id: string;
  kind: "light";
  ref: ItemRef;
  times?: ActionTimes;
}

export interface AudioAction {
  id: string;
  kind: "audio";
  ref: ItemRef;
  times?: ActionTimes;
  /** Level change in dB, added to the track's own volume. */
  levelDb?: number;
}

/** Stops one sound (`ref`) or every sound (no `ref`). */
export interface AudioStopAction {
  id: string;
  kind: "audioStop";
  ref?: ItemRef;
  times?: ActionTimes;
}

/** An image or video of the projections (`projectionItemId`), or a step of their sequence (phase 4: type only). */
export interface ProjectionAction {
  id: string;
  kind: "projection";
  projectionItemId?: string;
  step?: "next" | "previous";
}

/** PowerPoint: next, previous or a slide number (phase 4: type only). */
export interface PowerPointAction {
  id: string;
  kind: "powerpoint";
  powerpoint: "next" | "previous" | number;
}

export type Action = LightAction | AudioAction | AudioStopAction | ProjectionAction | PowerPointAction;
export type ActionKind = Action["kind"];

/** Who may give a GO when a secondary computer is connected. */
export type GivenBy = "both" | "primary" | "secondary";

export interface Go {
  id: string;
  anchor: GoAnchor;
  actions: Action[];
  /** Default "both". */
  givenBy: GivenBy;
  /** Starts by itself after the GO before it. */
  auto?: boolean;
  note?: string;
  /** Shown instead of the derived number ("14.5", "Sipario"). */
  label?: string;
}

/** The columns of the Show screen. */
export type Dept = "lights" | "audio" | "video";
export const DEPTS: readonly Dept[] = ["lights", "audio", "video"];

/** The column an action belongs to. */
export function actionDept(a: Pick<Action, "kind">): Dept {
  switch (a.kind) {
    case "light":
      return "lights";
    case "audio":
    case "audioStop":
      return "audio";
    default:
      return "video";
  }
}

/** The departments a GO acts on, in column order. */
export function goDepts(go: Pick<Go, "actions">): Dept[] {
  return DEPTS.filter((d) => go.actions.some((a) => actionDept(a) === d));
}

/** Kinds of which a GO holds at most one (a second one replaces the first). */
const SINGLE: Record<ActionKind, boolean> = { light: true, audio: false, audioStop: false, projection: true, powerpoint: true };

/**
 * The id the audio engine knows a sound by, inside its source: the track id, or `trackId#actionId` when the action
 * changes its times or level (that action plays its own copy of the track). The native side prefixes the source id
 * (`sourceId:trackId[#actionId]`).
 */
export function audioEngineTrackId(a: AudioAction): string {
  const t = a.times;
  const changed = a.levelDb !== undefined || (t !== undefined && (t.fade !== undefined || t.fadeIn !== undefined || t.fadeOut !== undefined));
  return changed ? `${a.ref.itemId}#${a.id}` : a.ref.itemId;
}

/* ------------------------------------------------------------------ */
/* Order                                                                */
/* ------------------------------------------------------------------ */

/** Script order of two points: page, height, then across. */
export function compareAnchors(a: AnchorPos, b: AnchorPos): number {
  return a.page - b.page || a.y - b.y || (a.x ?? 0) - (b.x ?? 0);
}

/** The GOs in script order (stable: equal points keep the order of the list). Returns the same array if already in order. */
export function sortGos<G extends Pick<Go, "anchor">>(gos: readonly G[]): G[] {
  let sorted = true;
  for (let i = 1; i < gos.length && sorted; i++) if (compareAnchors(gos[i - 1].anchor, gos[i].anchor) > 0) sorted = false;
  if (sorted) return gos as G[];
  return gos
    .map((g, i) => [g, i] as const)
    .sort((a, b) => compareAnchors(a[0].anchor, b[0].anchor) || a[1] - b[1])
    .map(([g]) => g);
}

/* ------------------------------------------------------------------ */
/* Numbering                                                            */
/* ------------------------------------------------------------------ */

export interface GoNumber {
  id: string;
  /** What the button shows: the label if any, else "4" or "4.1". */
  text: string;
  /** The derived number ("4", "4.1"), also when a label is shown. */
  number: string;
  /** Number of the GO given by hand it belongs to (0 for auto GOs before the first one). */
  main: number;
  /** 0 for a GO given by hand, 1, 2… for the GOs that start by themselves after it. */
  sub: number;
}

/** Numbers of the GOs (in script order). */
export function numberGos(gos: readonly Pick<Go, "id" | "anchor" | "auto" | "label">[]): GoNumber[] {
  let main = 0;
  let sub = 0;
  return sortGos(gos).map((g) => {
    if (g.auto) sub++;
    else {
      main++;
      sub = 0;
    }
    const number = sub ? `${main}.${sub}` : String(main);
    const label = typeof g.label === "string" ? g.label.trim() : "";
    return { id: g.id, text: label || number, number, main, sub };
  });
}

/** How many GOs are given by hand ("GO 13 di 62"). */
export const mainGoCount = (gos: readonly Pick<Go, "auto">[]): number => gos.filter((g) => !g.auto).length;

/* ------------------------------------------------------------------ */
/* Merge and edit                                                       */
/* ------------------------------------------------------------------ */

/** Default distance (script pixels) within which a drop joins an existing GO. */
export const DEFAULT_MERGE_PX = 12;
/** Nominal page height used when no `toY` is given (so the threshold is a fraction of the page). */
export const NOMINAL_PAGE_PX = 1000;

export interface MergeOptions {
  /** Where an anchor is on the script, in pixels (the script view's own function). Default: 1000 px pages. */
  toY?: (a: AnchorPos) => number;
  /** Default `DEFAULT_MERGE_PX`. */
  thresholdPx?: number;
}

const nominalY = (a: AnchorPos) => (a.page - 1) * NOMINAL_PAGE_PX + a.y * NOMINAL_PAGE_PX;

/** The GO nearest to `anchor` within the threshold (null if none). Ties go to the earlier GO. */
export function mergeTarget<G extends Pick<Go, "id" | "anchor">>(gos: readonly G[], anchor: AnchorPos, opts: MergeOptions = {}): G | null {
  const toY = opts.toY ?? nominalY;
  const limit = opts.thresholdPx ?? DEFAULT_MERGE_PX;
  const y = toY(anchor);
  let best: G | null = null;
  let bestD = Infinity;
  for (const g of sortGos(gos)) {
    const d = Math.abs(toY(g.anchor) - y);
    if (d <= limit && d < bestD) {
      best = g;
      bestD = d;
    }
  }
  return best;
}

const sameRef = (a: ItemRef | undefined, b: ItemRef | undefined) => !!a && !!b && a.sourceId === b.sourceId && a.itemId === b.itemId;
const refOf = (a: Action): ItemRef | undefined => ("ref" in a ? a.ref : undefined);

/** What adding `action` to `go` does: added, replaced an action of the same single kind, or nothing (a duplicate). */
export function addActionTo(go: Go, action: Action): { go: Go; result: "added" | "replaced" | "duplicate"; replaced?: Action } {
  if (go.actions.some((a) => a.id === action.id)) return { go, result: "duplicate" };
  if (action.kind === "audio" && go.actions.some((a) => a.kind === "audio" && sameRef(a.ref, action.ref))) return { go, result: "duplicate" };
  if (SINGLE[action.kind]) {
    const i = go.actions.findIndex((a) => a.kind === action.kind || (isProjectionKind(a.kind) && isProjectionKind(action.kind)));
    if (i >= 0) {
      if (sameRef(refOf(go.actions[i]), refOf(action))) return { go, result: "duplicate" };
      const actions = [...go.actions];
      const [replaced] = actions.splice(i, 1, action);
      return { go: { ...go, actions }, result: "replaced", replaced };
    }
  }
  return { go: { ...go, actions: sortActions([...go.actions, action]) }, result: "added" };
}

/** Projection and PowerPoint share the screen: one of them per GO. */
const isProjectionKind = (k: ActionKind) => k === "projection" || k === "powerpoint";

/** Actions in column order (lights, audio, video), keeping the order within a column. */
export function sortActions(actions: Action[]): Action[] {
  const rank = (a: Action) => DEPTS.indexOf(actionDept(a));
  return actions
    .map((a, i) => [a, i] as const)
    .sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1])
    .map(([a]) => a);
}

export interface DropResult {
  gos: Go[];
  goId: string;
  /** true: the action joined an existing GO. */
  merged: boolean;
  result: "added" | "replaced" | "duplicate";
  replaced?: Action;
}

/**
 * An item dropped on the script: joins the GO within the threshold, or makes a new GO at `anchor` (who gives it:
 * both; `auto` as given, e.g. the item's "starts by itself").
 */
export function dropAction(gos: readonly Go[], anchor: GoAnchor, action: Action, opts: MergeOptions & { makeId: () => string; auto?: boolean }): DropResult {
  const target = mergeTarget(gos, anchor, opts);
  if (target) {
    const r = addActionTo(target, action);
    return { gos: sortGos(gos.map((g) => (g.id === target.id ? r.go : g))), goId: target.id, merged: true, result: r.result, replaced: r.replaced };
  }
  const go: Go = { id: opts.makeId(), anchor, actions: [action], givenBy: "both" };
  if (opts.auto) go.auto = true;
  return { gos: sortGos([...gos, go]), goId: go.id, merged: false, result: "added" };
}

/** A new GO with no actions yet ("Nuovo GO qui", N). */
export function addGo(gos: readonly Go[], anchor: GoAnchor, makeId: () => string): { gos: Go[]; goId: string } {
  const go: Go = { id: makeId(), anchor, actions: [], givenBy: "both" };
  return { gos: sortGos([...gos, go]), goId: go.id };
}

const mapGo = (gos: readonly Go[], goId: string, fn: (g: Go) => Go): Go[] => {
  let changed = false;
  const out = gos.map((g) => {
    if (g.id !== goId) return g;
    const n = fn(g);
    if (n !== g) changed = true;
    return n;
  });
  return changed ? sortGos(out) : (gos as Go[]);
};

export function removeGo(gos: readonly Go[], goId: string): Go[] {
  return gos.some((g) => g.id === goId) ? gos.filter((g) => g.id !== goId) : (gos as Go[]);
}

/** Adds an action to a GO (same rules as a drop). */
export const addAction = (gos: readonly Go[], goId: string, action: Action): Go[] => mapGo(gos, goId, (g) => addActionTo(g, action).go);

/** Removes an action. A GO left with no actions stays (a call with only a note); remove it with `removeGo`. */
export const removeAction = (gos: readonly Go[], goId: string, actionId: string): Go[] =>
  mapGo(gos, goId, (g) => (g.actions.some((a) => a.id === actionId) ? { ...g, actions: g.actions.filter((a) => a.id !== actionId) } : g));

/** Changes an action's fields (times, level, ref…). `kind` and `id` cannot change. */
export const updateAction = (gos: readonly Go[], goId: string, actionId: string, patch: Partial<Omit<Action, "id" | "kind">>): Go[] =>
  mapGo(gos, goId, (g) => (g.actions.some((a) => a.id === actionId) ? { ...g, actions: g.actions.map((a) => (a.id === actionId ? ({ ...a, ...patch, id: a.id, kind: a.kind } as Action) : a)) } : g));

/**
 * Moves an action to another GO (same rules as a drop: it may replace or be a duplicate there). A GO left empty by
 * the move is removed when `dropEmpty` (default true): dragging the only action of a GO elsewhere moves the GO.
 */
export function moveAction(gos: readonly Go[], fromGoId: string, actionId: string, toGoId: string, dropEmpty = true): Go[] {
  if (fromGoId === toGoId) return gos as Go[];
  const from = gos.find((g) => g.id === fromGoId);
  const to = gos.find((g) => g.id === toGoId);
  const action = from?.actions.find((a) => a.id === actionId);
  if (!from || !to || !action) return gos as Go[];
  let out = removeAction(gos, fromGoId, actionId);
  out = addAction(out, toGoId, action);
  if (dropEmpty && from.actions.length === 1) out = removeGo(out, fromGoId);
  return out;
}

/** Moves a GO to another point of the script. */
export const moveGo = (gos: readonly Go[], goId: string, anchor: GoAnchor): Go[] => mapGo(gos, goId, (g) => ({ ...g, anchor }));

export const setGivenBy = (gos: readonly Go[], goId: string, givenBy: GivenBy): Go[] => mapGo(gos, goId, (g) => (g.givenBy === givenBy ? g : { ...g, givenBy }));

export const setAuto = (gos: readonly Go[], goId: string, auto: boolean): Go[] =>
  mapGo(gos, goId, (g) => {
    if (!!g.auto === auto) return g;
    const n = { ...g };
    if (auto) n.auto = true;
    else delete n.auto;
    return n;
  });

export const setNote = (gos: readonly Go[], goId: string, note: string): Go[] =>
  mapGo(gos, goId, (g) => {
    const n = { ...g };
    if (note.trim()) n.note = note;
    else delete n.note;
    return n;
  });

export const setLabel = (gos: readonly Go[], goId: string, label: string): Go[] =>
  mapGo(gos, goId, (g) => {
    const n = { ...g };
    if (label.trim()) n.label = label.trim();
    else delete n.label;
    return n;
  });

/** Every action that points to an item (for "missing item" checks), with its GO. */
export function itemActions(gos: readonly Go[]): { go: Go; action: LightAction | AudioAction | AudioStopAction; ref: ItemRef }[] {
  const out: { go: Go; action: LightAction | AudioAction | AudioStopAction; ref: ItemRef }[] = [];
  for (const go of gos) for (const a of go.actions) if ((a.kind === "light" || a.kind === "audio" || a.kind === "audioStop") && a.ref) out.push({ go, action: a, ref: a.ref });
  return out;
}
