//! Rehearsal mode: the audio players open on this computer.
//!
//! On Windows (win.rs): media sessions (play/pause/next/previous), volume of
//! each program (WASAPI) and the output each program uses (the undocumented
//! policy interface also used by EarTrumpet). Every change is written to a
//! journal on disk first, so Diaframma can put things back as it found them
//! when it closes, or at the next start after a crash.

use serde::{Deserialize, Serialize};

#[cfg(windows)]
mod win;

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub app: String,
    pub exe: String,
    /// "spotify" | "browser" | "media" | "vlc" | "wmp" | "program"
    pub kind: String,
    pub title: String,
    pub artist: String,
    pub thumb: Option<String>,
    /// "playing" | "paused" | "stopped"
    pub status: String,
    pub can_toggle: bool,
    pub can_next: bool,
    pub can_prev: bool,
    pub can_speed: bool,
    pub speed: Option<f64>,
    pub volume: Option<f32>,
    pub peak: f32,
    pub pids: Vec<u32>,
    /// Output device id, or None for the Windows default.
    pub output_id: Option<String>,
    pub position_sec: Option<f64>,
    pub duration_sec: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub id: String,
    pub name: String,
    /// Short description from Windows ("Speakers", "Headphones"…).
    pub description: String,
    /// "speakers" | "headphones" | "hdmi" | "digital" | "line" | "other"
    pub kind: String,
    /// False: known to Windows but not connected now (not usable).
    pub connected: bool,
    /// Volume of the output itself (0…1).
    pub volume: Option<f32>,
    pub is_default: bool,
    pub peak_l: f32,
    pub peak_r: f32,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub supported: bool,
    pub routing_available: bool,
    pub sources: Vec<Source>,
    pub outputs: Vec<Output>,
    pub pending_restore: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
pub struct JournalEntry {
    pub exe: String,
    pub volume: Option<f32>,
    /// Some(None) = was following the Windows default; None = never changed.
    pub route: Option<Option<String>>,
}

#[cfg(windows)]
pub use win::Rehearsal;

#[cfg(not(windows))]
pub struct Rehearsal;

#[cfg(not(windows))]
impl Rehearsal {
    pub fn start(_journal: std::path::PathBuf) -> Self {
        Rehearsal
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot::default()
    }
    pub fn media(&self, _id: String, _action: String) -> Result<(), String> {
        Err("Only available on Windows".into())
    }
    pub fn set_volume(&self, _ids: Vec<String>, _v: f32) {}
    pub fn set_speed(&self, _ids: Vec<String>, _r: f64) {}
    pub fn route(&self, _id: String, _output: Option<String>) -> Result<(), String> {
        Err("Only available on Windows".into())
    }
    pub fn pause_all(&self) {}
    pub fn set_output_volume(&self, _id: String, _v: f32) {}
    pub fn restore(&self) {}
}

// ---------------- Tauri commands ----------------

#[tauri::command]
pub async fn rh_snapshot(rh: tauri::State<'_, Rehearsal>) -> Result<Snapshot, String> {
    Ok(rh.snapshot())
}

#[tauri::command]
pub async fn rh_media(rh: tauri::State<'_, Rehearsal>, id: String, action: String) -> Result<(), String> {
    rh.media(id, action)
}

#[tauri::command]
pub async fn rh_set_volume(rh: tauri::State<'_, Rehearsal>, ids: Vec<String>, volume: f32) -> Result<(), String> {
    rh.set_volume(ids, volume.clamp(0.0, 1.0));
    Ok(())
}

#[tauri::command]
pub async fn rh_set_speed(rh: tauri::State<'_, Rehearsal>, ids: Vec<String>, rate: f64) -> Result<(), String> {
    rh.set_speed(ids, rate.clamp(0.25, 4.0));
    Ok(())
}

#[tauri::command]
pub async fn rh_route(rh: tauri::State<'_, Rehearsal>, id: String, output_id: Option<String>) -> Result<(), String> {
    rh.route(id, output_id)
}

#[tauri::command]
pub async fn rh_pause_all(rh: tauri::State<'_, Rehearsal>) -> Result<(), String> {
    rh.pause_all();
    Ok(())
}

#[tauri::command]
pub async fn rh_set_output_volume(rh: tauri::State<'_, Rehearsal>, id: String, volume: f32) -> Result<(), String> {
    rh.set_output_volume(id, volume.clamp(0.0, 1.0));
    Ok(())
}

#[tauri::command]
pub async fn rh_restore(rh: tauri::State<'_, Rehearsal>) -> Result<(), String> {
    rh.restore();
    Ok(())
}
