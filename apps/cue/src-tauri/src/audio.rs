//! Cue's sound: the Tauri commands over the shared audio engine (`crates/audio-engine`).
//!
//! - One engine, Cue's own, started at the first command that needs it (not at launch: a Cue
//!   used only to read a script never opens an audio output) and stopped when Cue exits.
//! - Tracks come from several `.diaframma` files at once: `audio_sync` takes them per source and
//!   gives each the engine id `"<sourceId>:<trackId>"` (unique across files; the engine never
//!   looks inside ids). The live state (`cue-audio-state`) carries those ids.
//! - GO in Cue plays a track with `audio_play_now`: the engine's GO rules with Cue's
//!   configuration (`cue_config`: the other tracks are left alone, no steps, no auto advance —
//!   Cue's own GOs decide what stops and what starts by itself).

use std::sync::{Arc, Mutex, PoisonError};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

use audio_engine::model::{Config, LiveState, OthersOnGo, TrackParams};
use audio_engine::{Engine, EventSink, list_devices};

/// The event that carries the engine's `LiveState`.
pub const STATE_EVENT: &str = "cue-audio-state";

/// The engine, started on first use.
#[derive(Default)]
pub struct CueAudio(Mutex<Option<Engine>>);

/// The tracks of one source (one `.diaframma` file), ids as in the file.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSource {
    pub source_id: String,
    pub tracks: Vec<TrackParams>,
}

/// The engine id of a track of a source.
pub fn engine_id(source_id: &str, track_id: &str) -> String {
    format!("{source_id}:{track_id}")
}

/// Source id and track id of an engine id (`None` if it has no source prefix).
pub fn split_engine_id(id: &str) -> Option<(&str, &str)> {
    id.split_once(':')
}

/// All the tracks of all the sources, with engine ids (`sourceId:trackId`). A track whose
/// engine id was already given (the same source twice) is left out.
pub fn prefix_tracks(sources: Vec<SyncSource>) -> Vec<TrackParams> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for s in sources {
        for mut t in s.tracks {
            t.id = engine_id(&s.source_id, &t.id);
            if seen.insert(t.id.clone()) {
                out.push(t);
            }
        }
    }
    out
}

/// Cue's engine configuration: GO plays one track and leaves the others alone; nothing starts by
/// itself (Cue's GOs that "start by themselves" do it).
pub fn cue_config() -> Config {
    Config {
        others_on_go: OthersOnGo::Keep,
        auto_advance: false,
        steps: false,
        ..Config::default()
    }
}

fn engine(app: &AppHandle) -> Engine {
    let state = app.state::<CueAudio>();
    let mut slot = state.0.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(e) = slot.as_ref() {
        return e.clone();
    }
    let handle = app.clone();
    let sink: EventSink = Arc::new(move |event: &str, payload: serde_json::Value| {
        let _ = handle.emit(event, payload);
    });
    let e = Engine::start(sink, STATE_EVENT, false, cue_config());
    *slot = Some(e.clone());
    e
}

/// Stops every sound and the engine's voices (app exit). Nothing if it never started.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<CueAudio>() {
        if let Some(e) = state.0.lock().unwrap_or_else(PoisonError::into_inner).take() {
            e.shutdown();
        }
    }
}

// ---------------- Tauri commands ----------------

/// Names of the audio outputs of this computer (Settings → Uscite).
#[tauri::command(async)]
pub fn audio_list_devices() -> Vec<String> {
    list_devices()
}

/// The output by name (`None` = the system default). The output opens in the background: its
/// state arrives with `cue-audio-state` (`engine.ready`, `engine.error`).
#[tauri::command]
pub fn audio_set_device(app: AppHandle, name: Option<String>) {
    engine(&app).set_device(name);
}

/// The full list of tracks Cue may play, from every Diaframma source.
#[tauri::command]
pub fn audio_sync(app: AppHandle, sources: Vec<SyncSource>, config: Option<Config>) {
    engine(&app).sync(prefix_tracks(sources), config.unwrap_or_else(cue_config));
}

/// Plays a track now (a GO of Cue). Errors when the output is not available.
#[tauri::command]
pub fn audio_play_now(app: AppHandle, source_id: String, track_id: String) -> Result<(), String> {
    engine(&app).play_now(&engine_id(&source_id, &track_id))
}

/// Fades one track out (`fade_sec` null = a few milliseconds, never a click).
#[tauri::command]
pub fn audio_stop_track(app: AppHandle, source_id: String, track_id: String, fade_sec: Option<f64>) {
    let fade = fade_sec.filter(|f| f.is_finite() && *f > 0.0).unwrap_or(0.0);
    engine(&app).stop_track(&engine_id(&source_id, &track_id), fade);
}

/// Every sound out: `immediate` = at once, else with the general stop fade.
#[tauri::command]
pub fn audio_stop_all(app: AppHandle, immediate: bool) {
    engine(&app).stop_all(immediate);
}

/// Pause all (true) or resume all (false). Idempotent (the engine's own command is a toggle).
#[tauri::command]
pub fn audio_set_paused(app: AppHandle, paused: bool) {
    let e = engine(&app);
    if e.live_state().paused_all != paused {
        e.pause_all();
    }
}

/// What plays now (also sent as `cue-audio-state`).
#[tauri::command]
pub fn audio_state(app: AppHandle) -> LiveState {
    engine(&app).live_state()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str) -> TrackParams {
        serde_json::from_value(serde_json::json!({ "id": id, "path": format!("/tmp/{id}.wav"), "outSec": null, "loop": null })).unwrap()
    }

    #[test]
    fn track_ids_get_the_source_prefix() {
        let out = prefix_tracks(vec![
            SyncSource { source_id: "a".into(), tracks: vec![track("t1"), track("t2")] },
            SyncSource { source_id: "b".into(), tracks: vec![track("t1"), track("t1#act")] },
        ]);
        let ids: Vec<&str> = out.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["a:t1", "a:t2", "b:t1", "b:t1#act"]);
        // Paths and the rest of the track are kept.
        assert_eq!(out[2].path.as_deref(), Some("/tmp/t1.wav"));
    }

    #[test]
    fn the_same_source_twice_gives_each_track_once() {
        let out = prefix_tracks(vec![
            SyncSource { source_id: "a".into(), tracks: vec![track("t1")] },
            SyncSource { source_id: "a".into(), tracks: vec![track("t1"), track("t2")] },
        ]);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn engine_ids_split_at_the_first_colon() {
        assert_eq!(engine_id("src", "trk"), "src:trk");
        assert_eq!(split_engine_id("src:trk#a1"), Some(("src", "trk#a1")));
        assert_eq!(split_engine_id("plain"), None);
    }

    #[test]
    fn cue_config_leaves_other_tracks_alone() {
        let c = cue_config();
        assert_eq!(c.others_on_go, OthersOnGo::Keep);
        assert!(!c.steps && !c.auto_advance);
        // The sync payload from TypeScript (camelCase) reads.
        let s: SyncSource = serde_json::from_value(serde_json::json!({ "sourceId": "x", "tracks": [{ "id": "1", "path": null, "outSec": null, "loop": null }] })).unwrap();
        assert_eq!(s.tracks[0].id, "1");
    }
}
