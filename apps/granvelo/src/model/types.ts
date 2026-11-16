/**
 * The Granvelo document (`.granvelo`, JSON, format 1). Pure data: no React, no Tauri.
 *
 * Conventions that every later phase relies on (do not change without changing format 1 in place,
 * the demo show and the tests):
 *
 * - **Ids** are opaque strings, stable for the life of the document (never recomputed, never reused).
 *   Everything that points to something else points by id. User-facing numbers (light number,
 *   memory number) are separate fields and can change freely.
 * - **Coordinates** are metres. Origin = centre of the proscenium line (the front edge of the stage),
 *   on the stage floor. **X** left → right as seen from the audience (stage spans −width/2 … +width/2);
 *   **Y** depth, 0 at the proscenium, positive towards the back wall (stage spans 0 … depth; lights in the
 *   house have Y < 0); **Z** height above the stage floor (0 = floor).
 * - **Rotations** are degrees around X, Y, Z (applied in this order).
 * - **DMX** values are integers 0–255. Channels and addresses are 1-based (1–512) as written on the
 *   lights; arrays indexed by channel use index = channel − 1.
 * - **One universe**: every light has `universe: 1`. The field exists so that more universes can come later
 *   without changing the shape of a light.
 * - Groups and the Grand Master are **masters** applied on the way out (see `universe.ts`): they are not part
 *   of a memory. A memory stores what the faders of the lights say.
 */

export const APP_ID = "granvelo";
export const FILE_FORMAT = 1;
export const UNIVERSE_SIZE = 512;
export const DMX_MAX = 255;

export type Id = string;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Stage volume in metres (a box: floor drawn solid, the rest with thin lines). */
export interface Stage {
  width: number;
  depth: number;
  height: number;
}

/**
 * A truss (americana): a horizontal bar across the whole width, at depth `y` and height `z`.
 * `name` null = automatic name from its order front to back ("1ª americana", "2ª americana"…),
 * so moving it keeps the numbering right; a name typed by the user is kept as written.
 */
export interface Truss {
  id: Id;
  name: string | null;
  y: number;
  z: number;
}

/**
 * What a DMX channel of a light does. A closed list (the interface knows how to draw each one),
 * extensible by adding a name here and in `CHANNEL_INFO` (fixtureTypes.ts). An unknown function
 * read from a file becomes `other` with its original name kept as label.
 */
export const CHANNEL_FUNCTIONS = [
  "dimmer",
  "red",
  "green",
  "blue",
  "white",
  "amber",
  "uv",
  "pan",
  "panFine",
  "tilt",
  "tiltFine",
  "strobe",
  "speed",
  "colorWheel",
  "gobo",
  "zoom",
  "focus",
  "smoke",
  "fan",
  "macro",
  "other",
] as const;
export type ChannelFunction = (typeof CHANNEL_FUNCTIONS)[number];

/** One channel of a light, in DMX order (the first is at the light's address). */
export interface Channel {
  function: ChannelFunction;
  /** Shown instead of the function's name ("Main", "Rosso"…) when the user wrote one. */
  label?: string;
}

/** Built-in types of light (see fixtureTypes.ts). New types are added there with their own symbol. */
export const FIXTURE_TYPE_IDS = [
  "halogen",
  "pc",
  "profile",
  "parRgb",
  "parRgbw",
  "par6",
  "par7",
  "ledBar",
  "washMover",
  "spotMover",
  "strobe",
  "smoke",
] as const;
export type FixtureTypeId = (typeof FIXTURE_TYPE_IDS)[number];

/** Where a light is: hanging on a truss (magnet), floating (in the house, between the wings…) or standing on the floor. */
export type Mount = { kind: "truss"; trussId: Id } | { kind: "floating" } | { kind: "floor" };

export interface Fixture {
  id: Id;
  /** Number of the light for people (in lists, prints, the desk). Unique positive integer; never recomputed by removals. */
  number: number;
  name: string;
  typeId: FixtureTypeId;
  /** Always 1 for now (one universe). */
  universe: 1;
  /** First DMX channel (1–512) as set on the light, or null = not addressed yet. */
  address: number | null;
  /** The channels of this light in DMX order; initialised from the type, changeable per light. */
  channels: Channel[];
  mount: Mount;
  /** Position of the light (metres, see the conventions above). On a truss, `y` and `z` follow the truss. */
  position: Vec3;
  /** Full beam angle in degrees. */
  beam: { angle: number };
  /**
   * Where the light points: the point it looks at (metres). For fixed lights it is their focus; for moving
   * heads it is where they look with pan/tilt at the centre of their range. A target point (rather than
   * pan/tilt angles) does not depend on how the light is hung, and stays meaningful when it is moved.
   */
  aim: Vec3;
  /** "Not used in this production": stays in the drawing, greyed; its addresses stay reserved; it sends nothing. */
  unused: boolean;
  /** Marked as not working by "Controllo luci". Only a mark: it changes nothing in the output. */
  broken: boolean;
}

export type SceneryShape = "box" | "cone" | "sphere" | "plane" | "cylinder";

/**
 * A scenery piece. `position` is the centre of its base (on the floor when z = 0); `size` is width (X) ×
 * depth (Y) × height (Z) in metres (a plane uses width × height, depth 0; cone, sphere and cylinder use X as
 * diameter).
 */
export interface Scenery {
  id: Id;
  name: string;
  shape: SceneryShape;
  position: Vec3;
  rotation: Vec3;
  size: Vec3;
  /** `#rrggbb`. */
  color: string;
}

/** A group of lights with its fader (a master: 255 = lights as they are, 0 = their intensity at zero). */
export interface Group {
  id: Id;
  name: string;
  fixtureIds: Id[];
  /** 0–255. */
  level: number;
}

/**
 * How memories remember the lights (setting of the document):
 * - `address` (default, like a real desk): a memory is what goes out on the 512 DMX channels. Changing
 *   the address of a light does not change the memory: the light now reads other channels.
 * - `fixture`: a memory remembers each light by id and channel position. Changing an address does not spoil
 *   the memories: they follow the light.
 */
export type MemoryBinding = "address" | "fixture";

/** Values of each light, by id: one 0–255 value per channel, in the light's channel order. */
export type FixtureValues = Record<Id, number[]>;

/**
 * The full state of the lights saved in a memory. Exactly one representation is the truth, chosen by the
 * document setting `memoryBinding` (all memories of a document use the same):
 * - `address`: `dmx` holds the 512 channels (index = channel − 1). Values of channels that no light uses
 *   are kept too.
 * - `fixture`: `fixtures` holds, for each light, its values in channel order. Lights missing from it are at 0.
 * Switching the setting converts every memory with the current patch (see `memories.ts`).
 */
export type MemoryState = { binding: "address"; dmx: number[] } | { binding: "fixture"; fixtures: FixtureValues };

/** A scenery piece on stage in a memory, where it stands then. Pieces not listed are off stage. */
export interface SceneryPlacement {
  sceneryId: Id;
  position: Vec3;
  rotation: Vec3;
}

/**
 * How the stage goes to this memory (see crossfade.ts):
 * channels that rise take `fadeIn` seconds, channels that fall take `fadeOut`, both start after `delay`.
 * `autoFollow`: at the end of the transition the next memory of the sequence starts by itself.
 * `moveInDark`: moving heads that are dark change position (and colour, gobo…) while dark instead of in view.
 */
export interface Transition {
  fadeIn: number;
  fadeOut: number;
  delay: number;
  autoFollow: boolean;
  moveInDark: boolean;
}

export interface Memory {
  id: Id;
  /** Chosen by the user: unique positive integer, no decimals. */
  number: number;
  label: string;
  note: string;
  state: MemoryState;
  scenery: SceneryPlacement[];
  transition: Transition;
}

/** Settings that belong to the show (saved in the file), not to the computer. */
export interface DocSettings {
  memoryBinding: MemoryBinding;
  /** Seconds; used for new memories. */
  defaultCrossfade: number;
  /** Memory played by "Emergenza"; null = all lights white at full. */
  emergencyMemoryId: Id | null;
}

export interface GranveloDoc {
  id: Id;
  title: string;
  stage: Stage;
  trusses: Truss[];
  fixtures: Fixture[];
  scenery: Scenery[];
  groups: Group[];
  memories: Memory[];
  /** Memory ids in show order (a memory may be left out of the sequence; none appears twice). */
  sequence: Id[];
  settings: DocSettings;
  /** Unknown top-level keys read from the file, written back unchanged. */
  extra: Record<string, unknown>;
}

export const DEFAULT_STAGE: Stage = { width: 8, depth: 6, height: 4.5 };

export const DEFAULT_DOC_SETTINGS: DocSettings = {
  memoryBinding: "address",
  defaultCrossfade: 3,
  emergencyMemoryId: null,
};
