//! Data exchanged with the interface (JSON, camelCase).

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Default)]
pub struct EnvPoint {
    pub t: f64,
    pub v: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum OnSpace {
    #[default]
    Play,
    FadeIn,
    Crossfade,
    StopAllPlay,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AtEnd {
    #[default]
    Stop,
    Next,
    FadeOut,
    Crossfade,
    LoopAll,
    LoopCut,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum OthersOnGo {
    #[default]
    Pause,
    FadeOut,
    Keep,
    Stop,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Default)]
pub struct Eq {
    pub low: f64,
    pub mid: f64,
    pub high: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoopPoints {
    pub in_sec: f64,
    pub out_sec: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackParams {
    pub id: String,
    #[serde(default)]
    pub hidden: bool,
    pub path: Option<String>,
    #[serde(default)]
    pub on_space: OnSpace,
    #[serde(default)]
    pub at_end: AtEnd,
    #[serde(default)]
    pub ignore_volume: bool,
    #[serde(default)]
    pub volume_db: f64,
    #[serde(default)]
    pub eq: Eq,
    #[serde(default)]
    pub in_sec: f64,
    pub out_sec: Option<f64>,
    #[serde(default)]
    pub envelope: Vec<EnvPoint>,
    #[serde(rename = "loop")]
    pub loop_points: Option<LoopPoints>,
}

impl TrackParams {
    pub fn playable(&self) -> bool {
        !self.hidden && self.path.is_some()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub others_on_go: OthersOnGo,
    pub auto_advance: bool,
    pub fade_in_sec: f64,
    pub fade_out_sec: f64,
    pub crossfade_sec: f64,
    pub stop_all_sec: f64,
}

impl Default for Config {
    fn default() -> Self {
        Self { others_on_go: OthersOnGo::Pause, auto_advance: true, fade_in_sec: 3.0, fade_out_sec: 3.0, crossfade_sec: 4.0, stop_all_sec: 1.5 }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceState {
    pub track_id: String,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub paused: bool,
    pub fading: Option<&'static str>,
    pub looping: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub ready: bool,
    pub device: String,
    pub sample_rate: u32,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveState {
    pub standby_id: Option<String>,
    pub voices: Vec<VoiceState>,
    pub engine: EngineStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub duration_sec: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub peaks: Vec<f32>,
}
