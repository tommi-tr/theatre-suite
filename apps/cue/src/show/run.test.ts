import { describe, expect, it } from "vitest";
import { initialState } from "../model/playback";
import { DEMO_GOS } from "../lib/demoShow";
import { followTarget, zoneAt } from "../script/follow";
import { clockText, reconcile, runningMs } from "./run";

describe("the evening", () => {
  it("keeps the standby when GOs are edited, and moves it when its GO is deleted", () => {
    const s = { ...initialState(DEMO_GOS), lastGoId: "go06", standbyId: "go07", history: ["go05", "go06"] };
    expect(reconcile(s, DEMO_GOS)).toBe(s);
    const without = DEMO_GOS.filter((g) => g.id !== "go07");
    expect(reconcile(s, without).standbyId).toBe("go08");
    const noLast = DEMO_GOS.filter((g) => g.id !== "go06");
    const r = reconcile(s, noLast);
    expect([r.lastGoId, r.standbyId, r.history]).toEqual(["go05", "go07", ["go05"]]);
  });

  it("counts the running time without the pauses", () => {
    expect(runningMs({ startedAt: null, pausedAt: null, pausedMs: 0 }, 5000)).toBe(0);
    expect(runningMs({ startedAt: 1000, pausedAt: null, pausedMs: 500 }, 11_000)).toBe(9500);
    expect(runningMs({ startedAt: 1000, pausedAt: 4000, pausedMs: 0 }, 99_000)).toBe(3000);
    expect(clockText(3_600_000 + 12 * 60_000 + 40_000)).toBe("1:12:40");
    expect(clockText(65_000)).toBe("1:05");
  });
});

describe("the script follows", () => {
  it("scrolls only when the standby is out of the comfortable part of the view", () => {
    expect(followTarget(400, 0, 1000)).toBeNull();
    expect(followTarget(1500, 0, 1000)).toBe(1200);
    expect(followTarget(50, 500, 1000)).toBe(0);
  });
  it("finds the speed zone of a height", () => {
    const zones = [
      { y: 100, speed: 0.5 },
      { y: 400, speed: 2 },
    ];
    expect(zoneAt(zones, 50)).toBe(1);
    expect(zoneAt(zones, 100)).toBe(0.5);
    expect(zoneAt(zones, 1000)).toBe(2);
  });
});
