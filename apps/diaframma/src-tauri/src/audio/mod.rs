//! Native audio engine for Show mode.
//!
//! Threads:
//! - audio callback (cpal/WASAPI): mixes the active voices; never opens files;
//! - one feeder thread per voice: decodes ahead into a ring buffer (decode.rs);
//! - device thread: owns the output stream, reopens it if the device changes or is lost;
//! - control thread: prepares the next voices, applies "At end" fallbacks,
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
use decode::{FeedParams, spawn_feeder};
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

impl Engine {
    /// Starts an engine. With `lazy`, the audio output is opened only at the
    /// first `set_device` (used by the internal player, so that an idle
    /// Diaframma keeps a single output open).
    pub fn start(app: AppHandle, event: &'static str, lazy: bool) -> Self {
        let inner = Arc::new(Inner {
            last_prepare: Mutex::new(HashMap::new()),
            state: Mutex::new(State {
                tracks: Vec::new(),
                config: Config::default(),
                standby: None,
                voices: Vec::with_capacity(64),
                prepared: Vec::with_capacity(16),
                graveyard: Vec::with_capacity(64),
                requests: Vec::with_capacity(16),
                rate: 0,
                status: EngineStatus { ready: false, device: String::new(), sample_rate: 0, error: None },
                scratch: Vec::new(),
                speed: 1.0,
            }),
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

    /// Drops finished voices, serves start requests, keeps the right voices prepared.
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
            // Which tracks should be ready to start instantly?
            let mut wanted: Vec<String> = Vec::new();
            if let Some(sb) = st.standby.clone() {
                if st.track(&sb).map(|t| t.playable()).unwrap_or(false) {
                    wanted.push(sb);
                }
            }
            for v in st.voices.iter() {
                if let Some(tp) = st.track(&v.track_id) {
                    if matches!(tp.at_end, AtEnd::Next | AtEnd::Crossfade) {
                        if let Some(n) = st.next_playable(&tp.id) {
                            if !wanted.contains(&n) {
                                wanted.push(n);
                            }
                        }
                    }
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
            if let Ok(v) = self.make_voice(&id, &path, start, rate, params) {
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
                Request::StartNext { after, fade_sec } => {
                    let next = {
                        let st = self.inner.state.lock();
                        st.next_playable(&after).and_then(|id| st.track(&id).cloned())
                    };
                    if let Some(tp) = next {
                        if let Some(path) = tp.path.clone() {
                            if let Ok(mut v) = self.make_voice(&tp.id, &path, tp.in_sec, rate, feed_params(&tp)) {
                                if fade_sec > 0.0 {
                                    let n = v.frames(fade_sec);
                                    v.fade = Fade::to(0.0, 1.0, n.max(1));
                                }
                                let mut st = self.inner.state.lock();
                                st.voices.push(v);
                                if st.standby.as_deref() == Some(tp.id.as_str()) {
                                    st.advance_standby_after(&tp.id);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fn make_voice(&self, id: &str, path: &str, start: f64, rate: u32, params: FeedParams) -> Result<Voice, String> {
        let speed = self.inner.state.lock().speed;
        let h = spawn_feeder(path.to_string(), start, rate, params, speed)?;
        let mut duration = h.ctl.duration();
        if let Some(info) = self.inner.infos.lock().get(path) {
            duration = info.duration_sec;
        }
        Ok(Voice::new(id.to_string(), path.to_string(), start, rate, h, duration))
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
            None => 0,
            Some(i) => (i as i32 + delta).clamp(0, list.len() as i32 - 1) as usize,
        };
        st.standby = Some(list[j].clone());
    }

    /// Pauses (or resumes) the track that started last.
    pub fn pause_current(&self) {
        let id = {
            let st = self.inner.state.lock();
            st.voices.iter().rev().find(|v| !v.stopping()).map(|v| v.track_id.clone())
        };
        if let Some(id) = id {
            self.toggle_pause(&id);
        }
    }

    /// Short description of the show for the phone remote.
    pub fn summary(&self) -> serde_json::Value {
        let st = self.inner.state.lock();
        let mut numbers = std::collections::HashMap::new();
        let mut n = 0;
        for t in st.tracks.iter().filter(|t| !t.hidden) {
            n += 1;
            numbers.insert(t.id.clone(), n);
        }
        let name = |id: &str| -> String {
            st.track(id)
                .and_then(|t| t.path.as_deref())
                .map(|p| p.rsplit(['\\', '/']).next().unwrap_or(p).to_string())
                .unwrap_or_default()
        };
        let standby = st.standby.as_ref().map(|id| serde_json::json!({ "n": numbers.get(id), "name": name(id) }));
        let playing: Vec<serde_json::Value> = st
            .voices
            .iter()
            .filter(|v| !v.ended)
            .map(|v| {
                let tp = st.track(&v.track_id);
                let out = tp.and_then(|t| t.out_sec).map(|o| if v.duration > 0.0 { o.min(v.duration) } else { o }).unwrap_or(v.duration);
                serde_json::json!({
                    "n": numbers.get(&v.track_id),
                    "name": name(&v.track_id),
                    "pos": v.pos,
                    "left": (out - v.pos).max(0.0),
                    "paused": v.paused,
                    "fadingOut": v.fade.falling(),
                })
            })
            .collect();
        serde_json::json!({ "ready": st.status.ready, "standby": standby, "playing": playing })
    }

    pub fn go(&self) -> Result<(), String> {
        let (tp, rate) = {
            let mut st = self.inner.state.lock();
            let Some(sb) = st.standby.clone() else { return Ok(()) };
            let Some(tp) = st.track(&sb).cloned() else { return Ok(()) };
            if !tp.playable() {
                st.advance_standby_after(&sb);
                return Ok(());
            }
            if st.rate == 0 {
                return Err("The audio output is not available".into());
            }
            if let Some(i) = st.prepared.iter().position(|p| p.track_id == tp.id) {
                let v = st.prepared.swap_remove(i);
                apply_go(&mut st, &tp, v);
                return Ok(());
            }
            (tp, st.rate)
        };
        // Not prepared yet (for example just loaded): open it now.
        let v = self.make_voice(&tp.id, tp.path.as_deref().unwrap_or_default(), tp.in_sec, rate, feed_params(&tp))?;
        // Give the decoder a moment to fill the buffer, so the start is clean.
        let t0 = Instant::now();
        while v.h.audio.slots() < 2048 && !v.h.ctl.finished.load(Ordering::Relaxed) && t0.elapsed() < Duration::from_millis(150) {
            thread::sleep(Duration::from_millis(2));
        }
        let mut st = self.inner.state.lock();
        apply_go(&mut st, &tp, v);
        Ok(())
    }

    pub fn toggle_pause(&self, track_id: &str) {
        let mut st = self.inner.state.lock();
        let any_playing = st.voices.iter().any(|v| v.track_id == track_id && !v.paused && !v.stopping());
        for v in st.voices.iter_mut().filter(|v| v.track_id == track_id && !v.stopping()) {
            v.set_paused(any_playing);
        }
    }

    pub fn stop_all(&self, immediate: bool) {
        let mut st = self.inner.state.lock();
        let sec = if immediate { QUICK_STOP_SEC } else { st.config.stop_all_sec.max(QUICK_STOP_SEC) };
        for v in st.voices.iter_mut() {
            if immediate || !v.stopping() {
                v.fade_to(0.0, sec, AfterFade::Stop);
            }
        }
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
        LiveState {
            standby_id: st.standby.clone(),
            voices: st
                .voices
                .iter()
                .filter(|v| !v.ended)
                .map(|v| {
                    let tp = st.track(&v.track_id);
                    VoiceState {
                        track_id: v.track_id.clone(),
                        position_sec: (v.pos * 10.0).round() / 10.0,
                        duration_sec: v.duration,
                        paused: v.paused,
                        fading: if v.fade.rising() {
                            Some("in")
                        } else if v.fade.falling() {
                            Some("out")
                        } else {
                            None
                        },
                        looping: tp.map(|t| matches!(t.at_end, AtEnd::LoopAll | AtEnd::LoopCut)).unwrap_or(false),
                    }
                })
                .collect(),
            engine: st.status.clone(),
        }
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
    {
        // New device: stop what was playing and rebuild prepared voices at the new rate.
        let mut st = inner.state.lock();
        let mut old: Vec<Voice> = st.voices.drain(..).collect();
        old.extend(st.prepared.drain(..));
        for v in old {
            v.h.ctl.stop.store(true, Ordering::Relaxed);
            st.graveyard.push(v);
        }
        st.rate = rate;
    }
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
pub fn engine_go(engine: tauri::State<'_, Engine>) -> Result<(), String> {
    engine.go()
}

#[tauri::command]
pub fn engine_pause(engine: tauri::State<'_, Engine>, track_id: String) {
    engine.toggle_pause(&track_id);
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
    p.0.set_standby(Some(track_id));
    p.0.go()
}

#[tauri::command]
pub fn player_pause(p: tauri::State<'_, Player>, track_id: String) {
    p.0.toggle_pause(&track_id);
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
