import { describe, expect, it } from "vitest";
import { hasRaisedFaders } from "./deskRaised";
import { docWith, light } from "./testkit";

describe("hasRaisedFaders", () => {
  const doc = docWith([light("l1", "parRgb", 1), light("l2", "pc", 4, { unused: true })]);
  it("is false for a desk at zero and for lights not used", () => {
    expect(hasRaisedFaders(doc, {})).toBe(false);
    expect(hasRaisedFaders(doc, { l1: [0, 0, 0], l2: [255] })).toBe(false);
  });
  it("is true as soon as a used light has a fader up", () => {
    expect(hasRaisedFaders(doc, { l1: [0, 0, 1] })).toBe(true);
  });
});
