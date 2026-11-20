//! Cue's lights: the Tauri commands over the shared DMX engine (`crates/dmx-engine`).
//!
//! - One engine, Cue's own, started at the first command that needs it and stopped when Cue
//!   exits (the lights stay as they are). Nothing is sent before `dmx_connect`.
//! - The engine's events are forwarded with Cue's prefix: `cue-dmx-status`, `cue-dmx-progress`,
//!   `cue-dmx-output` (payloads as Granvelo's `dmx-*`, see the crate's README).
//! - Only one program holds the DMX cable: if Granvelo has it, connecting ends in the status
//!   `{ state: "error", code: "busy" }`, which the interface explains in plain words
//!   (`src/lib/dmx.ts`, `dmxProblemText`).
//! - Command names and arguments are those of Granvelo's `dmx_*` commands, so the payloads built
//!   by `@theatre-suite/show-files/granvelo` (`memoryGoArgs`, `fadeToArgs`) work unchanged.

use std::sync::{Arc, Mutex, PoisonError};

use tauri::{AppHandle, Emitter, Manager};

use dmx_engine::discovery::DeviceInfo;
use dmx_engine::engine::ConnectRequest;
use dmx_engine::fade::{Layout, Transition};
use dmx_engine::{DmxEngine, EventSink, Snapshot, seconds};

/// The engine, started on first use.
#[derive(Default)]
pub struct CueDmx(Mutex<Option<Arc<DmxEngine>>>);

/// Cue's name of an engine event (`dmx-status` → `cue-dmx-status`).
pub fn event_name(engine_event: &str) -> String {
    format!("cue-{engine_event}")
}

fn engine(app: &AppHandle) -> Arc<DmxEngine> {
    let state = app.state::<CueDmx>();
    let mut slot = state.0.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(e) = slot.as_ref() {
        return e.clone();
    }
    let handle = app.clone();
    let sink: EventSink = Arc::new(move |event: &str, payload: serde_json::Value| {
        let _ = handle.emit(&event_name(event), payload);
    });
    let e = Arc::new(DmxEngine::start(sink));
    *slot = Some(e.clone());
    e
}

/// Stops the engine thread (app exit). Nothing is sent: the lights stay as they are.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<CueDmx>() {
        if let Some(e) = state.0.lock().unwrap_or_else(PoisonError::into_inner).take() {
            e.shutdown();
        }
    }
}

// ---------------- Tauri commands ----------------

/// The serial ports of this computer, with the engine's guess (Settings → Uscite).
#[tauri::command(async)]
pub fn dmx_list_devices(app: AppHandle) -> Vec<DeviceInfo> {
    engine(&app).list_devices()
}

/// `{ mode: "auto", prefer?, kind? }`, `{ mode: "port", port, kind }` or `{ mode: "simulated" }`.
/// The result arrives as `cue-dmx-status` (a cable held by Granvelo: `code: "busy"`).
#[tauri::command]
pub fn dmx_connect(app: AppHandle, request: ConnectRequest) -> Result<(), String> {
    engine(&app).connect(request)
}

/// Stops sending and closes the port. No blackout is sent.
#[tauri::command]
pub fn dmx_disconnect(app: AppHandle) -> Result<(), String> {
    engine(&app).disconnect()
}

/// Immediate values (up to 512; missing ones are 0). Ends a running fade.
#[tauri::command]
pub fn dmx_set_universe(app: AppHandle, values: Vec<u8>, universe: Option<u16>) -> Result<(), String> {
    engine(&app).set_universe(values, universe)
}

/// A transition from the current values to `target`; returns its id (for `cue-dmx-progress`).
#[tauri::command]
pub fn dmx_fade_to(app: AppHandle, target: Vec<u8>, transition: Transition, layout: Layout, universe: Option<u16>) -> Result<u64, String> {
    engine(&app).fade_to(target, transition, layout, universe)
}

#[tauri::command]
pub fn dmx_pause(app: AppHandle) -> Result<(), String> {
    engine(&app).pause()
}

#[tauri::command]
pub fn dmx_resume(app: AppHandle) -> Result<(), String> {
    engine(&app).resume()
}

#[tauri::command]
pub fn dmx_stop_fade(app: AppHandle) -> Result<(), String> {
    engine(&app).stop_fade()
}

#[tauri::command]
pub fn dmx_blackout(app: AppHandle, on: bool) -> Result<(), String> {
    engine(&app).blackout(on)
}

#[tauri::command]
pub fn dmx_fade_to_black(app: AppHandle, seconds: Option<f64>) -> Result<(), String> {
    engine(&app).fade_to_black(self::seconds(seconds))
}

#[tauri::command]
pub fn dmx_release_black(app: AppHandle, seconds: Option<f64>) -> Result<(), String> {
    engine(&app).release_black(self::seconds(seconds))
}

/// Grand Master 0–255 on the intensity channels; `mask` (512 × 0/1) replaces the intensity mask.
#[tauri::command]
pub fn dmx_grand_master(app: AppHandle, level: u8, mask: Option<Vec<u8>>, universe: Option<u16>) -> Result<(), String> {
    engine(&app).grand_master(level, mask, universe)
}

/// Connection, progress and the values on the cable, now.
#[tauri::command]
pub fn dmx_get_status(app: AppHandle) -> Result<Snapshot, String> {
    engine(&app).snapshot()
}

/// The test pattern (Controlli → Luci DMX → Prova): channels 1…`channels` one at a time.
#[tauri::command]
pub fn dmx_test_output(app: AppHandle, on: bool, channels: Option<u16>, level: Option<u8>) -> Result<(), String> {
    engine(&app).test_output(on, channels, level)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_events_get_cues_prefix() {
        assert_eq!(event_name("dmx-status"), "cue-dmx-status");
        assert_eq!(event_name("dmx-progress"), "cue-dmx-progress");
        assert_eq!(event_name("dmx-output"), "cue-dmx-output");
    }

    #[test]
    fn connect_requests_read_as_granvelo_sends_them() {
        let r: ConnectRequest = serde_json::from_value(serde_json::json!({ "mode": "simulated" })).unwrap();
        assert!(matches!(r, ConnectRequest::Simulated));
        let r: ConnectRequest = serde_json::from_value(serde_json::json!({ "mode": "auto", "prefer": null })).unwrap();
        assert!(matches!(r, ConnectRequest::Auto { .. }));
    }
}
