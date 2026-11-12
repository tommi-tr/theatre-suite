import { describe, expect, it } from "vitest";
import { deriveIndex, countWords, formatMinutes } from "./derive";
import { makeVersion, nextMajor, nextVersion, openVersion, parse, serialize, BardoFileError, normalizeData } from "./file";
import { buildList } from "./lists";
import { itOrdinal, partLabel, roman, enCardinal } from "./numbering";
import { sampleDoc } from "./sample";
import { newScriptDoc, getData, defaultListConfig } from "./defaults";
import { CHARACTER_CAT } from "./types";

describe("numbering", () => {
  it("writes Italian ordinals", () => {
    expect(itOrdinal(1)).toBe("primo");
    expect(itOrdinal(10)).toBe("decimo");
    expect(itOrdinal(11)).toBe("undicesimo");
    expect(itOrdinal(17)).toBe("diciassettesimo");
    expect(itOrdinal(21)).toBe("ventunesimo");
    expect(itOrdinal(23)).toBe("ventitreesimo");
    expect(itOrdinal(26)).toBe("ventiseiesimo");
    expect(itOrdinal(28)).toBe("ventottesimo");
    expect(itOrdinal(40)).toBe("quarantesimo");
  });
  it("labels acts and scenes in both languages", () => {
    expect(partLabel("act", 1, "words", "it")).toBe("Atto primo");
    expect(partLabel("scene", 3, "words", "it")).toBe("Scena terza");
    expect(partLabel("scene", 11, "words", "it")).toBe("Scena undicesima");
    expect(partLabel("act", 2, "roman", "it")).toBe("Atto II");
    expect(partLabel("scene", 4, "arabic", "en")).toBe("Scene 4");
    expect(partLabel("act", 21, "words", "en")).toBe("Act Twenty-One");
    expect(enCardinal(5)).toBe("Five");
    expect(roman(1994)).toBe("MCMXCIV");
  });
});

describe("index of the script", () => {
  const doc = sampleDoc("it");
  const idx = deriveIndex(doc);
  const data = getData(doc);

  it("finds acts and scenes with their numbers", () => {
    expect(idx.acts).toHaveLength(1);
    expect(idx.scenes).toHaveLength(2);
    expect(idx.scenes[0].label).toBe("Scena prima");
    expect(idx.scenes[1].label).toBe("Scena seconda");
    expect(idx.scenes[1].act).toBe(1);
    expect(idx.acts[0].scenes).toEqual([0, 1]);
  });

  it("knows who is on stage in each scene", () => {
    const names = (ids: string[]) => ids.map((id) => data.characters.find((c) => c.id === id)!.name);
    expect(names(idx.scenes[0].speakers)).toEqual(["Bernardo", "Francesco", "Orazio", "Marcello"]);
    // The Ghost does not speak but is named in a stage direction.
    expect(names(idx.scenes[0].present)).toContain("Lo Spettro");
    expect(names(idx.scenes[1].present)).toEqual(["Claudio", "Amleto", "Gertrude", "Polonio", "Laerte"]);
  });

  it("collects marked items per scene and counts speeches", () => {
    expect(idx.scenes[0].items.oggetto).toHaveLength(1);
    expect(idx.scenes[1].items.suono).toHaveLength(1);
    expect(idx.totals.speeches).toBe(idx.speechNumber.size);
    expect(idx.speechNumber.get(idx.blockPos[idx.scenes[0].idx + 2])).toBe(1);
    expect(idx.totals.minutes).toBeGreaterThan(0);
  });

  it("counts words with apostrophes as one", () => {
    expect(countWords("Va’ a dormire, Francesco.")).toBe(4);
    expect(countWords("'Tis now struck twelve")).toBe(4);
    expect(formatMinutes(230)).toBe("3 h 50 min");
    expect(formatMinutes(45)).toBe("45 min");
  });
});

describe("automatic lists", () => {
  const doc = sampleDoc("it");
  const idx = deriveIndex(doc);
  const data = getData(doc);

  it("lists only the objects still in the text, with references", () => {
    const blocks = buildList(defaultListConfig("it", "index"), data, idx, () => 3);
    const entries = blocks.filter((b) => b.type === "entry");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: "lanterna", refs: "I.1 · pag. 3" });
  });

  it("builds a presence table characters × scenes", () => {
    const blocks = buildList(defaultListConfig("it", "presence"), data, idx, () => null);
    const table = blocks.find((b) => b.type === "table");
    expect(table && table.type === "table" && table.columns).toEqual(["I.1", "I.2"]);
    const amleto = table && table.type === "table" ? table.rows.find((r) => r.name === "Amleto") : null;
    expect(amleto?.cells).toEqual([false, true]);
  });

  it("groups by scene when asked", () => {
    const cfg = { ...defaultListConfig("it", "list"), what: ["suono"], group: "scene" as const };
    const blocks = buildList(cfg, data, idx, () => null);
    expect(blocks.filter((b) => b.type === "group")).toHaveLength(2);
  });

  it("makes a table of contents", () => {
    const blocks = buildList({ ...defaultListConfig("it", "toc"), present: true }, data, idx, (pos) => (pos > idx.scenes[1].pos - 1 ? 6 : 3));
    const entries = blocks.filter((b) => b.type === "entry");
    expect(entries.map((e) => e.type === "entry" && e.refs)).toEqual(["pag. 3", "pag. 6"]);
    expect(entries[0].type === "entry" && entries[0].present).toContain("Bernardo");
  });
});

describe(".bardo files", () => {
  it("round-trips the example with its versions", () => {
    const doc = sampleDoc("en");
    const v = makeVersion(doc, "0.9", "draft", 120);
    const text = serialize(doc, [v], "Bardo test");
    const back = parse(text);
    expect(back.doc.eq(doc)).toBe(true);
    expect(back.versions).toHaveLength(1);
    const old = openVersion(back.versions[0]);
    expect(old.textContent).toBe(doc.textContent);
  });

  it("refuses files that are not Bardo scripts", () => {
    expect(() => parse("{}")).toThrow(BardoFileError);
    expect(() => parse("not json")).toThrow(BardoFileError);
    expect(() => parse(JSON.stringify({ format: "bardo", formatVersion: 99 }))).toThrow(BardoFileError);
  });

  it("repairs missing fields and duplicate ids", () => {
    const doc = newScriptDoc("it");
    const json = JSON.parse(serialize(doc, [], "t"));
    json.data = { lang: "it" };
    json.content.push(json.content[json.content.length - 1]);
    const back = parse(JSON.stringify(json));
    const ids: string[] = [];
    back.doc.forEach((n) => n.attrs.id && ids.push(n.attrs.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(getData(back.doc).categories.some((c) => c.id === CHARACTER_CAT)).toBe(true);
    expect(normalizeData(null).format.name).toBe("Classico");
  });

  it("proposes the next version number", () => {
    expect(nextVersion("2.3")).toBe("2.4");
    expect(nextVersion("3")).toBe("3.1");
    expect(nextVersion("bozza")).toBe("1.0");
    expect(nextMajor("2.3")).toBe("3.0");
  });
});
