import { describe, expect, it } from "vitest";
import { DEMO_GOS, DEMO_SOURCES, putDemoSources } from "./demoShow";
import { loadLibrary } from "./sources";
import { msText, silentGoTest, silentOutputs, summarize } from "./reliability";

const SHOW = "C:\\Spettacoli\\La locandiera\\Serata.tcue";

describe("reliability test (Settings → Test)", () => {
  it("gives 200 GOs in silence through the whole show, starting again at the end", async () => {
    putDemoSources();
    const library = await loadLibrary(DEMO_SOURCES, SHOW);
    let clock = 0;
    const progress: number[] = [];
    const r = await silentGoTest(DEMO_GOS, library, { count: 200, now: () => (clock += 0.25), pause: async () => {}, onProgress: (n) => progress.push(n) });
    expect(r.gos).toBe(200);
    expect(r.errors).toBe(0);
    expect(r.laps).toBeGreaterThanOrEqual(Math.floor(200 / DEMO_GOS.length) - 1);
    expect(r.meanMs).toBeCloseTo(0.25, 5);
    expect(r.ok).toBe(true);
    expect(progress[progress.length - 1]).toBe(200);
  });

  it("really runs: a real clock stays well within the limits", async () => {
    putDemoSources();
    const library = await loadLibrary(DEMO_SOURCES, SHOW);
    const r = await silentGoTest(DEMO_GOS, library, { count: 200, pause: async () => {} });
    expect(r.gos).toBe(200);
    expect(r.maxMs).toBeLessThan(200);
  });

  it("sends nothing: the silent outputs only count", async () => {
    const o = silentOutputs();
    await o.dmx.fadeTo({} as never);
    await o.audio.stopAll(true);
    expect(o.commands()).toBe(2);
    expect((await o.audio.state()).voices).toEqual([]);
  });

  it("summarizes mean, longest and the 95th GO, and says when it is slow", () => {
    const s = summarize([1, 2, 3, 4, 100], 0, 0, 0);
    expect(s.meanMs).toBe(22);
    expect(s.maxMs).toBe(100);
    expect(s.p95Ms).toBe(100);
    expect(s.ok).toBe(false);
    expect(summarize([], 0, 0, 0).ok).toBe(false);
    expect(msText(0.42, "it")).toBe("0,4");
    expect(msText(12.4, "en")).toBe("12");
  });
});
