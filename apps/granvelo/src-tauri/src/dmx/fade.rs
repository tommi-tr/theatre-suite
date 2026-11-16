//! Crossfade between two states of the universe: an exact mirror of
//! `src/model/crossfade.ts` (same rules, same rounding, same vectors in the tests).
//!
//! Rules, channel by channel:
//! 1. Before `delay` nothing moves.
//! 2. An intensity channel that rises takes `fade_in`, one that falls takes `fade_out`;
//!    every other channel takes `fade_in`.
//! 3. Progress p = (t − delay) / duration, clamped to 0…1; a duration of 0 jumps at `delay`.
//! 4. Value = floor(from + (to − from) × p + 0.5), in f64 like JavaScript.
//! 5. Move in dark, for the non-intensity channels of a moving head: dark at the start →
//!    they jump to `to` at `delay`; lit at the start and dark at the end → they stay at
//!    `from` until `delay + fade_out`, then jump; lit at both ends → rule 2.
//!
//! The transition is complete at `delay + max(fade_in, fade_out)`.

use serde::{Deserialize, Serialize};

/// Channels of one DMX universe.
pub const UNIVERSE: usize = 512;

/// The longest time the engine accepts for a fade, a delay or a Fade to black (24 hours):
/// longer values, NaN and infinities are absurd and are cut or count as 0.
pub const MAX_SECONDS: f64 = 86_400.0;

/// A time in seconds as the engine uses it: finite, 0…`MAX_SECONDS` (NaN and −∞ → 0, +∞ → max).
pub fn clean_seconds(v: f64) -> f64 {
    if v.is_nan() {
        0.0
    } else {
        v.clamp(0.0, MAX_SECONDS)
    }
}

/// Deserialises a number that may arrive as `null` (JavaScript's `JSON.stringify` writes NaN,
/// Infinity and undefined as `null`): `null` = 0.
pub fn null_as_zero<'de, D: serde::Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(Option::<f64>::deserialize(d)?
        .map(clean_seconds)
        .unwrap_or(0.0))
}

fn null_as_false<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(Option::<bool>::deserialize(d)?.unwrap_or(false))
}

/// Times of a transition, in seconds (negative or missing values count as 0, see `clean_seconds`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    #[serde(default, deserialize_with = "null_as_zero")]
    pub fade_in: f64,
    #[serde(default, deserialize_with = "null_as_zero")]
    pub fade_out: f64,
    #[serde(default, deserialize_with = "null_as_zero")]
    pub delay: f64,
    #[serde(default, deserialize_with = "null_as_false")]
    pub move_in_dark: bool,
}

impl Transition {
    fn clean(v: f64) -> f64 {
        clean_seconds(v)
    }

    /// Seconds from the start to the end of the transition.
    pub fn duration(&self) -> f64 {
        Self::clean(self.delay) + Self::clean(self.fade_in).max(Self::clean(self.fade_out))
    }
}

/// What each channel is, as `FadeLayout` in crossfade.ts. Built by the TypeScript side
/// (`enginePayload.ts`) from the document: the engine knows nothing about lights.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    /// 1 = intensity channel, 0 = any other channel. Missing entries count as intensity.
    #[serde(default)]
    pub intensity: Vec<u8>,
    /// Index into `mover_intensity` of the moving head a non-intensity channel belongs to; −1 = none.
    #[serde(default)]
    pub mover: Vec<i16>,
    /// For each moving head, its intensity channels (0-based).
    #[serde(default)]
    pub mover_intensity: Vec<Vec<u16>>,
}

impl Layout {
    /// Every channel is intensity, no moving heads.
    #[cfg(test)]
    pub fn all_intensity(n: usize) -> Self {
        Layout {
            intensity: vec![1; n],
            mover: vec![-1; n],
            mover_intensity: Vec::new(),
        }
    }

    fn is_intensity(&self, ch: usize) -> bool {
        self.intensity.get(ch).is_none_or(|&v| v != 0)
    }

    fn mover_of(&self, ch: usize) -> Option<usize> {
        match self.mover.get(ch) {
            Some(&m) if m >= 0 && (m as usize) < self.mover_intensity.len() => Some(m as usize),
            _ => None,
        }
    }

    /// For each moving head: are all its intensity channels at 0 in `state`?
    /// A head without intensity channels is never dark; a channel outside the universe is not
    /// "at 0" (as in JavaScript, where it reads `undefined`), so such a head is not dark either.
    pub fn dark_heads(&self, state: &[u8]) -> Vec<bool> {
        self.mover_intensity
            .iter()
            .map(|chs| !chs.is_empty() && chs.iter().all(|&c| state.get(c as usize) == Some(&0)))
            .collect()
    }
}

fn progress(t: f64, delay: f64, duration: f64) -> f64 {
    if t < delay {
        return 0.0;
    }
    if duration <= 0.0 {
        return 1.0;
    }
    ((t - delay) / duration).min(1.0)
}

/// The state `t` seconds after the start, written into `out`. `dark_from` / `dark_to` are
/// `layout.dark_heads(from)` / `layout.dark_heads(to)` (computed once per fade by the engine).
#[allow(clippy::too_many_arguments)]
pub fn crossfade_into(
    from: &[u8],
    to: &[u8],
    t: f64,
    tr: &Transition,
    layout: &Layout,
    dark_from: &[bool],
    dark_to: &[bool],
    out: &mut [u8],
) {
    let delay = Transition::clean(tr.delay);
    let fade_in = Transition::clean(tr.fade_in);
    let fade_out = Transition::clean(tr.fade_out);
    let n = from.len().min(to.len()).min(out.len());
    for ch in 0..n {
        let a = from[ch];
        let b = to[ch];
        if a == b {
            out[ch] = a;
            continue;
        }
        let intensity = layout.is_intensity(ch);
        if tr.move_in_dark && !intensity {
            if let Some(m) = layout.mover_of(ch) {
                if dark_from.get(m).copied().unwrap_or(false) {
                    out[ch] = if t >= delay { b } else { a };
                    continue;
                }
                if dark_to.get(m).copied().unwrap_or(false) {
                    out[ch] = if t >= delay + fade_out { b } else { a };
                    continue;
                }
            }
        }
        let duration = if intensity {
            if b > a { fade_in } else { fade_out }
        } else {
            fade_in
        };
        let p = progress(t, delay, duration);
        let (a, b) = (a as f64, b as f64);
        out[ch] = (a + (b - a) * p + 0.5).floor().clamp(0.0, 255.0) as u8;
    }
}

/// Convenience form (tests): the state `t` seconds after the start.
#[cfg(test)]
pub fn crossfade_at(from: &[u8], to: &[u8], t: f64, tr: &Transition, layout: &Layout) -> Vec<u8> {
    let mut out = vec![0u8; from.len()];
    crossfade_into(
        from,
        to,
        t,
        tr,
        layout,
        &layout.dark_heads(from),
        &layout.dark_heads(to),
        &mut out,
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tr(fade_in: f64, fade_out: f64, delay: f64, move_in_dark: bool) -> Transition {
        Transition {
            fade_in,
            fade_out,
            delay,
            move_in_dark,
        }
    }

    fn lay(intensity: &[u8]) -> Layout {
        Layout {
            intensity: intensity.to_vec(),
            mover: vec![-1; intensity.len()],
            mover_intensity: vec![],
        }
    }

    /// Layout of the "mover" vectors: 0 = Main of a moving head, 1 = pan, 2 = tilt,
    /// 3 = an ordinary dimmer, 4 = a channel of no light.
    fn mover() -> Layout {
        Layout {
            intensity: vec![1, 0, 0, 1, 1],
            mover: vec![-1, 0, 0, -1, -1],
            mover_intensity: vec![vec![0]],
        }
    }

    fn check(layout: &Layout, from: &[u8], to: &[u8], t: &Transition, samples: &[(f64, &[u8])]) {
        for (time, expected) in samples {
            assert_eq!(
                crossfade_at(from, to, *time, t, layout),
                expected.to_vec(),
                "t = {time}"
            );
        }
    }

    // The vectors of crossfade.test.ts, copied as they are.

    #[test]
    fn same_time_up_and_down() {
        check(
            &lay(&[1, 1]),
            &[0, 255],
            &[255, 0],
            &tr(2.0, 2.0, 0.0, false),
            &[
                (-1.0, &[0, 255]),
                (0.0, &[0, 255]),
                (0.5, &[64, 191]),
                (1.0, &[128, 128]),
                (2.0, &[255, 0]),
                (10.0, &[255, 0]),
            ],
        );
    }

    #[test]
    fn separate_fade_in_and_fade_out() {
        check(
            &lay(&[1, 1, 1]),
            &[0, 200, 100],
            &[255, 0, 100],
            &tr(4.0, 1.0, 0.0, false),
            &[
                (0.5, &[32, 100, 100]),
                (1.0, &[64, 0, 100]),
                (2.0, &[128, 0, 100]),
                (4.0, &[255, 0, 100]),
            ],
        );
    }

    #[test]
    fn delay_holds_everything_then_the_fades_start() {
        check(
            &lay(&[1, 1]),
            &[10, 250],
            &[250, 10],
            &tr(2.0, 4.0, 1.5, false),
            &[
                (0.0, &[10, 250]),
                (1.5, &[10, 250]),
                (2.5, &[130, 190]),
                (3.5, &[250, 130]),
                (5.5, &[250, 10]),
            ],
        );
    }

    #[test]
    fn zero_times_jump_at_the_delay() {
        check(
            &lay(&[1, 0]),
            &[0, 0],
            &[255, 77],
            &tr(0.0, 0.0, 2.0, false),
            &[(1.999, &[0, 0]), (2.0, &[255, 77])],
        );
    }

    #[test]
    fn non_intensity_channels_move_with_the_fade_in_time_even_when_their_value_falls() {
        check(
            &lay(&[1, 0]),
            &[255, 200],
            &[0, 0],
            &tr(4.0, 1.0, 0.0, false),
            &[(1.0, &[0, 150]), (2.0, &[0, 100]), (4.0, &[0, 0])],
        );
    }

    #[test]
    fn move_in_dark_a_dark_moving_head_jumps_to_its_new_position_at_the_start() {
        check(
            &mover(),
            &[0, 0, 0, 0, 0],
            &[255, 200, 100, 255, 255],
            &tr(4.0, 2.0, 0.0, true),
            &[
                (0.0, &[0, 200, 100, 0, 0]),
                (2.0, &[128, 200, 100, 128, 128]),
                (4.0, &[255, 200, 100, 255, 255]),
            ],
        );
    }

    #[test]
    fn move_in_dark_a_lit_moving_head_that_goes_dark_moves_only_after_it_has_faded_out() {
        check(
            &mover(),
            &[255, 50, 60, 0, 0],
            &[0, 250, 160, 0, 0],
            &tr(4.0, 2.0, 1.0, true),
            &[
                (1.0, &[255, 50, 60, 0, 0]),
                (2.0, &[128, 50, 60, 0, 0]),
                (2.999, &[0, 50, 60, 0, 0]),
                (3.0, &[0, 250, 160, 0, 0]),
            ],
        );
    }

    #[test]
    fn move_in_dark_lit_at_both_ends_it_moves_in_view_with_the_fade_in_time() {
        check(
            &mover(),
            &[255, 0, 0, 0, 0],
            &[128, 200, 100, 0, 0],
            &tr(4.0, 2.0, 0.0, true),
            &[
                (1.0, &[192, 50, 25, 0, 0]),
                (2.0, &[128, 100, 50, 0, 0]),
                (4.0, &[128, 200, 100, 0, 0]),
            ],
        );
    }

    #[test]
    fn without_move_in_dark_a_dark_moving_head_moves_in_the_fade_in_time() {
        check(
            &mover(),
            &[0, 0, 0, 0, 0],
            &[255, 200, 100, 0, 0],
            &tr(4.0, 2.0, 0.0, false),
            &[(0.0, &[0, 0, 0, 0, 0]), (2.0, &[128, 100, 50, 0, 0])],
        );
    }

    #[test]
    fn rounds_half_up_with_floor_x_plus_half() {
        let l = lay(&[1]);
        assert_eq!(
            crossfade_at(&[0], &[1], 1.0, &tr(2.0, 0.0, 0.0, false), &l),
            vec![1]
        );
        assert_eq!(
            crossfade_at(&[1], &[0], 1.0, &tr(0.0, 2.0, 0.0, false), &l),
            vec![1]
        );
    }

    #[test]
    fn is_exactly_the_target_at_the_end_and_the_source_before_the_start() {
        let from: Vec<u8> = (0..512).map(|i| (i % 256) as u8).collect();
        let to: Vec<u8> = (0..512).map(|i| 255 - (i % 256) as u8).collect();
        let l = Layout::all_intensity(512);
        let t = tr(3.0, 5.0, 1.0, false);
        assert_eq!(t.duration(), 6.0);
        assert_eq!(crossfade_at(&from, &to, t.duration(), &t, &l), to);
        assert_eq!(crossfade_at(&from, &to, 0.99, &t, &l), from);
    }

    #[test]
    fn times_from_javascript_may_be_null_or_absurd() {
        let t: Transition =
            serde_json::from_str(r#"{"fadeIn":null,"fadeOut":1e308,"delay":-3,"moveInDark":null}"#)
                .unwrap();
        assert_eq!(t, tr(0.0, MAX_SECONDS, 0.0, false));
        let t: Transition = serde_json::from_str("{}").unwrap();
        assert_eq!(t.duration(), 0.0);
        assert_eq!(
            tr(f64::NAN, f64::INFINITY, f64::NEG_INFINITY, false).duration(),
            MAX_SECONDS
        );
        assert_eq!(
            tr(MAX_SECONDS, 0.0, MAX_SECONDS, false).duration(),
            2.0 * MAX_SECONDS
        );
    }

    #[test]
    fn a_head_whose_intensity_channel_is_outside_the_universe_is_not_dark() {
        let l = Layout {
            intensity: vec![0, 1],
            mover: vec![0, -1],
            mover_intensity: vec![vec![600]],
        };
        assert_eq!(l.dark_heads(&[0, 0]), vec![false]);
        // So with move in dark its position fades like any other channel.
        assert_eq!(
            crossfade_at(&[0, 0], &[200, 0], 1.0, &tr(2.0, 0.0, 0.0, true), &l),
            vec![100, 0]
        );
    }

    #[test]
    fn a_short_layout_treats_the_missing_channels_as_intensity() {
        let l = Layout::default();
        assert_eq!(
            crossfade_at(&[0, 200], &[200, 0], 1.0, &tr(2.0, 4.0, 0.0, false), &l),
            vec![100, 150]
        );
    }
}
