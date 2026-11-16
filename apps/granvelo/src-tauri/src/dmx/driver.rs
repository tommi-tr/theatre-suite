//! Drivers: how a frame of 512 values reaches the cable.
//!
//! - **Pro** (Enttec DMX USB Pro, DMXking and clones): the cable has its own processor that
//!   makes the DMX signal; we send it framed messages `0x7E, label, len LSB, len MSB, data…, 0xE7`
//!   (label 6 = "Output Only Send DMX Packet": start code 0 + 512 values). Detection: label 3
//!   "Get Widget Parameters" (firmware) and label 10 "Get Widget Serial Number", with a short timeout.
//! - **Open DMX** (bare FTDI chip, VID 0403 PID 6001 and similar): the computer makes the signal.
//!   250000 baud, 8 data bits, 2 stop bits, no parity. Per frame: break, mark after break, then
//!   start code 0 + 512 values. Timing choices:
//!   * break: line held low for at least `OPEN_BREAK` (200 µs, DMX asks ≥ 92 µs) with a precise
//!     wait (sleep + spin). On the wire the break is usually longer (≈ 1 ms) because set/clear
//!     break are USB control requests served once per USB frame: still well inside DMX limits
//!     (break up to 1 s), and it is the same on Windows whatever the timer resolution;
//!   * mark after break: `OPEN_MAB` (20 µs, DMX asks ≥ 12 µs), same remark;
//!   * cadence: one frame every `OPEN_PERIOD` (1/30 s). A full frame takes 22.6 ms on the line
//!     (513 slots × 11 bits ÷ 250000); at 40 frames/s there would be < 2.5 ms left for break,
//!     MAB and USB latency, and a late break could cut the end of the previous frame. At 30
//!     frames/s there are ≈ 10 ms of margin. As a further guard, a new break is never started
//!     before the previous frame has had time to leave the chip.
//! - **Simulated**: sends nothing (the "Uscita simulata", the reliability test of phase 4).
//! - **Recorder** (tests): records every frame with its time.
//!
//! Both Pro and Open DMX ports are opened with the same line settings (250000 8N2, like QLC+):
//! for a Pro with FT245 or a native USB chip the baud rate is ignored, and clones with a serial
//! link to their processor use 250000.

use std::io;
#[cfg(test)]
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::core::Universe;
use super::fade::UNIVERSE;

/// Family of the cable (or the simulated output).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Pro,
    Open,
    Simulated,
}

/// Frames per second of the engine with Pro and simulated outputs.
pub const PERIOD: f64 = 1.0 / 40.0;
pub const OPEN_PERIOD: f64 = 1.0 / 30.0;
pub const OPEN_BREAK: Duration = Duration::from_micros(200);
pub const OPEN_MAB: Duration = Duration::from_micros(20);
/// Time on the line of start code + 512 slots at 250000 baud, 11 bits each.
pub const OPEN_FRAME_TIME: f64 = (UNIVERSE as f64 + 1.0) * 11.0 / 250_000.0;
pub const BAUD: u32 = 250_000;
/// Open DMX: margin after the previous frame has left the line before a new break (USB latency).
pub const OPEN_GUARD: f64 = 0.003;
/// Longest time one call to the serial driver may block.
pub const PORT_TIMEOUT: Duration = Duration::from_millis(50);

/// The most time a whole frame may take to be handed to the driver: two frame periods, at most
/// 100 ms. Past it the frame write fails and the cable counts as lost (the engine reconnects),
/// so a device that accepts a few bytes at a time can never freeze the engine.
pub fn write_limit(period: f64) -> Duration {
    Duration::from_secs_f64((2.0 * period).min(0.1))
}

/// Seconds on a monotonic clock shared by the whole process.
pub fn mono_now() -> f64 {
    static ORIGIN: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    ORIGIN.get_or_init(Instant::now).elapsed().as_secs_f64()
}

/// Writes `data` with an overall deadline (partial writes and per-call timeouts go on until it).
pub fn write_bounded<W: io::Write + ?Sized>(
    w: &mut W,
    data: &[u8],
    limit: Duration,
) -> io::Result<()> {
    let end = Instant::now() + limit;
    let mut rest = data;
    while !rest.is_empty() {
        match w.write(rest) {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "the device accepts no data",
                ));
            }
            Ok(n) => rest = &rest[n..],
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::Interrupted
                        | io::ErrorKind::TimedOut
                        | io::ErrorKind::WouldBlock
                ) => {}
            Err(e) => return Err(e),
        }
        if !rest.is_empty() && Instant::now() >= end {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!(
                    "frame not written within {} ms ({} bytes left)",
                    limit.as_millis(),
                    rest.len()
                ),
            ));
        }
    }
    Ok(())
}

/// The serial port as the drivers see it (a real port, or a fake one in the tests).
pub trait DmxPort: Send {
    fn write_all(&mut self, data: &[u8]) -> io::Result<()>;
    /// Reads what has arrived; `Ok(0)` when nothing arrived within the port's short timeout.
    fn read_some(&mut self, buf: &mut [u8]) -> io::Result<usize>;
    fn set_break(&mut self, on: bool) -> io::Result<()>;
    /// Waits precisely (break and mark after break).
    fn hold(&mut self, d: Duration);
    fn discard_input(&mut self) {}
    /// Writes one frame within `limit` (see `write_limit`).
    fn write_frame(&mut self, data: &[u8], limit: Duration) -> io::Result<()> {
        let _ = limit;
        self.write_all(data)
    }
    /// The port's clock in seconds (real time; the fake port of the tests has its own).
    fn now(&self) -> f64 {
        mono_now()
    }
}

/// Waits `d` precisely: sleeps for most of it, then spins (≤ 2 ms of spinning).
pub fn precise_wait(d: Duration) {
    let end = Instant::now() + d;
    if d > Duration::from_millis(2) {
        std::thread::sleep(d - Duration::from_millis(2));
    }
    while Instant::now() < end {
        std::hint::spin_loop();
    }
}

/// A real serial port (crate `serialport`; Windows COM ports, Linux ttyUSB/ttyACM).
pub struct SerialDmxPort {
    inner: Box<dyn serialport::SerialPort>,
}

impl SerialDmxPort {
    pub fn open(name: &str) -> Result<Self, serialport::Error> {
        let mut inner = serialport::new(name, BAUD)
            .data_bits(serialport::DataBits::Eight)
            .stop_bits(serialport::StopBits::Two)
            .parity(serialport::Parity::None)
            .flow_control(serialport::FlowControl::None)
            .timeout(PORT_TIMEOUT)
            .open()?;
        // Like QLC+ and OLA: RTS cleared (some Open DMX interfaces use it for the line driver).
        let _ = inner.write_request_to_send(false);
        let _ = inner.clear(serialport::ClearBuffer::All);
        Ok(SerialDmxPort { inner })
    }
}

impl DmxPort for SerialDmxPort {
    fn write_all(&mut self, data: &[u8]) -> io::Result<()> {
        io::Write::write_all(&mut self.inner, data)
    }

    fn read_some(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match io::Read::read(&mut self.inner, buf) {
            Ok(n) => Ok(n),
            Err(e)
                if e.kind() == io::ErrorKind::TimedOut || e.kind() == io::ErrorKind::WouldBlock =>
            {
                Ok(0)
            }
            Err(e) => Err(e),
        }
    }

    fn set_break(&mut self, on: bool) -> io::Result<()> {
        let r = if on {
            self.inner.set_break()
        } else {
            self.inner.clear_break()
        };
        r.map_err(io::Error::from)
    }

    fn hold(&mut self, d: Duration) {
        precise_wait(d);
    }

    fn discard_input(&mut self) {
        let _ = self.inner.clear(serialport::ClearBuffer::Input);
    }

    fn write_frame(&mut self, data: &[u8], limit: Duration) -> io::Result<()> {
        write_bounded(&mut self.inner, data, limit)
    }
}

/// Sends frames to one output.
pub trait Driver: Send {
    fn kind(&self) -> Kind;
    /// Seconds between two frames.
    fn period(&self) -> f64 {
        PERIOD
    }
    /// Sends one frame; `now` is the engine's clock (seconds). An error means the cable is lost.
    fn send(&mut self, frame: &Universe, now: f64) -> Result<(), String>;
}

// ---------------- Pro ----------------

pub const PRO_SOM: u8 = 0x7E;
pub const PRO_EOM: u8 = 0xE7;
pub const LABEL_GET_PARAMS: u8 = 3;
pub const LABEL_SEND_DMX: u8 = 6;
pub const LABEL_GET_SERIAL: u8 = 10;

/// A framed Pro message.
pub fn pro_message(label: u8, data: &[u8]) -> Vec<u8> {
    let len = data.len();
    let mut m = Vec::with_capacity(len + 5);
    m.extend_from_slice(&[
        PRO_SOM,
        label,
        (len & 0xFF) as u8,
        ((len >> 8) & 0xFF) as u8,
    ]);
    m.extend_from_slice(data);
    m.push(PRO_EOM);
    m
}

/// Reads Pro messages from a byte stream (garbage before a message is skipped).
#[derive(Default)]
pub struct ProParser {
    buf: Vec<u8>,
}

impl ProParser {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<(u8, Vec<u8>)> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            match self.buf.iter().position(|&b| b == PRO_SOM) {
                None => {
                    self.buf.clear();
                    break;
                }
                Some(p) if p > 0 => {
                    self.buf.drain(..p);
                }
                _ => {}
            }
            if self.buf.len() < 4 {
                break;
            }
            let len = self.buf[2] as usize | ((self.buf[3] as usize) << 8);
            if len > 600 {
                self.buf.drain(..1);
                continue;
            }
            if self.buf.len() < len + 5 {
                break;
            }
            if self.buf[4 + len] == PRO_EOM {
                out.push((self.buf[1], self.buf[4..4 + len].to_vec()));
                self.buf.drain(..len + 5);
            } else {
                self.buf.drain(..1);
            }
        }
        out
    }
}

/// What a Pro answered to the detection.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProInfo {
    pub firmware: Option<String>,
    pub serial: Option<String>,
}

impl ProInfo {
    pub fn describe(&self) -> Option<String> {
        match (&self.firmware, &self.serial) {
            (Some(f), Some(s)) => Some(format!("firmware {f} · serial {s}")),
            (Some(f), None) => Some(format!("firmware {f}")),
            (None, Some(s)) => Some(format!("serial {s}")),
            (None, None) => None,
        }
    }
}

fn wait_reply(
    port: &mut dyn DmxPort,
    parser: &mut ProParser,
    label: u8,
    timeout: Duration,
) -> io::Result<Option<Vec<u8>>> {
    let end = Instant::now() + timeout;
    let mut buf = [0u8; 256];
    loop {
        let n = port.read_some(&mut buf)?;
        for (l, data) in parser.push(&buf[..n]) {
            if l == label {
                return Ok(Some(data));
            }
        }
        if Instant::now() >= end {
            return Ok(None);
        }
        if n == 0 {
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}

/// Asks the device whether it is a Pro. `None` = no answer within `timeout` (not a Pro, or a
/// clone that does not answer: the user can still choose "Pro" by hand).
pub fn probe_pro(port: &mut dyn DmxPort, timeout: Duration) -> io::Result<Option<ProInfo>> {
    port.discard_input();
    let mut parser = ProParser::default();
    port.write_all(&pro_message(LABEL_GET_PARAMS, &[0, 0]))?;
    let Some(params) = wait_reply(port, &mut parser, LABEL_GET_PARAMS, timeout)? else {
        return Ok(None);
    };
    let mut info = ProInfo::default();
    if params.len() >= 2 {
        info.firmware = Some(format!("{}.{:02}", params[1], params[0]));
    }
    port.write_all(&pro_message(LABEL_GET_SERIAL, &[]))?;
    if let Some(s) = wait_reply(port, &mut parser, LABEL_GET_SERIAL, timeout)?
        && s.len() >= 4
    {
        // 32-bit BCD, least significant byte first.
        info.serial = Some(s[..4].iter().rev().map(|b| format!("{b:02X}")).collect());
    }
    Ok(Some(info))
}

pub struct ProDriver {
    port: Box<dyn DmxPort>,
    msg: Vec<u8>,
}

impl ProDriver {
    pub fn new(port: Box<dyn DmxPort>) -> Self {
        ProDriver {
            port,
            msg: Vec::with_capacity(UNIVERSE + 6),
        }
    }
}

impl Driver for ProDriver {
    fn kind(&self) -> Kind {
        Kind::Pro
    }

    fn send(&mut self, frame: &Universe, _now: f64) -> Result<(), String> {
        self.msg.clear();
        let len = UNIVERSE + 1;
        self.msg.extend_from_slice(&[
            PRO_SOM,
            LABEL_SEND_DMX,
            (len & 0xFF) as u8,
            (len >> 8) as u8,
            0,
        ]);
        self.msg.extend_from_slice(frame);
        self.msg.push(PRO_EOM);
        // Label 6 has no answer: nothing to read back (reading would only add latency).
        self.port
            .write_frame(&self.msg, write_limit(PERIOD))
            .map_err(|e| e.to_string())
    }
}

// ---------------- Open DMX ----------------

pub struct OpenDmxDriver {
    port: Box<dyn DmxPort>,
    slots: [u8; UNIVERSE + 1],
    last_start: Option<f64>,
}

impl OpenDmxDriver {
    pub fn new(port: Box<dyn DmxPort>) -> Self {
        OpenDmxDriver {
            port,
            slots: [0; UNIVERSE + 1],
            last_start: None,
        }
    }
}

impl Driver for OpenDmxDriver {
    fn kind(&self) -> Kind {
        Kind::Open
    }

    fn period(&self) -> f64 {
        OPEN_PERIOD
    }

    fn send(&mut self, frame: &Universe, _now: f64) -> Result<(), String> {
        if let Some(prev) = self.last_start {
            // Never break into the previous frame: wait (in real time, measured on the port)
            // until it has left the line, plus a margin for the USB chip.
            let ready = prev + OPEN_FRAME_TIME + OPEN_GUARD;
            let t = self.port.now();
            if t < ready {
                self.port.hold(Duration::from_secs_f64(ready - t));
            }
        }
        self.slots[0] = 0;
        self.slots[1..].copy_from_slice(frame);
        let e = |e: io::Error| e.to_string();
        self.port.set_break(true).map_err(e)?;
        self.port.hold(OPEN_BREAK);
        self.port.set_break(false).map_err(e)?;
        self.port.hold(OPEN_MAB);
        // The data starts now (each break request is a USB transfer: later than the tick).
        let start = self.port.now();
        self.port
            .write_frame(&self.slots, write_limit(OPEN_PERIOD))
            .map_err(e)?;
        self.last_start = Some(start);
        Ok(())
    }
}

// ---------------- Simulated and Recorder ----------------

/// "Uscita simulata": the engine runs as with a cable, nothing leaves the computer.
pub struct SimDriver;

impl Driver for SimDriver {
    fn kind(&self) -> Kind {
        Kind::Simulated
    }

    fn send(&mut self, _frame: &Universe, _now: f64) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
/// Frames recorded by a `Recorder`: (engine time in seconds, the 512 values).
pub type Recording = Arc<Mutex<Vec<(f64, Vec<u8>)>>>;

/// A fake output for the tests: records every frame with its time.
#[cfg(test)]
pub struct Recorder {
    pub frames: Recording,
    pub kind: Kind,
}

#[cfg(test)]
impl Recorder {
    pub fn new(kind: Kind) -> (Self, Recording) {
        let frames: Recording = Arc::new(Mutex::new(Vec::new()));
        (
            Recorder {
                frames: frames.clone(),
                kind,
            },
            frames,
        )
    }
}

#[cfg(test)]
impl Driver for Recorder {
    fn kind(&self) -> Kind {
        self.kind
    }

    fn send(&mut self, frame: &Universe, now: f64) -> Result<(), String> {
        self.frames
            .lock()
            .expect("recording")
            .push((now, frame.to_vec()));
        Ok(())
    }
}

#[cfg(test)]
pub mod testport {
    //! A fake serial port: records what the drivers do, answers like a Pro if asked to,
    //! and fails on demand (cable pulled out).
    use super::*;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[derive(Clone, Debug, PartialEq)]
    pub enum Op {
        Write(Vec<u8>),
        Break(bool),
        Hold(Duration),
    }

    #[derive(Default)]
    pub struct PortLog {
        pub ops: Mutex<Vec<Op>>,
        /// When set, every operation fails (the cable was pulled out).
        pub broken: AtomicBool,
        /// When set, frame writes time out (a device that accepts data too slowly).
        pub stalled: AtomicBool,
    }

    impl PortLog {
        pub fn writes(&self) -> Vec<Vec<u8>> {
            self.ops
                .lock()
                .unwrap()
                .iter()
                .filter_map(|o| {
                    if let Op::Write(w) = o {
                        Some(w.clone())
                    } else {
                        None
                    }
                })
                .collect()
        }
    }

    pub struct FakePort {
        pub log: Arc<PortLog>,
        /// Answers like a Pro widget (firmware 1.44, serial 12345678).
        pub pro: bool,
        pending: VecDeque<u8>,
        /// The port's clock: moves only with `hold` (and `break_lag`), or by hand in the tests.
        pub time: Arc<Mutex<f64>>,
        /// Seconds that clearing the break takes (a USB request).
        pub break_lag: f64,
    }

    impl FakePort {
        pub fn new(log: Arc<PortLog>, pro: bool) -> Self {
            FakePort {
                log,
                pro,
                pending: VecDeque::new(),
                time: Arc::new(Mutex::new(0.0)),
                break_lag: 0.0,
            }
        }

        fn check(&self) -> io::Result<()> {
            if self.log.broken.load(Ordering::SeqCst) {
                Err(io::Error::new(io::ErrorKind::BrokenPipe, "device removed"))
            } else {
                Ok(())
            }
        }
    }

    impl DmxPort for FakePort {
        fn write_all(&mut self, data: &[u8]) -> io::Result<()> {
            self.check()?;
            self.log.ops.lock().unwrap().push(Op::Write(data.to_vec()));
            if self.pro && data.len() >= 5 && data[0] == PRO_SOM {
                match data[1] {
                    LABEL_GET_PARAMS => self
                        .pending
                        .extend(pro_message(LABEL_GET_PARAMS, &[44, 1, 9, 1, 40])),
                    LABEL_GET_SERIAL => self
                        .pending
                        .extend(pro_message(LABEL_GET_SERIAL, &[0x78, 0x56, 0x34, 0x12])),
                    _ => {}
                }
            }
            Ok(())
        }

        fn read_some(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            self.check()?;
            let n = buf.len().min(self.pending.len());
            for b in buf.iter_mut().take(n) {
                *b = self.pending.pop_front().unwrap();
            }
            Ok(n)
        }

        fn set_break(&mut self, on: bool) -> io::Result<()> {
            self.check()?;
            self.log.ops.lock().unwrap().push(Op::Break(on));
            if !on {
                *self.time.lock().unwrap() += self.break_lag;
            }
            Ok(())
        }

        fn write_frame(&mut self, data: &[u8], limit: Duration) -> io::Result<()> {
            if self.log.stalled.load(Ordering::SeqCst) {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!("frame not written within {} ms", limit.as_millis()),
                ));
            }
            self.write_all(data)
        }

        fn now(&self) -> f64 {
            *self.time.lock().unwrap()
        }

        fn hold(&mut self, d: Duration) {
            self.log.ops.lock().unwrap().push(Op::Hold(d));
            *self.time.lock().unwrap() += d.as_secs_f64();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testport::*;
    use super::*;

    fn frame() -> Universe {
        let mut f = [0u8; UNIVERSE];
        f[0] = 10;
        f[1] = 20;
        f[511] = 255;
        f
    }

    #[test]
    fn pro_frames_are_exact() {
        let log = Arc::new(PortLog::default());
        let mut d = ProDriver::new(Box::new(FakePort::new(log.clone(), false)));
        d.send(&frame(), 0.0).unwrap();
        let w = log.writes();
        assert_eq!(w.len(), 1);
        let m = &w[0];
        assert_eq!(m.len(), 518);
        // 0x7E, label 6, length 513 = 0x0201 (LSB first), start code 0, values, 0xE7.
        assert_eq!(&m[..5], &[0x7E, 6, 0x01, 0x02, 0]);
        assert_eq!(&m[5..7], &[10, 20]);
        assert_eq!(m[516], 255);
        assert_eq!(m[517], 0xE7);
        assert_eq!(pro_message(3, &[0, 0]), vec![0x7E, 3, 2, 0, 0, 0, 0xE7]);
        assert_eq!(pro_message(10, &[]), vec![0x7E, 10, 0, 0, 0xE7]);
    }

    #[test]
    fn the_pro_parser_skips_garbage_and_reads_split_messages() {
        let mut p = ProParser::default();
        assert!(p.push(&[1, 2, 0x7E, 3, 5, 0]).is_empty());
        let got = p.push(&[44, 1, 9, 1, 40, 0xE7, 9, 0x7E, 10, 4, 0, 1, 2, 3, 4, 0xE7]);
        assert_eq!(
            got,
            vec![(3, vec![44, 1, 9, 1, 40]), (10, vec![1, 2, 3, 4])]
        );
    }

    #[test]
    fn a_pro_answers_the_probe_and_a_bare_chip_stays_silent() {
        let log = Arc::new(PortLog::default());
        let mut pro = FakePort::new(log.clone(), true);
        let info = probe_pro(&mut pro, Duration::from_millis(20))
            .unwrap()
            .unwrap();
        assert_eq!(info.firmware.as_deref(), Some("1.44"));
        assert_eq!(info.serial.as_deref(), Some("12345678"));
        assert_eq!(log.writes()[0], vec![0x7E, 3, 2, 0, 0, 0, 0xE7]);
        let mut open = FakePort::new(Arc::new(PortLog::default()), false);
        assert_eq!(
            probe_pro(&mut open, Duration::from_millis(20)).unwrap(),
            None
        );
    }

    #[test]
    fn open_dmx_frames_are_break_mark_after_break_and_513_slots() {
        let log = Arc::new(PortLog::default());
        let mut d = OpenDmxDriver::new(Box::new(FakePort::new(log.clone(), false)));
        assert_eq!(d.period(), OPEN_PERIOD);
        d.send(&frame(), 0.0).unwrap();
        let ops = log.ops.lock().unwrap().clone();
        assert_eq!(ops.len(), 5);
        assert_eq!(ops[0], Op::Break(true));
        assert!(matches!(ops[1], Op::Hold(d) if d >= Duration::from_micros(92)));
        assert_eq!(ops[2], Op::Break(false));
        assert!(matches!(ops[3], Op::Hold(d) if d >= Duration::from_micros(12)));
        let Op::Write(w) = &ops[4] else {
            panic!("no data")
        };
        assert_eq!(w.len(), 513);
        assert_eq!(&w[..3], &[0, 10, 20]);
        assert_eq!(w[512], 255);
    }

    #[test]
    fn open_dmx_never_breaks_into_the_previous_frame_measured_from_the_real_write() {
        let log = Arc::new(PortLog::default());
        let mut port = FakePort::new(log.clone(), false);
        // Clearing the break takes 3 ms (a USB request): the data starts later than the tick.
        port.break_lag = 0.003;
        let time = port.time.clone();
        let mut d = OpenDmxDriver::new(Box::new(port));
        d.send(&frame(), 0.0).unwrap();
        let write_start = OPEN_BREAK.as_secs_f64() + 0.003 + OPEN_MAB.as_secs_f64();
        log.ops.lock().unwrap().clear();
        // The next tick comes only 20 ms later (a late tick before, an early one now).
        *time.lock().unwrap() = 0.020;
        d.send(&frame(), 0.020).unwrap();
        let ops = log.ops.lock().unwrap().clone();
        let Op::Hold(w) = ops[0] else {
            panic!("no wait")
        };
        let ready = write_start + OPEN_FRAME_TIME + OPEN_GUARD;
        assert!(
            (0.020 + w.as_secs_f64() - ready).abs() < 1e-9,
            "waits until the first frame has left the line"
        );
        assert_eq!(ops[1], Op::Break(true));
        // At the normal cadence there is no wait.
        log.ops.lock().unwrap().clear();
        *time.lock().unwrap() += 2.0 * OPEN_PERIOD;
        d.send(&frame(), 1.0).unwrap();
        assert_eq!(log.ops.lock().unwrap()[0], Op::Break(true));
    }

    /// Accepts one byte per call, slowly: a device that would freeze an unbounded write.
    struct Trickle;

    impl io::Write for Trickle {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            std::thread::sleep(Duration::from_millis(1));
            Ok(buf.len().min(1))
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_frame_write_has_a_deadline() {
        let t0 = Instant::now();
        let err = write_bounded(&mut Trickle, &[0u8; 513], Duration::from_millis(15)).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
        assert!(t0.elapsed() < Duration::from_millis(500));
        assert!(write_bounded(&mut Trickle, &[1, 2, 3], Duration::from_millis(200)).is_ok());
        assert_eq!(write_limit(PERIOD), Duration::from_millis(50));
        assert!(write_limit(OPEN_PERIOD) <= Duration::from_millis(100));
    }
}
