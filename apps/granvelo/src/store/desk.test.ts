import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureState } from "../model/memories";
import { docWith, light } from "../model/testkit";
import type { GranveloDoc, Memory } from "../model/types";
import { useDesk } from "./desk";
import { useDoc } from "./doc";
import { useOutput } from "./output";

const mem = (doc: GranveloDoc, id: string, number: number, values: Record<string, number[]>): Memory => ({
  id,
  number,
  label: id,
  note: "",
  state: captureState(doc, values, doc.settings.memoryBinding),
  scenery: [],
  transition: { fadeIn: 1, fadeOut: 1, delay: 0, autoFollow: false, moveInDark: false },
});

function makeDoc(): GranveloDoc {
  const d = docWith([light("a1", "pc", 1), light("b2", "parRgb", 5)]);
  return { ...d, memories: [mem(d, "m1", 1, { a1: [100], b2: [0, 0, 0] }), mem(d, "m2", 2, { a1: [0], b2: [200, 100, 50] })], sequence: ["m1", "m2"] };
}

const setUniverse = vi.fn(async (_v: ArrayLike<number>) => {});
const setGrandMaster = vi.fn(async (_l: number, _m?: number[]) => {});
const lastUniverse = () => setUniverse.mock.calls[setUniverse.mock.calls.length - 1][0] as Uint8Array;
const desk = () => useDesk.getState();
const doc = () => useDoc.getState().doc!;

beforeEach(() => {
  setUniverse.mockClear();
  setGrandMaster.mockClear();
  useOutput.setState({ setUniverse, setGrandMaster });
  useDoc.getState().load(makeDoc(), { filePath: null, dirty: false });
  useDesk.setState({ active: false });
  desk().activate();
  setUniverse.mockClear();
  setGrandMaster.mockClear();
});

describe("desk store", () => {
  it("works without memories: values go to the universe, groups applied, Grand Master left to the engine", () => {
    useDoc.getState().load({ ...makeDoc(), memories: [], sequence: [], groups: [{ id: "g", name: "G", fixtureIds: ["a1"], level: 128 }] }, { filePath: null, dirty: false });
    setUniverse.mockClear();
    setGrandMaster.mockClear();
    desk().setChannel("a1", 0, 200);
    expect(lastUniverse()[0]).toBe(100);
    desk().setGrandMaster(128);
    expect(setGrandMaster).toHaveBeenCalledTimes(1);
    expect(setGrandMaster.mock.calls[0][0]).toBe(128);
    expect(setGrandMaster.mock.calls[0][1]![0]).toBe(1);
    desk().setChannel("a1", 0, 180);
    expect(lastUniverse()[0]).toBe(90); // still not scaled by the Grand Master here
    expect(desk().modified).toBe(false);
  });

  it("marks modified when a fader differs from the memory on stage, and Salva clears it", () => {
    desk().loadMemory("m1");
    expect(lastUniverse()[0]).toBe(100);
    expect(desk().modified).toBe(false);
    desk().setChannel("a1", 0, 150);
    expect(desk().modified).toBe(true);
    desk().setChannel("a1", 0, 100);
    expect(desk().modified).toBe(false);
    desk().setChannel("a1", 0, 150);
    expect(desk().save()).toBe(true);
    expect(desk().modified).toBe(false);
    expect(doc().memories[0].state).toMatchObject({ binding: "address" });
    desk().loadMemory("m2");
    desk().loadMemory("m1");
    expect(lastUniverse()[0]).toBe(150);
  });

  it("Ripristina reloads the memory", () => {
    desk().loadMemory("m2");
    desk().setChannel("b2", 0, 10);
    expect(desk().modified).toBe(true);
    desk().restore();
    expect(desk().modified).toBe(false);
    expect(Array.from(lastUniverse().slice(4, 7))).toEqual([200, 100, 50]);
  });

  it("Salva come nuova adds a memory at the end of the sequence and puts it on stage", () => {
    desk().loadMemory("m1");
    desk().setChannel("a1", 0, 77);
    expect(desk().saveAsNew(2, "x")).toBe(false);
    expect(desk().saveAsNew(3, "Nuova")).toBe(true);
    const d = doc();
    expect(d.memories).toHaveLength(3);
    expect(d.sequence[2]).toBe(d.memories[2].id);
    expect(d.memories[2].transition.fadeIn).toBe(d.settings.defaultCrossfade);
    expect(desk().liveMemoryId).toBe(d.memories[2].id);
    expect(desk().modified).toBe(false);
    expect(d.memories[0].state).toEqual(makeDoc().memories[0].state); // the old one is untouched
  });

  it("Blind sends nothing to the output, edits the other memory, and leaving sends the stage again", () => {
    desk().loadMemory("m1");
    setUniverse.mockClear();
    expect(desk().startBlind("m1")).toBe("same");
    expect(desk().startBlind("m2")).toBe("ok");
    desk().setChannel("b2", 0, 33);
    desk().setColor(["b2"], "#FF0000");
    desk().restore();
    desk().setChannel("a1", 0, 5);
    expect(setUniverse).not.toHaveBeenCalled();
    expect(desk().values.a1).toEqual([100]);
    expect(desk().blind!.modified).toBe(true);
    expect(desk().save()).toBe(true);
    expect(doc().memories[1].state).toMatchObject({ binding: "address" });
    expect(desk().blind!.modified).toBe(false);
    expect(desk().modified).toBe(false);
    desk().exitBlind();
    expect(lastUniverse()[0]).toBe(100);
  });

  it("undo and redo cover fader moves (coalesced) and memory loads, then fall through to the document", () => {
    desk().setChannel("a1", 0, 10);
    desk().setChannel("a1", 0, 20);
    desk().setChannel("a1", 0, 30);
    desk().loadMemory("m2");
    expect(desk().canUndo).toBe(true);
    desk().undo();
    expect(desk().liveMemoryId).toBeNull();
    expect(desk().values.a1).toEqual([30]);
    expect(lastUniverse()[0]).toBe(30);
    desk().undo();
    expect(desk().values.a1).toEqual([0]);
    expect(desk().canUndo).toBe(false);
    desk().redo();
    expect(desk().values.a1).toEqual([30]);
    desk().redo();
    expect(desk().liveMemoryId).toBe("m2");
    // empty desk history: undo reaches the document
    desk().undo();
    desk().undo();
    expect(desk().canUndo).toBe(false);
    useDoc.getState().change((d) => ({ ...d, title: "Changed" }));
    desk().undo();
    expect(doc().title).not.toBe("Changed");
  });

  it("keeps values by light id when the patch changes, and resends", () => {
    desk().setChannel("a1", 0, 90);
    setUniverse.mockClear();
    useDoc.getState().change((d) => ({ ...d, fixtures: d.fixtures.map((f) => (f.id === "a1" ? { ...f, address: 20 } : f)) }));
    expect(desk().values.a1).toEqual([90]);
    expect(lastUniverse()[19]).toBe(90);
    expect(lastUniverse()[0]).toBe(0);
  });

  it("drops a deleted memory from the stage", () => {
    desk().loadMemory("m1");
    useDoc.getState().change((d) => ({ ...d, memories: d.memories.filter((m) => m.id !== "m1") }));
    expect(desk().liveMemoryId).toBeNull();
    expect(desk().modified).toBe(false);
  });
});
