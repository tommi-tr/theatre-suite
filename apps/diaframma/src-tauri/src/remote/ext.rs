//! Bridge for the Diaframma extension for Chrome.
//!
//! Listens on 127.0.0.1 only (never on the network), and only while the
//! user has turned "Chrome extension" on. Accepts connections whose Origin
//! is a Chrome extension.

use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;
use tungstenite::{Message, WebSocket};

pub const PORT: u16 = 47811;

#[derive(Default)]
struct State {
    enabled: bool,
    connected: bool,
    tabs: Vec<serde_json::Value>,
    outbox: Vec<String>,
    last_seen: Option<Instant>,
}

#[derive(Clone, Default)]
pub struct ExtBridge {
    st: Arc<Mutex<State>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtTabs {
    pub enabled: bool,
    pub connected: bool,
    pub tabs: Vec<serde_json::Value>,
}

impl ExtBridge {
    pub fn start() -> Self {
        let b = ExtBridge::default();
        let st = b.st.clone();
        thread::Builder::new()
            .name("diaframma-ext".into())
            .spawn(move || run(st))
            .expect("ext thread");
        b
    }
    pub fn set_enabled(&self, on: bool) {
        let mut s = self.st.lock();
        s.enabled = on;
        if !on {
            s.tabs.clear();
            s.connected = false;
        }
    }
    pub fn tabs(&self) -> ExtTabs {
        let s = self.st.lock();
        ExtTabs { enabled: s.enabled, connected: s.connected, tabs: s.tabs.clone() }
    }
    pub fn command(&self, tab_id: i64, action: String, value: Option<f64>) {
        let msg = serde_json::json!({ "type": "cmd", "tabId": tab_id, "action": action, "value": value });
        self.st.lock().outbox.push(msg.to_string());
    }
}

fn run(st: Arc<Mutex<State>>) {
    let mut listener: Option<TcpListener> = None;
    loop {
        let enabled = st.lock().enabled;
        if !enabled {
            listener = None;
            thread::sleep(Duration::from_millis(300));
            continue;
        }
        if listener.is_none() {
            match TcpListener::bind(("127.0.0.1", PORT)) {
                Ok(l) => {
                    let _ = l.set_nonblocking(true);
                    listener = Some(l);
                }
                Err(_) => {
                    thread::sleep(Duration::from_secs(2));
                    continue;
                }
            }
        }
        match listener.as_ref().unwrap().accept() {
            Ok((stream, _)) => serve(stream, &st),
            Err(_) => thread::sleep(Duration::from_millis(200)),
        }
    }
}

fn serve(stream: TcpStream, st: &Arc<Mutex<State>>) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(100)));
    let check = |req: &tungstenite::handshake::server::Request, resp: tungstenite::handshake::server::Response| {
        let origin = req.headers().get("origin").and_then(|v| v.to_str().ok()).unwrap_or("");
        if origin.starts_with("chrome-extension://") && req.uri().path() == "/diaframma" {
            Ok(resp)
        } else {
            let mut r = tungstenite::handshake::server::ErrorResponse::new(Some("Forbidden".into()));
            *r.status_mut() = tungstenite::http::StatusCode::FORBIDDEN;
            Err(r)
        }
    };
    let Ok(mut ws): Result<WebSocket<TcpStream>, _> = tungstenite::accept_hdr(stream, check) else { return };
    {
        let mut s = st.lock();
        s.connected = true;
        s.last_seen = Some(Instant::now());
    }
    loop {
        if !st.lock().enabled {
            let _ = ws.close(None);
            break;
        }
        let out: Vec<String> = std::mem::take(&mut st.lock().outbox);
        let mut failed = false;
        for m in out {
            if ws.send(Message::Text(m.into())).is_err() {
                failed = true;
                break;
            }
        }
        if failed {
            break;
        }
        match ws.read() {
            Ok(Message::Text(t)) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(t.as_str()) {
                    let mut s = st.lock();
                    s.last_seen = Some(Instant::now());
                    if v.get("type").and_then(|x| x.as_str()) == Some("tabs") {
                        s.tabs = v.get("tabs").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                if st.lock().last_seen.map(|t| t.elapsed() > Duration::from_secs(20)).unwrap_or(false) {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let mut s = st.lock();
    s.connected = false;
    s.tabs.clear();
}

// ---------------- Tauri commands ----------------

#[tauri::command]
pub fn ext_enable(b: tauri::State<'_, ExtBridge>, on: bool) {
    b.set_enabled(on);
}

#[tauri::command]
pub fn ext_tabs(b: tauri::State<'_, ExtBridge>) -> ExtTabs {
    b.tabs()
}

#[tauri::command]
pub fn ext_command(b: tauri::State<'_, ExtBridge>, tab_id: i64, action: String, value: Option<f64>) {
    b.command(tab_id, action, value);
}
