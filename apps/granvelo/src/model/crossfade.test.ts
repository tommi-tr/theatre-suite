import { describe, expect, it } from "vitest";
import { crossfadeAt, fadeLayout, layoutOf, transitionDuration, transitionProgress, type FadeLayout } from "./crossfade";
import { docWith, light } from "./testkit";
import type { Transition } from "./types";

const tr = (p: Partial<Transition> = {}): Transition => ({ fadeIn: 0, fadeOut: 0, delay: 0, autoFollow: false, moveInDark: false, ...p });

/**
 * Reference vectors for the Rust engine of phase 1: copy them as they are.
 * Each vector: layout, from, to, transition, then [t, expected] pairs.
 * Layout of the "mover" vectors: channel 0 = Main of a moving head (intensity), 1 = its pan, 2 = its tilt,
 * 3 = an ordinary dimmer channel, 4 = a channel of no light (treated as intensity).
 */
interface Vector {
  name: string;
  layout: { intensity: number[]; mover?: number[]; moverIntensity?: number[][] };
  from: number[];
  to: number[];
  transition: Partial<Transition>;
  samples: [number, number[]][];
}

const MOVER = { intensity: [1, 0, 0, 1, 1], mover: [-1, 0, 0, -1, -1], moverIntensity: [[0]] };

export const VECTORS: Vector[] = [
  {
    name: "same time up and down",
    layout: { intensity: [1, 1] },
    from: [0, 255],
    to: [255, 0],
    transition: { fadeIn: 2, fadeOut: 2 },
    samples: [
      [-1, [0, 255]],
      [0, [0, 255]],
      [0.5, [64, 191]],
      [1, [128, 128]],
      [2, [255, 0]],
      [10, [255, 0]],
    ],
  },
  {
    name: "separate fade in and fade out",
    layout: { intensity: [1, 1, 1] },
    from: [0, 200, 100],
    to: [255, 0, 100],
    transition: { fadeIn: 4, fadeOut: 1 },
    samples: [
      [0.5, [32, 100, 100]],
      [1, [64, 0, 100]],
      [2, [128, 0, 100]],
      [4, [255, 0, 100]],
    ],
  },
  {
    name: "delay holds everything, then the fades start",
    layout: { intensity: [1, 1] },
    from: [10, 250],
    to: [250, 10],
    transition: { fadeIn: 2, fadeOut: 4, delay: 1.5 },
    samples: [
      [0, [10, 250]],
      [1.5, [10, 250]],
      [2.5, [130, 190]],
      [3.5, [250, 130]],
      [5.5, [250, 10]],
    ],
  },
  {
    name: "zero times jump at the delay",
    layout: { intensity: [1, 0] },
    from: [0, 0],
    to: [255, 77],
    transition: { delay: 2 },
    samples: [
      [1.999, [0, 0]],
      [2, [255, 77]],
    ],
  },
  {
    name: "non-intensity channels move with the fade-in time even when their value falls",
    layout: { intensity: [1, 0] },
    from: [255, 200],
    to: [0, 0],
    transition: { fadeIn: 4, fadeOut: 1 },
    samples: [
      [1, [0, 150]],
      [2, [0, 100]],
      [4, [0, 0]],
    ],
  },
  {
    name: "move in dark: a dark moving head jumps to its new position at the start",
    layout: MOVER,
    from: [0, 0, 0, 0, 0],
    to: [255, 200, 100, 255, 255],
    transition: { fadeIn: 4, fadeOut: 2, moveInDark: true },
    samples: [
      [0, [0, 200, 100, 0, 0]],
      [2, [128, 200, 100, 128, 128]],
      [4, [255, 200, 100, 255, 255]],
    ],
  },
  {
    name: "move in dark: a lit moving head that goes dark moves only after it has faded out",
    layout: MOVER,
    from: [255, 50, 60, 0, 0],
    to: [0, 250, 160, 0, 0],
    transition: { fadeIn: 4, fadeOut: 2, delay: 1, moveInDark: true },
    samples: [
      [1, [255, 50, 60, 0, 0]],
      [2, [128, 50, 60, 0, 0]],
      [2.999, [0, 50, 60, 0, 0]],
      [3, [0, 250, 160, 0, 0]],
    ],
  },
  {
    name: "move in dark: lit at both ends, it moves in view with the fade-in time",
    layout: MOVER,
    from: [255, 0, 0, 0, 0],
    to: [128, 200, 100, 0, 0],
    transition: { fadeIn: 4, fadeOut: 2, moveInDark: true },
    samples: [
      [1, [192, 50, 25, 0, 0]],
      [2, [128, 100, 50, 0, 0]],
      [4, [128, 200, 100, 0, 0]],
    ],
  },
  {
    name: "without move in dark a dark moving head moves in the fade-in time",
    layout: MOVER,
    from: [0, 0, 0, 0, 0],
    to: [255, 200, 100, 0, 0],
    transition: { fadeIn: 4, fadeOut: 2, moveInDark: false },
    samples: [
      [0, [0, 0, 0, 0, 0]],
      [2, [128, 100, 50, 0, 0]],
    ],
  },
];

describe("crossfade reference vectors (to be mirrored by the Rust engine)", () => {
  for (const v of VECTORS) {
    it(v.name, () => {
      const layout = layoutOf(v.layout);
      for (const [t, expected] of v.samples) expect(Array.from(crossfadeAt(v.from, v.to, t, tr(v.transition), layout)), `t = ${t}`).toEqual(expected);
    });
  }
});

describe("crossfade", () => {
  it("rounds half up with floor(x + 0.5)", () => {
    const l = layoutOf({ intensity: [1] });
    // 0 → 1 in 2 s: at 1 s the exact value is 0.5 → 1
    expect(crossfadeAt([0], [1], 1, tr({ fadeIn: 2 }), l)[0]).toBe(1);
    // 1 → 0 in 2 s: at 1 s the exact value is 0.5 → 1 (floor(0.5 + 0.5))
    expect(crossfadeAt([1], [0], 1, tr({ fadeOut: 2 }), l)[0]).toBe(1);
  });

  it("is exactly the target at the end and the source before the start", () => {
    const from = Array.from({ length: 512 }, (_, i) => i % 256);
    const to = Array.from({ length: 512 }, (_, i) => 255 - (i % 256));
    const l = layoutOf({ intensity: new Array(512).fill(1) });
    const t = tr({ fadeIn: 3, fadeOut: 5, delay: 1 });
    expect(Array.from(crossfadeAt(from, to, transitionDuration(t), t, l))).toEqual(to);
    expect(Array.from(crossfadeAt(from, to, 0.99, t, l))).toEqual(from);
  });

  it("knows how long a transition lasts and how far it is", () => {
    const t = tr({ fadeIn: 3, fadeOut: 5, delay: 1 });
    expect(transitionDuration(t)).toBe(6);
    expect(transitionProgress(3, t)).toBe(0.5);
    expect(transitionProgress(12, t)).toBe(1);
    expect(transitionProgress(0, tr())).toBe(1);
  });
});

describe("fade layout of a document", () => {
  it("marks intensity channels, moving heads and unknown channels", () => {
    const doc = docWith([light("pc", "pc", 1), light("par", "parRgb", 2), light("m", "washMover", 10), light("u", "pc", 30, { unused: true })]);
    const l: FadeLayout = fadeLayout(doc);
    expect(l.intensity[0]).toBe(1); // PC Main
    expect(Array.from(l.intensity.slice(1, 4))).toEqual([1, 1, 1]); // PAR without Main: colours are intensity
    expect(Array.from(l.intensity.slice(9, 20))).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]); // mover: only its Main
    expect(l.intensity[29]).toBe(1); // unused light: like a channel of no light
    expect(l.intensity[400]).toBe(1);
    expect(l.moverIntensity).toEqual([[14]]);
    expect(Array.from(l.mover.slice(9, 20))).toEqual([0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0]);
    expect(l.mover[0]).toBe(-1);
  });
});
