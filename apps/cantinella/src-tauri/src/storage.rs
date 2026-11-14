//! Files on disk: settings, autosave, crash detection and user documents.
//!
//! Rules (see 03_sicurezza_installazione.md):
//! - Cantinella writes only inside its own data folder and where the user saves.
//! - Every write is atomic (temporary file + rename) so a crash never leaves
//!   a half-written file behind.
//! - A damaged file never crashes the app: it is set aside and reported.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

/// A production file (people, dates, costs, tour) stays far below this size.
const MAX_DOC_BYTES: u64 = 64 * 1024 * 1024;

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create the data folder: {e}"))?;
    Ok(dir)
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
    let file_name = path.file_name().ok_or("Invalid file name")?.to_string_lossy().to_string();
    let tmp = parent.join(format!(".{file_name}.tmp"));
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

fn read_bytes_limited(path: &Path) -> Result<Vec<u8>, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    if meta.len() > MAX_DOC_BYTES {
        return Err(format!("{} is too large", path.display()));
    }
    fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))
}

fn read_limited(path: &Path) -> Result<String, String> {
    let bytes = read_bytes_limited(path)?;
    String::from_utf8(bytes).map_err(|_| format!("{} is not a text file", path.display()))
}

/// Moves a damaged file aside (keeps it for inspection) instead of deleting it.
fn quarantine(path: &Path) {
    let mut target = path.to_path_buf();
    target.set_extension("damaged.json");
    let _ = fs::rename(path, target);
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
    /// Last autosaved state, if any (JSON text).
    pub autosave: Option<String>,
    /// File passed on the command line (double click on a .cantinella file).
    pub open_file: Option<String>,
}

fn lock_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("session.lock"))
}

pub fn is_cantinella_file(arg: &str) -> bool {
    arg.to_lowercase().ends_with(".cantinella")
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
    let open_file = std::env::args().skip(1).find(|a| is_cantinella_file(a));
    Ok(SessionStart { crashed, autosave, open_file })
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

// ---------------- User documents ----------------

#[tauri::command]
pub fn file_read_text(path: String) -> Result<String, String> {
    read_limited(Path::new(&path))
}

#[tauri::command]
pub fn file_write_text(path: String, text: String) -> Result<(), String> {
    atomic_write(Path::new(&path), text.as_bytes())
}

/// Reads a binary file (for example a vCard or CSV to import) and hands the
/// raw bytes to the interface without any conversion.
#[tauri::command]
pub fn file_read_bytes(path: String) -> Result<Response, String> {
    Ok(Response::new(read_bytes_limited(Path::new(&path))?))
}

/// Writes raw bytes (PDF, .ics…). The body of the call is the file content;
/// the destination travels in the `x-path` header (URI-encoded).
#[tauri::command]
pub fn file_write_bytes(request: Request<'_>) -> Result<(), String> {
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .ok_or("Missing destination")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw bytes".into());
    };
    atomic_write(Path::new(&path), bytes)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(b) = hex {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    !path.is_empty() && Path::new(&path).is_file()
}

/// Opens the file manager with the file selected (after an export).
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_paths() {
        assert_eq!(percent_decode("C%3A%5CUsers%5CAmleto%20bozza.pdf"), "C:\\Users\\Amleto bozza.pdf");
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("%E2%80%94"), "—");
        assert_eq!(percent_decode("bad%zz"), "bad%zz");
        assert_eq!(percent_decode("end%2"), "end%2");
    }

    #[test]
    fn atomic_write_replaces_content() {
        let dir = std::env::temp_dir().join(format!("cantinella-test-{}", std::process::id()));
        let file = dir.join("a.cantinella");
        atomic_write(&file, b"one").unwrap();
        atomic_write(&file, b"two").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        assert!(!dir.join(".a.cantinella.tmp").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn recognises_cantinella_files() {
        assert!(is_cantinella_file("C:\\Teatro\\Locandiera.CANTINELLA"));
        assert!(!is_cantinella_file("Locandiera.bardo"));
    }
}
