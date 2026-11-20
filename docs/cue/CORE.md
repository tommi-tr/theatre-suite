# Cue — phase 2 core (models, engines, how the UI uses them)

The non-visual core of phase 2: pure models (`apps/cue/src/model/`), wrappers of the native engines with browser
simulators (`apps/cue/src/lib/`) and the native commands (`apps/cue/src-tauri/src/`). Spec: `13_cue.md`; file format:
`FORMAT.md`; plan: `WORKPLAN.md`.

## Models (pure, vitest)

### `model/gos.ts` — GOs
- `Go { id, anchor, actions, givenBy: "both"|"primary"|"secondary", auto?, note?, label? }`. `anchor` is `GoAnchor`
  `{ page, y, x?, quote, before, after, lineId? }`, the same shape as phase 1's `ScriptAnchor` (`model/anchor.ts`):
  when it lands, import that type instead.
- `Action` (field names of FORMAT.md):
  `light { ref, times? }` · `audio { ref, times?, levelDb? }` · `audioStop { ref? (none = every sound), times? }` ·
  `projection { projectionItemId?, step? }` · `powerpoint { powerpoint }` (the last two: types only, phase 4).
  `ref = { sourceId, itemId }`; `times = { fade?, fadeIn?, fadeOut?, delay? }` override the source file.
- **Order**: page, y, x, then list order (`sortGos`, stable). Every edit returns the list sorted.
- **Numbering** (`numberGos`, derived, never stored): GOs given by hand are 1…N; an `auto` GO takes the previous
  number plus a point (4, 4.1, 4.2, 5; before the first: 0.1). A `label` is shown instead and shifts nothing.
  `mainGoCount` = N for "GO n di N".
- **Merge** (`dropAction`, `mergeTarget`): a drop within `DEFAULT_MERGE_PX` = 12 px of a GO (measured with the script
  view's `toY`; default a nominal 1000 px page) joins it. One light and one projection/PowerPoint action per GO: a
  second one replaces the first (`result: "replaced"`); the same sound twice is a `duplicate`. Otherwise a new GO
  (`auto` as asked, e.g. the item's `startsByItself`).
- Edits: `addGo`, `removeGo`, `addAction`, `removeAction` (a GO may stay empty), `updateAction`, `moveAction` (drops
  the GO it empties), `moveGo`, `setGivenBy`, `setAuto`, `setNote`, `setLabel`. Unknown fields are kept.
- `actionDept` → `lights | audio | video`; `audioEngineTrackId(action)` = `trackId`, or `trackId#actionId` when the
  sound changes its fade or level (it plays its own engine copy).

### `model/playback.ts` — the evening
- State `{ lastGoId, standbyId, history, audioClearedAt, paused, blackout, ftb, emergency, emergencyArmedAt }`
  (ids, not indices, so edits during the show do not shift it; `indices(state, gos)` gives `lastGoIndex` (−1 before
  the start) and `standbyIndex`).
- Every function returns `StepResult { state, commands: EngineCommand[], fired, skipped, schedule?, refused? }`.
- `go(state, gos, { role, lookup })` fires the standby → next GO in script order is standby. Refused (`refused`):
  `end`, `emergency`, `givenByPrimary` / `givenBySecondary` (role `solo` gives everything). A GO during Pausa first
  resumes. Missing items are `skipped`, the rest fires.
- **Auto GOs**: when the GO before fires, `schedule = { goId, afterSec | null, trackEnd? }` (`autoWait`: end of the
  previous GO's actions in the auto GO's columns — light delay + longer fade, sound to its end minus a crossfade).
  The UI sets a timer and calls `fireAuto(state, gos, goId, ctx)`; it fires only if that GO is still standby (GO,
  click and Indietro cancel it implicitly). `afterSec: null` = length unknown: watch the voice `trackEnd` in the
  audio live state (or never, for a loop).
- `click(state, gos, goId)`: a future GO becomes standby; standby / past GOs: nothing (`alreadyStandby`, `past`).
- `back()` (**Indietro**) undoes the last GO of the history (one step): lights to the memory in scene before it **with
  that memory's times** (dark with the undone memory's times if none), its sounds stop (`BACK_AUDIO_FADE` 1.5 s), the
  previous projection comes back; the undone GO is standby again. Sounds it stopped are not restarted.
- `columns(state, gos)`: per column what is **in scene** (last *fired* GO with that column — history, not script
  order; for audio every sound started and not stopped since) and in **standby** (the standby GO's actions).
  `goViews(state, gos, role)`: `past | last | standby | future` + `fireable`/`reason` for each button.
- Safety: `pause` / `resume` / `togglePause`, `blackout(on?)`, `fadeToBlack(seconds)` (toggle; release in the same
  time), `stopAudio` (Esc), `emergencyPress(state, nowMs)` (second E within 3 s → `emergency`), `leaveEmergency`.
- Crash recovery: save `snapshot(state)` `{ standbyId, lastGoId, history }` often (e.g. with the autosave);
  `restore(snap, gos)` gives the state back **with no commands**.

### `model/timeline.ts` — layout of the columns
`layoutTimeline(gos, { anchorToY, audioHeights, endY })` → `{ gos: TimelineGo[], columns, height }` in script pixels:
button 34 px, `buttonTop = dotY − 17` pushed down to `previous bottom + 6` (`offset`, `curved`); `lineY = buttonTop + 17`;
boxes aligned to the button top; light/video boxes end 6 px above the next box of their column (the last at `endY`,
or 160 px); audio boxes use `layout.audioBoxHeights[actionId]` (default 72, min 40) and never reach the next audio
box; stops are 40 px; several boxes of one GO stack; empty columns are absent; `lineEnd` = last column of the GO.
`goAtY`, `draggedAudioHeight` help clicks and the resize handle.

### `model/sources.ts` — sources and library
- `SourceLink { id, app, path (relative to the .tcue, "/"), docId?, name?, sha256? }` (`sha256` is new: fingerprint at
  the last load → `status.changed`; add it to FORMAT.md at merge).
- `parseSource(link, text, { absPath, sha256, trackPath })` → `LoadedSource { status, title, granvelo, tracks, lights,
  audio }`; status `ok | missing | unreadable | wrongFormat | newer | otherDocument | unsupported`.
- `LightItem` (memory: number, name, note, times, durationSec, autoFollow, startsByItself, sequenceIndex,
  emergency, litCount, `thumbnail` = Granvelo's `memoryThumbnail`), `AudioItem` (track: number, name, path,
  durationSec, playSec, fadeInSec, exit/exitSec, loop, volumeDb, start, startsByItself).
- `Library`: `lights`, `audio`, `light(ref)`, `track(ref)`, `lookup` (for playback), `missing(gos)`,
  `fadePayload(ref | null, times)`, `emergencyValues()`, `audioSync(gos)`. `relativePath`, `newLink`, `appForPath`.

## Native commands (`src-tauri/src`)

| Module | Commands | Events |
|---|---|---|
| `audio.rs` | `audio_list_devices`, `audio_set_device(name?)`, `audio_sync(sources: [{sourceId, tracks}], config?)`, `audio_play_now(sourceId, trackId)`, `audio_stop_track(sourceId, trackId, fadeSec?)`, `audio_stop_all(immediate)`, `audio_set_paused(paused)`, `audio_state` | `cue-audio-state` (`LiveState`, ids `sourceId:trackId`) |
| `dmx.rs` | `dmx_list_devices`, `dmx_connect(request)`, `dmx_disconnect`, `dmx_set_universe`, `dmx_fade_to`, `dmx_pause`, `dmx_resume`, `dmx_stop_fade`, `dmx_blackout`, `dmx_fade_to_black`, `dmx_release_black`, `dmx_grand_master`, `dmx_get_status`, `dmx_test_output` (as Granvelo's) | `cue-dmx-status`, `cue-dmx-progress`, `cue-dmx-output` |
| `files.rs` | `files_read_text(path)`, `files_sha256(path)`, `files_resolve_relative(base, rel)`, `files_relative_to(base, path)` | — |

Engines start at their first command and stop at exit. Cue's audio config: other tracks are left alone at GO, no
steps, no auto advance (Cue's auto GOs do that). The audio engine has no test tone: Controlli can play a track.
Errors of `files_*` are `missing: …`, `too-big: …`, `not-text: …`, `io: …`.

## TypeScript wrappers (`src/lib`)
- `dmx.ts`: `dmxApi()` → `DmxApi` (type shared with Granvelo in `@theatre-suite/show-files/granvelo/dmxApi`); the
  simulator (`…/granvelo/dmxSim`, shared) in the browser, connected to "Uscita simulata" in `/?demo`
  (`window.__cueDmx.pullCable()` shows the unplugged state). `dmxProblemText(t, code)` / `dmxLinkText(t, link)`:
  `busy` = "Il cavo DMX è usato da un altro programma (forse Granvelo): chiudilo e riprova".
- `audio.ts`: `audioApi()` → `AudioApi` (`audioSim.ts` in the browser: output "Uscita simulata", voices advance,
  `window.__cueAudio`); `engineId`, `splitEngineId`.
- `sources.ts`: `loadLibrary(links, tcuePath)`, `loadSource`, `linkSourceFile(absPath, tcuePath, makeId)`,
  `withFingerprint`, `sourceStatusText(t, loaded)` (Italian in `i18n/it.core.ts`), `putDemoSourceFile`.
- `showRunner.ts`: `runCommands(commands, { dmx, audio, library, projection?, onError?, later? })` — every command is
  tried, failures go to `onError`, the others still run.
- `demoShow.ts`: demo `Luci.granvelo` (7 lights, 10 memories), `Suoni.diaframma` (6 tracks), `DEMO_GOS` (12 GOs on
  pages 1–5), `DEMO_AUDIO_HEIGHTS`, `DEMO_PLAYBACK` (GO 6 given, GO 7 standby). **Wiring** in `model/demo.ts`:
  `memFs.put(DEMO_PATH, show(demoCueFields()))` and call `putDemoSources()`.

## How the UI uses them
1. On open / after a source change: `library = await loadLibrary(show.sources, filePath)`; show
   `sourceStatusText` per source and `library.missing(show.gos)` on the GOs; `audio.sync(library.audioSync(show.gos))`
   (again after every GO edit that changes a sound's times or level).
2. Prepara: drag a library item → `dropAction(show.gos, anchor, action, { toY: scriptView.anchorToY, makeId, auto: item.startsByItself })`
   inside `doc.change(...)`; the inspector uses the edit functions. Numbers: `numberGos`.
3. Show: keep a `PlaybackState` in a store (`initialState`, or `restore(snapshot)` after "Recupera"). Keys call
   `go` / `back` / `togglePause` / `blackout` / `fadeToBlack(show.settings.ftbSeconds)` / `emergencyPress(Date.now())`
   / `stopAudio`; clicks call `click`. Run `result.commands` with `runCommands`; show `refused` in words; for
   `schedule` set a timer → `fireAuto`. Save `snapshot(state)` with the autosave.
4. Draw with `layoutTimeline(show.gos, { anchorToY, audioHeights: show.layout.audioBoxHeights, endY })`, colours from
   `goViews` and `columns` (green in scene, amber standby). Resize: `draggedAudioHeight` → `layout.audioBoxHeights`.

## Open points
- `show.ts` still declares its own `Go`/`GoAction` (FORMAT.md shapes, `kind: "audio"` etc.): at merge make it
  re-export `Go`, `Action`, `GivenBy`, `ItemRef` from `gos.ts`, and `GoAnchor` from phase 1's anchor; document
  `audioStop`, `label`, `times.fadeIn/fadeOut`, `step` and `Source.sha256` in FORMAT.md.
- Phase 3: the primary runs the engines; a secondary's GO request is applied with `go(…, { role: "secondary" })`.
