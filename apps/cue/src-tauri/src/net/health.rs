//! Heartbeat statistics and the link status shown on both computers (border and panel colour).
//!
//! Pure: every function takes the time (ms or µs of the link's own clock), so the thresholds are unit-tested.

use std::collections::VecDeque;

use serde::Serialize;

/// A heartbeat every 100 ms in each direction.
pub const HEARTBEAT_MS: u64 = 100;
/// No valid message for this long = link lost ("Scollegato").
pub const LOST_AFTER_MS: u64 = 1000;
/// Round trip (average of the last samples) at or above this = unstable.
pub const UNSTABLE_LATENCY_MS: f64 = 20.0;
/// This many heartbeats lost inside `LOSS_WINDOW_MS` = unstable.
pub const UNSTABLE_LOST_BEATS: u32 = 2;
/// Window of the lost-heartbeat count.
pub const LOSS_WINDOW_MS: u64 = 2000;
/// Back to stable only after this long without a reason to be unstable (no flicker).
pub const STABLE_AFTER_MS: u64 = 2000;
/// Round-trip samples averaged (1 s of heartbeats).
pub const LATENCY_SAMPLES: usize = 10;

/// What the border and the panel show.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// No secondary connected (or no link at all): neutral panel, no border.
    None,
    /// Green: heartbeats on time on the cable.
    Stable,
    /// Amber: high latency or lost heartbeats.
    Unstable,
    /// Amber: only the Wi-Fi backup path answers.
    Backup,
    /// Red: no heartbeat for `LOST_AFTER_MS`.
    Lost,
    /// Blue: the secondary pressed "Non disponibile".
    Unavailable,
}

/// Heartbeat bookkeeping of one connection.
#[derive(Debug, Default, Clone)]
pub struct Health {
    last_hb_n: Option<u64>,
    /// (time ms, heartbeats missing) noticed from gaps in the peer's heartbeat numbers.
    losses: VecDeque<(u64, u32)>,
    rtts_ms: VecDeque<f64>,
    /// Heartbeats the peer says it lost from us (its own window): the link is as bad as its worse direction.
    peer_lost: u32,
    /// Last time something made the link unstable.
    last_bad_ms: Option<u64>,
}

impl Health {
    pub fn new() -> Self {
        Self::default()
    }

    /// A heartbeat number `n` arrived at `now_ms`; `rtt_ms` if it echoed one of ours; `peer_lost` from its payload.
    pub fn on_heartbeat(&mut self, now_ms: u64, n: u64, rtt_ms: Option<f64>, peer_lost: u32) {
        if let Some(last) = self.last_hb_n {
            if n > last + 1 {
                let gap = (n - last - 1).min(1000) as u32;
                self.losses.push_back((now_ms, gap));
            }
        }
        if self.last_hb_n.is_none_or(|l| n > l) {
            self.last_hb_n = Some(n);
        }
        if let Some(r) = rtt_ms.filter(|r| r.is_finite() && *r >= 0.0) {
            self.rtts_ms.push_back(r);
            while self.rtts_ms.len() > LATENCY_SAMPLES {
                self.rtts_ms.pop_front();
            }
        }
        self.peer_lost = peer_lost;
        self.prune(now_ms);
        if self.is_bad(now_ms) {
            self.last_bad_ms = Some(now_ms);
        }
    }

    fn prune(&mut self, now_ms: u64) {
        while self.losses.front().is_some_and(|(t, _)| now_ms.saturating_sub(*t) > LOSS_WINDOW_MS) {
            self.losses.pop_front();
        }
    }

    /// Heartbeats lost in the last 2 s (the worse of the two directions).
    pub fn lost_beats(&self, now_ms: u64) -> u32 {
        let own: u32 = self.losses.iter().filter(|(t, _)| now_ms.saturating_sub(*t) <= LOSS_WINDOW_MS).map(|(_, n)| n).sum();
        own.max(self.peer_lost)
    }

    /// Our inbound loss count, sent to the peer in our heartbeats.
    pub fn own_lost(&self, now_ms: u64) -> u32 {
        self.losses.iter().filter(|(t, _)| now_ms.saturating_sub(*t) <= LOSS_WINDOW_MS).map(|(_, n)| n).sum()
    }

    /// Average round trip of the last second, in ms.
    pub fn latency_ms(&self) -> Option<f64> {
        (!self.rtts_ms.is_empty()).then(|| self.rtts_ms.iter().sum::<f64>() / self.rtts_ms.len() as f64)
    }

    fn is_bad(&self, now_ms: u64) -> bool {
        self.latency_ms().is_some_and(|l| l >= UNSTABLE_LATENCY_MS) || self.lost_beats(now_ms) >= UNSTABLE_LOST_BEATS
    }

    /// Unstable now, or less than `STABLE_AFTER_MS` ago.
    pub fn unstable(&self, now_ms: u64) -> bool {
        self.is_bad(now_ms) || self.last_bad_ms.is_some_and(|t| now_ms.saturating_sub(t) < STABLE_AFTER_MS)
    }
}

/// Everything the status depends on.
#[derive(Debug, Clone, Copy)]
pub struct StatusInput {
    /// A peer has been connected in this episode (otherwise: None).
    pub connected: bool,
    /// ms since the last valid message from the peer.
    pub since_rx_ms: u64,
    /// The best path (the cable) answers.
    pub main_path_alive: bool,
    /// Another path (the Wi-Fi backup) answers.
    pub backup_path_alive: bool,
    /// The secondary is "Non disponibile".
    pub unavailable: bool,
    pub unstable: bool,
}

/// Lost > Unavailable > Backup > Unstable > Stable.
pub fn classify(i: StatusInput) -> Status {
    if !i.connected {
        Status::None
    } else if i.since_rx_ms >= LOST_AFTER_MS {
        Status::Lost
    } else if i.unavailable {
        Status::Unavailable
    } else if !i.main_path_alive && i.backup_path_alive {
        Status::Backup
    } else if i.unstable {
        Status::Unstable
    } else {
        Status::Stable
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> StatusInput {
        StatusInput { connected: true, since_rx_ms: 50, main_path_alive: true, backup_path_alive: false, unavailable: false, unstable: false }
    }

    #[test]
    fn steady_heartbeats_are_stable() {
        let mut h = Health::new();
        for i in 0..30u64 {
            h.on_heartbeat(i * 100, i + 1, Some(0.4), 0);
        }
        assert_eq!(h.lost_beats(3000), 0);
        assert!((h.latency_ms().unwrap() - 0.4).abs() < 1e-9);
        assert!(!h.unstable(3000));
        assert_eq!(classify(StatusInput { unstable: h.unstable(3000), ..input() }), Status::Stable);
    }

    #[test]
    fn latency_threshold() {
        let mut h = Health::new();
        for i in 0..10u64 {
            h.on_heartbeat(i * 100, i + 1, Some(19.9), 0);
        }
        assert!(!h.unstable(1000));
        let mut h = Health::new();
        for i in 0..10u64 {
            h.on_heartbeat(i * 100, i + 1, Some(UNSTABLE_LATENCY_MS), 0);
        }
        assert!(h.unstable(1000));
    }

    #[test]
    fn lost_beats_threshold_and_window() {
        let mut h = Health::new();
        h.on_heartbeat(0, 1, Some(1.0), 0);
        h.on_heartbeat(200, 3, Some(1.0), 0); // one lost
        assert_eq!(h.lost_beats(200), 1);
        assert!(!h.unstable(200), "one lost heartbeat is not enough");
        h.on_heartbeat(400, 5, Some(1.0), 0); // two lost in 2 s
        assert_eq!(h.lost_beats(400), 2);
        assert!(h.unstable(400));
        // The losses leave the window after 2 s, stability comes back after STABLE_AFTER_MS more.
        let mut n = 6;
        let mut t = 500;
        while t <= 2500 {
            h.on_heartbeat(t, n, Some(1.0), 0);
            n += 1;
            t += 100;
        }
        assert_eq!(h.lost_beats(2500), 0);
        assert!(h.unstable(2300), "hysteresis");
        assert!(!h.unstable(2401 + STABLE_AFTER_MS));
    }

    #[test]
    fn peer_reported_losses_count() {
        let mut h = Health::new();
        h.on_heartbeat(0, 1, Some(1.0), 3);
        assert_eq!(h.lost_beats(0), 3);
        assert_eq!(h.own_lost(0), 0);
        assert!(h.unstable(0));
    }

    #[test]
    fn classify_priorities() {
        assert_eq!(classify(StatusInput { connected: false, ..input() }), Status::None);
        assert_eq!(classify(StatusInput { since_rx_ms: LOST_AFTER_MS - 1, ..input() }), Status::Stable);
        assert_eq!(classify(StatusInput { since_rx_ms: LOST_AFTER_MS, unavailable: true, ..input() }), Status::Lost);
        assert_eq!(classify(StatusInput { unavailable: true, unstable: true, ..input() }), Status::Unavailable);
        assert_eq!(classify(StatusInput { main_path_alive: false, backup_path_alive: true, unstable: true, ..input() }), Status::Backup);
        assert_eq!(classify(StatusInput { unstable: true, ..input() }), Status::Unstable);
    }
}
