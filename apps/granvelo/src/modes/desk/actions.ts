import type { TFunc } from "@theatre-suite/core";
import { confirmSave, confirmYesNo } from "@theatre-suite/ui";
import { addGroup, removeGroup, renameGroup } from "../../model/desk";
import { memoryNumberFree, renameMemory, setMemoryNumber } from "../../model/desk";
import { hasRaisedFaders } from "../../model/deskRaised";
import { removeMemory } from "../../model/ops";
import { useDesk } from "../../store/desk";
import { useDoc } from "../../store/doc";
import { useUi } from "../../store/ui";
import type { Id } from "../../model/types";

/** What the buttons of the desk do when a question or a message is needed (the store itself never asks). */

const memoryName = (t: TFunc, n: number, label: string) => (label ? `${n} · ${label}` : t("Memory {n}", { n }));

const nameOf = (t: TFunc, id: Id | null) => {
  const m = useDoc.getState().doc?.memories.find((x) => x.id === id);
  return m ? memoryName(t, m.number, m.label) : "";
};

/** Click on a memory in the list: puts it on stage at once, asking first if the desk has changes not saved. */
export async function selectMemory(t: TFunc, id: Id): Promise<void> {
  const d = useDesk.getState();
  if (d.blind) {
    useUi.getState().showToast(t("Leave Blind first (Esc) to change what is on stage."));
    return;
  }
  if (d.liveMemoryId === id && !d.modified) {
    d.setCursor(id);
    return;
  }
  if (d.modified && d.liveMemoryId && d.liveMemoryId !== id) {
    const choice = await confirmSave({
      title: t("Changes not saved"),
      message: t("The memory on stage ({name}) was changed and not saved. Save it before going to the other one?", { name: nameOf(t, d.liveMemoryId) }),
      cancel: t("Cancel"),
      discard: t("Don't save"),
      save: t("Save"),
      close: t("Close"),
    });
    if (choice === "cancel") return;
    if (choice === "save") useDesk.getState().save();
  } else if (d.modified && d.liveMemoryId === id) {
    // Clicking the memory already on stage with changes: this is "Ripristina".
    const ok = await confirmYesNo({
      title: t("Restore the memory?"),
      message: t("The changes you made to the faders will be lost."),
      confirm: t("Restore"),
      cancel: t("Cancel"),
      danger: true,
      close: t("Close"),
    });
    if (!ok) return;
  } else if (!d.liveMemoryId && hasRaisedFaders(useDoc.getState().doc!, d.values)) {
    // The free desk: what was set with the faders is not in any memory and would be lost.
    const ok = await confirmYesNo({
      title: t("Put the memory on stage?"),
      message: t("The faders are up and not saved in any memory. Putting this memory on stage will lose what you set."),
      confirm: t("Put on stage"),
      cancel: t("Cancel"),
      danger: true,
      close: t("Close"),
    });
    if (!ok) return;
  }
  useDesk.getState().loadMemory(id);
}

/** "Ripristina" with the question when there are changes. */
export async function restoreAsk(t: TFunc): Promise<void> {
  const d = useDesk.getState();
  if (d.modified || d.blind?.modified) {
    const ok = await confirmYesNo({
      title: t("Restore the memory?"),
      message: t("The changes you made to the faders will be lost."),
      confirm: t("Restore"),
      cancel: t("Cancel"),
      danger: true,
      close: t("Close"),
    });
    if (!ok) return;
  }
  useDesk.getState().restore();
}

/** Leaves Blind, asking first if the memory being edited was changed and not saved. */
export async function exitBlindAsk(t: TFunc): Promise<void> {
  const b = useDesk.getState().blind;
  if (!b) return;
  if (b.modified) {
    const choice = await confirmSave({
      title: t("Changes not saved"),
      message: t("You changed memory {name} in Blind and did not save it. Save it before leaving?", { name: nameOf(t, b.memoryId) }),
      cancel: t("Stay in Blind"),
      discard: t("Don't save"),
      save: t("Save"),
      close: t("Close"),
    });
    if (choice === "cancel") return;
    if (choice === "save") useDesk.getState().save();
  }
  useDesk.getState().exitBlind();
}

/** Starts Blind on a memory (or the one selected in the list), or leaves it. */
export async function toggleBlind(t: TFunc, id?: Id): Promise<void> {
  const d = useDesk.getState();
  if (d.blind) {
    await exitBlindAsk(t);
    return;
  }
  const target = id ?? d.cursorId;
  const ui = useUi.getState();
  if (!target) {
    ui.showToast(t("Choose the memory to change in Blind: use the Blind button next to its name in the list."));
    return;
  }
  const r = d.startBlind(target);
  if (r === "same") ui.showToast(t("That memory is already on stage. Choose another one for Blind."));
  else if (r === "missing") ui.showToast(t("Choose the memory to change in Blind: use the Blind button next to its name in the list."));
}

/** Deletes a memory after asking. */
export async function deleteMemoryAsk(t: TFunc, id: Id): Promise<void> {
  const doc = useDoc.getState().doc;
  const m = doc?.memories.find((x) => x.id === id);
  if (!doc || !m) return;
  const d = useDesk.getState();
  const ok = await confirmYesNo({
    title: t("Delete the memory?"),
    message:
      d.liveMemoryId === id
        ? t("{name} will be deleted from the show. The lights stay as they are now.", { name: memoryName(t, m.number, m.label) })
        : t("{name} will be deleted from the show.", { name: memoryName(t, m.number, m.label) }),
    confirm: t("Delete"),
    cancel: t("Cancel"),
    danger: true,
    close: t("Close"),
  });
  if (!ok) return;
  useDoc.getState().change((x) => removeMemory(x, id));
}

export function renameMemoryTo(id: Id, label: string) {
  useDoc.getState().change((d) => renameMemory(d, id, label));
}

/** Changes the number of a memory; tells the user when it is not possible. */
export function renumberMemory(t: TFunc, id: Id, text: string): boolean {
  const n = Number(text.trim());
  const doc = useDoc.getState().doc;
  if (!doc) return false;
  if (!memoryNumberFree(doc, n, id)) {
    useUi.getState().showToast(Number.isInteger(n) && n > 0 ? t("Number {n} is already used by another memory.", { n }) : t("The number of a memory is a whole number above zero."), "error");
    return false;
  }
  useDoc.getState().change((d) => setMemoryNumber(d, id, n) ?? d);
  return true;
}

/** Makes a group from the selected lights. */
export function createGroupFromSelection(t: TFunc) {
  const ui = useUi.getState();
  const doc = useDoc.getState().doc;
  if (!doc || !ui.selection.length) return;
  const name = t("Group {n}", { n: doc.groups.length + 1 });
  useDoc.getState().change((d) => addGroup(d, name, ui.selection).doc);
}

export function renameGroupTo(id: Id, name: string) {
  useDoc.getState().change((d) => renameGroup(d, id, name));
}

export async function deleteGroupAsk(t: TFunc, id: Id) {
  const g = useDoc.getState().doc?.groups.find((x) => x.id === id);
  if (!g) return;
  const ok = await confirmYesNo({
    title: t("Delete the group?"),
    message: t("The group {name} will be deleted. The lights stay as they are.", { name: g.name }),
    confirm: t("Delete"),
    cancel: t("Cancel"),
    danger: true,
    close: t("Close"),
  });
  if (ok) useDoc.getState().change((d) => removeGroup(d, id));
}
