//! Engine core without any dependency on the window: voices, mixing,
//! GO semantics and "At end" behaviour. Kept apart so it can be tested alone.

use std::sync::atomic::Ordering;

use super::decode::{FeedParams, FeederHandles, Segment};
use super::dsp::{Eq3, Fade, db_to_gain, envelope_gain};
use super::model::*;

pub const QUICK_STOP_SEC: f64 = 0.015;
pub const PAUSE_RAMP_SEC: f64 = 0.03;

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
    pub eq: Eq3,
    pub gain: f32,
    pub at_end_fired: bool,
    pub ended: bool,
}

impl Voice {
    pub fn new(track_id: String, path: String, start_sec: f64, rate: u32, h: FeederHandles, duration: f64) -> Self {
        let seg = Segment { start_frame: 0, src_start: start_sec, speed: h.ctl.speed() };
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
            eq: Eq3::default(),
            gain: -1.0,
            at_end_fired: false,
            ended: false,
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
    pub fn set_paused(&mut self, p: bool) {
        if p == self.paused {
            return;
        }
        self.paused = p;
        let n = self.frames(PAUSE_RAMP_SEC);
        self.pause = Fade::to(self.pause.value(), if p { 0.0 } else { 1.0 }, n);
    }
    pub fn stopping(&self) -> bool {
        self.ended || (self.after_fade == AfterFade::Stop && self.fade.target() == 0.0)
    }
    pub fn fully_paused(&self) -> bool {
        self.paused && self.pause.done()
    }
}

#[derive(Clone, Debug)]
pub enum Request {
    /// Start the playable track after `after` (At end: Next / Crossfade).
    StartNext { after: String, fade_sec: f64 },
}

pub struct State {
    pub tracks: Vec<TrackParams>,
    pub config: Config,
    pub standby: Option<String>,
    pub voices: Vec<Voice>,
    pub prepared: Vec<Voice>,
    pub graveyard: Vec<Voice>,
    pub requests: Vec<Request>,
    pub rate: u32,
    pub status: EngineStatus,
    pub scratch: Vec<f32>,
    pub speed: f64,
}

impl State {
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
}

pub fn feed_params(tp: &TrackParams) -> FeedParams {
    let looping = match tp.at_end {
        AtEnd::LoopAll => Some((tp.in_sec.max(0.0), tp.out_sec.unwrap_or(f64::INFINITY))),
        AtEnd::LoopCut => tp.loop_points.map(|l| (l.in_sec.max(0.0), l.out_sec)).filter(|(a, b)| b > a),
        _ => None,
    };
    FeedParams { out_sec: tp.out_sec, looping }
}

/// Mixes all active voices into `out` (interleaved, `channels` per frame).
pub fn render(st: &mut State, out: &mut [f32], channels: usize) {
    out.iter_mut().for_each(|s| *s = 0.0);
    if channels == 0 || st.rate == 0 {
        return;
    }
    let frames = out.len() / channels;
    let rate = st.rate as f64;
    let mut events: [Option<(String, AtEnd, f64)>; 4] = Default::default();
    let mut n_events = 0usize;
    let State { tracks, voices, config, .. } = st;
    for v in voices.iter_mut() {
        if v.ended {
            continue;
        }
        let tp = tracks.iter().find(|t| t.id == v.track_id);
        let (target_gain, ignore, env): (f32, bool, &[EnvPoint]) = match tp {
            Some(tp) if !tp.ignore_volume => (db_to_gain(tp.volume_db as f32), false, &tp.envelope),
            _ => (1.0, true, &[]),
        };
        if let Some(tp) = tp {
            v.eq.configure(tp.eq.low as f32, tp.eq.mid as f32, tp.eq.high as f32, rate as f32);
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
        // End of the file reached?
        if n < frames && v.h.ctl.finished.load(Ordering::Acquire) && v.consumed >= v.h.ctl.pushed.load(Ordering::Acquire) {
            v.ended = true;
            if let Some(tp) = tp {
                if tp.at_end == AtEnd::Next && !v.at_end_fired && n_events < events.len() {
                    v.at_end_fired = true;
                    events[n_events] = Some((v.track_id.clone(), AtEnd::Next, 0.0));
                    n_events += 1;
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
                if lead >= 0.0 && out_eff > 0.0 && v.pos >= out_eff - lead && n_events < events.len() {
                    v.at_end_fired = true;
                    let remaining = (out_eff - v.pos).max(0.05);
                    v.fade_to(0.0, remaining, AfterFade::Stop);
                    if tp.at_end == AtEnd::Crossfade {
                        events[n_events] = Some((v.track_id.clone(), AtEnd::Crossfade, remaining));
                        n_events += 1;
                    }
                }
            }
        }
    }
    // Soft clip to stay safe on loud mixes.
    for s in out.iter_mut() {
        if *s > 1.0 || *s < -1.0 {
            *s = s.clamp(-1.0, 1.0);
        }
    }
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
    for ev in events.iter_mut().take(n_events) {
        if let Some((after, kind, fade_sec)) = ev.take() {
            start_next_in_callback(st, &after, kind, fade_sec);
        }
    }
}

pub fn start_next_in_callback(st: &mut State, after: &str, kind: AtEnd, fade_sec: f64) {
    let Some(next_id) = st.next_playable(after) else { return };
    if let Some(i) = st.prepared.iter().position(|p| p.track_id == next_id) {
        let mut v = st.prepared.swap_remove(i);
        if kind == AtEnd::Crossfade {
            let n = v.frames(fade_sec);
            v.fade = Fade::to(0.0, 1.0, n.max(1));
        }
        st.voices.push(v);
        if st.standby.as_deref() == Some(next_id.as_str()) {
            st.advance_standby_after(&next_id);
        }
    } else {
        st.requests.push(Request::StartNext { after: after.to_string(), fade_sec: if kind == AtEnd::Crossfade { fade_sec } else { 0.0 } });
    }
}


pub fn apply_go(st: &mut State, tp: &TrackParams, mut v: Voice) {
    let cfg = st.config;
    for o in st.voices.iter_mut() {
        if o.track_id == tp.id {
            o.fade_to(0.0, QUICK_STOP_SEC, AfterFade::Stop);
            continue;
        }
        if o.stopping() {
            continue;
        }
        match tp.on_space {
            OnSpace::Play | OnSpace::FadeIn => match cfg.others_on_go {
                OthersOnGo::Pause => o.set_paused(true),
                OthersOnGo::FadeOut => o.fade_to(0.0, cfg.fade_out_sec, AfterFade::Stop),
                OthersOnGo::Keep => {}
                OthersOnGo::Stop => o.fade_to(0.0, QUICK_STOP_SEC, AfterFade::Stop),
            },
            OnSpace::Crossfade => o.fade_to(0.0, cfg.crossfade_sec, AfterFade::Stop),
            OnSpace::StopAllPlay => o.fade_to(0.0, QUICK_STOP_SEC, AfterFade::Stop),
        }
    }
    let fade_sec = match tp.on_space {
        OnSpace::FadeIn => cfg.fade_in_sec,
        OnSpace::Crossfade => cfg.crossfade_sec,
        _ => 0.0,
    };
    if fade_sec > 0.0 {
        let n = v.frames(fade_sec);
        v.fade = Fade::to(0.0, 1.0, n.max(1));
    }
    st.voices.push(v);
    // Keep at most a few paused tracks (each one holds a decoder): the oldest are released.
    const MAX_PAUSED: usize = 8;
    let paused: Vec<usize> = st.voices.iter().enumerate().filter(|(_, x)| x.paused && !x.ended).map(|(i, _)| i).collect();
    if paused.len() > MAX_PAUSED {
        for &i in &paused[..paused.len() - MAX_PAUSED] {
            st.voices[i].ended = true;
        }
    }
    st.advance_standby_after(&tp.id);
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::decode::spawn_feeder;

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
    fn voice(t: &TrackParams) -> Voice {
        let h = spawn_feeder(t.path.clone().unwrap(), t.in_sec, 48000, feed_params(t), 1.0).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let d = h.ctl.duration();
        Voice::new(t.id.clone(), t.path.clone().unwrap(), t.in_sec, 48000, h, d)
    }
    fn state(tracks: Vec<TrackParams>) -> State {
        State {
            tracks,
            config: Config::default(),
            standby: None,
            voices: Vec::with_capacity(16),
            prepared: Vec::with_capacity(8),
            graveyard: Vec::new(),
            requests: Vec::new(),
            rate: 48000,
            status: EngineStatus { ready: true, device: "test".into(), sample_rate: 48000, error: None },
            scratch: Vec::new(),
            speed: 1.0,
        }
    }
    fn run(st: &mut State, secs: f64) {
        let mut out = vec![0f32; 480 * 2];
        for _ in 0..(secs * 100.0) as usize {
            render(st, &mut out, 2);
            std::thread::sleep(std::time::Duration::from_micros(500));
        }
    }
    fn ids(st: &State) -> Vec<String> {
        st.voices.iter().map(|v| v.track_id.clone()).collect()
    }

    #[test]
    fn next_crossfade_and_pause() {
        let dir = std::env::temp_dir().join(format!("diaframma-core-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("ramp.wav");
        crate::audio::decode::tests::write_wav(&wav, 44100, 2.0);
        let p = wav.to_string_lossy().to_string();

        // At end: Next — B takes over without a gap and standby moves on.
        let mut a = track("A", &p);
        a.out_sec = Some(1.0);
        a.at_end = AtEnd::Next;
        let b = track("B", &p);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.prepared.push(voice(&b));
        st.standby = Some("A".into());
        apply_go(&mut st, &a, voice(&a));
        assert_eq!(st.standby.as_deref(), Some("B"));
        run(&mut st, 1.3);
        assert_eq!(ids(&st), vec!["B".to_string()]);

        // At end: Crossfade — both play during the crossfade, then only B.
        let mut a = track("A", &p);
        a.out_sec = Some(1.0);
        a.at_end = AtEnd::Crossfade;
        let b = track("B", &p);
        let mut st = state(vec![a.clone(), b.clone()]);
        st.config.crossfade_sec = 0.5;
        st.prepared.push(voice(&b));
        apply_go(&mut st, &a, voice(&a));
        run(&mut st, 0.75);
        assert_eq!(ids(&st).len(), 2);
        run(&mut st, 0.6);
        assert_eq!(ids(&st), vec!["B".to_string()]);

        // GO with Play pauses the other tracks (default setting).
        let a = track("A", &p);
        let b = track("B", &p);
        let mut st = state(vec![a.clone(), b.clone()]);
        apply_go(&mut st, &a, voice(&a));
        run(&mut st, 0.2);
        apply_go(&mut st, &b, voice(&b));
        assert_eq!(st.voices.iter().find(|v| v.track_id == "A").map(|v| v.paused), Some(true));

        let _ = std::fs::remove_dir_all(dir);
    }
}
