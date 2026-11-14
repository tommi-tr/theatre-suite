//! Cantinella — native side.
//!
//! Everything happens in the interface: the native side keeps files safe
//! (atomic writes, autosave, crash recovery) and opens the file manager.
//! Nothing is ever sent outside the computer.

mod storage;

use tauri::{Emitter, Manager};

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "name": "Cantinella",
        "version": app.package_info().version.to_string(),
        "os": std::env::consts::OS,
    })
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second launch (for example a double click on a .cantinella file)
            // focuses the running window and hands it the file.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(file) = args.iter().skip(1).find(|a| storage::is_cantinella_file(a)) {
                let _ = app.emit("open-file", file.clone());
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            storage::settings_load,
            storage::settings_save,
            storage::session_start,
            storage::autosave_write,
            storage::autosave_clear,
            storage::file_read_text,
            storage::file_write_text,
            storage::file_read_bytes,
            storage::file_write_bytes,
            storage::path_exists,
            storage::reveal_in_folder,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Cantinella");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            storage::session_end(handle);
        }
    });
}
