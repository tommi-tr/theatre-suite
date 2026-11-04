//! Engine core without any dependency on the window: voices, mixing,
//! GO semantics and "At end or Space" behaviour. Kept apart so it can be tested alone.
//!
//! GO, in order:
//! 1. Pause all is active → everything that was paused by it resumes.
//! 2. The main track (the one playing in front) has Stop / Fade out / Loop
//!    and that step has not happened yet → GO does that step only.
//! 3. Otherwise GO starts the standby track. The main track follows its own
//!    "At end or Space": Next = cut, Crossfade = crossfade into the new one;
//!    any other playing track follows the "Other tracks" setting.

use std::sync::atomic::Ordering;

use super::decode::{FeedParams, FeederHandles, Segment};
use super::dsp::{Eq5, Fade, db_to_gain, envelope_gain};
use super::model::*;

pub const QUICK_STOP_SEC: f64 = 0.015;
pub const PAUSE_RAMP_SEC: f64 = 0.03;
/// Short crossfade used when GO jumps into a loop (no click).
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
    /// The Stop / Fade out / Loop step of the main track has been done.
    pub step_done: bool,
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
            step_done: false,
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
    /// What the next GO does to the main track before anything else, if anything.
    pub fn pending_step(&self) -> Option<AtEnd> {
        if !self.config.steps || self.step_done {
            return None;
        }
        let i = self.main_index()?;
        let v = &self.voices[i];
        let at_end = self.track(&v.track_id)?.at_end;
        if !at_end.is_step() {
            return None;
        }
        // A loop that is already repeating has nothing left to do.
        if at_end.is_loop() && v.in_loop() {
            return None;
        }
        Some(at_end)
    }
}

impl Default for State {
    fn default() -> Self {
        Self::new()
    }
}

pub fn feed_params(tp: &TrackParams) -> FeedParams {
    let looping = match tp.at_end {
        AtEnd::LoopAll => Some((tp.in_sec.max(0.0), tp.out_sec.unwrap_or(f64::INFINITY))),
        AtEnd::LoopCut => tp.loop_points.map(|l| (l.in_sec.max(0.0), l.out_sec)).filter(|(a, b)| b > a),
        _ => None,
    };
    FeedParams { out_sec: tp.out_sec, looping, loop_after_end: tp.at_end == AtEnd::LoopCut }
}

/// Where GO jumps when it starts the loop of a track now.
pub fn loop_start(tp: &TrackParams) -> f64 {
    match tp.at_end {
        AtEnd::LoopCut => tp.loop_points.map(|l| l.in_sec).unwrap_or(tp.in_sec),
        _ => tp.in_sec,
    }
    .max(0.0)
}

/// Mixes all active voices into `out` (interleaved, `channels` per frame).
pub fn render(st: &mut State, out: &mut [f32], channels: usize) {
    out.iter_mut().for_each(|s| *s = 0.0);
    if channels == 0 || st.rate == 0 {
        return;
    }
    let frames = out.len() / channels;
    let rate = st.rate as f64;
    // (fade_sec) of a standby start requested by the main track.
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
            Some(tp) if !tp.ignore_volume => (db_to_gain(tp.volume_db as f32), false, &tp.envelope),
            _ => (1.0, true, &[]),
        };
        if let Some(tp) = tp {
            v.eq.configure(&tp.eq, rate as f32);
        }
        if v.gain < 0.0 {
            v.gain = target_gain;
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
                let (l, r) = v.eq.process(l, r);
                let o = (done + j) * channels;
                if channels == 1 {
                    out[o] += 0.5 * (l + r) * g;
                } else {
                    out[o] += l * g;
                    out[o + 1] += r * g;
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
                if is_main && tp.at_end == AtEnd::Next && !v.at_end_fired {
                    v.at_end_fired = true;
                    start_standby = Some(0.0);
                }
            }
        }
        // Fade out / crossfade before the end.
        if let Some(tp) = tp {
            if !v.at_end_fired && !v.stopping() {
                let out_eff = match tp.out_sec {
                    Some(o) if v.duration > 0.0 => o.min(v.duration),
                    Some(o) => o,
                    None => v.duration,
                };
                let lead = match tp.at_end {
                    AtEnd::FadeOut => config.fade_out_sec,
                    AtEnd::Crossfade => config.crossfade_sec,
                    _ => -1.0,
                };
                if lead >= 0.0 && out_eff > 0.0 && v.pos >= out_eff - lead {
                    v.at_end_fired = true;
                    let remaining = (out_eff - v.pos).max(0.05);
                    v.fade_to(0.0, remaining, AfterFade::Stop);
                    if tp.at_end == AtEnd::Crossfade && is_main {
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
    // A Stop / Fade out of the main track that happened on its own counts as done.
    if st.config.steps && !st.step_done && st.main.is_some() && st.main_index().is_none() {
        st.step_done = true;
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
    st.step_done = false;
    st.paused_all = false;
    st.advance_standby_after(id);
}

/// What a GO is going to do (decided under the lock, carried out by the engine).
#[derive(Debug, PartialEq)]
pub enum GoPlan {
    Nothing,
    /// Pause all was active: resumed.
    Resumed,
    /// Stop / Fade out done on the main track.
    StepDone,
    /// Jump into the loop of the main track: needs a new voice at this position.
    Loop { track: TrackParams, at: f64 },
    /// Start this track.
    Start(TrackParams),
}

/// First part of GO: everything that does not need a new voice is done here.
pub fn plan_go(st: &mut State) -> GoPlan {
    if st.paused_all {
        resume_all(st);
        return GoPlan::Resumed;
    }
    if let Some(step) = st.pending_step() {
        let i = st.main_index().unwrap();
        let cfg = st.config;
        match step {
            AtEnd::Stop => st.voices[i].fade_to(0.0, QUICK_STOP_SEC * 3.0, AfterFade::Stop),
            AtEnd::FadeOut => st.voices[i].fade_to(0.0, cfg.fade_out_sec.max(QUICK_STOP_SEC), AfterFade::Stop),
            _ => {
                let id = st.voices[i].track_id.clone();
                if let Some(tp) = st.track(&id).cloned() {
                    let at = loop_start(&tp);
                    return GoPlan::Loop { track: tp, at };
                }
            }
        }
        st.step_done = true;
        return GoPlan::StepDone;
    }
    let Some(sb) = st.standby.clone() else { return GoPlan::Nothing };
    let Some(tp) = st.track(&sb).cloned() else { return GoPlan::Nothing };
    if !tp.playable() {
        st.advance_standby_after(&sb);
        return GoPlan::Nothing;
    }
    GoPlan::Start(tp)
}

/// Second part of GO for a loop jump: `v` starts inside the loop.
pub fn apply_loop(st: &mut State, tp: &TrackParams, mut v: Voice) {
    let Some(i) = st.main_index() else { return };
    let paused = st.voices[i].paused;
    st.voices[i].fade_to(0.0, JUMP_SEC, AfterFade::Stop);
    v.fade_in(JUMP_SEC);
    if paused {
        v.paused = true;
        v.pause = Fade::steady(0.0);
    }
    st.voices.push(v);
    st.main = Some(tp.id.clone());
    st.step_done = true;
}

/// Second part of GO: start `tp` with voice `v`.
pub fn apply_go(st: &mut State, tp: &TrackParams, mut v: Voice) {
    let cfg = st.config;
    let main_idx = if cfg.steps { st.main_index() } else { None };
    let main_at_end = main_idx.and_then(|i| st.track(&st.voices[i].track_id).map(|t| t.at_end));
    let mut crossfade_in = false;
    for (i, o) in st.voices.iter_mut().enumerate() {
        if o.track_id == tp.id {
            o.fade_to(0.0, QUICK_STOP_SEC, AfterFade::Stop);
            continue;
        }
        if o.stopping() {
            continue;
        }
        if tp.on_space == OnSpace::StopAllPlay {
            o.fade_to(0.0, QUICK_STOP_SEC, AfterFade::Stop);
            continue;
        }
        if Some(i) == main_idx {
            match main_at_end {
                Some(AtEnd::Next) => {
                    o.fade_to(0.0, QUICK_STOP_SEC, AfterFade::Stop);
                    continue;
                }
                Some(AtEnd::Crossfade) => {
                    o.fade_to(0.0, cfg.crossfade_sec, AfterFade::Stop);
                    crossfade_in = true;
                    continue;
                }
                _ => {}
            }
        }
        match cfg.others_on_go {
            OthersOnGo::Pause => o.set_paused(true),
            OthersOnGo::FadeOut => o.fade_to(0.0, cfg.fade_out_sec, AfterFade::Stop),
            OthersOnGo::Keep => {}
            OthersOnGo::Stop => o.fade_to(0.0, QUICK_STOP_SEC, AfterFade::Stop),
        }
    }
    if crossfade_in {
        v.fade_in(cfg.crossfade_sec);
    } else if tp.on_space == OnSpace::FadeIn {
        v.fade_in(cfg.fade_in_sec);
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
    st.step_done = true;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::decode::{spawn_feeder, spawn_feeder_ex};

    fn track(id: &str, path: &str) -> TrackParams {
        TrackParams {
            id: id.into(),
            hidden: false,
            path: Some(path.into()),
            on_space: OnSpace::Play,
            at_end: AtEnd::Stop,
            ignore_volume: false,
            volume_db: 0.0,
            eq: Default::default(),
            in_sec: 0.0,
            out_sec: None,
            envelope: vec![],
            loop_points: None,
        }
    }
    fn voice_at(t: &TrackParams, at: f64, in_loop: bool) -> Voice {
        let h = spawn_feeder_ex(t.path.clone().unwrap(), at, 48000, feed_params(t), 1.0, in_loop).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(80));
        let d = h.ctl.duration();
        Voice::new(t.id.clone(), t.path.clone().unwrap(), at, 48000, h, d)
    }
    fn voice(t: &TrackParams) -> Voice {
        voice_at(t, t.in_sec, false)
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
            std::thread::sleep(std::time::Duration::from_micros(500));
        }
    }
    fn ids(st: &State) -> Vec<String> {
        let mut v: Vec<String> = st.voices.iter().filter(|v| v.alive()).map(|v| v.track_id.clone()).collect();
        v.sort();
        v
    }
    /// Does the full GO like the engine does, preparing voices on the spot.
    fn go(st: &mut State) -> GoPlan {
        match plan_go(st) {
            GoPlan::Start(tp) => {
                let v = voice(&tp);
                apply_go(st, &tp, v);
                GoPlan::Start(tp)
            }
            GoPlan::Loop { track, at } => {
                let v = voice_at(&track, at, true);
                apply_loop(st, &track, v);
                GoPlan::Loop { track, at }
            }
            p => p,
        }
    }
    /// Serves requests of the callback (StartStandby) like the control thread.
    fn serve(st: &mut State) {
        let reqs: Vec<Request> = st.requests.drain(..).collect();
        for r in reqs {
            let Request::StartStandby { fade_sec } = r;
            if let Some(tp) = st.standby.clone().and_then(|id| st.track(&id).cloned()) {
                let mut v = voice(&tp);
                v.fade_in(fade_sec);
                started(st, &tp.id, v);
            }
        }
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
    fn next_and_crossfade_at_end_start_standby() {
        let p = wav("a.wav", 2.0);
        // At end: Next — B takes over without a gap and standby moves on.
        let mut a = track("A", &p);
        a.out_sec = Some(1.0);
        a.at_end = AtEnd::Next;
        let b = track("B", &p);
        let c = track("C", &p);
        let mut st = state(vec![a.clone(), b.clone(), c.clone()]);
        st.standby = Some("A".into());
        st.prepared.push(voice(&b));
        go(&mut st);
        assert_eq!(st.standby.as_deref(), Some("B"));
        run(&mut st, 1.3);
        assert_eq!(ids(&st), vec!["B".to_string()]);
        assert_eq!(st.main.as_deref(), Some("B"));
        assert_eq!(st.standby.as_deref(), Some("C"));

        // At end: Crossfade — both play during the crossfade, then only B.
        let mut a = track("A", &p);
        a.out_sec = Some(1.0);
        a.at_end = AtEnd::Crossfade;
        let mut st = state(vec![a.clone(), b.clone()]);
        st.config.crossfade_sec = 0.5;
        st.standby = Some("A".into());
        st.prepared.push(voice(&b));
        go(&mut st);
        run(&mut st, 0.75);
        assert_eq!(st.voices.len(), 2, "both during the crossfade");
        assert_eq!(ids(&st), vec!["B".to_string()]);
        run(&mut st, 0.6);
        assert_eq!(ids(&st), vec!["B".to_string()]);
    }

    #[test]
    fn go_while_playing_follows_at_end_or_space() {
        let p = wav("b.wav", 3.0);
        // Next: GO cuts A and plays B.
        let mut a = track("A", &p);
        a.at_end = AtEnd::Next;
        let b = track("B", &p);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.2);
        assert_eq!(st.pending_step(), None);
        assert!(matches!(go(&mut st), GoPlan::Start(_)));
        run(&mut st, 0.1);
        assert_eq!(ids(&st), vec!["B".to_string()]);

        // Crossfade: GO crossfades into B.
        let mut a = track("A", &p);
        a.at_end = AtEnd::Crossfade;
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

        // Stop: first GO stops A only, B stays in standby; second GO plays B.
        let mut a = track("A", &p);
        a.at_end = AtEnd::Stop;
        let mut st = state(vec![a.clone(), b.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.2);
        assert_eq!(st.pending_step(), Some(AtEnd::Stop));
        assert_eq!(go(&mut st), GoPlan::StepDone);
        run(&mut st, 0.1);
        assert!(ids(&st).is_empty());
        assert_eq!(st.standby.as_deref(), Some("B"));
        assert_eq!(st.pending_step(), None);
        assert!(matches!(go(&mut st), GoPlan::Start(_)));
        assert_eq!(ids(&st), vec!["B".to_string()]);

        // Fade out: same, with a fade.
        let mut a = track("A", &p);
        a.at_end = AtEnd::FadeOut;
        let mut st = state(vec![a.clone(), b.clone()]);
        st.config.fade_out_sec = 0.3;
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.2);
        assert_eq!(go(&mut st), GoPlan::StepDone);
        run(&mut st, 0.1);
        assert_eq!(st.voices.len(), 1, "still fading");
        run(&mut st, 0.35);
        assert!(st.voices.is_empty());
        assert_eq!(st.standby.as_deref(), Some("B"));

        // Stop happening on its own (end of the file) also counts as done.
        let mut a = track("A", &p);
        a.out_sec = Some(0.3);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.5);
        assert!(st.voices.is_empty());
        assert!(matches!(go(&mut st), GoPlan::Start(_)));
    }

    #[test]
    fn loop_cut_after_end_and_go_into_loop() {
        let p = wav("c.wav", 2.0);
        // Loop cut: plays to the end first, then repeats the loop.
        let mut a = track("A", &p);
        a.at_end = AtEnd::LoopCut;
        a.loop_points = Some(LoopPoints { in_sec: 0.5, out_sec: 1.0 });
        let b = track("B", &p);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 1.5);
        assert!(st.voices[0].pos > 1.4, "no loop before the end, pos {}", st.voices[0].pos);
        assert_eq!(st.pending_step(), Some(AtEnd::LoopCut));
        run(&mut st, 1.0);
        assert!(st.voices[0].in_loop());
        assert!(st.voices[0].pos >= 0.45 && st.voices[0].pos <= 1.05, "inside the loop, pos {}", st.voices[0].pos);
        // Repeating already: GO goes straight to B (others: fade out).
        assert_eq!(st.pending_step(), None);
        st.config.fade_out_sec = 0.2;
        assert!(matches!(go(&mut st), GoPlan::Start(_)));
        run(&mut st, 0.3);
        assert_eq!(ids(&st), vec!["B".to_string()]);

        // GO before the end jumps into the loop now.
        let mut st = state(vec![a.clone(), b.clone()]);
        st.standby = Some("A".into());
        go(&mut st);
        run(&mut st, 0.2);
        assert!(matches!(go(&mut st), GoPlan::Loop { .. }));
        run(&mut st, 0.3);
        let v = st.voices.iter().find(|v| v.alive()).unwrap();
        assert!(v.in_loop() && v.pos >= 0.45 && v.pos <= 1.05);
        assert_eq!(st.standby.as_deref(), Some("B"));
        assert!(matches!(go(&mut st), GoPlan::Start(_)));
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
        let v = voice_at(&a, 2.0, false);
        assert!(apply_seek(&mut st, "A", v));
        run(&mut st, 0.05);
        assert_eq!(st.voices.len(), 1);
        assert_eq!(go(&mut st), GoPlan::Resumed);
        assert!(!st.paused_all);
        run(&mut st, 0.3);
        assert!(st.voices[0].pos > 2.0 && st.voices[0].pos < 2.6, "resumed from the cursor, pos {}", st.voices[0].pos);
    }

    /// Two runs of the same show in a row behave the same (no state left behind).
    #[test]
    fn same_show_twice_in_a_row() {
        let p = wav("e.wav", 1.2);
        let mut a = track("A", &p);
        a.on_space = OnSpace::FadeIn;
        a.at_end = AtEnd::Crossfade;
        let mut b = track("B", &p);
        b.at_end = AtEnd::FadeOut;
        let mut c = track("C", &p);
        c.at_end = AtEnd::Next;
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
            serve(&mut st);
            log.push(format!("{:?}", ids(&st)));
            run(&mut st, 0.3);
            log.push(format!("{:?} {:?}", ids(&st), st.pending_step()));
            log.push(format!("{:?}", go(&mut st))); // fade out B
            run(&mut st, 0.5);
            log.push(format!("{:?} sb={:?}", ids(&st), st.standby));
            go(&mut st); // C, Next into D at the end
            run(&mut st, 1.4);
            serve(&mut st);
            log.push(format!("{:?}", ids(&st)));
            stop_all(&mut st, true);
            run(&mut st, 0.1);
            log.push(format!("{:?} paused_all={}", ids(&st), st.paused_all));
            assert!(st.voices.is_empty());
            logs.push(log.into_iter().map(|l| l.replace("TrackParams", "")).collect());
        }
        // The GoPlan text contains the track; compare only the shape.
        let norm = |l: &Vec<String>| l.iter().map(|x| x.split('{').next().unwrap_or("").to_string()).collect::<Vec<_>>();
        assert_eq!(norm(&logs[0]), norm(&logs[1]));
        assert_eq!(norm(&logs[1]), norm(&logs[2]));
        assert_eq!(logs[0][0], "[\"B\"]");
        assert_eq!(logs[0][3], "[] sb=Some(\"C\")");
        assert_eq!(logs[0][4], "[\"D\"]");
        let _ = spawn_feeder;
    }
}
