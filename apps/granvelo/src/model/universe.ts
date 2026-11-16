import { occupiedChannels } from "./addresses";
import { CHANNEL_INFO, COLOR_FUNCTIONS, LIGHT_COLORS, fixtureType } from "./fixtureTypes";
import { DMX_MAX, UNIVERSE_SIZE, type ChannelFunction, type Fixture, type FixtureValues, type GranveloDoc, type Id } from "./types";

/**
 * From the faders to the 512 values that go on the DMX cable. Pure functions; the Rust engine of phase 1
 * receives the result (or mirrors these rules).
 *
 * The pipeline has two steps:
 * 1. **patch** — the values of each light are written at its address (`patchValues`). A light "not used in
 *    this production" writes nothing. Where two lights share a channel (a conflict) the higher value wins
 *    (HTP), so the result never depends on the order of the lights.
 * 2. **masters** — groups and the Grand Master scale the **intensity channels** (`applyMasters`):
 *    - a light's intensity channels are its `dimmer` channels; a light without any `dimmer` channel has its
 *      colour channels (red, green, blue, white, amber, UV) as intensity, so a group can dim an RGB PAR;
 *    - the factor of a light = product of (level / 255) of every group it belongs to × (Grand Master / 255).
 *      Two groups at half bring a light in both to a quarter; a light in no group follows only the Grand Master;
 *    - pan/tilt, strobe, gobo, smoke… are never scaled (Grand Master at zero = no light, but the smoke machine
 *      and the positions are untouched);
 *    - a channel that is intensity for several lights (conflict) takes the largest factor among them; channels
 *      of no light are not scaled;
 *    - result = floor(value × factor + 0.5) — the same rounding the Rust engine uses.
 */

export interface Masters {
  /** Level 0–255 of each group, by group id. Groups missing here use the level saved in the group. */
  groups?: Record<Id, number>;
  /** 0–255; default 255. */
  grandMaster?: number;
}

const clampDmx = (v: number) => (Number.isFinite(v) ? Math.min(DMX_MAX, Math.max(0, Math.floor(v + 0.5))) : 0);

/** Values of a light, the right length (missing values = 0, extra values dropped). */
export function valuesOf(f: Fixture, values: FixtureValues): number[] {
  const v = values[f.id] ?? [];
  return f.channels.map((_, i) => clampDmx(v[i] ?? 0));
}

/** Indexes (in the light's channel order) of the channels that make the light brighter. */
export function intensityIndexes(f: Pick<Fixture, "channels">): number[] {
  const dimmers = f.channels.flatMap((c, i) => (c.function === "dimmer" ? [i] : []));
  if (dimmers.length) return dimmers;
  return f.channels.flatMap((c, i) => (COLOR_FUNCTIONS.includes(c.function) ? [i] : []));
}

/** Step 1: writes the values of every used light at its address (HTP on conflicts). */
export function patchValues(doc: Pick<GranveloDoc, "fixtures">, values: FixtureValues): Uint8Array {
  const out = new Uint8Array(UNIVERSE_SIZE);
  for (const f of doc.fixtures) {
    if (f.unused) continue;
    const v = valuesOf(f, values);
    occupiedChannels(f).forEach((ch, i) => {
      if (v[i] > out[ch - 1]) out[ch - 1] = v[i];
    });
  }
  return out;
}

/** The factor (0–1) of every used light given the masters. */
export function fixtureFactors(doc: Pick<GranveloDoc, "fixtures" | "groups">, masters: Masters = {}): Map<Id, number> {
  const gm = (masters.grandMaster ?? DMX_MAX) / DMX_MAX;
  const factors = new Map<Id, number>();
  for (const f of doc.fixtures) if (!f.unused) factors.set(f.id, gm);
  for (const g of doc.groups) {
    const level = (masters.groups?.[g.id] ?? g.level) / DMX_MAX;
    for (const id of new Set(g.fixtureIds)) if (factors.has(id)) factors.set(id, factors.get(id)! * level);
  }
  return factors;
}

/** Step 2: scales the intensity channels of `raw` (a copy is returned; `raw` is not changed). */
export function applyMasters(doc: Pick<GranveloDoc, "fixtures" | "groups">, raw: Uint8Array, masters: Masters = {}): Uint8Array {
  const out = new Uint8Array(raw);
  const factors = fixtureFactors(doc, masters);
  const channelFactor = new Map<number, number>();
  for (const f of doc.fixtures) {
    const k = factors.get(f.id);
    if (k === undefined) continue;
    const chans = occupiedChannels(f);
    for (const i of intensityIndexes(f)) {
      const ch = chans[i];
      if (ch === undefined) continue;
      channelFactor.set(ch, Math.max(channelFactor.get(ch) ?? 0, k));
    }
  }
  for (const [ch, k] of channelFactor) out[ch - 1] = clampDmx(raw[ch - 1] * k);
  return out;
}

/** Light values + masters → the 512 values on the cable. */
export function renderUniverse(doc: Pick<GranveloDoc, "fixtures" | "groups">, values: FixtureValues, masters: Masters = {}): Uint8Array {
  return applyMasters(doc, patchValues(doc, values), masters);
}

/** Reads back the values of each light from 512 values (the inverse of the patch; lights without address get zeros). */
export function readValues(doc: Pick<GranveloDoc, "fixtures">, dmx: ArrayLike<number>): FixtureValues {
  const out: FixtureValues = {};
  for (const f of doc.fixtures) {
    const chans = occupiedChannels(f);
    out[f.id] = f.channels.map((_, i) => (chans[i] === undefined ? 0 : clampDmx(dmx[chans[i] - 1] ?? 0)));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Colour                                                               */
/* ------------------------------------------------------------------ */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const hexToRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

export const rgbToHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((v) => clampDmx(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

export function parseHex(hex: string): Rgb | null {
  return /^#[0-9a-f]{6}$/i.test(hex) ? hexToRgb(hex) : null;
}

/** Amber of an LED, as a share of red and green: amber light ≈ (255, 191, 0). */
const AMBER_GREEN = 191 / 255;

/**
 * Colour picker: sets R, G, B (and W, A where the light has them) to make `color`.
 * White takes the part common to R, G and B; amber then takes what is left of red with ~¾ of it in green.
 * UV and the Main are not touched (the picker chooses the colour, the Main the intensity).
 * A light with no colour channels is returned unchanged.
 */
export function setColor(f: Pick<Fixture, "channels">, values: number[], color: Rgb): number[] {
  const has = (fn: ChannelFunction) => f.channels.some((c) => c.function === fn);
  let { r, g, b } = { r: clampDmx(color.r), g: clampDmx(color.g), b: clampDmx(color.b) };
  let w = 0;
  let a = 0;
  if (has("white") && has("red") && has("green") && has("blue")) {
    w = Math.min(r, g, b);
    r -= w;
    g -= w;
    b -= w;
  }
  if (has("amber") && has("red") && has("green")) {
    a = Math.min(r, Math.floor(g / AMBER_GREEN));
    r -= a;
    g = Math.max(0, g - Math.round(a * AMBER_GREEN));
  }
  const target: Partial<Record<ChannelFunction, number>> = { red: r, green: g, blue: b, white: w, amber: a };
  return f.channels.map((c, i) => (c.function in target ? target[c.function]! : clampDmx(values[i] ?? 0)));
}

export interface VisibleLight {
  /** Colour of the light at full brightness (the hue; for the lens of the symbol and swatches). Null = makes no light. */
  hue: string | null;
  /** Brightness 0–1 (Main, or the colour channels for lights without a Main). */
  level: number;
  /** What the light looks like now: hue × level, `#rrggbb`. */
  color: string;
}

/**
 * The colour a light is making, from its channel values: colour channels mixed additively (white, amber and UV
 * with their own tint), times the Main if there is one. Lights without colour channels use the colour of their
 * type (halogen warm, spot white). For previews and the lens of the symbol, not for photometry.
 */
export function visibleLight(f: Pick<Fixture, "channels" | "typeId">, values: number[]): VisibleLight {
  const v = (i: number) => clampDmx(values[i] ?? 0) / DMX_MAX;
  let mix: Rgb = { r: 0, g: 0, b: 0 };
  let hasColor = false;
  let dimmer: number | null = null;
  f.channels.forEach((c, i) => {
    const x = v(i);
    const add = (hex: string, k = 1) => {
      const t = hexToRgb(hex);
      mix = { r: mix.r + t.r * x * k, g: mix.g + t.g * x * k, b: mix.b + t.b * x * k };
    };
    switch (c.function) {
      case "dimmer":
        dimmer = Math.max(dimmer ?? 0, x);
        break;
      case "red":
        hasColor = true;
        mix.r += 255 * x;
        break;
      case "green":
        hasColor = true;
        mix.g += 255 * x;
        break;
      case "blue":
        hasColor = true;
        mix.b += 255 * x;
        break;
      case "white":
        hasColor = true;
        add(LIGHT_COLORS.white);
        break;
      case "amber":
        hasColor = true;
        add("#FFBF00");
        break;
      case "uv":
        hasColor = true;
        add(LIGHT_COLORS.uv, 0.6);
        break;
      default:
        break;
    }
  });
  const base = fixtureType(f.typeId).baseColor;
  let hue: Rgb | null;
  let level: number;
  if (hasColor) {
    const peak = Math.max(mix.r, mix.g, mix.b);
    level = Math.min(1, peak / 255) * (dimmer ?? 1);
    hue = peak > 0 ? { r: (mix.r / peak) * 255, g: (mix.g / peak) * 255, b: (mix.b / peak) * 255 } : base ? hexToRgb(base) : hexToRgb(LIGHT_COLORS.white);
  } else if (base) {
    hue = hexToRgb(base);
    level = dimmer ?? 0;
  } else {
    hue = null;
    level = 0;
  }
  if (!hue) return { hue: null, level: 0, color: "#000000" };
  return { hue: rgbToHex(hue), level, color: rgbToHex({ r: hue.r * level, g: hue.g * level, b: hue.b * level }) };
}

/**
 * The colour for the lens of a light's symbol, from the 512 values on the cable: the colour it is making now, or null
 * when it makes no light (dark lens), has no address or is not used. A dim light is still shown a little (floor at
 * 15 % of its colour) so that a light at 5 % is not mistaken for one that is off.
 */
export function lensColor(f: Pick<Fixture, "channels" | "typeId" | "address" | "unused">, dmx: ArrayLike<number>): string | null {
  if (f.unused || f.address === null) return null;
  const values = f.channels.map((_, i) => (f.address! + i <= UNIVERSE_SIZE ? (dmx[f.address! + i - 1] ?? 0) : 0));
  const v = visibleLight(f, values);
  if (!v.hue || v.level <= 0) return null;
  if (v.level >= 0.15) return v.color;
  const h = parseHex(v.hue)!;
  return rgbToHex({ r: h.r * 0.15, g: h.g * 0.15, b: h.b * 0.15 });
}

/** Is this a channel that the Grand Master and the groups scale for this light? */
export function isIntensityChannel(f: Pick<Fixture, "channels">, index: number): boolean {
  return intensityIndexes(f).includes(index);
}

/** Does the light have pan or tilt (a moving head, for "move in dark")? */
export function isMover(f: Pick<Fixture, "channels">): boolean {
  return f.channels.some((c) => CHANNEL_INFO[c.function].kind === "position");
}

/**
 * "Emergenza" without a chosen memory: every used light white at full — Main, red, green, blue and white at 255
 * (the brightest white an LED can make), amber and UV off, strobe at 0 (no flashing), smoke and fan off. Positions,
 * gobos and the rest keep the values of `current` (moving heads do not swing around).
 */
export function emergencyValues(doc: Pick<GranveloDoc, "fixtures">, current: FixtureValues = {}): FixtureValues {
  const out: FixtureValues = {};
  for (const f of doc.fixtures) {
    if (f.unused) continue;
    const now = valuesOf(f, current);
    out[f.id] = f.channels.map((c, i) => {
      switch (c.function) {
        case "dimmer":
        case "white":
        case "red":
        case "green":
        case "blue":
          return DMX_MAX;
        case "amber":
        case "uv":
        case "strobe":
        case "smoke":
        case "fan":
          return 0;
        default:
          return now[i];
      }
    });
  }
  return out;
}
