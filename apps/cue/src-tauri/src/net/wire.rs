//! The envelope of every message and the replay window.
//!
//! A datagram is one UTF-8 JSON object `{"v":1,"kind":…,"seq":…,"sender":…,"ts":…,"payload":…,"mac":"<64 hex>"}`.
//! The MAC is HMAC-SHA256 over the exact bytes of the object **without** the `mac` field (`{"v":…,"payload":…}`),
//! so nothing has to be re-serialized to check it: the receiver cuts the fixed-length `,"mac":"…"}` tail.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::crypto;

/// Version of the envelope. A receiver drops other versions.
pub const VERSION: u32 = 1;
/// Largest datagram Cue sends or accepts (the payload of a state or an edit must stay below it).
pub const MAX_DATAGRAM: usize = 48 * 1024;
/// Sequence numbers remembered behind the highest one (messages may arrive out of order on two paths).
pub const REPLAY_WINDOW: u64 = 1024;

const MAC_HEAD: &[u8] = b",\"mac\":\"";
const MAC_TAIL: &[u8] = b"\"}";
const TAIL_LEN: usize = MAC_HEAD.len() + 64 + MAC_TAIL.len();

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u32,
    pub kind: String,
    /// From 1, one more for every datagram sent in a session (retransmissions get a new one).
    pub seq: u64,
    /// The sender's computer id.
    pub sender: String,
    /// The sender's clock in microseconds (its own epoch): echoed by heartbeats to measure the round trip.
    pub ts: u64,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WireError {
    TooBig,
    Malformed,
    BadVersion,
    BadMac,
}

/// Signs and serializes a message.
pub fn encode(env: &Envelope, key: &[u8]) -> Vec<u8> {
    let mut body = serde_json::to_vec(env).expect("an envelope always serializes");
    let tag = crypto::sign(key, &[&body]);
    debug_assert_eq!(body.last(), Some(&b'}'));
    body.pop();
    body.extend_from_slice(MAC_HEAD);
    body.extend_from_slice(crypto::to_hex(&tag).as_bytes());
    body.extend_from_slice(MAC_TAIL);
    body
}

/// A received datagram, parsed but not yet verified (the key depends on its kind and sender).
pub struct Unverified {
    pub env: Envelope,
    signed: Vec<u8>,
    tag: Vec<u8>,
}

impl Unverified {
    pub fn verify(&self, key: &[u8]) -> bool {
        crypto::verify(key, &self.signed, &self.tag)
    }
}

/// Parses a datagram without checking its MAC.
pub fn parse(bytes: &[u8]) -> Result<Unverified, WireError> {
    if bytes.len() > MAX_DATAGRAM {
        return Err(WireError::TooBig);
    }
    if bytes.len() <= TAIL_LEN + 2 {
        return Err(WireError::Malformed);
    }
    let cut = bytes.len() - TAIL_LEN;
    let tail = &bytes[cut..];
    if !tail.starts_with(MAC_HEAD) || !tail.ends_with(MAC_TAIL) {
        return Err(WireError::Malformed);
    }
    let tag = crypto::from_hex(std::str::from_utf8(&tail[MAC_HEAD.len()..MAC_HEAD.len() + 64]).map_err(|_| WireError::Malformed)?)
        .ok_or(WireError::Malformed)?;
    let mut signed = bytes[..cut].to_vec();
    signed.push(b'}');
    let env: Envelope = serde_json::from_slice(&signed).map_err(|_| WireError::Malformed)?;
    if env.v != VERSION {
        return Err(WireError::BadVersion);
    }
    if env.seq == 0 {
        return Err(WireError::Malformed);
    }
    Ok(Unverified { env, signed, tag })
}

/// Parses and verifies with one key.
pub fn decode(bytes: &[u8], key: &[u8]) -> Result<Envelope, WireError> {
    let u = parse(bytes)?;
    if !u.verify(key) {
        return Err(WireError::BadMac);
    }
    Ok(u.env)
}

/// Accepts each sequence number once: newer than the highest, or inside the window and not seen yet.
/// Drops replays and the second copy of a message sent on two paths (Wi-Fi backup).
#[derive(Debug, Default, Clone)]
pub struct ReplayWindow {
    highest: u64,
    seen: BTreeSet<u64>,
}

impl ReplayWindow {
    pub fn new() -> Self {
        Self::default()
    }

    /// Would `seq` be accepted? (Does not record it.)
    pub fn fresh(&self, seq: u64) -> bool {
        if seq == 0 {
            return false;
        }
        if seq > self.highest {
            return true;
        }
        self.highest - seq < REPLAY_WINDOW && !self.seen.contains(&seq)
    }

    /// Records `seq`; false if it is a replay or a duplicate.
    pub fn accept(&mut self, seq: u64) -> bool {
        if !self.fresh(seq) {
            return false;
        }
        self.seen.insert(seq);
        if seq > self.highest {
            self.highest = seq;
            let floor = self.highest.saturating_sub(REPLAY_WINDOW - 1);
            self.seen = self.seen.split_off(&floor);
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn env(seq: u64) -> Envelope {
        Envelope { v: VERSION, kind: "hb".into(), seq, sender: "abc".into(), ts: 42, payload: json!({ "n": 1, "text": "è \"ok\"" }) }
    }

    #[test]
    fn encodes_signed_json() {
        let key = [7u8; 32];
        let bytes = encode(&env(3), &key);
        let v: Value = serde_json::from_slice(&bytes).expect("the datagram is JSON");
        assert_eq!(v["kind"], "hb");
        assert_eq!(v["mac"].as_str().unwrap().len(), 64);
        assert_eq!(decode(&bytes, &key).unwrap(), env(3));
    }

    #[test]
    fn rejects_bad_mac_and_tampering() {
        let key = [7u8; 32];
        let bytes = encode(&env(3), &key);
        assert_eq!(decode(&bytes, &[8u8; 32]), Err(WireError::BadMac));
        let tampered = String::from_utf8(bytes.clone()).unwrap().replace("\"seq\":3", "\"seq\":4");
        assert_eq!(decode(tampered.as_bytes(), &key), Err(WireError::BadMac));
        let mut flipped = bytes.clone();
        let i = flipped.len() - 5;
        flipped[i] = if flipped[i] == b'0' { b'1' } else { b'0' };
        assert_eq!(decode(&flipped, &key), Err(WireError::BadMac));
        assert_eq!(decode(b"{}", &key).err(), Some(WireError::Malformed));
        assert_eq!(decode(&bytes[..bytes.len() - 1], &key).err(), Some(WireError::Malformed));
        assert_eq!(decode(&vec![b' '; MAX_DATAGRAM + 1], &key).err(), Some(WireError::TooBig));
    }

    #[test]
    fn rejects_other_versions_and_seq_zero() {
        let key = [1u8; 32];
        let mut e = env(1);
        e.v = 2;
        assert_eq!(decode(&encode(&e, &key), &key).err(), Some(WireError::BadVersion));
        assert_eq!(decode(&encode(&env(0), &key), &key).err(), Some(WireError::Malformed));
    }

    #[test]
    fn replay_window_drops_replays_and_duplicates() {
        let mut w = ReplayWindow::new();
        assert!(w.accept(1));
        assert!(w.accept(2));
        assert!(!w.accept(2), "duplicate (same message on the second path)");
        assert!(w.accept(5));
        assert!(w.accept(4), "late but inside the window");
        assert!(!w.accept(4));
        assert!(w.accept(3));
        assert!(!w.accept(0));
        assert!(w.accept(5000));
        assert!(!w.accept(5000 - REPLAY_WINDOW), "too old");
        assert!(w.accept(5000 - REPLAY_WINDOW + 1), "oldest still inside");
        assert!(!w.accept(10), "replay of an old message");
        assert!(w.seen.len() <= REPLAY_WINDOW as usize);
    }
}
