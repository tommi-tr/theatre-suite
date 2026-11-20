import { describe, expect, it } from "vitest";
import { DEFAULT_SHOW_SETTINGS, engineTrack, engineTracks, showEngineConfig } from "./engine";
import { docToFile, parseDoc } from "./file";
import { listTracks, readCueList, resolveRelativePath, trackPathCandidates } from "./library";
import { newTrack, type Track } from "./types";

/** A minimal format-3 cue list as Diaframma writes it (only the fields it needs; the rest are defaults). */
const minimal = {
  format: "diaframma.cuelist",
  formatVersion: 3,
  app: { name: "Diaframma", version: "0.3.1" },
  tracks: [
    { id: "t-rain", file: { path: "C:\\Shows\\Locandiera\\audio\\rain.wav", relativePath: "audio/rain.wav", name: "rain.wav", durationSec: 60 }, exit: "crossfade", exitSec: 2, inSec: 5, outSec: 50, volumeDb: -6 },
    { id: "t-hidden", hidden: true, file: { path: "C:\\Shows\\Locandiera\\audio\\old.wav", name: "old.wav" } },
    { id: "t-door", file: { path: "C:\\Shows\\Locandiera\\audio\\door.wav", relativePath: "audio/door.wav" }, entry: "fadeIn", exit: "next" },
    { id: "t-bell", file: { path: "C:\\Shows\\Locandiera\\audio\\bell.wav" }, loopOn: true, exit: "next" },
    { id: "t-end", file: { path: "C:\\Shows\\Locandiera\\audio\\end.wav" }, pan: 3, eq: [1, 2, 99] },
    { file: null },
  ],
};

describe("reading a .diaframma cue list (format 3)", () => {
  it("reads a minimal document, keeping the stable ids and filling defaults", () => {
    const tracks = parseDoc(JSON.stringify(minimal));
    expect(tracks.map((t) => t.id).slice(0, 5)).toEqual(["t-rain", "t-hidden", "t-door", "t-bell", "t-end"]);
    expect(tracks[5].id).toMatch(/.+/); // a track without id gets one
    expect(tracks[2].file).toEqual({ path: "C:\\Shows\\Locandiera\\audio\\door.wav", relativePath: "audio/door.wav", name: "door.wav", durationSec: null });
    expect(tracks[4].pan).toBe(1);
    expect(tracks[4].eq).toEqual([1, 2, 24, 0, 0]);
    expect(tracks[0]).toEqual({ ...newTrack("t-rain"), file: tracks[0].file, exit: "crossfade", exitSec: 2, inSec: 5, outSec: 50, volumeDb: -6 });
  });

  it("refuses format 2 and other files with a clear message", () => {
    expect(() => parseDoc(JSON.stringify({ ...minimal, formatVersion: 2 }))).toThrowError("different version of Diaframma");
    expect(() => parseDoc(JSON.stringify({ ...minimal, formatVersion: 4 }))).toThrowError("newer version of Diaframma");
    expect(() => parseDoc(JSON.stringify({ app: "granvelo", format: 1 }))).toThrowError("not a Diaframma cue list");
  });

  it("writes back what it reads", () => {
    const tracks = parseDoc(JSON.stringify(minimal));
    const again = parseDoc(JSON.stringify(docToFile(tracks, "0.3.1")));
    expect(again).toEqual(tracks);
  });
});

describe("track summaries", () => {
  it("numbers the shown tracks, resolves the paths and says how each starts", () => {
    const { summaries } = readCueList(JSON.stringify(minimal), { docPath: "D:\\Moved\\Locandiera\\Serata.diaframma" });
    expect(summaries.map((s) => [s.id, s.number, s.start])).toEqual([
      ["t-rain", 1, "go"],
      ["t-hidden", null, "go"],
      ["t-door", 2, "crossfadeFromPrevious"],
      ["t-bell", 3, "afterPrevious"],
      ["t-end", 4, "go"], // the track before loops: it never ends by itself
      [summaries[5].id, 5, "go"],
    ]);
    const rain = summaries[0];
    expect(rain.candidates).toEqual(["C:\\Shows\\Locandiera\\audio\\rain.wav", "D:\\Moved\\Locandiera\\audio\\rain.wav"]);
    expect([rain.durationSec, rain.inSec, rain.outSec, rain.playSec, rain.exitSec, rain.fadeInSec]).toEqual([60, 5, 50, 45, 2, 0]);
    const door = summaries[2];
    expect([door.fadeInSec, door.exitSec, door.playSec]).toEqual([DEFAULT_SHOW_SETTINGS.fadeInSec, 0, null]);
    expect(summaries[5].hasFile).toBe(false);
    // The general times of the settings apply to a track without its own.
    const own = listTracks(parseDoc(JSON.stringify(minimal)), { settings: { ...DEFAULT_SHOW_SETTINGS, fadeInSec: 9, numberFrom: 0 } });
    expect([own[0].number, own[2].fadeInSec, own[2].candidates]).toEqual([0, 9, ["C:\\Shows\\Locandiera\\audio\\door.wav"]]);
  });

  it("resolves relative paths like Diaframma (folder of the document, Windows or POSIX)", () => {
    expect(resolveRelativePath("C:\\Shows\\A\\Show.diaframma", "../Sounds/x.wav")).toBe("C:\\Shows\\Sounds\\x.wav");
    expect(resolveRelativePath("/home/me/show/Show.diaframma", "audio/x.wav")).toBe("/home/me/show/audio/x.wav");
    expect(resolveRelativePath("/Show.diaframma", "../../x.wav")).toBe("/x.wav");
    expect(resolveRelativePath("\\\\server\\share\\Show.diaframma", "../x.wav")).toBe("\\\\server\\share\\x.wav");
    expect(trackPathCandidates({ file: null }, "C:\\x.diaframma")).toEqual([]);
  });
});

describe("engine parameters (engine_sync)", () => {
  it("sends every track field but the file, with the path to play", () => {
    const tracks: Track[] = parseDoc(JSON.stringify(minimal));
    const sent = engineTracks(tracks, { "t-door": true });
    expect(sent[0]).toEqual({ ...tracks[0], file: undefined, path: "C:\\Shows\\Locandiera\\audio\\rain.wav" });
    expect("file" in sent[0]).toBe(false);
    expect(sent[2].path).toBeNull(); // missing file
    expect(sent[5].path).toBeNull(); // empty row
    expect(engineTrack(tracks[2], "D:\\door.wav")).toEqual({ ...sent[2], path: "D:\\door.wav" });
  });

  it("builds the show config from the settings, show behaviour on", () => {
    expect(showEngineConfig()).toEqual({ ...DEFAULT_SHOW_SETTINGS, steps: true });
    expect(showEngineConfig({ ...DEFAULT_SHOW_SETTINGS, crossfadeSec: 7, numberFrom: 0 })).toMatchObject({ crossfadeSec: 7, numberFrom: 0, steps: true });
  });
});
