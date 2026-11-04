//! Native audio engine for Show mode (also used by the internal player and the launchpad).
//!
//! Threads:
//! - audio callback (cpal/WASAPI): mixes the active voices; never opens files;
//! - one feeder thread per voice: decodes ahead into a ring buffer (decode.rs);
//! - device thread: owns the output stream, reopens it if the device changes or is lost
//!   (what is playing carries on from where it was);
//! - control thread: prepares the standby track, serves start requests,
//!   tells the interface what is playing (~20 times per second).
//!
//! The interface sends the cue list (`sync`) and commands (GO, standby,
//! pause, stop). The engine is the single source of truth for what plays.

pub mod core;
pub mod decode;
pub mod dsp;
pub mod model;

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};

use self::core::*;
use decode::{FeedParams, spawn_feeder_ex};
use dsp::Fade;
use model::*;

enum HostCmd {
    SetDevice(Option<String>),
}

struct Inner {
    /// When a prepared voice was last created, per track (avoids re-opening
    /// the file dozens of times per second while the IN point is dragged).
    last_prepare: Mutex<HashMap<String, Instant>>,
    state: Mutex<State>,
    host_tx: Mutex<Option<mpsc::Sender<HostCmd>>>,
    infos: Mutex<HashMap<String, TrackInfo>>,
}

#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

/// What a voice was doing, to rebuild it on a new output.
struct VoiceSnap {
    track_id: String,
    path: String,
    pos: f64,
    paused: bool,
    paused_by_all: bool,
    fade_value: f32,
    fade_target: f32,
    fade_left_sec: f64,
    after_fade: AfterFade,
    in_loop: bool,
    at_end_fired: bool,
}

fn make_voice(inner: &Inner, id: &str, path: &str, start: f64, rate: u32, params: FeedParams, in_loop: bool) -> Result<Voice, String> {
    let speed = inner.state.lock().speed;
    let h = spawn_feeder_ex(path.to_string(), start, rate, params, speed, in_loop)?;
    let mut duration = h.ctl.duration();
    if let Some(info) = inner.infos.lock().get(path) {
        duration = info.duration_sec;
    }
    Ok(Voice::new(id.to_string(), path.to_string(), start, rate, h, duration))
}

/// Waits a moment for the decoder to fill the buffer, so the start is clean.
fn warm_up(v: &Voice) {
    let t0 = Instant::now();
    while v.h.audio.slots() < 2048 && !v.h.ctl.finished.load(Ordering::Relaxed) && t0.elapsed() < Duration::from_millis(150) {
        thread::sleep(Duration::from_millis(2));
    }
}

impl Engine {
    /// Starts an engine. With `lazy`, the audio output is opened only at the
    /// first `set_device` (used by the internal player and the launchpad, so that
    /// an idle Diaframma keeps a single output open).
    pub fn start(app: AppHandle, event: &'static str, lazy: bool, config: Config) -> Self {
        let mut st = State::new();
        st.config = config;
        let inner = Arc::new(Inner {
            last_prepare: Mutex::new(HashMap::new()),
            state: Mutex::new(st),
            host_tx: Mutex::new(None),
            infos: Mutex::new(HashMap::new()),
        });
        let engine = Engine { inner };
        engine.spawn_device_thread(!lazy);
        engine.spawn_control_thread(app, event);
        engine
    }

    // ---------------- Device thread ----------------

    fn spawn_device_thread(&self, open_now: bool) {
        let (tx, rx) = mpsc::channel::<HostCmd>();
        *self.inner.host_tx.lock() = Some(tx);
        let inner = self.inner.clone();
        thread::Builder::new()
            .name("diaframma-device".into())
            .spawn(move || {
                let mut stream: Option<cpal::Stream> = None;
                let mut wanted: Option<String> = None;
                let mut last_try = Instant::now() - Duration::from_secs(10);
                let mut need_open = open_now;
                let mut active = open_now;
                loop {
                    if need_open && last_try.elapsed() > Duration::from_secs(2) {
                        last_try = Instant::now();
                        drop(stream.take());
                        match open_stream(&inner, wanted.as_deref()) {
                            Ok(s) => {
                                stream = Some(s);
                                need_open = false;
                            }
                            Err(e) => {
                                let mut st = inner.state.lock();
                                st.status = EngineStatus { ready: false, device: wanted.clone().unwrap_or_default(), sample_rate: 0, error: Some(e) };
                            }
                        }
                    }
                    match rx.recv_timeout(Duration::from_millis(250)) {
                        Ok(HostCmd::SetDevice(name)) => {
                            active = true;
                            if name != wanted || stream.is_none() {
                                wanted = name;
                                need_open = true;
                                last_try = Instant::now() - Duration::from_secs(10);
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if active && inner.state.lock().status.error.is_some() {
                                need_open = true;
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
            })
            .expect("device thread");
    }

    // ---------------- Control thread ----------------

    fn spawn_control_thread(&self, app: AppHandle, event: &'static str) {
        let engine = self.clone();
        thread::Builder::new()
            .name("diaframma-control".into())
            .spawn(move || {
                let mut last_emit = Instant::now();
                let mut last_state: Option<LiveState> = None;
                loop {
                    thread::sleep(Duration::from_millis(10));
                    engine.housekeeping();
                    if last_emit.elapsed() >= Duration::from_millis(50) {
                        last_emit = Instant::now();
                        let live = engine.live_state();
                        let playing = live.voices.iter().any(|v| !v.paused);
                        if playing || last_state.as_ref() != Some(&live) {
                            let _ = app.emit(event, &live);
                            last_state = Some(live);
                        }
                    }
                }
            })
            .expect("control thread");
    }

    /// Drops finished voices, serves start requests, keeps the standby track prepared.
    fn housekeeping(&self) {
        let (dead, requests, wanted, rate) = {
            let mut st = self.inner.state.lock();
            let dead: Vec<Voice> = st.graveyard.drain(..).collect();
            let requests: Vec<Request> = st.requests.drain(..).collect();
            // Update loop/out of playing voices if the cue list changed.
            let updates: Vec<(usize, FeedParams)> = st
                .voices
                .iter()
                .enumerate()
                .filter_map(|(i, v)| st.track(&v.track_id).map(|tp| (i, feed_params(tp))))
                .collect();
            for (i, p) in updates {
                let mut cur = st.voices[i].h.ctl.params.lock();
                if *cur != p {
                    *cur = p;
                }
            }
            // Pause all ends by itself when nothing is left paused by it.
            if st.paused_all && !st.voices.iter().any(|v| v.paused_by_all && v.paused && !v.ended) {
                st.paused_all = false;
            }
            // The standby track is ready to start instantly.
            let mut wanted: Vec<String> = Vec::new();
            if let Some(sb) = st.standby.clone() {
                if st.track(&sb).map(|t| t.playable()).unwrap_or(false) {
                    wanted.push(sb);
                }
            }
            // Drop prepared voices that are no longer wanted or are out of date.
            let rate = st.rate;
            let mut keep = Vec::with_capacity(st.prepared.len());
            let mut dropped = Vec::new();
            let prepared: Vec<Voice> = st.prepared.drain(..).collect();
            for p in prepared {
                let ok = wanted.contains(&p.track_id)
                    && p.rate == rate
                    && st.track(&p.track_id).map(|t| t.path.as_deref() == Some(p.path.as_str()) && (t.in_sec - p.start_sec).abs() < 1e-6).unwrap_or(false)
                    && !p.h.ctl.failed.load(Ordering::Relaxed);
                if ok {
                    keep.push(p);
                } else {
                    dropped.push(p);
                }
            }
            st.prepared = keep;
            let missing: Vec<(String, String, f64, FeedParams)> = wanted
                .iter()
                .filter(|id| !st.prepared.iter().any(|p| &p.track_id == *id))
                .filter_map(|id| st.track(id).and_then(|t| t.path.clone().map(|p| (id.clone(), p, t.in_sec, feed_params(t)))))
                .collect();
            let mut dead = dead;
            dead.extend(dropped);
            (dead, requests, missing, rate)
        };
        for v in dead {
            v.h.ctl.stop.store(true, Ordering::Relaxed);
            drop(v);
        }
        if rate == 0 {
            return;
        }
        for (id, path, start, params) in wanted {
            {
                let mut lp = self.inner.last_prepare.lock();
                if lp.get(&id).map(|t| t.elapsed() < Duration::from_millis(250)).unwrap_or(false) {
                    continue;
                }
                lp.insert(id.clone(), Instant::now());
                if lp.len() > 256 {
                    lp.retain(|_, t| t.elapsed() < Duration::from_secs(5));
                }
            }
            if let Ok(v) = make_voice(&self.inner, &id, &path, start, rate, params, false) {
                let mut st = self.inner.state.lock();
                if st.rate == rate && !st.prepared.iter().any(|p| p.track_id == id) {
                    st.prepared.push(v);
                } else {
                    v.h.ctl.stop.store(true, Ordering::Relaxed);
                }
            }
        }
        for r in requests {
            match r {
                Request::StartStandby { fade_sec } => {
                    let tp = {
                        let st = self.inner.state.lock();
                        st.standby.as_deref().and_then(|id| st.track(id).cloned())
                    };
                    if let Some(tp) = tp {
                        if let Some(path) = tp.path.clone() {
                            if let Ok(mut v) = make_voice(&self.inner, &tp.id, &path, tp.in_sec, rate, feed_params(&tp), false) {
                                v.fade_in(fade_sec);
                                let mut st = self.inner.state.lock();
                                started(&mut st, &tp.id, v);
                            }
                        }
                    }
                }
            }
        }
    }

    // ---------------- Commands ----------------

    pub fn sync(&self, tracks: Vec<TrackParams>, config: Config) {
        let mut st = self.inner.state.lock();
        if let Some(sb) = st.standby.clone() {
            if !tracks.iter().any(|t| t.id == sb && !t.hidden) {
                st.standby = None;
            }
        }
        st.tracks = tracks;
        st.config = config;
    }

    pub fn set_standby(&self, id: Option<String>) {
        self.inner.state.lock().standby = id;
    }

    /// Moves standby to the previous (-1) or next (+1) playable track.
    pub fn standby_step(&self, delta: i32) {
        let mut st = self.inner.state.lock();
        let list: Vec<String> = st.tracks.iter().filter(|t| t.playable()).map(|t| t.id.clone()).collect();
        if list.is_empty() {
            return;
        }
        let j = match st.standby.as_ref().and_then(|id| list.iter().position(|x| x == id)) {
            None => {
                if delta < 0 {
                    0
                } else {
                    // After the main track if there is one.
                    st.main.as_ref().and_then(|m| list.iter().position(|x| x == m)).map(|i| (i + 1).min(list.len() - 1)).unwrap_or(0)
                }
            }
            Some(i) => (i as i32 + delta).clamp(0, list.len() as i32 - 1) as usize,
        };
        st.standby = Some(list[j].clone());
    }

    /// Pause all / resume all (P).
    pub fn pause_all(&self) {
        toggle_pause_all(&mut self.inner.state.lock());
    }

    pub fn go(&self) -> Result<(), String> {
        let (plan, rate) = {
            let mut st = self.inner.state.lock();
            if st.rate == 0 && !st.paused_all {
                return Err("The audio output is not available".into());
            }
            let plan = plan_go(&mut st);
            // Already prepared? Start it right here, under the same lock.
            if let GoPlan::Start(tp) = &plan {
                if let Some(i) = st.prepared.iter().position(|p| p.track_id == tp.id) {
                    let v = st.prepared.swap_remove(i);
                    let tp = tp.clone();
                    apply_go(&mut st, &tp, v);
                    return Ok(());
                }
            }
            (plan, st.rate)
        };
        match plan {
            GoPlan::Start(tp) => {
                // Not prepared yet (for example just loaded): open it now.
                let v = make_voice(&self.inner, &tp.id, tp.path.as_deref().unwrap_or_default(), tp.in_sec, rate, feed_params(&tp), false)?;
                warm_up(&v);
                let mut st = self.inner.state.lock();
                apply_go(&mut st, &tp, v);
            }
            GoPlan::Loop { track, at } => {
                let v = make_voice(&self.inner, &track.id, track.path.as_deref().unwrap_or_default(), at, rate, feed_params(&track), true)?;
                warm_up(&v);
                let mut st = self.inner.state.lock();
                apply_loop(&mut st, &track, v);
            }
            _ => {}
        }
        Ok(())
    }

    /// Plays one track at once, leaving the others alone (launchpad, internal player).
    pub fn play_now(&self, track_id: &str) -> Result<(), String> {
        self.set_standby(Some(track_id.to_string()));
        self.go()
    }

    pub fn toggle_pause(&self, track_id: &str) {
        let mut st = self.inner.state.lock();
        let any_playing = st.voices.iter().any(|v| v.track_id == track_id && !v.paused && !v.stopping());
        for v in st.voices.iter_mut().filter(|v| v.track_id == track_id && !v.stopping()) {
            v.set_paused(any_playing);
        }
    }

    pub fn stop_all(&self, immediate: bool) {
        stop_all(&mut self.inner.state.lock(), immediate);
    }

    /// Stops one track (launchpad), with a short fade.
    pub fn stop_track(&self, track_id: &str, fade_sec: f64) {
        let mut st = self.inner.state.lock();
        for v in st.voices.iter_mut().filter(|v| v.track_id == track_id) {
            v.fade_to(0.0, fade_sec.max(QUICK_STOP_SEC), AfterFade::Stop);
        }
    }

    /// Moves the play position of a paused track (it resumes from there).
    pub fn seek(&self, track_id: &str, sec: f64) -> Result<(), String> {
        let (tp, rate, in_loop) = {
            let st = self.inner.state.lock();
            let Some(v) = st.voices.iter().rev().find(|v| v.track_id == track_id && v.alive()) else { return Ok(()) };
            let Some(tp) = st.track(track_id).cloned() else { return Ok(()) };
            let in_loop = v.in_loop() && tp.loop_points.map(|l| sec >= l.in_sec && sec < l.out_sec).unwrap_or(tp.at_end == AtEnd::LoopAll);
            (tp, st.rate, in_loop)
        };
        let Some(path) = tp.path.clone() else { return Ok(()) };
        let v = make_voice(&self.inner, track_id, &path, sec.max(0.0), rate, feed_params(&tp), in_loop)?;
        warm_up(&v);
        let mut st = self.inner.state.lock();
        if !apply_seek(&mut st, track_id, v) {
            return Ok(());
        }
        Ok(())
    }

    /// Playback speed for every voice (used by the internal player).
    pub fn set_speed(&self, speed: f64) {
        let mut st = self.inner.state.lock();
        st.speed = speed.clamp(0.25, 4.0);
        let sp = st.speed;
        for v in st.voices.iter().chain(st.prepared.iter()) {
            v.h.ctl.set_speed(sp);
        }
    }

    pub fn set_device(&self, name: Option<String>) {
        if let Some(tx) = self.inner.host_tx.lock().as_ref() {
            let _ = tx.send(HostCmd::SetDevice(name));
        }
    }

    pub fn live_state(&self) -> LiveState {
        let st = self.inner.state.lock();
        let main_idx = st.main_index();
        LiveState {
            standby_id: st.standby.clone(),
            main_id: main_idx.map(|i| st.voices[i].track_id.clone()),
            pending: st.pending_step().map(|s| match s {
                AtEnd::Stop => "stop",
                AtEnd::FadeOut => "fadeOut",
                AtEnd::LoopAll => "loopAll",
                _ => "loopCut",
            }),
            paused_all: st.paused_all,
            voices: st
                .voices
                .iter()
                .enumerate()
                .filter(|(_, v)| !v.ended)
                .map(|(i, v)| {
                    let tp = st.track(&v.track_id);
                    VoiceState {
                        track_id: v.track_id.clone(),
                        position_sec: (v.pos * 20.0).round() / 20.0,
                        duration_sec: v.duration,
                        paused: v.paused,
                        fading: if v.fade.rising() {
                            Some("in")
                        } else if v.fade.falling() {
                            Some("out")
                        } else {
                            None
                        },
                        looping: tp.map(|t| t.at_end.is_loop()).unwrap_or(false),
                        in_loop: v.in_loop(),
                        main: main_idx == Some(i),
                    }
                })
                .collect(),
            engine: st.status.clone(),
        }
    }

    /// Short description of the show for the phone remote.
    pub fn summary(&self) -> serde_json::Value {
        let live = self.live_state();
        let st = self.inner.state.lock();
        let mut numbers = HashMap::new();
        let mut n = st.config.number_from;
        for t in st.tracks.iter().filter(|t| !t.hidden) {
            numbers.insert(t.id.clone(), n);
            n += 1;
        }
        let name = |id: &str| -> String {
            st.track(id)
                .and_then(|t| t.path.as_deref())
                .map(|p| p.rsplit(['\\', '/']).next().unwrap_or(p).to_string())
                .unwrap_or_default()
        };
        let at_end = |id: &str| st.track(id).map(|t| serde_json::to_value(t.at_end).unwrap_or_default()).unwrap_or_default();
        let on_space = |id: &str| st.track(id).map(|t| serde_json::to_value(t.on_space).unwrap_or_default()).unwrap_or_default();
        let standby = st.standby.as_ref().filter(|id| st.track(id).map(|t| t.playable()).unwrap_or(false)).map(|id| {
            serde_json::json!({ "n": numbers.get(id), "name": name(id), "onSpace": on_space(id) })
        });
        let playing: Vec<serde_json::Value> = live
            .voices
            .iter()
            .map(|v| {
                let tp = st.track(&v.track_id);
                let out = tp.and_then(|t| t.out_sec).map(|o| if v.duration_sec > 0.0 { o.min(v.duration_sec) } else { o }).unwrap_or(v.duration_sec);
                serde_json::json!({
                    "n": numbers.get(&v.track_id),
                    "name": name(&v.track_id),
                    "pos": v.position_sec,
                    "left": (out - v.position_sec).max(0.0),
                    "paused": v.paused,
                    "fadingOut": v.fading == Some("out"),
                    "inLoop": v.in_loop,
                    "main": v.main,
                    "atEnd": at_end(&v.track_id),
                })
            })
            .collect();
        let main_at_end = live.main_id.as_deref().map(at_end);
        serde_json::json!({
            "ready": st.status.ready,
            "standby": standby,
            "playing": playing,
            "pending": live.pending,
            "mainAtEnd": main_at_end,
            "pausedAll": live.paused_all,
            "mainDb": st.config.main_db,
        })
    }

    pub fn analyze_cached(&self, path: &str) -> Option<TrackInfo> {
        self.inner.infos.lock().get(path).cloned()
    }

    pub fn store_info(&self, path: &str, info: TrackInfo) {
        self.inner.infos.lock().insert(path.to_string(), info);
    }

    /// Stops everything (used when the app closes).
    pub fn shutdown(&self) {
        let mut st = self.inner.state.lock();
        let mut all: Vec<Voice> = st.voices.drain(..).collect();
        all.extend(st.prepared.drain(..));
        for v in all {
            v.h.ctl.stop.store(true, Ordering::Relaxed);
        }
    }
}

fn open_stream(inner: &Arc<Inner>, wanted: Option<&str>) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let mut device = None;
    if let Some(name) = wanted {
        if let Ok(devs) = host.output_devices() {
            for d in devs {
                if d.description().map(|x| x.name() == name).unwrap_or(false) {
                    device = Some(d);
                    break;
                }
            }
        }
    }
    let device = match device {
        Some(d) => d,
        None => host.default_output_device().ok_or("No audio output found")?,
    };
    let dev_name = device.description().map(|d| d.name().to_string()).unwrap_or_else(|_| "Audio output".into());
    let supported = device.default_output_config().map_err(|e| format!("The audio output cannot be used: {e}"))?;
    let rate = supported.sample_rate();
    let channels = supported.channels() as usize;
    let config = cpal::StreamConfig { channels: supported.channels(), sample_rate: rate, buffer_size: cpal::BufferSize::Default };
    // New device: remember what was playing, so it carries on on the new output.
    let snaps: Vec<VoiceSnap> = {
        let mut st = inner.state.lock();
        let mut old: Vec<Voice> = st.voices.drain(..).collect();
        let snaps = old
            .iter()
            .filter(|v| !v.ended)
            .map(|v| VoiceSnap {
                track_id: v.track_id.clone(),
                path: v.path.clone(),
                pos: v.pos,
                paused: v.paused,
                paused_by_all: v.paused_by_all,
                fade_value: v.fade.value(),
                fade_target: v.fade.target(),
                fade_left_sec: v.fade.remaining() as f64 / v.rate.max(1) as f64,
                after_fade: v.after_fade,
                in_loop: v.in_loop(),
                at_end_fired: v.at_end_fired,
            })
            .collect();
        old.extend(st.prepared.drain(..));
        for v in old {
            v.h.ctl.stop.store(true, Ordering::Relaxed);
            st.graveyard.push(v);
        }
        st.rate = rate;
        snaps
    };
    let err_inner = inner.clone();
    let on_error = move |e: cpal::Error| {
        let mut st = err_inner.state.lock();
        st.status.ready = false;
        st.status.error = Some(format!("The audio output stopped working ({e}). Trying again…"));
    };
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => build::<f32>(&device, config, channels, inner.clone(), on_error),
        cpal::SampleFormat::I16 => build::<i16>(&device, config, channels, inner.clone(), on_error),
        cpal::SampleFormat::I32 => build::<i32>(&device, config, channels, inner.clone(), on_error),
        cpal::SampleFormat::U16 => build::<u16>(&device, config, channels, inner.clone(), on_error),
        other => return Err(format!("Unsupported output format {other:?}")),
    }?;
    // Rebuild the voices at the new rate, where they were.
    for s in snaps {
        let tp = inner.state.lock().track(&s.track_id).cloned();
        let params = tp.as_ref().map(feed_params).unwrap_or(FeedParams { out_sec: None, looping: None, loop_after_end: false });
        let Ok(mut v) = make_voice(inner, &s.track_id, &s.path, s.pos, rate, params, s.in_loop) else { continue };
        warm_up(&v);
        v.paused = s.paused;
        v.paused_by_all = s.paused_by_all;
        v.pause = Fade::steady(if s.paused { 0.0 } else { 1.0 });
        v.at_end_fired = s.at_end_fired;
        v.after_fade = s.after_fade;
        v.fade = if s.fade_left_sec > 0.0 { Fade::to(s.fade_value, s.fade_target, v.frames(s.fade_left_sec).max(1)) } else { Fade::steady(s.fade_value) };
        if s.after_fade == AfterFade::Stop && s.fade_target == 0.0 && s.fade_left_sec <= 0.0 {
            continue;
        }
        inner.state.lock().voices.push(v);
    }
    stream.play().map_err(|e| format!("Cannot start the audio output: {e}"))?;
    let mut st = inner.state.lock();
    st.status = EngineStatus { ready: true, device: dev_name, sample_rate: rate, error: None };
    Ok(stream)
}

fn build<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: usize,
    inner: Arc<Inner>,
    on_error: impl FnMut(cpal::Error) + Send + 'static,
) -> Result<cpal::Stream, String>
where
    T: cpal::SizedSample + cpal::FromSample<f32>,
{
    device
        .build_output_stream::<T, _, _>(
            config,
            move |data: &mut [T], _info: &cpal::OutputCallbackInfo| {
                let mut st = inner.state.lock();
                let mut scratch = std::mem::take(&mut st.scratch);
                if scratch.len() < data.len() {
                    scratch.resize(data.len(), 0.0);
                }
                render(&mut st, &mut scratch[..data.len()], channels);
                for (d, s) in data.iter_mut().zip(scratch.iter()) {
                    *d = T::from_sample(*s);
                }
                st.scratch = scratch;
            },
            on_error,
            None,
        )
        .map_err(|e| format!("Cannot open the audio output: {e}"))
}

pub fn list_devices() -> Vec<String> {
    let host = cpal::default_host();
    let mut names: Vec<String> = Vec::new();
    if let Ok(devs) = host.output_devices() {
        for d in devs {
            if let Ok(desc) = d.description() {
                let n = desc.name().to_string();
                if !names.contains(&n) {
                    names.push(n);
                }
            }
        }
    }
    names
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
