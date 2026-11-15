import { describe, expect, it } from "vitest";
import { DICTS } from "./index";

/** Every text written as t("…") in the interface must have its Italian translation. */
const sources = import.meta.glob(["../**/*.tsx", "../**/*.ts", "!../**/*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

function keysIn(code: string): string[] {
  const out: string[] = [];
  const re = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;
  for (let m = re.exec(code); m; m = re.exec(code)) out.push(JSON.parse(`"${m[1]}"`));
  return out;
}

describe("Italian dictionary", () => {
  it("translates every text of the interface", () => {
    const missing = new Set<string>();
    for (const [file, code] of Object.entries(sources)) {
      if (file.includes("/i18n/")) continue;
      for (const k of keysIn(code)) if (!(k in DICTS.it)) missing.add(k);
    }
    expect([...missing].sort()).toEqual([]);
  });
});

describe("Italian dictionaries", () => {
  it("never translate the same text in two different ways", async () => {
    const { IT_PARTS } = await import("./index");
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const d of IT_PARTS)
      for (const [k, v] of Object.entries(d)) {
        if (seen.has(k) && seen.get(k) !== v) clashes.push(`${k}: ${seen.get(k)} / ${v}`);
        seen.set(k, v);
      }
    expect(clashes).toEqual([]);
  });
});
