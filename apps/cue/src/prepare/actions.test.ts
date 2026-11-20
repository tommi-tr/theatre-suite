import { beforeEach, describe, expect, it } from "vitest";
import { demoCueFields, DEMO_LIGHTS_ID, DEMO_SOUNDS_ID, DEMO_SOUNDS_PATH, putDemoSources } from "../lib/demoShow";
import { DEMO_PATH } from "../model/demo";
import { newShow } from "../model/show";
import type { GoAnchor } from "../model/gos";
import { useDoc } from "../store/doc";
import { useLibrary } from "../store/library";
import { useUi } from "../store/ui";
import { acknowledgeSource, addItemAt, addStop, changeAuto, changeGoSpeed, changeGivenBy, changeLevel, changeTimes, deleteAction, deleteGo, gosOf, linkSource, newGoHere, removeSource, sourceUsage } from "./actions";

const at = (page: number, y: number): GoAnchor => ({ page, y, quote: "", before: "", after: "" });
let n = 0;
const makeId = () => `t${++n}`;

async function openDemoShow(withGos: boolean) {
  putDemoSources();
  const show = { ...newShow("La locandiera", () => "id1"), ...(withGos ? demoCueFields() : { sources: demoCueFields().sources }) };
  useDoc.getState().load(show as never, { filePath: DEMO_PATH, dirty: false });
  useUi.getState().selectGo(null);
  await useLibrary.getState().reload();
}

describe("addItemAt (a library item dropped on the script)", () => {
  beforeEach(async () => {
    n = 0;
    await openDemoShow(false);
  });

  it("makes a new GO and selects it", () => {
    const r = addItemAt(at(1, 0.5), { kind: "light", sourceId: DEMO_LIGHTS_ID, itemId: "mem2" }, { makeId });
    expect(r?.merged).toBe(false);
    const gos = gosOf(useDoc.getState().show!);
    expect(gos).toHaveLength(1);
    expect(gos[0].actions).toMatchObject([{ kind: "light", ref: { sourceId: DEMO_LIGHTS_ID, itemId: "mem2" } }]);
    expect(useUi.getState().selectedGoId).toBe(gos[0].id);
    expect(useDoc.getState().dirty).toBe(true);
  });

  it("joins the GO that is near (12 px of a 1000 px page = 0.012)", () => {
    addItemAt(at(2, 0.5), { kind: "light", sourceId: DEMO_LIGHTS_ID, itemId: "mem2" }, { makeId });
    const r = addItemAt(at(2, 0.505), { kind: "audio", sourceId: DEMO_SOUNDS_ID, itemId: "trk-campane" }, { makeId });
    expect(r?.merged).toBe(true);
    const gos = gosOf(useDoc.getState().show!);
    expect(gos).toHaveLength(1);
    expect(gos[0].actions.map((a) => a.kind)).toEqual(["light", "audio"]);
  });

  it("makes another GO when it is further away, and keeps the script order", () => {
    addItemAt(at(3, 0.5), { kind: "light", sourceId: DEMO_LIGHTS_ID, itemId: "mem2" }, { makeId });
    addItemAt(at(1, 0.1), { kind: "audio", sourceId: DEMO_SOUNDS_ID, itemId: "trk-campane" }, { makeId });
    expect(gosOf(useDoc.getState().show!).map((g) => g.anchor.page)).toEqual([1, 3]);
  });

  it("uses the script view's own measure when given (toY)", () => {
    addItemAt(at(1, 0.5), { kind: "light", sourceId: DEMO_LIGHTS_ID, itemId: "mem2" }, { makeId, toY: (a) => a.y * 100 });
    // 0.6 − 0.5 = 10 px in that measure: within 12 px.
    const r = addItemAt(at(1, 0.6), { kind: "audio", sourceId: DEMO_SOUNDS_ID, itemId: "trk-campane" }, { makeId, toY: (a) => a.y * 100 });
    expect(r?.merged).toBe(true);
  });

  it("a second light replaces the first; the same sound twice changes nothing", () => {
    addItemAt(at(1, 0.5), { kind: "light", sourceId: DEMO_LIGHTS_ID, itemId: "mem2" }, { makeId });
    const r = addItemAt(at(1, 0.5), { kind: "light", sourceId: DEMO_LIGHTS_ID, itemId: "mem3" }, { makeId });
    expect(r?.result).toBe("replaced");
    addItemAt(at(1, 0.5), { kind: "audio", sourceId: DEMO_SOUNDS_ID, itemId: "trk-campane" }, { makeId });
    const before = useDoc.getState().show;
    const again = addItemAt(at(1, 0.5), { kind: "audio", sourceId: DEMO_SOUNDS_ID, itemId: "trk-campane" }, { makeId });
    expect(again?.result).toBe("duplicate");
    expect(useDoc.getState().show).toBe(before);
    expect(gosOf(useDoc.getState().show!)[0].actions).toHaveLength(2);
  });

  it("a track that starts by itself (Diaframma's Next) makes an auto GO", () => {
    addItemAt(at(2, 0.3), { kind: "audio", sourceId: DEMO_SOUNDS_ID, itemId: "trk-valzer" }, { makeId });
    expect(gosOf(useDoc.getState().show!)[0].auto).toBe(true);
  });

  it("ignores an item that is not in the library", () => {
    expect(addItemAt(at(1, 0.5), { kind: "light", sourceId: DEMO_LIGHTS_ID, itemId: "nope" }, { makeId })).toBeNull();
    expect(gosOf(useDoc.getState().show!)).toHaveLength(0);
  });

  it("can be undone", () => {
    addItemAt(at(1, 0.5), { kind: "light", sourceId: DEMO_LIGHTS_ID, itemId: "mem2" }, { makeId });
    useDoc.getState().undo();
    expect(gosOf(useDoc.getState().show!)).toHaveLength(0);
  });
});

describe("the selected GO", () => {
  beforeEach(async () => {
    n = 0;
    await openDemoShow(true);
  });

  it("deletes a GO with its speed zone and clears the selection", () => {
    useUi.getState().selectGo("go02");
    changeGoSpeed("go02", 0.6);
    expect(useDoc.getState().show!.speedZones).toMatchObject([{ fromGoId: "go02", speed: 0.6 }]);
    deleteGo("go02");
    const s = useDoc.getState().show!;
    expect(gosOf(s).some((g) => g.id === "go02")).toBe(false);
    expect(s.speedZones).toHaveLength(0);
    expect(useUi.getState().selectedGoId).toBeNull();
  });

  it("sets and clears a speed from a GO (one zone per GO)", () => {
    changeGoSpeed("go03", 0.6);
    changeGoSpeed("go03", 1.5);
    expect(useDoc.getState().show!.speedZones).toHaveLength(1);
    expect(useDoc.getState().show!.speedZones[0].speed).toBe(1.5);
    changeGoSpeed("go03", null);
    expect(useDoc.getState().show!.speedZones).toHaveLength(0);
  });

  it("overrides a light time and goes back to the file's value", () => {
    // go10's light has { fade: 5 }: changing only the fade out keeps the fade in at 5.
    changeTimes("go10", "a10l", { fade: undefined, fadeIn: 5, fadeOut: 2 });
    const a = gosOf(useDoc.getState().show!).find((g) => g.id === "go10")!.actions[0];
    expect(a).toMatchObject({ times: { fadeIn: 5, fadeOut: 2 } });
    changeTimes("go10", "a10l", { fadeIn: undefined, fadeOut: undefined });
    expect((gosOf(useDoc.getState().show!).find((g) => g.id === "go10")!.actions[0] as { times?: unknown }).times).toBeUndefined();
  });

  it("changes the level of a sound, who gives the GO, auto, and removes an action", () => {
    changeLevel("go12", "a12s", -4);
    changeGivenBy("go12", "secondary");
    changeAuto("go12", true);
    let g = gosOf(useDoc.getState().show!).find((x) => x.id === "go12")!;
    expect(g).toMatchObject({ givenBy: "secondary", auto: true, actions: [{ levelDb: -4 }] });
    changeLevel("go12", "a12s", undefined);
    g = gosOf(useDoc.getState().show!).find((x) => x.id === "go12")!;
    expect((g.actions[0] as { levelDb?: number }).levelDb).toBeUndefined();
    deleteAction("go01", "a01s");
    expect(gosOf(useDoc.getState().show!).find((x) => x.id === "go01")!.actions).toHaveLength(1);
  });

  it("adds a stop for one sound or for every sound", () => {
    addStop("go02", { sourceId: DEMO_SOUNDS_ID, itemId: "trk-campane" });
    addStop("go02");
    const stops = gosOf(useDoc.getState().show!).find((x) => x.id === "go02")!.actions.filter((a) => a.kind === "audioStop");
    expect(stops).toHaveLength(2);
  });

  it("makes an empty GO here, selected", () => {
    const id = newGoHere(at(5, 0.5), makeId);
    expect(gosOf(useDoc.getState().show!).find((g) => g.id === id)?.actions).toEqual([]);
    expect(useUi.getState().selectedGoId).toBe(id);
  });
});

describe("linked files", () => {
  beforeEach(async () => {
    n = 0;
    await openDemoShow(true);
  });

  it("counts the GOs that use a source, each once", () => {
    const s = useDoc.getState().show!;
    expect(sourceUsage(s, DEMO_SOUNDS_ID)).toBe(8);
    expect(sourceUsage(s, "nothing")).toBe(0);
  });

  it("removing a source in use leaves the GOs, with their actions missing; linking it again fixes them", async () => {
    const link = useDoc.getState().show!.sources.find((l) => l.id === DEMO_SOUNDS_ID)!;
    removeSource(DEMO_SOUNDS_ID);
    await useLibrary.getState().reload();
    const s = useDoc.getState().show!;
    expect(s.sources.some((l) => l.id === DEMO_SOUNDS_ID)).toBe(false);
    expect(gosOf(s)).toHaveLength(12);
    const missing = useLibrary.getState().library.missing(gosOf(s));
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((m) => m.reason === "source")).toBe(true);
    // Undo brings the link back.
    useDoc.getState().undo();
    await useLibrary.getState().reload();
    expect(useDoc.getState().show!.sources).toContainEqual(link);
    expect(useLibrary.getState().library.missing(gosOf(useDoc.getState().show!))).toHaveLength(0);
  });

  it("links a file once, by its path", async () => {
    useDoc.getState().change((s) => ({ ...s, sources: [] }));
    const a = await linkSource(DEMO_SOUNDS_PATH, makeId);
    expect(a.result).toBe("added");
    const b = await linkSource(DEMO_SOUNDS_PATH, makeId);
    expect(b.result).toBe("duplicate");
    expect(useDoc.getState().show!.sources).toHaveLength(1);
    expect(useDoc.getState().show!.sources[0]).toMatchObject({ app: "diaframma", path: "Suoni.diaframma" });
  });

  it("refuses a file that is not a Diaframma or Granvelo one", async () => {
    expect(await linkSource("C:\\Spettacoli\\La locandiera\\Copione.pdf", makeId)).toMatchObject({ result: "refused", reason: "type" });
    // Known by its extension but not there / not in the format.
    const r = await linkSource("C:\\Spettacoli\\La locandiera\\Altro.granvelo", makeId);
    expect(r.result === "added" || r.result === "refused").toBe(true);
  });

  it("acknowledging does nothing without a fingerprint (the preview has none)", () => {
    const before = useDoc.getState().show;
    acknowledgeSource(DEMO_SOUNDS_ID);
    expect(useDoc.getState().show).toBe(before);
  });
});
