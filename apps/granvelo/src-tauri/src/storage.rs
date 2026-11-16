//! Files on disk: settings, autosave, crash detection, user documents and their versions.
//!
//! Rules (see 03_sicurezza_installazione.md):
//! - Granvelo writes only inside its own data folder and where the user saves.
//! - Every write is atomic (temporary file + rename) so a crash never leaves
//!   a half-written file behind.
//! - A damaged file never crashes the app: it is set aside and reported.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// A lighting file (lights, memories as 512-value arrays) stays far below this size.
const MAX_DOC_BYTES: u64 = 64 * 1024 * 1024;

const EXT: &str = "granvelo";

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
        return Err(format!("{} is too large to be a Granvelo file", path.display()));
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

fn has_ext(p: &Path) -> bool {
    p.extension().map(|e| e.to_string_lossy().eq_ignore_ascii_case(EXT)).unwrap_or(false)
}

pub fn is_granvelo_file(arg: &str) -> bool {
    has_ext(Path::new(arg))
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
    /// File passed on the command line (double click on a .granvelo file).
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
    let open_file = std::env::args().skip(1).find(|a| is_granvelo_file(a));
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

// ---------------- Versions of a lighting file ----------------
//
// Versions are plain copies of the file, kept in a folder next to it
// (`Show.granvelo` → `Show.versions/`), as Diaframma does. They belong to the
// user like the file itself.

/// One saved version in a versions folder.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub path: String,
    pub name: String,
    /// Last modification, milliseconds since 1970.
    pub modified_ms: u64,
    pub bytes: u64,
}

fn is_versions_dir(dir: &Path) -> bool {
    dir.file_name().map(|n| n.to_string_lossy().to_lowercase().ends_with(".versions")).unwrap_or(false)
}

fn list_versions(dir: &Path) -> Vec<VersionEntry> {
    let mut out: Vec<VersionEntry> = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else { return out };
    for entry in rd.flatten() {
        let p = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() || !has_ext(&p) {
            continue;
        }
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(VersionEntry {
            name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            path: p.to_string_lossy().to_string(),
            modified_ms,
            bytes: meta.len(),
        });
    }
    // Newest first; the name breaks ties (names start with the date).
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| b.name.cmp(&a.name)));
    out
}

/// Lists the versions saved in `dir` (a `*.versions` folder), newest first. A missing folder is an empty list.
#[tauri::command]
pub fn versions_list(dir: String) -> Result<Vec<VersionEntry>, String> {
    let d = Path::new(&dir);
    if !is_versions_dir(d) {
        return Err("This is not a versions folder.".into());
    }
    Ok(list_versions(d))
}

/// Deletes one saved version. Only `.granvelo` files inside a `*.versions` folder can be deleted this way.
#[tauri::command]
pub fn version_delete(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let ok_dir = p.parent().map(is_versions_dir).unwrap_or(false);
    if !ok_dir || !has_ext(p) {
        return Err("Only saved versions can be deleted.".into());
    }
    if p.is_file() {
        fs::remove_file(p).map_err(|e| format!("Cannot delete {}: {e}", p.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("granvelo-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn atomic_write_replaces_content() {
        let dir = temp_dir("atomic");
        let file = dir.join("a.granvelo");
        atomic_write(&file, b"one").unwrap();
        atomic_write(&file, b"two").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        assert!(!dir.join(".a.granvelo.tmp").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn recognises_granvelo_files() {
        assert!(is_granvelo_file("C:\\Teatro\\Locandiera.GRANVELO"));
        assert!(is_granvelo_file("Locandiera.granvelo"));
        assert!(!is_granvelo_file("Locandiera.cantinella"));
        assert!(!is_granvelo_file("granvelo"));
    }

    #[test]
    fn lists_only_lighting_files_newest_first() {
        let d = temp_dir("list").join("Show.versions");
        fs::create_dir_all(&d).unwrap();
        atomic_write(&d.join("2026-11-16_0900.granvelo"), b"{}").unwrap();
        atomic_write(&d.join("2026-11-16_1000_auto.granvelo"), b"{}").unwrap();
        atomic_write(&d.join("notes.txt"), b"x").unwrap();
        let v = list_versions(&d);
        assert_eq!(v.len(), 2);
        assert!(v.iter().all(|x| x.name.ends_with(".granvelo")));
        assert!(v[0].modified_ms >= v[1].modified_ms);
        let _ = fs::remove_dir_all(d.parent().unwrap());
    }

    #[test]
    fn missing_folder_is_empty_and_wrong_folder_is_refused() {
        let d = std::env::temp_dir().join("granvelo-no-such-folder.versions");
        assert_eq!(versions_list(d.to_string_lossy().to_string()).unwrap(), vec![]);
        assert!(versions_list(std::env::temp_dir().to_string_lossy().to_string()).is_err());
    }

    #[test]
    fn delete_is_limited_to_saved_versions() {
        let root = temp_dir("delete");
        let d = root.join("Show.versions");
        fs::create_dir_all(&d).unwrap();
        let keep = root.join("Show.granvelo");
        atomic_write(&keep, b"{}").unwrap();
        let v = d.join("old.granvelo");
        atomic_write(&v, b"{}").unwrap();
        let other = d.join("notes.txt");
        atomic_write(&other, b"x").unwrap();
        assert!(version_delete(keep.to_string_lossy().to_string()).is_err());
        assert!(version_delete(other.to_string_lossy().to_string()).is_err());
        assert!(keep.is_file() && other.is_file());
        version_delete(v.to_string_lossy().to_string()).unwrap();
        assert!(!v.exists());
        let _ = fs::remove_dir_all(root);
    }
}
