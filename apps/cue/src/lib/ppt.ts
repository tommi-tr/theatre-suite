import { create } from "zustand";
import type { TFunc } from "@theatre-suite/core";
import { api, isTauri, type PptState } from "./api";

/**
 * PowerPoint driven live (Windows only): one persistent hidden PowerShell helper, started only when the user connects
 * PowerPoint in Settings → Proiezioni, and ended when they disconnect. Cue never starts PowerPoint by itself.
 */
export interface PptStore {
  status: "off" | "connecting" | "on" | "error";
  /** Code of the last problem (see `pptErrorText`). */
  error: string | null;
  name: string;
  slide: number;
  count: number;
  slideshow: boolean;
}

export const usePpt = create<PptStore>(() => ({ status: "off", error: null, name: "", slide: 0, count: 0, slideshow: false }));

const code = (e: unknown): string => {
  const m = String((e as Error)?.message ?? e);
  return m.split(":")[0].trim() || "failed";
};

function apply(r: PptState) {
  if (!r.ok) {
    usePpt.setState({ error: r.error ?? "failed" });
    throw new Error(r.error ?? "failed");
  }
  usePpt.setState({ error: null, name: r.name ?? "", slide: r.slide ?? 0, count: r.count ?? 0, slideshow: !!r.slideshow });
}

/** Starts the helper and reads the state of PowerPoint (which may have no presentation open yet: that is not an error of the link). */
export async function pptConnect(): Promise<void> {
  usePpt.setState({ status: "connecting", error: null });
  try {
    const r = await api.pptConnect();
    usePpt.setState({ status: "on" });
    if (r.ok) apply(r);
    else usePpt.setState({ error: r.error ?? null });
  } catch (e) {
    usePpt.setState({ status: "error", error: code(e) });
  }
}

export async function pptDisconnect(): Promise<void> {
  await api.pptDisconnect().catch(() => {});
  usePpt.setState({ status: "off", error: null, name: "", slide: 0, count: 0, slideshow: false });
}

/** next / previous / a slide number / start the slide show. */
export async function pptDo(op: "next" | "previous" | "start" | number): Promise<void> {
  if (usePpt.getState().status !== "on") throw new Error("not-connected");
  try {
    apply(typeof op === "number" ? await api.pptCommand("goto", op) : await api.pptCommand(op));
  } catch (e) {
    if (code(e) === "helper-ended" || code(e) === "timeout") usePpt.setState({ status: "error", error: code(e) });
    throw e;
  }
}

export async function pptRefresh(): Promise<void> {
  if (usePpt.getState().status !== "on") return;
  try {
    apply(await api.pptCommand("status"));
  } catch {
    /* the message stays in `error` */
  }
}

/** A sentence for a PowerPoint problem. */
export function pptErrorText(t: TFunc, e: unknown): string {
  switch (code(e)) {
    case "windows-only":
      return t("PowerPoint control works only on Windows.");
    case "not-connected":
      return t("PowerPoint is not connected: connect it in Settings → Projections.");
    case "no-powerpoint":
      return t("PowerPoint is not open: open the presentation first.");
    case "no-presentation":
      return t("PowerPoint has no presentation open.");
    case "no-slideshow":
      return t("The slide show is not running in PowerPoint: start it (F5) or use “Start slide show” in the settings.");
    case "helper-ended":
    case "timeout":
    case "start-failed":
      return t("PowerPoint did not answer. Connect it again in Settings → Projections.");
    case "not-powerpoint":
      return t("This is not a PowerPoint file.");
    case "export-failed":
      return t("PowerPoint could not export the slides. Is the file open in another program, or protected?");
    default:
      return t("PowerPoint reported a problem: {error}", { error: String((e as Error)?.message ?? e) });
  }
}

export const pptSupported = async (): Promise<boolean> => isTauri && (await api.appInfo()).os === "windows";
