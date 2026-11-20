import { describe, expect, it } from "vitest";
import {
  bindingCaps,
  COMMAND_IDS,
  commandKeyText,
  conflictsOf,
  DEFAULT_KEYMAP,
  doublePress,
  DOUBLE_PRESS_MS,
  KEYS,
  keymapConflicts,
  matchCommand,
  normalizeKeymap,
  resolveKeymap,
  type CommandId,
  type KeyPress,
} from "./keys";

const SHOW: CommandId[] = ["go", "back", "pause", "preset", "blank", "blackout", "ftb", "emergency", "stopAudio", "reserve", "lock"];
const press = (code: string, mods: Partial<KeyPress> = {}): KeyPress => ({ code, key: "", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const km = DEFAULT_KEYMAP;

describe("matching keys", () => {
  it("finds the show commands of the default keymap", () => {
    expect(matchCommand(press("Space"), km, SHOW)?.id).toBe("go");
    expect(matchCommand(press("F13"), km, SHOW)?.id).toBe("go");
    expect(matchCommand(press("Backspace"), km, SHOW)?.id).toBe("back");
    expect(matchCommand(press("KeyB"), km, SHOW)?.id).toBe("blackout");
    expect(matchCommand(press("Escape"), km, SHOW)?.id).toBe("stopAudio");
    expect(matchCommand(press("KeyE"), km, SHOW)?.binding.double).toBe(true);
  });

  it("takes the space bar from `key` when `code` is empty", () => {
    expect(matchCommand(press("", { key: " " }), km, SHOW)?.id).toBe("go");
  });

  it("wants the modifiers exactly: Ctrl L is Lock, Ctrl Shift L and L alone are not", () => {
    expect(matchCommand(press("KeyL", { ctrlKey: true }), km, SHOW)?.id).toBe("lock");
    expect(matchCommand(press("KeyL", { ctrlKey: true, shiftKey: true }), km, SHOW)).toBeNull();
    expect(matchCommand(press("KeyL", { ctrlKey: true, altKey: true }), km, SHOW)).toBeNull();
    expect(matchCommand(press("KeyL"), km, SHOW)).toBeNull();
    // A letter with Ctrl is never the plain command.
    expect(matchCommand(press("KeyB", { ctrlKey: true }), km, SHOW)).toBeNull();
    expect(matchCommand(press("KeyP", { shiftKey: true }), km, SHOW)).toBeNull();
  });

  it("accepts only the pedal (F13) while typing in a field", () => {
    expect(matchCommand(press("Space"), km, SHOW, true)).toBeNull();
    expect(matchCommand(press("KeyB"), km, SHOW, true)).toBeNull();
    expect(matchCommand(press("Backspace"), km, SHOW, true)).toBeNull();
    expect(matchCommand(press("F13"), km, SHOW, true)?.id).toBe("go");
  });

  it("looks only at the commands of the mode", () => {
    expect(matchCommand(press("KeyN"), km, SHOW)).toBeNull();
    expect(matchCommand(press("KeyN"), km, ["newGo", "note"])?.id).toBe("newGo");
  });

  it("follows a changed keymap", () => {
    const mine = resolveKeymap({ go: [{ code: "Enter" }], blackout: [] });
    expect(matchCommand(press("Enter"), mine, SHOW)?.id).toBe("go");
    expect(matchCommand(press("Space"), mine, SHOW)).toBeNull();
    expect(matchCommand(press("KeyB"), mine, SHOW)).toBeNull();
    expect(matchCommand(press("KeyP"), mine, SHOW)?.id).toBe("pause");
  });
});

describe("E E: two presses within one second", () => {
  it("arms on the first press and fires on the second within the window", () => {
    const first = doublePress(null, 10_000);
    expect(first).toEqual({ fire: false, armedAt: 10_000 });
    expect(doublePress(first.armedAt, 10_000 + DOUBLE_PRESS_MS)).toEqual({ fire: true, armedAt: null });
    expect(DOUBLE_PRESS_MS).toBe(1000);
  });

  it("arms again when the second press comes too late", () => {
    const late = doublePress(10_000, 10_000 + DOUBLE_PRESS_MS + 1);
    expect(late).toEqual({ fire: false, armedAt: 11_001 });
    expect(doublePress(late.armedAt, 11_500).fire).toBe(true);
  });

  it("does not fire when the clock went back", () => {
    expect(doublePress(10_000, 9_500)).toEqual({ fire: false, armedAt: 9_500 });
  });
});

describe("conflicts", () => {
  it("the default keymap has none", () => {
    expect(keymapConflicts(DEFAULT_KEYMAP)).toEqual([]);
  });

  it("finds two commands on the same key", () => {
    const c = keymapConflicts(resolveKeymap({ pause: [{ code: "KeyB" }] }));
    expect(c).toHaveLength(1);
    expect([c[0].a, c[0].b].sort()).toEqual(["blackout", "pause"]);
  });

  it("a double press clashes with a single press of the same key", () => {
    const c = keymapConflicts(resolveKeymap({ ftb: [{ code: "KeyE" }] }));
    expect(c.map((x) => [x.a, x.b].sort().join("+"))).toEqual(["emergency+ftb"]);
  });

  it("refuses the keys of the script and of the app", () => {
    expect(conflictsOf(DEFAULT_KEYMAP, "pause", { code: "KeyW" }).map((c) => c.b)).toEqual(["scroll"]);
    expect(conflictsOf(DEFAULT_KEYMAP, "lock", { code: "KeyS", ctrl: true }).map((c) => c.b)).toEqual(["app"]);
    expect(conflictsOf(DEFAULT_KEYMAP, "go", { code: "ArrowLeft" }).map((c) => c.b)).toEqual(["zoom"]);
  });

  it("allows the same key in Show and in Prepara (never active together)", () => {
    expect(conflictsOf(DEFAULT_KEYMAP, "newGo", { code: "KeyB" })).toEqual([]);
    expect(conflictsOf(DEFAULT_KEYMAP, "newGo", { code: "KeyK" }).map((c) => c.b)).toEqual(["note"]);
  });

  it("modifiers make a different key", () => {
    expect(conflictsOf(DEFAULT_KEYMAP, "blank", { code: "KeyB", ctrl: true })).toEqual([]);
    expect(conflictsOf(DEFAULT_KEYMAP, "blank", { code: "KeyB", shift: true })).toEqual([]);
  });
});

describe("keymap in the settings", () => {
  it("drops unknown commands and broken bindings", () => {
    expect(normalizeKeymap({ go: [{ code: "Enter" }, { code: 5 }, "x", { code: "F13", ctrl: "yes" }], nope: [{ code: "KeyX" }], back: "Backspace" })).toEqual({
      go: [{ code: "Enter" }, { code: "F13" }],
    });
    expect(normalizeKeymap(null)).toEqual({});
    expect(normalizeKeymap([1, 2])).toEqual({});
  });

  it("writes the keys as on the keyboard", () => {
    expect(bindingCaps({ code: "KeyL", ctrl: true })).toEqual(["Ctrl", "L"]);
    expect(bindingCaps({ code: "KeyE", double: true })).toEqual(["E", "E"]);
    expect(bindingCaps({ code: "Escape" })).toEqual(["Esc"]);
    expect(commandKeyText(DEFAULT_KEYMAP, "emergency")).toBe("E E");
    expect(commandKeyText(resolveKeymap({ blank: [] }), "blank")).toBe("");
  });

  it("lists every command for Settings → Tasti", () => {
    const ids = KEYS.map((k) => k.id);
    for (const id of COMMAND_IDS) expect(ids).toContain(id);
    expect(KEYS.find((k) => k.id === "go")?.keys).toEqual([["Space"], ["F13"]]);
    expect(KEYS.find((k) => k.id === "reserve")?.held).toBe(true);
    expect(KEYS.find((k) => k.id === "peek")?.fixed).toBe(true);
  });
});
