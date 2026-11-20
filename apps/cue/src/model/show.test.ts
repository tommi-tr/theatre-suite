import { describe, expect, it } from "vitest";
import { checkShowJson, errorCode, errorDetail, newShow, parseShow, serializeShow, ShowFileError, type CueShow } from "./show";

const LAUNCHER = JSON.stringify({ format: "theatre.cue", formatVersion: 1, id: "0f3c9a", title: "Amleto" });
const fixedId = () => "id-made-here";

describe("show.json", () => {
  it("opens exactly what the launcher creates, with every default", () => {
    const s = parseShow(LAUNCHER);
    expect(s.id).toBe("0f3c9a");
    expect(s.title).toBe("Amleto");
    expect(s.script).toBeNull();
    expect(s.sources).toEqual([]);
    expect(s.gos).toEqual([]);
    expect(s.notes).toEqual([]);
    expect(s.speedZones).toEqual([]);
    expect(s.checklist).toEqual([]);
    expect(s.layout).toEqual({ scriptWidth: null, audioBoxHeights: {} });
    expect(s.projection).toEqual({ blank: { kind: "black" }, screen: null, items: [] });
    expect(s.settings).toEqual({ autoScrollSpeed: 1, ftbSeconds: 3 });
  });

  it("gives an id to a show without one", () => {
    expect(parseShow(JSON.stringify({ format: "theatre.cue", formatVersion: 1 }), fixedId).id).toBe("id-made-here");
  });

  it("keeps unknown fields, at the top and inside items", () => {
    const text = JSON.stringify({
      format: "theatre.cue",
      formatVersion: 1,
      id: "a",
      title: "La locandiera",
      futureThing: { x: [1, 2, { y: null }] },
      gos: [{ id: "g1", anchor: { page: 3, y: 0.4, fromTheFuture: 7 }, actions: [{ id: "a1", kind: "light", extra: "keep" }], givenBy: "secondary", colour: "red" }],
      layout: { scriptWidth: 0.42, panes: { left: 1 } },
      projection: { items: [], wallpaper: "x" },
      settings: { autoScrollSpeed: 1.5, secret: true },
    });
    const s = parseShow(text);
    const again = JSON.parse(serializeShow(s));
    expect(again.futureThing).toEqual({ x: [1, 2, { y: null }] });
    expect(again.gos[0].colour).toBe("red");
    expect(again.gos[0].anchor.fromTheFuture).toBe(7);
    expect(again.gos[0].actions[0].extra).toBe("keep");
    expect(again.gos[0].givenBy).toBe("secondary");
    expect(again.layout).toEqual({ scriptWidth: 0.42, panes: { left: 1 }, audioBoxHeights: {} });
    expect(again.projection.wallpaper).toBe("x");
    expect(again.settings).toEqual({ autoScrollSpeed: 1.5, secret: true, ftbSeconds: 3 });
    // An edit made by copying keeps them too.
    const edited: CueShow = { ...s, title: "Nuovo titolo", gos: s.gos.map((g) => ({ ...g, givenBy: "both" as const })) };
    const after = JSON.parse(serializeShow(edited));
    expect(after.title).toBe("Nuovo titolo");
    expect(after.gos[0].colour).toBe("red");
    expect(after.futureThing).toEqual({ x: [1, 2, { y: null }] });
  });

  it("round-trips and writes the known fields first", () => {
    const s = parseShow(LAUNCHER);
    const text = serializeShow(s, { name: "Cue", version: "0.1.0" });
    expect(Object.keys(JSON.parse(text)).slice(0, 4)).toEqual(["format", "formatVersion", "id", "title"]);
    expect(JSON.parse(text).savedWith).toEqual({ app: "Cue", version: "0.1.0" });
    const back = parseShow(text);
    expect(serializeShow(back, { name: "Cue", version: "0.1.0" })).toBe(text);
  });

  it("drops the version note of a copy from the versions folder", () => {
    const s = parseShow(JSON.stringify({ format: "theatre.cue", formatVersion: 1, id: "a", title: "x", versionKind: "named", versionNote: "dopo la prova" }));
    const out = JSON.parse(serializeShow(s));
    expect(out.versionKind).toBeUndefined();
    expect(out.versionNote).toBeUndefined();
  });

  it("repairs wrong types instead of failing", () => {
    const s = parseShow(JSON.stringify({ format: "theatre.cue", formatVersion: 1, id: 5, title: ["x"], gos: "no", notes: [1, null, { id: "n1", anchor: { page: -3, y: 9 } }], settings: { autoScrollSpeed: 1000 } }), fixedId);
    expect(s.id).toBe("id-made-here");
    expect(s.title).toBe("");
    expect(s.gos).toEqual([]);
    expect(s.notes).toEqual([{ id: "n1", anchor: { page: 1, y: 1, quote: "", before: "", after: "" }, text: "" }]);
    expect(s.settings.autoScrollSpeed).toBe(20);
  });

  it("refuses other formats with a clear problem", () => {
    const problem = (text: string) => {
      try {
        checkShowJson(text);
        return "ok";
      } catch (e) {
        return e instanceof ShowFileError ? e.problem : "other";
      }
    };
    expect(problem(LAUNCHER)).toBe("ok");
    expect(problem("{broken")).toBe("not-json");
    expect(problem("[1,2]")).toBe("not-cue");
    expect(problem(JSON.stringify({ format: "theatre.granvelo", formatVersion: 1 }))).toBe("not-cue");
    expect(problem(JSON.stringify({ format: "theatre.cue" }))).toBe("not-cue");
    expect(problem(JSON.stringify({ format: "theatre.cue", formatVersion: 2 }))).toBe("newer");
  });

  it("makes a new show like the launcher's", () => {
    const s = newShow("  La locandiera ", fixedId);
    expect(s.title).toBe("La locandiera");
    expect(s.id).toBe("id-made-here");
    expect(parseShow(serializeShow(s))).toEqual(s);
  });

  it("reads the problem code of native errors", () => {
    expect(errorCode(new Error("not-cue: This is not a Cue show"))).toBe("not-cue");
    expect(errorCode("newer: Format version 2")).toBe("newer");
    expect(errorCode(new ShowFileError("not-json", "x"))).toBe("damaged");
    expect(errorCode("something else")).toBe("other");
    expect(errorDetail("io: Cannot open C:\\x.tcue")).toBe("Cannot open C:\\x.tcue");
  });
});

describe("script, notes and layout (phase 1)", () => {
  it("reads the PDF script, notes with anchors and the script width", () => {
    const s = parseShow(
      JSON.stringify({
        format: "theatre.cue",
        formatVersion: 1,
        id: "a",
        title: "x",
        script: { kind: "pdf", part: "script.pdf", fileName: "Locandiera.pdf", sha256: "ab", pageCount: 6, extra: 1 },
        notes: [
          { id: "n1", anchor: { page: 2, y: 0.5, x: 0.3, quote: "CONTE", before: "a", after: "b" }, text: "Luce pronta" },
          { id: "n2", anchor: { page: 0, y: 7, x: "no" }, text: 3 },
          { text: "no id" },
        ],
        layout: { scriptWidth: 3 },
      }),
    );
    expect(s.script).toEqual({ kind: "pdf", part: "script.pdf", fileName: "Locandiera.pdf", sha256: "ab", pageCount: 6, extra: 1 });
    expect(s.notes).toHaveLength(2);
    expect(s.notes[0].anchor).toEqual({ page: 2, y: 0.5, x: 0.3, quote: "CONTE", before: "a", after: "b" });
    expect(s.notes[1].anchor).toEqual({ page: 1, y: 1, quote: "", before: "", after: "" });
    expect(s.notes[1].text).toBe("");
    expect(s.layout.scriptWidth).toBe(0.8);
  });
});
