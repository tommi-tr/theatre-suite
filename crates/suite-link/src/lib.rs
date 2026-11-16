//! How the apps of the suite call the launcher back ("Torna al launcher").
//!
//! The protocol is one command-line argument: `Theatre Suite.exe --show <show folder>`.
//! The launcher is a single-instance program, so a second start does not open a second
//! window: the running one receives the arguments, comes to the front and opens that show.
//!
//! Apps use [`find_launcher`] and [`open_launcher`]; the launcher uses [`show_dir_from_args`]
//! (the same function reads a double-clicked `progetto.theatre`, so there is one place that
//! knows how a show is named on the command line).

use std::path::{Path, PathBuf};
use std::process::Command;

/// The command-line flag that asks the launcher to show a show.
pub const SHOW_FLAG: &str = "--show";
/// The show index file the launcher writes in every show folder.
pub const SHOW_INDEX_FILE: &str = "progetto.theatre";
/// Name of the launcher's `Uninstall` registry entry (its product name).
pub const LAUNCHER_PRODUCT: &str = "Theatre Suite";
/// Name of the launcher program on Windows.
pub const LAUNCHER_EXE: &str = "Theatre Suite.exe";

/// The show folder named by a command line (without the program name at the start).
///
/// Understands `--show <folder>`, `--show=<folder>` and a path to a `progetto.theatre`
/// (what Windows passes when the file is double-clicked): then it is the file's folder.
/// `--show` wins over a file. An empty value is ignored.
pub fn show_dir_from_args<S: AsRef<str>>(args: &[S]) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_ref();
        if a == SHOW_FLAG {
            if let Some(next) = args.get(i + 1).map(|s| s.as_ref().trim()).filter(|s| !s.is_empty()) {
                return Some(next.to_string());
            }
        } else if let Some(v) = a.strip_prefix("--show=") {
            let v = v.trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
        i += 1;
    }
    args.iter().map(|s| s.as_ref()).find(|a| a.to_lowercase().ends_with(".theatre")).and_then(folder_of)
}

/// Folder of a file path written with `\` or `/` (whatever system we run on).
fn folder_of(path: &str) -> Option<String> {
    let i = path.rfind(['/', '\\'])?;
    let dir = &path[..i];
    // "C:\x.theatre" has the drive as its folder.
    let dir = if dir.ends_with(':') { &path[..=i] } else { dir };
    (!dir.is_empty()).then(|| dir.to_string())
}

/// Where the launcher program could be, most reliable first, from what the installer
/// writes in the registry (`DisplayIcon`, `InstallLocation`) and the default per-user folder.
pub fn launcher_candidates(display_icon: Option<&str>, install_location: Option<&str>, local_app_data: Option<&Path>) -> Vec<PathBuf> {
    let clean = |s: &str| s.trim().trim_matches('"').trim_end_matches('\\').to_string();
    let mut out: Vec<PathBuf> = vec![];
    if let Some(icon) = display_icon.map(str::trim).filter(|s| !s.is_empty()) {
        // `"C:\...\Theatre Suite.exe",0`, `C:\...\Theatre Suite.exe,0` or just the path.
        let path = icon.rsplit_once(',').filter(|(_, n)| n.trim().parse::<i32>().is_ok()).map(|(p, _)| p).unwrap_or(icon);
        let path = clean(path);
        if path.to_lowercase().ends_with(".exe") {
            out.push(PathBuf::from(path));
        }
    }
    if let Some(loc) = install_location.map(clean).filter(|s| !s.is_empty()) {
        out.push(PathBuf::from(loc).join(LAUNCHER_EXE));
    }
    if let Some(local) = local_app_data {
        out.push(local.join(LAUNCHER_PRODUCT).join(LAUNCHER_EXE));
    }
    out
}

/// The installed launcher program, if there is one (Windows; elsewhere `None`).
pub fn find_launcher() -> Option<PathBuf> {
    platform::find()
}

/// Asks the launcher to show `show_dir` (starting it if it is not running).
/// The calling app is not touched: nothing is closed.
pub fn open_launcher(show_dir: &str) -> Result<(), String> {
    let dir = show_dir.trim();
    if dir.is_empty() {
        return Err("No show folder".to_string());
    }
    let exe = find_launcher().ok_or_else(|| "The Theatre Suite launcher is not installed".to_string())?;
    spawn(&exe, dir)
}

fn spawn(exe: &Path, dir: &str) -> Result<(), String> {
    let mut cmd = Command::new(exe);
    cmd.arg(SHOW_FLAG).arg(dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: the launcher must not die with the app.
        cmd.creation_flags(0x0000_0008 | 0x0000_0200);
        // The app has the keyboard focus: let the launcher take it, or Windows would only
        // make its taskbar button flash instead of bringing the window to the front.
        platform::allow_foreground();
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("Cannot start the launcher: {e}"))
}

#[cfg(windows)]
mod platform {
    use super::*;
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    unsafe extern "system" {
        fn AllowSetForegroundWindow(process_id: u32) -> i32;
    }

    /// Lets any process (the launcher, already running or about to) come to the front.
    pub fn allow_foreground() {
        // ASFW_ANY = (DWORD)-1
        // SAFETY: a plain Win32 call with a value argument; it touches no memory of ours.
        unsafe {
            AllowSetForegroundWindow(u32::MAX);
        }
    }

    pub fn find() -> Option<PathBuf> {
        let key = format!(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{LAUNCHER_PRODUCT}");
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
        for root in [RegKey::predef(HKEY_CURRENT_USER), RegKey::predef(HKEY_LOCAL_MACHINE)] {
            if let Ok(k) = root.open_subkey(&key) {
                let icon: Option<String> = k.get_value("DisplayIcon").ok();
                let loc: Option<String> = k.get_value("InstallLocation").ok();
                if let Some(p) = launcher_candidates(icon.as_deref(), loc.as_deref(), None).into_iter().find(|p| p.is_file()) {
                    return Some(p);
                }
            }
        }
        launcher_candidates(None, None, local.as_deref()).into_iter().find(|p| p.is_file())
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    /// Outside Windows there is no registry to ask: the launcher is not found.
    pub fn find() -> Option<PathBuf> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn show_flag_with_a_separate_value() {
        assert_eq!(show_dir_from_args(&v(&["--show", r"C:\Spettacoli\Amleto"])), Some(r"C:\Spettacoli\Amleto".into()));
    }

    #[test]
    fn show_flag_with_equals_and_after_the_program_name() {
        assert_eq!(show_dir_from_args(&v(&["Theatre Suite.exe", "--show=/home/x/Amleto"])), Some("/home/x/Amleto".into()));
    }

    #[test]
    fn a_double_clicked_index_gives_its_folder() {
        let args = v(&["Theatre Suite.exe", "/shows/Amleto/progetto.theatre"]);
        assert_eq!(show_dir_from_args(&args), Some("/shows/Amleto".into()));
        // The flag wins over a file.
        let both = v(&["/a/progetto.theatre", "--show", "/b"]);
        assert_eq!(show_dir_from_args(&both), Some("/b".into()));
    }

    #[test]
    fn a_windows_path_is_cut_at_the_last_separator() {
        assert_eq!(folder_of(r"D:\Amleto\progetto.theatre"), Some(r"D:\Amleto".into()));
        assert_eq!(folder_of(r"D:\progetto.theatre"), Some(r"D:\".into()));
        assert_eq!(folder_of("progetto.theatre"), None);
    }

    #[test]
    fn nothing_to_show() {
        assert_eq!(show_dir_from_args::<String>(&[]), None);
        assert_eq!(show_dir_from_args(&v(&["--show"])), None);
        assert_eq!(show_dir_from_args(&v(&["--show", "  "])), None);
        assert_eq!(show_dir_from_args(&v(&["--show=", "notes.txt"])), None);
    }

    #[test]
    fn a_folder_with_spaces_stays_in_one_piece() {
        assert_eq!(show_dir_from_args(&v(&["--show", r"C:\Mio Teatro\Il giardino dei ciliegi"])), Some(r"C:\Mio Teatro\Il giardino dei ciliegi".into()));
    }

    #[test]
    fn candidates_prefer_the_registry_icon_then_location_then_default_folder() {
        let local = PathBuf::from(r"C:\Users\x\AppData\Local");
        let c = launcher_candidates(Some(r#""C:\Programs\Theatre Suite\Theatre Suite.exe",0"#), Some(r"C:\Programs\Theatre Suite\"), Some(&local));
        assert_eq!(c[0], PathBuf::from(r"C:\Programs\Theatre Suite\Theatre Suite.exe"));
        assert_eq!(c[1], PathBuf::from(r"C:\Programs\Theatre Suite").join(LAUNCHER_EXE)); // joined with the separator of the system running the test
        assert_eq!(c[2], local.join("Theatre Suite").join(LAUNCHER_EXE));
        assert_eq!(c.len(), 3);
    }

    #[test]
    fn an_icon_that_is_not_a_program_is_ignored() {
        let c = launcher_candidates(Some(r"C:\x\icon.ico"), None, None);
        assert!(c.is_empty());
    }

    #[test]
    fn open_needs_a_folder_and_an_installed_launcher() {
        assert!(open_launcher("  ").is_err());
        if !cfg!(windows) {
            assert!(open_launcher("/some/show").unwrap_err().contains("not installed"));
        }
    }

    #[test]
    fn spawning_a_missing_program_is_an_error_not_a_panic() {
        let d = tempfile::tempdir().unwrap();
        assert!(spawn(&d.path().join("nope.exe"), "/x").is_err());
    }
}
