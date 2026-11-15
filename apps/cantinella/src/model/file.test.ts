import { describe, expect, it } from "vitest";
import { CantinellaFileError, parse, serialize } from "./file";
import { demoData } from "./demo";
import { isEmpty, newData, nameKey, phoneKey } from "./defaults";

const APP = { name: "Cantinella", version: "0.1.0" };

describe("file format 1", () => {
  it("round-trips a document", () => {
    const d = demoData();
    const back = parse(serialize(d, APP));
    expect(back).toEqual(d);
  });

  it("writes readable, versioned JSON", () => {
    const text = serialize(newData("Produzione"), APP, new Date("2026-11-14T10:00:00Z"));
    const v = JSON.parse(text);
    expect(v.format).toBe("cantinella");
    expect(v.formatVersion).toBe(1);
    expect(v.app).toEqual(APP);
    expect(v.savedAt).toBe("2026-11-14T10:00:00.000Z");
    expect(v.data.title).toBe("Produzione");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("keeps fields it does not know (sections of later versions)", () => {
    const text = JSON.stringify({ format: "cantinella", formatVersion: 1, data: { id: "x", title: "", people: [], budget: { costs: [1, 2] } } });
    const d = parse(text);
    expect(d.extra).toEqual({ budget: { costs: [1, 2] } });
    expect(JSON.parse(serialize(d, APP)).data.budget).toEqual({ costs: [1, 2] });
    expect(isEmpty(d)).toBe(false);
  });

  it("accepts the minimal document the launcher creates", () => {
    const d = parse(JSON.stringify({ format: "cantinella", formatVersion: 1, app: { name: "Theatre Suite", version: "0.3.1" }, data: { title: "Produzione" } }));
    expect(d.title).toBe("Produzione");
    expect(d.people).toEqual([]);
    expect(d.id).toMatch(/.+/);
    expect(isEmpty(d)).toBe(true);
  });

  it("refuses other files clearly", () => {
    const problem = (text: string) => {
      try {
        parse(text);
        return "ok";
      } catch (e) {
        return (e as CantinellaFileError).problem;
      }
    };
    expect(problem("not json")).toBe("not-json");
    expect(problem(JSON.stringify({ format: "bardo", formatVersion: 1 }))).toBe("not-cantinella");
    expect(problem(JSON.stringify({ format: "cantinella", formatVersion: 2 }))).toBe("newer");
    expect(problem(JSON.stringify({ format: "cantinella", formatVersion: 0 }))).toBe("unsupported");
    expect(problem(JSON.stringify({ format: "cantinella" }))).toBe("damaged");
    expect(problem(JSON.stringify({ format: "cantinella", formatVersion: 1, data: [] }))).toBe("damaged");
  });

  it("repairs people without losing them", () => {
    const d = parse(
      JSON.stringify({
        format: "cantinella",
        formatVersion: 1,
        data: { people: [{ id: "a", name: "Uno" }, { id: "a", name: "Due" }, { name: "  " }, "x", { name: "Tre", roles: ["actor", 3], aliases: "no" }] },
      }),
    );
    expect(d.people.map((p) => p.name)).toEqual(["Uno", "Due", "Tre"]);
    expect(new Set(d.people.map((p) => p.id)).size).toBe(3);
    expect(d.people[2].roles).toEqual(["actor"]);
    expect(d.people[2].aliases).toEqual([]);
  });

  it("reads a file with a byte order mark", () => {
    expect(parse("﻿" + serialize(newData(), APP)).people).toEqual([]);
  });
});

describe("comparison keys", () => {
  it("ignores accents, case and punctuation in names", () => {
    expect(nameKey("  Niccolò  D'Amico ")).toBe(nameKey("niccolo d amico"));
  });
  it("ignores the Italian prefix and spaces in phone numbers", () => {
    expect(phoneKey("+39 347 555 0192")).toBe("3475550192");
    expect(phoneKey("0039 347-555-0192")).toBe("3475550192");
    expect(phoneKey("347 5550192")).toBe("3475550192");
  });
});

describe("rehearsals in the file", () => {
  const doc = (rehearsals: unknown, people: unknown[] = [{ id: "p1", name: "Giovanni Rota" }]) =>
    parse(JSON.stringify({ format: "cantinella", formatVersion: 1, data: { id: "x", title: "", people, rehearsals } }));

  it("a document without rehearsals gets empty ones with the default intro", () => {
    const d = parse(JSON.stringify({ format: "cantinella", formatVersion: 1, data: { people: [] } }));
    expect(d.rehearsals.dates).toEqual([]);
    expect(d.rehearsals.answers).toEqual([]);
    expect(d.rehearsals.intro).toMatch(/date delle prove/);
  });

  it("is written and read back as it was", () => {
    const rehearsals = {
      dates: [{ id: "d1", day: "2026-11-16", time: "16:00", minutes: 90, place: "Sala prove" }],
      answers: [{ id: "a1", personId: "p1", dateId: "d1", state: "maybe", note: "esco alle 17", at: "2026-11-15T20:05", source: "paste" }],
      words: { yes: ["x"], maybe: ["boh"], no: [] },
      intro: "Ciao!",
      characters: [{ id: "c1", name: "Mirandolina", actorIds: ["p1"], bardoId: "" }],
      scenes: [{ id: "s1", name: "Scena 1", act: "Atto I", characterIds: ["c1"], optional: [], weight: 3, minutes: 40, bardoId: "b1" }],
      plan: [{ id: "x1", dateId: "d1", sceneId: "s1", locked: true }],
      allowMaybe: true,
      bardo: { path: "C:/x/copione.bardo", title: "La locandiera", hash: "abc", readAt: "2026-11-15T20:00" },
    };
    const d = doc(rehearsals);
    expect(d.rehearsals).toEqual(rehearsals);
    expect(parse(serialize(d, APP)).rehearsals).toEqual(rehearsals);
    expect(isEmpty(d)).toBe(false);
  });

  it("repairs what is wrong instead of failing", () => {
    const d = doc({
      dates: [
        { id: "d1", day: "2026-11-16", time: "25:99", minutes: 5 },
        { id: "d1", day: "2026-11-17", time: "18:00", minutes: 99999 },
        { day: "2026-02-31x" },
        "nonsense",
      ],
      answers: [
        { id: "a1", personId: "p1", dateId: "d1", state: "yes", at: "yesterday", source: "other" },
        { id: "a2", personId: "ghost", dateId: "d1", state: "yes" },
        { id: "a3", personId: "p1", dateId: "ghost", state: "yes" },
        { id: "a4", personId: "p1", dateId: "d1", state: "perhaps" },
      ],
      intro: 5,
    });
    expect(d.rehearsals.dates.map((x) => [x.day, x.time, x.minutes])).toEqual([["2026-11-16", "18:00", 15], ["2026-11-17", "18:00", 1440]]);
    expect(new Set(d.rehearsals.dates.map((x) => x.id)).size).toBe(2);
    expect(d.rehearsals.answers.map((a) => [a.id, a.at, a.source])).toEqual([["a1", "", "manual"]]);
    expect(d.rehearsals.intro).toMatch(/date delle prove/);
  });
});
