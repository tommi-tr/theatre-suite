//! Installing a chosen version of an app of the suite (newer or older), only when the
//! person asks. The installer is downloaded from the public releases, kept in the
//! launcher's data folder (so a version can be installed again without internet) and
//! run like a normal per-user installer: nothing outside the app's own folder is touched.

use crate::Result;
use crate::net;
use std::path::{Path, PathBuf};
use std::process::Command;
use theatre_project::updates::Installer;

/// Installers are a few MB; this is only a safety limit.
const MAX_INSTALLER_BYTES: u64 = 400 * 1024 * 1024;

/// One path component made only of plain characters, never "." or "..".
fn safe(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let t = t.trim_start_matches('.').to_string();
    if t.is_empty() { "_".into() } else { t }
}

/// Where the installer of `app` `version` is kept: `<data>/installers/<app>/<version>/<file>`.
pub fn cached_path(data_dir: &Path, app: &str, version: &str, inst: &Installer) -> PathBuf {
    data_dir
        .join("installers")
        .join(safe(app))
        .join(safe(version))
        .join(safe(&inst.name))
}

/// Versions of `app` whose installer is already on this computer.
pub fn cached_versions(data_dir: &Path, app: &str) -> Vec<String> {
    let dir = data_dir.join("installers").join(safe(app));
    let Ok(rd) = std::fs::read_dir(dir) else {
        return vec![];
    };
    rd.flatten()
        .filter(|e| {
            e.path().is_dir()
                && std::fs::read_dir(e.path())
                    .map(|mut r| {
                        r.any(|f| {
                            f.is_ok_and(|f| {
                                f.path()
                                    .extension()
                                    .is_some_and(|x| x.eq_ignore_ascii_case("exe"))
                            })
                        })
                    })
                    .unwrap_or(false)
        })
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect()
}

/// Makes sure the installer is on disk (downloading it if needed) and returns its path.
/// A kept copy is reused only if it still matches the expected checksum (when known).
pub fn fetch(
    data_dir: &Path,
    app: &str,
    version: &str,
    inst: &Installer,
    progress: impl FnMut(u64, u64),
) -> Result<PathBuf> {
    let dest = cached_path(data_dir, app, version, inst);
    if dest.is_file() {
        let good = match &inst.sha256 {
            Some(h) => net::sha256_of(&dest).is_some_and(|g| g.eq_ignore_ascii_case(h)),
            None => std::fs::metadata(&dest)
                .map(|m| inst.size == 0 || m.len() == inst.size)
                .unwrap_or(false),
        };
        if good {
            return Ok(dest);
        }
        let _ = std::fs::remove_file(&dest);
    }
    net::download(
        &inst.url,
        &dest,
        MAX_INSTALLER_BYTES,
        inst.sha256.as_deref(),
        progress,
    )?;
    Ok(dest)
}

/// Runs an app installer without questions (`/S`) and waits for it. If the app is open the
/// installer closes it. Returns an error if the installer reports a failure.
pub fn run_silent(installer: &Path) -> Result<()> {
    if !cfg!(windows) {
        return Err("Installing from the launcher works on Windows for now".into());
    }
    let status = Command::new(installer)
        .arg("/S")
        .status()
        .map_err(|e| format!("Cannot start the installer: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "The installer stopped with code {}",
            status.code().unwrap_or(-1)
        ))
    }
}

/// Arguments of the NSIS installer to update the launcher itself: `/P` shows only a small
/// progress window (no questions), `/UPDATE` keeps shortcuts and settings as they are,
/// `/R` starts the launcher again when the installation is finished.
pub const SELF_UPDATE_ARGS: [&str; 3] = ["/P", "/UPDATE", "/R"];

/// Starts the installer of the launcher itself, without waiting: the launcher must close so it
/// can be replaced, and the installer opens it again by itself when it is done.
pub fn run_self_update(installer: &Path) -> Result<()> {
    if !cfg!(windows) {
        return Err("Installing from the launcher works on Windows for now".into());
    }
    Command::new(installer)
        .args(SELF_UPDATE_ARGS)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Cannot start the installer: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inst(name: &str) -> Installer {
        Installer {
            url: "https://github.com/o/r/x.exe".into(),
            name: name.into(),
            size: 3,
            sha256: Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into()),
        }
    }

    #[test]
    fn a_kept_installer_is_reused_only_if_it_is_intact() {
        let d = tempfile::tempdir().unwrap();
        let i = inst("Bardo_0.1.0_x64-setup.exe");
        let p = cached_path(d.path(), "bardo", "0.1.0", &i);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, "abc").unwrap();
        assert_eq!(fetch(d.path(), "bardo", "0.1.0", &i, |_, _| {}).unwrap(), p);
        assert_eq!(
            cached_versions(d.path(), "bardo"),
            vec!["0.1.0".to_string()]
        );
        // Damaged copy: removed, then a download is attempted (which fails offline here).
        std::fs::write(&p, "abd").unwrap();
        let _ = fetch(d.path(), "bardo", "0.1.0", &i, |_, _| {});
        assert!(std::fs::read(&p).map(|b| b == b"abc").unwrap_or(true));
    }

    #[test]
    fn the_launcher_updates_itself_with_a_progress_window_and_restarts() {
        // Without /R the person would have to find and start the launcher again.
        assert!(SELF_UPDATE_ARGS.contains(&"/R"));
        assert!(SELF_UPDATE_ARGS.contains(&"/UPDATE"));
        // Never fully silent: a progress window is shown while the launcher is replaced.
        assert!(!SELF_UPDATE_ARGS.contains(&"/S"));
    }

    #[test]
    fn names_cannot_escape_the_folder() {
        let d = tempfile::tempdir().unwrap();
        let p = cached_path(d.path(), "../x", "1/../../2", &inst("..\\evil.exe"));
        assert!(p.starts_with(d.path().join("installers")));
        assert!(p.components().all(|c| matches!(
            c,
            std::path::Component::Normal(_)
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )));
        assert_eq!(
            cached_path(d.path(), "..", "..", &inst(".."))
                .parent()
                .unwrap()
                .parent()
                .unwrap(),
            d.path().join("installers").join("_")
        );
    }
}
