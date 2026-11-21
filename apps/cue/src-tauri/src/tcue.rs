//! The `.tcue` file (format 1): a zip with `show.json` and the parts of the show
//! (the script PDF, thumbnails, projection images). See `docs/cue/FORMAT.md`.
//!
//! Rules:
//! - Saving is atomic: everything is written to `<file>.tmp` next to the file, flushed to disk
//!   and renamed over the old file only when complete. If anything fails the old file is untouched.
//! - Entries that do not change are copied raw (`raw_copy_file`): never decompressed or recompressed,
//!   so a 40 MB script costs a copy, not a recompression, and stays byte-identical.
//! - `show.json` is stored deflated; PDFs and images are stored without compression (they are
//!   already compressed).
//! - The native side does not interpret `show.json` beyond `format` / `formatVersion`: unknown fields
//!   travel untouched (the TypeScript model keeps them too).
//!
//! This module has no Tauri dependency, so it is tested with plain `cargo test`.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const FORMAT: &str = "theatre.cue";
pub const FORMAT_VERSION: u64 = 1;
pub const SHOW_JSON: &str = "show.json";
pub const EXT: &str = "tcue";

/// `show.json` of a whole show stays far below this.
const MAX_SHOW_JSON: u64 = 32 * 1024 * 1024;
/// Largest part read into memory at once (a script PDF, an image).
const MAX_PART: u64 = 1024 * 1024 * 1024;
/// A show has a script, some thumbnails and images: far fewer entries than this.
const MAX_ENTRIES: usize = 50_000;

/// What can go wrong with a `.tcue` file. The interface turns the code into a sentence in the
/// user's language; the detail is for the developers.
#[derive(Debug, Clone, PartialEq)]
pub enum TcueError {
    /// Reading or writing the disk failed.
    Io(String),
    /// The file is not a zip at all.
    NotZip,
    /// A zip, or a JSON, that is not a Cue show (no `show.json`, other `format`).
    NotCue,
    /// Saved by a newer Cue (`formatVersion` higher than this build reads).
    Newer(u64),
    /// A Cue file that cannot be read (broken JSON, broken zip entries).
    Damaged(String),
    /// A part name that is not allowed (absolute path, `..`, `show.json` itself…).
    BadPartName(String),
    /// The part asked for is not in the file.
    NoSuchPart(String),
}

impl TcueError {
    pub fn code(&self) -> &'static str {
        match self {
            TcueError::Io(_) => "io",
            TcueError::NotZip => "not-zip",
            TcueError::NotCue => "not-cue",
            TcueError::Newer(_) => "newer",
            TcueError::Damaged(_) => "damaged",
            TcueError::BadPartName(_) => "bad-part",
            TcueError::NoSuchPart(_) => "no-part",
        }
    }
}

impl fmt::Display for TcueError {
    /// `code: detail` — the interface reads the code before the first colon.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = match self {
            TcueError::Io(e) => e.clone(),
            TcueError::NotZip => "The file is not a zip archive.".into(),
            TcueError::NotCue => "This is not a Cue show (theatre.cue).".into(),
            TcueError::Newer(v) => format!("Format version {v} is newer than this Cue reads ({FORMAT_VERSION})."),
            TcueError::Damaged(e) => e.clone(),
            TcueError::BadPartName(n) => format!("Part name not allowed: {n}"),
            TcueError::NoSuchPart(n) => format!("The file has no part {n}"),
        };
        write!(f, "{}: {}", self.code(), detail)
    }
}

impl From<TcueError> for String {
    fn from(e: TcueError) -> String {
        e.to_string()
    }
}

fn io_err(what: &str, path: &Path, e: impl fmt::Display) -> TcueError {
    TcueError::Io(format!("{what} {}: {e}", path.display()))
}

fn zip_err(e: zip::result::ZipError) -> TcueError {
    TcueError::Damaged(format!("Broken zip entry: {e}"))
}

/// One part of the file (every entry except `show.json`).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PartInfo {
    pub name: String,
    /// Uncompressed size in bytes.
    pub size: u64,
}

/// What `open` returns: the text of `show.json`, the parts, the SHA-256 of the whole file.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub show_json: String,
    pub parts: Vec<PartInfo>,
    pub sha256: String,
}

/// After a save: the new parts and fingerprint (show.json is what the caller sent).
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub parts: Vec<PartInfo>,
    pub sha256: String,
}

/// A part to add or replace. Exactly one source: `data` (base64) or `fromPath` (a file on disk,
/// copied without passing through the interface — how a big PDF gets in).
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddPart {
    pub name: String,
    #[serde(default)]
    pub data: Option<String>,
    #[serde(default)]
    pub from_path: Option<String>,
}

pub fn has_ext(p: &Path) -> bool {
    p.extension().map(|e| e.to_string_lossy().eq_ignore_ascii_case(EXT)).unwrap_or(false)
}

/// Checks `show.json`: a JSON object with `format: "theatre.cue"` and `formatVersion` 1. Everything
/// else is optional (the launcher creates `{format, formatVersion, id, title}` and that must open).
pub fn validate_show_json(text: &str) -> Result<serde_json::Map<String, serde_json::Value>, TcueError> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| TcueError::Damaged(format!("show.json is not valid JSON: {e}")))?;
    let serde_json::Value::Object(obj) = v else { return Err(TcueError::NotCue) };
    if obj.get("format").and_then(|f| f.as_str()) != Some(FORMAT) {
        return Err(TcueError::NotCue);
    }
    match obj.get("formatVersion").and_then(|f| f.as_u64()) {
        Some(FORMAT_VERSION) => Ok(obj),
        Some(v) if v > FORMAT_VERSION => Err(TcueError::Newer(v)),
        _ => Err(TcueError::NotCue),
    }
}

/// Part names: relative, forward slashes, letters/digits/`._-` only, no `..`, not `show.json`.
pub fn check_part_name(name: &str) -> Result<(), TcueError> {
    let bad = || TcueError::BadPartName(name.to_string());
    if name.is_empty() || name.len() > 200 || name == SHOW_JSON || name.starts_with('/') || name.ends_with('/') {
        return Err(bad());
    }
    for seg in name.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            return Err(bad());
        }
        if !seg.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) {
            return Err(bad());
        }
    }
    Ok(())
}

/// Already compressed content is stored as it is; text is deflated.
fn options_for(name: &str, size: u64) -> SimpleFileOptions {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let stored = matches!(ext.as_str(), "pdf" | "jpg" | "jpeg" | "png" | "webp" | "gif" | "mp4" | "m4v" | "mov" | "zip" | "pptx");
    SimpleFileOptions::default()
        .compression_method(if stored { CompressionMethod::Stored } else { CompressionMethod::Deflated })
        .unix_permissions(0o644)
        .large_file(size >= u32::MAX as u64)
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn sha256_file(path: &Path) -> Result<String, TcueError> {
    let mut f = File::open(path).map_err(|e| io_err("Cannot open", path, e))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| io_err("Cannot read", path, e))?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

type Archive = ZipArchive<BufReader<File>>;

fn open_archive(path: &Path) -> Result<Archive, TcueError> {
    let f = File::open(path).map_err(|e| io_err("Cannot open", path, e))?;
    let zip = ZipArchive::new(BufReader::new(f)).map_err(|_| TcueError::NotZip)?;
    if zip.len() > MAX_ENTRIES {
        return Err(TcueError::Damaged(format!("Too many entries ({})", zip.len())));
    }
    Ok(zip)
}

fn read_show_json_from(zip: &mut Archive) -> Result<String, TcueError> {
    let entry = match zip.by_name(SHOW_JSON) {
        Ok(e) => e,
        Err(zip::result::ZipError::FileNotFound) => return Err(TcueError::NotCue),
        Err(e) => return Err(zip_err(e)),
    };
    if entry.size() > MAX_SHOW_JSON {
        return Err(TcueError::Damaged("show.json is too large".into()));
    }
    let mut text = String::new();
    entry
        .take(MAX_SHOW_JSON + 1)
        .read_to_string(&mut text)
        .map_err(|e| TcueError::Damaged(format!("Cannot read show.json: {e}")))?;
    Ok(text)
}

/// Name of an entry as written in the zip (names Cue writes are plain ASCII).
fn entry_name<R: Read>(f: &zip::read::ZipFile<'_, R>) -> String {
    String::from_utf8_lossy(f.name_raw()).into_owned()
}

fn parts_of(zip: &mut Archive) -> Result<Vec<PartInfo>, TcueError> {
    let mut parts = Vec::new();
    for i in 0..zip.len() {
        let f = zip.by_index_raw(i).map_err(zip_err)?;
        let name = entry_name(&f);
        if f.is_dir() || name == SHOW_JSON {
            continue;
        }
        parts.push(PartInfo { name, size: f.size() });
    }
    Ok(parts)
}

/// Opens a `.tcue`: checks the format and returns `show.json`, the parts and the fingerprint.
pub fn open(path: &Path) -> Result<Opened, TcueError> {
    let mut zip = open_archive(path)?;
    let show_json = read_show_json_from(&mut zip)?;
    validate_show_json(&show_json)?;
    let parts = parts_of(&mut zip)?;
    drop(zip);
    Ok(Opened { show_json, parts, sha256: sha256_file(path)? })
}

/// Only `show.json`, checked (versions list, restore).
pub fn read_show_json(path: &Path) -> Result<String, TcueError> {
    let mut zip = open_archive(path)?;
    let text = read_show_json_from(&mut zip)?;
    validate_show_json(&text)?;
    Ok(text)
}

/// The bytes of one part.
pub fn read_part(path: &Path, name: &str) -> Result<Vec<u8>, TcueError> {
    check_part_name(name)?;
    let mut zip = open_archive(path)?;
    let entry = match zip.by_name(name) {
        Ok(e) => e,
        Err(zip::result::ZipError::FileNotFound) => return Err(TcueError::NoSuchPart(name.to_string())),
        Err(e) => return Err(zip_err(e)),
    };
    if entry.size() > MAX_PART {
        return Err(TcueError::Damaged(format!("{name} is too large to read at once")));
    }
    // The size in the zip header is only a hint: never trusted for the allocation.
    let mut out = Vec::with_capacity(entry.size().min(64 * 1024 * 1024) as usize);
    entry.take(MAX_PART + 1).read_to_end(&mut out).map_err(|e| TcueError::Damaged(format!("Cannot read {name}: {e}")))?;
    Ok(out)
}

/// A temporary file next to `target`, with a name no other save uses (process id + counter), so two
/// saves at once (a key held down, two `--instance` processes) never write into the same file.
pub fn tmp_path(target: &Path) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut name = target.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(format!(".{}-{n}.tmp", std::process::id()));
    target.with_file_name(name)
}

/// One lock per target path: saves of the same file inside this process take turns.
pub fn path_lock(target: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    let key = std::path::absolute(target).unwrap_or_else(|_| target.to_path_buf());
    let mut map = LOCKS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap_or_else(|e| e.into_inner());
    map.entry(key).or_default().clone()
}

/// `fs::rename`, retried a few times when Windows says "access denied" (an antivirus or the search
/// indexer may hold the old file for a moment).
pub fn rename_retry(from: &Path, to: &Path) -> io::Result<()> {
    let mut tries = 0;
    loop {
        match fs::rename(from, to) {
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied && tries < 5 => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(60 + 10 * tries));
            }
            other => return other,
        }
    }
}

/// Random 128-bit identifier as 32 hex digits (same shape as the launcher's ids).
pub fn new_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mut out = String::with_capacity(32);
    for salt in 0u8..2 {
        let mut h = RandomState::new().build_hasher();
        h.write_u128(nanos);
        h.write_u8(salt);
        h.write_u32(std::process::id());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

/// The smallest valid show: exactly what the launcher creates.
pub fn minimal_show_json(id: &str, title: &str) -> String {
    let v = serde_json::json!({ "format": FORMAT, "formatVersion": FORMAT_VERSION, "id": id, "title": title });
    serde_json::to_string_pretty(&v).unwrap_or_default()
}

/// Creates a new show file at `path` (refuses to overwrite an existing file).
pub fn new_file(path: &Path, title: &str) -> Result<Opened, TcueError> {
    if path.exists() {
        return Err(TcueError::Io(format!("{} already exists", path.display())));
    }
    let json = minimal_show_json(&new_id(), title.trim());
    save(path, None, Some(&json), &[], &[])?;
    open(path)
}

/// Saves the show.
/// - `target`: the file to write (created or replaced atomically).
/// - `source`: the file unchanged parts come from (usually `target` itself; the old file for Save as;
///   `None` for a brand-new show, so an existing file chosen as target is replaced, never mixed in).
/// - `show_json`: new `show.json` (checked); `None` keeps the source's one byte for byte.
/// - `add`: parts to add or replace; `remove`: parts to drop.
pub fn save(target: &Path, source: Option<&Path>, show_json: Option<&str>, add: &[AddPart], remove: &[String]) -> Result<Saved, TcueError> {
    if let Some(text) = show_json {
        validate_show_json(text)?;
    }
    let mut added: HashSet<&str> = HashSet::new();
    for a in add {
        check_part_name(&a.name)?;
        if !added.insert(a.name.as_str()) {
            return Err(TcueError::BadPartName(format!("{} (twice)", a.name)));
        }
        if a.data.is_some() == a.from_path.is_some() {
            return Err(TcueError::BadPartName(format!("{} (needs data or fromPath)", a.name)));
        }
    }
    let removed: HashSet<&str> = remove.iter().map(|s| s.as_str()).collect();
    let src: Option<PathBuf> = source.map(|s| s.to_path_buf());
    if show_json.is_none() && src.is_none() {
        return Err(TcueError::Damaged("Nothing to save: no show.json".into()));
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| io_err("Cannot create the folder", parent, e))?;
        }
    }
    let lock = path_lock(target);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = tmp_path(target);
    let written = write_zip(&tmp, src.as_deref(), show_json, add, &added, &removed);
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    if let Err(e) = rename_retry(&tmp, target) {
        let _ = fs::remove_file(&tmp);
        return Err(io_err("Cannot save", target, e));
    }
    #[cfg(unix)]
    if let Some(parent) = target.parent() {
        // Makes the rename itself durable (best effort).
        if let Ok(d) = File::open(if parent.as_os_str().is_empty() { Path::new(".") } else { parent }) {
            let _ = d.sync_all();
        }
    }
    let mut zip = open_archive(target)?;
    let parts = parts_of(&mut zip)?;
    drop(zip);
    Ok(Saved { parts, sha256: sha256_file(target)? })
}

fn write_zip(tmp: &Path, src: Option<&Path>, show_json: Option<&str>, add: &[AddPart], added: &HashSet<&str>, removed: &HashSet<&str>) -> Result<(), TcueError> {
    let file = File::create(tmp).map_err(|e| io_err("Cannot write", tmp, e))?;
    let mut zw = ZipWriter::new(BufWriter::new(file));
    let w = |e: io::Error| io_err("Cannot write", tmp, e);
    // The archive of the old file is closed at the end of this function, before the rename
    // (Windows cannot replace a file that is still open).
    let mut source = match src {
        Some(p) => Some(open_archive(p)?),
        None => None,
    };
    // show.json first: a reader finds it at once.
    match show_json {
        Some(text) => {
            zw.start_file(SHOW_JSON, options_for(SHOW_JSON, text.len() as u64)).map_err(zip_err)?;
            zw.write_all(text.as_bytes()).map_err(w)?;
        }
        None => {
            let zip = source.as_mut().ok_or(TcueError::NotCue)?;
            let entry = match zip.by_name_raw(SHOW_JSON.as_bytes()) {
                Ok(e) => e,
                Err(zip::result::ZipError::FileNotFound) => return Err(TcueError::NotCue),
                Err(e) => return Err(zip_err(e)),
            };
            zw.raw_copy_file(entry).map_err(zip_err)?;
        }
    }
    if let Some(zip) = source.as_mut() {
        for i in 0..zip.len() {
            let entry = zip.by_index_raw(i).map_err(zip_err)?;
            let name = entry_name(&entry);
            if name == SHOW_JSON || removed.contains(name.as_str()) || added.contains(name.as_str()) {
                continue;
            }
            zw.raw_copy_file(entry).map_err(zip_err)?;
        }
    }
    for a in add {
        if let Some(data) = &a.data {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(data.as_bytes())
                .map_err(|e| TcueError::BadPartName(format!("{} (data is not base64: {e})", a.name)))?;
            zw.start_file(a.name.as_str(), options_for(&a.name, bytes.len() as u64)).map_err(zip_err)?;
            zw.write_all(&bytes).map_err(w)?;
        } else if let Some(p) = &a.from_path {
            let p = Path::new(p);
            let mut f = File::open(p).map_err(|e| io_err("Cannot read", p, e))?;
            let size = f.metadata().map(|m| m.len()).unwrap_or(0);
            zw.start_file(a.name.as_str(), options_for(&a.name, size)).map_err(zip_err)?;
            io::copy(&mut f, &mut zw).map_err(|e| io_err("Cannot copy", p, e))?;
        }
    }
    let buf = zw.finish().map_err(zip_err)?;
    let file = buf.into_inner().map_err(|e| w(e.into_error()))?;
    file.sync_all().map_err(w)?;
    Ok(())
}

// ---------------- Pending parts and export ----------------
//
// A part added to the show (a new script PDF) is not in the `.tcue` until the next save. So that it
// survives a crash, it is first copied ("staged") into Cue's autosave folder; the autosave lists it
// and recovery takes it back. The save then copies the staged file into the zip (`fromPath`).

/// A part copied into the staging folder, waiting for the next save.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Staged {
    /// Where the copy is (inside the staging folder).
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

/// Copies `from` into `dir` under a new unique name ending with the part name, atomically
/// (temporary file, flush, rename), computing its SHA-256 on the way.
pub fn stage_copy(from: &Path, dir: &Path, part_name: &str) -> Result<Staged, TcueError> {
    check_part_name(part_name)?;
    let meta = fs::metadata(from).map_err(|e| io_err("Cannot open", from, e))?;
    if !meta.is_file() {
        return Err(TcueError::Io(format!("{} is not a file", from.display())));
    }
    if meta.len() > MAX_PART {
        return Err(TcueError::Io(format!("{} is too large", from.display())));
    }
    fs::create_dir_all(dir).map_err(|e| io_err("Cannot create the folder", dir, e))?;
    let flat = part_name.replace('/', "_");
    let target = dir.join(format!("{}-{flat}", &new_id()[..16]));
    let tmp = tmp_path(&target);
    let result = (|| -> Result<Staged, TcueError> {
        let mut src = File::open(from).map_err(|e| io_err("Cannot open", from, e))?;
        let mut out = BufWriter::new(File::create(&tmp).map_err(|e| io_err("Cannot write", &tmp, e))?);
        let mut h = Sha256::new();
        let mut buf = vec![0u8; 256 * 1024];
        let mut size = 0u64;
        loop {
            let n = src.read(&mut buf).map_err(|e| io_err("Cannot read", from, e))?;
            if n == 0 {
                break;
            }
            h.update(&buf[..n]);
            out.write_all(&buf[..n]).map_err(|e| io_err("Cannot write", &tmp, e))?;
            size += n as u64;
        }
        let f = out.into_inner().map_err(|e| io_err("Cannot write", &tmp, e.into_error()))?;
        f.sync_all().map_err(|e| io_err("Cannot write", &tmp, e))?;
        drop(f);
        rename_retry(&tmp, &target).map_err(|e| io_err("Cannot save", &target, e))?;
        Ok(Staged { path: target.to_string_lossy().to_string(), sha256: hex(&h.finalize()), size })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Is `path` a file directly inside the staging folder `dir`? (Only those can be read or removed.)
pub fn is_staged(dir: &Path, path: &Path) -> bool {
    let (Ok(d), Ok(p)) = (dir.canonicalize(), path.canonicalize()) else { return false };
    p.parent() == Some(d.as_path()) && p.is_file()
}

/// Writes `reader` to `dest` atomically (temporary file next to it, flush, rename).
fn write_atomically(dest: &Path, reader: &mut dyn Read) -> Result<(), TcueError> {
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| io_err("Cannot create the folder", parent, e))?;
        }
    }
    let lock = path_lock(dest);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = tmp_path(dest);
    let result = (|| -> Result<(), TcueError> {
        let mut out = BufWriter::new(File::create(&tmp).map_err(|e| io_err("Cannot write", &tmp, e))?);
        io::copy(reader, &mut out).map_err(|e| io_err("Cannot write", &tmp, e))?;
        let f = out.into_inner().map_err(|e| io_err("Cannot write", &tmp, e.into_error()))?;
        f.sync_all().map_err(|e| io_err("Cannot write", &tmp, e))?;
        drop(f);
        rename_retry(&tmp, dest).map_err(|e| io_err("Cannot save", dest, e))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Copies one part of a `.tcue` to `dest` ("Esporta il PDF"), streaming, without loading it whole.
pub fn export_part(path: &Path, name: &str, dest: &Path) -> Result<(), TcueError> {
    check_part_name(name)?;
    let mut zip = open_archive(path)?;
    let mut entry = match zip.by_name(name) {
        Ok(e) => e,
        Err(zip::result::ZipError::FileNotFound) => return Err(TcueError::NoSuchPart(name.to_string())),
        Err(e) => return Err(zip_err(e)),
    };
    write_atomically(dest, &mut entry)
}

/// Copies a file (a staged part) to `dest`.
pub fn export_file(from: &Path, dest: &Path) -> Result<(), TcueError> {
    let mut f = File::open(from).map_err(|e| io_err("Cannot open", from, e))?;
    write_atomically(dest, &mut f)
}

// ---------------- Versions: copies of the file in `<Name>.versions/` ----------------

/// `Serata.tcue` → `Serata.versions` (next to it), as Diaframma and Granvelo do.
pub fn versions_dir_of(path: &Path) -> PathBuf {
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    path.with_file_name(format!("{stem}.versions"))
}

pub fn is_versions_dir(dir: &Path) -> bool {
    dir.file_name().map(|n| n.to_string_lossy().to_lowercase().ends_with(".versions")).unwrap_or(false)
}

/// One saved version.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub path: String,
    pub name: String,
    /// Last modification, milliseconds since 1970.
    pub modified_ms: u64,
    pub bytes: u64,
    /// "named" (made by the user) or "auto".
    pub kind: String,
    pub note: String,
    /// Cue version that saved it (`savedWith.version`), if known.
    pub app_version: String,
    /// The file could not be read (still listed, so it can be deleted).
    pub damaged: bool,
}

/// Copies the file into its versions folder as `version_name` (`2026-11-20_213000_auto.tcue`),
/// with `versionKind` and `versionNote` added to its `show.json`. Parts are copied raw.
pub fn save_version(path: &Path, version_name: &str, kind: &str, note: &str) -> Result<PathBuf, TcueError> {
    let ok_name = version_name.len() <= 120
        && version_name.to_ascii_lowercase().ends_with(".tcue")
        && version_name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !ok_name || !matches!(kind, "named" | "auto") {
        return Err(TcueError::BadPartName(version_name.to_string()));
    }
    let mut obj = validate_show_json(&read_show_json(path)?)?;
    obj.insert("versionKind".into(), serde_json::Value::String(kind.into()));
    obj.insert("versionNote".into(), serde_json::Value::String(note.chars().take(200).collect()));
    let text = serde_json::to_string_pretty(&serde_json::Value::Object(obj)).map_err(|e| TcueError::Damaged(e.to_string()))?;
    let dir = versions_dir_of(path);
    fs::create_dir_all(&dir).map_err(|e| io_err("Cannot create the folder", &dir, e))?;
    let stem = version_name[..version_name.len() - 5].to_string();
    let mut target = dir.join(version_name);
    let mut i = 2;
    while target.exists() {
        target = dir.join(format!("{stem}-{i}.tcue"));
        i += 1;
    }
    save(&target, Some(path), Some(&text), &[], &[])?;
    Ok(target)
}

/// The versions in `dir`, newest first. A missing folder is an empty list.
pub fn list_versions(dir: &Path) -> Vec<VersionEntry> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else { return out };
    for entry in rd.flatten() {
        let p = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() || !has_ext(&p) {
            continue;
        }
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let by_name = if name.to_lowercase().contains("_auto") { "auto" } else { "named" };
        let mut v = VersionEntry {
            path: p.to_string_lossy().to_string(),
            name,
            modified_ms,
            bytes: meta.len(),
            kind: by_name.into(),
            note: String::new(),
            app_version: String::new(),
            damaged: false,
        };
        match read_show_json(&p).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()) {
            Some(j) => {
                if let Some(k) = j.get("versionKind").and_then(|k| k.as_str()).filter(|k| matches!(*k, "named" | "auto")) {
                    v.kind = k.into();
                }
                v.note = j.get("versionNote").and_then(|n| n.as_str()).unwrap_or("").to_string();
                v.app_version = j.pointer("/savedWith/version").and_then(|n| n.as_str()).unwrap_or("").to_string();
            }
            None => v.damaged = true,
        }
        out.push(v);
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| b.name.cmp(&a.name)));
    out
}

/// Writes the version back over `path` (atomically), without its `versionKind` / `versionNote`.
/// The caller keeps the current state as an automatic version first.
pub fn restore_version(path: &Path, version: &Path) -> Result<Saved, TcueError> {
    if !version.parent().map(is_versions_dir).unwrap_or(false) || !has_ext(version) {
        return Err(TcueError::Io("Only saved versions can be restored.".into()));
    }
    let mut obj = validate_show_json(&read_show_json(version)?)?;
    obj.remove("versionKind");
    obj.remove("versionNote");
    let text = serde_json::to_string_pretty(&serde_json::Value::Object(obj)).map_err(|e| TcueError::Damaged(e.to_string()))?;
    save(path, Some(version), Some(&text), &[], &[])
}

/// Deletes one version: only `.tcue` files inside a `*.versions` folder.
pub fn delete_version(path: &Path) -> Result<(), TcueError> {
    if !path.parent().map(is_versions_dir).unwrap_or(false) || !has_ext(path) {
        return Err(TcueError::Io("Only saved versions can be deleted.".into()));
    }
    if path.is_file() {
        fs::remove_file(path).map_err(|e| io_err("Cannot delete", path, e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    fn part(name: &str, bytes: &[u8]) -> AddPart {
        AddPart { name: name.into(), data: Some(b64(bytes)), from_path: None }
    }

    /// A fake PDF of ~200 KB with some repetition (so deflate would change it if it were used).
    fn fake_pdf() -> Vec<u8> {
        let mut v = b"%PDF-1.7\n".to_vec();
        for i in 0..20_000u32 {
            v.extend_from_slice(format!("{} 0 obj << /Page {} >> endobj\n", i, i % 97).as_bytes());
        }
        v.extend_from_slice(b"%%EOF\n");
        v
    }

    /// Compressed bytes of an entry, exactly as stored in the zip.
    fn raw_entry(path: &Path, name: &str) -> (Vec<u8>, u32, CompressionMethod) {
        let mut zip = open_archive(path).unwrap();
        let mut e = zip.by_name_raw(name.as_bytes()).unwrap();
        let crc = e.crc32();
        let method = e.compression();
        let mut out = Vec::new();
        e.read_to_end(&mut out).unwrap();
        (out, crc, method)
    }

    /// Temporary files left in a folder (there must be none after a save, failed or not).
    fn leftovers(dir: &Path) -> Vec<String> {
        fs::read_dir(dir).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.ends_with(".tmp")).collect()
    }

    fn show(extra: &str) -> String {
        format!(r#"{{"format":"theatre.cue","formatVersion":1,"id":"abc","title":"La locandiera"{extra}}}"#)
    }

    #[test]
    fn new_file_is_the_minimal_show_and_opens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Serata.tcue");
        let o = new_file(&path, "  La locandiera ").unwrap();
        let v: serde_json::Value = serde_json::from_str(&o.show_json).unwrap();
        assert_eq!(v["format"], "theatre.cue");
        assert_eq!(v["formatVersion"], 1);
        assert_eq!(v["title"], "La locandiera");
        assert_eq!(v["id"].as_str().unwrap().len(), 32);
        assert!(o.parts.is_empty());
        assert_eq!(o.sha256.len(), 64);
        assert!(new_file(&path, "again").is_err(), "never overwrites");
        // show.json is deflated.
        assert_eq!(raw_entry(&path, SHOW_JSON).2, CompressionMethod::Deflated);
    }

    #[test]
    fn opens_exactly_what_the_launcher_creates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Serata.tcue");
        let launcher = r#"{"format":"theatre.cue","formatVersion":1,"id":"0f3c","title":"Amleto"}"#;
        save(&path, None, Some(launcher), &[], &[]).unwrap();
        let o = open(&path).unwrap();
        assert_eq!(o.show_json, launcher);
    }

    #[test]
    fn round_trip_with_parts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Serata.tcue");
        let pdf = fake_pdf();
        let jpg = vec![0xFFu8, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4];
        let saved = save(&path, None, Some(&show("")), &[part("script.pdf", &pdf), part("thumbs/g1.jpg", &jpg)], &[]).unwrap();
        assert_eq!(saved.parts.len(), 2);
        let o = open(&path).unwrap();
        assert_eq!(o.show_json, show(""));
        assert_eq!(o.sha256, saved.sha256);
        assert_eq!(o.parts, vec![PartInfo { name: "script.pdf".into(), size: pdf.len() as u64 }, PartInfo { name: "thumbs/g1.jpg".into(), size: 8 }]);
        assert_eq!(read_part(&path, "script.pdf").unwrap(), pdf);
        assert_eq!(read_part(&path, "thumbs/g1.jpg").unwrap(), jpg);
        // PDFs and images are stored, not compressed.
        assert_eq!(raw_entry(&path, "script.pdf").2, CompressionMethod::Stored);
        assert_eq!(raw_entry(&path, "thumbs/g1.jpg").2, CompressionMethod::Stored);
        assert!(matches!(read_part(&path, "missing.pdf"), Err(TcueError::NoSuchPart(_))));
        // Remove one part, replace the other.
        save(&path, Some(&path), Some(&show("")), &[part("thumbs/g1.jpg", b"new")], &["script.pdf".into()]).unwrap();
        let o = open(&path).unwrap();
        assert_eq!(o.parts, vec![PartInfo { name: "thumbs/g1.jpg".into(), size: 3 }]);
        assert!(leftovers(dir.path()).is_empty());
    }

    #[test]
    fn a_new_show_over_an_existing_file_replaces_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Serata.tcue");
        save(&path, None, Some(&show("")), &[part("script.pdf", &fake_pdf())], &[]).unwrap();
        save(&path, None, Some(&show("")), &[], &[]).unwrap();
        assert!(open(&path).unwrap().parts.is_empty());
    }

    #[test]
    fn part_from_a_file_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let pdf_path = dir.path().join("copione.pdf");
        fs::write(&pdf_path, fake_pdf()).unwrap();
        let path = dir.path().join("Serata.tcue");
        let add = AddPart { name: "script.pdf".into(), data: None, from_path: Some(pdf_path.to_string_lossy().to_string()) };
        save(&path, None, Some(&show("")), &[add], &[]).unwrap();
        assert_eq!(read_part(&path, "script.pdf").unwrap(), fake_pdf());
    }

    #[test]
    fn unknown_fields_are_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Serata.tcue");
        let text = show(r#","futureThing":{"a":[1,2,{"b":null}]},"gos":[{"id":"g1","fromTheFuture":true}]"#);
        save(&path, None, Some(&text), &[], &[]).unwrap();
        // Saving without a new show.json keeps it byte for byte.
        save(&path, Some(&path), None, &[part("notes.txt", b"hello")], &[]).unwrap();
        let o = open(&path).unwrap();
        assert_eq!(o.show_json, text);
        let v: serde_json::Value = serde_json::from_str(&o.show_json).unwrap();
        assert_eq!(v["futureThing"]["a"][2]["b"], serde_json::Value::Null);
        assert_eq!(v["gos"][0]["fromTheFuture"], true);
    }

    #[test]
    fn unchanged_parts_are_copied_raw_and_stay_byte_identical() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Serata.tcue");
        let pdf = fake_pdf();
        save(&path, None, Some(&show("")), &[part("script.pdf", &pdf), part("notes.txt", &pdf[..5000])], &[]).unwrap();
        let before_pdf = raw_entry(&path, "script.pdf");
        let before_txt = raw_entry(&path, "notes.txt");
        assert_eq!(before_txt.2, CompressionMethod::Deflated);
        // Change only show.json, twice, and a Save as to another file.
        save(&path, Some(&path), Some(&show(r#","notes":[]"#)), &[], &[]).unwrap();
        save(&path, Some(&path), Some(&show(r#","notes":[{"id":"n1"}]"#)), &[], &[]).unwrap();
        let other = dir.path().join("Copia.tcue");
        save(&other, Some(&path), Some(&show("")), &[], &[]).unwrap();
        for p in [&path, &other] {
            assert_eq!(raw_entry(p, "script.pdf"), before_pdf);
            assert_eq!(raw_entry(p, "notes.txt"), before_txt);
            assert_eq!(read_part(p, "script.pdf").unwrap(), pdf);
        }
        // The raw PDF bytes are the PDF itself (stored).
        assert_eq!(before_pdf.0, pdf);
    }

    #[test]
    fn a_failed_save_leaves_the_old_file_intact() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Serata.tcue");
        save(&path, None, Some(&show("")), &[part("script.pdf", &fake_pdf())], &[]).unwrap();
        let old = fs::read(&path).unwrap();
        // Fails half way: the second part comes from a file that does not exist.
        let missing = AddPart { name: "images/a.png".into(), data: None, from_path: Some(dir.path().join("nope.png").to_string_lossy().to_string()) };
        let err = save(&path, Some(&path), Some(&show(r#","notes":[]"#)), &[part("thumbs/x.jpg", b"123"), missing], &[]).unwrap_err();
        assert_eq!(err.code(), "io");
        assert_eq!(fs::read(&path).unwrap(), old);
        assert!(leftovers(dir.path()).is_empty());
        // Fails before writing: the file the parts come from is not there.
        assert!(save(&path, Some(&dir.path().join("gone.tcue")), Some(&show("")), &[], &[]).is_err());
        assert_eq!(fs::read(&path).unwrap(), old);
        assert!(leftovers(dir.path()).is_empty());
        // A wrong show.json is refused before touching anything.
        assert_eq!(save(&path, Some(&path), Some(r#"{"format":"theatre.granvelo"}"#), &[], &[]).unwrap_err(), TcueError::NotCue);
        assert_eq!(fs::read(&path).unwrap(), old);
    }

    #[test]
    fn rejects_other_formats() {
        let dir = tempfile::tempdir().unwrap();
        // Not a zip.
        let txt = dir.path().join("a.tcue");
        fs::write(&txt, r#"{"format":"theatre.cue","formatVersion":1}"#).unwrap();
        assert_eq!(open(&txt).unwrap_err(), TcueError::NotZip);
        // A zip without show.json.
        let nojson = dir.path().join("b.tcue");
        {
            let mut zw = ZipWriter::new(File::create(&nojson).unwrap());
            zw.start_file("other.txt", SimpleFileOptions::default()).unwrap();
            zw.write_all(b"x").unwrap();
            zw.finish().unwrap();
        }
        assert_eq!(open(&nojson).unwrap_err(), TcueError::NotCue);
        // Other formats, versions, broken JSON.
        let write = |name: &str, json: &str| {
            let p = dir.path().join(name);
            let mut zw = ZipWriter::new(File::create(&p).unwrap());
            zw.start_file(SHOW_JSON, SimpleFileOptions::default()).unwrap();
            zw.write_all(json.as_bytes()).unwrap();
            zw.finish().unwrap();
            p
        };
        assert_eq!(open(&write("c.tcue", r#"{"format":"theatre.granvelo","formatVersion":1}"#)).unwrap_err(), TcueError::NotCue);
        assert_eq!(open(&write("d.tcue", r#"{"format":"theatre.cue"}"#)).unwrap_err(), TcueError::NotCue);
        assert_eq!(open(&write("e.tcue", r#"{"format":"theatre.cue","formatVersion":2}"#)).unwrap_err(), TcueError::Newer(2));
        assert_eq!(open(&write("f.tcue", "[1,2]")).unwrap_err(), TcueError::NotCue);
        assert_eq!(open(&write("g.tcue", "{broken")).unwrap_err().code(), "damaged");
        // The interface reads the code before the colon.
        assert!(TcueError::NotCue.to_string().starts_with("not-cue: "));
    }

    #[test]
    fn part_names_are_checked() {
        for ok in ["script.pdf", "thumbs/g-1.jpg", "images/a_b.png"] {
            assert!(check_part_name(ok).is_ok(), "{ok}");
        }
        for bad in ["", "show.json", "/abs.pdf", "../x.pdf", "a/../b", "a//b", "C:\\x.pdf", "a b.pdf", "dir/", "à.pdf"] {
            assert!(check_part_name(bad).is_err(), "{bad}");
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.tcue");
        assert_eq!(save(&path, None, Some(&show("")), &[part("../evil", b"x")], &[]).unwrap_err().code(), "bad-part");
        assert!(!path.exists());
    }

    #[test]
    fn versions_save_list_restore_delete() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Serata.tcue");
        let pdf = fake_pdf();
        save(&path, None, Some(&show(r#","savedWith":{"app":"Cue","version":"0.1.0"}"#)), &[part("script.pdf", &pdf)], &[]).unwrap();
        let v1 = save_version(&path, "2026-11-20_210000.tcue", "named", "Dopo la prova tecnica").unwrap();
        let v2 = save_version(&path, "2026-11-20_210000.tcue", "auto", "").unwrap();
        assert_eq!(v1.parent().unwrap(), dir.path().join("Serata.versions"));
        assert!(v2.file_name().unwrap().to_string_lossy().ends_with("-2.tcue"));
        assert_eq!(raw_entry(&v1, "script.pdf"), raw_entry(&path, "script.pdf"));
        let list = list_versions(&versions_dir_of(&path));
        assert_eq!(list.len(), 2);
        let named = list.iter().find(|v| v.kind == "named").unwrap();
        assert_eq!(named.note, "Dopo la prova tecnica");
        assert_eq!(named.app_version, "0.1.0");
        assert!(list.iter().any(|v| v.kind == "auto"));
        // Change the file, then go back to the named version.
        save(&path, Some(&path), Some(&show(r#","notes":[1]"#)), &[], &["script.pdf".into()]).unwrap();
        restore_version(&path, &v1).unwrap();
        let o = open(&path).unwrap();
        let j: serde_json::Value = serde_json::from_str(&o.show_json).unwrap();
        assert!(j.get("versionKind").is_none() && j.get("versionNote").is_none());
        assert!(j.get("notes").is_none());
        assert_eq!(read_part(&path, "script.pdf").unwrap(), pdf);
        // Delete is limited to versions.
        assert!(delete_version(&path).is_err());
        assert!(restore_version(&path, &path).is_err());
        delete_version(&v2).unwrap();
        assert!(!v2.exists());
        assert!(list_versions(&dir.path().join("none.versions")).is_empty());
        assert!(save_version(&path, "../x.tcue", "named", "").is_err());
    }

    #[test]
    fn staged_part_survives_and_goes_into_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let pdf_path = dir.path().join("copione.pdf");
        fs::write(&pdf_path, fake_pdf()).unwrap();
        let staging = dir.path().join("autosave").join("parts");
        let staged = stage_copy(&pdf_path, &staging, "script.pdf").unwrap();
        assert_eq!(staged.size, fake_pdf().len() as u64);
        assert_eq!(staged.sha256, sha256_file(&pdf_path).unwrap());
        assert!(staged.path.ends_with("-script.pdf"));
        assert!(is_staged(&staging, Path::new(&staged.path)));
        assert!(!is_staged(&staging, &pdf_path));
        // Two stagings of the same part never collide.
        let again = stage_copy(&pdf_path, &staging, "script.pdf").unwrap();
        assert_ne!(again.path, staged.path);
        // The original may go away: the staged copy is what the save uses.
        fs::remove_file(&pdf_path).unwrap();
        let path = dir.path().join("Serata.tcue");
        let add = AddPart { name: "script.pdf".into(), data: None, from_path: Some(staged.path.clone()) };
        save(&path, None, Some(&show("")), &[add], &[]).unwrap();
        assert_eq!(read_part(&path, "script.pdf").unwrap(), fake_pdf());
        assert!(stage_copy(&dir.path().join("missing.pdf"), &staging, "script.pdf").is_err());
        assert!(stage_copy(&path, &staging, "../x.pdf").is_err());
    }

    #[test]
    fn exports_a_part_and_a_staged_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Serata.tcue");
        save(&path, None, Some(&show("")), &[part("script.pdf", &fake_pdf())], &[]).unwrap();
        let dest = dir.path().join("out").join("Copione.pdf");
        export_part(&path, "script.pdf", &dest).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), fake_pdf());
        assert!(leftovers(dest.parent().unwrap()).is_empty());
        assert_eq!(export_part(&path, "thumbs/x.jpg", &dest).unwrap_err().code(), "no-part");
        let copy = dir.path().join("Copia.pdf");
        export_file(&dest, &copy).unwrap();
        assert_eq!(fs::read(&copy).unwrap(), fake_pdf());
    }

    #[test]
    fn temporary_names_are_unique() {
        let p = Path::new("/x/Serata.tcue");
        let (a, b) = (tmp_path(p), tmp_path(p));
        assert_ne!(a, b);
        assert_eq!(a.parent(), p.parent());
        assert!(a.to_string_lossy().ends_with(".tmp"));
    }

    #[test]
    fn concurrent_saves_of_one_file_never_mix() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Serata.tcue");
        save(&path, None, Some(&show("")), &[part("script.pdf", &fake_pdf())], &[]).unwrap();
        let threads: Vec<_> = (0..6)
            .map(|i| {
                let path = path.clone();
                std::thread::spawn(move || {
                    let big = vec![i as u8; 300_000 + i * 1000];
                    save(&path, Some(&path), Some(&show(&format!(r#","n":{i}"#))), &[part("images/a.png", &big)], &[]).unwrap();
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        // Whatever save came last, the file is whole: its show.json and its image belong together.
        let json = read_show_json(&path).unwrap();
        let n: usize = serde_json::from_str::<serde_json::Value>(&json).unwrap()["n"].as_u64().unwrap() as usize;
        assert_eq!(read_part(&path, "images/a.png").unwrap(), vec![n as u8; 300_000 + n * 1000]);
        assert_eq!(read_part(&path, "script.pdf").unwrap(), fake_pdf());
        assert!(leftovers(dir.path()).is_empty());
    }
}
