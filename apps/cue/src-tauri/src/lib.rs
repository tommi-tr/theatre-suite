//! Cue — native side.
//!
//! The native side keeps the show file safe (`.tcue` zip: atomic saves, raw copy of unchanged parts,
//! autosave, crash recovery, versions next to the file), keeps Windows awake while Cue is open and
//! talks to the launcher. Nothing leaves the computer.
//!
//! One Cue at a time (single-instance plugin), except with `--instance <n>` (n ≥ 2): a separate
//! process with its own data folder, used to try primary and secondary on one computer.

mod audio;
mod dmx;
mod files;
pub mod net;
mod power;
mod ppt;
mod projection;
mod storage;
mod tcue;

use std::sync::OnceLock;

use tauri::{Emitter, Manager};

/// WebView2 options. Same for every window of the app (they share one browser process): the output window plays
/// videos by itself, without a click, so autoplay must be allowed. These are Tauri's defaults plus the autoplay switch.
#[cfg(windows)]
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

static INSTANCE: OnceLock<u32> = OnceLock::new();

/// `--instance <n>` / `--instance=<n>` from the command line; 1 when absent or not a number ≥ 1.
pub fn instance_from_args(args: &[String]) -> u32 {
    let mut it = args.iter().skip(1);
    while let Some(a) = it.next() {
        let value = if a == "--instance" {
            it.next().map(|s| s.as_str())
        } else {
            a.strip_prefix("--instance=")
        };
        if let Some(v) = value {
            return v.trim().parse::<u32>().ok().filter(|n| *n >= 1 && *n <= 99).unwrap_or(1);
        }
    }
    1
}

/// This process's instance number (1 = the normal, single instance).
pub fn instance() -> u32 {
    *INSTANCE.get_or_init(|| instance_from_args(&std::env::args().collect::<Vec<_>>()))
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "name": "Cue",
        "version": app.package_info().version.to_string(),
        "os": std::env::consts::OS,
        "instance": instance(),
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
    let n = instance();
    let mut builder = tauri::Builder::default();
    if n <= 1 {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second launch (for example a double click on a .tcue file)
            // focuses the running window and hands it the file.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(file) = storage::file_from_args(&args) {
                let _ = app.emit("open-file", file);
            }
        }));
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Sound and lights engines: started at their first command, stopped at exit.
        .manage(audio::CueAudio::default())
        .manage(dmx::CueDmx::default())
        .manage(net::CueLink::default())
        .manage(projection::Videos::default())
        .manage(ppt::Live::default())
        .register_uri_scheme_protocol("cuevideo", |ctx, request| {
            let r = projection::serve_video(ctx.app_handle(), request);
            let (parts, body) = r.into_parts();
            tauri::http::Response::from_parts(parts, std::borrow::Cow::Owned(body))
        })
        .setup(move |app| {
            // The window is created here (not from the config) so that an extra instance gets its own
            // webview data folder: two WebView2 processes must not share one.
            let cfg = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("missing main window config")?;
            let mut win = tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?;
            #[cfg(windows)]
            {
                win = win.additional_browser_args(BROWSER_ARGS);
            }
            if n >= 2 {
                let base = app.path().app_local_data_dir()?;
                win = win.data_directory(storage::instance_dir(&base, n).join("webview")).title(format!("Cue · {n}"));
            }
            win.build()?;
            power::keep_awake(true);
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
            storage::part_stage,
            storage::part_stage_bytes,
            storage::staged_read,
            storage::staged_drop,
            storage::part_export,
            storage::file_read_text,
            storage::file_write_text,
            storage::path_exists,
            storage::reveal_in_folder,
            storage::tcue_new,
            storage::tcue_open,
            storage::tcue_read_part,
            storage::tcue_save,
            storage::versions_list,
            storage::version_save,
            storage::version_restore,
            storage::version_delete,
            files::files_read_text,
            files::files_sha256,
            files::files_read_bytes,
            files::files_resolve_relative,
            files::files_relative_to,
            projection::proj_monitors,
            projection::proj_open,
            projection::proj_close,
            projection::proj_is_open,
            projection::proj_video_url,
            projection::proj_copy_video,
            ppt::ppt_available,
            ppt::ppt_connect,
            ppt::ppt_command,
            ppt::ppt_disconnect,
            ppt::ppt_export,
            ppt::ppt_temp_dir,
            ppt::ppt_cleanup,
            audio::audio_list_devices,
            audio::audio_set_device,
            audio::audio_sync,
            audio::audio_play_now,
            audio::audio_stop_track,
            audio::audio_stop_all,
            audio::audio_set_paused,
            audio::audio_state,
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
            net::link_info,
            net::link_configure,
            net::link_new_code,
            net::link_enter_code,
            net::link_forget,
            net::link_request,
            net::link_reply,
            net::link_publish_state,
            net::link_publish_event,
            net::link_reserve,
            net::link_take_commands,
            net::link_chat,
            net::link_pointer,
            net::link_send_show,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Cue");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            ppt::shutdown(&handle.state::<ppt::Live>());
            audio::shutdown(handle);
            dmx::shutdown(handle);
            net::shutdown(handle);
            power::keep_awake(false);
            storage::session_end(handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_argument() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(instance_from_args(&a(&["cue"])), 1);
        assert_eq!(instance_from_args(&a(&["cue", "--instance", "2"])), 2);
        assert_eq!(instance_from_args(&a(&["cue", "Serata.tcue", "--instance=3"])), 3);
        assert_eq!(instance_from_args(&a(&["cue", "--instance", "zero"])), 1);
        assert_eq!(instance_from_args(&a(&["cue", "--instance"])), 1);
    }
}
