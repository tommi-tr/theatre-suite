import { describe, expect, it } from "vitest";
import { reliabilityTest, SLOW_FRAME_MS } from "./reliability";
import { demoDoc } from "./demo";
import { setTransition } from "./sequence";
import type { GranveloDoc } from "./types";

const kinds = (doc: GranveloDoc, clock?: () => number) => reliabilityTest(doc, clock).findings.map((f) => f.kind);

describe("reliability test", () => {
  it("plays the whole demo sequence with no anomaly", () => {
    const doc = demoDoc();
    const r = reliabilityTest(doc);
    expect(r.memories).toBe(doc.sequence.length);
    expect(r.transitions).toBe(doc.sequence.length);
    expect(r.frames).toBeGreaterThan(r.showSeconds * 39);
    expect(r.findings.filter((f) => f.level === "stop")).toEqual([]);
    expect(r.level).not.toBe("stop");
  });

  it("reports an empty sequence", () => {
    const doc = { ...demoDoc(), sequence: [] };
    const r = reliabilityTest(doc);
    expect(r.findings.map((f) => f.kind)).toContain("emptySequence");
    expect(r.frames).toBe(0);
  });

  it("reports memories with no light, values out of range, and 'starts by itself' on the last memory", () => {
    const doc = demoDoc();
    const first = doc.memories.find((m) => m.id === doc.sequence[0])!;
    const last = doc.sequence[doc.sequence.length - 1];
    const dark = { binding: "address" as const, dmx: new Array<number>(512).fill(0) };
    const bad = { binding: "address" as const, dmx: [...new Array<number>(511).fill(0), 300] };
    let d: GranveloDoc = { ...doc, memories: doc.memories.map((m) => (m.id === first.id ? { ...m, state: dark } : m.id === doc.sequence[1] ? { ...m, state: bad } : m)) };
    d = setTransition(d, last, { autoFollow: true, fadeIn: 90 });
    const r = reliabilityTest(d);
    const k = r.findings.map((f) => f.kind);
    expect(k).toEqual(expect.arrayContaining(["emptyMemory", "badValues", "autoFollowLast", "longTransition"]));
    expect(r.level).toBe("stop");
  });

  it("reports address conflicts and lights without an address", () => {
    const doc = demoDoc();
    const [a, b] = doc.fixtures.filter((f) => !f.unused);
    const d = { ...doc, fixtures: doc.fixtures.map((f) => (f.id === b.id ? { ...f, address: a.address } : f.id === a.id ? f : f)) };
    expect(kinds(d)).toContain("conflicts");
    const n = { ...doc, fixtures: doc.fixtures.map((f) => (f.id === a.id ? { ...f, address: null } : f)) };
    expect(kinds(n)).toContain("noAddress");
  });

  it("reports a slow computer", () => {
    let t = 0;
    const slowClock = () => (t += SLOW_FRAME_MS + 1);
    expect(kinds(demoDoc(), slowClock)).toContain("slowFrames");
  });
});
