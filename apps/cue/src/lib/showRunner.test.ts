import { describe, expect, it } from "vitest";
import { createSimDmx } from "@theatre-suite/show-files/granvelo/dmxSim";
import { makeT } from "@theatre-suite/core";
import { DICTS } from "../i18n";
import { back, columns, emergency, go, initialState, leaveEmergency, restore, stopAudio, type PlaybackContext } from "../model/playback";
import { createSimAudio, SIMULATED_OUTPUT } from "./audioSim";
import { engineId, splitEngineId } from "./audio";
import { DEMO_GOS, DEMO_LIGHTS_ID, DEMO_PLAYBACK, DEMO_SOURCES, putDemoSources } from "./demoShow";
import { dmxLinkText, dmxProblemText } from "./dmx";
import { runCommands, type RunnerDeps } from "./showRunner";
import { loadLibrary, loadSource, linkSourceFile, sourceStatusText } from "./sources";

const SHOW = "C:\\Spettacoli\\La locandiera\\Serata.tcue";
const it_ = makeT(DICTS, "it");

async function setup() {
  putDemoSources();
  const library = await loadLibrary(DEMO_SOURCES, SHOW);
  let now = 0;
  const dmx = createSimDmx({ timer: false, now: () => now });
  const audio = createSimAudio({ timer: false, now: () => now });
  await dmx.connect({ mode: "simulated" });
  await audio.sync(library.audioSync(DEMO_GOS));
  const timers: { fn: () => void; ms: number }[] = [];
  const errors: unknown[] = [];
  const deps: RunnerDeps = { dmx, audio, library, later: (fn, ms) => timers.push({ fn, ms }), onError: (_c, e) => errors.push(e) };
  const ctx: PlaybackContext = { role: "solo", lookup: library.lookup };
  const advance = (sec: number) => {
    now += sec;
    dmx.tick(now);
    audio.tick(now);
  };
  return { library, dmx, audio, deps, ctx, timers, errors, advance };
}

describe("demo sources from the preview's files", () => {
  it("load next to the show file", async () => {
    putDemoSources();
    const lib = await loadLibrary(DEMO_SOURCES, SHOW);
    expect(lib.sources.map((s) => s.status.state)).toEqual(["ok", "ok"]);
    expect(lib.sources[0].absPath).toBe("C:\\Spettacoli\\La locandiera\\Luci.granvelo");
    expect(lib.missing(DEMO_GOS)).toEqual([]);
  });

  it("say in Italian what is wrong", async () => {
    const missing = await loadSource({ id: "x", app: "granvelo", path: "Altro.granvelo" }, SHOW);
    expect(missing.status.state).toBe("missing");
    expect(sourceStatusText(it_, missing)).toBe("File non trovato: C:\\Spettacoli\\La locandiera\\Altro.granvelo");
    const unsaved = await loadSource({ id: "x", app: "granvelo", path: "Luci.granvelo" }, null);
    expect(unsaved.status.state).toBe("missing");
    const newer = { ...missing, status: { state: "newer" as const } };
    expect(sourceStatusText(it_, newer)).toBe("Fatto con un Granvelo più recente: aggiorna Granvelo su questo computer.");
    expect(sourceStatusText(it_, (await loadLibrary(DEMO_SOURCES, SHOW)).sources[0])).toBe("");
  });

  it("link a chosen file relative to the show", async () => {
    putDemoSources();
    const r = (await linkSourceFile("C:\\Spettacoli\\La locandiera\\Luci.granvelo", SHOW, () => "new"))!;
    expect(r.link).toMatchObject({ id: "new", app: "granvelo", path: "Luci.granvelo", docId: DEMO_SOURCES[0].docId, name: "La locandiera — luci" });
    expect(r.loaded.lights).toHaveLength(10);
    expect(await linkSourceFile("C:\\x.wav", SHOW, () => "n")).toBeNull();
  });
});

describe("running the evening on the simulated outputs", () => {
  it("GO 1 brings the dawn up and starts the bells", async () => {
    const s = await setup();
    const r = go(initialState(DEMO_GOS), DEMO_GOS, s.ctx);
    await runCommands(r.commands, s.deps);
    expect(s.errors).toEqual([]);
    s.advance(8);
    const st = await s.dmx.getStatus();
    expect(st.output.slice(15, 18)).toEqual([40, 60, 200]);
    const live = await s.audio.state();
    expect(live.voices.map((v) => v.trackId)).toEqual([engineId("src-suoni", "trk-campane")]);
    expect(live.engine.device).toBe(SIMULATED_OUTPUT);
  });

  it("plays a changed sound as its own copy and stops every copy of a track", async () => {
    const s = await setup();
    const g12 = DEMO_GOS[11];
    const r = go({ ...initialState(DEMO_GOS), standbyId: g12.id }, DEMO_GOS, s.ctx);
    await runCommands(r.commands, s.deps);
    expect((await s.audio.state()).voices.map((v) => splitEngineId(v.trackId)?.trackId)).toEqual(["trk-applausi#a12s"]);
    await runCommands([{ kind: "audioStop", goId: null, ref: { sourceId: "src-suoni", itemId: "trk-applausi" }, fadeSec: 0.5 }], s.deps);
    s.advance(1);
    expect((await s.audio.state()).voices).toEqual([]);
  });

  it("Indietro brings the previous memory back and stops the sounds", async () => {
    const s = await setup();
    let st = initialState(DEMO_GOS);
    for (let i = 0; i < 2; i++) {
      const r = go(st, DEMO_GOS, s.ctx);
      await runCommands(r.commands, s.deps);
      st = r.state;
      s.advance(10);
    }
    const b = back(st, DEMO_GOS, s.ctx);
    await runCommands(b.commands, s.deps);
    s.advance(10);
    expect((await s.dmx.getStatus()).output.slice(0, 3)).toEqual([0, 90, 0]);
    expect(b.state.standbyId).toBe("go02");
  });

  it("emergency lights everything, stops the sound, and gives the scene back", async () => {
    const s = await setup();
    let st = initialState(DEMO_GOS);
    const r = go(st, DEMO_GOS, s.ctx);
    await runCommands(r.commands, s.deps);
    st = r.state;
    const e = emergency(st);
    await runCommands(e.commands, s.deps);
    s.advance(0.1);
    expect((await s.dmx.getStatus()).output.slice(0, 4)).toEqual([255, 255, 255, 255]);
    expect((await s.audio.state()).voices).toEqual([]);
    const l = leaveEmergency(e.state, DEMO_GOS, s.ctx);
    await runCommands(l.commands, s.deps);
    s.advance(10);
    expect((await s.dmx.getStatus()).output.slice(0, 4)).toEqual([0, 90, 0, 0]);
  });

  it("a delayed sound waits for its timer; Stop audio fades everything", async () => {
    const s = await setup();
    const g = { id: "d", anchor: DEMO_GOS[0].anchor, givenBy: "both" as const, actions: [{ id: "s", kind: "audio" as const, ref: { sourceId: "src-suoni", itemId: "trk-tuono" }, times: { delay: 2 } }] };
    const r = go(initialState([g]), [g], s.ctx);
    await runCommands(r.commands, s.deps);
    expect((await s.audio.state()).voices).toEqual([]);
    expect(s.timers.map((t) => t.ms)).toEqual([2000]);
    s.timers[0].fn();
    await Promise.resolve();
    expect((await s.audio.state()).voices).toHaveLength(1);
    await runCommands(stopAudio(r.state).commands, s.deps);
    s.advance(2);
    expect((await s.audio.state()).voices).toEqual([]);
  });

  it("restarts the demo evening on its standby without sending anything", async () => {
    const s = await setup();
    const st = restore(DEMO_PLAYBACK, DEMO_GOS);
    expect(st.standbyId).toBe("go07");
    expect(columns(st, DEMO_GOS).lights.inScene).toEqual({ goId: "go06", actionIds: ["a06l"] });
    expect((await s.dmx.getStatus()).live.fade.id).toBe(0);
  });

  it("a missing memory is reported and the rest still runs", async () => {
    const s = await setup();
    await runCommands(
      [
        { kind: "light", goId: "x", actionId: "y", ref: { sourceId: DEMO_LIGHTS_ID, itemId: "gone" }, transition: { fadeIn: 1, fadeOut: 1, delay: 0, moveInDark: false } },
        { kind: "dmxBlackout", on: true },
      ],
      s.deps,
    );
    expect(s.errors).toHaveLength(1);
    expect((await s.dmx.getStatus()).live.master.blackout).toBe(true);
  });
});

describe("DMX words", () => {
  it("says plainly that Granvelo holds the cable", () => {
    expect(dmxProblemText(it_, "busy").title).toBe("Il cavo DMX è usato da un altro programma (forse Granvelo): chiudilo e riprova");
    expect(dmxLinkText(it_, { state: "error", code: "busy", message: "COM3 busy" })).toBe("Il cavo DMX è usato da un altro programma (forse Granvelo): chiudilo e riprova");
    expect(dmxLinkText(it_, { state: "simulated" })).toBe("Uscita simulata");
    expect(dmxLinkText(it_, { state: "connected", device: "DMX USB PRO", kind: "pro" })).toBe("Connesso · DMX USB PRO");
  });
});
