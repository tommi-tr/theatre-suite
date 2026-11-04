//! Decoding audio files.
//!
//! - `Feeder`: one background thread per voice. It decodes the file ahead of
//!   time into a lock-free ring buffer (about 3 seconds), resampled to the
//!   output rate, and handles loops by seeking. The audio callback only reads.
//! - `analyze`: reads a whole file once to get its duration and waveform.

use std::fs::File;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{CODEC_TYPE_NULL, Decoder, DecoderOptions};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

use super::model::TrackInfo;

/// Marks where, in the stream of output frames, a stretch of the file begins.
#[derive(Clone, Copy, Debug)]
pub struct Segment {
    /// Index of the first output frame of this stretch.
    pub start_frame: u64,
    /// Time in the file (seconds) of that frame.
    pub src_start: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FeedParams {
    /// Where the file stops (None = end of file).
    pub out_sec: Option<f64>,
    /// Loop region; `f64::INFINITY` as end = end of file.
    pub looping: Option<(f64, f64)>,
}

pub struct FeederCtl {
    pub stop: AtomicBool,
    pub finished: AtomicBool,
    pub failed: AtomicBool,
    pub pushed: AtomicU64,
    duration_bits: AtomicU64,
    pub params: Mutex<FeedParams>,
}

impl FeederCtl {
    pub fn duration(&self) -> f64 {
        f64::from_bits(self.duration_bits.load(Ordering::Relaxed))
    }
}

pub struct FeederHandles {
    pub audio: rtrb::Consumer<f32>,
    pub segments: rtrb::Consumer<Segment>,
    pub ctl: Arc<FeederCtl>,
}

struct Source {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    sample_rate: u32,
    duration: f64,
}

fn open_source(path: &Path) -> Result<Source, String> {
    let file = File::open(path).map_err(|e| format!("Cannot open the file: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions { enable_gapless: true, ..Default::default() }, &MetadataOptions::default())
        .map_err(|_| "This file format is not supported".to_string())?;
    let format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("The file contains no audio")?;
    let params = track.codec_params.clone();
    let track_id = track.id;
    let sample_rate = params.sample_rate.ok_or("Unknown sample rate")?;
    let duration = match (params.n_frames, params.time_base) {
        (Some(n), Some(tb)) => {
            let t = tb.calc_time(n);
            t.seconds as f64 + t.frac
        }
        (Some(n), None) => n as f64 / sample_rate as f64,
        _ => 0.0,
    };
    let decoder = symphonia::default::get_codecs()
        .make(&params, &DecoderOptions::default())
        .map_err(|_| "This audio codec is not supported".to_string())?;
    Ok(Source { format, decoder, track_id, sample_rate, duration })
}

/// Cubic (Hermite) resampler, stereo. Converts the file rate to the output rate.
struct Resampler {
    step: f64,
    frac: f64,
    hist: [[f32; 2]; 4],
    primed: u8,
    bypass: bool,
}

impl Resampler {
    fn new(src: u32, dst: u32) -> Self {
        Self { step: src as f64 / dst as f64, frac: 0.0, hist: [[0.0; 2]; 4], primed: 0, bypass: src == dst }
    }
    fn reset(&mut self) {
        self.frac = 0.0;
        self.hist = [[0.0; 2]; 4];
        self.primed = 0;
    }
    #[inline]
    fn push(&mut self, l: f32, r: f32, out: &mut Vec<f32>) {
        if self.bypass {
            out.push(l);
            out.push(r);
            return;
        }
        self.hist = [self.hist[1], self.hist[2], self.hist[3], [l, r]];
        if self.primed < 3 {
            self.primed += 1;
            if self.primed == 1 {
                // Start with the first sample repeated, so the stream starts on time.
                self.hist = [[l, r]; 4];
            }
            if self.primed < 3 {
                return;
            }
        }
        while self.frac < 1.0 {
            let t = self.frac as f32;
            for c in 0..2 {
                let (y0, y1, y2, y3) = (self.hist[0][c], self.hist[1][c], self.hist[2][c], self.hist[3][c]);
                let c0 = y1;
                let c1 = 0.5 * (y2 - y0);
                let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
                let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
                out.push(((c3 * t + c2) * t + c1) * t + c0);
            }
            self.frac += self.step;
        }
        self.frac -= 1.0;
    }
}

fn to_stereo(samples: &[f32], channels: usize, mut f: impl FnMut(f32, f32)) {
    match channels {
        0 => {}
        1 => samples.iter().for_each(|&s| f(s, s)),
        _ => samples.chunks_exact(channels).for_each(|fr| f(fr[0], fr[1])),
    }
}

fn seek(src: &mut Source, secs: f64) -> f64 {
    if secs <= 0.0001 {
        // Re-open is not needed: seeking to zero is supported by every reader we use.
        let r = src.format.seek(SeekMode::Accurate, SeekTo::Time { time: Time::from(0.0), track_id: Some(src.track_id) });
        src.decoder.reset();
        return if r.is_ok() { 0.0 } else { -1.0 };
    }
    match src.format.seek(SeekMode::Accurate, SeekTo::Time { time: Time::from(secs), track_id: Some(src.track_id) }) {
        Ok(_) => {
            src.decoder.reset();
            secs
        }
        Err(_) => -1.0,
    }
}

/// Starts a feeder thread for `path`, beginning at `start_sec`.
pub fn spawn_feeder(path: String, start_sec: f64, out_rate: u32, params: FeedParams) -> Result<FeederHandles, String> {
    let mut src = open_source(Path::new(&path))?;
    let capacity_frames = (out_rate as usize) * 3;
    let (mut prod, cons) = rtrb::RingBuffer::<f32>::new(capacity_frames * 2);
    let (mut seg_prod, seg_cons) = rtrb::RingBuffer::<Segment>::new(256);
    let ctl = Arc::new(FeederCtl {
        stop: AtomicBool::new(false),
        finished: AtomicBool::new(false),
        failed: AtomicBool::new(false),
        pushed: AtomicU64::new(0),
        duration_bits: AtomicU64::new(src.duration.to_bits()),
        params: Mutex::new(params),
    });
    let ctl2 = ctl.clone();
    thread::Builder::new()
        .name("diaframma-feeder".into())
        .spawn(move || {
            let ctl = ctl2;
            let mut rs = Resampler::new(src.sample_rate, out_rate);
            let mut out: Vec<f32> = Vec::with_capacity(16384);
            let mut pending: Vec<f32> = Vec::with_capacity(16384);
            // A loop jump (seconds) or a stop (NaN) to apply once `pending` is flushed.
            let mut pending_jump: Option<f64> = None;
            let mut pushed: u64 = 0;
            let mut sample_buf: Option<SampleBuffer<f32>> = None;
            let mut target = start_sec.max(0.0);
            if target > 0.0 && seek(&mut src, target) < 0.0 {
                target = 0.0;
                let _ = seek(&mut src, 0.0);
            }
            let _ = seg_prod.push(Segment { start_frame: 0, src_start: target });
            // Decoded frames before this time are dropped (sample-accurate start after a seek).
            let mut skip_until = target;
            let rate = src.sample_rate as f64;
            let time_base = src.format.tracks().iter().find(|t| t.id == src.track_id).and_then(|t| t.codec_params.time_base);
            let mut eof = false;
            loop {
                if ctl.stop.load(Ordering::Relaxed) || prod.is_abandoned() {
                    break;
                }
                // 1) Flush decoded audio waiting to enter the ring buffer.
                if !pending.is_empty() {
                    let written = {
                        let (done, _rest) = prod.push_partial_slice(&pending);
                        done.len()
                    };
                    pending.drain(..written);
                    pushed += (written / 2) as u64;
                    ctl.pushed.store(pushed, Ordering::Release);
                    if !pending.is_empty() {
                        thread::sleep(Duration::from_millis(4));
                        continue;
                    }
                }
                if let Some(jump) = pending_jump.take() {
                    if jump.is_nan() {
                        eof = true;
                    } else {
                        let at = seek(&mut src, jump);
                        if at < 0.0 {
                            eof = true;
                        } else {
                            rs.reset();
                            let _ = seg_prod.push(Segment { start_frame: pushed, src_start: at });
                            skip_until = at;
                        }
                    }
                }
                if eof {
                    ctl.finished.store(true, Ordering::Release);
                    thread::sleep(Duration::from_millis(20));
                    continue;
                }
                if prod.slots() < 8192 {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                }
                // 2) Decode one packet.
                let p = *ctl.params.lock();
                let packet = match src.format.next_packet() {
                    Ok(pk) => pk,
                    Err(SymError::ResetRequired) => {
                        src.decoder.reset();
                        continue;
                    }
                    Err(_) => {
                        // End of file (or an unreadable tail).
                        pending_jump = Some(match p.looping {
                            Some((lin, _)) => lin,
                            None => f64::NAN,
                        });
                        continue;
                    }
                };
                if packet.track_id() != src.track_id {
                    continue;
                }
                let pkt_time = match time_base {
                    Some(tb) => {
                        let t = tb.calc_time(packet.ts());
                        t.seconds as f64 + t.frac
                    }
                    None => packet.ts() as f64 / rate,
                };
                let decoded = match src.decoder.decode(&packet) {
                    Ok(d) => d,
                    Err(SymError::DecodeError(_)) => continue,
                    Err(_) => {
                        ctl.failed.store(true, Ordering::Relaxed);
                        pending_jump = Some(f64::NAN);
                        continue;
                    }
                };
                let spec = *decoded.spec();
                let channels = spec.channels.count();
                let needed = decoded.capacity() as u64;
                if sample_buf.as_ref().map(|b| b.capacity() < needed as usize * channels).unwrap_or(true) {
                    sample_buf = Some(SampleBuffer::<f32>::new(needed, spec));
                }
                let sb = sample_buf.as_mut().unwrap();
                sb.copy_interleaved_ref(decoded);
                let stop_at = match p.looping {
                    Some((_, lout)) => lout,
                    None => p.out_sec.unwrap_or(f64::INFINITY),
                };
                out.clear();
                let mut i: u64 = 0;
                let mut cut: Option<f64> = None;
                to_stereo(sb.samples(), channels, |l, r| {
                    if cut.is_some() {
                        return;
                    }
                    let t = pkt_time + i as f64 / rate;
                    i += 1;
                    if t + 0.5 / rate < skip_until {
                        return;
                    }
                    if t >= stop_at {
                        cut = Some(match p.looping {
                            Some((lin, _)) => lin,
                            None => f64::NAN,
                        });
                        return;
                    }
                    rs.push(l, r, &mut out);
                });
                pending.extend_from_slice(&out);
                if cut.is_some() {
                    pending_jump = cut;
                }
            }
        })
        .map_err(|e| format!("Cannot start the decoder: {e}"))?;
    Ok(FeederHandles { audio: cons, segments: seg_cons, ctl })
}

/// Reads the whole file once: duration and a 1000-bin waveform.
pub fn analyze(path: &str) -> Result<TrackInfo, String> {
    let mut src = open_source(Path::new(path))?;
    let mut blocks: Vec<f32> = Vec::new();
    let block = 512usize;
    let mut acc = 0f32;
    let mut count = 0usize;
    let mut frames: u64 = 0;
    let mut channels_seen = 0u32;
    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    loop {
        let packet = match src.format.next_packet() {
            Ok(p) => p,
            Err(SymError::ResetRequired) => {
                src.decoder.reset();
                continue;
            }
            Err(_) => break,
        };
        if packet.track_id() != src.track_id {
            continue;
        }
        let decoded = match src.decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymError::DecodeError(_)) => continue,
            Err(_) => break,
        };
        let spec = *decoded.spec();
        let ch = spec.channels.count();
        channels_seen = ch as u32;
        let needed = decoded.capacity() as u64;
        if sample_buf.as_ref().map(|b| b.capacity() < needed as usize * ch).unwrap_or(true) {
            sample_buf = Some(SampleBuffer::<f32>::new(needed, spec));
        }
        let sb = sample_buf.as_mut().unwrap();
        sb.copy_interleaved_ref(decoded);
        to_stereo(sb.samples(), ch, |l, r| {
            let a = l.abs().max(r.abs());
            if a > acc {
                acc = a;
            }
            count += 1;
            frames += 1;
            if count == block {
                blocks.push(acc);
                acc = 0.0;
                count = 0;
            }
        });
    }
    if count > 0 {
        blocks.push(acc);
    }
    if frames == 0 {
        return Err("The file contains no playable audio".into());
    }
    let bins = 1000usize;
    let mut peaks = vec![0f32; bins];
    if !blocks.is_empty() {
        for (i, p) in peaks.iter_mut().enumerate() {
            let a = i * blocks.len() / bins;
            let b = (((i + 1) * blocks.len()) / bins).max(a + 1).min(blocks.len());
            *p = blocks[a..b].iter().cloned().fold(0.0, f32::max).min(1.0);
        }
    }
    let duration = frames as f64 / src.sample_rate as f64;
    let _ = src.duration;
    Ok(TrackInfo { duration_sec: duration, sample_rate: src.sample_rate, channels: channels_seen, peaks })
}
