import { describe, expect, it } from "vitest";
import { engineLayout, fadePayload, intensityMask, memoryFadePayload, memoryTarget } from "./enginePayload";
import { crossfadeAt, layoutOf } from "./crossfade";
import { docWith, light } from "./testkit";
import type { Group, Memory } from "./types";

const group = (id: string, fixtureIds: string[], level: number): Group => ({ id, name: id, fixtureIds, level });

// PC at 1, RGB PAR at 2–4, wash mover at 10–20 (pan 10, …, dimmer 15, …), unused PC at 30, smoke at 40.
const doc = docWith(
  [light("pc", "pc", 1), light("par", "parRgb", 2), light("m", "washMover", 10), light("u", "pc", 30, { unused: true }), light("s", "smoke", 40)],
  { groups: [group("g", ["pc"], 128)] },
);

const memory = (dmx: Record<number, number>, transition: Partial<Memory["transition"]> = {}): Pick<Memory, "state" | "transition"> => {
  const values = new Array<number>(512).fill(0);
  for (const [ch, v] of Object.entries(dmx)) values[Number(ch) - 1] = v;
  return { state: { binding: "address", dmx: values }, transition: { fadeIn: 3, fadeOut: 2, delay: 1, autoFollow: false, moveInDark: true, ...transition } };
};

describe("engine payload", () => {
  it("describes every channel for the engine as plain arrays", () => {
    const l = engineLayout(doc);
    expect(l.intensity).toHaveLength(512);
    expect(l.mover).toHaveLength(512);
    expect(l.intensity[0]).toBe(1); // PC Main
    expect(l.intensity.slice(1, 4)).toEqual([1, 1, 1]); // PAR without Main: colours are intensity
    expect(l.intensity.slice(9, 20)).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]); // the mover: only its Main
    expect(l.moverIntensity).toEqual([[14]]);
    expect(l.mover[9]).toBe(0);
    expect(l.mover[14]).toBe(-1);
    expect(l.intensity[29]).toBe(1); // unused light: like a channel of no light
    expect(JSON.parse(JSON.stringify(l))).toEqual(l);
  });

  it("gives the output master the intensity channels of the used lights only", () => {
    const m = intensityMask(doc);
    expect(m).toHaveLength(512);
    expect(m[0]).toBe(1);
    expect(m.slice(1, 4)).toEqual([1, 1, 1]);
    expect(m.slice(9, 20)).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    expect(m[29]).toBe(0); // unused
    expect(m[39]).toBe(0); // smoke is never scaled
    expect(m[400]).toBe(0); // channel of no light
  });

  it("applies the groups to the target, not the Grand Master", () => {
    const t = memoryTarget(doc, memory({ 1: 200, 2: 255, 15: 255 }));
    expect(t[0]).toBe(100); // the group at 128
    expect(t[1]).toBe(255);
    expect(t[14]).toBe(255);
  });

  it("builds the GO of a memory with its own transition", () => {
    const p = memoryFadePayload(doc, memory({ 1: 200, 10: 77 }, { fadeIn: -1 }));
    expect(p.target).toHaveLength(512);
    expect(p.target[0]).toBe(100);
    expect(p.target[9]).toBe(77);
    expect(p.transition).toEqual({ fadeIn: 0, fadeOut: 2, delay: 1, moveInDark: true });
    expect(p.layout).toEqual(engineLayout(doc));
  });

  it("is what crossfade.ts needs: the mover moves in the dark", () => {
    const p = fadePayload(doc, memoryTarget(doc, memory({ 10: 200, 15: 255 })), { fadeIn: 4, fadeOut: 2, delay: 0, moveInDark: true });
    const from = new Array<number>(512).fill(0);
    const out = crossfadeAt(from, p.target, 0, { ...p.transition, autoFollow: false }, layoutOf({ intensity: p.layout.intensity, mover: p.layout.mover, moverIntensity: p.layout.moverIntensity }));
    expect(out[9]).toBe(200); // the pan jumps while the head is dark
    expect(out[14]).toBe(0); // the Main has not risen yet
  });

  it("keeps targets inside 0–255 and 512 channels", () => {
    const p = fadePayload(doc, [300, -5, 12.6, ...new Array(600).fill(1)], { fadeIn: 1, fadeOut: 1, delay: 0, moveInDark: false });
    expect(p.target).toHaveLength(512);
    expect(p.target.slice(0, 3)).toEqual([255, 0, 13]);
  });
});
