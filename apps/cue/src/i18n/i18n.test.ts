import { describe, expect, it } from "vitest";
import { makeT } from "@theatre-suite/core";
import { DICTS, IT_PARTS } from "./index";
import { KEY_ACTIONS } from "../model/keys";

/** Every text written as t("…") in the interface must have its Italian translation. */
const sources = import.meta.glob(["../**/*.tsx", "../**/*.ts", "!../**/*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

function keysIn(code: string): string[] {
  const out: string[] = [];
  const re = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;
  for (let m = re.exec(code); m; m = re.exec(code)) out.push(JSON.parse(`"${m[1]}"`));
  // Tables translated later with t(x.label): `const TABS … = [ { id, label: "…" } ]`, same for GROUPS.
  const tables = /const\s+[A-Z_]*(?:TABS|GROUPS)\b[^=]*=\s*\[([\s\S]*?)\];/g;
  for (let m = tables.exec(code); m; m = tables.exec(code)) for (const v of m[1].matchAll(/label:\s*"((?:[^"\\]|\\.)*)"/g)) out.push(JSON.parse(`"${v[1]}"`));
  return out;
}

const KEY_LABELS = KEY_ACTIONS.map((k) => k.label);

describe("Italian dictionary", () => {
  it("translates every text of the interface", () => {
    const missing = new Set<string>();
    for (const [file, code] of Object.entries(sources)) {
      if (file.includes("/i18n/")) continue;
      for (const k of keysIn(code)) if (!(k in DICTS.it)) missing.add(k);
    }
    for (const k of KEY_LABELS) if (!(k in DICTS.it)) missing.add(k);
    expect([...missing].sort()).toEqual([]);
  });

  it("has no translation that nobody uses", () => {
    const used = new Set<string>(KEY_LABELS);
    for (const [file, code] of Object.entries(sources)) if (!file.includes("/i18n/")) for (const k of keysIn(code)) used.add(k);
    expect(Object.keys(DICTS.it).filter((k) => !used.has(k))).toEqual([]);
  });
});

describe("Italian dictionaries", () => {
  it("never translate the same text in two different ways", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const d of IT_PARTS)
      for (const [k, v] of Object.entries(d)) {
        if (seen.has(k) && seen.get(k) !== v) clashes.push(`${k}: ${seen.get(k)} / ${v}`);
        seen.set(k, v);
      }
    expect(clashes).toEqual([]);
  });

  it("keep the mode name Show apart from the verb Show", () => {
    expect(makeT(DICTS, "it")("Show (mode)")).toBe("Show");
    expect(makeT(DICTS, "en")("Show (mode)")).toBe("Show");
    expect("Show" in DICTS.it).toBe(false);
    expect(makeT(DICTS, "it")("Show in folder")).toBe("Mostra nella cartella");
  });

  it("keep the placeholders of every text", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const wrong = Object.entries(DICTS.it).filter(([k, v]) => JSON.stringify(ph(k)) !== JSON.stringify(ph(v)));
    expect(wrong).toEqual([]);
  });

  it("say clearly in Italian when a file is not a Cue show", () => {
    expect(DICTS.it["This is not a Cue show file (.tcue)."]).toBe("Questo non è un file di Cue (.tcue).");
  });
});
