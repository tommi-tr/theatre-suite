# Granvelo — developer notes

Granvelo is the lighting app of the Theatre Suite (`apps/granvelo`, identifier `it.theatresuite.granvelo`,
dev port **1423**, file `.granvelo`). Specification: `10_granvelo.md`; visual identity: `02_design.md`
(both copied here from the project documents).

## Run it

```
pnpm install                         # at the repo root
pnpm --filter granvelo dev           # browser preview on http://localhost:1423 (/?demo = La locandiera)
pnpm granvelo:dev                    # the real window (Tauri)
pnpm granvelo:test                   # vitest: model, file format, crossfade, dictionary
pnpm --filter granvelo typecheck
pnpm --filter granvelo icons         # regenerate src-tauri/icons from the "Banco" geometry
cargo test -p granvelo --lib         # native side (storage, versions)
pnpm granvelo:build                  # Windows installer (NSIS, per user)
```

`/?demo` loads the demo show; `/?demo&start` opens the start screen. In the browser nothing can be saved or
opened (there is no file system); everything else works.

## Structure

```
src/model/       pure TypeScript, no React — the foundations of the next phases
  types.ts         the document (format 1) and its conventions (ids, metres, axes, 1-based channels)
  fixtureTypes.ts  built-in light types, channel functions with label, kind and light colour
  addresses.ts     channels occupied, conflicts, 512-cell map, next free address, numbering by clicks
  universe.ts      patch → masters (groups, Grand Master) → Uint8Array(512); colour picker; visible colour; emergency
  memories.ts      memory states in both bindings, conversion between them
  crossfade.ts     reference crossfade (fade in/out, delay, move in dark) — the Rust engine mirrors it
  ops.ts           document operations (add/remove light, channels, trusses, places, memories)
  file.ts          newDocument, serialize, parse (strict format 1, unknown top-level keys kept)
  demo.ts          La locandiera: 15 lights, 9 memories
src/store/       zustand: doc (undo/redo via packages/core History), settings (this computer), ui
src/lib/         Tauri calls, files (save/open/versions/autosave), version, formatting
src/shell/       title bar + top bar + status bar, start screen
src/modes/       Allestimento (list of lights + properties), Banco, Show (phase 0 screens)
src/common/      dialogs (Settings, Versions, New show), File menu, FixtureSymbol, ComingSoon
src-tauri/       storage commands as Cantinella + versions folder as Diaframma; suite-link
```

## Model decisions (format 1)

- **Coordinates**: metres; origin at the centre of the proscenium line on the stage floor. X left → right
  seen from the audience, Y depth (0 at the proscenium, positive upstage, house < 0), Z height.
- **Ids** are opaque, stable strings; user-facing numbers (`number` of lights and memories) are separate and
  never recomputed by removals. Every light has `universe: 1`.
- **Trusses**: `name: null` = automatic name from the order front to back ("1ª americana"…), so moving a truss
  keeps the numbering right. A light on a truss takes the truss's `y`/`z`.
- **Aim** is a target point (metres), not pan/tilt: independent of how the light is hung.
- **Channels** are per light (`channels: [{ function, label? }]`), initialised from the type. Functions are a
  closed list; an unknown function read from a file becomes `other` with its name as label.
- **Memories** store the full state in one of two bindings (document setting `memoryBinding`):
  `address` (default) = the 512 DMX values (`dmx`, index = channel − 1); `fixture` = values per light id and
  channel position. Switching converts all memories with the current patch (address → fixture drops values
  on channels of no light; fixture → address drops lights without an address). Read memories only through
  `stateValues` / `stateUniverse`, write with `captureState`.
- **Groups and Grand Master are masters**, applied on output, not recorded in memories. Intensity channels =
  `dimmer`, or the colour channels for a light without a `dimmer`. Factor = product of group levels × GM.
  Conflicting channels: HTP in the patch, largest factor in the masters.
- **Unused lights** keep their address (reserved: next free address skips them, the map shows them) but send
  nothing and are never in conflict. **Broken** is only a mark.
- **Crossfade**: rising intensity channels use `fadeIn`, falling ones `fadeOut`, every other channel `fadeIn`;
  all start after `delay`; rounding `floor(x + 0.5)`; move in dark per moving head (rules at the top of
  `crossfade.ts`, vectors in `crossfade.test.ts` for the Rust port). Unpatched channels count as intensity.
- **Document settings** (in the file): memory binding, default crossfade, emergency memory (null = all white
  at full: Main/R/G/B/W at 255, amber/UV/strobe/smoke off, positions kept). **Computer settings** (data
  folder): language, theme, units 0–255/%, DMX device/type (used from 0.2), preview detail, recent files.
- **File**: flat JSON `{ app: "granvelo", format: 1, savedWith, savedAt, …document }`, number arrays on one
  line. Reading refuses other apps/formats and wrong types/ranges/duplicates with the place of the error;
  fills optional fields; drops dangling references. Before the first publication: no migrations.

## What phase 0 does not do yet

No DMX output (the top bar says "Uscita DMX: non collegata"), no 3D, no faders, no show playback. The lens
of the light symbols is dark because there is no live state yet; `visibleLight()` gives the colour when there is.
