# Diaframma — architecture

```
apps/diaframma/
├─ src/                    React interface
│  ├─ App.tsx              window shell, startup (crash recovery, autosave, engine sync)
│  ├─ show/                Show mode: GO bar, cue rows, track panel, waveform editor, dialogs
│  ├─ rehearsal/           Rehearsal mode: sources, outputs, routing lines, favorites
│  ├─ common/              settings, guide, phone, file menu
│  ├─ state/               zustand stores: document, settings, UI, internal player
│  ├─ lib/                 native API bindings, files, autosave, engine/remote sync, demo data
│  └─ i18n/                Italian dictionary (English text is the key)
├─ src-tauri/src/
│  ├─ lib.rs               Tauri setup, commands, clean exit
│  ├─ storage.rs           settings, autosave, crash marker, atomic writes, file search
│  ├─ audio/
│  │  ├─ core.rs           voices, mixing, GO and "At end" logic (no window dependency, tested)
│  │  ├─ decode.rs         decoder threads (symphonia), resampling, loops, waveform (tested)
│  │  ├─ dsp.rs            EQ, volume curve, fades (tested)
│  │  ├─ model.rs          JSON types shared with the interface
│  │  └─ mod.rs            engine threads (device, control), commands, internal player
│  ├─ rehearsal/           Windows media sessions, per-program volume/output, restore journal
│  └─ remote/              Chrome extension bridge (127.0.0.1) and phone page (local Wi-Fi)
└─ chrome-extension/       Manifest V3 extension (optional)
```

## Audio engine
- **Threads.** The output callback (cpal/WASAPI) only mixes. Each voice has a decoder thread
  that keeps ~3 s of audio ready in a lock-free ring buffer. A control thread prepares the next
  voices, handles fallbacks and sends the live state to the interface 20 times per second.
  If the window freezes, sound keeps going.
- **Instant GO.** The track in standby (and the next one, when "At end" is Next or Crossfade)
  is decoded in advance.
- **Positions.** The decoder marks every jump (start, loop, speed change) with a `Segment`;
  the callback always knows the exact file time of the sample it plays, so the volume curve,
  fades before the end and the time display are exact.
- **Seamless loops.** Seeks use a short pre-roll that is discarded, so compressed formats
  (MP3, AAC) loop without gaps.
- **Single source of truth.** The interface owns the document and sends it to the engine
  (`engine_sync`); the engine owns what is playing and the standby.

## Rehearsal mode (Windows)
- Media sessions: `GlobalSystemMediaTransportControlsSessionManager`.
- Volume per program: WASAPI `ISimpleAudioVolume`; meters: `IAudioMeterInformation`.
- Output per program: undocumented `IAudioPolicyConfig` (same as EarTrumpet), vtable slots 25/26.
- Every change is written to `rehearsal-journal.json` **before** it is made; on exit, or at the
  next start after a crash, the original values are put back.

## Files
- `.diaframma` cue list: JSON, `format: "diaframma.cuelist"`, `formatVersion: 3`,
  absolute and relative audio paths. Only the current version is read (no compatibility with
  older files until the suite is published); any other version is refused with a clear message.
- App data folder (`%APPDATA%\it.theatresuite.diaframma`): `settings.json`,
  `autosave/session.json`, `session.lock` (crash marker), `rehearsal-journal.json`.
- All writes are atomic (temporary file + rename). Damaged files are set aside, never fatal.

## Checks
- `pnpm -r typecheck` — TypeScript.
- `cargo test -p diaframma --lib` — decoder, engine core and DSP tests (run by CI on Windows).
- `pnpm --filter diaframma dev` then open `http://localhost:1420/?demo` in a browser to
  preview the layout with demo data.
