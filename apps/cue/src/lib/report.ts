import type { TFunc } from "@theatre-suite/core";
import { api, isTauri } from "./api";
import { reportText, withSuggestions } from "../model/evening";
import { useDoc } from "../store/doc";
import { markExported, useEvening } from "../store/evening";
import { useUi } from "../store/ui";

/** The show report (log of the evening + checklist): text, export, print (13, "Registro della serata"). */

export const byName = (t: TFunc, by?: string) => (by === "secondary" ? t("secondary") : by === "primary" ? t("primary") : "");

export function currentReport(t: TFunc): string {
  const show = useDoc.getState().show;
  return reportText({ title: show?.title ?? "" }, useEvening.getState().log, withSuggestions(show?.checklist ?? [], t), t, (b) => byName(t, b));
}

/** Saves the report as a text file (in the browser preview: copies it). True if it was saved. */
export async function exportReport(t: TFunc): Promise<boolean> {
  const text = currentReport(t);
  if (!isTauri) {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
    useUi.getState().showToast(t("Report copied"));
    markExported();
    return true;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: `${t("Show report")}.txt`, filters: [{ name: t("Text"), extensions: ["txt"] }] });
  if (!path) return false;
  try {
    await api.writeText(path, text);
    markExported();
    useUi.getState().showToast(t("Report saved"));
    return true;
  } catch (e) {
    useUi.getState().showToast(String(e), "error");
    return false;
  }
}

/** The report through the system print window. */
export function printReport(t: TFunc) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  const pre = w.document.createElement("pre");
  pre.style.cssText = "font: 12px/1.5 Geist, system-ui, sans-serif; white-space: pre-wrap; margin: 24px;";
  pre.textContent = currentReport(t);
  w.document.title = t("Show report");
  w.document.body.appendChild(pre);
  w.focus();
  w.print();
  markExported();
}

