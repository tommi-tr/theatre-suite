import type { ShowInfo } from "@theatre-suite/core";
import { demoCueFields, DEMO_SPEED_ZONES, putDemoSources } from "../lib/demoShow";
import { memFs } from "../lib/memFs";

/**
 * The demo show of the browser preview (`/?demo`): "La locandiera / Serata.tcue", a file in memory inside the
 * launcher's show "La locandiera" (colour band in the title bar), with its script (public/demo/locandiera.pdf, made
 * by tools/make_demo_pdf.mjs: Goldoni, Act I, public domain) and a few notes.
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
      savedWith: { app: "Cue", version: "0.4.0" },
      ...extra,
    },
    null,
    2,
  );

const note = (id: string, page: number, y: number, quote: string, before: string, after: string, text: string) => ({ id, anchor: { page, y, x: 0.2, quote, before, after }, text });

/** Notes of the demo, on lines of the demo PDF (positions printed by tools/make_demo_pdf.mjs). */
export const DEMO_NOTES = [
  note(
    "n1",
    1,
    0.3869,
    "Per qual ragione?",
    "Ma se la locandiera usa a me delle distinzioni, mi si convengono più che a voi. CONTE",
    "MARCHESE Io sono il Marchese di Forlipopoli. CONTE",
    "Pausa breve prima della risposta.",
  ),
  note(
    "n2",
    2,
    0.7655,
    "SCENA SECONDA",
    "MARCHESE Quel ch'io faccio, lo faccio segretamente, e non me ne vanto. Son chi sono. Chi è di là? (chiama) CONTE (Spiantato! Povero e superbo!) (da sé)",
    "Fabrizio e detti. FABRIZIO Mi comandi, signore. (al Marchese)",
    "Fabrizio entra da destra: controllare il vassoio in quinta.",
  ),
  note("n3", 3, 0.389, "Asino.", "FABRIZIO Sta bene, illustrissimo. MARCHESE È alzata dal letto? FABRIZIO Illustrissimo sì. MARCHESE", "FABRIZIO Perché, illustrissimo signore?", "Risata del pubblico: aspettare."),
  note(
    "n4",
    4,
    0.2046,
    "Tieni. Ti dono uno zecchino. Fa che anch'egli te ne doni un altro.",
    "FABRIZIO Come comanda, Eccellenza. CONTE Vuoi vedere la differenza che passa fra il Marchese e me? MARCHESE Che vorreste dire? CONTE",
    "FABRIZIO Grazie, illustrissimo. Eccellenza... MARCHESE",
    "Zecchino: attrezzo sul tavolo, lato Conte.",
  ),
];

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!crypto?.subtle) return "";
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Puts the demo file (with its script) and two versions of it in memory, once. */
export async function putDemoFile(): Promise<void> {
  // The two linked files (Luci.granvelo, Suoni.diaframma) the preview reads, and the GOs that use them.
  putDemoSources();
  if (memFs.exists(DEMO_PATH)) return;
  const many = typeof location !== "undefined" && new URLSearchParams(location.search).has("many");
  const cue = { ...demoCueFields(many), speedZones: many ? [] : structuredClone(DEMO_SPEED_ZONES) };
  let pdf: Uint8Array | null = null;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}demo/locandiera.pdf`);
    if (res.ok) pdf = new Uint8Array(await res.arrayBuffer());
  } catch {
    pdf = null;
  }
  const versions = `${DEMO_DIR}\\Serata.versions`;
  memFs.put(`${versions}\\2026-11-18_221500_auto.tcue`, show({ versionKind: "auto", versionNote: "Prima del primo salvataggio di questa sessione" }), {}, new Date(2026, 10, 18, 22, 15).getTime());
  memFs.put(`${versions}\\2026-11-19_183000.tcue`, show({ versionKind: "named", versionNote: "Dopo la prova tecnica" }), {}, new Date(2026, 10, 19, 18, 30).getTime());
  if (!pdf) return memFs.put(DEMO_PATH, show({ ...cue }));
  const script = { kind: "pdf", part: "script.pdf", fileName: "La locandiera - Atto primo.pdf", sha256: await sha256Hex(pdf), pageCount: 6 };
  memFs.put(DEMO_PATH, show({ ...cue, script, notes: DEMO_NOTES, layout: { ...cue.layout, scriptWidth: 0.46 } }), { "script.pdf": pdf });
}
