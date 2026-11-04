//! Files on disk: settings, autosave, crash detection and user documents.
//!
//! Rules (see 03_sicurezza_installazione.md):
//! - Diaframma writes only inside its own data folder and where the user saves.
//! - Every write is atomic (temporary file + rename) so a crash never leaves
//!   a half-written file behind.
//! - A damaged file never crashes the app: it is set aside and reported.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const MAX_DOC_BYTES: u64 = 32 * 1024 * 1024;

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

fn read_limited(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    if meta.len() > MAX_DOC_BYTES {
        return Err(format!("{} is too large to be a Diaframma file", path.display()));
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
    /// File passed on the command line (double click on a .diaframma file).
    pub open_file: Option<String>,
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
    let open_file = std::env::args().skip(1).find(|a| a.to_lowercase().ends_with(".diaframma"));
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

#[tauri::command]
pub fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| !p.is_empty() && Path::new(p).is_file()).collect()
}

/// Looks for files by name inside `dir` (and its sub-folders, up to a few levels).
/// Used by the guided search of missing audio files.
#[tauri::command]
pub fn find_files(dir: String, names: Vec<String>) -> Vec<Option<String>> {
    let wanted: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
    let mut found: Vec<Option<String>> = vec![None; names.len()];
    let mut stack = vec![(PathBuf::from(dir), 0usize)];
    let mut visited = 0usize;
    while let Some((d, depth)) = stack.pop() {
        visited += 1;
        if visited > 5000 {
            break;
        }
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_dir() {
                if depth < 4 {
                    stack.push((p, depth + 1));
                }
            } else if let Some(name) = p.file_name().map(|n| n.to_string_lossy().to_lowercase()) {
                for (i, w) in wanted.iter().enumerate() {
                    if found[i].is_none() && *w == name {
                        found[i] = Some(p.to_string_lossy().to_string());
                    }
                }
            }
        }
        if found.iter().all(|f| f.is_some()) {
            break;
        }
    }
    found
}

/// Resolves a path stored relative to the cue list file.
#[tauri::command]
pub fn resolve_relative(base_file: String, relative: String) -> Option<String> {
    let base = Path::new(&base_file).parent()?;
    let p = base.join(relative.replace('\\', std::path::MAIN_SEPARATOR_STR).replace('/', std::path::MAIN_SEPARATOR_STR));
    if p.is_file() { Some(p.to_string_lossy().to_string()) } else { None }
}

/// Computes `target` relative to the folder of `base_file` (for portable cue lists).
#[tauri::command]
pub fn make_relative(base_file: String, target: String) -> Option<String> {
    let base = Path::new(&base_file).parent()?;
    let target = Path::new(&target);
    let base_c: Vec<_> = base.components().collect();
    let tgt_c: Vec<_> = target.components().collect();
    let mut common = 0;
    while common < base_c.len() && common < tgt_c.len() && base_c[common] == tgt_c[common] {
        common += 1;
    }
    if common == 0 {
        return None; // different drive
    }
    let mut parts: Vec<String> = Vec::new();
    for _ in common..base_c.len() {
        parts.push("..".into());
    }
    for c in &tgt_c[common..] {
        parts.push(c.as_os_str().to_string_lossy().to_string());
    }
    Some(parts.join("/"))
}
