import { describe, expect, it } from "vitest";
import {
  chordFromEvent,
  chordParts,
  cloneKeymap,
  DEFAULT_KEYMAP,
  findConflicts,
  keymapIsValid,
  KEY_ACTIONS,
  matchAction,
  normalizeKeymap,
  scopesOf,
  type Keymap,
} from "./keys";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("chords", () => {
  it("writes a key press the same way whatever the case", () => {
    expect(chordFromEvent(key("p"))).toBe("P");
    expect(chordFromEvent(key("P", { shiftKey: true }))).toBe("Shift+P");
    expect(chordFromEvent(key(" "))).toBe("Space");
    expect(chordFromEvent(key("l", { ctrlKey: true }))).toBe("Ctrl+L");
    expect(chordFromEvent(key("ArrowUp"))).toBe("ArrowUp");
    expect(chordFromEvent(key("F13"))).toBe("F13");
    expect(chordFromEvent(key("Control", { ctrlKey: true }))).toBeNull();
  });

  it("shows keys as on a key cap", () => {
    expect(chordParts("Ctrl+L")).toEqual(["Ctrl", "L"]);
    expect(chordParts("ArrowUp")).toEqual(["↑"]);
    expect(chordParts("Escape")).toEqual(["Esc"]);
    expect(chordParts("Space", "Spazio")).toEqual(["Spazio"]);
    expect(chordParts("Ctrl+,")).toEqual(["Ctrl", ","]);
  });
});

describe("the default keymap", () => {
  it("has every action, no conflict, and the keys of 13_cue.md", () => {
    for (const a of KEY_ACTIONS) expect(DEFAULT_KEYMAP[a.id].length).toBeGreaterThan(0);
    expect(findConflicts(DEFAULT_KEYMAP)).toEqual([]);
    expect(DEFAULT_KEYMAP).toMatchObject({ go: ["Space"], back: ["Backspace"], pause: ["P"], preset: ["Q"], blank: ["T"], blackout: ["B"], fadeToBlack: ["F"], emergency: ["E"], stopAudio: ["Escape"], reserve: ["C"], lock: ["Ctrl+L"], newGo: ["N"], note: ["K"] });
  });

  it("F13 is GO whatever the keymap says, on every screen", () => {
    const k = cloneKeymap(DEFAULT_KEYMAP);
    k.go = ["G"];
    expect(matchAction(k, "F13", "show")).toBe("go");
    expect(matchAction(k, "F13", "prepare")).toBe("go");
    expect(matchAction(k, "G", "show")).toBe("go");
    expect(matchAction(k, "Space", "show")).toBeNull();
  });

  it("keeps the Show keys out of Prepara and the Prepara keys out of Show", () => {
    expect(matchAction(DEFAULT_KEYMAP, "P", "show")).toBe("pause");
    expect(matchAction(DEFAULT_KEYMAP, "P", "prepare")).toBeNull();
    expect(matchAction(DEFAULT_KEYMAP, "N", "prepare")).toBe("newGo");
    expect(matchAction(DEFAULT_KEYMAP, "N", "show")).toBeNull();
    expect(matchAction(DEFAULT_KEYMAP, "ArrowUp", "show")).toBe("scrollUp");
    expect(matchAction(DEFAULT_KEYMAP, "ArrowUp", "prepare")).toBe("scrollUp");
  });
});

describe("conflicts", () => {
  const withKeys = (patch: Partial<Keymap>): Keymap => ({ ...cloneKeymap(DEFAULT_KEYMAP), ...patch });

  it("lists both sides of two actions on the same key", () => {
    const k = withKeys({ pause: ["B"] });
    expect(findConflicts(k)).toEqual(
      expect.arrayContaining([
        { action: "pause", chord: "B", other: "blackout" },
        { action: "blackout", chord: "B", other: "pause" },
      ]),
    );
    expect(keymapIsValid(k)).toBe(false);
  });

  it("a Show key and a script key conflict (both live in Show)", () => {
    expect(findConflicts(withKeys({ pause: ["W"] })).some((c) => c.action === "pause" && c.other === "scrollUp")).toBe(true);
  });

  it("a Show key and a Prepara key do not (never live together)", () => {
    expect(keymapIsValid(withKeys({ newGo: ["P"] }))).toBe(true);
    expect(keymapIsValid(withKeys({ note: ["Space"] }))).toBe(true);
  });

  it("a Prepara key and a script key conflict", () => {
    expect(keymapIsValid(withKeys({ newGo: ["A"] }))).toBe(false);
  });

  it("the pedal key and the keys of the app itself cannot be given to an action", () => {
    expect(findConflicts(withKeys({ blank: ["F13"] }))).toEqual([{ action: "blank", chord: "F13", other: null }]);
    expect(findConflicts(withKeys({ lock: ["Ctrl+S"] }))).toEqual([{ action: "lock", chord: "Ctrl+S", other: null }]);
  });

  it("the same key twice on one action is not a conflict", () => {
    expect(keymapIsValid(withKeys({ zoomIn: ["D", "D"] }))).toBe(true);
  });

  it("an action may be left without a key", () => {
    expect(keymapIsValid(withKeys({ lock: [] }))).toBe(true);
  });
});

describe("keymap read from the settings", () => {
  it("fills what is missing and drops what is wrong", () => {
    const k = normalizeKeymap({ pause: ["X"], blank: "T", lock: [], zoomIn: ["", 5, "D"], unknown: ["Z"], go: [] });
    expect(k.pause).toEqual(["X"]);
    expect(k.blank).toEqual(DEFAULT_KEYMAP.blank);
    expect(k.lock).toEqual([]);
    expect(k.zoomIn).toEqual(["D"]);
    expect(k.go).toEqual(["Space"]);
    expect("unknown" in k).toBe(false);
    expect(normalizeKeymap(null)).toEqual(DEFAULT_KEYMAP);
  });

  it("ignores a list with a key reserved by the app", () => {
    expect(normalizeKeymap({ pause: ["Ctrl+S"] }).pause).toEqual(["P"]);
  });

  it("scopes: GO keys in Show, N and K in Prepara, script keys in both", () => {
    expect(scopesOf("go")).toEqual(["show"]);
    expect(scopesOf("newGo")).toEqual(["prepare"]);
    expect(scopesOf("zoomIn")).toEqual(["show", "prepare"]);
  });
});
