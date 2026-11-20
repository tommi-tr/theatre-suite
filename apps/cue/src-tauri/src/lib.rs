//! Cue — native side.
//!
//! The native side keeps the show file safe (`.tcue` zip: atomic saves, raw copy of unchanged parts,
//! autosave, crash recovery, versions next to the file), keeps Windows awake while Cue is open and
//! talks to the launcher. Nothing leaves the computer.
//!
//! One Cue at a time (single-instance plugin), except with `--instance <n>` (n ≥ 2): a separate
//! process with its own data folder, used to try primary and secondary on one computer.

mod power;
mod storage;
mod tcue;

use std::sync::OnceLock;

use tauri::{Emitter, Manager};

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
            storage::staged_read,
            storage::staged_drop,
            storage::part_export,
            storage::file_read_text,
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building Cue");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
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
