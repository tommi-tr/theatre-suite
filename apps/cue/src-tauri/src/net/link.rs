//! The link engine: one primary, one secondary, over UDP (messages) and TCP (files).
//!
//! Threads (none of them is the interface's, and the primary's GO never waits for the network):
//! - **receiver**: reads datagrams, checks them, updates the state, answers;
//! - **ticker** (every 20 ms): heartbeats, HELLO, retries, lost detection, the low-priority queue
//!   (chat and pointer, at most one datagram per 100 ms), the state shown to the interface;
//! - **file server** (primary) and one **fetch** thread per transfer (secondary).
//!
//! Everything the interface needs goes out through the `Sink` (`cue-link-state`, `cue-link-event`,
//! `cue-link-chat`, `cue-link-pointer`, `cue-link-file`). See docs/cue/NETWORK.md.

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr, TcpListener, UdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::addr;
use super::crypto::{self, Key, Nonce, OPEN_KEY};
use super::health::{self, HEARTBEAT_MS, Health, LOST_AFTER_MS, Status, StatusInput};
use super::reliable::{GIVE_UP_MS, Inbox, Outbox, Priority};
use super::store::{Role, Stored, StoredPairing};
use super::transfer::{self, Prepared};
use super::wire::{self, Envelope, MAX_DATAGRAM, ReplayWindow};

/// The secondary sends HELLO this often while it looks for the primary.
pub const HELLO_MS: u64 = 500;
/// With the Wi-Fi backup on, the secondary probes every interface this often to find new paths.
pub const PROBE_MS: u64 = 1000;
/// The primary sends its playback state again this often (a lost datagram heals by itself).
pub const STATE_REFRESH_MS: u64 = 1000;
/// Chat and pointer: at most one datagram per this many ms (10 Hz).
pub const LOW_PRIORITY_MS: u64 = 100;
/// The interface gets the link state at least this often (latency) and at once on any change.
pub const INFO_EVERY_MS: u64 = 500;
/// Wrong codes accepted before the primary draws a new one.
pub const PAIR_ATTEMPTS: u32 = 5;
/// The secondary sends its code again this often, for this long.
pub const PAIR_RETRY_MS: u64 = 300;
pub const PAIR_GIVE_UP_MS: u64 = 3000;
/// Longest chat message, in characters.
pub const CHAT_MAX: usize = 500;
const TICK: Duration = Duration::from_millis(20);
const RECV_TIMEOUT: Duration = Duration::from_millis(50);

/// Requests a secondary may send while its commands are taken away.
const ALWAYS_ALLOWED: &[&str] = &["release", "available", "unavailable"];
/// Safety commands: accepted from the secondary always, also when its commands are taken away (director's decision).
const SAFETY: &[&str] = &["pause", "blackout", "fadeToBlack", "emergency"];
/// Requests refused while the primary holds the reservation.
const RESERVABLE: &[&str] = &["go", "back", "standby"];
/// Requests known to the primary.
pub const REQUESTS: &[&str] = &[
    "go", "back", "pause", "blackout", "fadeToBlack", "emergency", "stopAudio", "standby", "edit", "reserve", "release", "available", "unavailable",
];

pub type Sink = Arc<dyn Fn(&str, Value) + Send + Sync>;

#[derive(Debug, Clone)]
pub struct LinkConfig {
    pub udp_port: u16,
    pub tcp_port: u16,
    /// UDP ports the secondary sends HELLO to (the primary's port; with instances, every instance's).
    pub discovery_ports: Vec<u16>,
    /// Accept 127.0.0.1 as the peer (two instances on one computer: development and tests only).
    pub allow_loopback: bool,
    /// `link.json`; None = remember nothing (tests).
    pub store_path: Option<PathBuf>,
    /// Where the secondary keeps the shows it receives.
    pub received_dir: PathBuf,
    /// Name shown to the other computer when none is set.
    pub default_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Holder {
    None,
    Primary,
    Secondary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// Role "none": the network is off.
    Off,
    /// Looking for the other computer (secondary), or waiting for the paired secondary (primary).
    Searching,
    /// Primary: showing the code. Secondary: a primary was found, the code must be typed.
    Pairing,
    Connected,
    /// Was connected, the heartbeat stopped.
    Lost,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo {
    pub address: String,
    pub alive: bool,
    /// The cable (link-local, typed by hand, or loopback).
    pub main: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub id: String,
    pub name: String,
    pub paths: Vec<PathInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundInfo {
    pub id: String,
    pub name: String,
    pub address: String,
    /// The primary shows a code: type it.
    pub pairing: bool,
    /// The primary is paired with another computer.
    pub busy: bool,
}

/// The state of the link, for the interface (`cue-link-state`, `link_info`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
    pub role: Role,
    pub phase: Phase,
    pub status: Status,
    /// Round trip, average of the last second (ms).
    pub latency_ms: Option<f64>,
    /// Heartbeats lost in the last 2 s.
    pub lost_beats: u32,
    /// When the link was lost (Unix ms): "Scollegato da 0:04" counts from here.
    pub lost_at: Option<u64>,
    pub me: PeerInfo,
    pub peer: Option<PeerInfo>,
    /// A pairing is remembered (no code needed): the other computer's name.
    pub paired_with: Option<String>,
    /// Primary: the 6-digit code to show.
    pub pairing_code: Option<String>,
    /// `code` (wrong code), `attempts` (too many: new code), `busy` (paired with another), `noAnswer`.
    pub pairing_error: Option<String>,
    pub attempts_left: Option<u32>,
    /// Secondary: the primary found on the network.
    pub found: Option<FoundInfo>,
    pub reservation: Holder,
    pub commands_taken: bool,
    /// The secondary's availability ("Non disponibile" = false).
    pub peer_available: bool,
    pub wifi_backup: bool,
    pub manual_peer: Option<String>,
    pub firewall_notice_seen: bool,
    pub udp_port: u16,
    pub tcp_port: u16,
    /// `portBusy: …` when the port cannot be opened (another Cue?).
    pub error: Option<String>,
}

/// The answer to a request of the secondary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub request_id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Configure {
    pub role: Option<Role>,
    pub wifi_backup: Option<bool>,
    /// Some("") clears it.
    pub manual_peer: Option<String>,
    /// Some("") = the computer's name.
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendShow {
    pub show_id: String,
    pub tcue_path: String,
    #[serde(default)]
    pub extra_paths: Vec<String>,
    /// A newer show.json than the one in the file (edits not saved yet).
    pub show_json: Option<String>,
}

struct Session {
    key: Key,
    nonce_p: Nonce,
    nonce_s: Nonce,
    window: ReplayWindow,
    tx_seq: u64,
    created_ms: u64,
}

impl Session {
    fn new(key: Key, nonce_p: Nonce, nonce_s: Nonce, now: u64) -> Self {
        Session { key, nonce_p, nonce_s, window: ReplayWindow::new(), tx_seq: 0, created_ms: now }
    }
}

struct PathState {
    addr: SocketAddr,
    rank: u8,
    last_rx_ms: u64,
}

struct Peer {
    id: String,
    name: String,
    paths: Vec<PathState>,
}

struct Found {
    id: String,
    name: String,
    addr: SocketAddr,
    nonce_p: Nonce,
    pairing: bool,
    busy: bool,
}

struct PairTry {
    code: String,
    nonce_p: Nonce,
    nonce_s: Nonce,
    to: SocketAddr,
    peer_id: String,
    started_ms: u64,
    last_ms: u64,
}

#[derive(Default)]
struct Out {
    datagrams: Vec<(Vec<u8>, SocketAddr)>,
    events: Vec<(&'static str, Value)>,
    fetch: Option<(transfer::Manifest, SocketAddr)>,
    info_changed: bool,
}

impl Out {
    fn emit(&mut self, name: &'static str, v: Value) {
        self.events.push((name, v));
    }
}

#[derive(Clone, Copy)]
struct Now {
    ms: u64,
    us: u64,
    unix_ms: u64,
}

struct Inner {
    stored: Stored,
    error: Option<String>,
    session: Option<Session>,
    pending: Option<Session>,
    peer: Option<Peer>,
    connected: bool,
    lost: bool,
    last_rx_ms: u64,
    lost_at: Option<u64>,
    health: Health,
    hb_n: u64,
    last_hb_ms: u64,
    peer_hb: Option<(u64, u64)>,
    open_seq: u64,
    // Primary pairing.
    code: Option<String>,
    code_nonce: Nonce,
    attempts_left: u32,
    pair_error: Option<String>,
    // Secondary discovery.
    hello_nonce: Nonce,
    last_hello_ms: Option<u64>,
    last_probe_ms: u64,
    found: Option<Found>,
    pair_try: Option<PairTry>,
    broadcasts: Vec<std::net::Ipv4Addr>,
    broadcasts_ms: Option<u64>,
    // Control: decided by the primary, mirrored by the secondary from its heartbeats.
    holder: Holder,
    commands_taken: bool,
    peer_available: bool,
    peer_wifi: bool,
    // Reliable messages.
    outbox: Outbox,
    inbox: Inbox,
    waiters: HashMap<String, mpsc::Sender<Outcome>>,
    // Primary's playback state.
    state_rev: u64,
    state: Option<Value>,
    state_sent_ms: u64,
    peer_state_rev: u64,
    // Low priority.
    chat_queue: VecDeque<(String, Value)>,
    pointer: Option<Value>,
    last_low_ms: u64,
    // Files.
    offer: Option<Arc<Prepared>>,
    // Interface.
    last_info: Option<LinkInfo>,
    last_info_ms: u64,
}

struct Shared {
    cfg: LinkConfig,
    sink: Sink,
    epoch: Instant,
    inner: Mutex<Inner>,
    socket: Mutex<Option<Arc<UdpSocket>>>,
}

struct Runtime {
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

/// One link (one per Cue process).
pub struct Link {
    shared: Arc<Shared>,
    runtime: Mutex<Option<Runtime>>,
}

fn unix_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn nonce_hex(s: &Value, k: &str) -> Option<Nonce> {
    crypto::from_hex_array::<16>(s.get(k)?.as_str()?)
}

fn str_of(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or_default().chars().take(80).collect()
}

fn lock(m: &Mutex<Inner>) -> MutexGuard<'_, Inner> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Shared {
    fn now(&self) -> Now {
        let d = self.epoch.elapsed();
        Now { ms: d.as_millis() as u64, us: d.as_micros() as u64, unix_ms: unix_ms() }
    }

    fn name(&self, inner: &Inner) -> String {
        inner.stored.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| self.cfg.default_name.clone())
    }

    /// Runs `f` under the lock, then sends and emits what it produced (outside the lock).
    fn with<R>(self: &Arc<Self>, f: impl FnOnce(&mut Inner, &mut Out, Now) -> R) -> R {
        let now = self.now();
        let mut out = Out::default();
        let (r, info) = {
            let mut inner = lock(&self.inner);
            let r = f(&mut inner, &mut out, now);
            if inner.stored.role != Role::None {
                self.check_lost(&mut inner, &mut out, now);
            }
            let info = self.refresh_info(&mut inner, &mut out, now);
            (r, info)
        };
        self.flush(out, info);
        r
    }

    fn flush(self: &Arc<Self>, out: Out, info: Option<LinkInfo>) {
        // Local events first: the interface hears of a request before the other computer gets the ack.
        if let Some(info) = info {
            (self.sink)("cue-link-state", serde_json::to_value(info).unwrap_or(Value::Null));
        }
        for (name, v) in out.events {
            (self.sink)(name, v);
        }
        if !out.datagrams.is_empty() {
            let sock = self.socket.lock().unwrap_or_else(|e| e.into_inner()).clone();
            if let Some(sock) = sock {
                for (bytes, to) in &out.datagrams {
                    let _ = sock.send_to(bytes, to);
                }
            }
        }
        if let Some((manifest, addr)) = out.fetch {
            let shared = self.clone();
            std::thread::Builder::new().name("cue-link-fetch".into()).spawn(move || run_fetch(shared, manifest, addr)).ok();
        }
    }

    /// The info, if it changed or is due.
    fn refresh_info(&self, inner: &mut Inner, out: &mut Out, now: Now) -> Option<LinkInfo> {
        let info = self.info_of(inner, now);
        let changed = match &inner.last_info {
            None => true,
            Some(old) => {
                let mut a = old.clone();
                a.latency_ms = info.latency_ms;
                a != info
            }
        };
        let due = now.ms.saturating_sub(inner.last_info_ms) >= INFO_EVERY_MS && inner.stored.role != Role::None;
        if changed || due || out.info_changed {
            inner.last_info = Some(info.clone());
            inner.last_info_ms = now.ms;
            Some(info)
        } else {
            None
        }
    }

    fn info_of(&self, inner: &Inner, now: Now) -> LinkInfo {
        let role = inner.stored.role;
        let status = if role == Role::None { Status::None } else { status_of(inner, now.ms) };
        let phase = if role == Role::None {
            Phase::Off
        } else if inner.connected && inner.lost {
            Phase::Lost
        } else if inner.connected {
            Phase::Connected
        } else if (role == Role::Primary && inner.code.is_some()) || (role == Role::Secondary && inner.found.as_ref().is_some_and(|f| f.pairing)) {
            Phase::Pairing
        } else {
            Phase::Searching
        };
        let paths_of = |p: &Peer| {
            let best = p.paths.iter().map(|x| x.rank).min().unwrap_or(0);
            p.paths
                .iter()
                .map(|x| PathInfo { address: x.addr.to_string(), alive: now.ms.saturating_sub(x.last_rx_ms) < LOST_AFTER_MS, main: x.rank == best })
                .collect()
        };
        let connected = inner.connected && !inner.lost;
        LinkInfo {
            role,
            phase,
            status,
            latency_ms: if connected { inner.health.latency_ms() } else { None },
            lost_beats: if connected { inner.health.lost_beats(now.ms) } else { 0 },
            lost_at: if inner.connected && inner.lost { inner.lost_at } else { None },
            me: PeerInfo { id: inner.stored.id.clone(), name: self.name(inner), paths: vec![] },
            peer: inner.peer.as_ref().map(|p| PeerInfo { id: p.id.clone(), name: p.name.clone(), paths: paths_of(p) }),
            paired_with: inner.stored.pairing.as_ref().map(|p| p.peer_name.clone()),
            pairing_code: if role == Role::Primary { inner.code.clone() } else { None },
            pairing_error: inner.pair_error.clone(),
            attempts_left: if role == Role::Primary && inner.code.is_some() { Some(inner.attempts_left) } else { None },
            found: if role == Role::Secondary && !inner.connected {
                inner.found.as_ref().map(|f| FoundInfo { id: f.id.clone(), name: f.name.clone(), address: f.addr.ip().to_string(), pairing: f.pairing, busy: f.busy })
            } else {
                None
            },
            reservation: inner.holder,
            commands_taken: inner.commands_taken,
            peer_available: inner.peer_available,
            wifi_backup: wifi_on(inner),
            manual_peer: inner.stored.manual_peer.clone(),
            firewall_notice_seen: inner.stored.firewall_notice_seen,
            udp_port: self.cfg.udp_port,
            tcp_port: self.cfg.tcp_port,
            error: inner.error.clone(),
        }
    }

    // ---------------- Sending ----------------

    fn open_msg(&self, inner: &mut Inner, kind: &str, payload: Value, key: &[u8], now: Now) -> Vec<u8> {
        inner.open_seq += 1;
        let env = Envelope { v: wire::VERSION, kind: kind.into(), seq: inner.open_seq, sender: inner.stored.id.clone(), ts: now.us, payload };
        wire::encode(&env, key)
    }

    /// A session message to the peer, on its paths (all live ones with the Wi-Fi backup, else the best).
    fn send_session(&self, inner: &mut Inner, out: &mut Out, kind: &str, payload: Value, now: Now) -> bool {
        let targets = targets_of(inner, now.ms);
        let Some(s) = inner.session.as_mut() else { return false };
        if targets.is_empty() {
            return false;
        }
        s.tx_seq += 1;
        let env = Envelope { v: wire::VERSION, kind: kind.into(), seq: s.tx_seq, sender: inner.stored.id.clone(), ts: now.us, payload };
        let bytes = wire::encode(&env, &s.key);
        if bytes.len() > MAX_DATAGRAM {
            return false;
        }
        for t in targets {
            out.datagrams.push((bytes.clone(), t));
        }
        true
    }

    fn send_rel(&self, inner: &mut Inner, out: &mut Out, chan: &str, body: Value, priority: Priority, now: Now) -> Option<String> {
        if !link_up(inner) {
            return None;
        }
        let rid = crypto::new_id();
        let payload = json!({ "rid": rid, "chan": chan, "body": body });
        if !self.send_session(inner, out, "rel", payload, now) {
            return None;
        }
        inner.outbox.push(rid.clone(), chan, body, priority, now.ms);
        Some(rid)
    }

    fn heartbeat(&self, inner: &mut Inner, out: &mut Out, now: Now) {
        inner.hb_n += 1;
        inner.last_hb_ms = now.ms;
        let (echo, held) = match inner.peer_hb {
            Some((ts, rx_us)) => (Some(ts), now.us.saturating_sub(rx_us)),
            None => (None, 0),
        };
        let mut p = json!({ "n": inner.hb_n, "echo": echo, "held": held, "lost": inner.health.own_lost(now.ms), "name": self.name(inner) });
        if inner.stored.role == Role::Primary {
            p["holder"] = json!(inner.holder);
            p["taken"] = json!(inner.commands_taken);
            p["avail"] = json!(inner.peer_available);
            p["wifi"] = json!(inner.stored.wifi_backup);
        }
        self.send_session(inner, out, "hb", p, now);
    }

    // ---------------- Receiving ----------------

    fn on_datagram(&self, inner: &mut Inner, out: &mut Out, bytes: &[u8], from: SocketAddr, now: Now) {
        if !addr::allowed(from.ip(), self.cfg.allow_loopback) {
            return;
        }
        let Ok(u) = wire::parse(bytes) else { return };
        if u.env.sender == inner.stored.id || u.env.sender.len() != 32 {
            return;
        }
        let role = inner.stored.role;
        let kind = u.env.kind.as_str();
        match (role, kind) {
            (Role::Primary, "hello") => self.primary_hello(inner, out, &u, from, now),
            (Role::Primary, "pair") => self.primary_pair(inner, out, &u, from, now),
            (Role::Secondary, "offer") => {
                if !u.verify(OPEN_KEY) {
                    return;
                }
                let p = &u.env.payload;
                let Some(nonce_p) = nonce_hex(p, "nonce") else { return };
                let pairing = p.get("pairing").and_then(Value::as_bool).unwrap_or(false);
                let busy = p.get("busy").and_then(Value::as_bool).unwrap_or(false);
                // A primary showing a code wins over a busy one; the first one found is kept.
                let replace = match &inner.found {
                    None => true,
                    Some(f) => f.id == u.env.sender || (pairing && !f.pairing),
                };
                if replace {
                    inner.found = Some(Found { id: u.env.sender.clone(), name: str_of(p, "name"), addr: from, nonce_p, pairing, busy });
                }
            }
            (Role::Secondary, "pairFail") => {
                if !u.verify(OPEN_KEY) || inner.pair_try.as_ref().is_none_or(|t| t.peer_id != u.env.sender) {
                    return;
                }
                let reason = u.env.payload.get("reason").and_then(Value::as_str).unwrap_or("code");
                inner.pair_error = Some(if reason == "attempts" { "attempts".into() } else if reason == "busy" { "busy".into() } else { "code".into() });
                inner.pair_try = None;
                if reason == "attempts" {
                    inner.found = None;
                }
            }
            (Role::Secondary, "welcome") => {
                let Some(t) = inner.pair_try.as_ref() else { return };
                if t.peer_id != u.env.sender {
                    return;
                }
                let key = crypto::pair_key(&t.code, &t.nonce_p, &t.nonce_s);
                if !u.verify(&key) || nonce_hex(&u.env.payload, "echo") != Some(t.nonce_s) {
                    return;
                }
                let (nonce_p, nonce_s) = (t.nonce_p, t.nonce_s);
                let name = str_of(&u.env.payload, "name");
                inner.stored.pairing = Some(StoredPairing { peer_id: u.env.sender.clone(), peer_name: name.clone(), key: crypto::to_hex(&key) });
                let _ = inner.stored.save(self.cfg.store_path.as_deref());
                inner.pair_try = None;
                inner.pair_error = None;
                inner.found = None;
                self.start_session(inner, out, &u.env.sender, &name, crypto::session_key(&key, &nonce_p, &nonce_s), nonce_p, nonce_s, from, now);
                out.emit("cue-link-event", json!({ "type": "paired", "peer": name }));
            }
            (Role::Secondary, "accept") => {
                let Some(pk) = paired_key(inner, &u.env.sender) else { return };
                if !u.verify(&pk) || nonce_hex(&u.env.payload, "echo") != Some(inner.hello_nonce) {
                    return;
                }
                let Some(nonce_p) = nonce_hex(&u.env.payload, "nonce") else { return };
                let nonce_s = inner.hello_nonce;
                if inner.session.as_ref().is_some_and(|s| s.nonce_p == nonce_p && s.nonce_s == nonce_s) {
                    return; // the same accept again
                }
                let name = str_of(&u.env.payload, "name");
                self.start_session(inner, out, &u.env.sender, &name, crypto::session_key(&pk, &nonce_p, &nonce_s), nonce_p, nonce_s, from, now);
            }
            _ => self.session_msg(inner, out, &u, from, now),
        }
    }

    fn primary_hello(&self, inner: &mut Inner, out: &mut Out, u: &wire::Unverified, from: SocketAddr, now: Now) {
        let p = &u.env.payload;
        let sender = u.env.sender.clone();
        let Some(nonce_s) = nonce_hex(p, "nonce") else { return };
        let paired = p.get("paired").and_then(Value::as_bool).unwrap_or(false);
        if paired {
            // A paired secondary: proves it has the key; a new session is proposed (adopted at its first message).
            let Some(pk) = paired_key(inner, &sender) else { return };
            if !u.verify(&pk) {
                return;
            }
            self.learn_path(inner, &sender, &str_of(p, "name"), from, now);
            let reuse = inner.pending.as_ref().is_some_and(|s| s.nonce_s == nonce_s);
            if !reuse {
                let nonce_p = crypto::random::<16>();
                inner.pending = Some(Session::new(crypto::session_key(&pk, &nonce_p, &nonce_s), nonce_p, nonce_s, now.ms));
            }
            let nonce_p = inner.pending.as_ref().map(|s| s.nonce_p).unwrap_or_default();
            let payload = json!({ "name": self.name(inner), "nonce": crypto::to_hex(&nonce_p), "echo": crypto::to_hex(&nonce_s) });
            let bytes = self.open_msg(inner, "accept", payload, &pk, now);
            out.datagrams.push((bytes, from));
            return;
        }
        if !u.verify(OPEN_KEY) {
            return;
        }
        if inner.stored.pairing.as_ref().is_some_and(|x| x.peer_id == sender) {
            return; // our secondary also sends a signed hello: that one is answered
        }
        let payload = if let Some(_code) = &inner.code {
            json!({ "name": self.name(inner), "nonce": crypto::to_hex(&inner.code_nonce), "pairing": true, "busy": false, "attemptsLeft": inner.attempts_left })
        } else {
            json!({ "name": self.name(inner), "nonce": crypto::to_hex(&[0u8; 16]), "pairing": false, "busy": inner.stored.pairing.is_some() })
        };
        let bytes = self.open_msg(inner, "offer", payload, OPEN_KEY, now);
        out.datagrams.push((bytes, from));
    }

    fn primary_pair(&self, inner: &mut Inner, out: &mut Out, u: &wire::Unverified, from: SocketAddr, now: Now) {
        let p = &u.env.payload;
        let sender = u.env.sender.clone();
        let (Some(nonce_p), Some(nonce_s)) = (nonce_hex(p, "nonceP"), nonce_hex(p, "nonceS")) else { return };
        // The same pair message again (its welcome was lost): answer it again.
        if inner.code.is_none() {
            let same = inner.session.as_ref().is_some_and(|s| s.nonce_p == nonce_p && s.nonce_s == nonce_s);
            if let (true, Some(pk)) = (same, paired_key(inner, &sender)) {
                if u.verify(&pk) {
                    let payload = json!({ "name": self.name(inner), "nonce": crypto::to_hex(&nonce_p), "echo": crypto::to_hex(&nonce_s) });
                    let bytes = self.open_msg(inner, "welcome", payload, &pk, now);
                    out.datagrams.push((bytes, from));
                }
            } else {
                let bytes = self.open_msg(inner, "pairFail", json!({ "reason": "busy" }), OPEN_KEY, now);
                out.datagrams.push((bytes, from));
            }
            return;
        }
        let code = inner.code.clone().unwrap_or_default();
        if nonce_p != inner.code_nonce {
            let bytes = self.open_msg(inner, "pairFail", json!({ "reason": "code", "attemptsLeft": inner.attempts_left }), OPEN_KEY, now);
            out.datagrams.push((bytes, from));
            return;
        }
        let pk = crypto::pair_key(&code, &nonce_p, &nonce_s);
        if !u.verify(&pk) {
            inner.attempts_left = inner.attempts_left.saturating_sub(1);
            let reason = if inner.attempts_left == 0 {
                new_code(inner);
                inner.pair_error = Some("attempts".into());
                "attempts"
            } else {
                inner.pair_error = Some("code".into());
                "code"
            };
            let bytes = self.open_msg(inner, "pairFail", json!({ "reason": reason, "attemptsLeft": inner.attempts_left }), OPEN_KEY, now);
            out.datagrams.push((bytes, from));
            return;
        }
        let name = str_of(p, "name");
        inner.stored.pairing = Some(StoredPairing { peer_id: sender.clone(), peer_name: name.clone(), key: crypto::to_hex(&pk) });
        let _ = inner.stored.save(self.cfg.store_path.as_deref());
        inner.code = None;
        inner.pair_error = None;
        self.start_session(inner, out, &sender, &name, crypto::session_key(&pk, &nonce_p, &nonce_s), nonce_p, nonce_s, from, now);
        let payload = json!({ "name": self.name(inner), "nonce": crypto::to_hex(&nonce_p), "echo": crypto::to_hex(&nonce_s) });
        let bytes = self.open_msg(inner, "welcome", payload, &pk, now);
        out.datagrams.push((bytes, from));
        out.emit("cue-link-event", json!({ "type": "paired", "peer": name }));
    }

    #[allow(clippy::too_many_arguments)]
    fn start_session(&self, inner: &mut Inner, out: &mut Out, peer_id: &str, name: &str, key: Key, nonce_p: Nonce, nonce_s: Nonce, from: SocketAddr, now: Now) {
        inner.session = Some(Session::new(key, nonce_p, nonce_s, now.ms));
        inner.pending = None;
        self.learn_path(inner, peer_id, name, from, now);
        self.on_up(inner, out, now);
        self.heartbeat(inner, out, now);
    }

    /// The session works (new, adopted, or back after a loss).
    fn on_up(&self, inner: &mut Inner, out: &mut Out, now: Now) {
        let fresh = !inner.connected || inner.lost;
        inner.connected = true;
        inner.lost = false;
        inner.lost_at = None;
        inner.last_rx_ms = now.ms;
        if fresh {
            inner.health = Health::new();
            inner.peer_hb = None;
            inner.inbox.clear();
            inner.peer_state_rev = 0;
            out.info_changed = true;
            if inner.stored.role == Role::Primary {
                inner.state_sent_ms = 0; // send the state at the next tick
            }
        }
    }

    fn learn_path(&self, inner: &mut Inner, peer_id: &str, name: &str, from: SocketAddr, now: Now) {
        let manual = addr::parse_manual(inner.stored.manual_peer.as_deref());
        if inner.peer.as_ref().is_none_or(|p| p.id != peer_id) {
            inner.peer = Some(Peer { id: peer_id.to_string(), name: name.to_string(), paths: vec![] });
        }
        let peer = inner.peer.as_mut().expect("just set");
        if !name.is_empty() {
            peer.name = name.to_string();
        }
        match peer.paths.iter_mut().find(|x| x.addr == from) {
            Some(x) => x.last_rx_ms = now.ms,
            None => {
                peer.paths.push(PathState { addr: from, rank: addr::rank(from.ip(), manual), last_rx_ms: now.ms });
                peer.paths.sort_by_key(|x| x.rank);
                peer.paths.truncate(4);
            }
        }
    }

    fn session_msg(&self, inner: &mut Inner, out: &mut Out, u: &wire::Unverified, from: SocketAddr, now: Now) {
        let sender = &u.env.sender;
        if inner.stored.pairing.as_ref().is_none_or(|p| &p.peer_id != sender) {
            return; // wrong peer
        }
        let current = inner.session.as_ref().is_some_and(|s| u.verify(&s.key));
        if !current {
            // A message under the proposed session: the secondary adopted it.
            if !inner.pending.as_ref().is_some_and(|s| u.verify(&s.key)) {
                return;
            }
            inner.session = inner.pending.take();
            self.on_up(inner, out, now);
        }
        let name = u.env.payload.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        self.learn_path(inner, &sender.clone(), &name, from, now);
        let Some(s) = inner.session.as_mut() else { return };
        if !s.window.accept(u.env.seq) {
            return; // replay, or the copy from the other path
        }
        if inner.lost {
            self.on_up(inner, out, now);
        }
        inner.last_rx_ms = now.ms;
        let p = &u.env.payload;
        match u.env.kind.as_str() {
            "hb" => {
                let n = p.get("n").and_then(Value::as_u64).unwrap_or(0);
                let rtt = p.get("echo").and_then(Value::as_u64).map(|echo| {
                    let held = p.get("held").and_then(Value::as_u64).unwrap_or(0);
                    now.us.saturating_sub(echo).saturating_sub(held) as f64 / 1000.0
                });
                let peer_lost = p.get("lost").and_then(Value::as_u64).unwrap_or(0) as u32;
                inner.health.on_heartbeat(now.ms, n, rtt, peer_lost);
                inner.peer_hb = Some((u.env.ts, now.us));
                if inner.stored.role == Role::Secondary {
                    if let Some(h) = p.get("holder").and_then(|h| serde_json::from_value::<Holder>(h.clone()).ok()) {
                        inner.holder = h;
                    }
                    inner.commands_taken = p.get("taken").and_then(Value::as_bool).unwrap_or(false);
                    inner.peer_available = p.get("avail").and_then(Value::as_bool).unwrap_or(true);
                    inner.peer_wifi = p.get("wifi").and_then(Value::as_bool).unwrap_or(false);
                }
            }
            "probe" => {}
            "rel" => {
                let rid = str_of(p, "rid");
                if rid.is_empty() {
                    return;
                }
                let answer = match inner.inbox.answered(&rid) {
                    Some(a) => a.clone(),
                    None => {
                        let chan = str_of(p, "chan");
                        let body = p.get("body").cloned().unwrap_or(Value::Null);
                        let a = self.on_rel(inner, out, &rid, &chan, body, from, now);
                        inner.inbox.record(&rid, a.clone(), now.ms);
                        a
                    }
                };
                let mut ack = answer;
                ack["rid"] = json!(rid);
                self.send_session(inner, out, "ack", ack, now);
            }
            "ack" => {
                let rid = str_of(p, "rid");
                if let Some(pending) = inner.outbox.ack(&rid) {
                    let ok = p.get("ok").and_then(Value::as_bool).unwrap_or(false);
                    let reason = p.get("reason").and_then(Value::as_str).map(String::from);
                    if let Some(tx) = inner.waiters.remove(&rid) {
                        let _ = tx.send(Outcome { request_id: rid.clone(), ok, reason: reason.clone() });
                    }
                    if pending.chan == "req" {
                        let op = pending.body.get("op").cloned().unwrap_or(Value::Null);
                        if op.get("kind").and_then(Value::as_str) == Some("available") || op.get("kind").and_then(Value::as_str) == Some("unavailable") {
                            if ok {
                                inner.peer_available = op.get("kind").and_then(Value::as_str) == Some("available");
                            }
                        }
                    }
                }
            }
            "state" if inner.stored.role == Role::Secondary => {
                let rev = p.get("rev").and_then(Value::as_u64).unwrap_or(0);
                if rev > inner.peer_state_rev || (rev < inner.peer_state_rev && p.get("reset").and_then(Value::as_bool) == Some(true)) {
                    inner.peer_state_rev = rev;
                    out.emit("cue-link-event", json!({ "type": "state", "rev": rev, "state": p.get("state").cloned().unwrap_or(Value::Null) }));
                }
            }
            "ptr" => out.emit("cue-link-pointer", p.get("pointer").cloned().unwrap_or(Value::Null)),
            "bye" => {
                self.mark_lost(inner, out, now);
                // That session is over: a heartbeat still on its way must not bring it back.
                inner.session = None;
                if p.get("forget").and_then(Value::as_bool) == Some(true) {
                    self.forget_locally(inner, out);
                    out.emit("cue-link-event", json!({ "type": "forgotten" }));
                }
            }
            _ => {}
        }
    }

    /// A reliable message: its answer `{ ok, reason? }` (sent back in the ack).
    #[allow(clippy::too_many_arguments)]
    fn on_rel(&self, inner: &mut Inner, out: &mut Out, rid: &str, chan: &str, body: Value, from: SocketAddr, now: Now) -> Value {
        let role = inner.stored.role;
        match (role, chan) {
            (Role::Primary, "req") => {
                let op = body.get("op").cloned().unwrap_or(Value::Null);
                let kind = op.get("kind").and_then(Value::as_str).unwrap_or("").to_string();
                match decide_request(&kind, inner.holder, inner.commands_taken, inner.peer_available) {
                    Err(reason) => json!({ "ok": false, "reason": reason }),
                    Ok(()) => {
                        match kind.as_str() {
                            "reserve" => inner.holder = Holder::Secondary,
                            "release" => {
                                if inner.holder == Holder::Secondary {
                                    inner.holder = Holder::None;
                                }
                            }
                            "available" => inner.peer_available = true,
                            "unavailable" => {
                                inner.peer_available = false;
                                if inner.holder == Holder::Secondary {
                                    inner.holder = Holder::None;
                                }
                            }
                            _ => out.emit("cue-link-event", json!({ "type": "request", "requestId": rid, "op": op, "from": "secondary", "at": now.unix_ms })),
                        }
                        if matches!(kind.as_str(), "reserve" | "release" | "available" | "unavailable") {
                            self.heartbeat(inner, out, now); // the secondary sees the change at once
                        }
                        json!({ "ok": true })
                    }
                }
            }
            (Role::Secondary, "evt") => {
                out.emit("cue-link-event", json!({ "type": "event", "event": body }));
                json!({ "ok": true })
            }
            (Role::Secondary, "result") => {
                let mut v = body;
                v["type"] = json!("result");
                out.emit("cue-link-event", v);
                json!({ "ok": true })
            }
            (Role::Secondary, "file") => match serde_json::from_value::<transfer::Manifest>(body) {
                Ok(m) => {
                    out.fetch = Some((m.clone(), SocketAddr::new(from.ip(), m.port)));
                    json!({ "ok": true })
                }
                Err(_) => json!({ "ok": false, "reason": "bad" }),
            },
            (Role::Primary, "fileDone") => {
                let ok = body.get("ok").and_then(Value::as_bool).unwrap_or(false);
                let mut v = body;
                v["phase"] = json!(if ok { "sent" } else { "failed" });
                out.emit("cue-link-file", v);
                json!({ "ok": true })
            }
            (_, "chat") => {
                let mut v = body;
                v["mine"] = json!(false);
                out.emit("cue-link-chat", v);
                json!({ "ok": true })
            }
            _ => json!({ "ok": false, "reason": "unknown" }),
        }
    }

    fn check_lost(&self, inner: &mut Inner, out: &mut Out, now: Now) {
        if now.ms.saturating_sub(inner.last_rx_ms) >= LOST_AFTER_MS {
            self.mark_lost(inner, out, now);
        }
    }

    /// The heartbeat stopped, or the other computer said goodbye.
    fn mark_lost(&self, inner: &mut Inner, out: &mut Out, now: Now) {
        if !inner.connected || inner.lost {
            return;
        }
        inner.lost = true;
        inner.lost_at = Some(now.unix_ms.saturating_sub(now.ms.saturating_sub(inner.last_rx_ms)));
        // The secondary's reservation ends at once; whatever was waiting fails.
        if inner.holder == Holder::Secondary || inner.stored.role == Role::Secondary {
            inner.holder = Holder::None;
        }
        for p in inner.outbox.drain() {
            if let Some(tx) = inner.waiters.remove(&p.rid) {
                let _ = tx.send(Outcome { request_id: p.rid, ok: false, reason: Some("notConnected".into()) });
            }
        }
        inner.chat_queue.clear();
        inner.pointer = None;
        inner.hello_nonce = crypto::random::<16>();
        inner.last_hello_ms = None;
        out.emit("cue-link-pointer", Value::Null);
        out.info_changed = true;
    }

    fn forget_locally(&self, inner: &mut Inner, out: &mut Out) {
        inner.stored.pairing = None;
        let _ = inner.stored.save(self.cfg.store_path.as_deref());
        reset_connection(inner);
        if inner.stored.role == Role::Primary {
            new_code(inner);
        }
        out.info_changed = true;
    }

    // ---------------- Ticker ----------------

    fn tick(&self, inner: &mut Inner, out: &mut Out, now: Now) {
        let role = inner.stored.role;
        if role == Role::None {
            return;
        }
        self.check_lost(inner, out, now);
        if role == Role::Secondary {
            let searching = !inner.connected || inner.lost;
            if searching && inner.last_hello_ms.is_none_or(|t| now.ms.saturating_sub(t) >= HELLO_MS) {
                inner.last_hello_ms = Some(now.ms);
                self.send_hello(inner, out, now);
            }
            if inner.connected && !inner.lost && inner.peer_wifi && now.ms.saturating_sub(inner.last_probe_ms) >= PROBE_MS {
                inner.last_probe_ms = now.ms;
                let targets = self.discovery_targets(inner, now);
                if let Some(s) = inner.session.as_mut() {
                    s.tx_seq += 1;
                    let env = Envelope { v: wire::VERSION, kind: "probe".into(), seq: s.tx_seq, sender: inner.stored.id.clone(), ts: now.us, payload: json!({}) };
                    let bytes = wire::encode(&env, &s.key);
                    for t in targets {
                        out.datagrams.push((bytes.clone(), t));
                    }
                }
            }
            if let Some(t) = inner.pair_try.as_mut() {
                if now.ms.saturating_sub(t.started_ms) >= PAIR_GIVE_UP_MS {
                    inner.pair_try = None;
                    inner.pair_error = Some("noAnswer".into());
                } else if now.ms.saturating_sub(t.last_ms) >= PAIR_RETRY_MS {
                    t.last_ms = now.ms;
                    self.send_pair(inner, out, now);
                }
            }
        }
        if role == Role::Primary {
            if let Some(s) = &inner.pending {
                if now.ms.saturating_sub(s.created_ms) > 10_000 {
                    inner.pending = None;
                }
            }
        }
        if inner.session.is_some() && inner.connected && now.ms.saturating_sub(inner.last_hb_ms) >= HEARTBEAT_MS {
            self.heartbeat(inner, out, now);
        }
        if !link_up(inner) {
            return;
        }
        // Retries, then what was given up.
        for p in inner.outbox.due(now.ms) {
            let payload = json!({ "rid": p.rid, "chan": p.chan, "body": p.body });
            self.send_session(inner, out, "rel", payload, now);
        }
        for p in inner.outbox.expired(now.ms) {
            if let Some(tx) = inner.waiters.remove(&p.rid) {
                let _ = tx.send(Outcome { request_id: p.rid.clone(), ok: false, reason: Some("timeout".into()) });
            }
        }
        inner.inbox.prune(now.ms);
        if role == Role::Primary && inner.state.is_some() && now.ms.saturating_sub(inner.state_sent_ms) >= STATE_REFRESH_MS {
            self.send_state(inner, out, now);
        }
        // Low priority: one datagram per LOW_PRIORITY_MS, never ahead of the rest of this tick.
        if now.ms.saturating_sub(inner.last_low_ms) >= LOW_PRIORITY_MS {
            if let Some((_, body)) = inner.chat_queue.pop_front() {
                inner.last_low_ms = now.ms;
                self.send_rel(inner, out, "chat", body, Priority::Low, now);
            } else if let Some(ptr) = inner.pointer.take() {
                inner.last_low_ms = now.ms;
                self.send_session(inner, out, "ptr", json!({ "pointer": ptr }), now);
            }
        }
    }

    fn discovery_targets(&self, inner: &mut Inner, now: Now) -> Vec<SocketAddr> {
        if inner.broadcasts_ms.is_none_or(|t| now.ms.saturating_sub(t) >= 5000) {
            inner.broadcasts = addr::broadcast_addresses();
            inner.broadcasts_ms = Some(now.ms);
        }
        let manual = addr::parse_manual(inner.stored.manual_peer.as_deref());
        let mut t = addr::discovery_targets(&self.cfg.discovery_ports, manual, self.cfg.allow_loopback, &inner.broadcasts);
        if let Some(f) = &inner.found {
            if !t.contains(&f.addr) {
                t.insert(0, f.addr);
            }
        }
        t
    }

    fn send_hello(&self, inner: &mut Inner, out: &mut Out, now: Now) {
        let targets = self.discovery_targets(inner, now);
        let name = self.name(inner);
        let nonce = crypto::to_hex(&inner.hello_nonce);
        let mut packets = vec![self.open_msg(inner, "hello", json!({ "name": name, "nonce": nonce, "paired": false }), OPEN_KEY, now)];
        if let Some(pk) = inner.stored.pairing.as_ref().and_then(|p| p.key()) {
            packets.push(self.open_msg(inner, "hello", json!({ "name": name, "nonce": nonce, "paired": true }), &pk, now));
        }
        for t in targets {
            for p in &packets {
                out.datagrams.push((p.clone(), t));
            }
        }
    }

    fn send_pair(&self, inner: &mut Inner, out: &mut Out, now: Now) {
        let Some(t) = inner.pair_try.as_ref() else { return };
        let key = crypto::pair_key(&t.code, &t.nonce_p, &t.nonce_s);
        let (to, np, ns) = (t.to, t.nonce_p, t.nonce_s);
        let payload = json!({ "name": self.name(inner), "nonceP": crypto::to_hex(&np), "nonceS": crypto::to_hex(&ns) });
        let bytes = self.open_msg(inner, "pair", payload, &key, now);
        out.datagrams.push((bytes, to));
    }

    fn send_state(&self, inner: &mut Inner, out: &mut Out, now: Now) {
        let Some(state) = inner.state.clone() else { return };
        inner.state_sent_ms = now.ms;
        self.send_session(inner, out, "state", json!({ "rev": inner.state_rev, "state": state }), now);
    }
}

/// Is the secondary's request accepted by the link? (Playback rules — GO given by, end of show — are
/// checked afterwards by the primary's interface, which may answer with a `result` event.)
pub fn decide_request(kind: &str, holder: Holder, commands_taken: bool, available: bool) -> Result<(), &'static str> {
    if !REQUESTS.contains(&kind) {
        return Err("unknown");
    }
    if commands_taken && !ALWAYS_ALLOWED.contains(&kind) && !SAFETY.contains(&kind) {
        return Err("commandsTaken");
    }
    if !available && (RESERVABLE.contains(&kind) || kind == "reserve" || kind == "edit") {
        return Err("unavailable");
    }
    if holder == Holder::Primary && (RESERVABLE.contains(&kind) || kind == "reserve") {
        return Err("reservedByPrimary");
    }
    Ok(())
}

fn paired_key(inner: &Inner, sender: &str) -> Option<Key> {
    inner.stored.pairing.as_ref().filter(|p| p.peer_id == sender).and_then(|p| p.key())
}

fn link_up(inner: &Inner) -> bool {
    inner.connected && !inner.lost && inner.session.is_some()
}

fn wifi_on(inner: &Inner) -> bool {
    match inner.stored.role {
        Role::Secondary => inner.peer_wifi,
        _ => inner.stored.wifi_backup,
    }
}

fn targets_of(inner: &Inner, now_ms: u64) -> Vec<SocketAddr> {
    let Some(peer) = &inner.peer else { return vec![] };
    let alive: Vec<&PathState> = peer.paths.iter().filter(|p| now_ms.saturating_sub(p.last_rx_ms) < LOST_AFTER_MS).collect();
    if wifi_on(inner) {
        let list: Vec<&PathState> = if alive.is_empty() { peer.paths.iter().collect() } else { alive };
        return list.iter().map(|p| p.addr).collect();
    }
    // Without the backup: the best live path; when none answers, the best known one (paths are sorted by rank).
    let best = alive.iter().min_by_key(|p| (p.rank, u64::MAX - p.last_rx_ms)).map(|p| p.addr).or_else(|| peer.paths.first().map(|p| p.addr));
    best.into_iter().collect()
}

fn status_of(inner: &Inner, now_ms: u64) -> Status {
    let (main_alive, backup_alive) = match &inner.peer {
        Some(p) => {
            let best = p.paths.iter().map(|x| x.rank).min().unwrap_or(0);
            let alive = |x: &&PathState| now_ms.saturating_sub(x.last_rx_ms) < LOST_AFTER_MS;
            (p.paths.iter().filter(|x| x.rank == best).any(|x| alive(&x)), p.paths.iter().filter(|x| x.rank > best).any(|x| alive(&x)))
        }
        None => (false, false),
    };
    health::classify(StatusInput {
        connected: inner.connected,
        since_rx_ms: if inner.lost { u64::MAX } else { now_ms.saturating_sub(inner.last_rx_ms) },
        main_path_alive: main_alive,
        backup_path_alive: backup_alive && wifi_on(inner),
        unavailable: !inner.peer_available,
        unstable: inner.health.unstable(now_ms),
    })
}

fn new_code(inner: &mut Inner) {
    inner.code = Some(crypto::pairing_code());
    inner.code_nonce = crypto::random::<16>();
    inner.attempts_left = PAIR_ATTEMPTS;
}

fn reset_connection(inner: &mut Inner) {
    inner.session = None;
    inner.pending = None;
    inner.peer = None;
    inner.connected = false;
    inner.lost = false;
    inner.lost_at = None;
    inner.health = Health::new();
    inner.peer_hb = None;
    inner.code = None;
    inner.pair_error = None;
    inner.found = None;
    inner.pair_try = None;
    inner.hello_nonce = crypto::random::<16>();
    inner.last_hello_ms = None;
    inner.holder = Holder::None;
    inner.commands_taken = false;
    inner.peer_available = true;
    inner.peer_wifi = false;
    inner.outbox.drain();
    inner.inbox.clear();
    for (rid, tx) in inner.waiters.drain() {
        let _ = tx.send(Outcome { request_id: rid, ok: false, reason: Some("notConnected".into()) });
    }
    inner.peer_state_rev = 0;
    inner.chat_queue.clear();
    inner.pointer = None;
    inner.offer = None;
}

fn run_fetch(shared: Arc<Shared>, manifest: transfer::Manifest, addr: SocketAddr) {
    let emit = |v: Value| (shared.sink)("cue-link-file", v);
    let tid = manifest.transfer_id.clone();
    let result = (|| -> Result<(transfer::Fetched, PathBuf), String> {
        let root = transfer::show_root(&shared.cfg.received_dir, &manifest.show_id).ok_or("bad-part: show id")?;
        if !transfer::safe_name(&manifest.main) {
            return Err("bad-part: main".into());
        }
        let names = transfer::needed(&manifest, &root);
        emit(json!({ "phase": "receiving", "transferId": tid, "done": 0, "total": 0, "files": names.len() }));
        let line = shared.with(|inner, _out, now| {
            let s = inner.session.as_mut()?;
            s.tx_seq += 1;
            let env = Envelope {
                v: wire::VERSION,
                kind: "fetch".into(),
                seq: s.tx_seq,
                sender: inner.stored.id.clone(),
                ts: now.us,
                payload: json!({ "transferId": manifest.transfer_id, "names": names }),
            };
            Some(wire::encode(&env, &s.key))
        });
        let line = line.ok_or("notConnected")?;
        let mut last = Instant::now();
        let fetched = transfer::fetch(addr, &line, &manifest, &names, &root, |done, total| {
            if last.elapsed() >= Duration::from_millis(200) {
                last = Instant::now();
                emit(json!({ "phase": "receiving", "transferId": tid, "done": done, "total": total }));
            }
        })?;
        Ok((fetched, root.join(&manifest.main)))
    })();
    let done = match &result {
        Ok(_) => json!({ "transferId": tid, "ok": true }),
        Err(e) => json!({ "transferId": tid, "ok": false, "error": e }),
    };
    match result {
        Ok((f, main)) => emit(json!({
            "phase": "received",
            "transferId": tid,
            "showId": manifest.show_id,
            "path": main.to_string_lossy(),
            "showJson": f.show_json,
            "fetched": f.written,
            "bytes": f.bytes,
            "skipped": manifest.skipped,
        })),
        Err(e) => emit(json!({ "phase": "failed", "transferId": tid, "error": e })),
    }
    shared.with(|inner, out, now| {
        shared.send_rel(inner, out, "fileDone", done, Priority::High, now);
    });
}

fn serve_tcp(shared: Arc<Shared>, stream: std::net::TcpStream) {
    let peer_ip = stream.peer_addr().map(|a| a.ip()).ok();
    let auth = |line: &[u8]| -> Result<(Arc<Prepared>, Vec<String>), String> {
        shared.with(|inner, out, _now| {
            let ip = peer_ip.ok_or("no address")?;
            let known = inner.peer.as_ref().is_some_and(|p| p.paths.iter().any(|x| x.addr.ip() == ip));
            if !known || !addr::allowed(ip, shared.cfg.allow_loopback) {
                return Err("unknown computer".to_string());
            }
            let u = wire::parse(line).map_err(|_| "bad request".to_string())?;
            if u.env.kind != "fetch" || inner.stored.pairing.as_ref().is_none_or(|p| p.peer_id != u.env.sender) {
                return Err("bad request".into());
            }
            let s = inner.session.as_mut().ok_or("not connected")?;
            if !u.verify(&s.key) || !s.window.accept(u.env.seq) {
                return Err("bad signature".into());
            }
            let tid = str_of(&u.env.payload, "transferId");
            let offer = inner.offer.clone().filter(|o| o.manifest.transfer_id == tid).ok_or("old transfer")?;
            let names: Vec<String> = u.env.payload.get("names").and_then(|n| serde_json::from_value(n.clone()).ok()).unwrap_or_default();
            out.emit("cue-link-file", json!({ "phase": "sending", "transferId": tid, "files": names.len() }));
            Ok((offer, names))
        })
    };
    if let Err(e) = transfer::serve(stream, auth) {
        (shared.sink)("cue-link-file", json!({ "phase": "failed", "error": e }));
    }
}

impl Link {
    /// Creates the link with what `link.json` remembers. The network opens only if the role is not "none".
    pub fn new(cfg: LinkConfig, sink: Sink) -> Arc<Link> {
        let stored = Stored::load(cfg.store_path.as_deref());
        let inner = Inner {
            stored,
            error: None,
            session: None,
            pending: None,
            peer: None,
            connected: false,
            lost: false,
            last_rx_ms: 0,
            lost_at: None,
            health: Health::new(),
            hb_n: 0,
            last_hb_ms: 0,
            peer_hb: None,
            open_seq: 0,
            code: None,
            code_nonce: [0; 16],
            attempts_left: PAIR_ATTEMPTS,
            pair_error: None,
            hello_nonce: crypto::random::<16>(),
            last_hello_ms: None,
            last_probe_ms: 0,
            found: None,
            pair_try: None,
            broadcasts: vec![],
            broadcasts_ms: None,
            holder: Holder::None,
            commands_taken: false,
            peer_available: true,
            peer_wifi: false,
            outbox: Outbox::new(),
            inbox: Inbox::new(),
            waiters: HashMap::new(),
            state_rev: 0,
            state: None,
            state_sent_ms: 0,
            peer_state_rev: 0,
            chat_queue: VecDeque::new(),
            pointer: None,
            last_low_ms: 0,
            offer: None,
            last_info: None,
            last_info_ms: 0,
        };
        let link = Arc::new(Link {
            shared: Arc::new(Shared { cfg, sink, epoch: Instant::now(), inner: Mutex::new(inner), socket: Mutex::new(None) }),
            runtime: Mutex::new(None),
        });
        let role = lock(&link.shared.inner).stored.role;
        if role != Role::None {
            link.start(role);
        }
        link
    }

    pub fn info(&self) -> LinkInfo {
        self.shared.with(|inner, _, now| self.shared.info_of(inner, now))
    }

    fn start(&self, role: Role) {
        let mut rt = self.runtime.lock().unwrap_or_else(|e| e.into_inner());
        if rt.is_some() {
            return;
        }
        let cfg = &self.shared.cfg;
        let sock = match UdpSocket::bind(SocketAddr::new(IpAddr::from([0, 0, 0, 0]), cfg.udp_port)) {
            Ok(s) => s,
            Err(e) => {
                self.shared.with(|inner, _, _| inner.error = Some(format!("portBusy: UDP {}: {e}", cfg.udp_port)));
                return;
            }
        };
        let _ = sock.set_broadcast(true);
        let _ = sock.set_ttl(1);
        let _ = sock.set_read_timeout(Some(RECV_TIMEOUT));
        let listener = if role == Role::Primary {
            match TcpListener::bind(SocketAddr::new(IpAddr::from([0, 0, 0, 0]), cfg.tcp_port)) {
                Ok(l) => {
                    let _ = l.set_nonblocking(true);
                    let _ = l.set_ttl(1);
                    Some(l)
                }
                Err(e) => {
                    self.shared.with(|inner, _, _| inner.error = Some(format!("portBusy: TCP {}: {e}", cfg.tcp_port)));
                    return;
                }
            }
        } else {
            None
        };
        let sock = Arc::new(sock);
        *self.shared.socket.lock().unwrap_or_else(|e| e.into_inner()) = Some(sock.clone());
        self.shared.with(|inner, _, _| {
            inner.error = None;
            if role == Role::Primary && inner.stored.pairing.is_none() && inner.code.is_none() {
                new_code(inner);
            }
        });
        let stop = Arc::new(AtomicBool::new(false));
        let mut threads = Vec::new();
        {
            let (shared, stop, sock) = (self.shared.clone(), stop.clone(), sock.clone());
            threads.push(
                std::thread::Builder::new()
                    .name("cue-link-recv".into())
                    .spawn(move || {
                        let mut buf = vec![0u8; 65536];
                        while !stop.load(Ordering::Relaxed) {
                            match sock.recv_from(&mut buf) {
                                Ok((n, from)) => {
                                    let data = &buf[..n];
                                    shared.with(|inner, out, now| shared.on_datagram(inner, out, data, from, now));
                                }
                                // Timeouts, and on Windows the "connection reset" a UDP socket reports after an
                                // ICMP port-unreachable: keep listening.
                                Err(_) => continue,
                            }
                        }
                    })
                    .expect("thread"),
            );
        }
        {
            let (shared, stop) = (self.shared.clone(), stop.clone());
            threads.push(
                std::thread::Builder::new()
                    .name("cue-link-tick".into())
                    .spawn(move || {
                        while !stop.load(Ordering::Relaxed) {
                            shared.with(|inner, out, now| shared.tick(inner, out, now));
                            std::thread::sleep(TICK);
                        }
                    })
                    .expect("thread"),
            );
        }
        if let Some(listener) = listener {
            let (shared, stop) = (self.shared.clone(), stop.clone());
            threads.push(
                std::thread::Builder::new()
                    .name("cue-link-files".into())
                    .spawn(move || {
                        while !stop.load(Ordering::Relaxed) {
                            match listener.accept() {
                                Ok((stream, from)) => {
                                    if !addr::allowed(from.ip(), shared.cfg.allow_loopback) {
                                        continue;
                                    }
                                    let _ = stream.set_nonblocking(false);
                                    let shared = shared.clone();
                                    std::thread::Builder::new().name("cue-link-serve".into()).spawn(move || serve_tcp(shared, stream)).ok();
                                }
                                Err(_) => std::thread::sleep(Duration::from_millis(50)),
                            }
                        }
                    })
                    .expect("thread"),
            );
        }
        *rt = Some(Runtime { stop, threads });
    }

    /// Tests: the network stops without telling the other computer (a cable pulled out).
    #[doc(hidden)]
    pub fn halt_silently(&self) {
        if let Some(rt) = self.runtime.lock().unwrap_or_else(|e| e.into_inner()).take() {
            rt.stop.store(true, Ordering::Relaxed);
            for t in rt.threads {
                let _ = t.join();
            }
        }
        *self.shared.socket.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    fn stop_runtime(&self) {
        if let Some(rt) = self.runtime.lock().unwrap_or_else(|e| e.into_inner()).take() {
            rt.stop.store(true, Ordering::Relaxed);
            for t in rt.threads {
                let _ = t.join();
            }
        }
        // Tell the other computer at once (it shows "Scollegato" without waiting one second); the
        // threads are stopped, so nothing is sent after the bye.
        self.shared.with(|inner, out, now| {
            if link_up(inner) {
                self.shared.send_session(inner, out, "bye", json!({}), now);
            }
            inner.session = None;
        });
        *self.shared.socket.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Role, Wi-Fi backup, address typed by hand, name. Changing the role closes or opens the network.
    pub fn configure(&self, c: Configure) -> LinkInfo {
        let old_role = lock(&self.shared.inner).stored.role;
        let new_role = c.role.unwrap_or(old_role);
        if new_role != old_role {
            self.stop_runtime();
        }
        self.shared.with(|inner, out, _| {
            if let Some(w) = c.wifi_backup {
                inner.stored.wifi_backup = w;
            }
            if let Some(m) = c.manual_peer {
                inner.stored.manual_peer = Some(m.trim().to_string()).filter(|s| !s.is_empty());
            }
            if let Some(n) = c.name {
                inner.stored.name = Some(n.trim().chars().take(40).collect::<String>()).filter(|s| !s.is_empty());
            }
            if new_role != old_role {
                inner.stored.role = new_role;
                if new_role != Role::None {
                    inner.stored.firewall_notice_seen = true;
                }
                reset_connection(inner);
                inner.error = None;
            }
            let _ = inner.stored.save(self.shared.cfg.store_path.as_deref());
            out.info_changed = true;
        });
        if new_role != old_role && new_role != Role::None {
            self.start(new_role);
        }
        self.info()
    }

    /// Primary: a new pairing code (the old one stops working).
    pub fn new_code(&self) -> LinkInfo {
        self.shared.with(|inner, _, _| {
            if inner.stored.role == Role::Primary && !link_up(inner) {
                new_code(inner);
                inner.pair_error = None;
            }
        });
        self.info()
    }

    /// Secondary: the code typed by the user, sent to the primary found.
    pub fn enter_code(&self, typed: &str) -> Result<LinkInfo, String> {
        let code = crypto::normalize_code(typed).ok_or("code: six digits")?;
        self.shared.with(|inner, out, now| {
            if inner.stored.role != Role::Secondary {
                return Err("notSecondary".to_string());
            }
            let f = inner.found.as_ref().filter(|f| f.pairing).ok_or("noPrimary")?;
            inner.pair_try = Some(PairTry { code, nonce_p: f.nonce_p, nonce_s: crypto::random::<16>(), to: f.addr, peer_id: f.id.clone(), started_ms: now.ms, last_ms: now.ms });
            inner.pair_error = None;
            self.shared.send_pair(inner, out, now);
            Ok(())
        })?;
        Ok(self.info())
    }

    /// "Dimentica il secondario / primario": the next connection needs a code again.
    pub fn forget(&self) -> LinkInfo {
        self.shared.with(|inner, out, now| {
            if link_up(inner) {
                self.shared.send_session(inner, out, "bye", json!({ "forget": true }), now);
            }
            self.shared.forget_locally(inner, out);
        });
        self.info()
    }

    /// Secondary: sends a request and waits for the primary's answer (at most ~1 s).
    pub fn request(&self, op: Value) -> Outcome {
        let kind = op.get("kind").and_then(Value::as_str).unwrap_or("").to_string();
        let (tx, rx) = mpsc::channel();
        let sent = self.shared.with(|inner, out, now| {
            if inner.stored.role != Role::Secondary {
                return Err("notSecondary");
            }
            if !REQUESTS.contains(&kind.as_str()) {
                return Err("unknown");
            }
            let rid = self.shared.send_rel(inner, out, "req", json!({ "op": op }), Priority::High, now).ok_or("notConnected")?;
            inner.waiters.insert(rid.clone(), tx);
            Ok(rid)
        });
        match sent {
            Err(reason) => Outcome { request_id: String::new(), ok: false, reason: Some(reason.into()) },
            Ok(rid) => rx
                .recv_timeout(Duration::from_millis(GIVE_UP_MS + 300))
                .unwrap_or(Outcome { request_id: rid, ok: false, reason: Some("timeout".into()) }),
        }
    }

    /// Primary: the outcome of a request after the interface applied it (e.g. refused: end of show).
    pub fn reply(&self, request_id: &str, ok: bool, reason: Option<String>) -> bool {
        self.shared.with(|inner, out, now| {
            inner.stored.role == Role::Primary
                && self.shared.send_rel(inner, out, "result", json!({ "requestId": request_id, "ok": ok, "reason": reason }), Priority::High, now).is_some()
        })
    }

    /// Primary: the playback state (any JSON below ~40 KB), sent at once and again every second.
    pub fn publish_state(&self, state: Value) -> Result<bool, String> {
        let size = serde_json::to_vec(&state).map(|v| v.len()).unwrap_or(usize::MAX);
        if size > MAX_DATAGRAM - 2048 {
            return Err("too-big: state".into());
        }
        Ok(self.shared.with(|inner, out, now| {
            if inner.stored.role != Role::Primary {
                return false;
            }
            inner.state_rev += 1;
            inner.state = Some(state);
            if link_up(inner) {
                self.shared.send_state(inner, out, now);
                true
            } else {
                false
            }
        }))
    }

    /// Primary: an event for the secondary (a GO fired, with who and when…), delivered reliably.
    pub fn publish_event(&self, event: Value) -> bool {
        self.shared.with(|inner, out, now| inner.stored.role == Role::Primary && self.shared.send_rel(inner, out, "evt", event, Priority::High, now).is_some())
    }

    /// Primary: holds or releases the reservation (key C). Refused while the secondary holds it.
    pub fn reserve(&self, on: bool) -> Outcome {
        if lock(&self.shared.inner).stored.role == Role::Secondary {
            return self.request(json!({ "kind": if on { "reserve" } else { "release" } }));
        }
        self.shared.with(|inner, out, now| {
            let ok = if on {
                if inner.holder == Holder::Secondary && link_up(inner) {
                    false
                } else {
                    inner.holder = Holder::Primary;
                    true
                }
            } else {
                if inner.holder == Holder::Primary {
                    inner.holder = Holder::None;
                }
                true
            };
            if link_up(inner) {
                self.shared.heartbeat(inner, out, now);
            }
            Outcome { request_id: String::new(), ok, reason: (!ok).then(|| "reservedBySecondary".into()) }
        })
    }

    /// Primary: takes the commands away from the secondary (or gives them back).
    pub fn take_commands(&self, on: bool) -> LinkInfo {
        self.shared.with(|inner, out, now| {
            if inner.stored.role != Role::Primary {
                return;
            }
            inner.commands_taken = on;
            if on && inner.holder == Holder::Secondary {
                inner.holder = Holder::None;
            }
            if link_up(inner) {
                self.shared.heartbeat(inner, out, now);
            }
        });
        self.info()
    }

    /// A chat message (low priority, reliable). Also emitted here as `cue-link-chat` with `mine: true`.
    pub fn chat(&self, text: &str, quick: bool) -> Result<Value, String> {
        let text: String = text.trim().chars().take(CHAT_MAX).collect();
        if text.is_empty() {
            return Err("empty".into());
        }
        self.shared.with(|inner, out, now| {
            if !link_up(inner) {
                return Err("notConnected".to_string());
            }
            let id = crypto::new_id();
            let from = if inner.stored.role == Role::Primary { "primary" } else { "secondary" };
            let msg = json!({ "id": id, "text": text, "quick": quick, "at": now.unix_ms, "from": from, "name": self.shared.name(inner) });
            inner.chat_queue.push_back((id, msg.clone()));
            let mut mine = msg.clone();
            mine["mine"] = json!(true);
            out.emit("cue-link-chat", mine);
            Ok(msg)
        })
    }

    /// The pointer on the script (`{ page, x, y }`, or null to hide it): latest wins, at most 10 per second.
    pub fn pointer(&self, pointer: Value) {
        self.shared.with(|inner, _, _| {
            if link_up(inner) {
                inner.pointer = Some(pointer);
            }
        });
    }

    /// Primary: offers the show to the secondary (it fetches what it lacks over TCP).
    pub fn send_show(&self, req: SendShow) -> Result<Value, String> {
        if !self.shared.with(|inner, _, _| inner.stored.role == Role::Primary && link_up(inner)) {
            return Err("notConnected".into());
        }
        let extra: Vec<PathBuf> = req.extra_paths.iter().map(PathBuf::from).collect();
        let prep = transfer::prepare(crypto::new_id(), &req.show_id, self.shared.cfg.tcp_port, std::path::Path::new(&req.tcue_path), &extra, req.show_json)?;
        let manifest = serde_json::to_value(&prep.manifest).map_err(|e| e.to_string())?;
        if serde_json::to_vec(&manifest).map(|v| v.len()).unwrap_or(usize::MAX) > MAX_DATAGRAM - 2048 {
            return Err("too-big: manifest".into());
        }
        let prep = Arc::new(prep);
        self.shared.with(|inner, out, now| {
            inner.offer = Some(prep.clone());
            self.shared.send_rel(inner, out, "file", manifest.clone(), Priority::High, now).ok_or("notConnected".to_string())?;
            out.emit("cue-link-file", json!({ "phase": "offered", "transferId": prep.manifest.transfer_id, "files": prep.manifest.files.len(), "skipped": prep.manifest.skipped }));
            Ok(manifest.clone())
        })
    }

    /// Stops the network (the other computer is told). Used at exit.
    pub fn shutdown(&self) {
        self.stop_runtime();
    }
}

impl Drop for Link {
    fn drop(&mut self) {
        self.stop_runtime();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_level_rules_of_requests() {
        assert_eq!(decide_request("go", Holder::None, false, true), Ok(()));
        assert_eq!(decide_request("dance", Holder::None, false, true), Err("unknown"));
        assert_eq!(decide_request("go", Holder::Primary, false, true), Err("reservedByPrimary"));
        assert_eq!(decide_request("reserve", Holder::Primary, false, true), Err("reservedByPrimary"));
        assert_eq!(decide_request("blackout", Holder::Primary, false, true), Ok(()), "safety commands work from both computers");
        assert_eq!(decide_request("emergency", Holder::Primary, false, true), Ok(()));
        assert_eq!(decide_request("go", Holder::None, true, true), Err("commandsTaken"));
        for k in ["pause", "blackout", "fadeToBlack", "emergency"] {
            assert_eq!(decide_request(k, Holder::None, true, true), Ok(()), "{k}: safety commands pass even when commands are taken");
        }
        assert_eq!(decide_request("stopAudio", Holder::None, true, true), Err("commandsTaken"));
        assert_eq!(decide_request("release", Holder::None, true, true), Ok(()));
        assert_eq!(decide_request("available", Holder::None, true, false), Ok(()));
        assert_eq!(decide_request("go", Holder::None, false, false), Err("unavailable"));
        assert_eq!(decide_request("pause", Holder::None, false, false), Ok(()));
    }
}
