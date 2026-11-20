import { describe, expect, it } from "vitest";
import type { Action, AnchorPos, Go, GoAnchor } from "./gos";
import { AUDIO_H, AUDIO_MIN_H, BUTTON_H, draggedAudioHeight, goAtY, LAST_BOX_H, layoutTimeline, MIN_GAP, STOP_H } from "./timeline";

const at = (page: number, y: number): GoAnchor => ({ page, y, quote: "", before: "", after: "" });
const L = (id: string): Action => ({ id, kind: "light", ref: { sourceId: "g", itemId: id } });
const S = (id: string): Action => ({ id, kind: "audio", ref: { sourceId: "d", itemId: id } });
const V = (id: string): Action => ({ id, kind: "projection", projectionItemId: id });
const mk = (id: string, y: number, actions: Action[], page = 1): Go => ({ id, anchor: at(page, y), actions, givenBy: "both" });
/** 1000 px pages: y = 0.1 → 100 px. */
const toY = (a: AnchorPos) => (a.page - 1) * 1000 + a.y * 1000;

describe("buttons", () => {
  it("puts the line at half height of the button", () => {
    const t = layoutTimeline([mk("a", 0.1, [L("l1")])], { anchorToY: toY });
    expect(t.gos[0]).toMatchObject({ dotY: 100, buttonTop: 100 - BUTTON_H / 2, lineY: 100, offset: 0, curved: false });
  });

  it("pushes a button down when GOs are close, and curves its line", () => {
    const t = layoutTimeline([mk("a", 0.1, [L("l1")]), mk("b", 0.12, [S("s1")]), mk("c", 0.13, [S("s2")])], { anchorToY: toY });
    const [a, b, c] = t.gos;
    expect(b.buttonTop).toBe(a.buttonTop + BUTTON_H + MIN_GAP);
    expect(b.offset).toBe(b.buttonTop - (120 - 17));
    expect(b.curved).toBe(true);
    expect(c.buttonTop).toBe(b.buttonTop + BUTTON_H + MIN_GAP);
    expect(c.lineY).toBe(c.buttonTop + 17);
    // Buttons never overlap.
    for (let i = 1; i < t.gos.length; i++) expect(t.gos[i].buttonTop).toBeGreaterThanOrEqual(t.gos[i - 1].buttonTop + BUTTON_H + MIN_GAP);
  });

  it("does not push GOs that are far enough apart", () => {
    const t = layoutTimeline([mk("a", 0.1, [L("l1")]), mk("b", 0.14, [L("l2")])], { anchorToY: toY });
    expect(t.gos[1].offset).toBe(0);
  });

  it("follows script order across pages", () => {
    const t = layoutTimeline([mk("b", 0.1, [L("l2")], 2), mk("a", 0.9, [L("l1")], 1)], { anchorToY: toY });
    expect(t.gos.map((g) => [g.goId, g.index, g.dotY])).toEqual([
      ["a", 0, 900],
      ["b", 1, 1100],
    ]);
  });

  it("honours custom button height and gap", () => {
    const t = layoutTimeline([mk("a", 0.1, []), mk("b", 0.1, [])], { anchorToY: toY, buttonHeight: 20, minGap: 2 });
    expect(t.gos[1].buttonTop - t.gos[0].buttonTop).toBe(22);
  });
});

describe("boxes", () => {
  it("aligns every box of a GO to the top of its button", () => {
    const t = layoutTimeline([mk("a", 0.1, [L("l1"), S("s1"), V("v1")])], { anchorToY: toY });
    const g = t.gos[0];
    expect(g.boxes.map((b) => [b.column, b.top])).toEqual([
      ["lights", g.buttonTop],
      ["audio", g.buttonTop],
      ["video", g.buttonTop],
    ]);
    expect(g.lineEnd).toBe("video");
  });

  it("makes a light box last until the next light box", () => {
    const t = layoutTimeline([mk("a", 0.1, [L("l1")]), mk("b", 0.2, [S("s1")]), mk("c", 0.4, [L("l2")])], { anchorToY: toY, endY: 2000 });
    const l1 = t.gos[0].boxes[0];
    const l2 = t.gos[2].boxes[0];
    expect(l1.bottom).toBe(l2.top - 6);
    // The last one lasts until the end of the script.
    expect(l2.bottom).toBe(2000);
    expect(t.height).toBe(2000);
  });

  it("gives the last light box a default height without an end", () => {
    const t = layoutTimeline([mk("a", 0.1, [L("l1")])], { anchorToY: toY });
    expect(t.gos[0].boxes[0].height).toBe(LAST_BOX_H);
  });

  it("uses the audio height chosen by the user (default 72, at least 40)", () => {
    const gos = [mk("a", 0.1, [S("s1")]), mk("b", 0.5, [S("s2")]), mk("c", 0.8, [S("s3")])];
    const t = layoutTimeline(gos, { anchorToY: toY, audioHeights: { s2: 150, s3: 10 } });
    expect(t.gos.map((g) => g.boxes[0].height)).toEqual([AUDIO_H, 150, AUDIO_MIN_H]);
    expect(t.gos[0].boxes[0].resizable).toBe(true);
  });

  it("never lets an audio box reach into the next one", () => {
    const t = layoutTimeline([mk("a", 0.1, [S("s1")]), mk("b", 0.15, [S("s2")])], { anchorToY: toY, audioHeights: { s1: 300 } });
    expect(t.gos[0].boxes[0].bottom).toBe(t.gos[1].boxes[0].top - 6);
  });

  it("lets an audio box run past GOs of other columns", () => {
    const t = layoutTimeline([mk("a", 0.1, [S("s1")]), mk("b", 0.12, [L("l1")])], { anchorToY: toY, audioHeights: { s1: 200 } });
    expect(t.gos[0].boxes[0].height).toBe(200);
  });

  it("stacks several sounds of one GO and shows stops small", () => {
    const t = layoutTimeline([mk("a", 0.1, [S("s1"), S("s2"), { id: "x", kind: "audioStop" }])], { anchorToY: toY });
    const [b1, b2, b3] = t.gos[0].boxes;
    expect(b2.top).toBe(b1.bottom + 6);
    expect(b3.top).toBe(b2.bottom + 6);
    expect(b3.height).toBe(STOP_H);
    expect(b3.resizable).toBe(false);
    expect([b1.stack, b2.stack, b3.stack]).toEqual([0, 1, 2]);
  });

  it("squeezes a stack that does not fit before the next GO", () => {
    const t = layoutTimeline([mk("a", 0.1, [S("s1"), S("s2")]), mk("b", 0.18, [S("s3")])], { anchorToY: toY });
    const [b1, b2] = t.gos[0].boxes;
    expect(b2.bottom).toBeLessThanOrEqual(t.gos[1].boxes[0].top - 6 + 1e-9);
    expect(b1.height).toBeCloseTo(b2.height);
  });

  it("leaves out the columns with no actions", () => {
    expect(layoutTimeline([mk("a", 0.1, [L("l1")]), mk("b", 0.3, [V("v1")])], { anchorToY: toY }).columns).toEqual(["lights", "video"]);
    expect(layoutTimeline([mk("a", 0.1, [])], { anchorToY: toY }).columns).toEqual([]);
    expect(layoutTimeline([mk("a", 0.1, [])], { anchorToY: toY }).gos[0].lineEnd).toBeNull();
  });

  it("makes a video box last until the next video", () => {
    const t = layoutTimeline([mk("a", 0.1, [V("v1")]), mk("b", 0.3, [L("l1")]), mk("c", 0.6, [V("v2")])], { anchorToY: toY });
    expect(t.gos[0].boxes[0].bottom).toBe(t.gos[2].boxes[0].top - 6);
  });

  it("keeps a light box of a pushed GO at least as tall as the space to the next", () => {
    const t = layoutTimeline([mk("a", 0.1, [L("l1")]), mk("b", 0.101, [L("l2")])], { anchorToY: toY });
    expect(t.gos[0].boxes[0].height).toBe(BUTTON_H + MIN_GAP - 6);
  });
});

describe("helpers", () => {
  it("finds the GO under a point", () => {
    const t = layoutTimeline([mk("a", 0.1, [L("l1")]), mk("b", 0.5, [L("l2")])], { anchorToY: toY });
    expect(goAtY(t, 100)?.goId).toBe("a");
    expect(goAtY(t, 500)?.goId).toBe("b");
    expect(goAtY(t, 300)).toBeNull();
  });

  it("turns a drag of the handle into a height", () => {
    expect(draggedAudioHeight({ top: 100 }, 250.4)).toBe(150);
    expect(draggedAudioHeight({ top: 100 }, 110)).toBe(AUDIO_MIN_H);
  });
});
