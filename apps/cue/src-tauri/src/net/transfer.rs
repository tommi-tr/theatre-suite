//! Sending the show to the secondary over TCP (port 47811): the `.tcue`, the files of the sources it
//! refers to (so the secondary can show names and previews) and, optionally, a newer `show.json`
//! not yet saved. Videos are never sent.
//!
//! 1. The primary announces a **manifest** (reliable message `file`): `{ transferId, showId, port, main,
//!    files: [{ name, size, sha256 }], showJson?: { size, sha256 } }`. Names are paths relative to the
//!    folder that contains all the files, with `/` (so relative references keep working on the secondary).
//! 2. The secondary keeps the files it already has with the same SHA-256 and connects to the primary's
//!    TCP port. First line: a signed `fetch` envelope `{ transferId, names }` (session key, sequence number).
//! 3. The primary answers, for each name, a JSON line `{ name, size, sha256 }` and the bytes; then `{"end":true}`.
//! 4. The secondary writes each file to `<name>.part`, checks its SHA-256 and renames it over its copy
//!    (the primary wins), then reports `fileDone` (reliable message).

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::crypto;

/// Name of the in-memory `show.json` in a manifest and a fetch.
pub const SHOW_JSON: &str = "@show.json";
/// Largest file sent (a script PDF is far below).
pub const MAX_FILE: u64 = 1024 * 1024 * 1024;
pub const MAX_FILES: usize = 64;
/// Video files stay on each computer (13_cue.md): never sent.
pub const VIDEO_EXT: &[&str] = &["mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv", "mpg", "mpeg"];
pub const IO_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_LINE: usize = 64 * 1024;
const CHUNK: u64 = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub transfer_id: String,
    pub show_id: String,
    /// The primary's TCP port.
    pub port: u16,
    /// Name of the `.tcue` among `files`.
    pub main: String,
    pub files: Vec<FileEntry>,
    pub show_json: Option<FileEntry>,
    /// Files not sent, with the reason (`video`, `outside`, `missing`, `tooBig`).
    pub skipped: Vec<(String, String)>,
}

/// A manifest with where each file is on the primary.
#[derive(Debug, Clone)]
pub struct Prepared {
    pub manifest: Manifest,
    pub paths: HashMap<String, PathBuf>,
    pub show_json: Option<Vec<u8>>,
}

pub fn sha256_file(path: &Path) -> std::io::Result<(u64, String)> {
    let mut f = fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut n = 0u64;
    loop {
        let r = f.read(&mut buf)?;
        if r == 0 {
            break;
        }
        h.update(&buf[..r]);
        n += r as u64;
    }
    Ok((n, crypto::to_hex(&h.finalize())))
}

pub fn sha256_bytes(b: &[u8]) -> String {
    crypto::to_hex(&Sha256::digest(b))
}

/// The deepest folder containing every path (None: different drives).
fn common_base(paths: &[&Path]) -> Option<PathBuf> {
    let mut base: Vec<Component> = paths.first()?.parent()?.components().collect();
    for p in &paths[1..] {
        let comps: Vec<Component> = p.parent()?.components().collect();
        let n = base.iter().zip(comps.iter()).take_while(|(a, b)| a == b).count();
        base.truncate(n);
    }
    let has_root = base.iter().any(|c| matches!(c, Component::RootDir | Component::Prefix(_)));
    has_root.then(|| base.iter().collect())
}

fn rel_name(base: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(base).ok()?;
    let parts: Vec<String> = rel.components().map(|c| match c {
        Component::Normal(s) => Some(s.to_string_lossy().to_string()),
        _ => None,
    }).collect::<Option<_>>()?;
    let name = parts.join("/");
    safe_name(&name).then_some(name)
}

/// A relative name that cannot leave the destination folder (no `..`, no drive, no absolute path,
/// no characters Windows refuses).
pub fn safe_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 1000 || name.starts_with('/') {
        return false;
    }
    name.split('/').all(|part| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && part.len() <= 255
            && !part.ends_with(' ')
            && !part.ends_with('.')
            && !part.chars().any(|c| c.is_control() || "<>:\"\\|?*".contains(c))
    })
}

fn is_video(p: &Path) -> bool {
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).is_some_and(|e| VIDEO_EXT.contains(&e.as_str()))
}

/// Builds the manifest (reads every file once for its SHA-256).
pub fn prepare(transfer_id: String, show_id: &str, port: u16, tcue: &Path, extra: &[PathBuf], show_json: Option<String>) -> Result<Prepared, String> {
    if !tcue.is_file() {
        return Err(format!("missing: {}", tcue.display()));
    }
    let mut skipped = Vec::new();
    let mut candidates: Vec<&Path> = vec![tcue];
    for p in extra {
        if is_video(p) {
            skipped.push((p.display().to_string(), "video".into()));
        } else if !p.is_file() {
            skipped.push((p.display().to_string(), "missing".into()));
        } else if !candidates.contains(&p.as_path()) {
            candidates.push(p);
        }
    }
    // The base is the deepest folder with the .tcue and as many sources as possible: a source on another
    // drive is skipped instead of moving the base to nothing.
    let mut chosen: Vec<&Path> = vec![tcue];
    for p in &candidates[1..] {
        let mut trial = chosen.clone();
        trial.push(p);
        if common_base(&trial).is_some() {
            chosen.push(p);
        } else {
            skipped.push((p.display().to_string(), "outside".into()));
        }
    }
    let base = common_base(&chosen).ok_or("bad-path: no common folder")?;
    let mut files = Vec::new();
    let mut paths = HashMap::new();
    for p in chosen.iter().take(MAX_FILES) {
        let Some(name) = rel_name(&base, p) else {
            skipped.push((p.display().to_string(), "outside".into()));
            continue;
        };
        let (size, sha256) = sha256_file(p).map_err(|e| format!("io: {}: {e}", p.display()))?;
        if size > MAX_FILE {
            skipped.push((p.display().to_string(), "tooBig".into()));
            continue;
        }
        files.push(FileEntry { name: name.clone(), size, sha256 });
        paths.insert(name, p.to_path_buf());
    }
    let main = rel_name(&base, tcue).ok_or("bad-path: the show file")?;
    let show_bytes = show_json.map(String::into_bytes);
    let show_entry = show_bytes.as_ref().map(|b| FileEntry { name: SHOW_JSON.into(), size: b.len() as u64, sha256: sha256_bytes(b) });
    Ok(Prepared {
        manifest: Manifest { transfer_id, show_id: show_id.to_string(), port, main, files, show_json: show_entry, skipped },
        paths,
        show_json: show_bytes,
    })
}

/// Where the secondary keeps the copy of a show: `<received>/<showId>/` (ids are checked).
pub fn show_root(received: &Path, show_id: &str) -> Option<PathBuf> {
    let ok = !show_id.is_empty() && show_id.len() <= 64 && show_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then(|| received.join(show_id))
}

/// The names of the manifest the secondary must fetch (missing or with another SHA-256).
pub fn needed(manifest: &Manifest, root: &Path) -> Vec<String> {
    let mut out: Vec<String> = manifest
        .files
        .iter()
        .filter(|f| safe_name(&f.name))
        .filter(|f| match sha256_file(&root.join(&f.name)) {
            Ok((size, sha)) => size != f.size || sha != f.sha256,
            Err(_) => true,
        })
        .map(|f| f.name.clone())
        .collect();
    if manifest.show_json.is_some() {
        out.push(SHOW_JSON.into());
    }
    out
}

fn read_line(r: &mut impl BufRead) -> Result<Vec<u8>, String> {
    let mut line = Vec::new();
    let n = r.by_ref().take(MAX_LINE as u64 + 1).read_until(b'\n', &mut line).map_err(|e| format!("io: {e}"))?;
    if n == 0 || line.last() != Some(&b'\n') {
        return Err("io: connection closed".into());
    }
    line.pop();
    Ok(line)
}

/// Primary: serves one connection. `authorize(first_line)` checks the signed fetch and gives the
/// transfer to serve and the names asked for.
pub fn serve(stream: TcpStream, authorize: impl FnOnce(&[u8]) -> Result<(std::sync::Arc<Prepared>, Vec<String>), String>) -> Result<u64, String> {
    stream.set_read_timeout(Some(IO_TIMEOUT)).ok();
    stream.set_write_timeout(Some(IO_TIMEOUT)).ok();
    stream.set_nodelay(true).ok();
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| format!("io: {e}"))?);
    let mut w = std::io::BufWriter::with_capacity(256 * 1024, stream);
    let first = read_line(&mut reader)?;
    let (prep, names) = match authorize(&first) {
        Ok(v) => v,
        Err(e) => {
            let _ = writeln!(w, "{}", serde_json::json!({ "error": e }));
            let _ = w.flush();
            return Err(e);
        }
    };
    let mut sent = 0u64;
    for name in names {
        let (entry, data): (FileEntry, Box<dyn Read>) = if name == SHOW_JSON {
            let (Some(e), Some(b)) = (prep.manifest.show_json.clone(), prep.show_json.clone()) else { return Err("no-part: show.json".into()) };
            (e, Box::new(std::io::Cursor::new(b)))
        } else {
            let Some(e) = prep.manifest.files.iter().find(|f| f.name == name).cloned() else { return Err(format!("no-part: {name}")) };
            let path = prep.paths.get(&name).ok_or("no-part")?;
            let f = fs::File::open(path).map_err(|e| format!("io: {e}"))?;
            let size = e.size;
            (e, Box::new(f.take(size)))
        };
        let header = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
        writeln!(w, "{header}").map_err(|e| format!("io: {e}"))?;
        let n = std::io::copy(&mut data.take(entry.size), &mut w).map_err(|e| format!("io: {e}"))?;
        if n != entry.size {
            return Err(format!("io: {name} changed while sending"));
        }
        sent += n;
    }
    writeln!(w, "{}", serde_json::json!({ "end": true })).map_err(|e| format!("io: {e}"))?;
    w.flush().map_err(|e| format!("io: {e}"))?;
    Ok(sent)
}

/// What a fetch brought.
#[derive(Debug, Default)]
pub struct Fetched {
    pub written: Vec<String>,
    pub bytes: u64,
    pub show_json: Option<String>,
}

/// Secondary: fetches `names` of `manifest` from `addr`, writing under `root`. `progress(done, total)`.
pub fn fetch(addr: SocketAddr, request_line: &[u8], manifest: &Manifest, names: &[String], root: &Path, mut progress: impl FnMut(u64, u64)) -> Result<Fetched, String> {
    let stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).map_err(|e| format!("connect: {e}"))?;
    stream.set_read_timeout(Some(IO_TIMEOUT)).ok();
    stream.set_write_timeout(Some(IO_TIMEOUT)).ok();
    stream.set_nodelay(true).ok();
    let mut w = stream.try_clone().map_err(|e| format!("io: {e}"))?;
    w.write_all(request_line).and_then(|_| w.write_all(b"\n")).map_err(|e| format!("io: {e}"))?;
    let mut r = BufReader::with_capacity(256 * 1024, stream);
    let total: u64 = names
        .iter()
        .filter_map(|n| if n == SHOW_JSON { manifest.show_json.as_ref() } else { manifest.files.iter().find(|f| &f.name == n) })
        .map(|f| f.size)
        .sum();
    let mut out = Fetched::default();
    let mut done = 0u64;
    fs::create_dir_all(root).map_err(|e| format!("io: {e}"))?;
    loop {
        let line = read_line(&mut r)?;
        let v: serde_json::Value = serde_json::from_slice(&line).map_err(|_| "io: bad header".to_string())?;
        if v.get("end").is_some() {
            break;
        }
        if let Some(e) = v.get("error").and_then(|e| e.as_str()) {
            return Err(format!("refused: {e}"));
        }
        let entry: FileEntry = serde_json::from_value(v).map_err(|_| "io: bad header".to_string())?;
        let expected = if entry.name == SHOW_JSON { manifest.show_json.as_ref() } else { manifest.files.iter().find(|f| f.name == entry.name) };
        if expected != Some(&entry) || !names.contains(&entry.name) {
            return Err(format!("io: unexpected {}", entry.name));
        }
        let mut h = Sha256::new();
        let mut left = entry.size;
        let mut buf = vec![0u8; 256 * 1024];
        if entry.name == SHOW_JSON {
            let mut bytes = Vec::with_capacity(entry.size as usize);
            while left > 0 {
                let n = r.read(&mut buf[..left.min(CHUNK) as usize]).map_err(|e| format!("io: {e}"))?;
                if n == 0 {
                    return Err("io: connection closed".into());
                }
                bytes.extend_from_slice(&buf[..n]);
                left -= n as u64;
            }
            if sha256_bytes(&bytes) != entry.sha256 {
                return Err("sha256: show.json".into());
            }
            out.show_json = Some(String::from_utf8(bytes).map_err(|_| "io: show.json is not text".to_string())?);
            done += entry.size;
            progress(done, total);
            continue;
        }
        if !safe_name(&entry.name) {
            return Err(format!("bad-part: {}", entry.name));
        }
        let dest = root.join(&entry.name);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("io: {e}"))?;
        }
        let part = PathBuf::from(format!("{}.part", dest.display()));
        let res = (|| -> Result<(), String> {
            let mut f = fs::File::create(&part).map_err(|e| format!("io: {e}"))?;
            while left > 0 {
                let n = r.read(&mut buf[..left.min(CHUNK) as usize]).map_err(|e| format!("io: {e}"))?;
                if n == 0 {
                    return Err("io: connection closed".into());
                }
                h.update(&buf[..n]);
                f.write_all(&buf[..n]).map_err(|e| format!("io: {e}"))?;
                left -= n as u64;
                done += n as u64;
                progress(done, total);
            }
            f.sync_all().map_err(|e| format!("io: {e}"))?;
            if crypto::to_hex(&h.finalize()) != entry.sha256 {
                return Err(format!("sha256: {}", entry.name));
            }
            crate::tcue::rename_retry(&part, &dest).map_err(|e| format!("io: {e}"))
        })();
        if let Err(e) = res {
            let _ = fs::remove_file(&part);
            return Err(e);
        }
        out.written.push(entry.name.clone());
        out.bytes += entry.size;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_names() {
        assert!(safe_name("Serata.tcue"));
        assert!(safe_name("Audio/Suoni è belli.diaframma"));
        assert!(!safe_name("../x"));
        assert!(!safe_name("a/../x"));
        assert!(!safe_name("/etc/x"));
        assert!(!safe_name("C:/x"));
        assert!(!safe_name("a\\b"));
        assert!(!safe_name("a//b"));
        assert!(!safe_name("a/./b"));
        assert!(!safe_name("trailing. "));
        assert!(!safe_name(""));
    }

    #[test]
    fn manifest_keeps_relative_layout_and_skips_videos() {
        let dir = tempfile::tempdir().unwrap();
        let show = dir.path().join("Locandiera");
        fs::create_dir_all(show.join("Audio")).unwrap();
        fs::write(show.join("Serata.tcue"), b"zip").unwrap();
        fs::write(show.join("Audio/Suoni.diaframma"), b"{}").unwrap();
        fs::write(dir.path().join("Luci.granvelo"), b"{}").unwrap();
        fs::write(show.join("clip.mp4"), b"v").unwrap();
        let p = prepare(
            "t1".into(),
            "show1",
            47811,
            &show.join("Serata.tcue"),
            &[show.join("Audio/Suoni.diaframma"), dir.path().join("Luci.granvelo"), show.join("clip.mp4"), show.join("nope.granvelo")],
            Some("{\"a\":1}".into()),
        )
        .unwrap();
        let names: Vec<_> = p.manifest.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["Locandiera/Serata.tcue", "Locandiera/Audio/Suoni.diaframma", "Luci.granvelo"]);
        assert_eq!(p.manifest.main, "Locandiera/Serata.tcue");
        assert_eq!(p.manifest.skipped.iter().map(|(_, r)| r.as_str()).collect::<Vec<_>>(), vec!["video", "missing"]);
        assert_eq!(p.manifest.show_json.as_ref().unwrap().sha256, sha256_bytes(b"{\"a\":1}"));
        assert_eq!(p.manifest.files[0].sha256, sha256_bytes(b"zip"));
        let root = dir.path().join("recv");
        assert_eq!(needed(&p.manifest, &root).len(), 4);
        fs::create_dir_all(root.join("Locandiera")).unwrap();
        fs::write(root.join("Locandiera/Serata.tcue"), b"zip").unwrap();
        assert_eq!(needed(&p.manifest, &root), vec!["Locandiera/Audio/Suoni.diaframma", "Luci.granvelo", SHOW_JSON]);
    }

    #[test]
    fn show_roots() {
        let r = Path::new("/x");
        assert!(show_root(r, "0123abcd-ef").is_some());
        assert!(show_root(r, "../x").is_none());
        assert!(show_root(r, "").is_none());
    }
}
