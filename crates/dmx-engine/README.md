# dmx-engine

The DMX output engine of the Theatre Suite: Granvelo and Cue. One universe (512 channels),
fades computed natively (an exact mirror of Granvelo's `src/model/crossfade.ts`), Blackout,
Fade to black, Grand Master, test pattern, USB-DMX cables (Enttec Pro family, FTDI Open DMX)
or a simulated output. No Tauri dependency: the app gives the engine an event sink.

Granvelo keeps its `#[tauri::command]` wrappers in `apps/granvelo/src-tauri/src/dmx/mod.rs`.

## Only one program holds the DMX port

A serial port can be opened by one program at a time. If Granvelo (or anything else) holds
the cable, connecting from another program ends in
`LinkState::Error { code: ErrorCode::Busy, .. }` (JSON: `{"state":"error","code":"busy",...}`),
after a short retry. Keep `busy` distinct from the other errors (`noCable`, `notFound`,
`openFailed`, `chooseCable`, `engineStopped`) so the interface can say in plain words that
another program has the cable.

## API

```rust
use std::sync::Arc;
use dmx_engine::{DmxEngine, EventSink, engine::ConnectRequest, fade::{Layout, Transition}};

let sink: EventSink = Arc::new(move |event: &str, payload: serde_json::Value| {
    // In a Tauri app: let _ = app.emit(event, payload);
});
let dmx = DmxEngine::start(sink); // nothing is opened or sent yet
dmx.connect(ConnectRequest::Auto { prefer: None, kind: None })?;
let id = dmx.fade_to(values_512, Transition { fade_in: 3.0, fade_out: 5.0, delay: 0.0, move_in_dark: false },
                     Layout::all_intensity(512), None)?;
```

- `DmxEngine::start(sink)` — starts the engine and publisher threads.
- Events sent to the sink:
  - `dmx-status` (`engine::Status`: link state, device…) at once when the connection changes;
  - `dmx-progress` (`engine::Live`: running fade and its id, output master, test, frames
    per second) at most 10 times a second, only on change;
  - `dmx-output` (`{ output, under }`: the 512 values on the cable and under the output
    master) at most 20 times a second, only on change.
- `list_devices() -> Vec<DeviceInfo>` — serial ports with the engine's guess (may take a
  moment: call it off the UI thread).
- `connect(ConnectRequest)` — `Auto { prefer, kind }`, `Port { port, kind }` or `Simulated`
  (JSON `{ mode: "auto" | "port" | "simulated", ... }`). `disconnect()` — stops sending and
  closes the port; no blackout is sent.
- `set_universe(values, universe)` — immediate values (missing ones are 0); ends a fade.
- `fade_to(target, transition, layout, universe) -> u64` — a transition of the full
  universe from the current values; the id appears in `dmx-progress`. `Layout` says which
  channels are intensity and which belong to moving heads (move in dark);
  `Layout::all_intensity(512)` when nothing is known.
- `pause()`, `resume()`, `stop_fade()` — act on the running fade.
- `blackout(on)`, `fade_to_black(seconds)`, `release_black(seconds)` — the output master.
- `grand_master(level, mask, universe)` — 0–255 on the intensity channels (`mask`: 512 × 0/1).
- `test_output(on, channels, level)` — channels 1…n one at a time (replaces the output).
- `snapshot() -> Snapshot { status, live, output, under }` — everything, now.
- `shutdown()` — stops the engine thread (app exit); the lights stay as they are.
- `universe: Option<u16>` — only universe 1 exists; anything else is an error.
- Helpers: `check_universe`, `seconds(Option<f64>)` (JavaScript `null` = 0, capped at 24 h).

Every public type keeps Granvelo's serialisation (camelCase JSON, same tags and field names).

## Tests

`cargo test -p dmx-engine`. One test reads the vectors shared with Granvelo's browser
simulator from `apps/granvelo/src/model/engineVectors.json`.
