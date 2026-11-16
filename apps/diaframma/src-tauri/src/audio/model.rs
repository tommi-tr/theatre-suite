//! Data exchanged with the interface (JSON, camelCase).

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Default)]
pub struct EnvPoint {
    pub t: f64,
    pub v: f64,
}

/// What a track does when GO starts it (optional, "Entrata").
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Entry {
    FadeIn,
}

/// What a track does when it leaves, at GO or at its end (optional, "Uscita").
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Exit {
    FadeOut,
    Crossfade,
    /// Cut at GO; at the end of the track the next one starts exactly there.
    Next,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum OthersOnGo {
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
    /// How the track starts (None = plain start).
    #[serde(default)]
    pub entry: Option<Entry>,
    /// Length of the fade in; None = the general setting.
    #[serde(default)]
    pub entry_sec: Option<f64>,
    /// How the track leaves at GO or at its end (None = the general setting at GO, stop at the end).
    #[serde(default)]
    pub exit: Option<Exit>,
    /// Length of the fade out / crossfade; None = the general setting.
    #[serde(default)]
    pub exit_sec: Option<f64>,
    /// Repeats until GO (the loop points if there are any, else the whole track).
    #[serde(default)]
    pub loop_on: bool,
    #[serde(default)]
    pub volume_db: f64,
    #[serde(default, deserialize_with = "de_eq")]
    pub eq: Eq5,
    /// Balance, -1 (left) … +1 (right).
    #[serde(default)]
    pub pan: f64,
    #[serde(default)]
    pub in_sec: f64,
    pub out_sec: Option<f64>,
    #[serde(default)]
    pub envelope: Vec<EnvPoint>,
    /// Pan over time, `v` -1…+1.
    #[serde(default)]
    pub pan_envelope: Vec<EnvPoint>,
    #[serde(rename = "loop")]
    pub loop_points: Option<LoopPoints>,
    /// Play from 00:00 to the end of the file, keeping IN and OUT saved.
    #[serde(default)]
    pub ignore_cut: bool,
    /// Volume curve bypassed (kept saved).
    #[serde(default)]
    pub ignore_envelope: bool,
    /// Loop points bypassed: the loop covers the whole track.
    #[serde(default)]
    pub ignore_loop: bool,
    /// Pan curve bypassed: the pan fader alone decides.
    #[serde(default)]
    pub ignore_pan: bool,
}

/// Reads the five-band array (gains clamped to ±24 dB); anything else is a flat EQ.
fn de_eq<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Eq5, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    let num = |x: Option<&serde_json::Value>| x.and_then(|x| x.as_f64()).filter(|x| x.is_finite()).unwrap_or(0.0).clamp(-24.0, 24.0);
    Ok(match &v {
        serde_json::Value::Array(a) => [num(a.first()), num(a.get(1)), num(a.get(2)), num(a.get(3)), num(a.get(4))],
        _ => [0.0; 5],
    })
}

impl TrackParams {
    pub fn playable(&self) -> bool {
        !self.hidden && self.path.is_some()
    }
    /// Where the track starts (00:00 when the cut is ignored).
    pub fn eff_in(&self) -> f64 {
        if self.ignore_cut { 0.0 } else { self.in_sec.max(0.0) }
    }
    /// Where the track stops (None = end of the file).
    pub fn eff_out(&self) -> Option<f64> {
        if self.ignore_cut { None } else { self.out_sec }
    }
    pub fn volume_curve(&self) -> &[EnvPoint] {
        if self.ignore_envelope { &[] } else { &self.envelope }
    }
    pub fn pan_curve(&self) -> &[EnvPoint] {
        if self.ignore_pan { &[] } else { &self.pan_envelope }
    }
    /// Loop points in use (None = loop the whole track, or no loop).
    pub fn cut_points(&self) -> Option<LoopPoints> {
        if self.ignore_loop { None } else { self.loop_points.filter(|l| l.out_sec > l.in_sec) }
    }
    /// Plays to the end first, then repeats the loop points ("loop cut").
    pub fn loop_cut(&self) -> bool {
        self.loop_on && self.cut_points().is_some()
    }
    /// Length of the fade in, seconds.
    pub fn entry_len(&self, cfg: &Config) -> f64 {
        self.entry_sec.unwrap_or(cfg.fade_in_sec).max(0.0)
    }
    /// Length of the fade out or crossfade, seconds.
    pub fn exit_len(&self, cfg: &Config) -> f64 {
        let general = if self.exit == Some(Exit::Crossfade) { cfg.crossfade_sec } else { cfg.fade_out_sec };
        self.exit_sec.unwrap_or(general).max(0.0)
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
    /// Quick fade used when a track with no Exit is left at GO.
    pub quick_fade_sec: f64,
    /// Main volume of this engine, dB.
    pub main_db: f64,
    /// First number of the cue list (0 or 1).
    pub number_from: u32,
    /// Show behaviour: the track in front leaves by its Exit, and Exit Next / Crossfade
    /// start the attention track by themselves. Off for the internal player and the
    /// launchpad (GO just plays).
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
            quick_fade_sec: 1.5,
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
    /// The track has Loop on.
    pub looping: bool,
    /// It is repeating the loop now.
    pub in_loop: bool,
    /// This is the track in front: the one whose Exit applies at GO.
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
    /// The track GO will start (the attention track).
    pub standby_id: Option<String>,
    /// The track playing "in front" (the one whose Exit applies).
    pub main_id: Option<String>,
    /// The attention track will start by itself (the track in front ends with Next / Crossfade).
    pub auto_start: bool,
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
