//! Phone remote: a page served on the local Wi-Fi.
//!
//! Off by default. When on, it listens on port 47812 and answers only to
//! requests carrying the access code shown in the QR. Nothing leaves the
//! local network.

use std::io::Read;
use std::net::UdpSocket;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Response, Server};

use crate::audio::Engine;
use crate::rehearsal::{Rehearsal, Snapshot};

pub const PORT: u16 = 47812;
const PAGE: &str = include_str!("phone.html");

#[derive(Default)]
struct State {
    enabled: bool,
    code: String,
    locked: bool,
    favorites: serde_json::Value,
    /// Volume levels of the rehearsal sources as Diaframma shows them (0…1, by source id).
    levels: serde_json::Value,
    /// Main volume of Rehearsal mode (0…1).
    rh_main: f64,
    error: Option<String>,
    rh_cache: Option<(Instant, Snapshot)>,
}

#[derive(Clone, Default)]
pub struct Phone {
    st: Arc<Mutex<State>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneInfo {
    pub enabled: bool,
    pub url: String,
    pub code: String,
    pub qr_svg: String,
    pub error: Option<String>,
}

fn local_ip() -> String {
    // No packet is sent: this only asks the system which interface would be used.
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("192.168.255.255:9")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".into())
}

impl Phone {
    pub fn start(app: AppHandle) -> Self {
        let p = Phone::default();
        p.st.lock().code = super::random_code(8);
        let st = p.st.clone();
        thread::Builder::new()
            .name("diaframma-phone".into())
            .spawn(move || run(st, app))
            .expect("phone thread");
        p
    }
    pub fn info(&self) -> PhoneInfo {
        let s = self.st.lock();
        let url = format!("http://{}:{}/?k={}", local_ip(), PORT, s.code);
        let qr_svg = qrcode::QrCode::new(url.as_bytes())
            .map(|q| q.render::<qrcode::render::svg::Color>().min_dimensions(220, 220).quiet_zone(true).dark_color(qrcode::render::svg::Color("#000000")).light_color(qrcode::render::svg::Color("#ffffff")).build())
            .unwrap_or_default();
        PhoneInfo { enabled: s.enabled, url, code: s.code.clone(), qr_svg, error: s.error.clone() }
    }
}

fn json(v: &impl Serialize) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(serde_json::to_string(v).unwrap_or_else(|_| "{}".into()))
        .with_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]).unwrap())
        .with_header(Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]).unwrap())
}

fn run(st: Arc<Mutex<State>>, app: AppHandle) {
    let mut server: Option<Server> = None;
    loop {
        let enabled = st.lock().enabled;
        if !enabled {
            server = None;
            thread::sleep(Duration::from_millis(300));
            continue;
        }
        if server.is_none() {
            match Server::http(("0.0.0.0", PORT)) {
                Ok(s) => {
                    st.lock().error = None;
                    server = Some(s);
                }
                Err(e) => {
                    st.lock().error = Some(format!("Port {PORT} is busy: {e}"));
                    thread::sleep(Duration::from_secs(2));
                    continue;
                }
            }
        }
        let Ok(Some(mut req)) = server.as_ref().unwrap().recv_timeout(Duration::from_millis(250)) else { continue };
        let url = req.url().to_string();
        let (path, query) = url.split_once('?').unwrap_or((&url, ""));
        let code_ok = {
            let code = st.lock().code.clone();
            query.split('&').any(|kv| kv == format!("k={code}"))
        };
        if !code_ok {
            let _ = req.respond(Response::from_string("Diaframma: wrong or missing access code. Scan the QR code again.").with_status_code(403));
            continue;
        }
        let resp = match (req.method(), path) {
            (Method::Get, "/") => Response::from_string(PAGE).with_header(Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap()),
            (Method::Get, "/api/state") => {
                let engine = app.state::<Engine>();
                let show = engine.summary();
                let rh = {
                    let cached = st.lock().rh_cache.as_ref().filter(|(t, _)| t.elapsed() < Duration::from_millis(1500)).map(|(_, s)| s.clone());
                    match cached {
                        Some(s) => s,
                        None => {
                            let s = app.state::<Rehearsal>().snapshot();
                            st.lock().rh_cache = Some((Instant::now(), s.clone()));
                            s
                        }
                    }
                };
                let s = st.lock();
                json(&serde_json::json!({
                    "show": show,
                    "locked": s.locked,
                    "sources": rh.sources.iter().map(|x| {
                        let level = s.levels.get(&x.id).and_then(|v| v.as_f64()).or(x.volume.map(|v| v as f64));
                        serde_json::json!({"id": x.id, "app": x.app, "title": x.title, "artist": x.artist, "status": x.status, "canToggle": x.can_toggle, "canNext": x.can_next, "canPrev": x.can_prev, "volume": level, "hasVolume": x.volume.is_some()})
                    }).collect::<Vec<_>>(),
                    "favorites": s.favorites,
                    "rhMain": s.rh_main,
                }))
            }
            (Method::Post, "/api/cmd") => {
                let mut body = String::new();
                let _ = req.as_reader().take(4096).read_to_string(&mut body);
                let v: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
                let action = v.get("action").and_then(|x| x.as_str()).unwrap_or("");
                let engine = app.state::<Engine>();
                let result: Result<(), String> = match action {
                    "go" => engine.go(),
                    "up" => {
                        engine.standby_step(-1);
                        Ok(())
                    }
                    "down" => {
                        engine.standby_step(1);
                        Ok(())
                    }
                    "pause" | "pauseall" => {
                        engine.pause_all();
                        Ok(())
                    }
                    "vol" => {
                        let db = v.get("db").and_then(|x| x.as_f64()).unwrap_or(0.0).clamp(-60.0, 10.0);
                        let _ = app.emit("phone-main-volume", db);
                        Ok(())
                    }
                    "stopall" => {
                        engine.stop_all(false);
                        app.state::<crate::audio::Pads>().0.stop_all(false);
                        Ok(())
                    }
                    "rh" => {
                        let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let op = v.get("op").and_then(|x| x.as_str()).unwrap_or("toggle").to_string();
                        st.lock().rh_cache = None;
                        app.state::<Rehearsal>().media(id, op)
                    }
                    "rhpauseall" => {
                        app.state::<Rehearsal>().pause_all();
                        st.lock().rh_cache = None;
                        Ok(())
                    }
                    "star" => {
                        let _ = app.emit("phone-star", v.get("id").cloned().unwrap_or_default());
                        Ok(())
                    }
                    "unstar" => {
                        let _ = app.emit("phone-unstar", v.get("id").cloned().unwrap_or_default());
                        Ok(())
                    }
                    "rhvol" => {
                        let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let level = v.get("v").and_then(|x| x.as_f64()).unwrap_or(1.0).clamp(0.0, 1.0);
                        st.lock().rh_cache = None;
                        let _ = app.emit("phone-rh-volume", serde_json::json!({ "id": id, "v": level }));
                        Ok(())
                    }
                    _ => Err("Unknown command".into()),
                };
                match result {
                    Ok(()) => json(&serde_json::json!({"ok": true})),
                    Err(e) => json(&serde_json::json!({"ok": false, "error": e})),
                }
            }
            _ => Response::from_string("Not found").with_status_code(404),
        };
        let _ = req.respond(resp);
    }
}

// ---------------- Tauri commands ----------------

#[tauri::command]
pub fn phone_enable(p: tauri::State<'_, Phone>, on: bool) -> PhoneInfo {
    p.st.lock().enabled = on;
    std::thread::sleep(Duration::from_millis(150));
    p.info()
}

#[tauri::command]
pub fn phone_info(p: tauri::State<'_, Phone>) -> PhoneInfo {
    p.info()
}

#[tauri::command]
pub fn phone_new_code(p: tauri::State<'_, Phone>) -> PhoneInfo {
    p.st.lock().code = super::random_code(8);
    p.info()
}

#[tauri::command]
pub fn phone_update(p: tauri::State<'_, Phone>, locked: bool, favorites: serde_json::Value, levels: serde_json::Value, rh_main: f64) {
    let mut s = p.st.lock();
    s.locked = locked;
    s.favorites = favorites;
    s.levels = levels;
    s.rh_main = rh_main;
}
