//! Granvelo — native side.
//!
//! The native side keeps files safe (atomic writes, autosave, crash recovery,
//! versions next to the file), opens the file manager and runs the DMX engine
//! (`dmx`: its own thread, serial port). The engine sends nothing to any device
//! until the user presses "Connetti"; nothing leaves the computer.

mod dmx;
mod storage;

use tauri::{Emitter, Manager};

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "name": "Granvelo",
        "version": app.package_info().version.to_string(),
        "os": std::env::consts::OS,
    })
}

/// Is the Theatre Suite launcher installed? ("Torna al launcher" appears only if it is.)
#[tauri::command]
fn launcher_available() -> bool {
    suite_link::find_launcher().is_some()
}

/// Brings the launcher to the front on `show_dir`. This app stays open and untouched.
#[tauri::command(async)]
fn open_launcher(show_dir: String) -> Result<(), String> {
    suite_link::open_launcher(&show_dir)
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second launch (for example a double click on a .granvelo file)
            // focuses the running window and hands it the file.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(file) = args.iter().skip(1).find(|a| storage::is_granvelo_file(a)) {
                let _ = app.emit("open-file", file.clone());
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Started idle: no port is opened until dmx_connect.
            app.manage(dmx::DmxEngine::start(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            launcher_available,
            open_launcher,
            storage::settings_load,
            storage::settings_save,
            storage::session_start,
            storage::autosave_write,
            storage::autosave_clear,
            storage::file_read_text,
            storage::file_write_text,
            storage::path_exists,
            storage::reveal_in_folder,
            storage::versions_list,
            storage::version_delete,
            dmx::dmx_list_devices,
            dmx::dmx_connect,
            dmx::dmx_disconnect,
            dmx::dmx_set_universe,
            dmx::dmx_fade_to,
            dmx::dmx_pause,
            dmx::dmx_resume,
            dmx::dmx_stop_fade,
            dmx::dmx_blackout,
            dmx::dmx_fade_to_black,
            dmx::dmx_release_black,
            dmx::dmx_grand_master,
            dmx::dmx_get_status,
            dmx::dmx_test_output,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Granvelo");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(engine) = handle.try_state::<dmx::DmxEngine>() {
                engine.shutdown();
            }
            storage::session_end(handle);
        }
    });
}
