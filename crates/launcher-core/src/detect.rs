//! Finding the apps of the suite installed on this computer, and their version.
//!
//! On Windows the per-user installer writes the usual "Uninstall" entry
//! (`DisplayVersion`, `InstallLocation`); if that is not found the default
//! folder is tried. The user can always point to the program by hand.

use serde::Serialize;
use std::path::{Path, PathBuf};
use theatre_project::apps::KnownApp;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub path: String,
    /// `None` when the program is there but its version cannot be read.
    pub version: Option<String>,
}

pub fn find(app: &KnownApp, manual: Option<&str>) -> Option<Installed> {
    if let Some(m) = manual.filter(|m| !m.is_empty()) {
        let p = Path::new(m);
        if p.exists() {
            return Some(Installed { path: m.to_string(), version: platform::version_of(app, p) });
        }
    }
    platform::find(app)
}

#[cfg(windows)]
mod platform {
    use super::*;
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    pub fn version_of(app: &KnownApp, exe: &Path) -> Option<String> {
        let dir = exe.parent()?;
        registry_entries(app).into_iter().find(|(loc, _)| loc.as_deref().is_some_and(|l| Path::new(l) == dir)).and_then(|(_, v)| v)
    }

    /// (install location, version) for every Uninstall entry of the app.
    fn registry_entries(app: &KnownApp) -> Vec<(Option<String>, Option<String>)> {
        let key = format!(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{}", app.name);
        let mut out = vec![];
        for root in [RegKey::predef(HKEY_CURRENT_USER), RegKey::predef(HKEY_LOCAL_MACHINE)] {
            if let Ok(k) = root.open_subkey(&key) {
                let loc: Option<String> = k.get_value("InstallLocation").ok().map(|s: String| s.trim_matches('"').trim_end_matches('\\').to_string());
                let ver: Option<String> = k.get_value("DisplayVersion").ok();
                out.push((loc, ver));
            }
        }
        out
    }

    pub fn find(app: &KnownApp) -> Option<Installed> {
        for (loc, ver) in registry_entries(app) {
            if let Some(loc) = loc {
                let exe = PathBuf::from(&loc).join(app.exe);
                if exe.is_file() {
                    return Some(Installed { path: exe.to_string_lossy().to_string(), version: ver });
                }
            }
        }
        // Default per-user folder of the installer.
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
        let exe = local.join(app.name).join(app.exe);
        exe.is_file().then(|| Installed { path: exe.to_string_lossy().to_string(), version: None })
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    pub fn version_of(_app: &KnownApp, _exe: &Path) -> Option<String> {
        None
    }

    /// Outside Windows the launcher only knows programs chosen by hand.
    pub fn find(_app: &KnownApp) -> Option<Installed> {
        None
    }
}

#[allow(dead_code)]
fn _unused(_: PathBuf) {}

#[cfg(test)]
mod tests {
    use super::*;
    use theatre_project::apps::app_by_id;

    #[test]
    fn manual_path_wins_and_missing_manual_path_is_ignored() {
        let app = app_by_id("diaframma").unwrap();
        let d = tempfile::tempdir().unwrap();
        let exe = d.path().join("Diaframma.exe");
        std::fs::write(&exe, "").unwrap();
        let found = find(app, Some(&exe.to_string_lossy())).unwrap();
        assert_eq!(found.path, exe.to_string_lossy());
        assert!(find(app, Some("/does/not/exist")).is_none() || cfg!(windows));
    }
}
