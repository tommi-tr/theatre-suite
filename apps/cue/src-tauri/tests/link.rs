//! A primary and a secondary on 127.0.0.1 with offset ports (as `--instance n` does).

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cue_lib::net::{Configure, Holder, Link, LinkConfig, Phase, Role, SendShow, Sink, health::Status, ports_for_instance};
use serde_json::{Value, json};

type Events = Arc<Mutex<Vec<(String, Value)>>>;

fn node(instance: u32, peer_instance: u32, dir: &Path, name: &str) -> (Arc<Link>, Events) {
    let (udp, tcp) = ports_for_instance(instance);
    let cfg = LinkConfig {
        udp_port: udp,
        tcp_port: tcp,
        discovery_ports: vec![ports_for_instance(peer_instance).0],
        allow_loopback: true,
        store_path: Some(dir.join(format!("{name}.json"))),
        received_dir: dir.join(format!("{name}-received")),
        default_name: name.into(),
    };
    let events: Events = Arc::default();
    let e = events.clone();
    let sink: Sink = Arc::new(move |n: &str, v: Value| e.lock().unwrap().push((n.to_string(), v)));
    (Link::new(cfg, sink), events)
}

fn wait(what: &str, secs: u64, mut f: impl FnMut() -> bool) {
    let t = Instant::now();
    while !f() {
        assert!(t.elapsed() < Duration::from_secs(secs), "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn find(ev: &Events, name: &str, pred: impl Fn(&Value) -> bool) -> Option<Value> {
    ev.lock().unwrap().iter().find(|(n, v)| n == name && pred(v)).map(|(_, v)| v.clone())
}

fn role(r: Role) -> Configure {
    Configure { role: Some(r), ..Default::default() }
}

#[test]
fn primary_and_secondary_on_one_computer() {
    let dir = tempfile::tempdir().unwrap();
    let (p, pev) = node(7, 8, dir.path(), "primary");
    let (s, sev) = node(8, 7, dir.path(), "secondary");
    assert_eq!(p.info().phase, Phase::Off, "network off until a role is chosen");

    // Pairing with the code.
    let code = p.configure(role(Role::Primary)).pairing_code.expect("the primary shows a code");
    s.configure(role(Role::Secondary));
    wait("the secondary finds the primary", 5, || s.info().found.is_some_and(|f| f.pairing));
    let wrong = if code == "000000" { "111111" } else { "000000" };
    s.enter_code(wrong).unwrap();
    wait("wrong code refused", 5, || s.info().pairing_error.as_deref() == Some("code"));
    assert_eq!(p.info().attempts_left, Some(4));
    s.enter_code(&code).unwrap();
    wait("both connected", 5, || p.info().phase == Phase::Connected && s.info().phase == Phase::Connected);

    // Heartbeat: stable, sub-20 ms.
    // (On a busy build machine one late sample can make it unstable for STABLE_AFTER_MS: wait for it.)
    wait("stable on both, latency measured", 8, || p.info().status == Status::Stable && s.info().status == Status::Stable && p.info().latency_ms.is_some());
    assert!(p.info().latency_ms.unwrap() < 20.0);
    assert_eq!(s.info().paired_with.as_deref(), Some("primary"));

    // Request GO → the primary's interface gets it → it publishes the state → the secondary gets it.
    let out = s.request(json!({ "kind": "go", "standbyId": "g1" }));
    assert!(out.ok, "{out:?}");
    let req = find(&pev, "cue-link-event", |v| v["type"] == "request").expect("request event");
    assert_eq!(req["op"]["kind"], "go");
    assert_eq!(req["requestId"], json!(out.request_id));
    assert!(p.publish_state(json!({ "lastGoId": "g1", "standbyId": "g2" })).unwrap());
    assert!(p.publish_event(json!({ "type": "fired", "goId": "g1", "by": "secondary" })));
    wait("state on the secondary", 3, || find(&sev, "cue-link-event", |v| v["type"] == "state" && v["state"]["lastGoId"] == "g1").is_some());
    wait("event on the secondary", 3, || find(&sev, "cue-link-event", |v| v["type"] == "event" && v["event"]["goId"] == "g1").is_some());

    // Reservation: the primary holds C → the secondary's GO is refused, a blackout is not.
    assert!(p.reserve(true).ok);
    assert_eq!(s.request(json!({ "kind": "go" })).reason.as_deref(), Some("reservedByPrimary"));
    assert!(s.request(json!({ "kind": "blackout" })).ok);
    assert!(p.reserve(false).ok);
    assert!(s.reserve(true).ok, "the secondary reserves");
    assert!(!p.reserve(true).ok, "first wins");
    wait("secondary sees its reservation", 3, || s.info().reservation == Holder::Secondary);

    // Commands taken away.
    p.take_commands(true);
    assert_eq!(s.request(json!({ "kind": "go" })).reason.as_deref(), Some("commandsTaken"));
    assert!(s.request(json!({ "kind": "emergency" })).ok, "safety commands pass even with the commands taken");
    assert_eq!(p.info().reservation, Holder::None);
    p.take_commands(false);

    // Chat.
    s.chat("Attori pronti", true).unwrap();
    wait("chat on the primary", 3, || find(&pev, "cue-link-chat", |v| v["text"] == "Attori pronti" && v["mine"] == false).is_some());

    // File transfer with sha256.
    let show = dir.path().join("show");
    std::fs::create_dir_all(show.join("Audio")).unwrap();
    let big: Vec<u8> = (0..700_000u32).map(|i| (i * 7 % 251) as u8).collect();
    std::fs::write(show.join("Serata.tcue"), &big).unwrap();
    std::fs::write(show.join("Audio/Suoni.diaframma"), b"{\"format\":\"diaframma\"}").unwrap();
    p.send_show(SendShow {
        show_id: "abc123".into(),
        tcue_path: show.join("Serata.tcue").to_string_lossy().into(),
        extra_paths: vec![show.join("Audio/Suoni.diaframma").to_string_lossy().into()],
        show_json: Some("{\"title\":\"La locandiera\"}".into()),
    })
    .unwrap();
    wait("file received", 10, || find(&sev, "cue-link-file", |v| v["phase"] == "received" || v["phase"] == "failed").is_some());
    let got = find(&sev, "cue-link-file", |v| v["phase"] == "received").expect("received, not failed");
    let path = got["path"].as_str().unwrap();
    assert_eq!(std::fs::read(path).unwrap(), big);
    assert_eq!(got["showJson"], "{\"title\":\"La locandiera\"}");
    let audio = Path::new(path).parent().unwrap().join("Audio/Suoni.diaframma");
    assert!(audio.exists(), "relative layout kept");
    wait("primary told", 5, || find(&pev, "cue-link-file", |v| v["phase"] == "sent").is_some());

    // Two shows sent one right after the other (two quick edits): one fetch at a time, the newest wins, no failure shown.
    sev.lock().unwrap().clear();
    let send = |json: &str| {
        p.send_show(SendShow {
            show_id: "abc123".into(),
            tcue_path: show.join("Serata.tcue").to_string_lossy().into(),
            extra_paths: vec![],
            show_json: Some(json.into()),
        })
        .unwrap();
    };
    std::fs::write(show.join("Serata.tcue"), [&big[..], b"v2"].concat()).unwrap();
    send("{\"title\":\"v2\"}");
    send("{\"title\":\"v3\"}");
    wait("the newest show received", 10, || find(&sev, "cue-link-file", |v| v["phase"] == "received" && v["showJson"] == "{\"title\":\"v3\"}").is_some());
    assert!(find(&sev, "cue-link-file", |v| v["phase"] == "failed").is_none(), "{:?}", sev.lock().unwrap());
    assert_eq!(std::fs::read(path).unwrap(), [&big[..], b"v2"].concat());

    // The primary stops: the secondary sees the link lost, its reservation ends.
    assert!(s.reserve(true).ok);
    wait("reservation mirrored", 3, || s.info().reservation == Holder::Secondary);
    let t = Instant::now();
    drop(p);
    wait("lost on the secondary", 3, || s.info().status == Status::Lost);
    assert!(t.elapsed() < Duration::from_millis(500), "told by the bye, not by the timeout: {:?}", t.elapsed());
    let si = s.info();
    assert_eq!(si.reservation, Holder::None, "{si:?} {:?}", sev.lock().unwrap().iter().rev().take(6).collect::<Vec<_>>());
    assert!(si.lost_at.is_some());
    assert_eq!(s.request(json!({ "kind": "go" })).reason.as_deref(), Some("notConnected"));
}

#[test]
fn remembered_pairing_and_silent_loss() {
    let dir = tempfile::tempdir().unwrap();
    let (p, _pev) = node(10, 11, dir.path(), "primary");
    let code = p.configure(role(Role::Primary)).pairing_code.unwrap();
    {
        let (s, _) = node(11, 10, dir.path(), "secondary");
        s.configure(role(Role::Secondary));
        wait("found", 5, || s.info().found.is_some_and(|f| f.pairing));
        s.enter_code(&code).unwrap();
        wait("connected", 5, || s.info().phase == Phase::Connected);
    }
    // The secondary closed (bye): the primary shows the loss at once.
    wait("lost on the primary", 3, || p.info().status == Status::Lost);
    // Next start: no code needed.
    let (s, _) = node(11, 10, dir.path(), "secondary");
    assert_eq!(s.info().role, Role::Secondary, "role remembered");
    wait("reconnected without code", 5, || s.info().phase == Phase::Connected && p.info().status == Status::Stable);
    assert!(p.info().pairing_code.is_none());

    // Heartbeat stops without a bye (cable pulled out): lost after LOST_AFTER_MS, not before.
    s.halt_silently();
    let t = Instant::now();
    std::thread::sleep(Duration::from_millis(700));
    assert_ne!(p.info().status, Status::Lost, "not lost before one second");
    wait("lost after the heartbeat stops", 3, || p.info().status == Status::Lost);
    assert!(t.elapsed() < Duration::from_millis(1500), "{:?}", t.elapsed());

    // Forget: a code is needed again.
    let info = p.forget();
    assert!(info.pairing_code.is_some());
    assert!(info.paired_with.is_none());
}
