//! Tests of the engine thread with a fake clock (no real sleeps), fake ports and a Recorder.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::core::Universe;
use super::discovery::{Backend, DeviceInfo, ErrorCode, LinkError, describe};
use super::driver::testport::{FakePort, PortLog};
use super::driver::{DmxPort, Kind, OPEN_PERIOD, PERIOD, Recorder, Recording};
use super::engine::*;
use super::fade::{Layout, Transition, UNIVERSE};

// ---------------- Fakes ----------------

/// Time moves only when the engine waits: straight to the deadline (plus injected stalls).
struct FakeClock {
    t: Arc<Mutex<f64>>,
    /// (at, extra): the first wait reaching `at` arrives `extra` seconds late.
    stalls: Arc<Mutex<VecDeque<(f64, f64)>>>,
}

impl Clock for FakeClock {
    fn now(&self) -> f64 {
        *self.t.lock().unwrap()
    }

    fn wait(&mut self, rx: &Receiver<Cmd>, until: f64) -> Wait {
        match rx.try_recv() {
            Ok(c) => Wait::Cmd(c),
            Err(TryRecvError::Disconnected) => Wait::Closed,
            Err(TryRecvError::Empty) => {
                let mut t = self.t.lock().unwrap();
                if *t < until {
                    *t = until;
                }
                let mut stalls = self.stalls.lock().unwrap();
                if let Some(&(at, extra)) = stalls.front()
                    && *t >= at
                {
                    *t += extra;
                    stalls.pop_front();
                }
                Wait::Deadline
            }
        }
    }
}

#[derive(Default)]
struct FakeBackend {
    devices: Mutex<Vec<DeviceInfo>>,
    /// Ports that answer the Pro detection.
    pro_ports: Mutex<Vec<String>>,
    /// Every port opened, in order: (port name, its log).
    opened: Mutex<Vec<(String, Arc<PortLog>)>>,
    opens: AtomicUsize,
}

impl FakeBackend {
    fn last_log(&self) -> Arc<PortLog> {
        self.opened
            .lock()
            .unwrap()
            .last()
            .expect("a port was opened")
            .1
            .clone()
    }
}

impl Backend for FakeBackend {
    fn list(&self) -> Vec<DeviceInfo> {
        self.devices.lock().unwrap().clone()
    }

    fn open(&self, port: &str) -> Result<Box<dyn DmxPort>, LinkError> {
        self.opens.fetch_add(1, Ordering::SeqCst);
        if !self.devices.lock().unwrap().iter().any(|d| d.port == port) {
            return Err(LinkError::new(
                ErrorCode::NotFound,
                format!("{port} not found"),
            ));
        }
        let log = Arc::new(PortLog::default());
        self.opened
            .lock()
            .unwrap()
            .push((port.to_string(), log.clone()));
        let pro = self.pro_ports.lock().unwrap().iter().any(|p| p == port);
        Ok(Box::new(FakePort::new(log, pro)))
    }
}

fn ftdi(port: &str, serial: &str) -> DeviceInfo {
    describe(
        port,
        Some((
            0x0403,
            0x6001,
            Some(serial.into()),
            Some("FTDI".into()),
            Some("USB Serial Port".into()),
        )),
    )
}

struct Rig {
    worker: Worker,
    tx: Sender<Cmd>,
    shared: Arc<Mutex<Shared>>,
    backend: Arc<FakeBackend>,
    time: Arc<Mutex<f64>>,
    stalls: Arc<Mutex<VecDeque<(f64, f64)>>>,
    recording: Recording,
    status_notes: Arc<AtomicUsize>,
}

impl Rig {
    fn new(devices: Vec<DeviceInfo>, pro_ports: &[&str]) -> Rig {
        let (tx, rx) = mpsc::channel();
        let shared = Arc::new(Mutex::new(Shared::new()));
        let backend = Arc::new(FakeBackend::default());
        *backend.devices.lock().unwrap() = devices;
        *backend.pro_ports.lock().unwrap() = pro_ports.iter().map(|s| s.to_string()).collect();
        let time = Arc::new(Mutex::new(0.0));
        let stalls = Arc::new(Mutex::new(VecDeque::new()));
        let (rec, recording) = Recorder::new(Kind::Simulated);
        let rec = Mutex::new(Some(rec));
        let status_notes = Arc::new(AtomicUsize::new(0));
        let notes = status_notes.clone();
        let cfg = Config {
            backend: backend.clone(),
            // Jobs run inline: their result is in the channel before the next wait.
            spawn: Arc::new(|job| job()),
            make_sim: Box::new(move || {
                Box::new(
                    rec.lock()
                        .unwrap()
                        .take()
                        .expect("one simulated connection per test"),
                )
            }),
            probe_timeout: Duration::from_millis(5),
            on_status: Box::new(move || {
                notes.fetch_add(1, Ordering::SeqCst);
            }),
        };
        let clock = FakeClock {
            t: time.clone(),
            stalls: stalls.clone(),
        };
        let worker = Worker::new(Box::new(clock), rx, tx.clone(), shared.clone(), cfg);
        Rig {
            worker,
            tx,
            shared,
            backend,
            time,
            stalls,
            recording,
            status_notes,
        }
    }

    fn now(&self) -> f64 {
        *self.time.lock().unwrap()
    }

    fn cmd(&self, c: Cmd) {
        self.tx.send(c).unwrap();
    }

    /// Runs the engine until `t` (fake seconds).
    fn run_until(&mut self, t: f64) {
        while self.now() < t {
            assert!(self.worker.step());
        }
    }

    /// Handles the commands already sent (no time passes).
    fn settle(&mut self) {
        let t = self.now();
        self.run_until(t + 1e-9);
    }

    fn link(&self) -> LinkState {
        self.shared.lock().unwrap().status.link.clone()
    }

    fn output(&self) -> Universe {
        self.shared.lock().unwrap().output
    }
}

fn uni(pairs: &[(usize, u8)]) -> Vec<u8> {
    let mut u = vec![0u8; UNIVERSE];
    for &(i, v) in pairs {
        u[i] = v;
    }
    u
}

/// The 512 values inside a Pro "send DMX" message.
fn pro_values(msg: &[u8]) -> &[u8] {
    assert_eq!(&msg[..5], &[0x7E, 6, 0x01, 0x02, 0]);
    &msg[5..517]
}

// ---------------- Tests ----------------

#[test]
fn nothing_is_sent_before_connect() {
    let mut r = Rig::new(vec![ftdi("COM3", "A1")], &["COM3"]);
    r.cmd(Cmd::SetUniverse(uni(&[(0, 255)])));
    r.cmd(Cmd::FadeTo {
        target: uni(&[(1, 200)]),
        transition: Transition {
            fade_in: 1.0,
            ..Default::default()
        },
        layout: Layout::all_intensity(UNIVERSE),
        id: 1,
    });
    r.cmd(Cmd::Blackout(true));
    r.cmd(Cmd::Blackout(false));
    r.run_until(3.0);
    assert_eq!(r.backend.opens.load(Ordering::SeqCst), 0, "no port opened");
    assert!(r.recording.lock().unwrap().is_empty());
    assert_eq!(r.link(), LinkState::Idle);
    // The engine still computes, so the interface sees the fade.
    assert_eq!(&r.output()[..2], &[0, 200]);
    assert_eq!(r.shared.lock().unwrap().live.frames_sent, 0);
}

#[test]
fn frames_come_at_40_per_second_without_catch_up_bursts() {
    let mut r = Rig::new(vec![], &[]);
    r.cmd(Cmd::Connect(ConnectRequest::Simulated));
    r.settle();
    assert_eq!(r.link(), LinkState::Simulated);
    r.run_until(2.0);
    let n = r.recording.lock().unwrap().len();
    assert!((79..=82).contains(&n), "{n} frames in 2 s");
    // A stall of 200 ms at t = 2.5 s.
    r.stalls.lock().unwrap().push_back((2.5, 0.2));
    r.run_until(4.0);
    let frames = r.recording.lock().unwrap().clone();
    let gaps: Vec<f64> = frames.windows(2).map(|w| w[1].0 - w[0].0).collect();
    assert!(
        gaps.iter().all(|&g| g >= PERIOD - 1e-9),
        "no two frames closer than one period"
    );
    assert_eq!(
        gaps.iter().filter(|&&g| g > PERIOD + 1e-6).count(),
        1,
        "one long gap: the stall"
    );
    let after: usize = frames.iter().filter(|f| f.0 > 2.8).count();
    assert!(
        (47..=49).contains(&after),
        "after the stall the cadence is steady: {after}"
    );
    r.run_until(5.5);
    let live = r.shared.lock().unwrap().live.clone();
    assert!((live.fps - 40.0).abs() < 1.5, "fps {}", live.fps);
    assert_eq!(live.frames_sent as usize, r.recording.lock().unwrap().len());
}

#[test]
fn the_first_frame_after_connect_is_the_current_state() {
    let mut r = Rig::new(vec![], &[]);
    r.cmd(Cmd::SetUniverse(uni(&[(9, 99)])));
    r.run_until(0.5);
    r.cmd(Cmd::Connect(ConnectRequest::Simulated));
    // Two commands (Connect, then the opened driver), no tick in between.
    assert!(r.worker.step());
    assert!(r.worker.step());
    let frames = r.recording.lock().unwrap().clone();
    assert_eq!(frames.len(), 1, "sent at once, not at the next tick");
    assert!(frames[0].0 >= 0.5);
    assert_eq!(frames[0].1[9], 99);
}

#[test]
fn auto_connect_finds_a_pro_by_asking_it() {
    let mut r = Rig::new(
        vec![
            describe("COM1", None),
            ftdi("COM3", "A1"),
            ftdi("COM4", "B2"),
        ],
        &["COM4"],
    );
    r.cmd(Cmd::Connect(ConnectRequest::Auto {
        prefer: None,
        kind: None,
    }));
    r.settle();
    assert_eq!(
        r.link(),
        LinkState::Connected {
            device: "FTDI FT232R / FT245R".into(),
            kind: Kind::Pro
        }
    );
    let st = r.shared.lock().unwrap().status.clone();
    assert_eq!(st.device.unwrap().port, "COM4");
    assert_eq!(
        st.detail.as_deref(),
        Some("firmware 1.44 · serial 12345678")
    );
    assert!(
        r.backend
            .opened
            .lock()
            .unwrap()
            .iter()
            .all(|(p, _)| p != "COM1"),
        "a port that is not a DMX cable is never written to"
    );
}

#[test]
fn auto_connect_falls_back_to_open_dmx_for_a_silent_ftdi_chip() {
    let mut r = Rig::new(vec![ftdi("COM3", "A1")], &[]);
    r.cmd(Cmd::Connect(ConnectRequest::Auto {
        prefer: None,
        kind: None,
    }));
    r.settle();
    assert!(matches!(
        r.link(),
        LinkState::Connected {
            kind: Kind::Open,
            ..
        }
    ));
    r.run_until(1.0);
    let log = r.backend.last_log();
    let w = log.writes();
    // Frames at 0, 1/30, … up to the first deadline ≥ 1 s: 31 or 32.
    assert!(
        (31..=32).contains(&w.len()),
        "30 frames per second with Open DMX: {}",
        w.len()
    );
    assert!(w.iter().all(|f| f.len() == 513 && f[0] == 0));
    r.run_until(1.5);
    assert!((r.shared.lock().unwrap().live.fps - 1.0 / OPEN_PERIOD).abs() < 1.5);
}

#[test]
fn auto_connect_without_a_cable_says_so() {
    let mut r = Rig::new(
        vec![
            describe("COM1", None),
            describe("COM5", Some((0x1A86, 0x7523, None, None, None))),
        ],
        &[],
    );
    r.cmd(Cmd::Connect(ConnectRequest::Auto {
        prefer: None,
        kind: None,
    }));
    r.settle();
    assert!(matches!(
        r.link(),
        LinkState::Error {
            code: ErrorCode::NoCable,
            ..
        }
    ));
    assert_eq!(r.backend.opens.load(Ordering::SeqCst), 0);
    // The user can still choose that adapter by hand.
    r.cmd(Cmd::Connect(ConnectRequest::Port {
        port: "COM5".into(),
        kind: Kind::Open,
    }));
    r.settle();
    assert!(matches!(
        r.link(),
        LinkState::Connected {
            kind: Kind::Open,
            ..
        }
    ));
}

#[test]
fn a_forced_family_is_used_as_chosen() {
    let mut r = Rig::new(vec![ftdi("COM3", "A1")], &["COM3"]);
    r.cmd(Cmd::Connect(ConnectRequest::Auto {
        prefer: None,
        kind: Some(Kind::Open),
    }));
    r.settle();
    assert!(matches!(
        r.link(),
        LinkState::Connected {
            kind: Kind::Open,
            ..
        }
    ));
    // A quiet Pro clone chosen by hand is driven as a Pro.
    let mut r = Rig::new(vec![ftdi("COM3", "A1")], &[]);
    r.cmd(Cmd::Connect(ConnectRequest::Port {
        port: "COM3".into(),
        kind: Kind::Pro,
    }));
    r.settle();
    assert!(matches!(
        r.link(),
        LinkState::Connected {
            kind: Kind::Pro,
            ..
        }
    ));
}

#[test]
fn a_missing_port_is_an_error_not_a_crash() {
    let mut r = Rig::new(vec![], &[]);
    r.cmd(Cmd::Connect(ConnectRequest::Port {
        port: "COM9".into(),
        kind: Kind::Pro,
    }));
    r.settle();
    assert!(matches!(
        r.link(),
        LinkState::Error {
            code: ErrorCode::NotFound,
            ..
        }
    ));
    r.run_until(2.0);
    assert!(
        matches!(r.link(), LinkState::Error { .. }),
        "no automatic retries for a failed connection"
    );
}

#[test]
fn a_pulled_cable_is_lost_then_found_again_and_gets_the_whole_state() {
    let mut r = Rig::new(vec![ftdi("COM3", "A1")], &["COM3"]);
    r.cmd(Cmd::Connect(ConnectRequest::Auto {
        prefer: None,
        kind: None,
    }));
    r.cmd(Cmd::SetUniverse(uni(&[(0, 10), (511, 42)])));
    r.run_until(0.5);
    let first = r.backend.last_log();
    assert!(first.writes().len() > 10);
    // A fade starts, then the cable is pulled out.
    r.cmd(Cmd::FadeTo {
        target: uni(&[(0, 250), (511, 42)]),
        transition: Transition {
            fade_in: 2.0,
            fade_out: 2.0,
            ..Default::default()
        },
        layout: Layout::all_intensity(UNIVERSE),
        id: 5,
    });
    r.run_until(0.6);
    first.broken.store(true, Ordering::SeqCst);
    r.backend.devices.lock().unwrap().clear();
    r.run_until(0.7);
    assert!(matches!(
        r.link(),
        LinkState::Lost {
            attempts: 0,
            kind: Kind::Pro,
            ..
        }
    ));
    assert!(r.shared.lock().unwrap().status.last_error.is_some());
    r.run_until(3.75);
    let LinkState::Lost { attempts, .. } = r.link() else {
        panic!("still lost")
    };
    assert!(
        (3..=4).contains(&attempts),
        "about one attempt per second: {attempts}"
    );
    // Plugged back in: another port name, same serial number.
    r.backend.devices.lock().unwrap().push(ftdi("COM7", "A1"));
    let opens_before = r.backend.opened.lock().unwrap().len();
    r.run_until(5.0);
    assert!(matches!(
        r.link(),
        LinkState::Connected {
            kind: Kind::Pro,
            ..
        }
    ));
    let opened = r.backend.opened.lock().unwrap().clone();
    assert_eq!(opened.len(), opens_before + 1);
    assert_eq!(opened.last().unwrap().0, "COM7");
    let w = opened.last().unwrap().1.writes();
    // The first message on the new port is the whole current state: the fade went on meanwhile.
    let v = pro_values(&w[0]);
    assert_eq!(v[0], 250);
    assert_eq!(v[511], 42);
    assert_eq!(r.shared.lock().unwrap().live.fade.done_id, 5);
}

#[test]
fn disconnect_stops_sending_and_sends_no_blackout() {
    let mut r = Rig::new(vec![ftdi("COM3", "A1")], &["COM3"]);
    r.cmd(Cmd::SetUniverse(uni(&[(0, 180)])));
    r.cmd(Cmd::Connect(ConnectRequest::Auto {
        prefer: None,
        kind: None,
    }));
    r.run_until(0.5);
    let log = r.backend.last_log();
    r.cmd(Cmd::Disconnect);
    r.settle();
    let n = log.writes().len();
    r.run_until(2.0);
    assert_eq!(log.writes().len(), n, "nothing after disconnect");
    assert_eq!(
        pro_values(log.writes().last().unwrap())[0],
        180,
        "the last frame is the state, not a blackout"
    );
    assert_eq!(r.link(), LinkState::Idle);
    assert_eq!(r.shared.lock().unwrap().live.fps, 0.0);
}

#[test]
fn a_late_result_of_an_abandoned_connection_is_dropped() {
    let mut r = Rig::new(vec![ftdi("COM3", "A1")], &["COM3"]);
    r.cmd(Cmd::Connect(ConnectRequest::Auto {
        prefer: None,
        kind: None,
    }));
    r.cmd(Cmd::Disconnect);
    r.run_until(1.0);
    assert_eq!(r.link(), LinkState::Idle);
    let log = r.backend.last_log();
    assert_eq!(log.writes().len(), 2, "only the two detection requests");
}

#[test]
fn engine_commands_reach_the_output() {
    let mut r = Rig::new(vec![], &[]);
    r.cmd(Cmd::Connect(ConnectRequest::Simulated));
    r.cmd(Cmd::SetUniverse(uni(&[(0, 200), (1, 200)])));
    r.cmd(Cmd::GrandMaster {
        level: 0,
        mask: Some(uni(&[(0, 1)])),
    });
    r.run_until(0.2);
    assert_eq!(&r.output()[..2], &[0, 200]);
    assert_eq!(&r.shared.lock().unwrap().under[..2], &[200, 200]);
    r.cmd(Cmd::GrandMaster {
        level: 255,
        mask: None,
    });
    r.cmd(Cmd::FadeTo {
        target: uni(&[]),
        transition: Transition {
            fade_out: 2.0,
            ..Default::default()
        },
        layout: Layout::all_intensity(UNIVERSE),
        id: 9,
    });
    r.run_until(1.2);
    r.cmd(Cmd::Pause);
    r.run_until(3.0);
    let live = r.shared.lock().unwrap().live.clone();
    assert!(live.fade.active && live.fade.paused);
    assert_eq!(live.fade.id, 9);
    assert!(
        (live.fade.progress - 0.5).abs() < 0.02,
        "{}",
        live.fade.progress
    );
    r.cmd(Cmd::Resume);
    r.cmd(Cmd::Blackout(true));
    r.run_until(3.5);
    assert_eq!(r.output()[0], 0);
    r.cmd(Cmd::Blackout(false));
    r.run_until(3.6);
    assert!(r.output()[0] > 0 && r.output()[0] < 100);
    r.cmd(Cmd::StopFade);
    r.cmd(Cmd::Test(Some((4, 128))));
    r.run_until(4.5);
    assert_eq!(
        r.shared.lock().unwrap().live.test.as_ref().map(|t| t.of),
        Some(4)
    );
    let f = r.recording.lock().unwrap().last().unwrap().1.clone();
    assert_eq!(f.iter().filter(|&&v| v > 0).count(), 1);
    r.cmd(Cmd::Test(None));
    r.run_until(4.6);
    assert!(r.shared.lock().unwrap().live.test.is_none());
    assert!(
        r.status_notes.load(Ordering::SeqCst) >= 2,
        "status changes are notified"
    );
}

#[test]
fn shutdown_ends_the_loop() {
    let mut r = Rig::new(vec![], &[]);
    r.cmd(Cmd::Shutdown);
    assert!(!r.worker.step());
}
