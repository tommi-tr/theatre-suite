import { describe, expect, it } from "vitest";
import {
  actionDept,
  addAction,
  addGo,
  audioEngineTrackId,
  compareAnchors,
  dropAction,
  goDepts,
  itemActions,
  mainGoCount,
  mergeTarget,
  moveAction,
  moveGo,
  numberGos,
  removeAction,
  removeGo,
  setAuto,
  setGivenBy,
  setLabel,
  setNote,
  sortGos,
  updateAction,
  type Action,
  type Go,
  type GoAnchor,
} from "./gos";

const at = (page: number, y: number): GoAnchor => ({ page, y, quote: "", before: "", after: "" });
const light = (id: string, itemId: string): Action => ({ id, kind: "light", ref: { sourceId: "g", itemId } });
const sound = (id: string, itemId: string): Action => ({ id, kind: "audio", ref: { sourceId: "d", itemId } });
const mk = (id: string, page: number, y: number, actions: Action[] = [], extra: Partial<Go> = {}): Go => ({ id, anchor: at(page, y), actions, givenBy: "both", ...extra });

let n = 0;
const makeId = () => `new${++n}`;

describe("order", () => {
  it("follows page, then height, then across", () => {
    expect(compareAnchors({ page: 1, y: 0.9 }, { page: 2, y: 0.1 })).toBeLessThan(0);
    expect(compareAnchors({ page: 2, y: 0.5 }, { page: 2, y: 0.4 })).toBeGreaterThan(0);
    expect(compareAnchors({ page: 2, y: 0.5, x: 0.1 }, { page: 2, y: 0.5, x: 0.6 })).toBeLessThan(0);
  });

  it("sorts stably and returns the same array when already sorted", () => {
    const a = [mk("a", 1, 0.5), mk("b", 1, 0.5), mk("c", 2, 0)];
    expect(sortGos(a)).toBe(a);
    const b = [mk("c", 2, 0), mk("a", 1, 0.5), mk("b", 1, 0.5)];
    expect(sortGos(b).map((g) => g.id)).toEqual(["a", "b", "c"]);
  });
});

describe("numbering", () => {
  it("numbers GOs given by hand 1…N in script order", () => {
    const gos = [mk("c", 3, 0.2), mk("a", 1, 0.1), mk("b", 2, 0.5)];
    expect(numberGos(gos).map((x) => [x.id, x.text])).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
  });

  it("gives auto GOs the previous number plus a point", () => {
    const gos = [mk("a", 1, 0.1), mk("b", 1, 0.2, [], { auto: true }), mk("c", 1, 0.3, [], { auto: true }), mk("d", 1, 0.4)];
    expect(numberGos(gos).map((x) => x.text)).toEqual(["1", "1.1", "1.2", "2"]);
    expect(mainGoCount(gos)).toBe(2);
  });

  it("numbers an auto GO before the first one 0.1", () => {
    expect(numberGos([mk("a", 1, 0.1, [], { auto: true }), mk("b", 1, 0.2)]).map((x) => x.text)).toEqual(["0.1", "1"]);
  });

  it("shows a label without shifting the others", () => {
    const r = numberGos([mk("a", 1, 0.1), mk("b", 1, 0.2, [], { label: " 14.5 " }), mk("c", 1, 0.3)]);
    expect(r.map((x) => x.text)).toEqual(["1", "14.5", "3"]);
    expect(r[1].number).toBe("2");
  });
});

describe("merge", () => {
  const gos = [mk("a", 1, 0.1), mk("b", 1, 0.5)];

  it("finds a GO within the threshold (nominal 1000 px pages)", () => {
    expect(mergeTarget(gos, { page: 1, y: 0.108 })?.id).toBe("a");
    expect(mergeTarget(gos, { page: 1, y: 0.115 })).toBeNull();
    expect(mergeTarget(gos, { page: 1, y: 0.115 }, { thresholdPx: 20 })?.id).toBe("a");
  });

  it("measures with the script's own pixels when given", () => {
    const toY = (a: { page: number; y: number }) => (a.page - 1) * 800 + a.y * 800;
    // 0.012 of an 800 px page = 9.6 px: within 12 px.
    expect(mergeTarget(gos, { page: 1, y: 0.512 }, { toY })?.id).toBe("b");
    // Across the page break: page 2 top is near page 1 bottom.
    const g2 = [mk("z", 1, 0.995)];
    expect(mergeTarget(g2, { page: 2, y: 0.002 }, { toY })?.id).toBe("z");
  });

  it("chooses the nearest GO", () => {
    const close = [mk("a", 1, 0.1), mk("b", 1, 0.11)];
    expect(mergeTarget(close, { page: 1, y: 0.108 })?.id).toBe("b");
  });

  it("adds a dropped sound to a near light GO", () => {
    const r = dropAction([mk("a", 1, 0.1, [light("l1", "m1")])], at(1, 0.105), sound("s1", "t1"), { makeId });
    expect(r.merged).toBe(true);
    expect(r.goId).toBe("a");
    expect(r.gos[0].actions.map((x) => x.id)).toEqual(["l1", "s1"]);
  });

  it("makes a new GO when nothing is near, in script order", () => {
    const r = dropAction([mk("a", 1, 0.5, [light("l1", "m1")])], at(1, 0.2), sound("s1", "t1"), { makeId, auto: true });
    expect(r.merged).toBe(false);
    expect(r.gos.map((g) => g.id)).toEqual([r.goId, "a"]);
    expect(r.gos[0]).toMatchObject({ givenBy: "both", auto: true, actions: [{ id: "s1" }] });
  });

  it("replaces the light of a GO (one memory per GO)", () => {
    const r = dropAction([mk("a", 1, 0.1, [light("l1", "m1"), sound("s1", "t1")])], at(1, 0.1), light("l2", "m2"), { makeId });
    expect(r.result).toBe("replaced");
    expect(r.replaced?.id).toBe("l1");
    expect(r.gos[0].actions.map((x) => x.id)).toEqual(["l2", "s1"]);
  });

  it("ignores the same sound twice and the same memory twice", () => {
    const g = [mk("a", 1, 0.1, [light("l1", "m1"), sound("s1", "t1")])];
    expect(dropAction(g, at(1, 0.1), sound("s2", "t1"), { makeId }).result).toBe("duplicate");
    expect(dropAction(g, at(1, 0.1), light("l2", "m1"), { makeId }).result).toBe("duplicate");
  });

  it("keeps one projection or PowerPoint action per GO", () => {
    const g = [mk("a", 1, 0.1, [{ id: "p1", kind: "projection", projectionItemId: "img1" }])];
    const r = dropAction(g, at(1, 0.1), { id: "pp", kind: "powerpoint", powerpoint: "next" }, { makeId });
    expect(r.result).toBe("replaced");
    expect(r.gos[0].actions.map((x) => x.kind)).toEqual(["powerpoint"]);
  });

  it("keeps actions in column order", () => {
    const g = [mk("a", 1, 0.1, [sound("s1", "t1")])];
    const out = addAction(g, "a", light("l1", "m1"));
    expect(out[0].actions.map((x) => x.kind)).toEqual(["light", "audio"]);
  });
});

describe("editing", () => {
  const base = () => [mk("a", 1, 0.1, [light("l1", "m1"), sound("s1", "t1")], { unknownField: 7 } as Partial<Go>), mk("b", 2, 0.3, [sound("s2", "t2")])];

  it("removes and updates actions, keeping unknown fields", () => {
    let g = removeAction(base(), "a", "s1");
    expect(g[0].actions.map((x) => x.id)).toEqual(["l1"]);
    expect((g[0] as unknown as { unknownField: number }).unknownField).toBe(7);
    g = updateAction(g, "a", "l1", { times: { fade: 2 } });
    expect(g[0].actions[0]).toEqual({ id: "l1", kind: "light", ref: { sourceId: "g", itemId: "m1" }, times: { fade: 2 } });
  });

  it("returns the same list when nothing changes", () => {
    const g = base();
    expect(removeAction(g, "a", "nope")).toBe(g);
    expect(removeGo(g, "nope")).toBe(g);
    expect(setGivenBy(g, "a", "both")).toBe(g);
    expect(setAuto(g, "a", false)).toBe(g);
  });

  it("moves an action to another GO and drops the GO it leaves empty", () => {
    const g = moveAction(base(), "b", "s2", "a");
    expect(g.map((x) => x.id)).toEqual(["a"]);
    expect(g[0].actions.map((x) => x.id)).toEqual(["l1", "s1", "s2"]);
    const kept = moveAction(base(), "b", "s2", "a", false);
    expect(kept.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("moves a GO and re-sorts", () => {
    expect(moveGo(base(), "a", at(3, 0)).map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("sets who gives it, auto, note and label", () => {
    let g = setGivenBy(base(), "b", "secondary");
    expect(g[1].givenBy).toBe("secondary");
    g = setAuto(g, "b", true);
    expect(g[1].auto).toBe(true);
    g = setAuto(g, "b", false);
    expect("auto" in g[1]).toBe(false);
    g = setNote(setLabel(g, "a", " 3A "), "a", "Attenzione alla porta");
    expect(g[0]).toMatchObject({ label: "3A", note: "Attenzione alla porta" });
    g = setNote(setLabel(g, "a", ""), "a", " ");
    expect("label" in g[0] || "note" in g[0]).toBe(false);
  });

  it("adds an empty GO and removes a GO", () => {
    const r = addGo(base(), at(1, 0.5), makeId);
    expect(r.gos.map((x) => x.id)).toEqual(["a", r.goId, "b"]);
    expect(removeGo(r.gos, r.goId).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("departments and engine ids", () => {
  it("puts each action in its column", () => {
    expect(actionDept({ kind: "light" })).toBe("lights");
    expect(actionDept({ kind: "audioStop" })).toBe("audio");
    expect(actionDept({ kind: "powerpoint" })).toBe("video");
    expect(goDepts(mk("a", 1, 0, [sound("s", "t"), { id: "p", kind: "projection" }]))).toEqual(["audio", "video"]);
  });

  it("gives a changed sound its own engine copy", () => {
    expect(audioEngineTrackId({ id: "a1", kind: "audio", ref: { sourceId: "d", itemId: "t1" } })).toBe("t1");
    expect(audioEngineTrackId({ id: "a1", kind: "audio", ref: { sourceId: "d", itemId: "t1" }, levelDb: -3 })).toBe("t1#a1");
    expect(audioEngineTrackId({ id: "a1", kind: "audio", ref: { sourceId: "d", itemId: "t1" }, times: { fade: 2 } })).toBe("t1#a1");
    // A delay alone does not change the track.
    expect(audioEngineTrackId({ id: "a1", kind: "audio", ref: { sourceId: "d", itemId: "t1" }, times: { delay: 2 } })).toBe("t1");
  });

  it("lists the actions that point to items", () => {
    const g = [mk("a", 1, 0, [light("l", "m"), { id: "x", kind: "audioStop" }, { id: "y", kind: "audioStop", ref: { sourceId: "d", itemId: "t" } }])];
    expect(itemActions(g).map((x) => x.action.id)).toEqual(["l", "y"]);
  });
});
