import type { Channel, ChannelFunction, FixtureTypeId } from "./types";

/**
 * What the interface needs to know about each channel function.
 * `label` is an English text of the interface (translated with t()); `color` is the **colour of the light**
 * used only as fader fill, channel swatch and lens colour (02_design.md, "Eccezione: i colori della luce"),
 * never on buttons or status pills. `intensity`: the channel makes light brighter (see universe.ts).
 */
export interface ChannelInfo {
  label: string;
  color: string;
  /** Kind of channel, used by the output and the crossfade. */
  kind: "intensity" | "color" | "position" | "beam" | "effect";
}

/** Light colours of the design (02_design.md). Amber is a light swatch, deliberately more orange than the suite's attention amber (#FFB224). */
export const LIGHT_COLORS = {
  red: "#F2484B",
  green: "#3DD66A",
  blue: "#3D7BFF",
  white: "#F4F1EA",
  amber: "#FF8A1F",
  uv: "#9B5CFF",
  halogen: "#FFD9A0",
  position: "#6B6F7A",
  neutral: "#8E93A0",
} as const;

export const CHANNEL_INFO: Record<ChannelFunction, ChannelInfo> = {
  dimmer: { label: "Main", color: LIGHT_COLORS.halogen, kind: "intensity" },
  red: { label: "Red", color: LIGHT_COLORS.red, kind: "color" },
  green: { label: "Green", color: LIGHT_COLORS.green, kind: "color" },
  blue: { label: "Blue", color: LIGHT_COLORS.blue, kind: "color" },
  white: { label: "White", color: LIGHT_COLORS.white, kind: "color" },
  amber: { label: "Amber", color: LIGHT_COLORS.amber, kind: "color" },
  uv: { label: "UV", color: LIGHT_COLORS.uv, kind: "color" },
  pan: { label: "Pan", color: LIGHT_COLORS.position, kind: "position" },
  panFine: { label: "Pan fine", color: LIGHT_COLORS.position, kind: "position" },
  tilt: { label: "Tilt", color: LIGHT_COLORS.position, kind: "position" },
  tiltFine: { label: "Tilt fine", color: LIGHT_COLORS.position, kind: "position" },
  strobe: { label: "Strobe", color: LIGHT_COLORS.neutral, kind: "effect" },
  speed: { label: "Speed", color: LIGHT_COLORS.neutral, kind: "effect" },
  colorWheel: { label: "Colour wheel", color: LIGHT_COLORS.neutral, kind: "beam" },
  gobo: { label: "Gobo", color: LIGHT_COLORS.neutral, kind: "beam" },
  zoom: { label: "Zoom", color: LIGHT_COLORS.neutral, kind: "beam" },
  focus: { label: "Focus", color: LIGHT_COLORS.neutral, kind: "beam" },
  smoke: { label: "Smoke", color: LIGHT_COLORS.neutral, kind: "effect" },
  fan: { label: "Fan", color: LIGHT_COLORS.neutral, kind: "effect" },
  macro: { label: "Macro", color: LIGHT_COLORS.neutral, kind: "effect" },
  other: { label: "Other", color: LIGHT_COLORS.neutral, kind: "effect" },
};

/** The colour channels a colour picker sets and that make the visible colour. */
export const COLOR_FUNCTIONS: ChannelFunction[] = ["red", "green", "blue", "white", "amber", "uv"];

/** The flat symbol drawn for a light (10_granvelo.md, "Simboli delle luci"). */
export type SymbolKind = "par" | "pc" | "profile" | "wash" | "spot" | "bar" | "strobe" | "smoke";

export interface FixtureType {
  id: FixtureTypeId;
  /** English name of the interface (translated with t()). */
  name: string;
  symbol: SymbolKind;
  /** Default channels, in DMX order. */
  channels: ChannelFunction[];
  /** Default full beam angle in degrees. */
  beam: number;
  /** Colour of the light when it has no colour channels (halogen warm, white…); null = makes no light (smoke). */
  baseColor: string | null;
}

export const FIXTURE_TYPES: FixtureType[] = [
  { id: "halogen", name: "Halogen (dimmer)", symbol: "pc", channels: ["dimmer"], beam: 40, baseColor: LIGHT_COLORS.halogen },
  { id: "pc", name: "PC", symbol: "pc", channels: ["dimmer"], beam: 30, baseColor: LIGHT_COLORS.halogen },
  { id: "profile", name: "Profile spot", symbol: "profile", channels: ["dimmer"], beam: 26, baseColor: LIGHT_COLORS.halogen },
  { id: "parRgb", name: "LED PAR RGB", symbol: "par", channels: ["red", "green", "blue"], beam: 25, baseColor: null },
  { id: "parRgbw", name: "LED PAR RGBW", symbol: "par", channels: ["red", "green", "blue", "white"], beam: 25, baseColor: null },
  { id: "par6", name: "LED PAR 6 channels", symbol: "par", channels: ["dimmer", "red", "green", "blue", "strobe", "macro"], beam: 25, baseColor: null },
  { id: "par7", name: "LED PAR 7 channels", symbol: "par", channels: ["dimmer", "red", "green", "blue", "white", "amber", "uv"], beam: 25, baseColor: null },
  { id: "ledBar", name: "LED bar", symbol: "bar", channels: ["dimmer", "red", "green", "blue", "strobe"], beam: 40, baseColor: null },
  {
    id: "washMover",
    name: "Moving head wash",
    symbol: "wash",
    channels: ["pan", "panFine", "tilt", "tiltFine", "speed", "dimmer", "strobe", "red", "green", "blue", "white"],
    beam: 20,
    baseColor: null,
  },
  {
    id: "spotMover",
    name: "Moving head spot",
    symbol: "spot",
    channels: ["pan", "panFine", "tilt", "tiltFine", "speed", "dimmer", "strobe", "colorWheel", "gobo", "focus"],
    beam: 15,
    baseColor: LIGHT_COLORS.white,
  },
  { id: "strobe", name: "Strobe", symbol: "strobe", channels: ["dimmer", "strobe"], beam: 90, baseColor: LIGHT_COLORS.white },
  { id: "smoke", name: "Smoke machine", symbol: "smoke", channels: ["smoke", "fan"], beam: 60, baseColor: null },
];

const BY_ID = new Map(FIXTURE_TYPES.map((t) => [t.id, t]));

export function fixtureType(id: FixtureTypeId): FixtureType {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`Unknown fixture type ${id}`);
  return t;
}

export function isFixtureTypeId(v: unknown): v is FixtureTypeId {
  return typeof v === "string" && BY_ID.has(v as FixtureTypeId);
}

/** Fresh channel list of a type (new objects: a light's channels can then be changed on their own). */
export function defaultChannels(id: FixtureTypeId): Channel[] {
  return fixtureType(id).channels.map((f) => ({ function: f }));
}

/** Colour of a channel's fader and swatch. The Main of a light with colour channels is white, of a halogen warm. */
export function channelColor(fn: ChannelFunction, typeId: FixtureTypeId): string {
  if (fn === "dimmer") return fixtureType(typeId).baseColor ?? LIGHT_COLORS.white;
  return CHANNEL_INFO[fn].color;
}

/** Label shown for a channel (an English text to translate, unless the user wrote one). */
export function channelLabel(ch: Channel): { text: string; custom: boolean } {
  return ch.label ? { text: ch.label, custom: true } : { text: CHANNEL_INFO[ch.function].label, custom: false };
}
