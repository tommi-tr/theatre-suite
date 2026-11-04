//! Windows implementation of Rehearsal mode.
//!
//! All COM / WinRT objects live on one worker thread (they are not `Send`).
//! The rest of the app talks to it through a channel.

use std::collections::HashMap;
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as MediaSession, GlobalSystemMediaTransportControlsSessionManager as MediaManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    AudioSessionStateActive, DEVICE_STATE_ACTIVE, IAudioSessionControl2, IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume,
    MMDeviceEnumerator, eConsole, eMultimedia, eRender,
};
use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree, STGM_READ};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};
use windows::Win32::System::WinRT::RoGetActivationFactory;
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_APPCOMMAND};
use windows::core::{BOOL, GUID, HRESULT, HSTRING, IInspectable, Interface, PWSTR};

use super::{JournalEntry, Output, Snapshot, Source};

const RENDER_INTERFACE: &str = "{e6327cad-dcec-4949-ae8a-991e976a79d2}";
const MMDEVAPI_PREFIX: &str = "\\\\?\\SWD#MMDEVAPI#";

enum Cmd {
    Snapshot(mpsc::Sender<Snapshot>),
    Media(String, String, mpsc::Sender<Result<(), String>>),
    Volume(Vec<String>, f32),
    Speed(Vec<String>, f64),
    Route(String, Option<String>, mpsc::Sender<Result<(), String>>),
    PauseAll,
    Restore(mpsc::Sender<()>),
}

pub struct Rehearsal {
    tx: parking_lot::Mutex<mpsc::Sender<Cmd>>,
}

impl Rehearsal {
    pub fn start(journal: PathBuf) -> Self {
        let (tx, rx) = mpsc::channel::<Cmd>();
        thread::Builder::new()
            .name("diaframma-rehearsal".into())
            .spawn(move || worker(rx, journal))
            .expect("rehearsal thread");
        Rehearsal { tx: parking_lot::Mutex::new(tx) }
    }
    fn send(&self, c: Cmd) {
        let _ = self.tx.lock().send(c);
    }
    pub fn snapshot(&self) -> Snapshot {
        let (rtx, rrx) = mpsc::channel();
        self.send(Cmd::Snapshot(rtx));
        rrx.recv_timeout(Duration::from_secs(4)).unwrap_or_default()
    }
    pub fn media(&self, id: String, action: String) -> Result<(), String> {
        let (rtx, rrx) = mpsc::channel();
        self.send(Cmd::Media(id, action, rtx));
        rrx.recv_timeout(Duration::from_secs(4)).unwrap_or(Err("No answer from Windows".into()))
    }
    pub fn set_volume(&self, ids: Vec<String>, v: f32) {
        self.send(Cmd::Volume(ids, v));
    }
    pub fn set_speed(&self, ids: Vec<String>, r: f64) {
        self.send(Cmd::Speed(ids, r));
    }
    pub fn route(&self, id: String, output: Option<String>) -> Result<(), String> {
        let (rtx, rrx) = mpsc::channel();
        self.send(Cmd::Route(id, output, rtx));
        rrx.recv_timeout(Duration::from_secs(4)).unwrap_or(Err("No answer from Windows".into()))
    }
    pub fn pause_all(&self) {
        self.send(Cmd::PauseAll);
    }
    /// Puts volumes and outputs back as they were. Blocks up to 3 seconds.
    pub fn restore(&self) {
        let (rtx, rrx) = mpsc::channel();
        self.send(Cmd::Restore(rtx));
        let _ = rrx.recv_timeout(Duration::from_secs(3));
    }
}

// ---------------- Worker ----------------

struct AudioSession {
    pid: u32,
    exe: String,
    volume: Option<ISimpleAudioVolume>,
    meter: Option<IAudioMeterInformation>,
    active: bool,
}

struct Worker {
    enumerator: Option<IMMDeviceEnumerator>,
    media: Option<MediaManager>,
    policy: Option<PolicyConfig>,
    journal_path: PathBuf,
    journal: HashMap<String, JournalEntry>,
    thumbs: HashMap<String, Option<String>>,
    sources: Vec<(Source, Option<MediaSession>)>,
    own_pid: u32,
}

fn worker(rx: mpsc::Receiver<Cmd>, journal_path: PathBuf) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let journal: HashMap<String, JournalEntry> = std::fs::read_to_string(&journal_path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<JournalEntry>>(&s).ok())
        .map(|v| v.into_iter().map(|e| (e.exe.clone(), e)).collect())
        .unwrap_or_default();
    let mut w = Worker {
        enumerator: unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok() },
        media: MediaManager::RequestAsync().ok().and_then(|op| op.join().ok()),
        policy: PolicyConfig::new(),
        journal_path,
        journal,
        thumbs: HashMap::new(),
        sources: Vec::new(),
        own_pid: std::process::id(),
    };
    // Something left from a previous session (crash)? Put it back now if possible.
    if !w.journal.is_empty() {
        w.restore_pending();
    }
    let mut last_retry = std::time::Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Cmd::Snapshot(r)) => {
                let s = w.snapshot();
                let _ = r.send(s);
            }
            Ok(Cmd::Media(id, action, r)) => {
                let _ = r.send(w.media_cmd(&id, &action));
            }
            Ok(Cmd::Volume(ids, v)) => w.set_volume(&ids, v),
            Ok(Cmd::Speed(ids, rate)) => w.set_speed(&ids, rate),
            Ok(Cmd::Route(id, out, r)) => {
                let _ = r.send(w.route(&id, out));
            }
            Ok(Cmd::PauseAll) => w.pause_all(),
            Ok(Cmd::Restore(r)) => {
                w.restore_pending();
                let _ = r.send(());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if !w.journal.is_empty() && last_retry.elapsed() > Duration::from_secs(30) {
            last_retry = std::time::Instant::now();
            // Retry entries whose program was closed: they are restored when it runs again.
            let _ = w.sessions();
        }
    }
}

fn exe_of_pid(pid: u32) -> String {
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut size).is_ok();
        let _ = CloseHandle(h);
        if !ok {
            return String::new();
        }
        let full = String::from_utf16_lossy(&buf[..size as usize]);
        full.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase()
    }
}

fn pretty_app(exe: &str) -> (String, String) {
    let e = exe.trim_end_matches(".exe");
    match e {
        "spotify" => ("Spotify".into(), "spotify".into()),
        "chrome" => ("Google Chrome".into(), "browser".into()),
        "msedge" => ("Microsoft Edge".into(), "browser".into()),
        "firefox" => ("Firefox".into(), "browser".into()),
        "brave" => ("Brave".into(), "browser".into()),
        "opera" => ("Opera".into(), "browser".into()),
        "vlc" => ("VLC".into(), "vlc".into()),
        "wmplayer" => ("Windows Media Player".into(), "vlc".into()),
        "microsoft.media.player" => ("Media Player".into(), "media".into()),
        "" => ("Program".into(), "program".into()),
        other => {
            let mut c = other.chars();
            let name = match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => other.to_string(),
            };
            (name, "program".into())
        }
    }
}

/// Maps a media session app id to the executable name of its process.
fn exe_from_aumid(aumid: &str) -> String {
    let a = aumid.to_lowercase();
    if a.contains("zunemusic") || a.contains("media.player") || a.contains("mediaplayer") {
        return "microsoft.media.player.exe".into();
    }
    for (k, exe) in [("spotify", "spotify.exe"), ("chrome", "chrome.exe"), ("msedge", "msedge.exe"), ("firefox", "firefox.exe"), ("brave", "brave.exe"), ("opera", "opera.exe"), ("vlc", "vlc.exe")] {
        if a.contains(k) {
            return exe.into();
        }
    }
    let last = a.rsplit(['\\', '!']).next().unwrap_or(&a).to_string();
    if last.ends_with(".exe") { last } else { format!("{last}.exe") }
}

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn device_id(d: &IMMDevice) -> Option<String> {
    unsafe {
        let p = d.GetId().ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const c_void));
        s
    }
}

fn device_name(d: &IMMDevice) -> String {
    unsafe {
        d.OpenPropertyStore(STGM_READ)
            .and_then(|ps| ps.GetValue(&PKEY_Device_FriendlyName))
            .map(|v| v.to_string())
            .unwrap_or_else(|_| "Audio output".into())
    }
}

impl Worker {
    fn devices(&self) -> Vec<(String, String, IMMDevice)> {
        let mut out = Vec::new();
        let Some(en) = &self.enumerator else { return out };
        unsafe {
            if let Ok(col) = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
                let n = col.GetCount().unwrap_or(0);
                for i in 0..n {
                    if let Ok(d) = col.Item(i) {
                        if let Some(id) = device_id(&d) {
                            out.push((id, device_name(&d), d));
                        }
                    }
                }
            }
        }
        out
    }

    fn default_device_id(&self) -> Option<String> {
        let en = self.enumerator.as_ref()?;
        unsafe { en.GetDefaultAudioEndpoint(eRender, eMultimedia).ok().and_then(|d| device_id(&d)) }
    }

    /// All program audio sessions on all outputs.
    fn sessions(&mut self) -> Vec<AudioSession> {
        let mut out = Vec::new();
        for (_, _, dev) in self.devices() {
            unsafe {
                let Ok(mgr) = dev.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
                let Ok(en) = mgr.GetSessionEnumerator() else { continue };
                let n = en.GetCount().unwrap_or(0);
                for i in 0..n {
                    let Ok(ctl) = en.GetSession(i) else { continue };
                    let Ok(ctl2) = ctl.cast::<IAudioSessionControl2>() else { continue };
                    if ctl2.IsSystemSoundsSession() == HRESULT(0) {
                        continue; // S_OK = system sounds
                    }
                    let pid = ctl2.GetProcessId().unwrap_or(0);
                    if pid == 0 || pid == self.own_pid {
                        continue;
                    }
                    let exe = exe_of_pid(pid);
                    let active = ctl.GetState().map(|s| s == AudioSessionStateActive).unwrap_or(false);
                    out.push(AudioSession { pid, exe, volume: ctl.cast::<ISimpleAudioVolume>().ok(), meter: ctl.cast::<IAudioMeterInformation>().ok(), active });
                }
            }
        }
        // Restore journal entries for programs that are running again.
        let pending: Vec<String> = self.journal.keys().cloned().collect();
        let mut restored = Vec::new();
        for exe in pending {
            let pids: Vec<u32> = out.iter().filter(|s| s.exe == exe).map(|s| s.pid).collect();
            if pids.is_empty() {
                continue;
            }
            if let Some(e) = self.journal.get(&exe).cloned() {
                if let Some(v) = e.volume {
                    for s in out.iter().filter(|s| s.exe == exe) {
                        if let Some(vol) = &s.volume {
                            unsafe {
                                let _ = vol.SetMasterVolume(v, std::ptr::null());
                            }
                        }
                    }
                }
                if let (Some(route), Some(p)) = (e.route.clone(), &self.policy) {
                    for pid in &pids {
                        p.set(*pid, route.as_deref());
                    }
                }
                restored.push(exe);
            }
        }
        if !restored.is_empty() {
            for e in restored {
                self.journal.remove(&e);
            }
            self.save_journal();
        }
        out
    }

    fn save_journal(&self) {
        let list: Vec<&JournalEntry> = self.journal.values().collect();
        if let Ok(text) = serde_json::to_string_pretty(&list) {
            if list.is_empty() {
                let _ = std::fs::remove_file(&self.journal_path);
            } else {
                let _ = crate::storage::atomic_write(&self.journal_path, text.as_bytes());
            }
        }
    }

    fn thumb(&mut self, key: &str, props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<String> {
        if let Some(t) = self.thumbs.get(key) {
            return t.clone();
        }
        let read = || -> windows::core::Result<Option<String>> {
            let r = props.Thumbnail()?;
            let stream = r.OpenReadAsync()?.join()?;
            let size = stream.Size()? as u32;
            if size == 0 || size > 600_000 {
                return Ok(None);
            }
            let ct = stream.ContentType().map(|h| h.to_string()).unwrap_or_else(|_| "image/png".into());
            let reader = DataReader::CreateDataReader(&stream)?;
            reader.LoadAsync(size)?.join()?;
            let mut buf = vec![0u8; size as usize];
            reader.ReadBytes(&mut buf)?;
            Ok(Some(format!("data:{};base64,{}", if ct.is_empty() { "image/png" } else { &ct }, base64(&buf))))
        };
        let t = read().ok().flatten();
        if self.thumbs.len() > 64 {
            self.thumbs.clear();
        }
        self.thumbs.insert(key.to_string(), t.clone());
        t
    }

    fn snapshot(&mut self) -> Snapshot {
        let sessions = self.sessions();
        let default_id = self.default_device_id();
        let mut sources: Vec<(Source, Option<MediaSession>)> = Vec::new();
        let mut used_pids: Vec<u32> = Vec::new();

        // 1) Media sessions (they can be paused / skipped).
        if let Some(mgr) = &self.media {
            let list: Vec<MediaSession> = mgr.GetSessions().map(|v| v.into_iter().collect()).unwrap_or_default();
            let mut seen: HashMap<String, usize> = HashMap::new();
            for ms in list {
                let aumid = ms.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default();
                let exe = exe_from_aumid(&aumid);
                let (app, kind) = pretty_app(&exe);
                let n = seen.entry(aumid.clone()).or_insert(0);
                *n += 1;
                let id = if *n == 1 { format!("m:{aumid}") } else { format!("m:{aumid}#{n}") };
                let mut src = Source { id, app, exe: exe.clone(), kind, status: "stopped".into(), ..Default::default() };
                if let Ok(props) = ms.TryGetMediaPropertiesAsync().and_then(|op| op.join()) {
                    src.title = props.Title().map(|h| h.to_string()).unwrap_or_default();
                    src.artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
                    let key = format!("{aumid}|{}|{}", src.title, src.artist);
                    src.thumb = self.thumb(&key, &props);
                }
                if let Ok(info) = ms.GetPlaybackInfo() {
                    src.status = match info.PlaybackStatus() {
                        Ok(PlaybackStatus::Playing) => "playing",
                        Ok(PlaybackStatus::Paused) => "paused",
                        _ => "stopped",
                    }
                    .into();
                    if let Ok(c) = info.Controls() {
                        src.can_toggle = c.IsPlayPauseToggleEnabled().unwrap_or(false) || c.IsPlayEnabled().unwrap_or(false) || c.IsPauseEnabled().unwrap_or(false);
                        src.can_next = c.IsNextEnabled().unwrap_or(false);
                        src.can_prev = c.IsPreviousEnabled().unwrap_or(false);
                        src.can_speed = c.IsPlaybackRateEnabled().unwrap_or(false);
                    }
                    src.speed = info.PlaybackRate().and_then(|r| r.Value()).ok();
                }
                if let Ok(tl) = ms.GetTimelineProperties() {
                    let pos = tl.Position().map(|t| t.Duration as f64 / 1e7).unwrap_or(0.0);
                    let end = tl.EndTime().map(|t| t.Duration as f64 / 1e7).unwrap_or(0.0);
                    if end > 0.0 {
                        src.position_sec = Some(pos);
                        src.duration_sec = Some(end);
                    }
                }
                for s in sessions.iter().filter(|s| s.exe == exe) {
                    if !src.pids.contains(&s.pid) {
                        src.pids.push(s.pid);
                    }
                    used_pids.push(s.pid);
                }
                sources.push((src, Some(ms)));
            }
        }
        // 2) Other programs that make sound (volume and output only; VLC/WMP via media keys).
        let mut by_exe: HashMap<String, Source> = HashMap::new();
        for s in sessions.iter().filter(|s| !used_pids.contains(&s.pid)) {
            let peak = s.meter.as_ref().and_then(|m| unsafe { m.GetPeakValue().ok() }).unwrap_or(0.0);
            if !s.active && peak <= 0.0001 {
                continue;
            }
            let e = by_exe.entry(s.exe.clone()).or_insert_with(|| {
                let (app, kind) = pretty_app(&s.exe);
                let keys = kind == "vlc";
                Source {
                    id: format!("p:{}", s.exe),
                    app: app.clone(),
                    exe: s.exe.clone(),
                    kind,
                    title: app,
                    status: "stopped".into(),
                    can_toggle: keys,
                    can_next: keys,
                    can_prev: keys,
                    ..Default::default()
                }
            });
            if !e.pids.contains(&s.pid) {
                e.pids.push(s.pid);
            }
            if peak > 0.001 {
                e.status = "playing".into();
            }
        }
        let mut others: Vec<Source> = by_exe.into_values().collect();
        others.sort_by(|a, b| a.app.cmp(&b.app));
        sources.extend(others.into_iter().map(|s| (s, None)));

        // Volume, peak and output of every source.
        for (src, _) in sources.iter_mut() {
            let mine: Vec<&AudioSession> = sessions.iter().filter(|s| src.pids.contains(&s.pid)).collect();
            src.volume = mine.iter().find_map(|s| s.volume.as_ref()).and_then(|v| unsafe { v.GetMasterVolume().ok() });
            src.peak = mine.iter().filter_map(|s| s.meter.as_ref()).filter_map(|m| unsafe { m.GetPeakValue().ok() }).fold(0.0, f32::max);
            if let (Some(p), Some(pid)) = (&self.policy, src.pids.first()) {
                src.output_id = p.get(*pid);
            }
        }

        let outputs = self
            .devices()
            .into_iter()
            .map(|(id, name, dev)| {
                let mut peaks = [0f32; 2];
                unsafe {
                    if let Ok(m) = dev.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None) {
                        let ch = m.GetMeteringChannelCount().unwrap_or(0) as usize;
                        if ch >= 2 {
                            let mut v = vec![0f32; ch];
                            if m.GetChannelsPeakValues(&mut v).is_ok() {
                                peaks = [v[0], v[1]];
                            }
                        } else if let Ok(p) = m.GetPeakValue() {
                            peaks = [p, p];
                        }
                    }
                }
                Output { is_default: Some(&id) == default_id.as_ref(), id, name, peak_l: peaks[0], peak_r: peaks[1] }
            })
            .collect();

        let snap = Snapshot {
            supported: true,
            routing_available: self.policy.is_some(),
            sources: sources.iter().map(|(s, _)| s.clone()).collect(),
            outputs,
            pending_restore: self.journal.len(),
        };
        self.sources = sources;
        snap
    }

    fn find(&self, id: &str) -> Option<&(Source, Option<MediaSession>)> {
        self.sources.iter().find(|(s, _)| s.id == id)
    }

    fn media_cmd(&mut self, id: &str, action: &str) -> Result<(), String> {
        let (src, ms) = self.find(id).cloned().ok_or("This player is no longer open")?;
        if let Some(ms) = ms {
            let r = match action {
                "toggle" => ms.TryTogglePlayPauseAsync().and_then(|o| o.join()),
                "next" => ms.TrySkipNextAsync().and_then(|o| o.join()),
                "prev" => ms.TrySkipPreviousAsync().and_then(|o| o.join()),
                "pause" => ms.TryPauseAsync().and_then(|o| o.join()),
                _ => return Err("Unknown command".into()),
            };
            return match r {
                Ok(true) => Ok(()),
                Ok(false) => Err(format!("{} did not accept the command", src.app)),
                Err(e) => Err(e.message().to_string()),
            };
        }
        if src.kind == "vlc" {
            let cmd: isize = match action {
                "toggle" | "pause" => 14,
                "next" => 11,
                "prev" => 12,
                _ => return Err("Unknown command".into()),
            };
            send_app_command(&src.pids, cmd);
            return Ok(());
        }
        Err(format!("{} cannot be controlled, only its volume and output", src.app))
    }

    fn remember(&mut self, exe: &str, f: impl FnOnce(&mut JournalEntry)) {
        let e = self.journal.entry(exe.to_string()).or_insert_with(|| JournalEntry { exe: exe.to_string(), volume: None, route: None });
        f(e);
        self.save_journal();
    }

    fn set_volume(&mut self, ids: &[String], v: f32) {
        let sessions = self.sessions();
        for id in ids {
            let Some((src, _)) = self.find(id).cloned() else { continue };
            for s in sessions.iter().filter(|s| src.pids.contains(&s.pid)) {
                if let Some(vol) = &s.volume {
                    unsafe {
                        let before = vol.GetMasterVolume().ok();
                        if !self.journal.get(&src.exe).map(|e| e.volume.is_some()).unwrap_or(false) {
                            if let Some(b) = before {
                                self.remember(&src.exe, |e| e.volume = Some(b));
                            }
                        }
                        let _ = vol.SetMasterVolume(v, std::ptr::null());
                    }
                }
            }
        }
    }

    fn set_speed(&mut self, ids: &[String], rate: f64) {
        for id in ids {
            if let Some((_, Some(ms))) = self.find(id).cloned() {
                let _ = ms.TryChangePlaybackRateAsync(rate).and_then(|o| o.join());
            }
        }
    }

    fn route(&mut self, id: &str, output: Option<String>) -> Result<(), String> {
        let (src, _) = self.find(id).cloned().ok_or("This player is no longer open")?;
        if src.pids.is_empty() {
            return Err(format!("{} is not making any sound yet: start it, then try again", src.app));
        }
        let Some(p) = &self.policy else { return Err("Choosing the output of each program is not available on this version of Windows".into()) };
        let before = p.get(src.pids[0]);
        for pid in &src.pids {
            p.set(*pid, output.as_deref());
        }
        if !self.journal.get(&src.exe).map(|e| e.route.is_some()).unwrap_or(false) {
            self.remember(&src.exe, |e| e.route = Some(before));
        }
        Ok(())
    }

    fn pause_all(&mut self) {
        for (src, ms) in self.sources.clone() {
            if src.status != "playing" {
                continue;
            }
            if let Some(ms) = ms {
                let _ = ms.TryPauseAsync().and_then(|o| o.join());
            } else if src.kind == "vlc" {
                send_app_command(&src.pids, 14);
            }
        }
    }

    fn restore_pending(&mut self) {
        let _ = self.sessions();
    }
}

fn send_app_command(pids: &[u32], cmd: isize) {
    struct Ctx {
        pids: Vec<u32>,
        found: Vec<HWND>,
    }
    unsafe extern "system" fn cb(hwnd: HWND, lp: LPARAM) -> BOOL {
        unsafe {
            let ctx = &mut *(lp.0 as *mut Ctx);
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if ctx.pids.contains(&pid) && IsWindowVisible(hwnd).as_bool() {
                ctx.found.push(hwnd);
            }
        }
        BOOL(1)
    }
    let mut ctx = Ctx { pids: pids.to_vec(), found: Vec::new() };
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut ctx as *mut Ctx as isize));
        if let Some(h) = ctx.found.first() {
            let _ = PostMessageW(Some(*h), WM_APPCOMMAND, WPARAM(h.0 as usize), LPARAM(cmd << 16));
        }
    }
}

// ---------------- Per-program output (undocumented, as used by EarTrumpet) ----------------

struct PolicyConfig {
    obj: IInspectable,
    iface: *mut c_void,
}

type SetFn = unsafe extern "system" fn(this: *mut c_void, pid: u32, flow: i32, role: i32, device: *mut c_void) -> HRESULT;
type GetFn = unsafe extern "system" fn(this: *mut c_void, pid: u32, flow: i32, role: i32, device: *mut *mut c_void) -> HRESULT;

impl PolicyConfig {
    fn new() -> Option<Self> {
        const IIDS: [GUID; 2] = [
            GUID::from_u128(0xab3d4648_e242_459f_b02f_541c70306324), // Windows 10 21H2 and later, Windows 11
            GUID::from_u128(0x2a59116d_6c4f_45e0_a74f_707e3fef9258), // Windows 10 1803 – 21H1
        ];
        unsafe {
            let factory: IInspectable = RoGetActivationFactory(&HSTRING::from("Windows.Media.Internal.AudioPolicyConfig")).ok()?;
            for iid in IIDS {
                let mut p: *mut c_void = std::ptr::null_mut();
                if factory.query(&iid, &mut p).is_ok() && !p.is_null() {
                    return Some(PolicyConfig { obj: factory, iface: p });
                }
            }
            None
        }
    }
    fn vtable(&self) -> *const usize {
        unsafe { *(self.iface as *const *const usize) }
    }
    /// Sets (or with None, resets) the output of a process, for both console and multimedia roles.
    fn set(&self, pid: u32, device_id: Option<&str>) {
        let _ = &self.obj;
        unsafe {
            let f: SetFn = std::mem::transmute(*self.vtable().add(25));
            let h = device_id.map(|id| HSTRING::from(format!("{MMDEVAPI_PREFIX}{id}#{RENDER_INTERFACE}")));
            let raw: *mut c_void = match &h {
                Some(h) => std::mem::transmute_copy(h),
                None => std::ptr::null_mut(),
            };
            let _ = f(self.iface, pid, eRender.0, eConsole.0, raw);
            let _ = f(self.iface, pid, eRender.0, eMultimedia.0, raw);
            drop(h);
        }
    }
    /// The output chosen for a process, or None if it follows the Windows default.
    fn get(&self, pid: u32) -> Option<String> {
        unsafe {
            let f: GetFn = std::mem::transmute(*self.vtable().add(26));
            let mut out: *mut c_void = std::ptr::null_mut();
            if f(self.iface, pid, eRender.0, eMultimedia.0, &mut out).is_err() || out.is_null() {
                return None;
            }
            let h: HSTRING = std::mem::transmute(out);
            let s = h.to_string();
            let start = s.find("MMDEVAPI#").map(|i| i + 9)?;
            let end = s.rfind("#{").unwrap_or(s.len());
            let id = s.get(start..end)?.to_string();
            if id.is_empty() { None } else { Some(id) }
        }
    }
}

impl Drop for PolicyConfig {
    fn drop(&mut self) {
        unsafe {
            // Release the reference obtained by `query`.
            let release: unsafe extern "system" fn(*mut c_void) -> u32 = std::mem::transmute(*self.vtable().add(2));
            release(self.iface);
        }
    }
}
