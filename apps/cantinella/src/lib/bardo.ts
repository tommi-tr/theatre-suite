import type { TFunc } from "@theatre-suite/core";
import { api, isTauri } from "./api";
import { pickTextFile } from "./exports";
import { nowKey } from "../model/rehearsals";
import { BardoReadError, fingerprint, mergeBardo, readBardo } from "../model/scenes";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

function errorText(t: TFunc, e: unknown): string {
  if (e instanceof BardoReadError) {
    if (e.problem === "newer") return t("This script was saved with a newer version of Bardo. Update Cantinella to read it.");
    if (e.problem === "no-scenes") return t("This script has no scenes or characters yet.");
    return t("This is not a Bardo script.");
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Reads scenes and characters from a Bardo script (only reads it). Without a path asks for the
 * file; with the path of the linked script, reads it again ("update").
 */
export async function importBardo(t: TFunc, path?: string): Promise<void> {
  const ui = useUi.getState();
  try {
    const picked = path ? { path, text: await api.readText(path) } : await pickTextFile(t("Choose a Bardo script"), ["bardo"]);
    if (!picked) return;
    const script = readBardo(picked.text);
    const doc = useDoc.getState();
    const res = mergeBardo(doc.data.rehearsals, script, { path: picked.path, title: script.title || picked.path.split(/[\\/]/).pop()!.replace(/\.bardo$/i, ""), hash: fingerprint(picked.text), readAt: nowKey() }, doc.data.people);
    doc.change((d) => ({ ...d, rehearsals: res.rehearsals }));
    ui.go("rehearsals", "scenes");
    const parts = [
      t("{n} scenes and {m} characters added", { n: res.added.scenes, m: res.added.characters }),
      res.updated ? t("{n} updated", { n: res.updated }) : "",
      res.detached ? t("{n} no longer in the script (kept)", { n: res.detached }) : "",
    ].filter(Boolean);
    ui.showToast(`${parts.join(" · ")}. ${t("Ctrl Z undoes it.")}`);
  } catch (e) {
    ui.showToast(`${t("Could not read the script.")} ${errorText(t, e)}`, "error");
  }
}

/** Has the linked script changed since it was read? (false when it cannot be checked) */
export async function bardoChanged(): Promise<boolean> {
  const link = useDoc.getState().data.rehearsals.bardo;
  if (!link || !isTauri) return false;
  try {
    if (!(await api.pathExists(link.path))) return false;
    return fingerprint(await api.readText(link.path)) !== link.hash;
  } catch {
    return false;
  }
}
