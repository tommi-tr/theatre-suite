import { describe, expect, it } from "vitest";
import { cloneKeymap, DEFAULT_KEYMAP, findConflicts } from "../model/keys";
import { actionKeyText, doublePress, DOUBLE_PRESS_MS, showKeyAction } from "./keys";

const press = (key: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const km = DEFAULT_KEYMAP;

describe("Show keys", () => {
  it("reads the default keymap", () => {
    expect(showKeyAction(press(" "), km, false)).toBe("go");
    expect(showKeyAction(press("Backspace"), km, false)).toBe("back");
    expect(showKeyAction(press("b"), km, false)).toBe("blackout");
    expect(showKeyAction(press("e"), km, false)).toBe("emergency");
    expect(showKeyAction(press("Escape"), km, false)).toBe("stopAudio");
  });

  it("leaves the script keys to the script", () => {
    expect(showKeyAction(press("s"), km, false)).toBeNull();
    expect(showKeyAction(press("ArrowUp"), km, false)).toBeNull();
  });

  it("wants Ctrl L exactly", () => {
    expect(showKeyAction(press("l", { ctrlKey: true }), km, false)).toBe("lock");
    expect(showKeyAction(press("L", { ctrlKey: true, shiftKey: true }), km, false)).toBeNull();
    expect(showKeyAction(press("l", { ctrlKey: true, altKey: true }), km, false)).toBeNull();
    expect(showKeyAction(press("l"), km, false)).toBeNull();
    expect(showKeyAction(press("b", { ctrlKey: true }), km, false)).toBeNull();
  });

  it("accepts only the pedal (F13) while typing in a field", () => {
    expect(showKeyAction(press(" "), km, true)).toBeNull();
    expect(showKeyAction(press("b"), km, true)).toBeNull();
    expect(showKeyAction(press("F13"), km, true)).toBe("go");
    expect(showKeyAction(press("F13"), km, false)).toBe("go");
  });

  it("follows a changed keymap and its conflict check", () => {
    const mine = cloneKeymap(km);
    mine.go = ["Enter"];
    expect(showKeyAction(press("Enter"), mine, false)).toBe("go");
    expect(showKeyAction(press(" "), mine, false)).toBeNull();
    mine.pause = ["B"];
    expect(findConflicts(mine).map((c) => c.action).sort()).toEqual(["blackout", "pause"]);
  });

  it("writes the keys of the bottom bar", () => {
    expect(actionKeyText(km, "emergency")).toBe("E E");
    expect(actionKeyText(km, "lock")).toBe("Ctrl L");
    expect(actionKeyText(km, "stopAudio")).toBe("Esc");
  });
});

describe("E E: two presses within one second", () => {
  it("arms, then fires within the window", () => {
    const first = doublePress(null, 10_000);
    expect(first).toEqual({ fire: false, armedAt: 10_000 });
    expect(doublePress(first.armedAt, 10_000 + DOUBLE_PRESS_MS)).toEqual({ fire: true, armedAt: null });
  });
  it("arms again when too late, or when the clock went back", () => {
    expect(doublePress(10_000, 11_001)).toEqual({ fire: false, armedAt: 11_001 });
    expect(doublePress(10_000, 9_500)).toEqual({ fire: false, armedAt: 9_500 });
  });
});
