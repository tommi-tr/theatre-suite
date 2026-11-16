import { describe, expect, it } from "vitest";
import { findShow } from "@theatre-suite/core";

const INDEX = JSON.stringify({ format: "theatre.project", id: "abc", title: "La locandiera", cover: { color: "#4a5fa8" } });

function io(files: Record<string, string>) {
  return { exists: async (p: string) => p in files, read: async (p: string) => files[p] };
}

describe("findShow (shared by every app)", () => {
  it("finds the show whose index is next to the document", async () => {
    const show = await findShow("C:\\Spettacoli\\Locandiera\\cast.cantinella", io({ "C:\\Spettacoli\\Locandiera\\progetto.theatre": INDEX }));
    expect(show).toMatchObject({ id: "abc", title: "La locandiera", color: "#4a5fa8", dir: "C:\\Spettacoli\\Locandiera" });
  });

  it("returns null for a document alone, an unsaved one, or a broken index", async () => {
    expect(await findShow("C:\\Docs\\a.bardo", io({}))).toBeNull();
    expect(await findShow(null, io({}))).toBeNull();
    expect(await findShow("C:\\S\\a.bardo", io({ "C:\\S\\progetto.theatre": "not json" }))).toBeNull();
  });

  it("never throws when the disk fails", async () => {
    const broken = { exists: async () => { throw new Error("denied"); }, read: async () => "" };
    expect(await findShow("C:\\S\\a.bardo", broken)).toBeNull();
  });
});
