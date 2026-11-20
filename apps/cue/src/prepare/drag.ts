import type { ItemRef } from "../model/gos";

/**
 * What is dragged from the library onto the script: a memory (`light`) or a track (`audio`) of a linked file, or an item
 * of the projections (`projection`; `itemId` is the item's id, or `@next` / `@previous` for a step of the sequence).
 * HTML5 drag and drop with a custom type; the payload is also kept in `currentDrag()` because a browser hides the
 * data of a drag until the drop (the overlay needs to know the kind while the pointer is still moving).
 */
export interface DragPayload extends ItemRef {
  kind: "light" | "audio" | "projection";
}

export const DRAG_MIME = "application/x-cue-item";

let current: DragPayload | null = null;

/** The item being dragged right now (null outside a drag started from the library). */
export const currentDrag = (): DragPayload | null => current;

/** To call on `dragstart` of a library row. */
export function startItemDrag(e: { dataTransfer: DataTransfer }, item: DragPayload): void {
  current = item;
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(item));
  // A text fallback, so dropping on a text field does not paste JSON.
  e.dataTransfer.setData("text/plain", "");
}

/** To call on `dragend` of the row. */
export function endItemDrag(): void {
  current = null;
}

/** True while an item of the library is over something (use in `dragover`, where the data cannot be read yet). */
export const isItemDrag = (e: { dataTransfer: DataTransfer | null }): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(DRAG_MIME);

/** The item of a `drop` event (null when the drop is something else). */
export function readItemDrop(e: { dataTransfer: DataTransfer | null }): DragPayload | null {
  const raw = e.dataTransfer?.getData(DRAG_MIME);
  current = null;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DragPayload>;
    return typeof v.sourceId === "string" && typeof v.itemId === "string" && (v.kind === "light" || v.kind === "audio") ? { sourceId: v.sourceId, itemId: v.itemId, kind: v.kind } : null;
  } catch {
    return null;
  }
}
