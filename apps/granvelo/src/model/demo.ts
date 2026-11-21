import { defaultChannels, fixtureType } from "./fixtureTypes";
import { captureState } from "./memories";
import { defaultAim } from "./ops";
import { DEFAULT_DOC_SETTINGS, type ChannelFunction, type Fixture, type FixtureTypeId, type FixtureValues, type GranveloDoc, type Memory, type Mount, type Scenery, type SceneryPlacement, type Transition, type Truss, type Vec3 } from "./types";

/**
 * The demo show *La locandiera* (Goldoni), loaded by `/?demo`: a believable rig of an amateur company on an
 * 8 × 6 × 4.5 m stage. 15 lights (one not used in this production), two trusses, four groups, five scenery
 * pieces, nine memories with different looks and transitions. No address conflicts.
 * Ids are fixed so that tests and screenshots are repeatable.
 */

const STAGE = { width: 8, depth: 6, height: 4.5 };

const TRUSSES: Truss[] = [
  { id: "tr-1", name: null, y: 1.2, z: 4.5 },
  { id: "tr-2", name: null, y: 4, z: 4.6 },
];

interface Spec {
  n: number;
  name: string;
  type: FixtureTypeId;
  address: number;
  mount: Mount;
  at: Vec3;
  aim?: Vec3;
  unused?: boolean;
}

const truss = (id: string): Mount => ({ kind: "truss", trussId: id });
const floating: Mount = { kind: "floating" };
const floor: Mount = { kind: "floor" };

const SPECS: Spec[] = [
  { n: 1, name: "Sala 1", type: "parRgbw", address: 1, mount: floating, at: { x: -3, y: -5, z: 5 } },
  { n: 2, name: "Sala 2", type: "parRgbw", address: 5, mount: floating, at: { x: -1, y: -5, z: 5.2 } },
  { n: 3, name: "Sala 3", type: "parRgbw", address: 9, mount: floating, at: { x: 1, y: -5, z: 5.2 } },
  { n: 4, name: "Sala 4", type: "parRgbw", address: 13, mount: floating, at: { x: 3, y: -5, z: 5 } },
  { n: 5, name: "PC sinistra", type: "pc", address: 17, mount: truss("tr-1"), at: { x: -2.5, y: 1.2, z: 4.5 } },
  { n: 6, name: "PC centro", type: "pc", address: 18, mount: truss("tr-1"), at: { x: 0, y: 1.2, z: 4.5 } },
  { n: 7, name: "PC destra", type: "pc", address: 19, mount: truss("tr-1"), at: { x: 2.5, y: 1.2, z: 4.5 }, unused: true },
  { n: 8, name: "Controluce sinistra", type: "par7", address: 21, mount: truss("tr-2"), at: { x: -2, y: 4, z: 4.6 }, aim: { x: -1.5, y: 1.8, z: 1.5 } },
  { n: 9, name: "Controluce destra", type: "par7", address: 28, mount: truss("tr-2"), at: { x: 2, y: 4, z: 4.6 }, aim: { x: 1.5, y: 1.8, z: 1.5 } },
  { n: 10, name: "Taglio sinistra", type: "profile", address: 35, mount: floor, at: { x: -4.6, y: 2.5, z: 1.2 } },
  { n: 11, name: "Taglio destra", type: "profile", address: 36, mount: floor, at: { x: 4.6, y: 2.5, z: 1.2 } },
  { n: 12, name: "Testa mobile sinistra", type: "washMover", address: 41, mount: truss("tr-2"), at: { x: -3.2, y: 4, z: 4.6 }, aim: { x: -1, y: 2.5, z: 0 } },
  { n: 13, name: "Testa mobile destra", type: "washMover", address: 52, mount: truss("tr-2"), at: { x: 3.2, y: 4, z: 4.6 }, aim: { x: 1, y: 2.5, z: 0 } },
  { n: 14, name: "Barra del fondale", type: "ledBar", address: 63, mount: floor, at: { x: 0, y: 5.7, z: 0.1 }, aim: { x: 0, y: 5.95, z: 4 } },
  { n: 15, name: "Fumo", type: "smoke", address: 70, mount: floor, at: { x: -3.5, y: 5.4, z: 0 }, aim: { x: 0, y: 3, z: 0.3 } },
];

const fxId = (n: number) => `fx-${String(n).padStart(2, "0")}`;

function fixtures(): Fixture[] {
  return SPECS.map((s) => ({
    id: fxId(s.n),
    number: s.n,
    name: s.name,
    typeId: s.type,
    universe: 1,
    address: s.address,
    channels: defaultChannels(s.type),
    mount: s.mount,
    position: s.at,
    beam: { angle: fixtureType(s.type).beam },
    aim: s.aim ?? defaultAim(s.at, s.mount, STAGE),
    unused: !!s.unused,
    broken: false,
  }));
}

const SCENERY: Scenery[] = [
  { id: "sc-backdrop", name: "Fondale", shape: "plane", position: { x: 0, y: 5.95, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, size: { x: 8, y: 0, z: 4 }, color: "#3A3F4F" },
  { id: "sc-counter", name: "Bancone della locanda", shape: "box", position: { x: -2.2, y: 4.2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, size: { x: 2.4, y: 0.6, z: 1.1 }, color: "#7A5234" },
  { id: "sc-table", name: "Tavolo", shape: "box", position: { x: 0.8, y: 2.6, z: 0 }, rotation: { x: 0, y: 0, z: 8 }, size: { x: 1.4, y: 0.8, z: 0.75 }, color: "#8B6A45" },
  { id: "sc-chair", name: "Sedia", shape: "box", position: { x: 0.8, y: 1.9, z: 0 }, rotation: { x: 0, y: 0, z: -10 }, size: { x: 0.45, y: 0.45, z: 0.9 }, color: "#6E4F33" },
  { id: "sc-lamp", name: "Lampione", shape: "cylinder", position: { x: 3.2, y: 4.8, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, size: { x: 0.2, y: 0.2, z: 2.6 }, color: "#2E3138" },
];

/** What a light does in a look: Main, colour, position, smoke. Missing = 0 (pan/tilt default to the centre). */
interface Look {
  dim?: number;
  r?: number;
  g?: number;
  b?: number;
  w?: number;
  a?: number;
  uv?: number;
  pan?: number;
  tilt?: number;
  smoke?: number;
  fan?: number;
}

function valuesFor(f: Fixture, look: Look | undefined): number[] {
  const l = look ?? {};
  const map: Partial<Record<ChannelFunction, number>> = {
    dimmer: l.dim ?? 0,
    red: l.r ?? 0,
    green: l.g ?? 0,
    blue: l.b ?? 0,
    white: l.w ?? 0,
    amber: l.a ?? 0,
    uv: l.uv ?? 0,
    pan: l.pan ?? 128,
    tilt: l.tilt ?? 128,
    smoke: l.smoke ?? 0,
    fan: l.fan ?? 0,
  };
  return f.channels.map((c) => map[c.function] ?? 0);
}

const all = (ns: number[], look: Look): Record<number, Look> => Object.fromEntries(ns.map((n) => [n, look]));
const HOUSE = [1, 2, 3, 4];

interface MemorySpec {
  n: number;
  label: string;
  note?: string;
  looks: Record<number, Look>;
  scenery: string[];
  transition: Partial<Transition>;
}

const SET = ["sc-backdrop", "sc-counter", "sc-table", "sc-chair"];

const MEMORIES: MemorySpec[] = [
  {
    n: 1,
    label: "Preset di sala",
    note: "Pubblico in sala, sipario aperto",
    looks: { ...all(HOUSE, { r: 90, g: 50, b: 10, w: 60 }), 14: { dim: 80, b: 255 } },
    scenery: SET,
    transition: {},
  },
  {
    n: 2,
    label: "Atto I · La locanda al mattino",
    looks: {
      ...all(HOUSE, { r: 255, g: 200, b: 120, w: 255 }),
      5: { dim: 230 },
      6: { dim: 230 },
      8: { dim: 200, a: 180, w: 120 },
      9: { dim: 200, a: 180, w: 120 },
      10: { dim: 160 },
      11: { dim: 160 },
    },
    scenery: SET,
    transition: { fadeIn: 5, fadeOut: 3 },
  },
  {
    n: 3,
    label: "Il Cavaliere di Ripafratta",
    looks: {
      ...all(HOUSE, { r: 150, g: 180, b: 255, w: 200 }),
      5: { dim: 120 },
      6: { dim: 120 },
      8: { dim: 180, b: 255, w: 60 },
      9: { dim: 180, b: 255, w: 60 },
      10: { dim: 230 },
      11: { dim: 230 },
      12: { dim: 200, w: 255, pan: 100, tilt: 140 },
    },
    scenery: SET,
    transition: {},
  },
  {
    n: 4,
    label: "Mirandolina sola",
    note: "Sul monologo del primo atto",
    looks: { ...all(HOUSE, { r: 40, g: 30, b: 20, w: 40 }), 6: { dim: 255 }, 13: { dim: 255, r: 255, g: 170, b: 110, pan: 150, tilt: 120 } },
    scenery: SET,
    transition: { fadeIn: 4, fadeOut: 2, delay: 0.5 },
  },
  {
    n: 5,
    label: "Il Conte e il Marchese",
    looks: {
      ...all(HOUSE, { r: 255, g: 180, b: 90, w: 200 }),
      5: { dim: 200 },
      6: { dim: 200 },
      8: { dim: 160, a: 255 },
      9: { dim: 160, a: 255 },
      10: { dim: 255 },
      11: { dim: 255 },
    },
    scenery: SET,
    transition: {},
  },
  {
    n: 6,
    label: "Atto II · Il pranzo",
    note: "Parte da sola verso il tramonto",
    looks: {
      ...all(HOUSE, { r: 255, g: 160, b: 40, w: 120 }),
      5: { dim: 255 },
      6: { dim: 255 },
      8: { dim: 220, a: 255, r: 120 },
      9: { dim: 220, a: 255, r: 120 },
      12: { dim: 160, r: 255, g: 140, b: 30 },
      13: { dim: 160, r: 255, g: 140, b: 30 },
    },
    scenery: SET,
    transition: { fadeIn: 4, fadeOut: 4, autoFollow: true },
  },
  {
    n: 7,
    label: "Tramonto",
    looks: {
      ...all(HOUSE, { r: 200, g: 70 }),
      5: { dim: 80 },
      6: { dim: 80 },
      8: { dim: 255, r: 255, a: 200 },
      9: { dim: 255, r: 255, a: 200 },
      14: { dim: 255, r: 255, g: 60 },
    },
    scenery: SET,
    transition: { fadeIn: 8, fadeOut: 6, delay: 1 },
  },
  {
    n: 8,
    label: "Notte · Atto III",
    note: "Fumo leggero: accendere la macchina dieci minuti prima",
    looks: {
      ...all(HOUSE, { g: 30, b: 140 }),
      8: { dim: 200, b: 255, uv: 120 },
      9: { dim: 200, b: 255, uv: 120 },
      12: { dim: 180, b: 255, w: 40, pan: 60, tilt: 150 },
      13: { dim: 180, b: 255, w: 40, pan: 200, tilt: 150 },
      14: { dim: 120, b: 255 },
      15: { smoke: 90, fan: 120 },
    },
    scenery: ["sc-backdrop", "sc-counter", "sc-lamp"],
    transition: { fadeIn: 5, fadeOut: 5, moveInDark: true },
  },
  {
    n: 9,
    label: "Finale e inchini",
    looks: {
      ...all(HOUSE, { r: 255, g: 255, b: 255, w: 255 }),
      5: { dim: 255 },
      6: { dim: 255 },
      8: { dim: 255, w: 255, a: 100 },
      9: { dim: 255, w: 255, a: 100 },
      10: { dim: 255 },
      11: { dim: 255 },
      12: { dim: 255, w: 255 },
      13: { dim: 255, w: 255 },
      14: { dim: 200, r: 255, g: 255, b: 255 },
    },
    scenery: [...SET, "sc-lamp"],
    transition: { fadeIn: 2, fadeOut: 2 },
  },
];

function placement(id: string): SceneryPlacement {
  const s = SCENERY.find((x) => x.id === id)!;
  return { sceneryId: id, position: { ...s.position }, rotation: { ...s.rotation } };
}

/** A fresh copy of the demo show (memories bound to the DMX addresses, as by default). */
export function demoDoc(): GranveloDoc {
  const fx = fixtures();
  const base = { fixtures: fx };
  const memories: Memory[] = MEMORIES.map((m) => {
    const values: FixtureValues = {};
    for (const f of fx) values[f.id] = valuesFor(f, m.looks[f.number]);
    return {
      id: `mem-${m.n}`,
      number: m.n,
      label: m.label,
      note: m.note ?? "",
      state: captureState(base, values, "address"),
      scenery: m.scenery.map(placement),
      transition: { fadeIn: 3, fadeOut: 3, delay: 0, autoFollow: false, moveInDark: false, ...m.transition },
    };
  });
  return {
    id: "demo-locandiera",
    title: "La locandiera",
    stage: { ...STAGE },
    trusses: TRUSSES.map((t) => ({ ...t })),
    fixtures: fx,
    scenery: SCENERY.map((s) => ({ ...s, position: { ...s.position }, rotation: { ...s.rotation }, size: { ...s.size } })),
    groups: [
      { id: "gr-house", name: "Sala", fixtureIds: [fxId(1), fxId(2), fxId(3), fxId(4)], level: 255 },
      { id: "gr-wash", name: "Piazzato", fixtureIds: [fxId(5), fxId(6), fxId(7)], level: 255 },
      { id: "gr-back", name: "Controluci", fixtureIds: [fxId(8), fxId(9), fxId(14)], level: 255 },
      { id: "gr-cuts", name: "Tagli", fixtureIds: [fxId(10), fxId(11)], level: 255 },
    ],
    memories,
    sequence: memories.map((m) => m.id),
    settings: { ...DEFAULT_DOC_SETTINGS },
    extra: {},
  };
}

/** The demo show is shown in the title bar as if it were inside a show of the launcher. */
export const DEMO_SHOW = { id: "demo", title: "La locandiera", color: "#7a2e4a", dir: "C:\\Spettacoli\\La locandiera" };
