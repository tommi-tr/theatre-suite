import { describe, expect, it } from "vitest";
import type { Action, Go, GoAnchor, ItemRef } from "./gos";
import {
  autoWait,
  back,
  blackout,
  canGive,
  click,
  columns,
  emergency,
  EMERGENCY_WINDOW_MS,
  emergencyPress,
  fadeToBlack,
  fireAuto,
  go,
  goViews,
  indices,
  initialState,
  leaveEmergency,
  lightTimes,
  pause,
  restore,
  resume,
  snapshot,
  stopAudio,
  togglePause,
  type LightTimes,
  type PlaybackContext,
  type PlaybackLookup,
  type PlaybackState,
} from "./playback";

const at = (page: number, y: number): GoAnchor => ({ page, y, quote: "", before: "", after: "" });
const L = (id: string, itemId: string, extra: object = {}): Action => ({ id, kind: "light", ref: { sourceId: "g", itemId }, ...extra });
const S = (id: string, itemId: string, extra: object = {}): Action => ({ id, kind: "audio", ref: { sourceId: "d", itemId }, ...extra });
const mk = (id: string, y: number, actions: Action[], extra: Partial<Go> = {}): Go => ({ id, anchor: at(1, y), actions, givenBy: "both", ...extra });

const MEM: Record<string, LightTimes> = {
  m1: { fadeIn: 3, fadeOut: 3, delay: 0, moveInDark: false },
  m2: { fadeIn: 5, fadeOut: 2, delay: 1, moveInDark: false },
  m3: { fadeIn: 2, fadeOut: 2, delay: 0, moveInDark: true },
};
const TRK: Record<string, { playSec: number | null; exit: "fadeOut" | "crossfade" | "next" | null; exitSec: number; loop: boolean }> = {
  t1: { playSec: 30, exit: null, exitSec: 0, loop: false },
  t2: { playSec: 20, exit: "crossfade", exitSec: 4, loop: false },
  t3: { playSec: null, exit: null, exitSec: 0, loop: false },
  t4: { playSec: 10, exit: null, exitSec: 0, loop: true },
};
const lookup: PlaybackLookup = {
  memory: (r: ItemRef) => MEM[r.itemId] ?? null,
  track: (r: ItemRef) => TRK[r.itemId] ?? null,
};
const solo: PlaybackContext = { role: "solo", lookup };

/** 1: light m1 · 2: m2 + sound t1 · 3: sound t2 · 4: m3 · 5: stop t1 */
const show = (): Go[] => [
  mk("g1", 0.1, [L("l1", "m1")]),
  mk("g2", 0.2, [L("l2", "m2"), S("s2", "t1")]),
  mk("g3", 0.3, [S("s3", "t2")]),
  mk("g4", 0.4, [L("l4", "m3")]),
  mk("g5", 0.5, [{ id: "x5", kind: "audioStop", ref: { sourceId: "d", itemId: "t1" }, times: { fade: 2 } }]),
];

const run = (gos: Go[], n: number, s: PlaybackState = initialState(gos)) => {
  for (let i = 0; i < n; i++) s = go(s, gos, solo).state;
  return s;
};

describe("GO", () => {
  it("starts with the first GO in standby and nothing fired", () => {
    const s = initialState(show());
    expect(s).toMatchObject({ lastGoId: null, standbyId: "g1", history: [] });
    expect(indices(s, show())).toEqual({ lastGoIndex: -1, standbyIndex: 0 });
    expect(initialState([]).standbyId).toBeNull();
  });

  it("fires the standby and moves standby to the next GO", () => {
    const gos = show();
    const r = go(initialState(gos), gos, solo);
    expect(r.fired).toEqual(["g1"]);
    expect(r.commands).toEqual([{ kind: "light", goId: "g1", actionId: "l1", ref: { sourceId: "g", itemId: "m1" }, transition: MEM.m1 }]);
    expect(r.state).toMatchObject({ lastGoId: "g1", standbyId: "g2", history: ["g1"] });
    expect(indices(r.state, gos)).toEqual({ lastGoIndex: 0, standbyIndex: 1 });
  });

  it("sends every action of a merged GO", () => {
    const gos = show();
    const r = go(run(gos, 1), gos, solo);
    expect(r.commands.map((c) => c.kind)).toEqual(["light", "audioPlay"]);
    expect(r.commands[1]).toEqual({ kind: "audioPlay", goId: "g2", actionId: "s2", ref: { sourceId: "d", itemId: "t1" }, engineTrackId: "t1", delaySec: 0 });
  });

  it("applies the times changed in Cue", () => {
    expect(lightTimes({ times: { fade: 8 } }, MEM.m2)).toEqual({ fadeIn: 8, fadeOut: 8, delay: 1, moveInDark: false });
    expect(lightTimes({ times: { fade: 8, fadeOut: 1, delay: 0 } }, MEM.m2)).toEqual({ fadeIn: 8, fadeOut: 1, delay: 0, moveInDark: false });
    expect(lightTimes({ times: { fadeIn: -1 } }, MEM.m2).fadeIn).toBe(5);
  });

  it("does nothing at the end", () => {
    const gos = show();
    const s = run(gos, 5);
    expect(s.standbyId).toBeNull();
    const r = go(s, gos, solo);
    expect(r.refused).toBe("end");
    expect(r.state).toBe(s);
  });

  it("skips actions whose item is missing and fires the rest", () => {
    const gos = [mk("a", 0.1, [L("l", "gone"), S("s", "t1")])];
    const r = go(initialState(gos), gos, solo);
    expect(r.skipped).toEqual([{ goId: "a", actionId: "l" }]);
    expect(r.commands.map((c) => c.kind)).toEqual(["audioPlay"]);
  });

  it("stops one sound or every sound", () => {
    const gos = show();
    const r = go(run(gos, 4), gos, solo);
    expect(r.commands).toEqual([{ kind: "audioStop", goId: "g5", ref: { sourceId: "d", itemId: "t1" }, fadeSec: 2 }]);
    const all = [mk("a", 0.1, [{ id: "x", kind: "audioStop" }])];
    expect(go(initialState(all), all, solo).commands).toEqual([{ kind: "audioStop", goId: "a", ref: null, fadeSec: null }]);
  });

  it("resumes first when given during Pausa", () => {
    const gos = show();
    const s = pause(run(gos, 1)).state;
    const r = go(s, gos, solo);
    expect(r.commands.slice(0, 2)).toEqual([
      { kind: "dmxPause", paused: false },
      { kind: "audioPause", paused: false },
    ]);
    expect(r.state.paused).toBe(false);
  });
});

describe("who gives the GO", () => {
  const gos = [mk("a", 0.1, [L("l", "m1")], { givenBy: "secondary" }), mk("b", 0.2, [L("l2", "m2")], { givenBy: "primary" })];

  it("lets a computer alone give every GO", () => {
    expect(canGive(gos[0], "solo").ok).toBe(true);
    expect(go(initialState(gos), gos, solo).fired).toEqual(["a"]);
  });

  it("refuses on the primary a GO given by the secondary, and says why", () => {
    const r = go(initialState(gos), gos, { role: "primary", lookup });
    expect(r.refused).toBe("givenBySecondary");
    expect(r.commands).toEqual([]);
    expect(go(initialState(gos), gos, { role: "secondary", lookup }).fired).toEqual(["a"]);
  });

  it("refuses on the secondary a GO given by the primary", () => {
    const s = go(initialState(gos), gos, { role: "secondary", lookup }).state;
    expect(go(s, gos, { role: "secondary", lookup }).refused).toBe("givenByPrimary");
  });

  it("marks the buttons", () => {
    const s = go(initialState(gos), gos, solo).state;
    expect(goViews(s, gos, "secondary")).toEqual([
      { id: "a", status: "last", fireable: true },
      { id: "b", status: "standby", fireable: false, reason: "givenByPrimary" },
    ]);
  });
});

describe("click", () => {
  it("makes a future GO standby without firing it", () => {
    const gos = show();
    const r = click(run(gos, 1), gos, "g4");
    expect(r.commands).toEqual([]);
    expect(r.state.standbyId).toBe("g4");
    expect(go(r.state, gos, solo).fired).toEqual(["g4"]);
  });

  it("does nothing on the standby or on a past GO", () => {
    const gos = show();
    const s = run(gos, 2);
    expect(click(s, gos, "g3").refused).toBe("alreadyStandby");
    expect(click(s, gos, "g1").refused).toBe("past");
    expect(click(s, gos, "g2").refused).toBe("past");
    expect(click(s, gos, "zz").refused).toBe("unknownGo");
  });

  it("shows past, last, standby and future", () => {
    const gos = show();
    expect(goViews(run(gos, 2), gos, "solo").map((v) => v.status)).toEqual(["past", "last", "standby", "future", "future"]);
  });
});

describe("in scene and standby per column", () => {
  it("keeps a light in scene many GOs later", () => {
    const gos = show();
    const c = columns(run(gos, 3), gos);
    expect(c.lights.inScene).toEqual({ goId: "g2", actionIds: ["l2"] });
    expect(c.lights.standby).toEqual({ goId: "g4", actionIds: ["l4"] });
    expect(c.audio.standby).toBeNull();
  });

  it("lists every sound started and not stopped", () => {
    const gos = show();
    expect(columns(run(gos, 3), gos).audio.inScene.map((a) => a.actionId)).toEqual(["s2", "s3"]);
    // GO 5 stops t1.
    expect(columns(run(gos, 5), gos).audio.inScene.map((a) => a.actionId)).toEqual(["s3"]);
  });

  it("forgets the sounds after Stop audio and after a stop-all action", () => {
    const gos = show();
    const s = stopAudio(run(gos, 3));
    expect(s.commands).toEqual([{ kind: "audioStopAll", immediate: false }]);
    expect(columns(s.state, gos).audio.inScene).toEqual([]);
    const g2 = [mk("a", 0.1, [S("s", "t1")]), mk("b", 0.2, [{ id: "x", kind: "audioStop" }]), mk("c", 0.3, [S("s3", "t2")])];
    expect(columns(run(g2, 3), g2).audio.inScene.map((a) => a.actionId)).toEqual(["s3"]);
  });

  it("follows what was fired, not the script order", () => {
    const gos = show();
    let s = run(gos, 1);
    s = click(s, gos, "g3").state;
    s = go(s, gos, solo).state;
    // GO 2 was skipped: lights are still those of GO 1.
    expect(columns(s, gos).lights.inScene?.goId).toBe("g1");
    expect(goViews(s, gos, "solo").map((v) => v.status)).toEqual(["past", "past", "last", "standby", "future"]);
  });
});

describe("Indietro", () => {
  it("does nothing before the first GO", () => {
    const gos = show();
    expect(back(initialState(gos), gos, solo).refused).toBe("start");
  });

  it("goes back to the previous light with that memory's times and stops the sounds of the undone GO", () => {
    const gos = show();
    const r = back(run(gos, 2), gos, solo);
    expect(r.commands).toEqual([
      { kind: "light", goId: "g1", actionId: "l1", ref: { sourceId: "g", itemId: "m1" }, transition: MEM.m1 },
      { kind: "audioStop", goId: "g2", ref: { sourceId: "d", itemId: "t1" }, engineTrackId: "t1", fadeSec: 1.5 },
    ]);
    expect(r.state).toMatchObject({ lastGoId: "g1", standbyId: "g2", history: ["g1"] });
  });

  it("goes to dark with the undone memory's times when there was no light before", () => {
    const gos = show();
    const r = back(run(gos, 1), gos, solo);
    expect(r.commands).toEqual([{ kind: "light", goId: null, actionId: null, ref: null, transition: MEM.m1 }]);
    expect(r.state).toMatchObject({ lastGoId: null, standbyId: "g1", history: [] });
  });

  it("leaves the lights alone when the undone GO had none", () => {
    const gos = show();
    const r = back(run(gos, 3), gos, solo);
    expect(r.commands.map((c) => c.kind)).toEqual(["audioStop"]);
    expect(columns(r.state, gos).audio.inScene.map((a) => a.actionId)).toEqual(["s2"]);
  });

  it("goes back one GO at a time along the history", () => {
    const gos = show();
    let s = run(gos, 1);
    s = go(click(s, gos, "g4").state, gos, solo).state;
    const r = back(s, gos, solo);
    // Back from GO 4 to GO 1 (2 and 3 were skipped), with GO 1's memory.
    expect(r.commands[0]).toMatchObject({ kind: "light", goId: "g1", transition: MEM.m1 });
    expect(r.state).toMatchObject({ lastGoId: "g1", standbyId: "g4" });
  });

  it("puts the previous projection back", () => {
    const gos = [mk("a", 0.1, [{ id: "p1", kind: "projection", projectionItemId: "i1" }]), mk("b", 0.2, [{ id: "p2", kind: "projection", projectionItemId: "i2" }])];
    const r = back(run(gos, 2), gos, solo);
    expect(r.commands).toEqual([{ kind: "projection", goId: "a", action: { id: "p1", kind: "projection", projectionItemId: "i1" } }]);
  });
});

describe("starts by itself", () => {
  const gos = (): Go[] => [mk("a", 0.1, [L("l1", "m2")]), mk("b", 0.2, [L("l2", "m1")], { auto: true }), mk("c", 0.3, [L("l3", "m3")])];

  it("schedules the auto GO after the light transition of the GO before", () => {
    const r = go(initialState(gos()), gos(), solo);
    expect(r.schedule).toEqual({ goId: "b", afterSec: 6 });
    expect(r.state.standbyId).toBe("b");
  });

  it("fires when the timer runs out, and schedules nothing more", () => {
    const g = gos();
    const s = go(initialState(g), g, solo).state;
    const r = fireAuto(s, g, "b", solo);
    expect(r.fired).toEqual(["b"]);
    expect(r.schedule).toBeUndefined();
    expect(r.state.standbyId).toBe("c");
  });

  it("does not fire a stale timer", () => {
    const g = gos();
    let s = go(initialState(g), g, solo).state;
    s = click(s, g, "c").state;
    expect(fireAuto(s, g, "b", solo).refused).toBe("notStandby");
    // The standby is a GO given by hand: a timer never fires it.
    expect(fireAuto(initialState(g), g, "a", solo).refused).toBe("notAuto");
  });

  it("is fired at once by GO", () => {
    const g = gos();
    const s = go(initialState(g), g, solo).state;
    expect(go(s, g, solo).fired).toEqual(["b"]);
  });

  it("waits for a sound to end, minus its crossfade", () => {
    const prev = mk("a", 0.1, [S("s1", "t2", { times: { delay: 1 } })]);
    expect(autoWait(prev, mk("b", 0.2, [S("s2", "t1")]), lookup)).toEqual({ afterSec: 17 });
  });

  it("uses only the columns of the auto GO", () => {
    const prev = mk("a", 0.1, [L("l", "m2"), S("s1", "t1")]);
    expect(autoWait(prev, mk("b", 0.2, [L("l2", "m1")]), lookup).afterSec).toBe(6);
    expect(autoWait(prev, mk("b", 0.2, [S("s2", "t2")]), lookup).afterSec).toBe(30);
    // No column in common: everything.
    expect(autoWait(prev, mk("b", 0.2, [{ id: "p", kind: "projection" }]), lookup).afterSec).toBe(30);
  });

  it("says when the length is unknown or the sound loops", () => {
    const unknown = autoWait(mk("a", 0.1, [S("s1", "t3")]), mk("b", 0.2, [S("s2", "t1")]), lookup);
    expect(unknown).toEqual({ afterSec: null, trackEnd: { ref: { sourceId: "d", itemId: "t3" }, engineTrackId: "t3", beforeEndSec: 0 } });
    expect(autoWait(mk("a", 0.1, [S("s1", "t4")]), mk("b", 0.2, [S("s2", "t1")]), lookup)).toEqual({ afterSec: null });
  });
});

describe("safety commands", () => {
  it("pauses and resumes lights and sound", () => {
    const s0 = initialState(show());
    const p = pause(s0);
    expect(p.commands).toEqual([
      { kind: "dmxPause", paused: true },
      { kind: "audioPause", paused: true },
    ]);
    expect(pause(p.state).commands).toEqual([]);
    expect(resume(p.state).state.paused).toBe(false);
    expect(togglePause(p.state).state.paused).toBe(false);
    expect(togglePause(s0).state.paused).toBe(true);
  });

  it("toggles Blackout and Fade to black on the output master", () => {
    const s0 = initialState(show());
    const b = blackout(s0);
    expect(b.commands).toEqual([{ kind: "dmxBlackout", on: true }]);
    expect(blackout(b.state).commands).toEqual([{ kind: "dmxBlackout", on: false }]);
    expect(blackout(b.state, true).commands).toEqual([]);
    const f = fadeToBlack(s0, 5);
    expect(f.commands).toEqual([{ kind: "dmxFadeToBlack", on: true, seconds: 5 }]);
    expect(fadeToBlack(f.state, 3).commands).toEqual([{ kind: "dmxFadeToBlack", on: false, seconds: 3 }]);
  });

  it("fires the emergency on the second E within the window", () => {
    const s0 = initialState(show());
    const first = emergencyPress(s0, 1000);
    expect(first.armed).toBe(true);
    expect(first.commands).toEqual([]);
    const late = emergencyPress(first.state, 1000 + EMERGENCY_WINDOW_MS + 1);
    expect(late.armed).toBe(true);
    const second = emergencyPress(late.state, 1000 + EMERGENCY_WINDOW_MS + 500);
    expect(second.state.emergency).toBe(true);
    expect(second.commands).toEqual([{ kind: "dmxEmergency", on: true }, { kind: "audioStopAll", immediate: true }, { kind: "projection", goId: null, action: null }]);
  });

  it("refuses GO, Indietro, Blackout and Fade to black during the emergency", () => {
    const gos = show();
    const s = emergency(run(gos, 2)).state;
    expect(go(s, gos, solo).refused).toBe("emergency");
    expect(back(s, gos, solo).refused).toBe("emergency");
    expect(blackout(s).refused).toBe("emergency");
    expect(fadeToBlack(s, 3).refused).toBe("emergency");
    expect(fireAuto(s, gos, "g3", solo).refused).toBe("emergency");
  });

  it("leaves the emergency back to the light in scene and to Blackout as it was", () => {
    const gos = show();
    let s = blackout(run(gos, 2)).state;
    s = emergency(s).state;
    expect(columns(s, gos).audio.inScene).toEqual([]);
    const r = leaveEmergency(s, gos, solo);
    expect(r.commands).toEqual([
      { kind: "dmxEmergency", on: false, blackout: true, ftb: false },
      { kind: "light", goId: "g2", actionId: "l2", ref: { sourceId: "g", itemId: "m2" }, transition: MEM.m2 },
    ]);
    expect(r.state.emergency).toBe(false);
    expect(go(r.state, gos, solo).fired).toEqual(["g3"]);
  });
});

describe("crash recovery", () => {
  it("restarts on the same standby without firing anything", () => {
    const gos = show();
    const s = click(run(gos, 2), gos, "g4").state;
    const snap = JSON.parse(JSON.stringify(snapshot(s)));
    const r = restore(snap, gos);
    expect(r).toMatchObject({ lastGoId: "g2", standbyId: "g4", history: ["g1", "g2"], paused: false, emergency: false });
    expect(columns(r, gos).lights.inScene?.goId).toBe("g2");
  });

  it("copes with GOs removed since", () => {
    const gos = show();
    const snap = { standbyId: "gone", lastGoId: "g2", history: ["old", "g1", "g2"] };
    expect(restore(snap, gos)).toMatchObject({ lastGoId: "g2", standbyId: "g3", history: ["g1", "g2"] });
    expect(restore({ standbyId: null, lastGoId: "gone" }, gos)).toMatchObject({ lastGoId: null, standbyId: "g1", history: [] });
    expect(restore({ standbyId: "g3", lastGoId: "g2" }, gos).history).toEqual(["g2"]);
  });
});
