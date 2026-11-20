import { describe, expect, it } from "vitest";
import { parseShow, newShow, serializeShow, type Projection, type ProjectionItem } from "./show";
import {
  colorFilter,
  effectiveColor,
  isNeutral,
  moveItem,
  nextItem,
  NEUTRAL,
  removeItem,
  resetItemColor,
  setColorValue,
  stepTarget,
  temperatureGains,
  transitionTimeline,
  usedParts,
  partsToDrop,
  withTransitionKind,
} from "./projection";

const item = (id: string, extra: Partial<ProjectionItem> = {}): ProjectionItem => ({ id, kind: "image", name: id, part: `images/${id}.png`, transition: { kind: "cut" }, ...extra });
const proj = (items: ProjectionItem[], extra: Partial<Projection> = {}): Projection => ({ blank: { kind: "black" }, screen: null, items, ...extra });
const items = [item("a"), item("b"), item("c")];

describe("sequence", () => {
  it("steps forward and back, stopping at the ends", () => {
    expect(stepTarget(items, "a", "next")?.id).toBe("b");
    expect(stepTarget(items, "c", "next")).toBeNull();
    expect(stepTarget(items, "b", "previous")?.id).toBe("a");
    expect(stepTarget(items, "a", "previous")).toBeNull();
  });
  it("starts from the first item when nothing is on screen", () => {
    expect(stepTarget(items, null, "next")?.id).toBe("a");
    expect(stepTarget(items, null, "previous")).toBeNull();
    expect(stepTarget(items, "gone", "next")?.id).toBe("a");
    expect(nextItem(items, "b")?.id).toBe("c");
  });
  it("reorders and removes", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(removeItem(proj(items), "b").items.map((i) => i.id)).toEqual(["a", "c"]);
  });
  it("lists the parts in use", () => {
    const p = proj([item("a", { thumb: "thumbs/a.jpg" }), item("v", { kind: "video", part: undefined, path: "video/v.mp4" })], { blank: { kind: "image", part: "images/blank.png" } });
    expect([...usedParts(p)].sort()).toEqual(["images/a.png", "images/blank.png", "thumbs/a.jpg"]);
  });
});

describe("transitions", () => {
  it("has no time for a cut", () => {
    expect(transitionTimeline({ kind: "cut" })).toEqual({ outMs: 0, inMs: 0, inDelayMs: 0, totalMs: 0 });
  });
  it("dissolves over the whole duration, the old image staying under it", () => {
    expect(transitionTimeline({ kind: "dissolve", seconds: 2 })).toEqual({ outMs: 0, inMs: 2000, inDelayMs: 0, totalMs: 2000 });
  });
  it("goes through black in two halves", () => {
    expect(transitionTimeline({ kind: "throughBlack", seconds: 1.5 })).toEqual({ outMs: 750, inMs: 750, inDelayMs: 750, totalMs: 1500 });
  });
  it("keeps the duration when the kind changes and gives a default coming from a cut", () => {
    expect(withTransitionKind({ kind: "dissolve", seconds: 3 }, "throughBlack")).toEqual({ kind: "throughBlack", seconds: 3 });
    expect(withTransitionKind({ kind: "cut" }, "dissolve")).toEqual({ kind: "dissolve", seconds: 1.5 });
    expect(withTransitionKind({ kind: "dissolve", seconds: 3 }, "cut")).toEqual({ kind: "cut" });
  });
});

describe("colour: Tutti and Questo", () => {
  it("Tutti applies to every item without its own colour", () => {
    const p = setColorValue(proj(items), "all", "saturation", -15);
    expect(effectiveColor(p, p.items[0]).saturation).toBe(-15);
    expect(effectiveColor(p, p.items[2]).saturation).toBe(-15);
  });
  it("Questo changes one item only, starting from Tutti", () => {
    let p = setColorValue(proj(items), "all", "contrast", 5);
    p = setColorValue(p, "b", "saturation", -15);
    expect(effectiveColor(p, p.items[1])).toEqual({ brightness: 0, contrast: 5, temperature: 0, saturation: -15 });
    expect(effectiveColor(p, p.items[0])).toEqual({ brightness: 0, contrast: 5, temperature: 0, saturation: 0 });
  });
  it("resets one item to follow Tutti and drops a neutral Tutti", () => {
    let p = setColorValue(proj(items), "b", "brightness", 20);
    p = resetItemColor(p, "b");
    expect(p.items[1].color).toBeUndefined();
    p = setColorValue(setColorValue(p, "all", "brightness", 10), "all", "brightness", 0);
    expect(p.color).toBeUndefined();
  });
  it("clamps values", () => {
    expect(setColorValue(proj(items), "all", "brightness", 400).color?.brightness).toBe(100);
    expect(setColorValue(proj(items), "all", "brightness", -400).color?.brightness).toBe(-100);
  });
  it("builds the CSS filter", () => {
    expect(colorFilter(NEUTRAL, "x")).toBe("none");
    expect(colorFilter({ brightness: 10, contrast: -20, temperature: 30, saturation: 0 }, "t1")).toBe("brightness(1.100) contrast(0.800) url(#t1)");
    expect(isNeutral(NEUTRAL)).toBe(true);
  });
  it("warms with more red and less blue", () => {
    const w = temperatureGains(100);
    expect(w.r).toBeGreaterThan(1);
    expect(w.b).toBeLessThan(1);
    expect(temperatureGains(-100).b).toBeGreaterThan(1);
    expect(temperatureGains(0)).toEqual({ r: 1, b: 1 });
  });
});

describe("show.json", () => {
  it("keeps the projection fields through a save and read", () => {
    const show = newShow("T", () => "id1");
    show.projection = proj([item("a", { color: { brightness: 5, contrast: 0, temperature: -10, saturation: 0 }, atEnd: "loop", transition: { kind: "dissolve", seconds: 2 } })], { color: { brightness: 0, contrast: 3, temperature: 0, saturation: 0 } });
    const back = parseShow(serializeShow(show, { name: "Cue", version: "0.5.0" }));
    expect(back.projection).toEqual(show.projection);
  });
  it("repairs odd values", () => {
    const raw = JSON.stringify({ format: "theatre.cue", formatVersion: 1, projection: { items: [{ id: "x", kind: "weird", name: 3, transition: { kind: "wipe" }, color: { brightness: 900 }, atEnd: "next" }] } });
    const p = parseShow(raw).projection.items[0];
    expect(p.kind).toBe("image");
    expect(p.transition).toEqual({ kind: "cut" });
    expect(p.color?.brightness).toBe(100);
    expect(p.atEnd).toBe("hold");
  });
});

describe("cleaning the pictures no longer used", () => {
  it("drops picture parts that no projection (now or in undo) uses, and nothing else", () => {
    const now = proj([item("a", { thumb: "thumbs/a.jpg" })]);
    const undo = proj([item("b")]);
    const file = ["script.pdf", "images/a.png", "thumbs/a.jpg", "images/b.png", "images/c.png", "thumbs/c.jpg"];
    expect(partsToDrop(file, [now, undo]).sort()).toEqual(["images/c.png", "thumbs/c.jpg"]);
    expect(partsToDrop(file, [now])).toContain("images/b.png");
  });
});

