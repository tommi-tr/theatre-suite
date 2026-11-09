//! Diaframma — native side.
//!
//! The audio engine runs on its own threads, independent from the
//! interface: if the window freezes, sound keeps playing.

mod audio;
mod rehearsal;
mod remote;
mod storage;

use tauri::{Emitter, Manager};

/// Folder with the sounds that come with Diaframma (launchpad).
#[tauri::command]
fn builtin_sounds_dir(app: tauri::AppHandle) -> Option<String> {
    let dir = app.path().resource_dir().ok()?.join("sounds");
    if dir.is_dir() {
        return Some(dir.to_string_lossy().to_string());
    }
    // During development the sounds are next to the sources.
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("sounds");
    dev.is_dir().then(|| dev.to_string_lossy().to_string())
}

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
            let engine = audio::Engine::start(app.handle().clone(), "engine-state", false, audio::model::Config::default());
            app.manage(engine);
            // The internal player and the launchpad: GO just plays, nothing else is touched.
            let simple = audio::model::Config { steps: false, auto_advance: false, others_on_go: audio::model::OthersOnGo::Keep, ..Default::default() };
            app.manage(audio::Player(audio::Engine::start(app.handle().clone(), "player-state", true, audio::model::Config { others_on_go: audio::model::OthersOnGo::Stop, ..simple })));
            app.manage(audio::Pads(audio::Engine::start(app.handle().clone(), "pads-state", true, simple)));
            let journal = storage::data_dir(app.handle()).map(|d| d.join("rehearsal-journal.json")).unwrap_or_default();
            app.manage(rehearsal::Rehearsal::start(journal));
            app.manage(remote::ext::ExtBridge::start());
            app.manage(remote::phone::Phone::start(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            builtin_sounds_dir,
            storage::settings_load,
            storage::settings_save,
            storage::session_start,
            storage::autosave_write,
            storage::autosave_clear,
            storage::file_read_text,
            storage::file_write_text,
            storage::paths_exist,
            storage::open_project_page,
            storage::find_files,
            storage::resolve_relative,
            storage::make_relative,
            audio::engine_devices,
            audio::engine_set_device,
            audio::engine_sync,
            audio::engine_set_standby,
            audio::engine_standby_step,
            audio::engine_go,
            audio::engine_pause,
            audio::engine_pause_all,
            audio::engine_seek,
            audio::engine_stop_all,
            audio::engine_state,
            audio::engine_analyze,
            audio::selftest_run,
            audio::player_sync,
            audio::player_play,
            audio::player_pause,
            audio::player_seek,
            audio::player_stop,
            audio::player_set_speed,
            audio::player_set_device,
            audio::player_state,
            audio::pads_sync,
            audio::pads_play,
            audio::pads_stop,
            audio::pads_stop_all,
            audio::pads_set_device,
            audio::pads_state,
            rehearsal::rh_snapshot,
            rehearsal::rh_media,
            rehearsal::rh_set_volume,
            rehearsal::rh_set_speed,
            rehearsal::rh_route,
            rehearsal::rh_pause_all,
            rehearsal::rh_set_output_volume,
            rehearsal::rh_restore,
            remote::ext::ext_enable,
            remote::ext::ext_tabs,
            remote::ext::ext_command,
            remote::phone::phone_enable,
            remote::phone::phone_info,
            remote::phone::phone_new_code,
            remote::phone::phone_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Diaframma");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(engine) = handle.try_state::<audio::Engine>() {
                engine.shutdown();
            }
            if let Some(player) = handle.try_state::<audio::Player>() {
                player.0.shutdown();
            }
            if let Some(pads) = handle.try_state::<audio::Pads>() {
                pads.0.shutdown();
            }
            // Put volumes and outputs of other programs back as they were.
            if let Some(rh) = handle.try_state::<rehearsal::Rehearsal>() {
                rh.restore();
            }
            storage::session_end(handle);
        }
    });
}
