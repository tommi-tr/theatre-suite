//! Small DSP helpers used inside the audio callback: EQ, envelope, fades.

use std::f32::consts::{FRAC_PI_2, PI};

use super::model::EnvPoint;

pub fn db_to_gain(db: f32) -> f32 {
    if db <= -60.0 { 0.0 } else { 10f32.powf(db / 20.0) }
}

/// Biquad filter (RBJ cookbook), transposed direct form II, stereo.
#[derive(Clone, Copy, Debug)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: [f32; 2],
    z2: [f32; 2],
    bypass: bool,
}

impl Default for Biquad {
    fn default() -> Self {
        Self { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, z1: [0.0; 2], z2: [0.0; 2], bypass: true }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BandKind {
    LowShelf,
    Peak,
    HighShelf,
}

impl Biquad {
    pub fn set(&mut self, kind: BandKind, freq: f32, q: f32, gain_db: f32, sample_rate: f32) {
        if gain_db.abs() < 0.05 {
            self.bypass = true;
            return;
        }
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sample_rate;
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * q);
        let (b0, b1, b2, a0, a1, a2) = match kind {
            BandKind::Peak => (1.0 + alpha * a, -2.0 * cos, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cos, 1.0 - alpha / a),
            BandKind::LowShelf => {
                let sq = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) - (a - 1.0) * cos + sq),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
                    a * ((a + 1.0) - (a - 1.0) * cos - sq),
                    (a + 1.0) + (a - 1.0) * cos + sq,
                    -2.0 * ((a - 1.0) + (a + 1.0) * cos),
                    (a + 1.0) + (a - 1.0) * cos - sq,
                )
            }
            BandKind::HighShelf => {
                let sq = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) + (a - 1.0) * cos + sq),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
                    a * ((a + 1.0) + (a - 1.0) * cos - sq),
                    (a + 1.0) - (a - 1.0) * cos + sq,
                    2.0 * ((a - 1.0) - (a + 1.0) * cos),
                    (a + 1.0) - (a - 1.0) * cos - sq,
                )
            }
        };
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
        if self.bypass {
            self.z1 = [0.0; 2];
            self.z2 = [0.0; 2];
        }
        self.bypass = false;
    }

    pub fn set_highpass(&mut self, freq: f32, q: f32, sample_rate: f32) {
        let w0 = 2.0 * PI * freq / sample_rate;
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * q);
        let a0 = 1.0 + alpha;
        self.b0 = (1.0 + cos) / 2.0 / a0;
        self.b1 = -(1.0 + cos) / a0;
        self.b2 = (1.0 + cos) / 2.0 / a0;
        self.a1 = -2.0 * cos / a0;
        self.a2 = (1.0 - alpha) / a0;
        self.z1 = [0.0; 2];
        self.z2 = [0.0; 2];
        self.bypass = false;
    }

    #[inline]
    pub fn process(&mut self, ch: usize, x: f32) -> f32 {
        if self.bypass {
            return x;
        }
        let y = self.b0 * x + self.z1[ch];
        self.z1[ch] = self.b1 * x - self.a1 * y + self.z2[ch];
        self.z2[ch] = self.b2 * x - self.a2 * y;
        y
    }
}

/// Five-band EQ: low shelf 60 Hz, peaks at 230 Hz, 910 Hz and 4 kHz, high shelf 14 kHz.
pub const EQ_BANDS: [(BandKind, f32, f32); 5] = [
    (BandKind::LowShelf, 60.0, 0.707),
    (BandKind::Peak, 230.0, 0.9),
    (BandKind::Peak, 910.0, 0.9),
    (BandKind::Peak, 4000.0, 0.9),
    (BandKind::HighShelf, 14000.0, 0.707),
];

#[derive(Clone, Copy, Debug, Default)]
pub struct Eq5 {
    bands: [Biquad; 5],
    key: [i32; 5],
    rate: u32,
    ready: bool,
}

impl Eq5 {
    pub fn configure(&mut self, gains: &[f64; 5], sample_rate: f32) {
        let key = gains.map(|g| (g * 10.0).round() as i32);
        if self.ready && key == self.key && self.rate == sample_rate as u32 {
            return;
        }
        self.key = key;
        self.rate = sample_rate as u32;
        self.ready = true;
        for (i, (kind, f, q)) in EQ_BANDS.iter().enumerate() {
            // Keep the top band below Nyquist at low sample rates.
            let f = f.min(sample_rate * 0.45);
            self.bands[i].set(*kind, f, *q, gains[i] as f32, sample_rate);
        }
    }

    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        let mut l = l;
        let mut r = r;
        for b in self.bands.iter_mut() {
            l = b.process(0, l);
            r = b.process(1, r);
        }
        (l, r)
    }
}

/// K-weighting (ITU-R BS.1770): high shelf +4 dB at ~1.7 kHz, then high-pass at ~38 Hz.
pub struct KWeight {
    shelf: Biquad,
    hp: Biquad,
}

impl KWeight {
    pub fn new(rate: f32) -> Self {
        let mut shelf = Biquad::default();
        shelf.set(BandKind::HighShelf, 1681.97, 0.7072, 3.9998, rate);
        let mut hp = Biquad::default();
        hp.set_highpass(38.135, 0.5003, rate);
        Self { shelf, hp }
    }
    #[inline]
    pub fn process(&mut self, ch: usize, x: f32) -> f32 {
        self.hp.process(ch, self.shelf.process(ch, x))
    }
}

/// Value of a curve at time `t` (seconds). Points are sorted. Smooth (S-shaped) between points.
fn interpolate(points: &[EnvPoint], t: f64) -> f64 {
    if t <= points[0].t {
        points[0].v
    } else if t >= points[points.len() - 1].t {
        points[points.len() - 1].v
    } else {
        let idx = points.partition_point(|p| p.t <= t);
        let a = points[idx - 1];
        let b = points[idx];
        let span = (b.t - a.t).max(1e-6);
        let u = ((t - a.t) / span).clamp(0.0, 1.0);
        let s = u * u * (3.0 - 2.0 * u);
        a.v + (b.v - a.v) * s
    }
}

/// Envelope gain at time `t` (seconds). Points are sorted. Smooth (S-shaped) between points.
/// Level v (0…1) maps to gain v² (closer to how loudness is perceived).
pub fn envelope_gain(points: &[EnvPoint], t: f64) -> f32 {
    if points.is_empty() {
        return 1.0;
    }
    let v = interpolate(points, t).clamp(0.0, 1.0) as f32;
    v * v
}

/// Pan (-1 = left … +1 = right) of a curve at time `t`; `None` when there is no curve.
pub fn pan_at(points: &[EnvPoint], t: f64) -> Option<f32> {
    if points.is_empty() {
        None
    } else {
        Some(interpolate(points, t).clamp(-1.0, 1.0) as f32)
    }
}

/// Left and right gains for a pan value. Both are 1 at the centre; moving away, the far
/// side fades along a constant-power curve and the near side stays at full level, so
/// a centred track keeps exactly the sound it had before pan existed.
pub fn pan_gains(p: f32) -> (f32, f32) {
    let theta = (p.clamp(-1.0, 1.0) + 1.0) * std::f32::consts::FRAC_PI_4;
    ((std::f32::consts::SQRT_2 * theta.cos()).min(1.0), (std::f32::consts::SQRT_2 * theta.sin()).min(1.0))
}

/// A gain ramp with an equal-power shape, counted in frames.
#[derive(Clone, Copy, Debug)]
pub struct Fade {
    from: f32,
    to: f32,
    pos: u64,
    len: u64,
}

impl Fade {
    pub fn steady(g: f32) -> Self {
        Self { from: g, to: g, pos: 0, len: 0 }
    }
    pub fn to(current: f32, target: f32, frames: u64) -> Self {
        Self { from: current, to: target, pos: 0, len: frames.max(1) }
    }
    #[inline]
    pub fn value(&self) -> f32 {
        if self.pos >= self.len {
            return self.to;
        }
        let p = self.pos as f32 / self.len as f32;
        let s = if self.to >= self.from { (p * FRAC_PI_2).sin() } else { 1.0 - (p * FRAC_PI_2).cos() };
        self.from + (self.to - self.from) * s
    }
    #[inline]
    pub fn advance(&mut self, frames: u64) {
        self.pos = (self.pos + frames).min(self.len);
    }
    pub fn done(&self) -> bool {
        self.pos >= self.len
    }
    pub fn target(&self) -> f32 {
        self.to
    }
    pub fn remaining(&self) -> u64 {
        self.len.saturating_sub(self.pos)
    }
    pub fn rising(&self) -> bool {
        !self.done() && self.to > self.from
    }
    pub fn falling(&self) -> bool {
        !self.done() && self.to < self.from
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_is_flat_outside_points() {
        let pts = vec![EnvPoint { t: 1.0, v: 0.5 }, EnvPoint { t: 2.0, v: 1.0 }];
        assert!((envelope_gain(&pts, 0.0) - 0.25).abs() < 1e-6);
        assert!((envelope_gain(&pts, 3.0) - 1.0).abs() < 1e-6);
        let mid = envelope_gain(&pts, 1.5);
        assert!(mid > 0.25 && mid < 1.0);
    }

    #[test]
    fn fade_reaches_target() {
        let mut f = Fade::to(1.0, 0.0, 100);
        assert!((f.value() - 1.0).abs() < 1e-6);
        f.advance(50);
        assert!(f.value() < 1.0 && f.value() > 0.0);
        f.advance(60);
        assert!(f.done());
        assert_eq!(f.value(), 0.0);
    }

    #[test]
    fn eq_flat_is_transparent() {
        let mut eq = Eq5::default();
        eq.configure(&[0.0; 5], 48000.0);
        assert_eq!(eq.process(0.3, -0.2), (0.3, -0.2));
    }
}
