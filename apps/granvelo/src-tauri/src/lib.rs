//! Granvelo — native side.
//!
//! Phase 0: the native side keeps files safe (atomic writes, autosave, crash
//! recovery, versions next to the file) and opens the file manager. The DMX
//! engine (its own thread, serial port) arrives with Granvelo 0.2: until then
//! nothing is ever sent to any device, and nothing leaves the computer.

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
        ])
        .build(tauri::generate_context!())
        .expect("error while building Granvelo");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            storage::session_end(handle);
        }
    });
}
