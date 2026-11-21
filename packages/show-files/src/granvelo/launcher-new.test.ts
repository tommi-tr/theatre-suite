import { describe, expect, it } from "vitest";
import { parse } from "./file";

/** The empty document the launcher writes (`new_document_text` in crates/theatre-project/src/apps.rs) must open in Granvelo. */
const FROM_LAUNCHER = JSON.stringify({
  app: "granvelo",
  format: 1,
  savedWith: { app: "Theatre Suite", version: "0.4.5" },
  savedAt: "",
  id: "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8",
  title: "Sala grande",
  stage: { width: 8, depth: 6, height: 4.5 },
  trusses: [],
  fixtures: [],
  scenery: [],
  groups: [],
  memories: [],
  sequence: [],
  settings: { memoryBinding: "address", defaultCrossfade: 3, emergencyMemoryId: null },
});

describe("document created by the launcher", () => {
  it("is read by Granvelo as an empty show", () => {
    const doc = parse(FROM_LAUNCHER);
    expect(doc.title).toBe("Sala grande");
    expect(doc.stage).toEqual({ width: 8, depth: 6, height: 4.5 });
    expect(doc.fixtures).toHaveLength(0);
    expect(doc.settings.defaultCrossfade).toBe(3);
  });
});
