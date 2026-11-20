//! Files on disk: settings, autosave, crash detection, the `.tcue` show files and their versions.
//!
//! Rules (see 03_sicurezza_installazione.md):
//! - Cue writes only inside its own data folder and where the user saves.
//! - Every write is atomic (temporary file + rename) so a crash never leaves a half-written file.
//! - A damaged file never crashes the app: it is set aside or reported.
//!
//! With `--instance <n>` (n ≥ 2) the data folder gets a suffix (`it.theatresuite.cue-2`): settings,
//! autosave and crash marker of that instance are its own.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::tcue;

/// Settings, autosave and the launcher's index file stay far below this.
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = instance_dir(&base, crate::instance());
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create the data folder: {e}"))?;
    Ok(dir)
}

/// The data folder of an instance: the normal one for instance 1, `<folder>-<n>` otherwise.
pub fn instance_dir(base: &Path, instance: u32) -> PathBuf {
    if instance <= 1 {
        return base.to_path_buf();
    }
    let name = base.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "cue".into());
    base.with_file_name(format!("{name}-{instance}"))
}

fn sub_dir(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join(name);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create folder {name}: {e}"))?;
    Ok(dir)
}

/// Writes `bytes` to `path` atomically: temp file in the same folder, flush, rename.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid path")?;
    if !parent.as_os_str().is_empty() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create folder: {e}"))?;
    }
    let tmp = tcue::tmp_path(path);
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
        f.write_all(bytes).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
        f.sync_all().map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Cannot save {}: {e}", path.display())
    })
}

fn read_limited(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    if meta.len() > MAX_TEXT_BYTES {
        return Err(format!("{} is too large", path.display()));
    }
    let bytes = fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    String::from_utf8(bytes).map_err(|_| format!("{} is not a text file", path.display()))
}

/// Moves a damaged file aside (keeps it for inspection) instead of deleting it.
fn quarantine(path: &Path) {
    let mut target = path.to_path_buf();
    target.set_extension("damaged.json");
    let _ = fs::rename(path, target);
}

pub fn is_tcue_file(arg: &str) -> bool {
    tcue::has_ext(Path::new(arg))
}

/// The `.tcue` passed on the command line (double click on a file), skipping `--instance <n>`.
pub fn file_from_args(args: &[String]) -> Option<String> {
    let mut skip_next = false;
    for a in args.iter().skip(1) {
        if skip_next {
            skip_next = false;
            continue;
        }
        if a == "--instance" {
            skip_next = true;
            continue;
        }
        if is_tcue_file(a) {
            return Some(a.clone());
        }
    }
    None
}

// ---------------- Settings ----------------

#[tauri::command]
pub fn settings_load(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = data_dir(&app)?.join("settings.json");
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    match read_limited(&path).and_then(|s| serde_json::from_str::<serde_json::Value>(&s).map_err(|e| e.to_string())) {
        Ok(v) if v.is_object() => Ok(v),
        _ => {
            quarantine(&path);
            Ok(serde_json::json!({}))
        }
    }
}

#[tauri::command]
pub fn settings_save(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let path = data_dir(&app)?.join("settings.json");
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    atomic_write(&path, text.as_bytes())
}

// ---------------- Session, autosave, crash recovery ----------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStart {
    /// The previous session did not end normally.
    pub crashed: bool,
    /// Last autosaved state, if any (JSON text written by the interface).
    pub autosave: Option<String>,
    /// File passed on the command line (double click on a .tcue file).
    pub open_file: Option<String>,
    /// 1 normally; n with `--instance n`.
    pub instance: u32,
}

fn lock_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("session.lock"))
}

#[tauri::command]
pub fn session_start(app: AppHandle) -> Result<SessionStart, String> {
    let lock = lock_path(&app)?;
    let crashed = lock.exists();
    let auto = sub_dir(&app, "autosave")?.join("session.json");
    let autosave = if auto.exists() {
        match read_limited(&auto) {
            Ok(s) if serde_json::from_str::<serde_json::Value>(&s).is_ok() => Some(s),
            _ => {
                quarantine(&auto);
                None
            }
        }
    } else {
        None
    };
    atomic_write(&lock, std::process::id().to_string().as_bytes())?;
    let args: Vec<String> = std::env::args().collect();
    Ok(SessionStart { crashed, autosave, open_file: file_from_args(&args), instance: crate::instance() })
}

/// Called on a clean exit: removes the crash marker.
pub fn session_end(app: &AppHandle) {
    if let Ok(lock) = lock_path(app) {
        let _ = fs::remove_file(lock);
    }
}

#[tauri::command]
pub fn autosave_write(app: AppHandle, json: String) -> Result<(), String> {
    let path = sub_dir(&app, "autosave")?.join("session.json");
    atomic_write(&path, json.as_bytes())
}

#[tauri::command]
pub fn autosave_clear(app: AppHandle) -> Result<(), String> {
    let path = sub_dir(&app, "autosave")?.join("session.json");
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------- Other files ----------------

/// Reads a text file (the launcher's `progetto.theatre` next to the show file).
#[tauri::command]
pub fn file_read_text(path: String) -> Result<String, String> {
    read_limited(Path::new(&path))
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    !path.is_empty() && Path::new(&path).is_file()
}

/// Opens the file manager with the file selected.
#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("The file does not exist".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", p.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg("-R").arg(p).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let dir = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open").arg(dir).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------- Show files (.tcue) ----------------
// Async commands: they run off the main thread, so a big save never freezes the window.

fn tcue_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !tcue::has_ext(&p) {
        return Err("not-cue: The file name does not end with .tcue".into());
    }
    Ok(p)
}

#[tauri::command(async)]
pub fn tcue_new(path: String, title: String) -> Result<tcue::Opened, String> {
    Ok(tcue::new_file(&tcue_path(&path)?, &title)?)
}

#[tauri::command(async)]
pub fn tcue_open(path: String) -> Result<tcue::Opened, String> {
    Ok(tcue::open(Path::new(&path))?)
}

/// The bytes of one part, as a binary response (an ArrayBuffer in the interface, no base64).
#[tauri::command(async)]
pub fn tcue_read_part(path: String, name: String) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(tcue::read_part(Path::new(&path), &name)?))
}

#[tauri::command(async)]
pub fn tcue_save(
    path: String,
    source_path: Option<String>,
    show_json: Option<String>,
    add_parts: Option<Vec<tcue::AddPart>>,
    remove_parts: Option<Vec<String>>,
) -> Result<tcue::Saved, String> {
    let target = tcue_path(&path)?;
    let source = source_path.filter(|s| !s.is_empty()).map(PathBuf::from);
    Ok(tcue::save(
        &target,
        source.as_deref(),
        show_json.as_deref(),
        add_parts.as_deref().unwrap_or(&[]),
        remove_parts.as_deref().unwrap_or(&[]),
    )?)
}

// ---------------- Versions (`Serata.tcue` → `Serata.versions/`) ----------------

#[tauri::command(async)]
pub fn versions_list(path: String) -> Result<Vec<tcue::VersionEntry>, String> {
    Ok(tcue::list_versions(&tcue::versions_dir_of(&tcue_path(&path)?)))
}

/// Keeps the file as it is on disk now as a version; returns the path of the copy.
#[tauri::command(async)]
pub fn version_save(path: String, name: String, kind: String, note: String) -> Result<String, String> {
    Ok(tcue::save_version(&tcue_path(&path)?, &name, &kind, &note)?.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn version_restore(path: String, version: String) -> Result<tcue::Saved, String> {
    Ok(tcue::restore_version(&tcue_path(&path)?, Path::new(&version))?)
}

#[tauri::command(async)]
pub fn version_delete(path: String) -> Result<(), String> {
    Ok(tcue::delete_version(Path::new(&path))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_folders_are_separate() {
        let base = Path::new("/data/it.theatresuite.cue");
        assert_eq!(instance_dir(base, 1), base);
        assert_eq!(instance_dir(base, 0), base);
        assert_eq!(instance_dir(base, 2), Path::new("/data/it.theatresuite.cue-2"));
    }

    #[test]
    fn file_on_the_command_line() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(file_from_args(&a(&["cue", "C:\\Teatro\\Serata.TCUE"])), Some("C:\\Teatro\\Serata.TCUE".into()));
        assert_eq!(file_from_args(&a(&["cue", "--instance", "2", "Serata.tcue"])), Some("Serata.tcue".into()));
        assert_eq!(file_from_args(&a(&["cue", "--instance", "x.tcue"])), None);
        assert_eq!(file_from_args(&a(&["cue", "Luci.granvelo"])), None);
    }

    #[test]
    fn atomic_write_replaces_content() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        atomic_write(&file, b"one").unwrap();
        atomic_write(&file, b"two").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        assert!(!tcue::tmp_path(&file).exists());
    }
}
