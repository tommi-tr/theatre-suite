//! Data exchanged with the interface (JSON, camelCase).

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Default)]
pub struct EnvPoint {
    pub t: f64,
    pub v: f64,
}

/// How a track starts when GO plays it.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum OnSpace {
    #[default]
    Play,
    FadeIn,
    /// Old files only: crossfade now belongs to "At end or Space" of the track playing before.
    Crossfade,
    StopAllPlay,
}

/// What happens to a playing track at its end, or when GO is pressed while it plays.
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

impl AtEnd {
    /// These need a GO of their own before the next track can start.
    pub fn is_step(self) -> bool {
        matches!(self, AtEnd::Stop | AtEnd::FadeOut | AtEnd::LoopAll | AtEnd::LoopCut)
    }
    pub fn is_loop(self) -> bool {
        matches!(self, AtEnd::LoopAll | AtEnd::LoopCut)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum OthersOnGo {
    Pause,
    #[default]
    FadeOut,
    Keep,
    Stop,
}

/// Five-band equalizer, gains in dB: 60 Hz (shelf), 230 Hz, 910 Hz, 4 kHz, 14 kHz (shelf).
pub type Eq5 = [f64; 5];

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
    #[serde(default, deserialize_with = "de_eq")]
    pub eq: Eq5,
    #[serde(default)]
    pub in_sec: f64,
    pub out_sec: Option<f64>,
    #[serde(default)]
    pub envelope: Vec<EnvPoint>,
    #[serde(rename = "loop")]
    pub loop_points: Option<LoopPoints>,
}

/// Accepts the five-band array, and also the old `{low, mid, high}` object.
fn de_eq<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Eq5, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    let num = |x: Option<&serde_json::Value>| x.and_then(|x| x.as_f64()).filter(|x| x.is_finite()).unwrap_or(0.0).clamp(-24.0, 24.0);
    Ok(match &v {
        serde_json::Value::Array(a) => [num(a.first()), num(a.get(1)), num(a.get(2)), num(a.get(3)), num(a.get(4))],
        serde_json::Value::Object(o) => [num(o.get("low")), 0.0, num(o.get("mid")), 0.0, num(o.get("high"))],
        _ => [0.0; 5],
    })
}

impl TrackParams {
    pub fn playable(&self) -> bool {
        !self.hidden && self.path.is_some()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub others_on_go: OthersOnGo,
    pub auto_advance: bool,
    pub fade_in_sec: f64,
    pub fade_out_sec: f64,
    pub crossfade_sec: f64,
    pub stop_all_sec: f64,
    /// Main volume of this engine, dB.
    pub main_db: f64,
    /// First number of the cue list (0 or 1).
    pub number_from: u32,
    /// Show behaviour: a playing track with Stop / Fade out / Loop needs its own GO.
    /// Off for the internal player and the launchpad (GO just plays).
    pub steps: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            others_on_go: OthersOnGo::FadeOut,
            auto_advance: true,
            fade_in_sec: 3.0,
            fade_out_sec: 3.0,
            crossfade_sec: 4.0,
            stop_all_sec: 1.5,
            main_db: 0.0,
            number_from: 1,
            steps: true,
        }
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
    /// The track has At end: Loop all / Loop cut.
    pub looping: bool,
    /// It is repeating the loop now.
    pub in_loop: bool,
    /// This is the track the next GO acts on.
    pub main: bool,
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
    /// The track GO will start.
    pub standby_id: Option<String>,
    /// The track playing "in front" (the one whose At end or Space applies).
    pub main_id: Option<String>,
    /// A step the next GO performs on the main track before starting standby:
    /// "stop" | "fadeOut" | "loopAll" | "loopCut".
    pub pending: Option<&'static str>,
    /// Pause all is active: GO, P or Pause all resume.
    pub paused_all: bool,
    pub voices: Vec<VoiceState>,
    pub engine: EngineStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub duration_sec: f64,
    pub sample_rate: u32,
    pub channels: u32,
    /// Peak per bin, 0…1.
    pub peaks: Vec<f32>,
    /// Mean square per bin after K-weighting (for loudness matching).
    pub loudness: Vec<f32>,
}
