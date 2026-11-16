import { describe, expect, it } from "vitest";
import { demoDoc } from "../model/demo";
import { hasColourChannels, stageLights, warmWhenDimmed } from "./scene";

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

describe("warm halogens (Alta)", () => {
  it("leaves a light at full level as it is and warms it as it dims", () => {
    expect(warmWhenDimmed("#FFD9A0", 1).toLowerCase()).toBe("#ffd9a0");
    const half = rgb(warmWhenDimmed("#FFD9A0", 0.5));
    const low = rgb(warmWhenDimmed("#FFD9A0", 0.05));
    // Less blue and green, red stays: more orange as it falls.
    expect(half[2]).toBeLessThan(0xa0);
    expect(low[2]).toBeLessThan(half[2]);
    expect(low[1]).toBeLessThan(half[1]);
    expect(low[0]).toBeGreaterThanOrEqual(half[0] - 1);
  });

  it("ignores what is not a colour", () => {
    expect(warmWhenDimmed("red", 0.2)).toBe("red");
  });

  it("warms only lights without colour channels, and only when asked", () => {
    const doc = demoDoc();
    const values = new Array(512).fill(0);
    for (const f of doc.fixtures) if (f.address !== null) f.channels.forEach((_, i) => (values[f.address! - 1 + i] = 70));
    const plain = stageLights(doc, values, [], false, false);
    const warm = stageLights(doc, values, [], false, true);
    let changed = 0;
    for (let i = 0; i < plain.length; i++) {
      const same = plain[i].light?.hue === warm[i].light?.hue;
      if (hasColourChannels(plain[i].f)) expect(same).toBe(true);
      else if (plain[i].light && !same) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });
});
