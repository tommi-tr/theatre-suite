import { linkSourceFile } from "../lib/sources";
import {
  addGo,
  dropAction,
  removeAction,
  removeGo,
  setAuto,
  setGivenBy,
  setLabel,
  setNote,
  updateAction,
  addAction,
  type Action,
  type ActionTimes,
  type DropResult,
  type Go,
  type GoAnchor,
  type GivenBy,
  type ItemRef,
  type MergeOptions,
} from "../model/gos";
import { relativePath, type SourceLink } from "../model/sources";
import type { CueShow, SpeedZone } from "../model/show";
import { useDoc } from "../store/doc";
import { useLibrary } from "../store/library";
import { useUi } from "../store/ui";
import type { DragPayload } from "./drag";

/**
 * What Prepara does to the show: every function changes `show` through `useDoc.change` (so undo and redo work) and
 * returns what happened. The overlay on the script calls `addItemAt` (drop of a library item), `newGoHere` (N) and
 * `useUi.selectGo` (click on a dot or a button); the panels call the rest.
 *
 * `show.gos` is typed in model/show.ts; here it is the richer `Go` of model/gos.ts (same JSON).
 */

export const gosOf = (show: CueShow): Go[] => show.gos as unknown as Go[];
const withGos = (show: CueShow, gos: Go[]): CueShow => (gos === (show.gos as unknown)) ? show : { ...show, gos: gos as unknown as CueShow["gos"] };

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return Math.random().toString(16).slice(2, 14).padEnd(12, "0");
}

/** Edits the list of GOs as one step of undo (`key`: quick successive edits of the same thing are one step). */
function editGos(fn: (gos: Go[]) => Go[], key?: string): void {
  useDoc.getState().change((s) => withGos(s, fn(gosOf(s))), key);
}

/* ------------------------------------------------------------------ */
/* Creating GOs                                                         */
/* ------------------------------------------------------------------ */

export interface AddItemOptions extends Pick<MergeOptions, "toY" | "thresholdPx"> {
  makeId?: () => string;
}

/**
 * A library item dropped on the script at `anchor`: joins the GO within the merge distance (12 px; `opts.toY` is the
 * script view's own measure of an anchor in pixels), else makes a new GO there (starting by itself when the item
 * does: Next/Crossfade of Diaframma, "parte da sola" of Granvelo). The GO becomes the selected one.
 * Null when the item is not in the library (its file is missing); `result: "duplicate"` changes nothing.
 */
export function addItemAt(anchor: GoAnchor, item: DragPayload, opts: AddItemOptions = {}): DropResult | null {
  const show = useDoc.getState().show;
  if (!show) return null;
  const { library } = useLibrary.getState();
  const ref: ItemRef = { sourceId: item.sourceId, itemId: item.itemId };
  const found = item.kind === "light" ? library.light(ref) : library.track(ref);
  if (!found) return null;
  const makeId = opts.makeId ?? newId;
  const action: Action = { id: makeId(), kind: item.kind, ref };
  const r = dropAction(gosOf(show), anchor, action, { toY: opts.toY, thresholdPx: opts.thresholdPx, makeId, auto: found.startsByItself });
  if (r.result !== "duplicate") useDoc.getState().change((s) => withGos(s, r.gos));
  useUi.getState().selectGo(r.goId);
  return r;
}

/** "Nuovo GO qui" (N): an empty GO at `anchor`, selected, ready for its actions. */
export function newGoHere(anchor: GoAnchor, makeId: () => string = newId): string | null {
  const show = useDoc.getState().show;
  if (!show) return null;
  const r = addGo(gosOf(show), anchor, makeId);
  useDoc.getState().change((s) => withGos(s, r.gos));
  useUi.getState().selectGo(r.goId);
  return r.goId;
}

/* ------------------------------------------------------------------ */
/* The selected GO                                                      */
/* ------------------------------------------------------------------ */

export function deleteGo(goId: string): void {
  editGos((gos) => removeGo(gos, goId));
  // Its speed zone goes with it.
  useDoc.getState().change((s) => (s.speedZones.some((z) => z.fromGoId === goId) ? { ...s, speedZones: s.speedZones.filter((z) => z.fromGoId !== goId) } : s));
  if (useUi.getState().selectedGoId === goId) useUi.getState().selectGo(null);
}

export const deleteAction = (goId: string, actionId: string): void => editGos((gos) => removeAction(gos, goId, actionId));

export const changeGoLabel = (goId: string, label: string): void => editGos((gos) => setLabel(gos, goId, label), `label:${goId}`);
export const changeGoNote = (goId: string, note: string): void => editGos((gos) => setNote(gos, goId, note), `note:${goId}`);
export const changeGivenBy = (goId: string, by: GivenBy): void => editGos((gos) => setGivenBy(gos, goId, by));
export const changeAuto = (goId: string, auto: boolean): void => editGos((gos) => setAuto(gos, goId, auto));

/**
 * Overrides (or, with `undefined`, clears) times of an action: `{ fadeIn: 2 }` sets it, `{ fadeIn: undefined }` goes back
 * to the time of the source file. An empty `times` object is removed.
 */
export function changeTimes(goId: string, actionId: string, patch: Partial<Record<keyof ActionTimes, number | undefined>>): void {
  editGos(
    (gos) => {
      const action = gos.find((g) => g.id === goId)?.actions.find((a) => a.id === actionId);
      if (!action || (action.kind !== "light" && action.kind !== "audio" && action.kind !== "audioStop")) return gos;
      const times: ActionTimes = { ...(action.times ?? {}) };
      for (const [k, v] of Object.entries(patch) as [keyof ActionTimes, number | undefined][]) {
        if (v === undefined) delete times[k];
        else times[k] = v;
      }
      return updateAction(gos, goId, actionId, { times: Object.keys(times).length ? times : undefined } as Partial<Action>);
    },
    `times:${actionId}`,
  );
}

/** Level of a sound in dB over its own volume; `undefined` = as in the file. */
export const changeLevel = (goId: string, actionId: string, levelDb: number | undefined): void =>
  editGos((gos) => updateAction(gos, goId, actionId, { levelDb } as Partial<Action>), `level:${actionId}`);

/** "Stop a sound": a stop action for one track, or (no `ref`) for every sound. */
export function addStop(goId: string, ref?: ItemRef): void {
  editGos((gos) => addAction(gos, goId, ref ? { id: newId(), kind: "audioStop", ref } : { id: newId(), kind: "audioStop" }));
}

/** Speed of the automatic scroll from this GO on (a speed zone that starts at the GO); `null` = none. */
export function changeGoSpeed(goId: string, speed: number | null): void {
  useDoc.getState().change((s) => {
    const go = gosOf(s).find((g) => g.id === goId);
    if (!go) return s;
    const rest = s.speedZones.filter((z) => z.fromGoId !== goId);
    if (speed === null) return rest.length === s.speedZones.length ? s : { ...s, speedZones: rest };
    const old = s.speedZones.find((z) => z.fromGoId === goId);
    const zone: SpeedZone = { ...old, id: old?.id ?? newId(), from: { ...go.anchor }, fromGoId: goId, speed };
    return { ...s, speedZones: [...rest, zone] };
  }, `speed:${goId}`);
}

export const goSpeed = (show: CueShow, goId: string): number | null => show.speedZones.find((z) => z.fromGoId === goId)?.speed ?? null;

/* ------------------------------------------------------------------ */
/* Linked files                                                         */
/* ------------------------------------------------------------------ */

/** How many GOs use the items of a source (each GO once). */
export function sourceUsage(show: CueShow, sourceId: string): number {
  return gosOf(show).filter((g) => g.actions.some((a) => "ref" in a && a.ref?.sourceId === sourceId)).length;
}

const samePath = (a: string, b: string) => a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();

export type LinkResult = { result: "added"; link: SourceLink } | { result: "duplicate"; link: SourceLink } | { result: "refused"; reason: "type" | "wrongFormat" | "unreadable" | "newer"; app?: string };

/**
 * Links a `.granvelo` or `.diaframma` file chosen by the user (path stored relative to the show file when the show
 * is saved on the same drive). The same file twice is not linked twice. Files that Cue cannot read are refused.
 */
export async function linkSource(absPath: string, makeId: () => string = newId): Promise<LinkResult> {
  const { show, filePath } = useDoc.getState();
  if (!show) return { result: "refused", reason: "type" };
  const made = await linkSourceFile(absPath, filePath, makeId);
  if (!made) return { result: "refused", reason: "type" };
  const dup = (show.sources as SourceLink[]).find((s) => samePath(s.path, made.link.path) || (filePath && relativePath(filePath, absPath) !== null && samePath(s.path, relativePath(filePath, absPath)!)));
  if (dup) return { result: "duplicate", link: dup };
  const state = made.loaded.status.state;
  if (state === "wrongFormat" || state === "unreadable" || state === "newer") return { result: "refused", reason: state, app: made.link.app };
  useDoc.getState().change((s) => ({ ...s, sources: [...(s.sources as SourceLink[]), made.link] as unknown as CueShow["sources"] }));
  return { result: "added", link: made.link };
}

/**
 * Points an existing source (missing, moved) to another file: same id, so the GOs that use it work again where the
 * items are still in the new file.
 */
export async function relinkSource(sourceId: string, absPath: string): Promise<LinkResult> {
  const { show, filePath } = useDoc.getState();
  const old = (show?.sources as SourceLink[] | undefined)?.find((s) => s.id === sourceId);
  if (!show || !old) return { result: "refused", reason: "type" };
  const made = await linkSourceFile(absPath, filePath, () => sourceId);
  if (!made || made.link.app !== old.app) return { result: "refused", reason: "type", app: old.app };
  const state = made.loaded.status.state;
  if (state === "wrongFormat" || state === "unreadable" || state === "newer") return { result: "refused", reason: state, app: made.link.app };
  // Keep the Granvelo document id of the old link when the new file is the same show; take the new one otherwise.
  useDoc.getState().change((s) => ({ ...s, sources: (s.sources as SourceLink[]).map((l) => (l.id === sourceId ? { ...l, ...made.link, id: sourceId } : l)) as unknown as CueShow["sources"] }));
  return { result: "added", link: made.link };
}

/** Removes the link. The GOs that used it stay (their actions show as missing), so linking the file again fixes them. */
export function removeSource(sourceId: string): void {
  useDoc.getState().change((s) => ({ ...s, sources: (s.sources as SourceLink[]).filter((l) => l.id !== sourceId) as unknown as CueShow["sources"] }));
}

/** "I checked it": the file changed (or now holds another show); take its present fingerprint and show id as the ones to compare with. */
export function acknowledgeSource(sourceId: string): void {
  const loaded = useLibrary.getState().library.source(sourceId);
  if (!loaded?.sha256) return;
  const docId = loaded.granvelo?.id;
  useDoc.getState().change((s) => ({
    ...s,
    sources: (s.sources as SourceLink[]).map((l) => (l.id === sourceId ? { ...l, sha256: loaded.sha256!, ...(docId ? { docId } : {}) } : l)) as unknown as CueShow["sources"],
  }));
  void useLibrary.getState().reload();
}
