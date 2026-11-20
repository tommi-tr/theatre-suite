import type { ShowInfo } from "@theatre-suite/core";
import { memFs } from "../lib/memFs";

/**
 * The demo show of the browser preview (`/?demo`): "La locandiera / Serata.tcue", a file in memory inside the
 * launcher's show "La locandiera" (colour band in the title bar). In 0.1 it has no script yet.
 */
export const DEMO_DIR = "C:\\Spettacoli\\La locandiera";
export const DEMO_PATH = `${DEMO_DIR}\\Serata.tcue`;
export const DEMO_BAND: ShowInfo = { id: "demo", title: "La locandiera", color: "#7a2e4a", dir: DEMO_DIR };

const show = (extra: Record<string, unknown> = {}) =>
  JSON.stringify(
    {
      format: "theatre.cue",
      formatVersion: 1,
      id: "6c6f63616e64696572612d7365726174",
      title: "La locandiera",
      savedWith: { app: "Cue", version: "0.1.0" },
      ...extra,
    },
    null,
    2,
  );

/** Puts the demo file (and two versions of it) in memory, once. */
export function putDemoFile(): void {
  if (memFs.exists(DEMO_PATH)) return;
  const versions = `${DEMO_DIR}\\Serata.versions`;
  memFs.put(`${versions}\\2026-11-18_221500_auto.tcue`, show({ versionKind: "auto", versionNote: "Prima del primo salvataggio di questa sessione" }), {}, new Date(2026, 10, 18, 22, 15).getTime());
  memFs.put(`${versions}\\2026-11-19_183000.tcue`, show({ versionKind: "named", versionNote: "Dopo la prova tecnica" }), {}, new Date(2026, 10, 19, 18, 30).getTime());
  memFs.put(DEMO_PATH, show());
}
