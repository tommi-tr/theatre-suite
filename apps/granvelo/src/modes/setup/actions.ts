import type { TFunc } from "@theatre-suite/core";
import { confirmYesNo } from "@theatre-suite/ui";
import { addressProblems, conflictDetails, newProblems, problemIds } from "../../model/addresses";
import { duplicateFixtures, listOrder, memoriesUsing, removeFixtures, removeTruss, lightsOnTruss } from "../../model/ops";
import type { GranveloDoc, Id } from "../../model/types";
import { useDoc } from "../../store/doc";
import { useUi } from "../../store/ui";
import { lightRef, lightTag, trussName } from "./common";

/** Document and ui, read fresh (these actions run from events). */
const doc = () => useDoc.getState().doc!;

/** Says in a toast when a change made some lights collide (or go past 512): the list and the map show them too. */
export function warnNewProblems(t: TFunc, before: GranveloDoc, after: GranveloDoc, prefix?: string) {
  const bad = newProblems(before, after);
  if (bad.length === 0) return;
  const f = after.fixtures.find((x) => x.id === bad[0])!;
  const others = conflictDetails(after, f.id);
  let msg: string;
  if (bad.length === 1 && others.length) msg = `${lightRef(t, f)}: ${t("Shares channels with {list}", { list: others.map((d) => lightRef(t, d.other)).join(", ") })}`;
  else if (bad.length === 1) msg = t("{light} is now past channel 512.", { light: lightRef(t, f) });
  else if (bad.length === 2 && others.length === 1 && others[0].other.id === bad[1]) msg = t("“{a}” and “{b}” now share channels.", { a: lightRef(t, f), b: lightRef(t, others[0].other) });
  else msg = t("{n} lights now share channels with others.", { n: bad.length });
  useUi.getState().showToast(prefix ? `${prefix} ${msg}` : msg);
}

/** Selects what is left near the place where the deleted lights were. */
function selectNear(before: GranveloDoc, after: GranveloDoc, removed: Id[]) {
  const order = listOrder(before);
  const first = Math.min(...removed.map((id) => order.indexOf(id)).filter((i) => i >= 0));
  const left = listOrder(after);
  if (left.length === 0 || !Number.isFinite(first)) return useUi.getState().setSelection([]);
  const keep = left[Math.min(first, left.length - 1)];
  useUi.getState().setSelection([keep]);
}

/** Delete the selected lights. Asks first when several go or when memories use them (they stay, without those lights). */
export async function deleteLights(t: TFunc, ids: Id[]): Promise<void> {
  const d = doc();
  const lights = d.fixtures.filter((f) => ids.includes(f.id));
  if (lights.length === 0) return;
  const used = memoriesUsing(d, ids);
  if (lights.length > 1 || used > 0) {
    const what = lights.length === 1 ? lightTag(t, lights[0]) : t("{n} lights", { n: lights.length });
    const note =
      used > 0
        ? used === 1
          ? t("1 memory uses them. The memory stays; those lights are simply no longer in it.")
          : t("{n} memories use them. The memories stay; those lights are simply no longer in them.", { n: used })
        : t("The other lights keep their numbers and addresses.");
    const ok = await confirmYesNo({
      title: lights.length === 1 ? t("Delete this light?") : t("Delete these lights?"),
      message: `${what}. ${note}`,
      confirm: t("Delete"),
      cancel: t("Cancel"),
      close: t("Close"),
      danger: true,
    });
    if (!ok) return;
  }
  const before = doc();
  useDoc.getState().change((x) => removeFixtures(x, ids));
  selectNear(before, doc(), ids);
  useUi.getState().showToast(lights.length === 1 ? t("Light deleted. Undo brings it back.") : t("{n} lights deleted. Undo brings them back.", { n: lights.length }));
}

export function duplicateLights(t: TFunc, ids: Id[]) {
  if (ids.length === 0) return;
  let created: Id[] = [];
  useDoc.getState().change((x) => {
    const r = duplicateFixtures(x, ids);
    created = r.ids;
    return r.doc;
  });
  if (created.length) {
    useUi.getState().setSelection(created);
    useUi.getState().showToast(created.length === 1 ? t("Light copied.") : t("{n} lights copied.", { n: created.length }));
  }
}

/** Delete a truss; if lights hang on it they become floating where they are, after asking. */
export async function deleteTruss(t: TFunc, trussId: Id): Promise<boolean> {
  const d = doc();
  const n = lightsOnTruss(d, trussId).length;
  if (n > 0) {
    const ok = await confirmYesNo({
      title: t("Delete this truss?"),
      message: t("{name} has {n} lights. They stay where they are, but float in the air: they are no longer hung on a truss.", { name: trussName(t, d, trussId), n }),
      confirm: t("Delete the truss"),
      cancel: t("Cancel"),
      close: t("Close"),
      danger: true,
    });
    if (!ok) return false;
  }
  useDoc.getState().change((x) => removeTruss(x, trussId));
  return true;
}

/** How many lights have an address problem right now. */
export const problemCount = (d: GranveloDoc) => problemIds(addressProblems(d)).size;
