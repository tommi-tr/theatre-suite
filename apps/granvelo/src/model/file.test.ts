import { describe, expect, it } from "vitest";
import { GranveloFileError, newDocument, parse, serialize } from "./file";
import { demoDoc } from "./demo";
import { setMemoryBinding } from "./memories";
import { DEFAULT_STAGE } from "./types";

const APP = { name: "Granvelo", version: "0.1.0" };
const NOW = new Date("2026-11-16T20:30:00Z");

function problemOf(text: string): string {
  try {
    parse(text);
  } catch (e) {
    if (e instanceof GranveloFileError) return e.detail ? `${e.problem} · ${e.detail}` : e.problem;
    throw e;
  }
  return "ok";
}

/** The demo as raw JSON, to break it on purpose. */
const raw = () => JSON.parse(serialize(demoDoc(), APP, NOW)) as Record<string, any>;

describe("new document", () => {
  it("is an empty show on the default stage", () => {
    const d = newDocument({ title: "Amleto" });
    expect(d.title).toBe("Amleto");
    expect(d.stage).toEqual(DEFAULT_STAGE);
    expect(d.fixtures).toEqual([]);
    expect(d.settings).toEqual({ memoryBinding: "address", defaultCrossfade: 3, emergencyMemoryId: null });
    expect(newDocument().id).not.toBe(newDocument().id);
  });
  it("takes the stage size asked for", () => {
    expect(newDocument({ stage: { width: 10, depth: 7, height: 5 } }).stage).toEqual({ width: 10, depth: 7, height: 5 });
  });
});

describe("file round trip", () => {
  it("writes the header and reads back exactly the same show", () => {
    const doc = demoDoc();
    const text = serialize(doc, APP, NOW);
    const head = JSON.parse(text);
    expect(head.app).toBe("granvelo");
    expect(head.format).toBe(1);
    expect(head.savedWith).toEqual({ app: "Granvelo", version: "0.1.0" });
    expect(head.savedAt).toBe("2026-11-16T20:30:00.000Z");
    expect(parse(text)).toEqual(doc);
  });

  it("round-trips memories bound to the lights too", () => {
    const doc = setMemoryBinding(demoDoc(), "fixture");
    expect(parse(serialize(doc, APP, NOW))).toEqual(doc);
  });

  it("round-trips an empty new show", () => {
    const doc = newDocument({ title: "Vuoto" });
    expect(parse(serialize(doc, APP, NOW))).toEqual(doc);
  });

  it("keeps the 512 values of a memory on one readable line", () => {
    const text = serialize(demoDoc(), APP, NOW);
    expect(text).toMatch(/"dmx": \[\d+(, \d+){511}\]/);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("keeps unknown top-level keys", () => {
    const r = raw();
    r.printSettings = { paper: "A4" };
    const doc = parse(JSON.stringify(r));
    expect(doc.extra).toEqual({ printSettings: { paper: "A4" } });
    expect(JSON.parse(serialize(doc, APP, NOW)).printSettings).toEqual({ paper: "A4" });
  });

  it("accepts a byte order mark", () => {
    expect(parse("﻿" + serialize(demoDoc(), APP, NOW)).title).toBe("La locandiera");
  });
});

describe("refusals", () => {
  it("refuses what is not a Granvelo file", () => {
    expect(problemOf("not json")).toBe("not-json");
    expect(problemOf("[]")).toBe("not-granvelo");
    expect(problemOf(JSON.stringify({ format: 1, formatVersion: 1, data: {} }))).toBe("not-granvelo");
    expect(problemOf(JSON.stringify({ ...raw(), app: "cantinella" }))).toBe("not-granvelo");
  });

  it("refuses unknown formats instead of guessing", () => {
    expect(problemOf(JSON.stringify({ ...raw(), format: 2 }))).toBe("newer");
    expect(problemOf(JSON.stringify({ ...raw(), format: 0 }))).toBe("unsupported");
    expect(problemOf(JSON.stringify({ ...raw(), format: "1" }))).toMatch(/^damaged · format/);
    const { format: _f, ...noFormat } = raw();
    expect(problemOf(JSON.stringify(noFormat))).toMatch(/^damaged · format/);
  });

  it("says where a damaged file is wrong", () => {
    const cases: [(r: Record<string, any>) => void, RegExp][] = [
      [(r) => (r.fixtures[2].address = 600), /fixtures\[2\]\.address: must be at most 512/],
      [(r) => (r.fixtures[0].address = 1.5), /fixtures\[0\]\.address: expected a whole number/],
      [(r) => (r.fixtures[3].typeId = "laser"), /fixtures\[3\]\.typeId: unknown type of light "laser"/],
      [(r) => (r.fixtures[1].universe = 2), /fixtures\[1\]\.universe/],
      [(r) => (r.fixtures[4].number = r.fixtures[5].number), /fixtures: two lights with number 6/],
      [(r) => (r.fixtures[4].id = r.fixtures[5].id), /fixtures: two lights with id fx-06/],
      [(r) => (r.memories[1].number = 1), /memories: two memories with number 1/],
      [(r) => (r.memories[1].number = 2.5), /memories\[1\]\.number: expected a whole number/],
      [(r) => (r.memories[0].state.dmx[10] = 300), /memories\[0\]\.state\.dmx\[10\]: must be at most 255/],
      [(r) => r.memories[0].state.dmx.pop(), /memories\[0\]\.state\.dmx: expected 512 values/],
      [(r) => (r.memories[0].state.binding = "fixture"), /memories\[0\]\.state\.binding/],
      [(r) => (r.groups[0].level = 256), /groups\[0\]\.level/],
      [(r) => (r.stage.width = -1), /stage\.width/],
      [(r) => delete r.stage, /stage: expected an object/],
      [(r) => (r.fixtures[0].channels = []), /fixtures\[0\]\.channels: a light needs at least one channel/],
      [(r) => (r.scenery[0].shape = "pyramid"), /scenery\[0\]\.shape/],
      [(r) => (r.settings.memoryBinding = "both"), /settings\.memoryBinding/],
      [(r) => (r.fixtures = {}), /fixtures: expected a list/],
    ];
    for (const [breakIt, expected] of cases) {
      const r = raw();
      breakIt(r);
      expect(problemOf(JSON.stringify(r))).toMatch(new RegExp(`^damaged · ${expected.source}`));
    }
  });
});

describe("lenient reading", () => {
  it("fills in missing optional fields", () => {
    const r = raw();
    delete r.fixtures[0].name;
    delete r.fixtures[0].beam;
    delete r.fixtures[0].aim;
    delete r.fixtures[0].unused;
    delete r.fixtures[0].broken;
    delete r.fixtures[0].universe;
    delete r.memories[0].transition;
    delete r.settings;
    const doc = parse(JSON.stringify(r));
    const f = doc.fixtures[0];
    expect(f).toMatchObject({ name: "", beam: { angle: 25 }, unused: false, broken: false, universe: 1 });
    expect(f.aim.y).toBeGreaterThan(0); // a house light points at the stage
    expect(doc.memories[0].transition).toEqual({ fadeIn: 3, fadeOut: 3, delay: 0, autoFollow: false, moveInDark: false });
  });

  it("drops references to things that do not exist", () => {
    const r = raw();
    r.groups[0].fixtureIds.push("ghost", r.groups[0].fixtureIds[0]);
    r.sequence.push("ghost", r.sequence[0]);
    r.memories[0].scenery.push({ sceneryId: "ghost", position: { x: 0, y: 0, z: 0 } });
    r.settings.emergencyMemoryId = "ghost";
    r.fixtures[4].mount = { kind: "truss", trussId: "ghost" };
    const doc = parse(JSON.stringify(r));
    expect(doc.groups[0].fixtureIds).toEqual(["fx-01", "fx-02", "fx-03", "fx-04"]);
    expect(doc.sequence).toEqual(demoDoc().sequence);
    expect(doc.memories[0].scenery.map((s) => s.sceneryId)).not.toContain("ghost");
    expect(doc.settings.emergencyMemoryId).toBeNull();
    expect(doc.fixtures[4].mount).toEqual({ kind: "floating" });
  });

  it("keeps an unknown channel function as 'other' with its name", () => {
    const r = raw();
    r.fixtures[0].channels[3] = { function: "cyan" };
    expect(parse(JSON.stringify(r)).fixtures[0].channels[3]).toEqual({ function: "other", label: "cyan" });
  });

  it("puts a light on a truss at the height and depth of its truss", () => {
    const r = raw();
    r.fixtures[4].position = { x: -2.5, y: 0, z: 0 };
    expect(parse(JSON.stringify(r)).fixtures[4].position).toEqual({ x: -2.5, y: 1.2, z: 4.5 });
  });
});
