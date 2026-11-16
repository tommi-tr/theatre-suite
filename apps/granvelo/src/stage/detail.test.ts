import { describe, expect, it } from "vitest";
import { HIGH_MAX_MS, MEDIUM_MAX_MS, levelForMs, picturesPerSecond, typicalMs } from "./detail";

describe("automatic detail", () => {
  it("takes the middle time and ignores the slowest tenth", () => {
    expect(typicalMs([10, 12, 11, 13, 12, 10, 11, 12, 11, 400])).toBeCloseTo(11, 5);
    expect(typicalMs([5])).toBe(5);
    expect(typicalMs([])).toBe(Infinity);
    expect(typicalMs([NaN, -1, 8])).toBe(8);
  });

  it("chooses the level from the time of one picture", () => {
    expect(levelForMs(4)).toBe("high");
    expect(levelForMs(HIGH_MAX_MS)).toBe("high");
    expect(levelForMs(HIGH_MAX_MS + 0.1)).toBe("medium");
    expect(levelForMs(MEDIUM_MAX_MS)).toBe("medium");
    expect(levelForMs(MEDIUM_MAX_MS + 1)).toBe("essential");
    expect(levelForMs(Infinity)).toBe("essential");
  });

  it("says pictures a second in whole numbers, at most 60", () => {
    expect(picturesPerSecond(20)).toBe(50);
    expect(picturesPerSecond(2)).toBe(60);
    expect(picturesPerSecond(Infinity)).toBe(0);
  });
});
