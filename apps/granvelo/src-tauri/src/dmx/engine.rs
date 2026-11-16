//! The engine thread: a steady loop (40 frames/s; 30 with Open DMX) with absolute deadlines,
//! commands through a channel, the connection as a state machine.
//!
//! - It **sends nothing until `Connect`**: before that it only computes (so the interface
//!   can show fades), no port is opened.
//! - Each frame: `core.advance(now)`, then the frame goes to the driver. A late frame never
//!   causes a burst of catch-up frames: the next deadline moves forward from now.
//! - It never waits for the interface: commands arrive through a channel, state goes out
//!   through a shared snapshot that the publisher thread reads (and emits to the UI).
//! - Opening ports and probing them happen in a short-lived helper thread ("job"), so the
//!   loop keeps its cadence; results come back as commands, tagged with a generation so a
//!   late result of an abandoned attempt is dropped.
//! - A write error (cable pulled out) → `Lost`: one reconnection attempt about every second,
//!   looking for the same device by VID/PID/serial; when it is back the current frame is sent
//!   at once (every frame carries the whole universe).
//! - `Disconnect` stops sending. Neither disconnecting nor closing the app sends a blackout:
//!   the lights stay as they are (a Pro keeps repeating its last frame while powered; with
//!   Open DMX the signal stops and most lights hold their last values).

use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::core::{Core, FadeState, MasterState, TestState, Universe};
use super::discovery::{Backend, DeviceInfo, ErrorCode, Guess, LinkError, find_again, log_line};
use super::driver::{Driver, Kind, OpenDmxDriver, PERIOD, ProDriver, SimDriver, probe_pro};
use super::fade::{Layout, Transition, UNIVERSE};
use super::hires::HighResTimer;

/// How to connect.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ConnectRequest {
    /// Find the cable: the preferred port first, Pro-looking devices, then FTDI chips; a device
    /// answering the Pro detection is a Pro, otherwise an FTDI chip is driven as Open DMX.
    /// With `kind` the family is forced (no fallback).
    Auto {
        #[serde(default)]
        prefer: Option<String>,
        #[serde(default)]
        kind: Option<Kind>,
    },
    /// This port, driven as this family.
    Port { port: String, kind: Kind },
    /// No cable: "Uscita simulata".
    Simulated,
}

#[allow(clippy::large_enum_variant)]
pub enum Cmd {
    Connect(ConnectRequest),
    Disconnect,
    SetUniverse(Vec<u8>),
    FadeTo {
        target: Vec<u8>,
        transition: Transition,
        layout: Layout,
        id: u64,
    },
    Pause,
    Resume,
    StopFade,
    Blackout(bool),
    FadeToBlack(f64),
    ReleaseBlack(f64),
    GrandMaster {
        level: u8,
        mask: Option<Vec<u8>>,
    },
    /// Some((channels, level)) starts the test pattern, None stops it.
    Test(Option<(usize, u8)>),
    /// Internal: the result of a connection job.
    Opened {
        generation: u64,
        result: Result<Opened, LinkError>,
    },
    Shutdown,
}

pub struct Opened {
    pub driver: Box<dyn Driver>,
    pub device: Option<DeviceInfo>,
    /// "firmware 1.44 · serial 12345678" when a Pro answered.
    pub detail: Option<String>,
}

/// The state of the connection, for the interface.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LinkState {
    /// Not sending (never connected, or disconnected).
    Idle,
    Connecting,
    Connected {
        device: String,
        kind: Kind,
    },
    Simulated,
    Lost {
        device: String,
        kind: Kind,
        since_ms: u64,
        attempts: u32,
    },
    Error {
        code: ErrorCode,
        message: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub link: LinkState,
    pub device: Option<DeviceInfo>,
    pub detail: Option<String>,
    pub last_error: Option<String>,
}

/// What changes during a show: fade progress, output master, test, frame rate.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Live {
    pub fade: FadeState,
    pub master: MasterState,
    pub test: Option<TestState>,
    /// Frames per second actually sent (0 when not sending).
    pub fps: f64,
    pub frames_sent: u64,
}

/// What the engine shares with the publisher and the Tauri commands.
pub struct Shared {
    pub status: Status,
    pub live: Live,
    /// On the cable (after the output master).
    pub output: Universe,
    /// Under the output master (the playback layer).
    pub under: Universe,
    /// Increases when `output` or `under` change.
    pub output_seq: u64,
    /// Increases when `status` changes.
    pub status_seq: u64,
}

impl Shared {
    pub fn new() -> Self {
        let core = Core::new();
        Shared {
            status: Status {
                link: LinkState::Idle,
                device: None,
                detail: None,
                last_error: None,
            },
            live: Live {
                fade: core.fade_state(),
                master: core.master_state(),
                test: None,
                fps: 0.0,
                frames_sent: 0,
            },
            output: [0; UNIVERSE],
            under: [0; UNIVERSE],
            output_seq: 0,
            status_seq: 0,
        }
    }
}

impl Default for Shared {
    fn default() -> Self {
        Self::new()
    }
}

#[allow(clippy::large_enum_variant)]
pub enum Wait {
    Cmd(Cmd),
    Deadline,
    Closed,
}

/// Time for the engine: real, or driven by the tests.
pub trait Clock: Send {
    /// Seconds since the engine started (monotonic).
    fn now(&self) -> f64;
    /// Waits for a command until `until`.
    fn wait(&mut self, rx: &Receiver<Cmd>, until: f64) -> Wait;
}

pub struct RealClock {
    origin: Instant,
}

impl RealClock {
    pub fn new() -> Self {
        RealClock {
            origin: Instant::now(),
        }
    }
}

impl Default for RealClock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock for RealClock {
    fn now(&self) -> f64 {
        self.origin.elapsed().as_secs_f64()
    }

    fn wait(&mut self, rx: &Receiver<Cmd>, until: f64) -> Wait {
        loop {
            let now = self.now();
            if now >= until {
                return match rx.try_recv() {
                    Ok(c) => Wait::Cmd(c),
                    Err(TryRecvError::Empty) => Wait::Deadline,
                    Err(TryRecvError::Disconnected) => Wait::Closed,
                };
            }
            match rx.recv_timeout(Duration::from_secs_f64(until - now)) {
                Ok(c) => return Wait::Cmd(c),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return Wait::Closed,
            }
        }
    }
}

/// Runs a connection job (a helper thread in the app, inline in the tests).
pub type Spawner = Arc<dyn Fn(Box<dyn FnOnce() + Send>) + Send + Sync>;

pub fn thread_spawner() -> Spawner {
    Arc::new(|job| {
        if let Err(e) = std::thread::Builder::new()
            .name("granvelo-dmx-connect".into())
            .spawn(job)
        {
            log_line(&format!("cannot start the connection thread: {e}"));
        }
    })
}

/// Seconds between reconnection attempts.
pub const RETRY_EVERY: f64 = 1.0;
/// How long a device has to answer the Pro detection.
pub const PROBE_TIMEOUT: Duration = Duration::from_millis(300);

// One value per engine: the size difference between the states does not matter.
#[allow(clippy::large_enum_variant)]
enum Link {
    Idle,
    Connecting,
    Connected {
        driver: Box<dyn Driver>,
        device: Option<DeviceInfo>,
        detail: Option<String>,
    },
    Lost {
        device: DeviceInfo,
        kind: Kind,
        since_ms: u64,
        attempts: u32,
        next_try: f64,
        busy: bool,
    },
    Error(LinkError),
}

pub struct Config {
    pub backend: Arc<dyn Backend>,
    pub spawn: Spawner,
    /// Makes the driver of "Uscita simulata" (a Recorder in the tests).
    pub make_sim: Box<dyn Fn() -> Box<dyn Driver> + Send>,
    pub probe_timeout: Duration,
    /// Called (from the engine thread) when the status changed; must not block.
    pub on_status: Box<dyn Fn() + Send>,
}

pub struct Worker {
    core: Core,
    clock: Box<dyn Clock>,
    rx: Receiver<Cmd>,
    tx: Sender<Cmd>,
    cfg: Config,
    link: Link,
    generation: u64,
    shared: Arc<Mutex<Shared>>,
    next_deadline: f64,
    frames_sent: u64,
    window_start: f64,
    window_frames: u32,
    fps: f64,
    last_error: Option<String>,
    hires: Option<HighResTimer>,
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Worker {
    pub fn new(
        clock: Box<dyn Clock>,
        rx: Receiver<Cmd>,
        tx: Sender<Cmd>,
        shared: Arc<Mutex<Shared>>,
        cfg: Config,
    ) -> Self {
        let now = clock.now();
        Worker {
            core: Core::new(),
            clock,
            rx,
            tx,
            cfg,
            link: Link::Idle,
            generation: 0,
            shared,
            next_deadline: now,
            frames_sent: 0,
            window_start: now,
            window_frames: 0,
            fps: 0.0,
            last_error: None,
            hires: None,
        }
    }

    /// Runs until `Shutdown` or until every sender is gone.
    pub fn run(mut self) {
        while self.step() {}
    }

    fn period(&self) -> f64 {
        match &self.link {
            Link::Connected { driver, .. } => driver.period(),
            _ => PERIOD,
        }
    }

    /// One wait + (a command or a frame). Returns false when the engine must stop.
    pub fn step(&mut self) -> bool {
        match self.clock.wait(&self.rx, self.next_deadline) {
            Wait::Cmd(Cmd::Shutdown) | Wait::Closed => return false,
            Wait::Cmd(c) => {
                let now = self.clock.now();
                self.core.advance(now);
                self.handle(c, now);
                self.publish(None);
                return true;
            }
            Wait::Deadline => {}
        }
        let now = self.clock.now();
        self.tick(now);
        let period = self.period();
        self.next_deadline += period;
        if self.next_deadline <= now {
            // Late (the computer stalled): no burst of catch-up frames, carry on from now.
            self.next_deadline = now + period;
        }
        true
    }

    fn tick(&mut self, now: f64) {
        self.core.advance(now);
        let frame = self.core.frame();
        self.send(&frame, now);
        self.maybe_reconnect(now);
        if now - self.window_start >= 1.0 {
            self.fps = self.window_frames as f64 / (now - self.window_start);
            self.window_start = now;
            self.window_frames = 0;
        }
        self.publish(Some(&frame));
    }

    fn send(&mut self, frame: &Universe, now: f64) {
        let Link::Connected { driver, device, .. } = &mut self.link else {
            return;
        };
        match driver.send(frame, now) {
            Ok(()) => {
                self.frames_sent += 1;
                self.window_frames += 1;
            }
            Err(e) => {
                let kind = driver.kind();
                log_line(&format!("output lost: {e}"));
                self.last_error = Some(e);
                match device.take() {
                    Some(device) => {
                        self.link = Link::Lost {
                            device,
                            kind,
                            since_ms: epoch_ms(),
                            attempts: 0,
                            next_try: now + RETRY_EVERY,
                            busy: false,
                        };
                    }
                    None => {
                        self.link = Link::Error(LinkError::new(
                            ErrorCode::OpenFailed,
                            self.last_error.clone().unwrap_or_default(),
                        ));
                        self.hires = None;
                    }
                }
                self.fps = 0.0;
                self.update_status();
            }
        }
    }

    fn maybe_reconnect(&mut self, now: f64) {
        let Link::Lost {
            device,
            kind,
            attempts,
            next_try,
            busy,
            ..
        } = &mut self.link
        else {
            return;
        };
        if *busy || now < *next_try {
            return;
        }
        *busy = true;
        *attempts += 1;
        *next_try = now + RETRY_EVERY;
        let (device, kind) = (device.clone(), *kind);
        let backend = self.cfg.backend.clone();
        let tx = self.tx.clone();
        let generation = self.generation;
        let timeout = self.cfg.probe_timeout;
        (self.cfg.spawn)(Box::new(move || {
            let result = reopen(backend.as_ref(), &device, kind, timeout);
            let _ = tx.send(Cmd::Opened { generation, result });
        }));
        self.update_status();
    }

    fn handle(&mut self, cmd: Cmd, now: f64) {
        match cmd {
            Cmd::Connect(req) => self.connect(req),
            Cmd::Disconnect => {
                self.generation += 1;
                self.link = Link::Idle;
                self.hires = None;
                self.fps = 0.0;
                self.update_status();
            }
            Cmd::Opened { generation, result } => {
                if generation != self.generation {
                    return; // an abandoned attempt: its port closes here
                }
                match result {
                    Ok(o) => {
                        log_line(&format!(
                            "connected: {:?} {}",
                            o.driver.kind(),
                            o.device.as_ref().map(|d| d.port.as_str()).unwrap_or("")
                        ));
                        if o.driver.kind() != Kind::Simulated && self.hires.is_none() {
                            self.hires = HighResTimer::begin();
                        }
                        self.link = Link::Connected {
                            driver: o.driver,
                            device: o.device,
                            detail: o.detail,
                        };
                        self.window_start = now;
                        self.window_frames = 0;
                        self.update_status();
                        // The whole current state at once (also after a reconnection).
                        let frame = self.core.frame();
                        self.send(&frame, now);
                        self.next_deadline = now + self.period();
                    }
                    Err(e) => {
                        if let Link::Lost { busy, .. } = &mut self.link {
                            *busy = false;
                            self.last_error = Some(e.message);
                        } else {
                            log_line(&format!("connection failed: {}", e.message));
                            self.last_error = Some(e.message.clone());
                            self.link = Link::Error(e);
                            self.hires = None;
                        }
                        self.update_status();
                    }
                }
            }
            Cmd::SetUniverse(v) => self.core.set_universe(&v),
            Cmd::FadeTo {
                target,
                transition,
                layout,
                id,
            } => {
                self.core.fade_to(&target, transition, layout, id);
            }
            Cmd::Pause => self.core.pause(),
            Cmd::Resume => self.core.resume(),
            Cmd::StopFade => self.core.stop_fade(),
            Cmd::Blackout(on) => self.core.set_blackout(on),
            Cmd::FadeToBlack(s) => self.core.fade_to_black(s),
            Cmd::ReleaseBlack(s) => self.core.release_black(s),
            Cmd::GrandMaster { level, mask } => {
                if let Some(m) = mask {
                    self.core.set_intensity_mask(&m);
                }
                self.core.set_grand_master(level);
            }
            Cmd::Test(Some((n, level))) => self.core.start_test(n, level),
            Cmd::Test(None) => self.core.stop_test(),
            Cmd::Shutdown => {}
        }
    }

    fn connect(&mut self, req: ConnectRequest) {
        self.generation += 1;
        self.fps = 0.0;
        self.link = Link::Connecting; // the previous port (if any) closes here
        self.update_status();
        let generation = self.generation;
        if req == ConnectRequest::Simulated {
            let driver = (self.cfg.make_sim)();
            let _ = self.tx.send(Cmd::Opened {
                generation,
                result: Ok(Opened {
                    driver,
                    device: None,
                    detail: None,
                }),
            });
            return;
        }
        let backend = self.cfg.backend.clone();
        let tx = self.tx.clone();
        let timeout = self.cfg.probe_timeout;
        (self.cfg.spawn)(Box::new(move || {
            let result = match req {
                ConnectRequest::Auto { prefer, kind } => {
                    connect_auto(backend.as_ref(), prefer.as_deref(), kind, timeout)
                }
                ConnectRequest::Port { port, kind } => {
                    connect_port(backend.as_ref(), &port, kind, timeout)
                }
                ConnectRequest::Simulated => unreachable!("handled above"),
            };
            let _ = tx.send(Cmd::Opened { generation, result });
        }));
    }

    fn status(&self) -> Status {
        let (link, device, detail) = match &self.link {
            Link::Idle => (LinkState::Idle, None, None),
            Link::Connecting => (LinkState::Connecting, None, None),
            Link::Connected {
                driver,
                device,
                detail,
            } => {
                if driver.kind() == Kind::Simulated {
                    (LinkState::Simulated, None, None)
                } else {
                    let name = device.as_ref().map(|d| d.name.clone()).unwrap_or_default();
                    (
                        LinkState::Connected {
                            device: name,
                            kind: driver.kind(),
                        },
                        device.clone(),
                        detail.clone(),
                    )
                }
            }
            Link::Lost {
                device,
                kind,
                since_ms,
                attempts,
                ..
            } => (
                LinkState::Lost {
                    device: device.name.clone(),
                    kind: *kind,
                    since_ms: *since_ms,
                    attempts: *attempts,
                },
                Some(device.clone()),
                None,
            ),
            Link::Error(e) => (
                LinkState::Error {
                    code: e.code,
                    message: e.message.clone(),
                },
                None,
                None,
            ),
        };
        Status {
            link,
            device,
            detail,
            last_error: self.last_error.clone(),
        }
    }

    fn update_status(&mut self) {
        let st = self.status();
        let changed = {
            let Ok(mut sh) = self.shared.lock() else {
                return;
            };
            if sh.status != st {
                sh.status = st;
                sh.status_seq += 1;
                true
            } else {
                false
            }
        };
        if changed {
            (self.cfg.on_status)();
        }
    }

    fn publish(&mut self, frame: Option<&Universe>) {
        let live = Live {
            fade: self.core.fade_state(),
            master: self.core.master_state(),
            test: self.core.test_state(),
            fps: if matches!(self.link, Link::Connected { .. }) {
                self.fps
            } else {
                0.0
            },
            frames_sent: self.frames_sent,
        };
        let under = frame.map(|_| self.core.playback_now());
        let Ok(mut sh) = self.shared.lock() else {
            return;
        };
        sh.live = live;
        if let (Some(f), Some(u)) = (frame, under)
            && (sh.output != *f || sh.under != u)
        {
            sh.output = *f;
            sh.under = u;
            sh.output_seq += 1;
        }
    }
}

// ---------------- Connection jobs (run outside the engine loop) ----------------

fn driver_for(kind: Kind, port: Box<dyn super::driver::DmxPort>) -> Box<dyn Driver> {
    match kind {
        Kind::Pro => Box::new(ProDriver::new(port)),
        Kind::Open => Box::new(OpenDmxDriver::new(port)),
        Kind::Simulated => Box::new(SimDriver),
    }
}

/// Opens `port` as `kind`. A Pro is asked for its firmware and serial number (for the
/// Settings), but one that does not answer is used anyway: the user chose it.
pub fn connect_port(
    backend: &dyn Backend,
    port: &str,
    kind: Kind,
    timeout: Duration,
) -> Result<Opened, LinkError> {
    let list = backend.list();
    let device = list.iter().find(|d| d.port == port).cloned();
    let mut p = backend.open(port)?;
    let mut detail = None;
    if kind == Kind::Pro {
        detail = probe_pro(p.as_mut(), timeout)
            .ok()
            .flatten()
            .and_then(|i| i.describe());
    }
    let device = device.unwrap_or_else(|| super::discovery::describe(port, None));
    Ok(Opened {
        driver: driver_for(kind, p),
        device: Some(device),
        detail,
    })
}

/// Automatic recognition (see `ConnectRequest::Auto`). Only Pro-looking devices and FTDI
/// chips are tried (plus the preferred port), so other serial devices are never written to.
pub fn connect_auto(
    backend: &dyn Backend,
    prefer: Option<&str>,
    forced: Option<Kind>,
    timeout: Duration,
) -> Result<Opened, LinkError> {
    let list = backend.list();
    let mut cands: Vec<&DeviceInfo> = list
        .iter()
        .filter(|d| matches!(d.guess, Guess::Pro | Guess::Ftdi) || Some(d.port.as_str()) == prefer)
        .collect();
    cands.sort_by_key(|d| (Some(d.port.as_str()) != prefer, d.guess != Guess::Pro));
    if cands.is_empty() {
        return Err(LinkError::new(ErrorCode::NoCable, "no USB-DMX cable found"));
    }
    if let Some(kind) = forced {
        return connect_port(backend, &cands[0].port, kind, timeout);
    }
    let mut last_err: Option<LinkError> = None;
    let mut openable: Vec<&DeviceInfo> = Vec::new();
    for d in &cands {
        let mut p = match backend.open(&d.port) {
            Ok(p) => p,
            Err(e) => {
                last_err = Some(e);
                continue;
            }
        };
        match probe_pro(p.as_mut(), timeout) {
            Ok(Some(info)) => {
                return Ok(Opened {
                    driver: Box::new(ProDriver::new(p)),
                    device: Some((*d).clone()),
                    detail: info.describe(),
                });
            }
            Ok(None) => openable.push(d),
            Err(e) => {
                last_err = Some(LinkError::new(
                    ErrorCode::OpenFailed,
                    format!("{}: {e}", d.port),
                ))
            }
        }
    }
    // Nobody answered as a Pro: a device whose name says Pro is still a Pro (a quiet clone);
    // otherwise the first FTDI chip is an Open DMX.
    let pick = openable
        .iter()
        .find(|d| d.guess == Guess::Pro)
        .map(|d| (*d, Kind::Pro))
        .or_else(|| openable.first().map(|d| (*d, Kind::Open)));
    match pick {
        Some((d, kind)) => {
            let p = backend.open(&d.port)?;
            Ok(Opened {
                driver: driver_for(kind, p),
                device: Some(d.clone()),
                detail: None,
            })
        }
        None => Err(last_err
            .unwrap_or_else(|| LinkError::new(ErrorCode::NoCable, "no USB-DMX cable found"))),
    }
}

/// After a loss: the same device (by identity) opened again as the same family.
pub fn reopen(
    backend: &dyn Backend,
    device: &DeviceInfo,
    kind: Kind,
    _timeout: Duration,
) -> Result<Opened, LinkError> {
    let list = backend.list();
    let Some(found) = find_again(&list, device) else {
        return Err(LinkError::new(
            ErrorCode::NotFound,
            format!("{} is not connected", device.name),
        ));
    };
    let p = backend.open(&found.port)?;
    Ok(Opened {
        driver: driver_for(kind, p),
        device: Some(found.clone()),
        detail: None,
    })
}
