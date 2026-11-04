//! Diaframma — native side.
//!
//! The audio engine runs on its own threads, independent from the
//! interface: if the window freezes, sound keeps playing.

mod audio;
mod storage;

use tauri::{Emitter, Manager};

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "name": "Diaframma",
        "version": app.package_info().version.to_string(),
        "os": std::env::consts::OS,
    })
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second launch (for example a double click on a .diaframma file)
            // focuses the running window and hands it the file.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(file) = args.iter().skip(1).find(|a| a.to_lowercase().ends_with(".diaframma")) {
                let _ = app.emit("open-file", file.clone());
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let engine = audio::Engine::start(app.handle().clone());
            app.manage(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            storage::settings_load,
            storage::settings_save,
            storage::session_start,
            storage::autosave_write,
            storage::autosave_clear,
            storage::file_read_text,
            storage::file_write_text,
            storage::paths_exist,
            storage::find_files,
            storage::resolve_relative,
            storage::make_relative,
            audio::engine_devices,
            audio::engine_set_device,
            audio::engine_sync,
            audio::engine_set_standby,
            audio::engine_go,
            audio::engine_pause,
            audio::engine_stop_all,
            audio::engine_state,
            audio::engine_analyze,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Diaframma");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(engine) = handle.try_state::<audio::Engine>() {
                engine.shutdown();
            }
            storage::session_end(handle);
        }
    });
}
