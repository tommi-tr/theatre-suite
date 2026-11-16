import { describe, expect, it } from "vitest";
import { addressProblems } from "../../model/addresses";
import { docWith, light } from "../../model/testkit";
import { clickLight, hasRoom, numberedInRun, startNumbering, undoLast } from "./numbering";

const doc = () => docWith([light("f1", "pc", 1), light("f2", "parRgbw", 2), light("f3", "pc", 3), light("f4", "parRgb", null)]);
const addr = (d: ReturnType<typeof doc>) => d.fixtures.map((f) => f.address);

describe("numbering by clicking", () => {
  it("starts at the chosen address (kept between 1 and 512)", () => {
    expect(startNumbering(21)).toEqual({ next: 21, steps: [] });
    expect(startNumbering(0).next).toBe(1);
    expect(startNumbering(900).next).toBe(512);
    expect(startNumbering(Number.NaN).next).toBe(1);
  });

  it("each click gives the next address, by the channels of the previous light", () => {
    let d = doc();
    let s = startNumbering(21);
    const a = clickLight(d, s, "f2");
    expect(a.result).toEqual({ kind: "assigned", address: 21 });
    expect(a.state.next).toBe(25);
    const b = clickLight(a.doc, a.state, "f1");
    expect(b.result).toEqual({ kind: "assigned", address: 25 });
    const c = clickLight(b.doc, b.state, "f4");
    expect(c.result).toEqual({ kind: "assigned", address: 26 });
    d = c.doc;
    s = c.state;
    expect(addr(d)).toEqual([25, 21, 3, 26]);
    expect(s.next).toBe(29);
    expect([...numberedInRun(s)]).toEqual([
      ["f2", 21],
      ["f1", 25],
      ["f4", 26],
    ]);
  });

  it("allows conflicts with lights not renumbered yet (they show in the list), and the others are never touched", () => {
    const d0 = doc();
    const r = clickLight(d0, startNumbering(2), "f1"); // lands on the channels of f2
    expect(r.doc.fixtures[0].address).toBe(2);
    expect(addressProblems(r.doc).conflicts.has("f1")).toBe(true);
    expect(addressProblems(r.doc).conflicts.has("f2")).toBe(true);
    expect(r.doc.fixtures.slice(1)).toEqual(d0.fixtures.slice(1));
  });

  it("a light clicked twice in one run is not changed again", () => {
    const a = clickLight(doc(), startNumbering(10), "f1");
    const again = clickLight(a.doc, a.state, "f1");
    expect(again.result).toEqual({ kind: "already" });
    expect(again.doc).toBe(a.doc);
    expect(again.state).toBe(a.state);
  });

  it("refuses a light that would not fit before 512, and unknown ones", () => {
    const d = doc();
    const s = startNumbering(510);
    const r = clickLight(d, s, "f2"); // 4 channels
    expect(r.result).toEqual({ kind: "noRoom" });
    expect(r.doc).toBe(d);
    expect(hasRoom(s, 4)).toBe(false);
    expect(hasRoom(s, 3)).toBe(true);
    expect(clickLight(d, s, "nope").result).toEqual({ kind: "missing" });
    // a single channel light still fits at 512
    expect(clickLight(d, startNumbering(512), "f1").result).toEqual({ kind: "assigned", address: 512 });
  });

  it("takes back the last click: old address and next address come back", () => {
    const d0 = doc();
    const a = clickLight(d0, startNumbering(30), "f4"); // had none
    const b = clickLight(a.doc, a.state, "f1"); // had 1
    const u1 = undoLast(b.doc, b.state);
    expect(u1.undone).toBe("f1");
    expect(u1.doc.fixtures[0].address).toBe(1);
    expect(u1.state.next).toBe(33);
    const u2 = undoLast(u1.doc, u1.state);
    expect(u2.undone).toBe("f4");
    expect(u2.doc.fixtures[3].address).toBeNull();
    expect(u2.state).toEqual(startNumbering(30));
    expect(u2.doc).toEqual(d0);
    const u3 = undoLast(u2.doc, u2.state);
    expect(u3.undone).toBeNull();
    expect(u3.doc).toBe(u2.doc);
  });

  it("after a take-back the same light can be clicked again", () => {
    const a = clickLight(doc(), startNumbering(10), "f1");
    const u = undoLast(a.doc, a.state);
    expect(clickLight(u.doc, u.state, "f1").result).toEqual({ kind: "assigned", address: 10 });
  });
});
