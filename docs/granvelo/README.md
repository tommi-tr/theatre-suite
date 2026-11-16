# Granvelo — developer notes

Granvelo is the lighting app of the Theatre Suite (`apps/granvelo`, identifier `it.theatresuite.granvelo`,
dev port **1423**, file `.granvelo`). Specification: `10_granvelo.md`; visual identity: `02_design.md`
(both copied here from the project documents).

## Run it

```
pnpm install                         # at the repo root
pnpm --filter granvelo dev           # browser preview on http://localhost:1423 (/?demo = La locandiera; &no3d = 2D views)
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
  check.ts         Controllo luci: checkLook (one light on), plan/order/skips, the run, restore point
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
src/stage/       the stage, reusable (Allestimento now, Banco and Show next): no stores, only props
  geometry.ts      pure + tested: light position, beam pool, default aim, drop rules (trusses), projections
  scene.ts         what the views draw (lights with look/colour/pool, scenery of a memory)
  StageView2D.tsx  SVG plan / front (also thumbnails, `compact`; the fallback without WebGL)
  StageView3D.tsx  three.js, lazy chunk; StageView.tsx = host (3D if possible, else 2D + note)
src/modes/       Allestimento (list of lights, stage or address map, properties / scenery), Banco, Show (phase 0);
                 check/ = Controllo luci dialog (opened with ui.openDialog("check"), also for Show)
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

## The stage (Granvelo 0.3)

**API** (`src/stage/index.ts`). `StageView` (host) and `StageView2D` take `StageViewProps` (`types.ts`): `doc` (stage,
trusses, fixtures, scenery), `values?` (512 DMX values to show; omitted = no light), `selected?`, `scenery?` ("all" or the
placements of a memory), `selectedScenery?`, `detail?` ("essential" | "medium"), `showAims?`, `pick?` (which kinds answer
the mouse), `onPress?`, `compact?`; `StageView` adds `camera` ("perspective" | "plan" | "front"), `force2D?`, `onNo3D?`;
`StageView2D` adds `view` ("plan" | "front"). **Mouse contract**: `onPress(hit, {ctrl, shift, alt})` → a `StageDrag`
`{from, move(to, axes), end(to | null, axes)}` or null; the view moves `from` with the mouse on the plane of the view
(plan/perspective: horizontal, `xy`; front: vertical, `xz`; perspective + Shift on a light: height, `z`) and calls `end`
with null for a simple click or Esc. Allestimento shows a preview document while dragging and commits once (one undo step).

**3D**: three.js 0.187, loaded with `React.lazy` (own chunk ≈ 145 kB gzip). Rendered **only on demand** (controls
`change`, new props, resize); everything disposed on unmount (`forceContextLoss`). Floor solid, volume and trusses in
lines, scenery Lambert solids with edges, lights as sprites drawn from the symbol paths on a canvas (cached per
symbol/look/lens colour), turned on screen towards their aim at every render; labels of selected lights as sprites.
Essenziale = flat additive ellipses; Media = soft (radial texture) pools + additive open cones; "Alta"/"Automatica" draw
as Media until phase 5. No WebGL (checked once with a throw-away canvas; `/?no3d` forces it), a failed renderer or a lost
context → 2D views (perspective → plan) with a discreet note. The stage is always a dark room, also in the light theme.

**Pools** (`beamPool`): aim on the floor and the whole cone reaches it → exact conic; aim in the air → disc of the beam's
width at the aim, stretched along the direction by 1/sin(elevation), at most 1,6; under 8° (side lights) → a band from
under the light to the aim; pointing up more than 30° → no floor pool (outline only at the aim). **Default aim** lives in
`geometry.ts` (ops re-exports it): house → proscenium, 60 % of the sideways offset (spread); floor or floating in the
wings below the high zone → across, horizontal; last 30 % of the depth → backlight; else straight down.

**Sposta thresholds** (`resolveDrop`): below 0,5 m → on the floor (z 0); a floor light stays on the floor below the high
zone; high zone = from max(2 m, 60 % of the stage height): a truss within 0,6 m in depth and 1 m in height catches it
(magnet), otherwise over the stage (0 ≤ Y ≤ depth, ≤ 1 m beyond the sides) a **new truss** is born there (the following
lights of the same drop hang on it); everything else floats. Empty trusses are not removed automatically.

**Tools**: Sposta (plan: X/Y, front: X/Z, perspective: X/Y on the light's plane or the floor when seen edge-on, Shift =
height), Orienta (handles on the aim of the selected lights; all move by the same amount; numbers and "Puntamento
predefinito" in Properties), Numera a clic (clicks on the stage count as in the list), Scenografia (add / select / drag
pieces, the right panel edits name, shape, colour, position, rotation, size, delete — also removed from the memories).
A click on a truss opens its editor in the list. Ops: `dropLights`, `setAims`, `resetAim`, `addScenery`, `updateScenery`,
`removeScenery`, `sceneryName` (tests in `ops.stage.test.ts`). File format unchanged.

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
"Dark at the start / at the end" of moving heads is decided by the engine from the values it really has (a
head whose intensity channel is outside the universe is never dark, in Rust as in JS). Fade to black and its
release take the time asked from the current level. Times are cleaned on both sides: NaN → 0, Infinity → 24 h,
negative → 0 (`cleanSeconds`); `null` from JSON is 0 in Rust. **Shared vectors**:
`src/model/engineVectors.json` is run by vitest against `dmxSim.ts` and by `cargo test` against `core.rs`
(`include_str!`): add a case there whenever a rule of the engine changes.

| Command (Tauri) | Store action | Notes |
|---|---|---|
| `dmx_list_devices` | `refreshDevices` | ports with VID/PID, manufacturer, product, serial, chip, guess |
| `dmx_connect {request}` | `connect(req?)`, `useSimulated` | `{mode:"auto",prefer?,kind?}` · `{mode:"port",port,kind}` · `{mode:"simulated"}` |
| `dmx_disconnect` | `disconnect` | stops sending; **no blackout** (also on app exit) |
| `dmx_set_universe {values,universe?}` | `setUniverse` | immediate; ends a running fade (also a paused one) |
| `dmx_fade_to {target,transition,layout,universe?}` → id | `fadeTo` | progress in `live.fade` (`id`, `progress`, `paused`, `doneId`); a new fade while paused starts from the paused values and runs |
| `dmx_pause` / `dmx_resume` / `dmx_stop_fade` | same names | stop = stay where you are |
| `dmx_blackout {on}` | `blackout` | reversible; what is underneath keeps fading |
| `dmx_fade_to_black {seconds}` / `dmx_release_black {seconds}` | `fadeToBlack` / `releaseBlack` | |
| `dmx_grand_master {level,mask?,universe?}` | `setGrandMaster` | mask = `intensityMask(doc)` |
| `dmx_test_output {on,channels?,level?}` | `startTest` / `stopTest` | level 128; ignores Blackout, FTB and GM |
| `dmx_get_status` | (init) | snapshot |
| events `dmx-status` (at once), `dmx-progress` (≤ 10/s), `dmx-output` (≤ 20/s) | subscribed by `init` | only when they change |

`universe` is optional (default 1, the only one; another number is refused).

States: `idle`, `connecting`, `connected {device, kind}`, `simulated`, `lost {sinceMs, attempts}`,
`error {code: noCable | notFound | busy | openFailed | chooseCable | engineStopped}`. Lost = a write error or a
frame not handed to the driver within two periods (max 100 ms): one reconnection attempt per second, same device
by VID/PID/serial (not by COM name; serial numbers made up by Windows — only digits ≤ 2 characters, or with `&` —
count as none, and a cable without serial is matched only with devices without serial); when back, the whole
current frame goes out at once. Only **one connection job** runs at a time (Windows opens COM ports
exclusively): a Connect during a job is queued, the latest wins; a port "in use" is retried for 1 s.
An internal error (panic) in the engine thread is caught: `error {engineStopped}` is shown, the engine is rebuilt
from the last values and masters the interface saw and runs on without sending until Connect (after 3 errors it
stops for good and says so).

**Cables.** Auto: only Pro-looking devices and FTDI chips are tried (other serial devices are never written to);
each is asked "Get Widget Parameters" (label 3) and serial (label 10), 300 ms; the first that answers is a Pro;
otherwise a device named Pro is still driven as Pro, else the preferred or the only FTDI chip as Open DMX; with
several silent FTDI chips Granvelo does not guess (`chooseCable`: choose it in the Settings). By hand (Settings):
any port as Pro or Open DMX. Both opened at 250000 baud 8N2, RTS cleared (as QLC+). Pro: label 6, start code 0 +
512 values. Open DMX: break ≥ 200 µs, mark after break ≥ 20 µs (precise wait; on the wire ≈ 1 ms because break
on/off are USB requests — fine for DMX), then 513 bytes; 30 frames/s because a frame takes 22.6 ms on the line;
a new break never starts before the previous frame has left the line, measured in real time from the moment the
data write started (+ 3 ms). On Windows the timer resolution is raised to 1 ms (`timeBeginPeriod`, this process
only) while something is sent (cable or simulated output) or a lost cable is being reconnected.

## What is not there yet

No faders, no show playback (they use the output store above when they arrive); the stage shows `under` of the output
store when the output is connected or simulated (otherwise lenses are dark and there is no light). Not yet: box
selection on the stage, dragging trusses with the mouse, scenery per memory (the placements are in the file and the
views accept them; editing them comes with Banco), real shadows / beams in smoke ("Alta", phase 5), PDF prints.
