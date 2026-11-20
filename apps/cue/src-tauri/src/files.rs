//! Files of the other apps that a show links (`.granvelo`, `.diaframma`, later Bardo scripts and
//! videos): read as text, fingerprint (SHA-256), and paths relative to the `.tcue` file.
//!
//! Paths are handled as text (no file system access), with both `\` and `/` separators, drive
//! letters and UNC roots, so a show folder written on Windows still resolves when tests run
//! elsewhere and a relative path stays valid when the whole folder moves (USB stick, another PC).
//! Relative paths are written with `/`.
//!
//! Errors come back as `code: detail` — `missing`, `too-big`, `not-text`, `io` — and the interface
//! turns the code into a sentence.

use std::fs::File;
use std::io::{ErrorKind, Read};
use std::path::Path;

use sha2::{Digest, Sha256};

/// The largest text file read (a `.granvelo` with many memories is a few MB).
pub const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;

fn io_error(path: &str, e: std::io::Error) -> String {
    match e.kind() {
        ErrorKind::NotFound => format!("missing: {path}"),
        _ => format!("io: {path}: {e}"),
    }
}

/// The text of a file (UTF-8, at most `MAX_TEXT_BYTES`).
#[tauri::command(async)]
pub fn files_read_text(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let meta = std::fs::metadata(p).map_err(|e| io_error(&path, e))?;
    if !meta.is_file() {
        return Err(format!("missing: {path} is not a file"));
    }
    if meta.len() > MAX_TEXT_BYTES {
        return Err(format!("too-big: {path} ({} bytes)", meta.len()));
    }
    let bytes = std::fs::read(p).map_err(|e| io_error(&path, e))?;
    String::from_utf8(bytes).map_err(|_| format!("not-text: {path}"))
}

/// SHA-256 of a file (hex), read in blocks: fine for big videos.
#[tauri::command(async)]
pub fn files_sha256(path: String) -> Result<String, String> {
    let mut f = File::open(&path).map_err(|e| io_error(&path, e))?;
    sha256_reader(&mut f).map_err(|e| io_error(&path, e))
}

pub fn sha256_reader(r: &mut impl Read) -> std::io::Result<String> {
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = match r.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// `rel` (relative to the folder of the file `base`, `/` or `\`) as an absolute path; an absolute
/// `rel` is returned cleaned. `None` when `base` is not absolute.
#[tauri::command]
pub fn files_resolve_relative(base: String, rel: String) -> Option<String> {
    resolve_relative(&base, &rel)
}

/// `path` relative to the folder of the file `base` (`/` separators); `None` when they are on
/// different drives or roots (then the show keeps the absolute path).
#[tauri::command]
pub fn files_relative_to(base: String, path: String) -> Option<String> {
    relative_to(&base, &path)
}

// ---------------- Paths as text ----------------

#[derive(Debug, PartialEq)]
struct Parsed {
    /// `None` = relative. `Some("")` = POSIX `/`; `Some("C:")`, `Some(r"\\server\share")`, `Some("\\")`.
    root: Option<String>,
    parts: Vec<String>,
    windows: bool,
}

fn parse(p: &str) -> Parsed {
    let windows = p.contains('\\') || p.as_bytes().get(1) == Some(&b':');
    let is_sep = |c: char| c == '/' || c == '\\';
    let (root, rest): (Option<String>, &str) = if (p.starts_with("\\\\") || p.starts_with("//")) && p.len() > 2 {
        // UNC: \\server\share\...
        let mut it = p[2..].splitn(3, is_sep);
        let server = it.next().unwrap_or_default();
        let share = it.next().unwrap_or_default();
        (Some(format!("\\\\{server}\\{share}")), it.next().unwrap_or_default())
    } else if p.len() >= 2 && p.as_bytes()[1] == b':' && p.as_bytes()[0].is_ascii_alphabetic() {
        let rest = &p[2..];
        if rest.starts_with(is_sep) || rest.is_empty() {
            (Some(p[..2].to_ascii_uppercase()), rest)
        } else {
            // "C:file" (relative to the current folder of C:): treated as relative.
            (None, p)
        }
    } else if p.starts_with('/') {
        (Some(String::new()), p)
    } else if p.starts_with('\\') {
        (Some("\\".into()), p)
    } else {
        (None, p)
    };
    let parts = rest.split(is_sep).filter(|s| !s.is_empty() && *s != ".").map(String::from).collect();
    let windows = windows || root.as_deref().is_some_and(|r| r.ends_with(':') || r.starts_with('\\'));
    Parsed { root, parts, windows }
}

/// Removes `..` (never above the root).
fn normalize(parts: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for s in parts {
        if s == ".." {
            out.pop();
        } else {
            out.push(s);
        }
    }
    out
}

fn join(root: &str, parts: &[String], windows: bool) -> String {
    let sep = if windows { "\\" } else { "/" };
    let body = parts.join(sep);
    match root {
        "" => format!("/{body}"),
        "\\" => format!("\\{body}"),
        r => format!("{r}\\{body}"),
    }
}

pub fn resolve_relative(base: &str, rel: &str) -> Option<String> {
    let r = parse(rel);
    if let Some(root) = &r.root {
        return Some(join(root, &normalize(r.parts), r.windows));
    }
    let b = parse(base);
    let root = b.root?;
    let mut parts = b.parts;
    parts.pop(); // the file name: relative to its folder
    for s in r.parts {
        if s == ".." {
            parts.pop();
        } else {
            parts.push(s);
        }
    }
    Some(join(&root, &normalize(parts), b.windows))
}

pub fn relative_to(base: &str, path: &str) -> Option<String> {
    let b = parse(base);
    let p = parse(path);
    let (br, pr) = (b.root.as_ref()?, p.root.as_ref()?);
    let windows = b.windows || p.windows;
    let same = |x: &str, y: &str| if windows { x.eq_ignore_ascii_case(y) } else { x == y };
    if !same(br, pr) {
        return None;
    }
    let mut dir = normalize(b.parts);
    dir.pop();
    let target = normalize(p.parts);
    let common = dir.iter().zip(target.iter()).take_while(|(x, y)| same(x, y)).count();
    let mut out: Vec<String> = std::iter::repeat_n("..".to_string(), dir.len() - common).collect();
    out.extend(target[common..].iter().cloned());
    Some(if out.is_empty() { ".".into() } else { out.join("/") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_next_to_the_show_file() {
        let show = r"C:\Spettacoli\La locandiera\Serata.tcue";
        assert_eq!(resolve_relative(show, "Luci.granvelo").as_deref(), Some(r"C:\Spettacoli\La locandiera\Luci.granvelo"));
        assert_eq!(resolve_relative(show, "audio/Suoni.diaframma").as_deref(), Some(r"C:\Spettacoli\La locandiera\audio\Suoni.diaframma"));
        assert_eq!(resolve_relative(show, r"..\Comune\./x.granvelo").as_deref(), Some(r"C:\Spettacoli\Comune\x.granvelo"));
        assert_eq!(resolve_relative("/home/a/show/S.tcue", "../b/c.diaframma").as_deref(), Some("/home/a/b/c.diaframma"));
        // Never above the root.
        assert_eq!(resolve_relative(r"C:\S.tcue", r"..\..\x").as_deref(), Some(r"C:\x"));
    }

    #[test]
    fn absolute_paths_stay_absolute() {
        assert_eq!(resolve_relative(r"C:\a\S.tcue", r"D:\b\..\c.granvelo").as_deref(), Some(r"D:\c.granvelo"));
        assert_eq!(resolve_relative("/x/S.tcue", "/y/./z").as_deref(), Some("/y/z"));
        assert_eq!(resolve_relative(r"C:\a\S.tcue", r"\\nas\teatro\luci.granvelo").as_deref(), Some(r"\\nas\teatro\luci.granvelo"));
        // A relative base cannot resolve anything.
        assert_eq!(resolve_relative("S.tcue", "x"), None);
    }

    #[test]
    fn relative_paths_use_slashes() {
        let show = r"C:\Spettacoli\La locandiera\Serata.tcue";
        assert_eq!(relative_to(show, r"C:\Spettacoli\La locandiera\Luci.granvelo").as_deref(), Some("Luci.granvelo"));
        assert_eq!(relative_to(show, r"c:\spettacoli\la locandiera\audio\S.diaframma").as_deref(), Some("audio/S.diaframma"));
        assert_eq!(relative_to(show, r"C:\Spettacoli\Comune\x.granvelo").as_deref(), Some("../Comune/x.granvelo"));
        assert_eq!(relative_to("/home/a/show/S.tcue", "/home/b/x.diaframma").as_deref(), Some("../../b/x.diaframma"));
        // POSIX names are case-sensitive.
        assert_eq!(relative_to("/home/A/S.tcue", "/home/a/x").as_deref(), Some("../a/x"));
    }

    #[test]
    fn other_drives_have_no_relative_path() {
        assert_eq!(relative_to(r"C:\a\S.tcue", r"D:\a\x.granvelo"), None);
        assert_eq!(relative_to(r"C:\a\S.tcue", r"\\nas\share\x"), None);
        assert_eq!(relative_to(r"C:\a\S.tcue", "x"), None);
    }

    #[test]
    fn round_trip() {
        let show = r"E:\Tournée\Serata.tcue";
        for target in [r"E:\Tournée\Luci.granvelo", r"E:\Altro\Suoni.diaframma", r"E:\Tournée\a\b\c.mp4"] {
            let rel = relative_to(show, target).unwrap();
            assert_eq!(resolve_relative(show, &rel).as_deref(), Some(target));
        }
    }

    #[test]
    fn reads_text_and_fingerprints() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.diaframma");
        std::fs::write(&p, "abc").unwrap();
        let path = p.to_string_lossy().to_string();
        assert_eq!(files_read_text(path.clone()).unwrap(), "abc");
        assert_eq!(files_sha256(path).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let missing = dir.path().join("nope").to_string_lossy().to_string();
        assert!(files_read_text(missing.clone()).unwrap_err().starts_with("missing: "));
        assert!(files_sha256(missing).unwrap_err().starts_with("missing: "));
        std::fs::write(&p, [0xff, 0xfe, 0x00]).unwrap();
        assert!(files_read_text(p.to_string_lossy().to_string()).unwrap_err().starts_with("not-text: "));
    }
}
