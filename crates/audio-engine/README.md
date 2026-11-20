# audio-engine

The native audio engine of the Theatre Suite: Diaframma's Show mode, internal player and
launchpad, and Cue. Decoding (symphonia), mixing, fades, loops, EQ/pan/envelopes, output
devices (cpal/WASAPI). No Tauri dependency: the app gives the engine an event sink.

Diaframma keeps its `#[tauri::command]` wrappers in `apps/diaframma/src-tauri/src/audio/mod.rs`.

## Threads

- audio callback: mixes the active voices, never opens files;
- one feeder thread per voice: decodes ahead into a ring buffer;
- device thread: owns the output stream; reopens it when the device changes or is lost
  (what is playing carries on from where it was);
- control thread: keeps the standby track prepared, serves start requests and sends the
  live state to the sink (~20 times a second while something plays, otherwise only on change).

## API

```rust
use std::sync::Arc;
use audio_engine::{Engine, EventSink, list_devices, model::{Config, TrackParams, LiveState}};

let sink: EventSink = Arc::new(move |event: &str, payload: serde_json::Value| {
    // In a Tauri app: let _ = app.emit(event, payload);
});
let engine = Engine::start(sink, "cue-audio-state", /* lazy */ true, Config::default());
```

- `Engine::start(sink, event, lazy, config)` — starts the threads. The `LiveState` goes to
  `sink(event, json)`. With `lazy = true` no output is opened until the first `set_device`.
- `sync(tracks: Vec<TrackParams>, config)` — the full list of tracks the engine may play
  (replaces the previous one). Tracks are identified only by `TrackParams::id`; `path` is an
  absolute file path. **Several `.diaframma` files at once**: concatenate their tracks in one
  `sync`, and make the ids unique across files (for example `"<sourceId>:<trackId>"`; the
  engine never looks inside ids). `Config` (camelCase JSON, every field optional) holds the
  general fade lengths and what GO does to the other tracks (`othersOnGo`: `fadeOut` · `keep` ·
  `stop`).
- `play_now(track_id) -> Result<(), String>` — starts that track now (it becomes the standby
  and GO is given). Other tracks follow `config.others_on_go`; use `OthersOnGo::Keep` to leave
  them alone (Diaframma's launchpad uses `steps: false, auto_advance: false, others_on_go:
  Keep`). Errors when the output is not available. Same rules as GO: a track already
  playing restarts (the old voice leaves in a few ms), and while "pause all" is on the call
  resumes everything instead of starting the track.
- `stop_track(track_id, fade_sec)` — fades one track out (at least a few ms, never clicks).
- `stop_all(immediate)` — everything out: `false` = with the general stop fade.
- `pause_all()` — pause all / resume all (a toggle, like Diaframma's P).
- `toggle_pause(track_id)`, `seek(track_id, sec)`, `set_speed(speed)`.
- `set_standby(Option<id>)`, `standby_step(±1)`, `go()` — Diaframma's cue-list GO.
- `set_device(Option<name>)` — output by name (`None` = system default); names come from
  `list_devices() -> Vec<String>`.
- `live_state() -> LiveState` — standby, main track, paused-all and every voice (position,
  duration, paused, fading in/out, loop) plus `engine: EngineStatus { ready, device,
  sampleRate, error }`.
- `summary() -> serde_json::Value` — a short description for remotes (Diaframma's phone).
- `analyze(path)` (blocking, cached), `analyze_cached`, `store_info`, and
  `decode::analyze(path)` — duration and loudness of a file.
- `shutdown()` — stops every voice (app exit).
- `selftest::run(tracks, config, runs, &progress)` — the silent reliability test.

Every public type keeps Diaframma's serialisation (camelCase JSON, same field names), so the
TypeScript side and the `.diaframma` files read the same.

Each engine instance opens its own output; Diaframma runs three (show, player, launchpad).

## Tests

`cargo test -p audio-engine` (they write short WAV files in the system temp folder).
