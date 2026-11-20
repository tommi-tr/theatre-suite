//! The DMX output engine of the Theatre Suite (Granvelo; Cue). No Tauri here: events go
//! through an [`EventSink`] given by the app.
//!
//! Threads:
//! - **engine** (`engine.rs`): owns the universe, computes fades and the output master,
//!   sends a frame every 25 ms (33 ms with Open DMX) to the driver; never waits for the UI;
//! - **connect** (short-lived): opens and probes ports, so the engine keeps its cadence;
//! - **publisher** (here): reads the engine's snapshot and sends events to the sink —
//!   `dmx-status` at once when the connection changes, `dmx-progress` (fade, output master,
//!   test, frames per second) at most 10 times a second, `dmx-output` (the 512 values on the
//!   cable and under the output master) at most 20 times a second, only when they change.
//!
//! Nothing is sent before [`DmxEngine::connect`]. Universe number: always 1 for now (the
//! commands carry 512 values; a `universe` field can be added when a second one arrives).
//!
//! Only one program at a time can hold a DMX port: if another one has it, connecting ends in
//! [`engine::LinkState::Error`] with [`discovery::ErrorCode::Busy`].

pub mod core;
pub mod discovery;
pub mod driver;
pub mod engine;
pub mod fade;
mod hires;
#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;

use discovery::{Backend, DeviceInfo, SystemBackend, log_line};
use driver::SimDriver;
use engine::{
    Cmd, Config, ConnectRequest, Live, PROBE_TIMEOUT, RealClock, Shared, Status, Worker,
    thread_spawner,
};
use fade::{Layout, Transition, UNIVERSE};

/// Where the engine sends its events: `(event name, JSON payload)`. The app forwards them to
/// its interface (in a Tauri app: `app.emit(event, payload)`). Called from the engine's
/// publisher thread: it must return quickly and never block.
pub type EventSink = Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>;

/// The running engine (one per program: it owns the DMX port while connected).
pub struct DmxEngine {
    tx: Mutex<Sender<Cmd>>,
    shared: Arc<Mutex<Shared>>,
    next_fade_id: AtomicU64,
    backend: Arc<dyn Backend>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub status: Status,
    pub live: Live,
    pub output: Vec<u8>,
    pub under: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputEvent<'a> {
    output: &'a [u8],
    under: &'a [u8],
}

/// The only universe for now. Commands that carry values take an optional `universe`
/// (default 1), so a second one can arrive without changing the interface.
pub const UNIVERSE_NUMBER: u16 = 1;

/// `Ok` for the universe that exists (`None` = universe 1).
pub fn check_universe(universe: Option<u16>) -> Result<(), String> {
    match universe.unwrap_or(UNIVERSE_NUMBER) {
        UNIVERSE_NUMBER => Ok(()),
        u => Err(format!(
            "DMX universe {u} does not exist (only universe {UNIVERSE_NUMBER})"
        )),
    }
}

/// Seconds from the interface: `null` (NaN or Infinity in JavaScript) counts as 0, the rest is
/// cleaned by the engine (negative → 0, capped at 24 h).
pub fn seconds(s: Option<f64>) -> f64 {
    fade::clean_seconds(s.unwrap_or(0.0))
}

impl DmxEngine {
    /// Starts the threads. Nothing is opened and nothing is sent until [`DmxEngine::connect`].
    pub fn start(sink: EventSink) -> Self {
        let (tx, rx) = mpsc::channel::<Cmd>();
        let (note_tx, note_rx) = mpsc::channel::<()>();
        let shared = Arc::new(Mutex::new(Shared::new()));
        let backend: Arc<dyn Backend> = Arc::new(SystemBackend);
        let cfg = Config {
            backend: backend.clone(),
            spawn: thread_spawner(),
            make_sim: Box::new(|| Box::new(SimDriver)),
            probe_timeout: PROBE_TIMEOUT,
            on_status: Box::new(move || {
                let _ = note_tx.send(());
            }),
        };
        let worker = Worker::new(
            Box::new(RealClock::new()),
            rx,
            tx.clone(),
            shared.clone(),
            cfg,
        );
        let spawned = std::thread::Builder::new()
            .name("granvelo-dmx".into())
            .spawn(move || {
                // A bug in the engine never takes the app down: the supervisor reports it to
                // the interface and restarts the engine with the last values (engine.rs).
                let mut worker = worker;
                worker.run_supervised();
            });
        if let Err(e) = spawned {
            log_line(&format!("cannot start the DMX engine: {e}"));
            let mut sh = shared.lock().unwrap_or_else(PoisonError::into_inner);
            sh.status.link = engine::LinkState::Error {
                code: discovery::ErrorCode::EngineStopped,
                message: format!("cannot start the DMX engine: {e}"),
            };
            sh.status_seq += 1;
        }
        let sh = shared.clone();
        let publisher = std::thread::Builder::new()
            .name("granvelo-dmx-events".into())
            .spawn(move || publish_loop(sink, sh, note_rx));
        if let Err(e) = publisher {
            log_line(&format!("cannot start the DMX events: {e}"));
        }
        DmxEngine {
            tx: Mutex::new(tx),
            shared,
            next_fade_id: AtomicU64::new(1),
            backend,
        }
    }

    fn send(&self, cmd: Cmd) -> Result<(), String> {
        let tx = self
            .tx
            .lock()
            .map_err(|_| "DMX engine unavailable".to_string())?;
        tx.send(cmd)
            .map_err(|_| "The DMX engine is not running".to_string())
    }

    /// Stops the engine thread (app exit). Nothing is sent: the lights stay as they are.
    pub fn shutdown(&self) {
        let _ = self.send(Cmd::Shutdown);
    }

    /// Connection, progress and the values on the cable, right now.
    pub fn snapshot(&self) -> Result<Snapshot, String> {
        let sh = self.shared.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(Snapshot {
            status: sh.status.clone(),
            live: sh.live.clone(),
            output: sh.output.to_vec(),
            under: sh.under.to_vec(),
        })
    }

    /// The serial ports of this computer, with the engine's guess. It may take a moment:
    /// call it off the interface thread.
    pub fn list_devices(&self) -> Vec<DeviceInfo> {
        self.backend.list()
    }

    /// Opens a cable (or the simulated output) and starts sending. The result arrives as
    /// `dmx-status`; a port held by another program ends in `ErrorCode::Busy`.
    pub fn connect(&self, request: ConnectRequest) -> Result<(), String> {
        self.send(Cmd::Connect(request))
    }

    /// Stops sending and closes the port. No blackout is sent: the lights stay as they are.
    pub fn disconnect(&self) -> Result<(), String> {
        self.send(Cmd::Disconnect)
    }

    /// Immediate values (up to 512; missing ones are 0). Ends a running fade.
    pub fn set_universe(&self, values: Vec<u8>, universe: Option<u16>) -> Result<(), String> {
        check_universe(universe)?;
        self.send(Cmd::SetUniverse(
            values.into_iter().take(UNIVERSE).collect(),
        ))
    }

    /// Starts a transition from the current values to `target` (up to 512 values; missing
    /// ones are 0); returns its id (it appears in `dmx-progress`).
    pub fn fade_to(
        &self,
        target: Vec<u8>,
        transition: Transition,
        layout: Layout,
        universe: Option<u16>,
    ) -> Result<u64, String> {
        check_universe(universe)?;
        let id = self.next_fade_id.fetch_add(1, Ordering::Relaxed);
        self.send(Cmd::FadeTo {
            target: target.into_iter().take(UNIVERSE).collect(),
            transition,
            layout,
            id,
        })?;
        Ok(id)
    }

    /// Freezes the running fade where it is.
    pub fn pause(&self) -> Result<(), String> {
        self.send(Cmd::Pause)
    }

    /// Resumes a paused fade.
    pub fn resume(&self) -> Result<(), String> {
        self.send(Cmd::Resume)
    }

    /// Ends the running fade where it is.
    pub fn stop_fade(&self) -> Result<(), String> {
        self.send(Cmd::StopFade)
    }

    /// Blackout on/off (immediate, on the output master).
    pub fn blackout(&self, on: bool) -> Result<(), String> {
        self.send(Cmd::Blackout(on))
    }

    /// Takes the output master to 0 in `seconds` (see [`seconds`]).
    pub fn fade_to_black(&self, seconds: f64) -> Result<(), String> {
        self.send(Cmd::FadeToBlack(fade::clean_seconds(seconds)))
    }

    /// Brings the output master back after a Fade to black, in `seconds`.
    pub fn release_black(&self, seconds: f64) -> Result<(), String> {
        self.send(Cmd::ReleaseBlack(fade::clean_seconds(seconds)))
    }

    /// Grand Master 0–255 on the intensity channels; `mask` (512 × 0/1) replaces the intensity mask.
    pub fn grand_master(
        &self,
        level: u8,
        mask: Option<Vec<u8>>,
        universe: Option<u16>,
    ) -> Result<(), String> {
        check_universe(universe)?;
        self.send(Cmd::GrandMaster { level, mask })
    }

    /// The test pattern: channels 1…`channels` (default 24) one at a time up to `level`
    /// (default 128). It replaces the whole output (Blackout, Fade to black and Grand Master
    /// do not apply to it). `on = false` ends it.
    pub fn test_output(
        &self,
        on: bool,
        channels: Option<u16>,
        level: Option<u8>,
    ) -> Result<(), String> {
        let cmd = if on {
            Cmd::Test(Some((
                channels.unwrap_or(24).clamp(1, UNIVERSE as u16) as usize,
                level.unwrap_or(128),
            )))
        } else {
            Cmd::Test(None)
        };
        self.send(cmd)
    }
}

fn emit<T: Serialize>(sink: &EventSink, event: &str, payload: &T) {
    if let Ok(value) = serde_json::to_value(payload) {
        sink(event, value);
    }
}

fn publish_loop(sink: EventSink, shared: Arc<Mutex<Shared>>, notes: mpsc::Receiver<()>) {
    let mut last_status_seq = u64::MAX;
    let mut last_output_seq = u64::MAX;
    let mut last_live: Option<Live> = None;
    let mut last_progress = Instant::now() - Duration::from_secs(1);
    let mut last_output = Instant::now() - Duration::from_secs(1);
    while !matches!(
        notes.recv_timeout(Duration::from_millis(50)),
        Err(RecvTimeoutError::Disconnected)
    ) {
        let sh = shared.lock().unwrap_or_else(PoisonError::into_inner);
        // Status: at once.
        let status = (sh.status_seq != last_status_seq).then(|| sh.status.clone());
        last_status_seq = sh.status_seq;
        // Progress and frame rate: ≤ 10 Hz, when they change.
        let live = (last_progress.elapsed() >= Duration::from_millis(100)
            && last_live.as_ref() != Some(&sh.live))
        .then(|| sh.live.clone());
        // Output values: ≤ 20 Hz, when they change.
        let output = (last_output.elapsed() >= Duration::from_millis(50)
            && sh.output_seq != last_output_seq)
            .then(|| (sh.output.to_vec(), sh.under.to_vec()));
        if output.is_some() {
            last_output_seq = sh.output_seq;
        }
        drop(sh);
        if let Some(s) = status {
            emit(&sink, "dmx-status", &s);
        }
        if let Some(l) = live {
            last_progress = Instant::now();
            emit(&sink, "dmx-progress", &l);
            last_live = Some(l);
        }
        if let Some((o, u)) = output {
            last_output = Instant::now();
            emit(
                &sink,
                "dmx-output",
                &OutputEvent {
                    output: &o,
                    under: &u,
                },
            );
        }
    }
}

#[cfg(test)]
mod command_tests {
    use super::*;

    #[test]
    fn only_universe_1_exists_and_null_seconds_are_zero() {
        assert!(check_universe(None).is_ok());
        assert!(check_universe(Some(1)).is_ok());
        assert!(check_universe(Some(2)).is_err());
        assert_eq!(seconds(None), 0.0);
        assert_eq!(seconds(Some(-4.0)), 0.0);
        assert_eq!(seconds(Some(f64::INFINITY)), fade::MAX_SECONDS);
    }
}
