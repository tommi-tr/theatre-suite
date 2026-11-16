use crate::Result;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;

/// Downloads a small text file (an update list). Used only when the user allowed it.
pub fn fetch_text(url: &str, max_bytes: u64) -> Result<String> {
    if !url.starts_with("https://") {
        return Err("Only https addresses are allowed".into());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .into();
    let mut resp = agent
        .get(url)
        .header("User-Agent", "TheatreSuite-Launcher")
        .header("Accept", "application/json")
        .call()
        .map_err(|e| match e {
            // The interface turns this code into a sentence (the usual cause is a private repository).
            ureq::Error::StatusCode(404) => "NOT_FOUND".to_string(),
            ureq::Error::StatusCode(c) => format!("The server answered with error {c}"),
            other => format!("Cannot reach the server: {other}"),
        })?;
    resp.body_mut()
        .with_config()
        .limit(max_bytes)
        .read_to_string()
        .map_err(|e| format!("Cannot read the answer: {e}"))
}

/// Downloads a file (an installer) to `dest`, only from github.com over https.
/// It is written next to `dest` first and renamed only when complete and, if `sha256` is
/// given, only when it matches. `progress(received, total)` is called while it arrives.
pub fn download(
    url: &str,
    dest: &Path,
    max_bytes: u64,
    sha256: Option<&str>,
    mut progress: impl FnMut(u64, u64),
) -> Result<()> {
    if !url.starts_with("https://github.com/") {
        return Err("Installers are downloaded only from github.com".into());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(20)))
        .timeout_recv_body(Some(Duration::from_secs(60)))
        .build()
        .into();
    let mut resp = agent
        .get(url)
        .header("User-Agent", "TheatreSuite-Launcher")
        .call()
        .map_err(|e| match e {
            ureq::Error::StatusCode(404) => "NOT_FOUND".to_string(),
            ureq::Error::StatusCode(c) => format!("The server answered with error {c}"),
            other => format!("Cannot reach the server: {other}"),
        })?;
    let total = resp.body().content_length().unwrap_or(0);
    if total > max_bytes {
        return Err("The file is too large".into());
    }
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Cannot create the download folder: {e}"))?;
    }
    let part = dest.with_extension("part");
    let mut out =
        std::fs::File::create(&part).map_err(|e| format!("Cannot write the download: {e}"))?;
    let mut reader = resp.body_mut().with_config().limit(max_bytes).reader();
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut received = 0u64;
    let result = (|| -> Result<()> {
        loop {
            let n = reader
                .read(&mut buf)
                .map_err(|e| format!("The download stopped: {e}"))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])
                .map_err(|e| format!("Cannot write the download: {e}"))?;
            hasher.update(&buf[..n]);
            received += n as u64;
            progress(received, total);
        }
        out.sync_all()
            .map_err(|e| format!("Cannot write the download: {e}"))?;
        if let Some(expected) = sha256 {
            let got = hex(&hasher.finalize());
            if !got.eq_ignore_ascii_case(expected) {
                return Err("The downloaded file is damaged (check failed): try again".into());
            }
        }
        Ok(())
    })();
    drop(out);
    match result {
        Ok(()) => {
            std::fs::rename(&part, dest).map_err(|e| format!("Cannot save the download: {e}"))
        }
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            Err(e)
        }
    }
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// SHA-256 of a file already on disk.
pub fn sha256_of(file: &Path) -> Option<String> {
    let mut f = std::fs::File::open(file).ok()?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Some(hex(&h.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downloads_only_from_github() {
        let d = tempfile::tempdir().unwrap();
        assert!(
            download(
                "https://example.com/x.exe",
                &d.path().join("x.exe"),
                10,
                None,
                |_, _| {}
            )
            .is_err()
        );
        assert!(
            download(
                "http://github.com/x.exe",
                &d.path().join("x.exe"),
                10,
                None,
                |_, _| {}
            )
            .is_err()
        );
        assert!(!d.path().join("x.exe").exists());
    }

    #[test]
    fn hash_of_a_file() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("a");
        std::fs::write(&f, "abc").unwrap();
        assert_eq!(
            sha256_of(&f).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
