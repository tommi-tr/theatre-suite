//! Granvelo's DMX output: the Tauri commands over the shared engine (`crates/dmx-engine`).
//!
//! The engine emits `dmx-status`, `dmx-progress` and `dmx-output` through a sink that forwards
//! them to the interface as Tauri events (see the crate for cadences and payloads).

use std::sync::Arc;

use tauri::{AppHandle, Emitter};

pub use dmx_engine::DmxEngine;
use dmx_engine::discovery::DeviceInfo;
use dmx_engine::engine::ConnectRequest;
use dmx_engine::fade::{Layout, Transition};
use dmx_engine::{EventSink, Snapshot, seconds};

/// Starts the engine; its events go to the interface.
pub fn start(app: AppHandle) -> DmxEngine {
    let sink: EventSink = Arc::new(move |event: &str, payload: serde_json::Value| {
        let _ = app.emit(event, payload);
    });
    DmxEngine::start(sink)
}

type Engine<'a> = tauri::State<'a, DmxEngine>;

/// The serial ports of this computer, with the engine's guess (Settings → Uscita DMX).
#[tauri::command(async)]
pub fn dmx_list_devices(engine: Engine<'_>) -> Vec<DeviceInfo> {
    engine.list_devices()
}

/// `{ mode: "auto", prefer?, kind? }`, `{ mode: "port", port, kind }` or `{ mode: "simulated" }`.
#[tauri::command]
pub fn dmx_connect(engine: Engine<'_>, request: ConnectRequest) -> Result<(), String> {
    engine.connect(request)
}

/// Stops sending. No blackout is sent: the lights stay as they are.
#[tauri::command]
pub fn dmx_disconnect(engine: Engine<'_>) -> Result<(), String> {
    engine.disconnect()
}

/// Immediate values (up to 512; missing ones are 0). Ends a running fade.
#[tauri::command]
pub fn dmx_set_universe(
    engine: Engine<'_>,
    values: Vec<u8>,
    universe: Option<u16>,
) -> Result<(), String> {
    engine.set_universe(values, universe)
}

/// Starts a transition from the current values; returns its id (for `dmx-progress`).
#[tauri::command]
pub fn dmx_fade_to(
    engine: Engine<'_>,
    target: Vec<u8>,
    transition: Transition,
    layout: Layout,
    universe: Option<u16>,
) -> Result<u64, String> {
    engine.fade_to(target, transition, layout, universe)
}

#[tauri::command]
pub fn dmx_pause(engine: Engine<'_>) -> Result<(), String> {
    engine.pause()
}

#[tauri::command]
pub fn dmx_resume(engine: Engine<'_>) -> Result<(), String> {
    engine.resume()
}

#[tauri::command]
pub fn dmx_stop_fade(engine: Engine<'_>) -> Result<(), String> {
    engine.stop_fade()
}

#[tauri::command]
pub fn dmx_blackout(engine: Engine<'_>, on: bool) -> Result<(), String> {
    engine.blackout(on)
}

#[tauri::command]
pub fn dmx_fade_to_black(engine: Engine<'_>, seconds: Option<f64>) -> Result<(), String> {
    engine.fade_to_black(self::seconds(seconds))
}

#[tauri::command]
pub fn dmx_release_black(engine: Engine<'_>, seconds: Option<f64>) -> Result<(), String> {
    engine.release_black(self::seconds(seconds))
}

/// Grand Master 0–255 on the intensity channels; `mask` (512 × 0/1) replaces the intensity mask.
#[tauri::command]
pub fn dmx_grand_master(
    engine: Engine<'_>,
    level: u8,
    mask: Option<Vec<u8>>,
    universe: Option<u16>,
) -> Result<(), String> {
    engine.grand_master(level, mask, universe)
}

#[tauri::command]
pub fn dmx_get_status(engine: Engine<'_>) -> Result<Snapshot, String> {
    engine.snapshot()
}

/// The test pattern of Settings: channels 1…`channels` one at a time up to `level`. It replaces
/// the whole output (Blackout, Fade to black and Grand Master do not apply to it).
#[tauri::command]
pub fn dmx_test_output(
    engine: Engine<'_>,
    on: bool,
    channels: Option<u16>,
    level: Option<u8>,
) -> Result<(), String> {
    engine.test_output(on, channels, level)
}
