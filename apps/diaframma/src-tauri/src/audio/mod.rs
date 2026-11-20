//! Diaframma's audio: the Tauri commands over the shared engine (`crates/audio-engine`).
//!
//! Three independent engines run in the app: Show mode (`engine-state`), the internal player
//! of Rehearsal mode (`player-state`) and the launchpad (`pads-state`). Each sends its live
//! state through a sink that forwards it to the interface as a Tauri event.

use std::sync::Arc;

use tauri::{AppHandle, Emitter};

pub use audio_engine::{Engine, EventSink, decode, list_devices, model, selftest};
use model::*;

/// An engine whose live state reaches the interface as the Tauri event `event`.
pub fn start(app: &AppHandle, event: &'static str, lazy: bool, config: Config) -> Engine {
    let app = app.clone();
    let sink: EventSink = Arc::new(move |event: &str, payload: serde_json::Value| {
        let _ = app.emit(event, payload);
    });
    Engine::start(sink, event, lazy, config)
}

// ---------------- Tauri commands ----------------

#[tauri::command]
pub fn engine_devices() -> Vec<String> {
    list_devices()
}

#[tauri::command]
pub fn engine_set_device(engine: tauri::State<'_, Engine>, name: Option<String>) {
    engine.set_device(name);
}

#[tauri::command]
pub fn engine_sync(engine: tauri::State<'_, Engine>, tracks: Vec<TrackParams>, config: Config) {
    engine.sync(tracks, config);
}

#[tauri::command]
pub fn engine_set_standby(engine: tauri::State<'_, Engine>, track_id: Option<String>) {
    engine.set_standby(track_id);
}

#[tauri::command]
pub fn engine_standby_step(engine: tauri::State<'_, Engine>, delta: i32) {
    engine.standby_step(delta);
}

#[tauri::command]
pub fn engine_go(engine: tauri::State<'_, Engine>) -> Result<(), String> {
    engine.go()
}

#[tauri::command]
pub fn engine_pause(engine: tauri::State<'_, Engine>, track_id: String) {
    engine.toggle_pause(&track_id);
}

#[tauri::command]
pub fn engine_pause_all(engine: tauri::State<'_, Engine>) {
    engine.pause_all();
}

#[tauri::command]
pub async fn engine_seek(engine: tauri::State<'_, Engine>, track_id: String, sec: f64) -> Result<(), String> {
    engine.seek(&track_id, sec)
}

/// Stops one track of the cue list at once (a few milliseconds of fade, so it never clicks).
#[tauri::command]
pub fn engine_stop_track(engine: tauri::State<'_, Engine>, track_id: String) {
    engine.stop_track(&track_id, 0.0);
}

#[tauri::command]
pub fn engine_stop_all(engine: tauri::State<'_, Engine>, immediate: bool) {
    engine.stop_all(immediate);
}

#[tauri::command]
pub fn engine_state(engine: tauri::State<'_, Engine>) -> LiveState {
    engine.live_state()
}

#[tauri::command]
pub async fn engine_analyze(engine: tauri::State<'_, Engine>, path: String) -> Result<TrackInfo, String> {
    if let Some(info) = engine.analyze_cached(&path) {
        return Ok(info);
    }
    let p = path.clone();
    let info = tauri::async_runtime::spawn_blocking(move || decode::analyze(&p)).await.map_err(|e| e.to_string())??;
    engine.store_info(&path, info.clone());
    Ok(info)
}

/// Reliability test (Settings → Test): plays the cue list silently, several times in a row.
#[tauri::command]
pub async fn selftest_run(app: AppHandle, tracks: Vec<TrackParams>, config: Config, runs: u32) -> Result<selftest::TestReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = |p: selftest::Progress| {
            let _ = app.emit("selftest-progress", &p);
        };
        selftest::run(tracks, config, runs, &progress)
    })
    .await
    .map_err(|e| e.to_string())
}

// ---------------- Internal player (Rehearsal mode) ----------------
//
// A second, independent engine: one track at a time, its own output.

pub struct Player(pub Engine);

#[tauri::command]
pub fn player_sync(p: tauri::State<'_, Player>, tracks: Vec<TrackParams>, config: Config) {
    p.0.sync(tracks, config);
}

#[tauri::command]
pub fn player_play(p: tauri::State<'_, Player>, track_id: String) -> Result<(), String> {
    p.0.play_now(&track_id)
}

#[tauri::command]
pub fn player_pause(p: tauri::State<'_, Player>, track_id: String) {
    p.0.toggle_pause(&track_id);
}

#[tauri::command]
pub async fn player_seek(p: tauri::State<'_, Player>, track_id: String, sec: f64) -> Result<(), String> {
    p.0.seek(&track_id, sec)
}

#[tauri::command]
pub fn player_stop(p: tauri::State<'_, Player>) {
    p.0.stop_all(true);
}

#[tauri::command]
pub fn player_set_speed(p: tauri::State<'_, Player>, speed: f64) {
    p.0.set_speed(speed);
}

#[tauri::command]
pub fn player_set_device(p: tauri::State<'_, Player>, name: Option<String>) {
    p.0.set_device(name);
}

#[tauri::command]
pub fn player_state(p: tauri::State<'_, Player>) -> LiveState {
    p.0.live_state()
}

// ---------------- Launchpad ----------------
//
// A third engine: pads play on top of everything, each on its own.

pub struct Pads(pub Engine);

#[tauri::command]
pub fn pads_sync(p: tauri::State<'_, Pads>, tracks: Vec<TrackParams>, config: Config) {
    p.0.sync(tracks, config);
}

#[tauri::command]
pub fn pads_play(p: tauri::State<'_, Pads>, track_id: String) -> Result<(), String> {
    p.0.play_now(&track_id)
}

#[tauri::command]
pub fn pads_stop(p: tauri::State<'_, Pads>, track_id: String, fade_sec: f64) {
    p.0.stop_track(&track_id, fade_sec);
}

#[tauri::command]
pub fn pads_stop_all(p: tauri::State<'_, Pads>) {
    p.0.stop_all(false);
}

#[tauri::command]
pub fn pads_set_device(p: tauri::State<'_, Pads>, name: Option<String>) {
    p.0.set_device(name);
}

#[tauri::command]
pub fn pads_state(p: tauri::State<'_, Pads>) -> LiveState {
    p.0.live_state()
}
