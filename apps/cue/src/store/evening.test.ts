import { beforeEach, describe, expect, it } from "vitest";
import { eveningSnapshot, logEvent, markExported, resetEvening, restoreEvening, unexportedEntries, useEvening } from "./evening";

beforeEach(() => resetEvening());

describe("log of the evening on disk (autosave)", () => {
  it("goes into the autosave and comes back after a crash", () => {
    expect(eveningSnapshot()).toBeNull();
    logEvent("start", "Inizio");
    logEvent("go", "GO 1", "primary");
    const snap = JSON.parse(JSON.stringify(eveningSnapshot()));
    resetEvening();
    expect(restoreEvening(snap)).toBe(true);
    expect(useEvening.getState().log.map((e) => e.text)).toEqual(["Inizio", "GO 1"]);
    expect(restoreEvening({ nothing: true })).toBe(false);
  });

  it("asks at closing only for entries not exported yet", () => {
    logEvent("go", "GO 1");
    expect(unexportedEntries()).toBe(1);
    markExported();
    expect(unexportedEntries()).toBe(0);
    logEvent("go", "GO 2");
    expect(unexportedEntries()).toBe(1);
  });
});
