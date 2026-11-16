//! What goes on the cable, frame by frame: pure logic, no threads, no clock of its own.
//! The engine thread calls `advance(now)` before every frame and before every command,
//! so fades are computed on time, whatever the frame rate.
//!
//! Layers, from the bottom:
//! 1. **Playback** — the universe as the desk/show set it: `set_universe` (immediate) or
//!    `fade_to` (a transition computed here, mirror of crossfade.ts). Pause/resume/stop act
//!    on the running fade. A new `fade_to` during a fade starts from the current values.
//!    `set_universe` during a fade **ends the fade** and jumps to the given values: the
//!    desk takes the stage (the UI sends the whole universe it wants to see).
//! 2. **Output master**, applied after everything, never recorded: Grand Master (0–255) and
//!    Fade to black scale the channels of the intensity mask; Blackout puts them at 0.
//!    Other channels (positions, gobos, smoke…) are never touched, so moving heads do not
//!    swing. Blackout off gives back what is underneath, which may have kept fading.
//!    value = floor(v × gm/255 × ftb + 0.5).
//! 3. **Test pattern** (Settings → "Prova l'uscita"): while active it replaces the output:
//!    channels 1…N one at a time, each rising gently to `level` and holding, everything else at 0.

use super::fade::{Layout, Transition, UNIVERSE, crossfade_into};
use serde::Serialize;

pub type Universe = [u8; UNIVERSE];

/// Seconds each channel of the test pattern stays on, and how long it takes to rise.
pub const TEST_STEP: f64 = 1.5;
pub const TEST_RISE: f64 = 0.5;

struct RunningFade {
    id: u64,
    from: Box<Universe>,
    to: Box<Universe>,
    tr: Transition,
    layout: Layout,
    dark_from: Vec<bool>,
    dark_to: Vec<bool>,
    elapsed: f64,
    total: f64,
    paused: bool,
}

struct TestPattern {
    channels: usize,
    level: u8,
    t: f64,
}

/// Progress of the running fade, of the output master and of the test (for the UI).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FadeState {
    /// Id of the running fade (as returned by `fade_to`), or of the last one.
    pub id: u64,
    pub active: bool,
    pub paused: bool,
    /// 0–1.
    pub progress: f64,
    pub elapsed: f64,
    pub total: f64,
    /// Id of the last fade that reached its end (0 = none yet).
    pub done_id: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterState {
    pub blackout: bool,
    pub grand_master: u8,
    /// 1 = full, 0 = black.
    pub ftb_level: f64,
    /// Where the Fade to black is going: 0 = to black, 1 = released.
    pub ftb_target: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestState {
    /// 1-based channel being raised.
    pub channel: usize,
    pub of: usize,
}

pub struct Core {
    playback: Box<Universe>,
    fade: Option<RunningFade>,
    last_fade_id: u64,
    done_id: u64,
    mask: Box<[bool; UNIVERSE]>,
    grand_master: u8,
    blackout: bool,
    ftb_level: f64,
    ftb_target: f64,
    /// Change of `ftb_level` per second (positive).
    ftb_rate: f64,
    test: Option<TestPattern>,
    now: Option<f64>,
}

impl Default for Core {
    fn default() -> Self {
        Self::new()
    }
}

impl Core {
    pub fn new() -> Self {
        Core {
            playback: Box::new([0; UNIVERSE]),
            fade: None,
            last_fade_id: 0,
            done_id: 0,
            // Until the interface says which channels are intensity, all are: Blackout means black.
            mask: Box::new([true; UNIVERSE]),
            grand_master: 255,
            blackout: false,
            ftb_level: 1.0,
            ftb_target: 1.0,
            ftb_rate: 0.0,
            test: None,
            now: None,
        }
    }

    /// Moves time to `now` (seconds, monotonic). Time never goes back.
    pub fn advance(&mut self, now: f64) {
        let dt = match self.now {
            Some(prev) if now > prev => now - prev,
            Some(_) => 0.0,
            None => 0.0,
        };
        if self.now.is_none_or(|p| now > p) {
            self.now = Some(now);
        }
        if dt <= 0.0 {
            self.finish_fade_if_done();
            return;
        }
        if let Some(f) = self.fade.as_mut()
            && !f.paused
        {
            f.elapsed += dt;
        }
        self.finish_fade_if_done();
        if self.ftb_level != self.ftb_target {
            let step = self.ftb_rate * dt;
            self.ftb_level = if self.ftb_level < self.ftb_target {
                (self.ftb_level + step).min(self.ftb_target)
            } else {
                (self.ftb_level - step).max(self.ftb_target)
            };
        }
        if let Some(tp) = self.test.as_mut() {
            tp.t += dt;
        }
    }

    fn finish_fade_if_done(&mut self) {
        if let Some(f) = &self.fade
            && f.elapsed >= f.total
        {
            let f = self.fade.take().expect("fade");
            self.playback = f.to;
            self.done_id = f.id;
        }
    }

    /// The playback layer now (a running fade included), before the output master.
    pub fn playback_now(&self) -> Universe {
        match &self.fade {
            None => *self.playback,
            Some(f) => {
                let mut out = [0u8; UNIVERSE];
                crossfade_into(
                    &f.from[..],
                    &f.to[..],
                    f.elapsed,
                    &f.tr,
                    &f.layout,
                    &f.dark_from,
                    &f.dark_to,
                    &mut out,
                );
                out
            }
        }
    }

    /// The frame that goes on the cable now.
    pub fn frame(&self) -> Universe {
        if let Some(tp) = &self.test {
            return test_frame(tp);
        }
        let mut out = self.playback_now();
        let factor = (self.grand_master as f64 / 255.0) * self.ftb_level;
        if factor >= 1.0 && !self.blackout {
            return out;
        }
        for (v, &m) in out.iter_mut().zip(self.mask.iter()) {
            if m {
                *v = if self.blackout {
                    0
                } else {
                    (*v as f64 * factor + 0.5).floor().clamp(0.0, 255.0) as u8
                };
            }
        }
        out
    }

    // ---------------- Playback ----------------

    /// Immediate values (the desk). Ends a running fade where it is and replaces everything.
    pub fn set_universe(&mut self, values: &[u8]) {
        // An interrupted fade is not "done": done_id stays on the last completed one.
        self.fade = None;
        let mut u = [0u8; UNIVERSE];
        let n = values.len().min(UNIVERSE);
        u[..n].copy_from_slice(&values[..n]);
        *self.playback = u;
    }

    /// Starts a transition from the current values to `target`; returns its id.
    pub fn fade_to(&mut self, target: &[u8], tr: Transition, layout: Layout, id: u64) -> u64 {
        let from = Box::new(self.playback_now());
        let mut to = Box::new([0u8; UNIVERSE]);
        let n = target.len().min(UNIVERSE);
        to[..n].copy_from_slice(&target[..n]);
        let dark_from = layout.dark_heads(&from[..]);
        let dark_to = layout.dark_heads(&to[..]);
        let id = if id == 0 { self.last_fade_id + 1 } else { id };
        self.last_fade_id = self.last_fade_id.max(id);
        self.playback = from.clone();
        self.fade = Some(RunningFade {
            id,
            from,
            to,
            total: tr.duration(),
            tr,
            layout,
            dark_from,
            dark_to,
            elapsed: 0.0,
            paused: false,
        });
        self.finish_fade_if_done();
        id
    }

    pub fn pause(&mut self) {
        if let Some(f) = self.fade.as_mut() {
            f.paused = true;
        }
    }

    pub fn resume(&mut self) {
        if let Some(f) = self.fade.as_mut() {
            f.paused = false;
        }
    }

    /// Stops the running fade where it is (the values stay).
    pub fn stop_fade(&mut self) {
        if self.fade.is_some() {
            let now = self.playback_now();
            self.fade = None;
            *self.playback = now;
        }
    }

    // ---------------- Output master ----------------

    pub fn set_blackout(&mut self, on: bool) {
        self.blackout = on;
    }

    /// Fades the intensity channels to black in `seconds` (0 = at once).
    pub fn fade_to_black(&mut self, seconds: f64) {
        self.ftb_to(0.0, seconds);
    }

    /// Brings the intensity back from a Fade to black in `seconds` (0 = at once).
    pub fn release_black(&mut self, seconds: f64) {
        self.ftb_to(1.0, seconds);
    }

    fn ftb_to(&mut self, target: f64, seconds: f64) {
        self.ftb_target = target;
        if !seconds.is_finite() || seconds <= 0.0 {
            self.ftb_level = target;
            self.ftb_rate = 0.0;
        } else {
            self.ftb_rate = 1.0 / seconds;
        }
    }

    pub fn set_grand_master(&mut self, level: u8) {
        self.grand_master = level;
    }

    /// Which channels the output master scales (1 = intensity). Missing entries = not intensity.
    pub fn set_intensity_mask(&mut self, mask: &[u8]) {
        for (i, m) in self.mask.iter_mut().enumerate() {
            *m = mask.get(i).is_some_and(|&v| v != 0);
        }
    }

    // ---------------- Test pattern ----------------

    pub fn start_test(&mut self, channels: usize, level: u8) {
        self.test = Some(TestPattern {
            channels: channels.clamp(1, UNIVERSE),
            level,
            t: 0.0,
        });
    }

    pub fn stop_test(&mut self) {
        self.test = None;
    }

    // ---------------- State for the UI ----------------

    pub fn fade_state(&self) -> FadeState {
        match &self.fade {
            Some(f) => FadeState {
                id: f.id,
                active: true,
                paused: f.paused,
                progress: if f.total > 0.0 {
                    (f.elapsed / f.total).clamp(0.0, 1.0)
                } else {
                    1.0
                },
                elapsed: f.elapsed.min(f.total),
                total: f.total,
                done_id: self.done_id,
            },
            None => FadeState {
                id: self.last_fade_id,
                active: false,
                paused: false,
                progress: if self.done_id > 0 { 1.0 } else { 0.0 },
                elapsed: 0.0,
                total: 0.0,
                done_id: self.done_id,
            },
        }
    }

    pub fn master_state(&self) -> MasterState {
        MasterState {
            blackout: self.blackout,
            grand_master: self.grand_master,
            ftb_level: self.ftb_level,
            ftb_target: self.ftb_target,
        }
    }

    pub fn test_state(&self) -> Option<TestState> {
        self.test.as_ref().map(|tp| TestState {
            channel: test_channel(tp) + 1,
            of: tp.channels,
        })
    }
}

fn test_channel(tp: &TestPattern) -> usize {
    ((tp.t / TEST_STEP).floor() as usize) % tp.channels
}

fn test_frame(tp: &TestPattern) -> Universe {
    let mut out = [0u8; UNIVERSE];
    let ch = test_channel(tp);
    let within = tp.t % TEST_STEP;
    let k = (within / TEST_RISE).min(1.0);
    out[ch] = (tp.level as f64 * k + 0.5).floor() as u8;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uni(pairs: &[(usize, u8)]) -> Vec<u8> {
        let mut u = vec![0u8; UNIVERSE];
        for &(i, v) in pairs {
            u[i] = v;
        }
        u
    }

    fn tr(fade_in: f64, fade_out: f64) -> Transition {
        Transition {
            fade_in,
            fade_out,
            delay: 0.0,
            move_in_dark: false,
        }
    }

    #[test]
    fn nothing_moves_before_time_passes_and_the_fade_ends_on_the_target() {
        let mut c = Core::new();
        c.advance(0.0);
        let id = c.fade_to(
            &uni(&[(0, 200)]),
            tr(2.0, 2.0),
            Layout::all_intensity(UNIVERSE),
            0,
        );
        assert_eq!(id, 1);
        assert_eq!(c.frame()[0], 0);
        c.advance(1.0);
        assert_eq!(c.frame()[0], 100);
        assert!(c.fade_state().active);
        c.advance(2.5);
        assert_eq!(c.frame()[0], 200);
        let s = c.fade_state();
        assert!(!s.active);
        assert_eq!(s.done_id, 1);
    }

    #[test]
    fn pause_and_resume_stop_the_clock_of_the_fade() {
        let mut c = Core::new();
        c.advance(10.0);
        c.fade_to(
            &uni(&[(0, 200)]),
            tr(4.0, 4.0),
            Layout::all_intensity(UNIVERSE),
            7,
        );
        c.advance(11.0);
        assert_eq!(c.frame()[0], 50);
        c.pause();
        c.advance(20.0);
        assert_eq!(c.frame()[0], 50);
        assert!(c.fade_state().paused);
        assert_eq!(c.fade_state().elapsed, 1.0);
        c.resume();
        c.advance(21.0);
        assert_eq!(c.frame()[0], 100);
        c.advance(23.0);
        assert_eq!(c.frame()[0], 200);
        assert_eq!(c.fade_state().done_id, 7);
    }

    #[test]
    fn a_new_fade_during_a_fade_starts_from_the_current_values() {
        let mut c = Core::new();
        c.advance(0.0);
        c.fade_to(
            &uni(&[(0, 200)]),
            tr(2.0, 2.0),
            Layout::all_intensity(UNIVERSE),
            0,
        );
        c.advance(1.0);
        assert_eq!(c.frame()[0], 100);
        // "Indietro": back to 0 in 1 s, smoothly from 100.
        let id = c.fade_to(&uni(&[]), tr(1.0, 1.0), Layout::all_intensity(UNIVERSE), 0);
        assert_eq!(id, 2);
        assert_eq!(c.frame()[0], 100);
        c.advance(1.5);
        assert_eq!(c.frame()[0], 50);
        c.advance(2.0);
        assert_eq!(c.frame()[0], 0);
    }

    #[test]
    fn set_universe_during_a_fade_ends_the_fade_and_jumps() {
        let mut c = Core::new();
        c.advance(0.0);
        c.fade_to(
            &uni(&[(0, 200), (1, 200)]),
            tr(2.0, 2.0),
            Layout::all_intensity(UNIVERSE),
            0,
        );
        c.advance(1.0);
        c.set_universe(&uni(&[(1, 30)]));
        assert!(!c.fade_state().active);
        assert_eq!(c.fade_state().done_id, 0, "an interrupted fade is not done");
        c.advance(5.0);
        assert_eq!(&c.frame()[..2], &[0, 30]);
    }

    #[test]
    fn stop_fade_keeps_the_values_where_they_are() {
        let mut c = Core::new();
        c.advance(0.0);
        c.fade_to(
            &uni(&[(0, 200)]),
            tr(2.0, 2.0),
            Layout::all_intensity(UNIVERSE),
            0,
        );
        c.advance(0.5);
        c.stop_fade();
        c.advance(9.0);
        assert_eq!(c.frame()[0], 50);
        assert!(!c.fade_state().active);
    }

    #[test]
    fn blackout_is_reversible_while_the_fade_continues_underneath() {
        let mut c = Core::new();
        c.advance(0.0);
        c.fade_to(
            &uni(&[(0, 200)]),
            tr(4.0, 4.0),
            Layout::all_intensity(UNIVERSE),
            0,
        );
        c.advance(1.0);
        c.set_blackout(true);
        assert_eq!(c.frame()[0], 0);
        assert_eq!(c.playback_now()[0], 50);
        c.advance(3.0);
        assert_eq!(c.frame()[0], 0);
        c.set_blackout(false);
        assert_eq!(
            c.frame()[0],
            150,
            "back to what is underneath, which kept fading"
        );
    }

    #[test]
    fn blackout_leaves_the_channels_outside_the_intensity_mask_alone() {
        let mut c = Core::new();
        c.set_universe(&uni(&[(0, 255), (1, 77)]));
        c.set_intensity_mask(&uni(&[(0, 1)]));
        c.set_blackout(true);
        assert_eq!(&c.frame()[..2], &[0, 77]);
    }

    #[test]
    fn fade_to_black_and_its_release() {
        let mut c = Core::new();
        c.advance(0.0);
        c.set_universe(&uni(&[(0, 200), (1, 90)]));
        c.set_intensity_mask(&uni(&[(0, 1)]));
        c.fade_to_black(2.0);
        c.advance(1.0);
        assert_eq!(&c.frame()[..2], &[100, 90]);
        c.advance(2.0);
        assert_eq!(&c.frame()[..2], &[0, 90]);
        assert_eq!(c.master_state().ftb_level, 0.0);
        c.release_black(1.0);
        c.advance(2.5);
        assert_eq!(c.frame()[0], 100);
        c.advance(3.0);
        assert_eq!(c.frame()[0], 200);
        c.fade_to_black(0.0);
        assert_eq!(c.frame()[0], 0);
        c.release_black(0.0);
        assert_eq!(c.frame()[0], 200);
    }

    #[test]
    fn grand_master_scales_only_the_intensity_mask() {
        let mut c = Core::new();
        c.set_universe(&uni(&[(0, 200), (1, 200), (2, 255)]));
        c.set_intensity_mask(&uni(&[(0, 1), (2, 1)]));
        c.set_grand_master(128);
        // floor(200 × 128/255 + 0.5) = floor(100.39… + 0.5) = 100; 255 × 128/255 = 128.
        assert_eq!(&c.frame()[..3], &[100, 200, 128]);
        c.set_grand_master(0);
        assert_eq!(&c.frame()[..3], &[0, 200, 0]);
        c.set_grand_master(255);
        assert_eq!(&c.frame()[..3], &[200, 200, 255]);
    }

    #[test]
    fn the_test_pattern_raises_one_channel_at_a_time_and_stops() {
        let mut c = Core::new();
        c.advance(0.0);
        c.set_universe(&uni(&[(5, 99)]));
        c.start_test(3, 128);
        assert_eq!(c.frame().iter().filter(|&&v| v > 0).count(), 0);
        c.advance(TEST_RISE);
        let f = c.frame();
        assert_eq!(f[0], 128);
        assert_eq!(f.iter().filter(|&&v| v > 0).count(), 1);
        assert_eq!(c.test_state(), Some(TestState { channel: 1, of: 3 }));
        c.advance(TEST_STEP + TEST_RISE);
        assert_eq!(c.frame()[1], 128);
        assert_eq!(c.frame()[0], 0);
        c.advance(3.0 * TEST_STEP + TEST_RISE);
        assert_eq!(
            c.test_state().unwrap().channel,
            1,
            "it starts again from the first channel"
        );
        c.stop_test();
        assert_eq!(c.frame()[5], 99);
        assert_eq!(c.test_state(), None);
    }
}
