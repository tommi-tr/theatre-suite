//! Projections: the output window on a chosen screen, and the videos it plays.
//!
//! Images live inside the `.tcue` (the window asks for their bytes like the main window does); videos stay outside,
//! in the show folder. A video is served to the output window by the `cuevideo` protocol, which answers only for
//! files this module authorised: inside the folder of the show file, with a video extension (`scoped_video`).
//! The main window and the output window talk by Tauri events (`proj:state`, `proj:ready`, `proj:closed`).

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::http::{Response, StatusCode, header};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::files;

pub const LABEL: &str = "projection";
const VIDEO_EXTS: [&str; 5] = ["mp4", "m4v", "mov", "webm", "ogv"];
/// An open-ended range request is answered with at most this much; the player asks again for the rest.
const CHUNK: u64 = 4 * 1024 * 1024;

/// Videos the interface asked for: token (in the URL) → file. Only these are ever served.
#[derive(Default)]
pub struct Videos(Mutex<HashMap<String, PathBuf>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub scale: f64,
    pub primary: bool,
    /// The one the Cue window is on.
    pub current: bool,
}

#[tauri::command]
pub fn proj_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let list = app.available_monitors().map_err(|e| e.to_string())?;
    let primary = app.primary_monitor().ok().flatten().map(|m| (m.position().x, m.position().y));
    let current = app.get_webview_window("main").and_then(|w| w.current_monitor().ok().flatten()).map(|m| (m.position().x, m.position().y));
    Ok(list
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let pos = (m.position().x, m.position().y);
            MonitorInfo {
                index: i,
                name: m.name().cloned().unwrap_or_else(|| format!("Screen {}", i + 1)),
                width: m.size().width,
                height: m.size().height,
                x: pos.0,
                y: pos.1,
                scale: m.scale_factor(),
                primary: primary == Some(pos),
                current: current == Some(pos),
            }
        })
        .collect())
}

/// Opens the output window: borderless and fullscreen on monitor `monitor`, or (`windowed`) a normal 16:9 window
/// to try things on one screen. It never takes the keyboard from the Cue window. Already open = nothing to do.
#[tauri::command(async)]
pub fn proj_open(app: AppHandle, monitor: Option<usize>, windowed: bool) -> Result<(), String> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let mut b = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html?projection=1".into()))
        .title("Cue · Uscita")
        .visible(false)
        .focused(false)
        .skip_taskbar(!windowed)
        .decorations(windowed)
        .resizable(windowed)
        .shadow(false)
        .background_color(tauri::window::Color(0, 0, 0, 255))
        .inner_size(960.0, 540.0)
        .disable_drag_drop_handler();
    #[cfg(windows)]
    {
        b = b.additional_browser_args(crate::BROWSER_ARGS);
    }
    if crate::instance() >= 2 {
        if let Ok(base) = app.path().app_local_data_dir() {
            b = b.data_directory(crate::storage::instance_dir(&base, crate::instance()).join("webview"));
        }
    }
    let win = b.build().map_err(|e| e.to_string())?;
    if !windowed {
        let m = monitor.and_then(|i| monitors.get(i)).ok_or("no-monitor")?;
        win.set_position(PhysicalPosition::new(m.position().x, m.position().y)).map_err(|e| e.to_string())?;
        win.set_size(PhysicalSize::new(m.size().width, m.size().height)).map_err(|e| e.to_string())?;
        win.set_fullscreen(true).map_err(|e| e.to_string())?;
        let _ = win.set_cursor_visible(false);
    }
    win.show().map_err(|e| e.to_string())?;
    let handle = app.clone();
    win.on_window_event(move |ev| match ev {
        WindowEvent::Destroyed => {
            let _ = handle.emit("proj:closed", ());
        }
        // In the theatre the keyboard stays on Cue: a click on the output gives it back.
        WindowEvent::Focused(true) if !windowed => {
            if let Some(m) = handle.get_webview_window("main") {
                let _ = m.set_focus();
            }
        }
        _ => {}
    });
    Ok(())
}

#[tauri::command]
pub fn proj_close(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        w.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn proj_is_open(app: AppHandle) -> bool {
    app.get_webview_window(LABEL).is_some()
}

/// The absolute path of the video `rel` (relative to the show file `show_file`), if it is allowed: inside the
/// show folder, a video extension, no way out of the folder (`..`, links). The file must exist.
pub fn scoped_video(show_file: &str, rel: &str) -> Result<PathBuf, String> {
    let ext_ok = |p: &Path| p.extension().and_then(|e| e.to_str()).is_some_and(|e| VIDEO_EXTS.contains(&e.to_ascii_lowercase().as_str()));
    let abs = files::resolve_relative(show_file, rel).ok_or("outside: the show file has no folder")?;
    let abs = PathBuf::from(abs);
    if !ext_ok(&abs) {
        return Err("not-video: only MP4, M4V, MOV and WebM files are played".into());
    }
    let folder = Path::new(show_file).parent().ok_or("outside: the show file has no folder")?;
    let folder = folder.canonicalize().map_err(|_| format!("missing: {}", folder.display()))?;
    let real = abs.canonicalize().map_err(|_| format!("missing: {}", abs.display()))?;
    if !real.starts_with(&folder) {
        return Err(format!("outside: {} is not inside the show folder", abs.display()));
    }
    Ok(real)
}

fn token_of(p: &Path) -> String {
    Sha256::digest(p.to_string_lossy().as_bytes()).iter().take(12).map(|b| format!("{b:02x}")).collect()
}

/// Authorises a video of the show folder and returns the address the output window plays it from.
#[tauri::command]
pub fn proj_video_url(videos: tauri::State<Videos>, show_file: String, rel: String) -> Result<String, String> {
    let real = scoped_video(&show_file, &rel)?;
    let token = token_of(&real);
    videos.0.lock().map_err(|_| "io: busy")?.insert(token.clone(), real);
    Ok(video_url(&token))
}

pub fn video_url(token: &str) -> String {
    if cfg!(windows) { format!("http://cuevideo.localhost/{token}") } else { format!("cuevideo://localhost/{token}") }
}

/// A video chosen outside the show folder: copied into `<show folder>/video/` (never overwriting) so that it
/// travels with the show. Returns the path relative to the show file.
#[tauri::command(async)]
pub fn proj_copy_video(show_file: String, from: String) -> Result<String, String> {
    let src = PathBuf::from(&from);
    let name = src.file_name().and_then(|n| n.to_str()).ok_or("io: bad file name")?.to_string();
    let dir = Path::new(&show_file).parent().ok_or("io: the show file has no folder")?.join("video");
    std::fs::create_dir_all(&dir).map_err(|e| format!("io: {}: {e}", dir.display()))?;
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.clone(), String::new()),
    };
    let mut target = dir.join(&name);
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    std::fs::copy(&src, &target).map_err(|e| format!("io: {}: {e}", src.display()))?;
    Ok(format!("video/{}", target.file_name().and_then(|n| n.to_str()).unwrap_or_default()))
}

/// `Range: bytes=a-b` → (start, end inclusive) for a file of `len` bytes. Open end = up to a chunk.
pub fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    if len == 0 {
        return None;
    }
    let (start, end) = if a.is_empty() {
        let n: u64 = b.trim().parse().ok()?;
        (len.saturating_sub(n.min(len)), len - 1)
    } else {
        let start: u64 = a.trim().parse().ok()?;
        let end = if b.trim().is_empty() { (start + CHUNK - 1).min(len - 1) } else { b.trim().parse::<u64>().ok()?.min(len - 1) };
        (start, end)
    };
    (start <= end && start < len).then_some((start, end))
}

fn mime_of(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("webm") => "video/webm",
        Some("ogv") => "video/ogg",
        Some("mov") => "video/quicktime",
        _ => "video/mp4",
    }
}

fn answer(path: &Path, range: Option<&str>) -> Result<Response<Vec<u8>>, StatusCode> {
    let mut f = File::open(path).map_err(|_| StatusCode::NOT_FOUND)?;
    let len = f.metadata().map_err(|_| StatusCode::NOT_FOUND)?.len();
    let b = Response::builder().header(header::CONTENT_TYPE, mime_of(path)).header(header::ACCEPT_RANGES, "bytes").header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    let (status, start, end) = match range {
        Some(r) => match parse_range(r, len) {
            Some((s, e)) => (StatusCode::PARTIAL_CONTENT, s, e),
            None => return Err(StatusCode::RANGE_NOT_SATISFIABLE),
        },
        // No range: the player asks the first chunk and goes on with ranges.
        None => (StatusCode::PARTIAL_CONTENT, 0, CHUNK.min(len).saturating_sub(1)),
    };
    f.seek(SeekFrom::Start(start)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut buf = vec![0u8; (end + 1 - start) as usize];
    f.read_exact(&mut buf).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let b = if range.is_none() && len <= CHUNK { b.status(StatusCode::OK) } else { b.status(status).header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}")) };
    b.body(buf).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// The `cuevideo` protocol: `…/<token>` → the authorised file, with range support.
pub fn serve_video(app: &AppHandle, request: tauri::http::Request<Vec<u8>>) -> Response<Vec<u8>> {
    let fail = |s: StatusCode| Response::builder().status(s).body(Vec::new()).unwrap_or_default();
    let token = request.uri().path().trim_start_matches('/').to_string();
    let path = app.state::<Videos>().0.lock().ok().and_then(|m| m.get(&token).cloned());
    let Some(path) = path else { return fail(StatusCode::NOT_FOUND) };
    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
    answer(&path, range).unwrap_or_else(fail)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn show() -> (tempfile::TempDir, String) {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("video")).unwrap();
        fs::write(d.path().join("video/a.mp4"), b"0123456789").unwrap();
        fs::write(d.path().join("video/notes.txt"), b"x").unwrap();
        fs::write(d.path().join("Serata.tcue"), b"x").unwrap();
        let f = d.path().join("Serata.tcue").to_string_lossy().to_string();
        (d, f)
    }

    #[test]
    fn video_inside_the_show_folder_is_allowed() {
        let (d, f) = show();
        assert_eq!(scoped_video(&f, "video/a.mp4").unwrap(), d.path().join("video/a.mp4").canonicalize().unwrap());
        assert!(scoped_video(&f, "video/../video/a.mp4").is_ok());
    }

    #[test]
    fn video_outside_the_show_folder_is_refused() {
        let (d, f) = show();
        let other = tempfile::tempdir().unwrap();
        fs::write(other.path().join("b.mp4"), b"x").unwrap();
        // An absolute path to another folder, and `..` out of the folder.
        assert!(scoped_video(&f, &other.path().join("b.mp4").to_string_lossy()).unwrap_err().starts_with("outside"));
        let up = format!("../{}/b.mp4", other.path().file_name().unwrap().to_string_lossy());
        assert!(scoped_video(&f, &up).unwrap_err().starts_with("outside"));
        drop(d);
    }

    #[test]
    fn only_video_files_and_existing_ones() {
        let (_d, f) = show();
        assert!(scoped_video(&f, "video/notes.txt").unwrap_err().starts_with("not-video"));
        assert!(scoped_video(&f, "video/none.mp4").unwrap_err().starts_with("missing"));
        assert!(scoped_video(&f, "Serata.tcue").unwrap_err().starts_with("not-video"));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_folder_is_refused() {
        let (d, f) = show();
        let other = tempfile::tempdir().unwrap();
        fs::write(other.path().join("s.mp4"), b"x").unwrap();
        std::os::unix::fs::symlink(other.path().join("s.mp4"), d.path().join("video/link.mp4")).unwrap();
        assert!(scoped_video(&f, "video/link.mp4").unwrap_err().starts_with("outside"));
    }

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-3", 10), Some((0, 3)));
        assert_eq!(parse_range("bytes=4-", 10), Some((4, 9)));
        assert_eq!(parse_range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(parse_range("bytes=2-99", 10), Some((2, 9)));
        assert_eq!(parse_range("bytes=10-", 10), None);
        assert_eq!(parse_range("bytes=5-2", 10), None);
        assert_eq!(parse_range("items=0-1", 10), None);
    }

    #[test]
    fn answers_a_range_with_the_right_bytes() {
        let (d, _f) = show();
        let r = answer(&d.path().join("video/a.mp4"), Some("bytes=2-4")).unwrap();
        assert_eq!(r.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(r.body(), b"234");
        assert_eq!(r.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 2-4/10");
        let all = answer(&d.path().join("video/a.mp4"), None).unwrap();
        assert_eq!(all.status(), StatusCode::OK);
        assert_eq!(all.body().len(), 10);
    }

    #[test]
    fn copies_a_video_into_the_show_folder_without_overwriting() {
        let (d, f) = show();
        let other = tempfile::tempdir().unwrap();
        fs::write(other.path().join("a.mp4"), b"abc").unwrap();
        let from = other.path().join("a.mp4").to_string_lossy().to_string();
        assert_eq!(proj_copy_video(f.clone(), from.clone()).unwrap(), "video/a (2).mp4");
        assert_eq!(proj_copy_video(f, from).unwrap(), "video/a (3).mp4");
        assert_eq!(fs::read(d.path().join("video/a (2).mp4")).unwrap(), b"abc");
    }
}
