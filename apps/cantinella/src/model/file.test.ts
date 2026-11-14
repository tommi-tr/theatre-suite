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
    const text = JSON.stringify({ format: "cantinella", formatVersion: 1, data: { id: "x", title: "", people: [], rehearsals: { dates: [1, 2] } } });
    const d = parse(text);
    expect(d.extra).toEqual({ rehearsals: { dates: [1, 2] } });
    expect(JSON.parse(serialize(d, APP)).data.rehearsals).toEqual({ dates: [1, 2] });
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
