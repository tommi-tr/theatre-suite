import { describe, expect, it } from "vitest";
import { serialize } from "@theatre-suite/show-files/granvelo";
import { DEMO_GOS, DEMO_LIGHTS_ID, DEMO_LIGHTS_PATH, DEMO_SOUNDS_ID, DEMO_SOUNDS_PATH, DEMO_SOURCES, demoGranveloDoc, demoSourceTexts } from "../lib/demoShow";
import { appForPath, baseName, failedSource, Library, newLink, parseSource, relativePath, type SourceLink } from "./sources";

const [LIGHTS, SOUNDS] = DEMO_SOURCES;
const texts = demoSourceTexts();
const demoLibrary = () => new Library([parseSource(LIGHTS, texts.lights, { absPath: DEMO_LIGHTS_PATH }), parseSource(SOUNDS, texts.sounds, { absPath: DEMO_SOUNDS_PATH })]);

describe("reading sources", () => {
  it("lists the memories of a Granvelo show with stable keys", () => {
    const s = parseSource(LIGHTS, texts.lights, { absPath: DEMO_LIGHTS_PATH });
    expect(s.status).toEqual({ state: "ok" });
    expect(s.title).toBe("La locandiera — luci");
    expect(s.lights).toHaveLength(10);
    const m7 = s.lights.find((l) => l.number === 7)!;
    expect(m7).toMatchObject({ key: { sourceId: DEMO_LIGHTS_ID, itemId: "mem7" }, name: "Lampo", autoFollow: true, startsByItself: false });
    expect(m7.times).toEqual({ fadeIn: 0, fadeOut: 0.4, delay: 0, moveInDark: false });
    expect(s.lights.find((l) => l.number === 8)?.startsByItself).toBe(true);
    // Thumbnail data: every light, the lit ones with their colour.
    const m3 = s.lights.find((l) => l.number === 3)!;
    expect(m3.thumbnail.lights).toHaveLength(7);
    expect(m3.thumbnail.lights.filter((l) => l.light).length).toBe(m3.litCount);
  });

  it("lists the tracks of a Diaframma cue list", () => {
    const s = parseSource(SOUNDS, texts.sounds, { absPath: DEMO_SOUNDS_PATH });
    expect(s.status.state).toBe("ok");
    expect(s.audio.map((a) => a.name)).toEqual(["Campane.wav", "Minuetto.mp3", "Valzer.mp3", "Pioggia.wav", "Tuono.wav", "Applausi.wav"]);
    const valzer = s.audio[2];
    expect(valzer).toMatchObject({ number: 3, start: "afterPrevious", startsByItself: true, exit: "fadeOut", exitSec: 4, playSec: 120 });
    expect(s.audio[0]).toMatchObject({ fadeInSec: 2, startsByItself: false, path: "C:\\Spettacoli\\La locandiera\\audio\\Campane.wav" });
    expect(s.audio[0].candidates).toHaveLength(1);
  });

  it("plays the first existing candidate", () => {
    const s = parseSource(SOUNDS, texts.sounds, { absPath: "D:\\Copia\\Suoni.diaframma", trackPath: (c) => c[1] ?? null });
    expect(s.audio[0].path).toBe("D:\\Copia\\audio\\Campane.wav");
  });

  it("says what is wrong with a file, in codes", () => {
    expect(parseSource(LIGHTS, "not json").status.state).toBe("wrongFormat");
    expect(parseSource(LIGHTS, texts.sounds).status.state).toBe("wrongFormat");
    expect(parseSource(SOUNDS, texts.lights).status.state).toBe("wrongFormat");
    expect(parseSource(SOUNDS, "{").status.state).toBe("wrongFormat");
    const newer = texts.lights.replace('"format": 1', '"format": 9');
    expect(parseSource(LIGHTS, newer).status.state).toBe("newer");
    expect(parseSource(SOUNDS, texts.sounds.replace('"formatVersion": 3', '"formatVersion": 9')).status.state).toBe("newer");
    expect(parseSource({ id: "b", app: "bardo", path: "x.bardo" }, "{}").status.state).toBe("unsupported");
    expect(failedSource(LIGHTS, "missing").status.state).toBe("missing");
  });

  it("notices another show at the same path, and a changed file", () => {
    const other = { ...demoGranveloDoc(), id: "someone-else" };
    const s = parseSource(LIGHTS, serialize(other, { name: "Granvelo", version: "0.6.1" }));
    expect(s.status.state).toBe("otherDocument");
    expect(s.lights).toHaveLength(10);
    const changed = parseSource({ ...LIGHTS, sha256: "aaa" }, texts.lights, { sha256: "bbb" });
    expect(changed.status).toEqual({ state: "ok", changed: true });
    expect(parseSource({ ...LIGHTS, sha256: "aaa" }, texts.lights, { sha256: "aaa" }).status.changed).toBeUndefined();
  });
});

describe("library", () => {
  it("finds every item the demo GOs use", () => {
    const lib = demoLibrary();
    expect(lib.missing(DEMO_GOS)).toEqual([]);
    expect(lib.lights).toHaveLength(10);
    expect(lib.audio).toHaveLength(6);
    expect(lib.lookup.memory({ sourceId: DEMO_LIGHTS_ID, itemId: "mem2" })).toEqual({ fadeIn: 8, fadeOut: 8, delay: 0, moveInDark: false });
    expect(lib.lookup.track({ sourceId: DEMO_SOUNDS_ID, itemId: "trk-pioggia" })).toEqual({ playSec: 60, exit: null, exitSec: 0, loop: true });
    expect(lib.lookup.memory({ sourceId: DEMO_LIGHTS_ID, itemId: "nope" })).toBeNull();
  });

  it("reports missing sources and missing items", () => {
    const lib = new Library([failedSource(LIGHTS, "missing"), parseSource(SOUNDS, texts.sounds)]);
    const gos = [{ ...DEMO_GOS[0] }, { id: "x", anchor: DEMO_GOS[0].anchor, givenBy: "both" as const, actions: [{ id: "s", kind: "audio" as const, ref: { sourceId: DEMO_SOUNDS_ID, itemId: "gone" } }] }];
    expect(lib.missing(gos)).toEqual([
      { goId: "go01", actionId: "a01l", ref: { sourceId: DEMO_LIGHTS_ID, itemId: "mem2" }, reason: "source" },
      { goId: "x", actionId: "s", ref: { sourceId: DEMO_SOUNDS_ID, itemId: "gone" }, reason: "item" },
    ]);
    expect(lib.lights).toEqual([]);
  });

  it("builds the DMX fade of a memory with the times asked", () => {
    const lib = demoLibrary();
    const p = lib.fadePayload({ sourceId: DEMO_LIGHTS_ID, itemId: "mem3" }, { fadeIn: 1, fadeOut: 2, delay: 0.5, moveInDark: false })!;
    expect(p.target.slice(0, 4)).toEqual([230, 255, 230, 0]);
    expect(p.target.slice(15, 18)).toEqual([120, 180, 255]);
    expect(p.transition).toEqual({ fadeIn: 1, fadeOut: 2, delay: 0.5, moveInDark: false });
    expect(p.layout.intensity).toHaveLength(512);
    expect(lib.fadePayload({ sourceId: DEMO_LIGHTS_ID, itemId: "nope" }, { fadeIn: 1, fadeOut: 1, delay: 0, moveInDark: false })).toBeNull();
    const dark = lib.fadePayload(null, { fadeIn: 0, fadeOut: 3, delay: 0, moveInDark: false })!;
    expect(dark.target.every((v) => v === 0)).toBe(true);
  });

  it("knows the emergency light", () => {
    const v = demoLibrary().emergencyValues()!;
    // Every used light white at full: PCs, profile, RGB at full.
    expect(v.slice(0, 4)).toEqual([255, 255, 255, 255]);
    expect(v.slice(9, 18).every((x) => x === 255)).toBe(true);
    expect(new Library([parseSource(SOUNDS, texts.sounds)]).emergencyValues()).toBeNull();
    const doc = demoGranveloDoc();
    doc.settings.emergencyMemoryId = "mem9";
    const lib = new Library([parseSource(LIGHTS, serialize(doc, { name: "Granvelo", version: "0.6.1" }))]);
    expect(lib.emergencyValues()!.slice(0, 4)).toEqual([255, 255, 255, 200]);
  });

  it("gives the audio engine every track, with a copy for each sound changed in Cue", () => {
    const sync = demoLibrary().audioSync(DEMO_GOS);
    expect(sync).toHaveLength(1);
    expect(sync[0].sourceId).toBe(DEMO_SOUNDS_ID);
    const ids = sync[0].tracks.map((t) => t.id);
    expect(ids).toEqual(["trk-campane", "trk-minuetto", "trk-valzer", "trk-pioggia", "trk-tuono", "trk-applausi", "trk-applausi#a12s"]);
    const copy = sync[0].tracks[6];
    expect(copy.volumeDb).toBe(-1);
    expect(copy.path).toBe("C:\\Spettacoli\\La locandiera\\audio\\Applausi.wav");
    // Times made explicit.
    expect(sync[0].tracks[0]).toMatchObject({ entry: "fadeIn", entrySec: 2, playSec: 42 });
    expect(sync[0].tracks[2]).toMatchObject({ exit: "fadeOut", exitSec: 4 });
    expect("file" in sync[0].tracks[0]).toBe(false);
  });

  it("makes a copy with its own fade in", () => {
    const gos = [{ ...DEMO_GOS[2], actions: [{ id: "x", kind: "audio" as const, ref: { sourceId: DEMO_SOUNDS_ID, itemId: "trk-tuono" }, times: { fade: 1.5 } }] }];
    const t = demoLibrary().audioSync(gos)[0].tracks.find((x) => x.id === "trk-tuono#x")!;
    expect(t).toMatchObject({ entry: "fadeIn", entrySec: 1.5 });
  });
});

describe("paths", () => {
  it("knows the apps by extension", () => {
    expect(appForPath("C:\\a\\Luci.GRANVELO")).toBe("granvelo");
    expect(appForPath("/a/b.diaframma")).toBe("diaframma");
    expect(appForPath("/a/b.wav")).toBeNull();
    expect(baseName("C:\\a\\Luci.granvelo")).toBe("Luci");
  });

  it("makes paths relative to the show file, as the native side", () => {
    const show = "C:\\Spettacoli\\La locandiera\\Serata.tcue";
    expect(relativePath(show, "C:\\Spettacoli\\La locandiera\\Luci.granvelo")).toBe("Luci.granvelo");
    expect(relativePath(show, "c:\\spettacoli\\la locandiera\\audio\\S.diaframma")).toBe("audio/S.diaframma");
    expect(relativePath(show, "C:\\Spettacoli\\Comune\\x.granvelo")).toBe("../Comune/x.granvelo");
    expect(relativePath(show, "D:\\x.granvelo")).toBeNull();
    expect(relativePath("/home/a/show/S.tcue", "/home/b/x.diaframma")).toBe("../../b/x.diaframma");
    expect(relativePath(show, "relative.granvelo")).toBeNull();
  });

  it("links a file relative to the show when possible", () => {
    let n = 0;
    const id = () => `id${++n}`;
    const l: SourceLink = newLink("granvelo", "C:\\Spettacoli\\La locandiera\\Luci.granvelo", "C:\\Spettacoli\\La locandiera\\Serata.tcue", id);
    expect(l).toEqual({ id: "id1", app: "granvelo", path: "Luci.granvelo" });
    expect(newLink("diaframma", "E:\\S.diaframma", "C:\\x\\S.tcue", id).path).toBe("E:\\S.diaframma");
    expect(newLink("diaframma", "E:\\S.diaframma", null, id).path).toBe("E:\\S.diaframma");
  });
});
