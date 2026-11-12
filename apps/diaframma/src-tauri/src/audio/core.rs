//! Engine core without any dependency on the window: voices, mixing,
//! GO semantics and the Entry / Exit of each track. Kept apart so it can be tested alone.
//!
//! There is always one attention track (standby) and GO always starts it:
//! 1. Pause all is active → everything that was paused by it resumes.
//! 2. Otherwise the standby track starts. The track in front leaves by its Exit
//!    (Fade out · Crossfade · Next = cut); with no Exit it follows the general setting,
//!    like any other track that is still playing.
//! At the end of a track: no Exit → it stops; Fade out → it fades before the end;
//! Crossfade → the standby track starts, crossfading; Next → the standby track starts
//! exactly at the end. A track with Loop on repeats until GO.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use super::decode::{FeedParams, FeederHandles, Segment, spawn_feeder_ex};
use super::dsp::{Eq5, Fade, db_to_gain, envelope_gain, pan_at, pan_gains};
use super::model::*;

pub const QUICK_STOP_SEC: f64 = 0.015;
pub const PAUSE_RAMP_SEC: f64 = 0.03;
/// Short crossfade used when a voice is replaced by another one at the same place (no click).
pub const JUMP_SEC: f64 = 0.04;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AfterFade {
    Nothing,
    Stop,
}

pub struct Voice {
    pub track_id: String,
    pub path: String,
    pub start_sec: f64,
    pub rate: u32,
    pub h: FeederHandles,
    pub seg: Segment,
    pub next_seg: Option<Segment>,
    pub consumed: u64,
    pub pos: f64,
    pub duration: f64,
    pub fade: Fade,
    pub after_fade: AfterFade,
    pub pause: Fade,
    pub paused: bool,
    /// Paused by "Pause all" (resumed by GO / P / Pause all).
    pub paused_by_all: bool,
    pub eq: Eq5,
    pub gain: f32,
    /// Smoothed pan, -1…+1 (NaN until the first block).
    pub pan: f32,
    pub pan_l: f32,
    pub pan_r: f32,
    pub at_end_fired: bool,
    pub ended: bool,
    /// Playback has reached the loop (a loop jump was heard, or it started inside the loop).
    pub looped: bool,
}

impl Voice {
    pub fn new(track_id: String, path: String, start_sec: f64, rate: u32, h: FeederHandles, duration: f64) -> Self {
        let seg = Segment { start_frame: 0, src_start: start_sec, speed: h.ctl.speed(), jump: false };
        let looped = h.ctl.start_in_loop;
        Self {
            track_id,
            path,
            start_sec,
            rate,
            h,
            seg,
            next_seg: None,
            consumed: 0,
            pos: start_sec,
            duration,
            fade: Fade::steady(1.0),
            after_fade: AfterFade::Nothing,
            pause: Fade::steady(1.0),
            paused: false,
            paused_by_all: false,
            eq: Eq5::default(),
            gain: -1.0,
            pan: f32::NAN,
            pan_l: 1.0,
            pan_r: 1.0,
            at_end_fired: false,
            ended: false,
            looped,
        }
    }
    pub fn frames(&self, sec: f64) -> u64 {
        (sec.max(0.0) * self.rate as f64) as u64
    }
    pub fn fade_to(&mut self, target: f32, sec: f64, after: AfterFade) {
        if self.paused && target == 0.0 && after == AfterFade::Stop {
            // A paused voice is silent already: stop it right away.
            self.ended = true;
            return;
        }
        let n = self.frames(sec);
        self.fade = Fade::to(self.fade.value(), target, n.max(1));
        self.after_fade = after;
    }
    pub fn fade_in(&mut self, sec: f64) {
        if sec > 0.0 {
            let n = self.frames(sec);
            self.fade = Fade::to(0.0, 1.0, n.max(1));
        }
    }
    pub fn set_paused(&mut self, p: bool) {
        if p == self.paused {
            return;
        }
        self.paused = p;
        if !p {
            self.paused_by_all = false;
        }
        let n = self.frames(PAUSE_RAMP_SEC);
        self.pause = Fade::to(self.pause.value(), if p { 0.0 } else { 1.0 }, n);
    }
    pub fn stopping(&self) -> bool {
        self.ended || (self.after_fade == AfterFade::Stop && self.fade.target() == 0.0)
    }
    pub fn alive(&self) -> bool {
        !self.stopping()
    }
    pub fn fully_paused(&self) -> bool {
        self.paused && self.pause.done()
    }
    pub fn in_loop(&self) -> bool {
        self.looped
    }
}

#[derive(Clone, Debug)]
pub enum Request {
    /// Start the standby track (At end: Next / Crossfade of the main track).
    StartStandby { fade_sec: f64 },
}

pub struct State {
    pub tracks: Vec<TrackParams>,
    pub config: Config,
    /// The track GO will start.
    pub standby: Option<String>,
    /// The track playing in front.
    pub main: Option<String>,
    pub paused_all: bool,
    pub voices: Vec<Voice>,
    pub prepared: Vec<Voice>,
    pub graveyard: Vec<Voice>,
    pub requests: Vec<Request>,
    pub rate: u32,
    pub status: EngineStatus,
    pub scratch: Vec<f32>,
    pub speed: f64,
    /// Smoothed main gain.
    pub main_gain: f32,
}

impl State {
    pub fn new() -> Self {
        State {
            tracks: Vec::new(),
            config: Config::default(),
            standby: None,
            main: None,
            paused_all: false,
            voices: Vec::with_capacity(64),
            prepared: Vec::with_capacity(16),
            graveyard: Vec::with_capacity(64),
            requests: Vec::with_capacity(16),
            rate: 0,
            status: EngineStatus { ready: false, device: String::new(), sample_rate: 0, error: None },
            scratch: Vec::new(),
            speed: 1.0,
            main_gain: 1.0,
        }
    }
    pub fn track(&self, id: &str) -> Option<&TrackParams> {
        self.tracks.iter().find(|t| t.id == id)
    }
    pub fn next_playable(&self, id: &str) -> Option<String> {
        let i = self.tracks.iter().position(|t| t.id == id)?;
        self.tracks[i + 1..].iter().find(|t| t.playable()).map(|t| t.id.clone())
    }
    pub fn advance_standby_after(&mut self, id: &str) {
        if self.config.auto_advance {
            self.standby = self.next_playable(id);
        }
    }
    /// Index of the voice of the main track (the newest one still playing).
    pub fn main_index(&self) -> Option<usize> {
        let id = self.main.as_deref()?;
        self.voices.iter().rposition(|v| v.track_id == id && v.alive())
    }
    /// The track in front ends with Next / Crossfade and nothing stops it (no loop):
    /// the standby track will start by itself.
    pub fn auto_start(&self) -> bool {
        if !self.config.steps {
            return false;
        }
        let Some(i) = self.main_index() else { return false };
        let Some(tp) = self.track(&self.voices[i].track_id) else { return false };
        let standby_ok = self.standby.as_deref().and_then(|id| self.track(id)).map(|t| t.playable()).unwrap_or(false);
        standby_ok && !tp.loop_on && matches!(tp.exit, Some(Exit::Next) | Some(Exit::Crossfade))
    }
}

impl Default for State {
    fn default() -> Self {
        Self::new()
    }
}

pub fn feed_params(tp: &TrackParams) -> FeedParams {
    let looping = if tp.loop_on {
        Some(match tp.cut_points() {
            // Loop cut: the points.
            Some(l) => (l.in_sec.max(0.0), l.out_sec),
            // No points (or ignored): the whole track.
            None => (tp.eff_in(), tp.eff_out().unwrap_or(f64::INFINITY)),
        })
    } else {
        None
    };
    FeedParams { out_sec: tp.eff_out(), looping, loop_after_end: tp.loop_cut() }
}

/// Mixes all active voices into `out` (interleaved, `channels` per frame).
pub fn render(st: &mut State, out: &mut [f32], channels: usize) {
    out.iter_mut().for_each(|s| *s = 0.0);
    if channels == 0 || st.rate == 0 {
        return;
    }
    let frames = out.len() / channels;
    let rate = st.rate as f64;
    // (fade_sec) of a standby start requested by the track in front.
    let mut start_standby: Option<f64> = None;
    let main_idx = st.main_index();
    let main_target = db_to_gain(st.config.main_db as f32);
    let State { tracks, voices, config, .. } = st;
    for (vi, v) in voices.iter_mut().enumerate() {
        if v.ended {
            continue;
        }
        let is_main = main_idx == Some(vi) && config.steps;
        let tp = tracks.iter().find(|t| t.id == v.track_id);
        let (target_gain, ignore, env): (f32, bool, &[EnvPoint]) = match tp {
            Some(tp) => (db_to_gain(tp.volume_db as f32), false, tp.volume_curve()),
            _ => (1.0, true, &[]),
        };
        let (pan_fader, pan_curve): (f32, &[EnvPoint]) = match tp {
            Some(tp) => (tp.pan.clamp(-1.0, 1.0) as f32, tp.pan_curve()),
            None => (0.0, &[]),
        };
        if let Some(tp) = tp {
            v.eq.configure(&tp.eq, rate as f32);
        }
        if v.gain < 0.0 {
            v.gain = target_gain;
        }
        if v.pan.is_nan() {
            v.pan = pan_at(pan_curve, v.pos).unwrap_or(pan_fader);
        }
        if v.fully_paused() {
            continue;
        }
        let avail = v.h.audio.slots() / 2;
        let n = frames.min(avail);
        let mut buf = [0f32; 1024];
        let mut done = 0usize;
        while done < n {
            let k = (n - done).min(buf.len() / 2);
            if v.h.audio.pop_entire_slice(&mut buf[..k * 2]).is_err() {
                break;
            }
            for j in 0..k {
                let (l, r) = (buf[2 * j], buf[2 * j + 1]);
                if v.next_seg.is_none() {
                    v.next_seg = v.h.segments.pop().ok();
                }
                if let Some(ns) = v.next_seg {
                    if v.consumed >= ns.start_frame {
                        v.seg = ns;
                        if ns.jump {
                            v.looped = true;
                        }
                        v.next_seg = v.h.segments.pop().ok();
                    }
                }
                v.pos = v.seg.src_start + (v.consumed.saturating_sub(v.seg.start_frame)) as f64 / rate * v.seg.speed;
                v.gain += (target_gain - v.gain) * 0.002;
                let env_g = if ignore || env.is_empty() { 1.0 } else { envelope_gain(env, v.pos) };
                let g = v.gain * env_g * v.fade.value() * v.pause.value();
                // Pan: the curve if there is one, else the fader; smoothed so it never clicks.
                let pan_target = pan_at(pan_curve, v.pos).unwrap_or(pan_fader);
                v.pan += (pan_target - v.pan) * 0.002;
                if (done + j) & 15 == 0 {
                    (v.pan_l, v.pan_r) = pan_gains(v.pan);
                }
                let (l, r) = v.eq.process(l, r);
                let o = (done + j) * channels;
                if channels == 1 {
                    out[o] += 0.5 * (l + r) * g;
                } else {
                    out[o] += l * g * v.pan_l;
                    out[o + 1] += r * g * v.pan_r;
                }
                v.fade.advance(1);
                v.pause.advance(1);
                v.consumed += 1;
            }
            done += k;
        }
        // Fade finished?
        if v.fade.done() && v.after_fade == AfterFade::Stop && v.fade.target() == 0.0 {
            v.ended = true;
        }
        // End of the file (or of OUT) reached?
        if n < frames && v.h.ctl.finished.load(Ordering::Acquire) && v.consumed >= v.h.ctl.pushed.load(Ordering::Acquire) {
            v.ended = true;
            if let Some(tp) = tp {
                if is_main && tp.exit == Some(Exit::Next) && !tp.loop_on && !v.at_end_fired {
                    v.at_end_fired = true;
                    start_standby = Some(0.0);
                }
            }
        }
        // Fade out / crossfade before the end (never while the track loops: it has no end).
        if let Some(tp) = tp {
            if !v.at_end_fired && !v.stopping() && !tp.loop_on {
                let out_eff = match tp.eff_out() {
                    Some(o) if v.duration > 0.0 => o.min(v.duration),
                    Some(o) => o,
                    None => v.duration,
                };
                let lead = match tp.exit {
                    Some(Exit::FadeOut) | Some(Exit::Crossfade) => tp.exit_len(config),
                    _ => -1.0,
                };
                if lead >= 0.0 && out_eff > 0.0 && v.pos >= out_eff - lead {
                    v.at_end_fired = true;
                    let remaining = (out_eff - v.pos).max(0.05);
                    v.fade_to(0.0, remaining, AfterFade::Stop);
                    if tp.exit == Some(Exit::Crossfade) && is_main {
                        start_standby = Some(remaining);
                    }
                }
            }
        }
    }
    // Main volume, smoothed, then a safety clip on loud mixes.
    let mut mg = st.main_gain;
    for f in 0..frames {
        mg += (main_target - mg) * 0.003;
        for c in 0..channels {
            let s = &mut out[f * channels + c];
            *s *= mg;
            if *s > 1.0 || *s < -1.0 {
                *s = s.clamp(-1.0, 1.0);
            }
        }
    }
    st.main_gain = mg;
    // Move ended voices out of the mix (dropped later by the control thread).
    let mut i = 0;
    while i < st.voices.len() {
        if st.voices[i].ended {
            let v = st.voices.swap_remove(i);
            st.graveyard.push(v);
        } else {
            i += 1;
        }
    }
    if let Some(fade_sec) = start_standby {
        start_standby_in_callback(st, fade_sec);
    }
}

/// Starts the standby track from the audio callback if it is ready, else asks the control thread.
pub fn start_standby_in_callback(st: &mut State, fade_sec: f64) {
    let Some(id) = st.standby.clone() else { return };
    if !st.track(&id).map(|t| t.playable()).unwrap_or(false) {
        return;
    }
    if let Some(i) = st.prepared.iter().position(|p| p.track_id == id) {
        let mut v = st.prepared.swap_remove(i);
        v.fade_in(fade_sec);
        started(st, &id, v);
    } else {
        st.requests.push(Request::StartStandby { fade_sec });
    }
}

/// A voice of track `id` becomes the main one.
pub fn started(st: &mut State, id: &str, v: Voice) {
    st.voices.push(v);
    st.main = Some(id.to_string());
    st.paused_all = false;
    st.advance_standby_after(id);
}

/// What a GO is going to do (decided under the lock, carried out by the engine).
#[derive(Debug, PartialEq)]
pub enum GoPlan {
    Nothing,
    /// Pause all was active: resumed.
    Resumed,
    /// Start this track.
    Start(TrackParams),
}

/// First part of GO: everything that does not need a new voice is done here.
pub fn plan_go(st: &mut State) -> GoPlan {
    if st.paused_all {
        resume_all(st);
        return GoPlan::Resumed;
    }
    let Some(sb) = st.standby.clone() else { return GoPlan::Nothing };
    let Some(tp) = st.track(&sb).cloned() else { return GoPlan::Nothing };
    if !tp.playable() {
        st.advance_standby_after(&sb);
        return GoPlan::Nothing;
    }
    GoPlan::Start(tp)
}

/// Second part of GO: start `tp` with voice `v`. The track in front leaves by its Exit.
pub fn apply_go(st: &mut State, tp: &TrackParams, mut v: Voice) {
    let cfg = st.config;
    let main_idx = if cfg.steps { st.main_index() } else { None };
    let main_exit = main_idx.and_then(|i| st.track(&st.voices[i].track_id).map(|t| (t.exit, t.exit_len(&cfg))));
    // Some(seconds) when the track in front hands over with a crossfade.
    let mut crossfade_in: Option<f64> = None;
    for (i, o) in st.voices.iter_mut().enumerate() {
        if o.track_id == tp.id {
            // The same track again: the old voice leaves quickly.
            o.fade_to(0.0, QUICK_STOP_SEC, AfterFade::Stop);
            continue;
        }
        if o.stopping() {
            continue;
        }
        if Some(i) == main_idx {
            match main_exit {
                Some((Some(Exit::Next), _)) => {
                    o.fade_to(0.0, QUICK_STOP_SEC, AfterFade::Stop);
                    continue;
                }
                Some((Some(Exit::Crossfade), sec)) => {
                    o.fade_to(0.0, sec.max(QUICK_STOP_SEC), AfterFade::Stop);
                    crossfade_in = Some(sec);
                    continue;
                }
                Some((Some(Exit::FadeOut), sec)) => {
                    o.fade_to(0.0, sec.max(QUICK_STOP_SEC), AfterFade::Stop);
                    continue;
                }
                _ => {}
            }
        }
        // No Exit (or not the track in front): the general setting.
        match cfg.others_on_go {
            OthersOnGo::FadeOut => o.fade_to(0.0, cfg.quick_fade_sec.max(QUICK_STOP_SEC), AfterFade::Stop),
            OthersOnGo::Keep => {}
            OthersOnGo::Stop => o.fade_to(0.0, QUICK_STOP_SEC, AfterFade::Stop),
        }
    }
    if let Some(sec) = crossfade_in {
        v.fade_in(sec);
    } else if tp.entry == Some(Entry::FadeIn) {
        v.fade_in(tp.entry_len(&cfg));
    }
    started(st, &tp.id, v);
    // Keep at most a few paused tracks (each one holds a decoder): the oldest are released.
    const MAX_PAUSED: usize = 8;
    let paused: Vec<usize> = st.voices.iter().enumerate().filter(|(_, x)| x.paused && !x.ended).map(|(i, _)| i).collect();
    if paused.len() > MAX_PAUSED {
        for &i in &paused[..paused.len() - MAX_PAUSED] {
            st.voices[i].ended = true;
        }
    }
}

/// Pause all (P): pauses everything that plays; pressed again, resumes it.
pub fn toggle_pause_all(st: &mut State) {
    if st.paused_all {
        resume_all(st);
        return;
    }
    let mut any = false;
    for v in st.voices.iter_mut().filter(|v| v.alive() && !v.paused) {
        v.set_paused(true);
        v.paused_by_all = true;
        any = true;
    }
    st.paused_all = any;
}

pub fn resume_all(st: &mut State) {
    for v in st.voices.iter_mut().filter(|v| v.paused_by_all) {
        v.set_paused(false);
    }
    st.paused_all = false;
}

pub fn stop_all(st: &mut State, immediate: bool) {
    let sec = if immediate { QUICK_STOP_SEC } else { st.config.stop_all_sec.max(QUICK_STOP_SEC) };
    for v in st.voices.iter_mut() {
        if immediate || !v.stopping() {
            v.fade_to(0.0, sec, AfterFade::Stop);
        }
    }
    st.paused_all = false;
}

/// Second part of a seek on a paused track: `v` replaces the old voice, still paused.
pub fn apply_seek(st: &mut State, track_id: &str, mut v: Voice) -> bool {
    let Some(i) = st.voices.iter().rposition(|x| x.track_id == track_id && x.alive()) else { return false };
    let old = &mut st.voices[i];
    v.paused = old.paused;
    v.paused_by_all = old.paused_by_all;
    v.pause = if old.paused { Fade::steady(0.0) } else { Fade::steady(1.0) };
    if !old.paused {
        v.fade_in(JUMP_SEC);
        old.fade_to(0.0, JUMP_SEC, AfterFade::Stop);
    } else {
        old.ended = true;
    }
    st.voices.push(v);
    true
}

// ---------------- Without an audio output (tests and the reliability test) ----------------

/// Opens a voice of `tp` at `at` seconds for a state that has no output device.
pub fn headless_voice(st: &State, tp: &TrackParams, at: f64) -> Result<Voice, String> {
    let path = tp.path.clone().ok_or("The track has no file")?;
    let h = spawn_feeder_ex(path.clone(), at, st.rate, feed_params(tp), st.speed, false)?;
    let t0 = Instant::now();
    while h.audio.slots() < 2048 && !h.ctl.finished.load(Ordering::Relaxed) && !h.ctl.failed.load(Ordering::Relaxed) && t0.elapsed() < Duration::from_millis(400) {
        std::thread::sleep(Duration::from_millis(2));
    }
    let d = h.ctl.duration();
    Ok(Voice::new(tp.id.clone(), path, at, st.rate, h, d))
}

/// Keeps the standby track ready, like the control thread of the real engine.
pub fn prepare_headless(st: &mut State) {
    let Some(sb) = st.standby.clone() else { return };
    let Some(tp) = st.track(&sb).cloned() else { return };
    if !tp.playable() || st.prepared.iter().any(|p| p.track_id == sb) {
        return;
    }
    if let Ok(v) = headless_voice(st, &tp, tp.eff_in()) {
        st.prepared.push(v);
    }
}

/// Serves the start requests of the callback (the real engine does this on its control thread).
pub fn serve_headless(st: &mut State) {
    let reqs: Vec<Request> = st.requests.drain(..).collect();
    for r in reqs {
        let Request::StartStandby { fade_sec } = r;
        if let Some(tp) = st.standby.clone().and_then(|id| st.track(&id).cloned()) {
            if let Ok(mut v) = headless_voice(st, &tp, tp.eff_in()) {
                v.fade_in(fade_sec);
                started(st, &tp.id, v);
            }
        }
    }
}

/// A full GO without an output device.
pub fn go_headless(st: &mut State) -> Result<GoPlan, String> {
    match plan_go(st) {
        GoPlan::Start(tp) => {
            let v = match st.prepared.iter().position(|p| p.track_id == tp.id) {
                Some(i) => st.prepared.swap_remove(i),
                None => headless_voice(st, &tp, tp.eff_in())?,
            };
            apply_go(st, &tp, v);
            Ok(GoPlan::Start(tp))
        }
        p => Ok(p),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str, path: &str) -> TrackParams {
        TrackParams {
            id: id.into(),
            hidden: false,
            path: Some(path.into()),
            entry: None,
            entry_sec: None,
            exit: None,
            exit_sec: None,
            loop_on: false,
            volume_db: 0.0,
            eq: Default::default(),
            pan: 0.0,
            in_sec: 0.0,
            out_sec: None,
            envelope: vec![],
            pan_envelope: vec![],
            loop_points: None,
            ignore_cut: false,
            ignore_envelope: false,
            ignore_loop: false,
            ignore_pan: false,
        }
    }
    fn state(tracks: Vec<TrackParams>) -> State {
        let mut st = State::new();
        st.tracks = tracks;
        st.rate = 48000;
        st.status = EngineStatus { ready: true, device: "test".into(), sample_rate: 48000, error: None };
        st
    }
    fn run(st: &mut State, secs: f64) {
        let mut out = vec![0f32; 480 * 2];
        for _ in 0..(secs * 100.0) as usize {
            render(st, &mut out, 2);
            serve_headless(st);
            std::thread::sleep(std::time::Duration::from_micros(500));
        }
    }
    fn ids(st: &State) -> Vec<String> {
        let mut v: Vec<String> = st.voices.iter().filter(|v| v.alive()).map(|v| v.track_id.clone()).collect();
        v.sort();
        v
    }
    fn go(st: &mut State) -> GoPlan {
        let plan = go_headless(st).unwrap();
        prepare_headless(st);
        plan
    }
    fn wav(name: &str, secs: f32) -> String {
        let dir = std::env::temp_dir().join(format!("diaframma-core-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join(name);
        if !wav.exists() {
            crate::audio::decode::tests::write_wav(&wav, 44100, secs);
        }
        wav.to_string_lossy().to_string()
    }

    #[test]
    fn next_and_crossfade_at_the_end_start_the_attention_track() {
        let p = wav("a.wav", 2.0);
        // Exit Next: B takes over exactly at the end and the attention moves on.
        let mut a = track("A", &p);
        a.out_sec = Some(1.0);
        a.exit = Some(Exit::Next);
        let b = track("B", &p);
        let c = track("C", &p);
        let mut st = state(vec![a.clone(), b.clone(), c.clone()]);
        st.standby = Some("A".into());
        prepare_headless(&mut st);
        st.prepared.push(headless_voice(&st, &b, 0.0).unwrap());
        go(&mut st);
        assert_eq!(st.standby.as_deref(), Some("B"));
        assert!(st.auto_start(), "A ends with Next: B starts by itself");
        run(&mut st, 1.3);
        assert_eq!(ids(&st), vec!["B".to_string()]);
        assert_eq!(st.main.as_deref(), Some("B"));
        assert_eq!(st.standby.as_deref(), Some("C"));
        assert!(!st.auto_start(), "B has no Exit");

        // Exit Crossfade: both play during the crossfade, then only B.
        let mut a = track("A", &p);
        a.out_sec = Some(1.0);
        a.exit = Some(Exit::Crossfade);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.config.crossfade_sec = 0.5;
        st.standby = Some("A".into());
        st.prepared.push(headless_voice(&st, &b, 0.0).unwrap());
        go(&mut st);
        run(&mut st, 0.75);
        assert_eq!(st.voices.len(), 2, "both during the crossfade");
        assert_eq!(ids(&st), vec!["B".to_string()]);
        run(&mut st, 0.6);
        assert_eq!(ids(&st), vec!["B".to_string()]);
    }

    #[test]
    fn exit_fade_out_and_no_exit_at_the_end_leave_the_attention_alone() {
        let p = wav("a2.wav", 2.0);
        let b = track("B", &p);
        // Fade out: fades before the end, nothing starts, the attention stays on B.
        let mut a = track("A", &p);
        a.out_sec = Some(1.0);
        a.exit = Some(Exit::FadeOut);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.config.fade_out_sec = 0.4;
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.7);
        assert!(st.voices[0].fade.falling(), "fading before the end");
        run(&mut st, 0.6);
        assert!(st.voices.is_empty());
        assert_eq!(st.standby.as_deref(), Some("B"));
        assert!(!st.auto_start());
        // No exit: just stops.
        let mut a = track("A", &p);
        a.out_sec = Some(0.4);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.7);
        assert!(st.voices.is_empty());
        assert_eq!(st.standby.as_deref(), Some("B"));
    }

    #[test]
    fn go_always_starts_the_attention_track() {
        let p = wav("b.wav", 3.0);
        let b = track("B", &p);
        // Next: GO cuts A and plays B.
        let mut a = track("A", &p);
        a.exit = Some(Exit::Next);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.2);
        assert!(matches!(go(&mut st), GoPlan::Start(_)));
        run(&mut st, 0.1);
        assert_eq!(ids(&st), vec!["B".to_string()]);
        assert_eq!(st.voices.len(), 1, "A was cut");

        // Crossfade: GO crossfades into B.
        let mut a = track("A", &p);
        a.exit = Some(Exit::Crossfade);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.config.crossfade_sec = 0.4;
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.2);
        go(&mut st);
        run(&mut st, 0.2);
        assert_eq!(ids(&st), vec!["B".to_string()]);
        assert_eq!(st.voices.len(), 2, "A still fading");
        run(&mut st, 0.4);
        assert_eq!(st.voices.len(), 1);

        // Fade out (its own length): B starts at once, A fades.
        let mut a = track("A", &p);
        a.exit = Some(Exit::FadeOut);
        a.exit_sec = Some(0.3);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.2);
        go(&mut st);
        run(&mut st, 0.1);
        assert_eq!(st.voices.len(), 2, "A still fading");
        assert_eq!(st.main.as_deref(), Some("B"));
        run(&mut st, 0.35);
        assert_eq!(ids(&st), vec!["B".to_string()]);
        assert_eq!(st.voices.len(), 1);

        // No Exit: the general setting (quick fade 0.2 s here).
        let a = track("A", &p);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.config.quick_fade_sec = 0.2;
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.2);
        go(&mut st);
        run(&mut st, 0.1);
        assert_eq!(st.voices.len(), 2);
        run(&mut st, 0.3);
        assert_eq!(ids(&st), vec!["B".to_string()]);
        // ... or the track keeps playing.
        let mut st = state(vec![a.clone(), b.clone()]);
        st.config.others_on_go = OthersOnGo::Keep;
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.2);
        go(&mut st);
        run(&mut st, 0.3);
        assert_eq!(ids(&st), vec!["A".to_string(), "B".to_string()]);
    }

    #[test]
    fn entry_fade_in_uses_the_general_or_its_own_length() {
        let p = wav("f.wav", 2.0);
        let mut a = track("A", &p);
        a.entry = Some(Entry::FadeIn);
        let mut st = state(vec![a.clone()]);
        st.config.fade_in_sec = 0.5;
        st.standby = Some("A".into());
        go(&mut st);
        assert!(st.voices[0].fade.rising());
        run(&mut st, 0.7);
        assert!(!st.voices[0].fade.rising());
        // Own length.
        let mut a = track("A", &p);
        a.entry = Some(Entry::FadeIn);
        a.entry_sec = Some(1.0);
        let mut st = state(vec![a.clone()]);
        st.config.fade_in_sec = 0.1;
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.5);
        assert!(st.voices[0].fade.rising(), "still fading in after 0.5 s");
        // Without Entry there is no fade.
        let a = track("A", &p);
        let mut st = state(vec![a]);
        st.standby = Some("A".into());
        go(&mut st);
        assert!(!st.voices[0].fade.rising());
    }

    #[test]
    fn loop_repeats_until_go_and_go_starts_the_next_track() {
        let p = wav("c.wav", 2.0);
        let b = track("B", &p);
        // Whole-track loop with an Exit that would otherwise act at the end: it never ends.
        let mut a = track("A", &p);
        a.loop_on = true;
        a.exit = Some(Exit::Next);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        assert!(!st.auto_start(), "a looping track never ends by itself");
        run(&mut st, 2.6);
        assert_eq!(ids(&st), vec!["A".to_string()], "still looping after the end");
        assert_eq!(st.standby.as_deref(), Some("B"));
        go(&mut st);
        run(&mut st, 0.2);
        assert_eq!(ids(&st), vec!["B".to_string()]);

        // Loop with points: plays to the end first, then repeats the points.
        let mut a = track("A", &p);
        a.loop_on = true;
        a.loop_points = Some(LoopPoints { in_sec: 0.5, out_sec: 1.0 });
        let mut st = state(vec![a.clone(), b.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 1.5);
        assert!(st.voices[0].pos > 1.4, "no loop before the end, pos {}", st.voices[0].pos);
        run(&mut st, 1.0);
        assert!(st.voices[0].in_loop());
        assert!(st.voices[0].pos >= 0.45 && st.voices[0].pos <= 1.05, "inside the loop, pos {}", st.voices[0].pos);

        // "Ignore": the points are bypassed, the whole track repeats.
        let mut a2 = a.clone();
        a2.ignore_loop = true;
        let fp = feed_params(&a2);
        assert_eq!(fp.looping, Some((0.0, f64::INFINITY)));
        assert!(!fp.loop_after_end);
        // Loop off: no loop at all.
        a2.loop_on = false;
        assert_eq!(feed_params(&a2).looping, None);
    }

    #[test]
    fn ignored_groups_are_bypassed_but_kept() {
        let p = wav("g.wav", 2.0);
        let mut a = track("A", &p);
        a.in_sec = 0.5;
        a.out_sec = Some(1.0);
        a.envelope = vec![EnvPoint { t: 0.0, v: 0.2 }];
        a.pan_envelope = vec![EnvPoint { t: 0.0, v: -1.0 }];
        assert_eq!((a.eff_in(), a.eff_out()), (0.5, Some(1.0)));
        assert_eq!(a.volume_curve().len(), 1);
        assert_eq!(a.pan_curve().len(), 1);
        a.ignore_cut = true;
        a.ignore_envelope = true;
        a.ignore_pan = true;
        assert_eq!((a.eff_in(), a.eff_out()), (0.0, None));
        assert!(a.volume_curve().is_empty() && a.pan_curve().is_empty());
        assert_eq!(a.in_sec, 0.5, "values are kept");
        assert_eq!(feed_params(&a).out_sec, None);
    }

    /// Mean absolute level of each channel over a rendered stretch.
    fn levels(st: &mut State, secs: f64) -> (f32, f32) {
        let mut out = vec![0f32; 480 * 2];
        let (mut l, mut r, mut n) = (0f32, 0f32, 0f32);
        for _ in 0..(secs * 100.0) as usize {
            render(st, &mut out, 2);
            for f in out.chunks(2) {
                l += f[0].abs();
                r += f[1].abs();
                n += 1.0;
            }
            std::thread::sleep(std::time::Duration::from_micros(500));
        }
        (l / n, r / n)
    }

    #[test]
    fn pan_fader_and_curve_move_the_sound() {
        let p = wav("pan.wav", 3.0);
        // Centre: both channels untouched compared to a track with no pan at all.
        let a = track("A", &p);
        let mut st = state(vec![a.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        let (cl, cr) = levels(&mut st, 0.5);
        assert!(cl > 0.01 && cr > 0.05);
        // Hard left: the right channel is silent, the left keeps its level.
        let mut a = track("A", &p);
        a.pan = -1.0;
        let mut st = state(vec![a.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.1);
        let (l, r) = levels(&mut st, 0.4);
        assert!(r < 0.001, "right silent, got {r}");
        assert!(l > 0.01);
        // A curve wins over the fader; "ignore" brings the fader back.
        let mut a = track("A", &p);
        a.pan = 1.0;
        a.pan_envelope = vec![EnvPoint { t: 0.0, v: -1.0 }];
        let mut st = state(vec![a.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.1);
        let (_, r) = levels(&mut st, 0.4);
        assert!(r < 0.001, "curve says left, got {r}");
        let mut a2 = a.clone();
        a2.ignore_pan = true;
        let mut st = state(vec![a2]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.3);
        let (l, r) = levels(&mut st, 0.4);
        assert!(l < 0.001 && r > 0.05, "fader says right: l {l} r {r}");
    }

    #[test]
    fn pause_all_and_resume_with_go_after_seek() {
        let p = wav("d.wav", 3.0);
        let a = track("A", &p);
        let b = track("B", &p);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.3);
        toggle_pause_all(&mut st);
        assert!(st.paused_all);
        run(&mut st, 0.2);
        let pos = st.voices[0].pos;
        run(&mut st, 0.2);
        assert!((st.voices[0].pos - pos).abs() < 1e-6, "paused");
        // Move the cursor while paused, then GO resumes from there.
        let v = headless_voice(&st, &a, 2.0).unwrap();
        assert!(apply_seek(&mut st, "A", v));
        run(&mut st, 0.05);
        assert_eq!(st.voices.len(), 1);
        assert_eq!(go(&mut st), GoPlan::Resumed);
        assert!(!st.paused_all);
        assert_eq!(st.standby.as_deref(), Some("B"), "GO that resumes does not start B");
        run(&mut st, 0.3);
        assert!(st.voices[0].pos > 2.0 && st.voices[0].pos < 2.6, "resumed from the cursor, pos {}", st.voices[0].pos);
    }

    /// Two runs of the same show in a row behave the same (no state left behind).
    #[test]
    fn same_show_twice_in_a_row() {
        let p = wav("e.wav", 1.2);
        let mut a = track("A", &p);
        a.entry = Some(Entry::FadeIn);
        a.exit = Some(Exit::Crossfade);
        let mut b = track("B", &p);
        b.exit = Some(Exit::FadeOut);
        let mut c = track("C", &p);
        c.exit = Some(Exit::Next);
        let d = track("D", &p);
        let mut st = state(vec![a.clone(), b.clone(), c.clone(), d.clone()]);
        st.config.fade_in_sec = 0.2;
        st.config.fade_out_sec = 0.3;
        st.config.crossfade_sec = 0.3;
        let mut logs: Vec<Vec<String>> = Vec::new();
        for _ in 0..3 {
            let mut log = Vec::new();
            st.standby = Some("A".into());
            go(&mut st); // A fades in, crossfades into B at the end
            run(&mut st, 1.2);
            log.push(format!("{:?}", ids(&st)));
            run(&mut st, 0.3);
            log.push(format!("{:?} sb={:?}", ids(&st), st.standby));
            go(&mut st); // C starts, B fades out
            run(&mut st, 0.5);
            log.push(format!("{:?} sb={:?}", ids(&st), st.standby));
            run(&mut st, 1.2); // C ends with Next into D
            log.push(format!("{:?}", ids(&st)));
            stop_all(&mut st, true);
            run(&mut st, 0.1);
            log.push(format!("{:?} paused_all={}", ids(&st), st.paused_all));
            assert!(st.voices.is_empty());
            logs.push(log);
        }
        assert_eq!(logs[0], logs[1]);
        assert_eq!(logs[1], logs[2]);
        assert_eq!(logs[0][0], "[\"B\"]");
        assert_eq!(logs[0][2], "[\"C\"] sb=Some(\"D\")");
        assert_eq!(logs[0][3], "[\"D\"]");
    }
}
