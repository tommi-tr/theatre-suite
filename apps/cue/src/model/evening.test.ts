import { describe, expect, it } from "vitest";
import { addUserCheck, changedTonight, checklistCount, dryRun, forgetTonight, removeCheck, reportText, toggleCheck, withSuggestions, SUGGESTED_CHECKS } from "./evening";
import type { Go } from "./gos";

const go = (id: string, page: number, actions: Go["actions"]): Go => ({ id, anchor: { page, y: 0.5 }, actions, givenBy: "both" }) as unknown as Go;
const id = (s: string) => s;

describe("checklist", () => {
  it("adds the suggestions once, keeps ticks and the user's items", () => {
    let l = withSuggestions([], id);
    expect(l).toHaveLength(SUGGESTED_CHECKS.length);
    l = toggleCheck(l, "sg-audio");
    l = addUserCheck(l, "u1", "  Scaramanzie fatte ");
    l = withSuggestions(l, id);
    expect(l).toHaveLength(SUGGESTED_CHECKS.length + 1);
    expect(l.find((c) => c.id === "sg-audio")!.done).toBe(true);
    expect(l.at(-1)).toMatchObject({ text: "Scaramanzie fatte", origin: "user" });
    expect(checklistCount(l)).toEqual({ done: 1, total: SUGGESTED_CHECKS.length + 1 });
    expect(removeCheck(l, "sg-audio")).toHaveLength(l.length);
    expect(removeCheck(l, "u1")).toHaveLength(l.length - 1);
    expect(addUserCheck(l, "u2", "   ")).toHaveLength(l.length);
  });
});

describe("dry run", () => {
  it("reports missing memories, tracks, sources and empty GOs", () => {
    const gos = [
      go("a", 1, [{ id: "x", kind: "light", ref: { sourceId: "g", itemId: "m1" } }]),
      go("b", 2, [{ id: "y", kind: "audio", ref: { sourceId: "d", itemId: "t9" } }]),
      go("c", 3, []),
      go("d", 4, [{ id: "z", kind: "light", ref: { sourceId: "gone", itemId: "m1" } }]),
    ];
    const r = dryRun(gos, {
      hasLight: (s, i) => s === "g" && i === "m1",
      hasAudio: () => false,
      sourceProblem: (s) => (s === "gone" ? "File non trovato" : null),
      hasProjectionItem: () => true,
      t: id,
    });
    expect(r.gos).toBe(4);
    expect(r.actions).toBe(3);
    expect(r.problems.map((p) => p.goId)).toEqual(["b", "c", "d"]);
    expect(r.problems[2].text).toBe("File non trovato");
  });
});

describe("changes made tonight", () => {
  it("finds and forgets them", () => {
    const base = [go("a", 1, [{ id: "x", kind: "light", ref: { sourceId: "g", itemId: "m1" } }])];
    const now = [go("a", 1, [{ id: "x", kind: "light", ref: { sourceId: "g", itemId: "m1" }, times: { fade: 9 } }]), go("n", 2, [])];
    expect(changedTonight(null, now)).toEqual([]);
    expect(changedTonight(base, now).map((g) => g.id)).toEqual(["a"]);
    const back = forgetTonight(base, now);
    expect(changedTonight(base, back)).toEqual([]);
    expect(back).toHaveLength(2);
  });
});

it("writes a plain-text report", () => {
  const txt = reportText({ title: "Serata" }, [{ at: 0, kind: "go", text: "GO 1", by: "primary" }], [{ id: "u", text: "Ok", done: true, origin: "user" }], id, (b) => b ?? "");
  expect(txt).toContain("Serata");
  expect(txt).toContain("[x] Ok");
  expect(txt).toContain("GO 1 · primary");
});
