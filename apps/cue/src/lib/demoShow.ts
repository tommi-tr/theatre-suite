import { defaultChannels, newDocument, serialize, type Fixture, type GranveloDoc, type Memory, type Transition } from "@theatre-suite/show-files/granvelo";
import { docToFile, newTrack, type Track } from "@theatre-suite/show-files/diaframma";
import type { Go, GoAnchor } from "../model/gos";
import type { PlaybackSnapshot } from "../model/playback";
import type { SourceLink } from "../model/sources";
import { putDemoSourceFile } from "./sources";

/**
 * The GOs and sources of the demo show "La locandiera / Serata.tcue" (browser preview `/?demo`): a small Granvelo
 * show (`Luci.granvelo`, 7 lights, 10 memories) and a Diaframma cue list (`Suoni.diaframma`, 6 tracks) next to the
 * show file, and 12 GOs on the first 5 pages of the script (page + height only: the quotes are filled by phase 1's
 * anchors when the script is there). They show every case of the Show screen: merged GOs (light + sound), a GO that
 * starts by itself after a sound (Diaframma's Next) and one after a light ("parte da sola", close to the GO before:
 * its button is pushed and its line curves), a GO given only by the secondary and one only by the primary, a stop of
 * one sound and a stop of every sound, a looping sound.
 *
 * Wiring (model/demo.ts): `memFs.put(DEMO_PATH, show(demoCueFields()))` and `putDemoSources()`.
 */

export const DEMO_FOLDER = "C:\\Spettacoli\\La locandiera";
export const DEMO_LIGHTS_PATH = `${DEMO_FOLDER}\\Luci.granvelo`;
export const DEMO_SOUNDS_PATH = `${DEMO_FOLDER}\\Suoni.diaframma`;
export const DEMO_LIGHTS_ID = "src-luci";
export const DEMO_SOUNDS_ID = "src-suoni";
const GRANVELO_DOC_ID = "6772616e76656c6f2d6c6f63616e6469";

/* ------------------------------------------------------------------ */
/* Luci.granvelo                                                        */
/* ------------------------------------------------------------------ */

function light(n: number, name: string, typeId: Fixture["typeId"], address: number, x: number, y: number, z: number, mount: Fixture["mount"], aim: { x: number; y: number }): Fixture {
  return {
    id: `fx${n}`,
    number: n,
    name,
    typeId,
    universe: 1,
    address,
    channels: defaultChannels(typeId),
    mount,
    position: { x, y, z },
    beam: { angle: typeId === "profile" ? 26 : typeId === "pc" ? 30 : 25 },
    aim: { x: aim.x, y: aim.y, z: 0 },
    unused: false,
    broken: false,
  };
}

const tr = (fade: number, extra: Partial<Transition> = {}): Transition => ({ fadeIn: fade, fadeOut: fade, delay: 0, autoFollow: false, moveInDark: false, ...extra });

/** 512 values from `{ channel: value }`. */
function dmx(levels: Record<number, number>): number[] {
  const v = new Array<number>(512).fill(0);
  for (const [ch, val] of Object.entries(levels)) v[Number(ch) - 1] = val;
  return v;
}

// Channels: PC 1–3 (1, 2, 3), profile (4), back lights RGB (10–12, 13–15), cyclorama RGB (16–18).
const MEMORIES: [number, string, Record<number, number>, Transition, string?][] = [
  [1, "Preset sala", { 1: 60, 2: 60, 3: 60 }, tr(3)],
  [2, "Alba", { 2: 90, 16: 40, 17: 60, 18: 200 }, tr(8), "Lenta: il pubblico deve vedere sorgere il sole"],
  [3, "Locanda, giorno", { 1: 230, 2: 255, 3: 230, 10: 255, 11: 200, 12: 120, 13: 255, 14: 200, 15: 120, 16: 120, 17: 180, 18: 255 }, tr(4)],
  [4, "Mirandolina sola", { 2: 80, 4: 255, 12: 120, 15: 120 }, tr(5, { fadeOut: 3 })],
  [5, "Sera", { 1: 140, 2: 160, 3: 140, 10: 255, 11: 120, 13: 255, 14: 120, 16: 200, 17: 60, 18: 30 }, tr(6)],
  [6, "Notte", { 2: 40, 12: 255, 15: 255, 18: 160 }, tr(5)],
  [7, "Lampo", { 1: 255, 2: 255, 3: 255, 10: 255, 11: 255, 12: 255, 13: 255, 14: 255, 15: 255 }, tr(0, { fadeOut: 0.4, autoFollow: true })],
  [8, "Dopo il lampo", { 2: 50, 12: 255, 15: 255, 18: 180 }, tr(2)],
  [9, "Finale", { 1: 255, 2: 255, 3: 255, 4: 200, 10: 255, 11: 220, 12: 160, 13: 255, 14: 220, 15: 160, 16: 255, 17: 200, 18: 120 }, tr(3)],
  [10, "Buio", {}, tr(4)],
];

export function demoGranveloDoc(): GranveloDoc {
  const doc = newDocument({ title: "La locandiera — luci" });
  doc.id = GRANVELO_DOC_ID;
  doc.trusses = [
    { id: "tr1", name: null, y: 1, z: 5 },
    { id: "tr2", name: null, y: 4, z: 5 },
  ];
  doc.fixtures = [
    light(1, "PC sinistra", "pc", 1, -2.5, 1, 5, { kind: "truss", trussId: "tr1" }, { x: -2.5, y: 2.5 }),
    light(2, "PC centro", "pc", 2, 0, 1, 5, { kind: "truss", trussId: "tr1" }, { x: 0, y: 2.5 }),
    light(3, "PC destra", "pc", 3, 2.5, 1, 5, { kind: "truss", trussId: "tr1" }, { x: 2.5, y: 2.5 }),
    light(4, "Sagomatore porta", "profile", 4, 0, -3, 4, { kind: "floating" }, { x: 1.5, y: 3 }),
    light(5, "Controluce sinistra", "parRgb", 10, -2, 4, 5, { kind: "truss", trussId: "tr2" }, { x: -1.5, y: 2 }),
    light(6, "Controluce destra", "parRgb", 13, 2, 4, 5, { kind: "truss", trussId: "tr2" }, { x: 1.5, y: 2 }),
    light(7, "Fondale", "parRgb", 16, 0, 5.8, 0, { kind: "floor" }, { x: 0, y: 6 }),
  ];
  doc.memories = MEMORIES.map(([n, label, levels, transition, note]): Memory => ({ id: `mem${n}`, number: n, label, note: note ?? "", state: { binding: "address", dmx: dmx(levels) }, scenery: [], transition }));
  doc.sequence = doc.memories.map((m) => m.id);
  return doc;
}

/* ------------------------------------------------------------------ */
/* Suoni.diaframma                                                      */
/* ------------------------------------------------------------------ */

function track(id: string, name: string, durationSec: number, extra: Partial<Track> = {}): Track {
  return { ...newTrack(id), file: { path: `${DEMO_FOLDER}\\audio\\${name}`, relativePath: `audio/${name}`, name, durationSec }, ...extra };
}

export function demoTracks(): Track[] {
  return [
    track("trk-campane", "Campane.wav", 42, { entry: "fadeIn", entrySec: 2 }),
    track("trk-minuetto", "Minuetto.mp3", 95, { exit: "next" }),
    // Starts by itself when the minuet ends (Exit "Next" of the track before).
    track("trk-valzer", "Valzer.mp3", 120, { exit: "fadeOut", exitSec: 4 }),
    track("trk-pioggia", "Pioggia.wav", 60, { loopOn: true, entry: "fadeIn", entrySec: 3 }),
    track("trk-tuono", "Tuono.wav", 6),
    track("trk-applausi", "Applausi.wav", 30, { volumeDb: -3 }),
  ];
}

/* ------------------------------------------------------------------ */
/* The links and the GOs                                                */
/* ------------------------------------------------------------------ */

export const DEMO_SOURCES: SourceLink[] = [
  { id: DEMO_LIGHTS_ID, app: "granvelo", path: "Luci.granvelo", docId: GRANVELO_DOC_ID, name: "La locandiera — luci" },
  { id: DEMO_SOUNDS_ID, app: "diaframma", path: "Suoni.diaframma", name: "Suoni" },
];

const at = (page: number, y: number): GoAnchor => ({ page, y, quote: "", before: "", after: "" });
const L = (id: string, mem: number, times?: { fade?: number; delay?: number }) => ({ id, kind: "light" as const, ref: { sourceId: DEMO_LIGHTS_ID, itemId: `mem${mem}` }, ...(times ? { times } : {}) });
const S = (id: string, trk: string, extra: { levelDb?: number } = {}) => ({ id, kind: "audio" as const, ref: { sourceId: DEMO_SOUNDS_ID, itemId: `trk-${trk}` }, ...extra });

export const DEMO_GOS: Go[] = [
  { id: "go01", anchor: at(1, 0.14), actions: [L("a01l", 2), S("a01s", "campane")], givenBy: "both", note: "Al buio completo, aspetta il silenzio in sala" },
  { id: "go02", anchor: at(1, 0.58), actions: [L("a02l", 3), { id: "a02p", kind: "projection", projectionItemId: "img-lettera" }], givenBy: "both" },
  { id: "go03", anchor: at(2, 0.22), actions: [S("a03s", "minuetto")], givenBy: "both" },
  { id: "go04", anchor: at(2, 0.64), actions: [S("a04s", "valzer")], givenBy: "both", auto: true },
  { id: "go05", anchor: at(3, 0.16), actions: [L("a05l", 4)], givenBy: "secondary", note: "Lo dà il secondario: vede la porta" },
  { id: "go06", anchor: at(3, 0.71), actions: [L("a06l", 5), { id: "a06x", kind: "audioStop", ref: { sourceId: DEMO_SOUNDS_ID, itemId: "trk-valzer" }, times: { fade: 3 } }], givenBy: "both" },
  { id: "go07", anchor: at(4, 0.1), actions: [L("a07l", 6), S("a07s", "pioggia")], givenBy: "both" },
  { id: "go08", anchor: at(4, 0.4), actions: [L("a08l", 7), S("a08s", "tuono"), { id: "a08p", kind: "projection", projectionItemId: "vid-tempesta" }], givenBy: "both" },
  { id: "go09", anchor: at(4, 0.42), actions: [L("a09l", 8)], givenBy: "both", auto: true },
  { id: "go10", anchor: at(5, 0.26), actions: [L("a10l", 9, { fade: 5 }), { id: "a10x", kind: "audioStop", ref: { sourceId: DEMO_SOUNDS_ID, itemId: "trk-pioggia" }, times: { fade: 6 } }], givenBy: "both" },
  { id: "go11", anchor: at(5, 0.8), actions: [L("a11l", 10), { id: "a11x", kind: "audioStop" }], givenBy: "both" },
  { id: "go12", anchor: at(5, 0.9), actions: [S("a12s", "applausi", { levelDb: 2 })], givenBy: "primary" },
];

/** Heights of the audio boxes the user "dragged" in the demo. */
export const DEMO_AUDIO_HEIGHTS: Record<string, number> = { a01s: 96, a07s: 120 };

/** A moment of the evening for screenshots: GO 6 given, GO 7 in standby. */
export const DEMO_PLAYBACK: PlaybackSnapshot = { lastGoId: "go06", standbyId: "go07", history: ["go01", "go02", "go03", "go04", "go05", "go06"] };

/** The projections of the demo: placeholder pictures drawn for the demo (`public/demo/*.svg`), one video that is only an entry. */
export const DEMO_PROJECTION = {
  blank: { kind: "black" },
  screen: null,
  color: { brightness: 0, contrast: 5, temperature: 0, saturation: 0 },
  items: [
    { id: "img-locanda", kind: "image", name: "Img 1 Locanda", part: "images/locanda.svg", thumb: "thumbs/locanda.svg", transition: { kind: "cut" } },
    { id: "img-lettera", kind: "image", name: "Img 3 Lettera", part: "images/lettera.svg", thumb: "thumbs/lettera.svg", transition: { kind: "dissolve", seconds: 2 } },
    {
      id: "vid-tempesta",
      kind: "video",
      name: "Video 2 Tempesta.mp4",
      path: "video/tempesta.mp4",
      thumb: "thumbs/tempesta.svg",
      durationSec: 84,
      transition: { kind: "throughBlack", seconds: 1.5 },
      color: { brightness: 0, contrast: 5, temperature: 0, saturation: -15 },
      atEnd: "hold",
    },
    { id: "img-ritratto", kind: "image", name: "Img 4 Ritratto", part: "images/ritratto.svg", thumb: "thumbs/ritratto.svg", transition: { kind: "dissolve", seconds: 3 } },
  ],
};

/** A slower zone from GO 7 (the rain), as Prepara sets it. */
export const DEMO_SPEED_ZONES = [{ id: "z1", from: at(4, 0.1), fromGoId: "go07", speed: 0.6 }];

/**
 * `?demo&many`: ~60 GOs over the 6 pages of the demo script (stress test of the timeline): every page gets ten,
 * cycling the memories and tracks of the demo files.
 */
export function manyDemoGos(): Go[] {
  const out: Go[] = [];
  const tracks = ["campane", "minuetto", "pioggia", "tuono", "applausi"];
  for (let i = 0; i < 60; i++) {
    const page = 1 + Math.floor(i / 10);
    const y = 0.06 + (i % 10) * 0.09;
    const actions: Go["actions"] = [L(`m${i}l`, 1 + (i % 10))];
    if (i % 3 === 0) actions.push(S(`m${i}s`, tracks[i % tracks.length]));
    out.push({ id: `m${String(i).padStart(2, "0")}`, anchor: at(page, y), actions, givenBy: "both" });
  }
  return out;
}

/** The fields of `show.json` the demo adds (sources, GOs, audio box heights, projections, preset; the speed zone is added by model/demo.ts). */
export function demoCueFields(many = false) {
  return {
    sources: structuredClone(DEMO_SOURCES),
    gos: many ? manyDemoGos() : structuredClone(DEMO_GOS),
    layout: { scriptWidth: null, audioBoxHeights: { ...DEMO_AUDIO_HEIGHTS } },
    projection: structuredClone(DEMO_PROJECTION),
    settings: { autoScrollSpeed: 1, ftbSeconds: 3, presetRef: { sourceId: DEMO_LIGHTS_ID, itemId: "mem1" } },
  };
}

/** The texts of the two demo files. */
export function demoSourceTexts(): { lights: string; sounds: string } {
  return {
    lights: serialize(demoGranveloDoc(), { name: "Granvelo", version: "0.6.1" }, new Date(2026, 10, 19, 18, 0)),
    sounds: `${JSON.stringify(docToFile(demoTracks(), "0.3.2"), null, 2)}\n`,
  };
}

/** Puts the demo files where the preview reads them (once). */
export function putDemoSources(): void {
  const { lights, sounds } = demoSourceTexts();
  putDemoSourceFile(DEMO_LIGHTS_PATH, lights);
  putDemoSourceFile(DEMO_SOUNDS_PATH, sounds);
}
