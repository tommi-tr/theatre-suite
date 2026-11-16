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
cargo test -p granvelo --lib         # native side (storage, versions, DMX engine)
pnpm granvelo:build                  # Windows installer (NSIS, per user)
```

`/?demo` loads the demo show; `/?demo&start` opens the start screen. In the browser nothing can be saved or
opened (there is no file system); everything else works, with the simulated DMX output. `/?demo&dmxdevices`
also lists two example cables and pretends to connect to them; in the console `__granveloSim.pullCable()` /
`.plugCable()` show the "cable unplugged" states (preview tooling only).

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
src/store/       zustand: doc (undo/redo via packages/core History), settings (this computer), ui,
                 output (the DMX output: the single door to the lights)
  enginePayload.ts document → DMX engine commands (fade layout, intensity mask, memory target)
src/lib/         Tauri calls, files (save/open/versions/autosave), version, formatting;
                 dmx.ts (typed DMX engine API) + dmxSim.ts (the same engine in the browser)
src/shell/       title bar + top bar + status bar, start screen
src/modes/       Allestimento (list of lights + properties), Banco, Show (phase 0 screens)
src/common/      dialogs (Settings, Versions, New show), File menu, FixtureSymbol, ComingSoon, OutputChip
src-tauri/       storage commands as Cantinella + versions folder as Diaframma; suite-link; src/dmx (engine)
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

## DMX output (Granvelo 0.2)

**The single door.** Every part of the interface reaches the lights only through `src/store/output.ts`
(`useOutput`): `connect`, `disconnect`, `setUniverse`, `fadeTo`, `pause`, `resume`, `stopFade`, `blackout`,
`fadeToBlack`, `releaseBlack`, `setGrandMaster`, `startTest`, `stopTest`; it holds `status` (connection),
`output` (512 values on the cable, ≤ 20 updates/s, also during fades), `under` (the same before the output
master), `live` (fade progress, Blackout/FTB/GM, test, frames per second). Nobody calls `lib/dmx.ts` or Tauri
directly. Payloads for fades come from `model/enginePayload.ts`.

**Engine** (`src-tauri/src/dmx`, own thread): nothing is opened or sent before `connect`. 40 frames/s with
absolute deadlines (no catch-up bursts after a stall); 30 frames/s with Open DMX (see below). Layers:
playback (`set_universe` immediate — it **ends a running fade**; `fade_to` computed by the engine exactly as
`crossfade.ts`, from the *current* values, so a GO during a fade or "Indietro" is smooth; `pause`/`resume`/
`stop_fade`) → output master (Grand Master and Fade to black scale the intensity mask; Blackout puts it at 0,
reversible; positions, gobos, smoke are never touched) → test pattern (channels 1…N one at a time, replaces
everything while on). The masters are not applied by the TS side: `memoryTarget` applies the groups only.
"Dark at the start / at the end" of moving heads is decided by the engine from the values it really has.

| Command (Tauri) | Store action | Notes |
|---|---|---|
| `dmx_list_devices` | `refreshDevices` | ports with VID/PID, manufacturer, product, serial, chip, guess |
| `dmx_connect {request}` | `connect(req?)`, `useSimulated` | `{mode:"auto",prefer?,kind?}` · `{mode:"port",port,kind}` · `{mode:"simulated"}` |
| `dmx_disconnect` | `disconnect` | stops sending; **no blackout** (also on app exit) |
| `dmx_set_universe {values}` | `setUniverse` | immediate; ends a running fade |
| `dmx_fade_to {target,transition,layout}` → id | `fadeTo` | progress in `live.fade` (`id`, `progress`, `paused`, `doneId`) |
| `dmx_pause` / `dmx_resume` / `dmx_stop_fade` | same names | stop = stay where you are |
| `dmx_blackout {on}` | `blackout` | reversible; what is underneath keeps fading |
| `dmx_fade_to_black {seconds}` / `dmx_release_black {seconds}` | `fadeToBlack` / `releaseBlack` | |
| `dmx_grand_master {level,mask?}` | `setGrandMaster` | mask = `intensityMask(doc)` |
| `dmx_test_output {on,channels?,level?}` | `startTest` / `stopTest` | level 128 |
| `dmx_get_status` | (init) | snapshot |
| events `dmx-status` (at once), `dmx-progress` (≤ 10/s), `dmx-output` (≤ 20/s) | subscribed by `init` | only when they change |

States: `idle`, `connecting`, `connected {device, kind}`, `simulated`, `lost {sinceMs, attempts}`,
`error {code: noCable | notFound | busy | openFailed}`. Lost = write error: one reconnection attempt per second,
same device by VID/PID/serial (not by COM name); when back, the whole current frame goes out at once.

**Cables.** Auto: only Pro-looking devices and FTDI chips are tried (other serial devices are never written to);
each is asked "Get Widget Parameters" (label 3) and serial (label 10), 300 ms; the first that answers is a Pro;
otherwise a device named Pro is still driven as Pro, else the first FTDI chip as Open DMX. By hand (Settings):
any port as Pro or Open DMX. Both opened at 250000 baud 8N2, RTS cleared (as QLC+). Pro: label 6, start code 0 +
512 values. Open DMX: break ≥ 200 µs, mark after break ≥ 20 µs (precise wait; on the wire ≈ 1 ms because break
on/off are USB requests — fine for DMX), then 513 bytes; 30 frames/s because a frame takes 22.6 ms on the line
and a new break never starts before the previous frame has left the chip. On Windows the timer resolution is
raised to 1 ms (`timeBeginPeriod`, this process only) while a cable is connected.

## What is not there yet

No 3D, no faders, no show playback (they use the output store above when they arrive). The lens
of the light symbols is dark because there is no live state yet; `visibleLight()` gives the colour when there is.
