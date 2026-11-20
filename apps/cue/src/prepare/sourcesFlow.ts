import { open } from "@tauri-apps/plugin-dialog";
import type { TFunc } from "@theatre-suite/core";
import { confirmYesNo } from "@theatre-suite/ui";
import { isTauri } from "../lib/api";
import { saveDoc } from "../lib/files";
import type { SourceApp } from "../model/sources";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { linkSource, relinkSource, removeSource, sourceUsage, type LinkResult } from "./actions";

/**
 * The dialogs around the linked files (what the user sees: file picker, "save first", confirmations). The changes
 * themselves are in actions.ts.
 */

const toast = (message: string, kind: "info" | "error" = "info") => useUi.getState().showToast(message, kind);

const EXT: Record<SourceApp, string[]> = { granvelo: ["granvelo"], diaframma: ["diaframma"], bardo: [] };

function refusal(t: TFunc, r: Extract<LinkResult, { result: "refused" }>): string {
  switch (r.reason) {
    case "wrongFormat":
      return r.app === "granvelo" ? t("This is not a Granvelo show (.granvelo).") : t("This is not a Diaframma cue list (.diaframma).");
    case "unreadable":
      return t("The file cannot be read.");
    case "newer":
      return t("Made with a newer {app}: update {app} on this computer.", { app: r.app === "granvelo" ? "Granvelo" : "Diaframma" });
    default:
      return t("Choose a Diaframma (.diaframma) or Granvelo (.granvelo) file.");
  }
}

/** The links are relative to the show file: an unsaved show is saved first (asked). False if the user said no. */
async function ensureSaved(t: TFunc): Promise<boolean> {
  if (useDoc.getState().filePath) return true;
  const yes = await confirmYesNo({
    title: t("Save the show first"),
    message: t("The linked files are remembered relative to the show file, so that the show and its files can be moved together. Save the show now?"),
    cancel: t("Cancel"),
    confirm: t("Save…"),
    close: t("Close"),
  });
  if (!yes) return false;
  await saveDoc(t);
  return !!useDoc.getState().filePath;
}

/** "Collega file di Diaframma o Granvelo…": file picker, then the links. */
export async function pickAndLinkSources(t: TFunc): Promise<void> {
  if (!useDoc.getState().show) return;
  if (!isTauri) {
    toast(t("In this preview files cannot be chosen: the demo show already has its two."));
    return;
  }
  if (!(await ensureSaved(t))) return;
  const chosen = await open({
    multiple: true,
    directory: false,
    title: t("Link Diaframma or Granvelo files"),
    filters: [{ name: t("Diaframma and Granvelo files"), extensions: ["diaframma", "granvelo"] }],
  });
  const paths = Array.isArray(chosen) ? chosen : typeof chosen === "string" ? [chosen] : [];
  for (const p of paths) {
    const r = await linkSource(p);
    if (r.result === "refused") toast(refusal(t, r), "error");
    else if (r.result === "duplicate") toast(t("{name} is already linked.", { name: r.link.name ?? r.link.path.split(/[\\/]/).pop() ?? r.link.path }));
  }
}

/** "Trova…": the user points a missing source to the file where it is now. */
export async function findSourceFile(t: TFunc, sourceId: string, app: SourceApp): Promise<void> {
  if (!isTauri) {
    toast(t("In this preview files cannot be chosen: the demo show already has its two."));
    return;
  }
  if (!(await ensureSaved(t))) return;
  const chosen = await open({
    multiple: false,
    directory: false,
    title: t("Find the file"),
    filters: [{ name: app === "granvelo" ? "Granvelo" : "Diaframma", extensions: EXT[app] }],
  });
  if (typeof chosen !== "string") return;
  const r = await relinkSource(sourceId, chosen);
  if (r.result === "refused") toast(refusal(t, r), "error");
}

/** Removes a link; when GOs use it, says how many and what happens to them. */
export async function confirmRemoveSource(t: TFunc, sourceId: string, name: string): Promise<void> {
  const show = useDoc.getState().show;
  if (!show) return;
  const n = sourceUsage(show, sourceId);
  if (n > 0) {
    const yes = await confirmYesNo({
      title: t("Remove {name}?", { name }),
      message: `${n === 1 ? t("1 GO uses it.") : t("{n} GO use it.", { n })} ${t("They stay on the script, with the missing item marked, and work again if you link the file again.")}`,
      cancel: t("Cancel"),
      confirm: t("Remove the link"),
      danger: true,
      close: t("Close"),
    });
    if (!yes) return;
  }
  removeSource(sourceId);
}
