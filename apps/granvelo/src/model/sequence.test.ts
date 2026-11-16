import { describe, expect, it } from "vitest";
import { cleanTime, moveInSequence, sequenceMemories, setCrossfade, setInSequence, setTransition } from "./sequence";
import { demoDoc } from "./demo";

describe("sequence", () => {
  it("moves a memory earlier or later, within the edges", () => {
    const doc = demoDoc();
    const [a, b, c] = doc.sequence;
    const moved = moveInSequence(doc, b, -1);
    expect(moved.sequence.slice(0, 3)).toEqual([b, a, c]);
    expect(moveInSequence(doc, a, -1)).toBe(doc);
    expect(moveInSequence(doc, a, 0)).toBe(doc);
    const last = doc.sequence[doc.sequence.length - 1];
    expect(moveInSequence(doc, last, 5)).toBe(doc);
    expect(moveInSequence(doc, a, 100).sequence.at(-1)).toBe(a);
    expect(moveInSequence(doc, "nope", 1)).toBe(doc);
  });

  it("takes a memory out of the sequence and puts it back", () => {
    const doc = demoDoc();
    const id = doc.sequence[2];
    const out = setInSequence(doc, id, false);
    expect(out.sequence).not.toContain(id);
    expect(out.memories).toHaveLength(doc.memories.length);
    expect(sequenceMemories(out).map((m) => m.id)).toEqual(out.sequence);
    expect(setInSequence(out, id, true, 2).sequence).toEqual(doc.sequence);
    expect(setInSequence(out, id, true).sequence.at(-1)).toBe(id);
    expect(setInSequence(doc, id, true)).toBe(doc);
    expect(setInSequence(doc, "nope", true)).toBe(doc);
  });

  it("edits a transition with clean times", () => {
    const doc = demoDoc();
    const id = doc.memories[0].id;
    const d = setTransition(doc, id, { fadeIn: 2.345, fadeOut: -4, delay: NaN, autoFollow: true });
    const t = d.memories[0].transition;
    expect(t.fadeIn).toBe(2.3);
    expect(t.fadeOut).toBe(0);
    expect(t.delay).toBe(doc.memories[0].transition.delay);
    expect(t.autoFollow).toBe(true);
    expect(setTransition(d, id, { autoFollow: true })).toBe(d);
    expect(setCrossfade(d, id, 7).memories[0].transition).toMatchObject({ fadeIn: 7, fadeOut: 7 });
    expect(cleanTime(10_000)).toBe(600);
    expect(cleanTime("x", 3)).toBe(3);
  });
});
