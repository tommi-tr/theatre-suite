import { describe, expect, it } from "vitest";
import { GranveloFileError, parse, serialize } from "./file";
import { listMemories, memoryById, memoryGoArgs, memoryThumbnail, readShow } from "./library";
import { memoryFadePayload } from "./enginePayload";
import { docWith, light } from "./testkit";
import type { GranveloDoc, Memory } from "./types";

const APP = { name: "Granvelo", version: "0.0.0-test" };

const dmx = (set: Record<number, number>) => {
  const v = new Array<number>(512).fill(0);
  for (const [ch, x] of Object.entries(set)) v[Number(ch) - 1] = x;
  return v;
};

const memory = (id: string, number: number, set: Record<number, number>, transition: Partial<Memory["transition"]> = {}): Memory => ({
  id,
  number,
  label: `Memory ${number}`,
  note: "",
  state: { binding: "address", dmx: dmx(set) },
  scenery: [],
  transition: { fadeIn: 3, fadeOut: 2, delay: 0, autoFollow: false, moveInDark: false, ...transition },
});

// PC at 1, RGB PAR at 2–4 (in a group at half), unused PC at 10.
function show(): GranveloDoc {
  return docWith([light("pc", "pc", 1, { number: 1 }), light("par", "parRgb", 2, { number: 2 }), light("u", "pc", 10, { number: 3, unused: true })], {
    groups: [{ id: "g", name: "Pars", fixtureIds: ["par"], level: 128 }],
    memories: [
      memory("m-a", 10, { 1: 255 }, { autoFollow: true }),
      memory("m-b", 20, { 2: 255, 3: 0, 4: 255 }, { delay: 1 }),
      memory("m-c", 5, { 10: 200 }),
    ],
    sequence: ["m-b", "m-a"],
  });
}

describe("reading a .granvelo file for another app", () => {
  it("reads format 1 and lists the memories in show order with their stable ids", () => {
    const { doc, memories } = readShow(serialize(show(), APP));
    expect(doc.memories).toHaveLength(3);
    expect(memories.map((m) => [m.id, m.number, m.sequenceIndex])).toEqual([
      ["m-b", 20, 0],
      ["m-a", 10, 1],
      ["m-c", 5, null],
    ]);
    const b = memories[0];
    expect(b.transition).toEqual({ fadeIn: 3, fadeOut: 2, delay: 1, autoFollow: false, moveInDark: false });
    expect(b.durationSec).toBe(4);
    expect(b.litCount).toBe(1);
    expect(memories[2].litCount).toBe(0); // only the unused light: it makes no light
  });

  it("refuses any format but 1 with a clear reason", () => {
    const raw = JSON.parse(serialize(show(), APP)) as Record<string, unknown>;
    const problem = (text: string) => {
      try {
        parse(text);
      } catch (e) {
        return e instanceof GranveloFileError ? e.problem : "other";
      }
      return "read";
    };
    expect(problem(JSON.stringify({ ...raw, format: 2 }))).toBe("newer");
    expect(problem(JSON.stringify({ ...raw, format: 0 }))).toBe("unsupported");
    expect(problem(JSON.stringify(raw))).toBe("read");
    expect(() => parse(JSON.stringify({ app: "diaframma", format: 1 }))).toThrowError("not-granvelo");
  });

  it("keeps memory ids through renumbering and moves in the sequence; refuses a memory without id", () => {
    const doc = show();
    const moved = { ...doc, sequence: ["m-a", "m-b"], memories: doc.memories.map((m) => (m.id === "m-a" ? { ...m, number: 99, label: "Renamed" } : m)) };
    const again = parse(serialize(moved, APP));
    expect(memoryById(again, "m-a")?.number).toBe(99);
    expect(listMemories(again).map((m) => m.id)).toEqual(["m-a", "m-b", "m-c"]);
    const raw = JSON.parse(serialize(doc, APP)) as { memories: Record<string, unknown>[] };
    delete raw.memories[0].id;
    expect(() => parse(JSON.stringify(raw))).toThrowError(/memories\[0\]\.id/);
  });

  it("marks the memory that starts by itself after a memory with 'parte da sola'", () => {
    const doc = { ...show(), sequence: ["m-a", "m-b"] };
    const list = listMemories(doc);
    expect(list.map((m) => [m.id, m.autoFollow, m.startsByItself])).toEqual([
      ["m-a", true, false],
      ["m-b", false, true],
      ["m-c", false, false],
    ]);
  });
});

describe("GO to a memory from another app", () => {
  it("sends exactly Granvelo's fade: groups applied, Grand Master not, bytes and clean times", () => {
    const doc = show();
    const m = memoryById(doc, "m-b")!;
    const args = memoryGoArgs(doc, m);
    const payload = memoryFadePayload(doc, m);
    expect(args.target).toEqual(payload.target);
    expect(args.layout).toEqual(payload.layout);
    expect(args.universe).toBe(1);
    expect(args.target.slice(0, 4)).toEqual([0, 128, 0, 128]); // the PAR group at 128
    expect(args.transition).toEqual({ fadeIn: 3, fadeOut: 2, delay: 1, moveInDark: false });
    expect(JSON.parse(JSON.stringify(args))).toEqual(args);
  });
});

describe("memory thumbnail", () => {
  it("lists every light with the colour and level it makes, and frames the stage like Granvelo's plan", () => {
    const doc = show();
    const th = memoryThumbnail(doc, memoryById(doc, "m-b")!);
    expect(th.stage).toEqual({ width: doc.stage.width, depth: doc.stage.depth });
    const byId = new Map(th.lights.map((l) => [l.id, l]));
    expect(byId.get("pc")!.light).toBeNull();
    // The memory's own values (groups not applied, as in Granvelo's lists): magenta at full.
    expect(byId.get("par")!.light).toEqual({ hue: "#FF00FF", level: 1, color: "#FF00FF" });
    expect(byId.get("u")!.unused).toBe(true);
    expect(byId.get("par")!.symbol).toBe("par");
    expect(th.bounds.minX).toBeCloseTo(-doc.stage.width / 2 - 0.8);
    expect(th.bounds.maxY).toBeCloseTo(doc.stage.depth + 0.8);
  });

  it("puts the scenery where it stands in that memory", () => {
    const base = show();
    const doc: GranveloDoc = {
      ...base,
      scenery: [{ id: "s1", name: "Table", shape: "box", position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 1, z: 0.8 }, color: "#8A8F9C" }],
    };
    const m = { ...memoryById(doc, "m-a")!, scenery: [{ sceneryId: "s1", position: { x: 1.5, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 30 } }] };
    const th = memoryThumbnail(doc, m);
    expect(th.scenery).toEqual([{ id: "s1", shape: "box", x: 1.5, y: 2, rotation: 30, width: 2, depth: 1, color: "#8A8F9C" }]);
    expect(memoryThumbnail(doc, memoryById(doc, "m-b")!).scenery).toEqual([]);
  });
});
