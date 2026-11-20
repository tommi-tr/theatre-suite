//! Tauri commands of the link. The link starts at the first command (the network opens only with a role).

use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use super::link::{Configure, Link, LinkInfo, Outcome, SendShow};

#[derive(Default)]
pub struct CueLink(Mutex<Option<Arc<Link>>>);

fn get(app: &AppHandle, state: &State<CueLink>) -> Result<Arc<Link>, String> {
    let mut g = state.0.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(l) = g.as_ref() {
        return Ok(l.clone());
    }
    let dir = crate::storage::data_dir(app)?;
    let handle = app.clone();
    let sink: super::Sink = Arc::new(move |name: &str, v: Value| {
        let _ = handle.emit(name, v);
    });
    let link = Link::new(super::config_for(crate::instance(), &dir), sink);
    *g = Some(link.clone());
    Ok(link)
}

#[tauri::command(async)]
pub fn link_info(app: AppHandle, state: State<CueLink>) -> Result<LinkInfo, String> {
    Ok(get(&app, &state)?.info())
}

#[tauri::command(async)]
pub fn link_configure(app: AppHandle, state: State<CueLink>, config: Configure) -> Result<LinkInfo, String> {
    Ok(get(&app, &state)?.configure(config))
}

#[tauri::command(async)]
pub fn link_new_code(app: AppHandle, state: State<CueLink>) -> Result<LinkInfo, String> {
    Ok(get(&app, &state)?.new_code())
}

#[tauri::command(async)]
pub fn link_enter_code(app: AppHandle, state: State<CueLink>, code: String) -> Result<LinkInfo, String> {
    get(&app, &state)?.enter_code(&code)
}

#[tauri::command(async)]
pub fn link_forget(app: AppHandle, state: State<CueLink>) -> Result<LinkInfo, String> {
    Ok(get(&app, &state)?.forget())
}

#[tauri::command(async)]
pub fn link_request(app: AppHandle, state: State<CueLink>, op: Value) -> Result<Outcome, String> {
    Ok(get(&app, &state)?.request(op))
}

#[tauri::command(async)]
pub fn link_reply(app: AppHandle, state: State<CueLink>, request_id: String, ok: bool, reason: Option<String>) -> Result<bool, String> {
    Ok(get(&app, &state)?.reply(&request_id, ok, reason))
}

#[tauri::command(async)]
pub fn link_publish_state(app: AppHandle, state: State<CueLink>, show_state: Value) -> Result<bool, String> {
    get(&app, &state)?.publish_state(show_state)
}

#[tauri::command(async)]
pub fn link_publish_event(app: AppHandle, state: State<CueLink>, event: Value) -> Result<bool, String> {
    Ok(get(&app, &state)?.publish_event(event))
}

#[tauri::command(async)]
pub fn link_reserve(app: AppHandle, state: State<CueLink>, on: bool) -> Result<Outcome, String> {
    Ok(get(&app, &state)?.reserve(on))
}

#[tauri::command(async)]
pub fn link_take_commands(app: AppHandle, state: State<CueLink>, on: bool) -> Result<LinkInfo, String> {
    Ok(get(&app, &state)?.take_commands(on))
}

#[tauri::command(async)]
pub fn link_chat(app: AppHandle, state: State<CueLink>, text: String, quick: bool) -> Result<Value, String> {
    get(&app, &state)?.chat(&text, quick)
}

#[tauri::command(async)]
pub fn link_pointer(app: AppHandle, state: State<CueLink>, pointer: Value) -> Result<(), String> {
    get(&app, &state)?.pointer(pointer);
    Ok(())
}

#[tauri::command(async)]
pub fn link_send_show(app: AppHandle, state: State<CueLink>, request: SendShow) -> Result<Value, String> {
    get(&app, &state)?.send_show(request)
}

/// At exit: the other computer is told at once.
pub fn shutdown(app: &AppHandle) {
    let link = app.state::<CueLink>().0.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(l) = link {
        l.shutdown();
    }
}
