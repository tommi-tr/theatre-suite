//! Messages that must arrive: requests of the secondary, events of the primary, chat, file notices.
//!
//! The sender keeps each one in the `Outbox` and sends it again every `RETRY_MS` until the `ack`
//! comes back, for at most `GIVE_UP_MS`. The receiver remembers what it answered for each id in the
//! `Inbox`: a repeated message gets the same answer and is **not** applied twice (idempotent by id).
//! Pure: times are ms of the link's clock.

use std::collections::HashMap;

use serde_json::Value;

/// Resend an unacknowledged message this often.
pub const RETRY_MS: u64 = 100;
/// Give up (and report a failure) after this long.
pub const GIVE_UP_MS: u64 = 1000;
/// How long a receiver remembers an id (longer than `GIVE_UP_MS`).
pub const REMEMBER_MS: u64 = 10_000;

/// Channel of a reliable message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Priority {
    /// GO and safety requests, events, file notices: sent at once.
    High,
    /// Chat: never ahead of a high-priority message.
    Low,
}

#[derive(Debug, Clone)]
pub struct Pending {
    pub rid: String,
    pub chan: String,
    pub body: Value,
    pub priority: Priority,
    first_ms: u64,
    last_ms: u64,
    pub attempts: u32,
}

#[derive(Debug, Default)]
pub struct Outbox {
    items: Vec<Pending>,
}

impl Outbox {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a message that has just been sent for the first time.
    pub fn push(&mut self, rid: String, chan: &str, body: Value, priority: Priority, now_ms: u64) {
        self.items.push(Pending { rid, chan: chan.to_string(), body, priority, first_ms: now_ms, last_ms: now_ms, attempts: 1 });
    }

    /// The messages to send again now (their clock is updated).
    pub fn due(&mut self, now_ms: u64) -> Vec<Pending> {
        let mut out = Vec::new();
        for p in self.items.iter_mut() {
            if now_ms.saturating_sub(p.first_ms) < GIVE_UP_MS && now_ms.saturating_sub(p.last_ms) >= RETRY_MS {
                p.last_ms = now_ms;
                p.attempts += 1;
                out.push(p.clone());
            }
        }
        out
    }

    /// Removes and returns the messages given up.
    pub fn expired(&mut self, now_ms: u64) -> Vec<Pending> {
        let (gone, keep): (Vec<_>, Vec<_>) = self.items.drain(..).partition(|p| now_ms.saturating_sub(p.first_ms) >= GIVE_UP_MS);
        self.items = keep;
        gone
    }

    /// The ack arrived: true if the message was waiting.
    pub fn ack(&mut self, rid: &str) -> Option<Pending> {
        let i = self.items.iter().position(|p| p.rid == rid)?;
        Some(self.items.remove(i))
    }

    /// Everything still waiting (the link dropped: they all fail).
    pub fn drain(&mut self) -> Vec<Pending> {
        std::mem::take(&mut self.items)
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

#[derive(Debug, Default)]
pub struct Inbox {
    answered: HashMap<String, (u64, Value)>,
}

impl Inbox {
    pub fn new() -> Self {
        Self::default()
    }

    /// The answer already given to `rid`, if it was seen.
    pub fn answered(&self, rid: &str) -> Option<&Value> {
        self.answered.get(rid).map(|(_, v)| v)
    }

    pub fn record(&mut self, rid: &str, answer: Value, now_ms: u64) {
        self.answered.insert(rid.to_string(), (now_ms, answer));
        if self.answered.len() > 256 {
            self.prune(now_ms);
        }
    }

    pub fn prune(&mut self, now_ms: u64) {
        self.answered.retain(|_, (t, _)| now_ms.saturating_sub(*t) < REMEMBER_MS);
    }

    pub fn clear(&mut self) {
        self.answered.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn retries_every_100_ms_until_acked() {
        let mut o = Outbox::new();
        o.push("r1".into(), "req", json!({ "kind": "go" }), Priority::High, 0);
        assert!(o.due(50).is_empty(), "not yet");
        let d = o.due(100);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].attempts, 2);
        assert!(o.due(150).is_empty());
        assert_eq!(o.due(200).len(), 1);
        assert_eq!(o.ack("r1").map(|p| p.rid), Some("r1".to_string()));
        assert!(o.ack("r1").is_none(), "a second ack changes nothing");
        assert!(o.due(300).is_empty());
        assert!(o.is_empty());
    }

    #[test]
    fn gives_up_after_one_second() {
        let mut o = Outbox::new();
        o.push("r1".into(), "req", json!({}), Priority::High, 0);
        o.push("r2".into(), "chat", json!({}), Priority::Low, 500);
        let mut sends = 1;
        let mut t = 0;
        while t < GIVE_UP_MS {
            t += 10;
            sends += o.due(t).iter().filter(|p| p.rid == "r1").count();
        }
        assert_eq!(sends, 10, "first send + 9 retries inside one second");
        let gone = o.expired(GIVE_UP_MS);
        assert_eq!(gone.iter().map(|p| p.rid.as_str()).collect::<Vec<_>>(), vec!["r1"]);
        assert_eq!(o.len(), 1);
        assert_eq!(o.drain().len(), 1);
    }

    #[test]
    fn inbox_answers_a_repeat_without_applying_it_again() {
        let mut i = Inbox::new();
        assert!(i.answered("r1").is_none());
        i.record("r1", json!({ "ok": true }), 0);
        assert_eq!(i.answered("r1"), Some(&json!({ "ok": true })));
        i.prune(REMEMBER_MS - 1);
        assert!(i.answered("r1").is_some());
        i.prune(REMEMBER_MS);
        assert!(i.answered("r1").is_none());
    }
}
