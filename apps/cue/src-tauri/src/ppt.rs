//! PowerPoint, Windows only: export the slides of a `.pptx` as PNG images, and drive an open presentation live
//! (next, previous, go to slide n). Both go through PowerShell and PowerPoint's COM interface, run hidden.
//!
//! Nothing is installed and no setting is changed: the helper only talks to a PowerPoint the user already has.
//! The live helper is one persistent PowerShell process, started when the user connects PowerPoint and ended when
//! they disconnect (or Cue exits); a command is one JSON line in and one JSON line out. On other systems every
//! command answers `windows-only`.

use serde_json::Value;

#[cfg(windows)]
mod win {
    use std::io::{BufRead, BufReader, Write};
    use std::os::windows::process::CommandExt;
    use std::process::{Child, ChildStdin, Command, Stdio};
    use std::sync::mpsc::{self, Receiver};
    use std::sync::Mutex;
    use std::time::Duration;

    use serde_json::Value;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    /// The live helper: reads one JSON command per line, answers one JSON line.
    const LIVE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Reply($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
function Get-App { try { return [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { return $null } }
function Get-Status($app) {
  $name = ''; $count = 0; $slide = 0; $show = $false
  try { $name = [string]$app.ActivePresentation.Name; $count = [int]$app.ActivePresentation.Slides.Count } catch {}
  try { if ($app.SlideShowWindows.Count -gt 0) { $show = $true; $slide = [int]$app.SlideShowWindows.Item(1).View.CurrentShowPosition } } catch {}
  return @{ ok = $true; name = $name; count = $count; slide = $slide; slideshow = $show }
}
Reply @{ ok = $true; ready = $true }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $cmd = $line | ConvertFrom-Json
    if ($cmd.op -eq 'quit') { Reply @{ ok = $true }; break }
    $app = Get-App
    if ($app -eq $null) { Reply @{ ok = $false; error = 'no-powerpoint' }; continue }
    if ($app.Presentations.Count -eq 0) { Reply @{ ok = $false; error = 'no-presentation' }; continue }
    if ($cmd.op -eq 'status') { Reply (Get-Status $app); continue }
    if ($cmd.op -eq 'start') { $app.ActivePresentation.SlideShowSettings.Run() | Out-Null; Reply (Get-Status $app); continue }
    if ($app.SlideShowWindows.Count -eq 0) { Reply @{ ok = $false; error = 'no-slideshow' }; continue }
    $view = $app.SlideShowWindows.Item(1).View
    if ($cmd.op -eq 'next') { $view.Next() }
    elseif ($cmd.op -eq 'previous') { $view.Previous() }
    elseif ($cmd.op -eq 'goto') { $view.GotoSlide([int]$cmd.slide) }
    else { Reply @{ ok = $false; error = 'bad-command' }; continue }
    Reply (Get-Status $app)
  } catch {
    Reply @{ ok = $false; error = 'failed'; detail = [string]$_.Exception.Message }
  }
}
"#;

    pub struct Helper {
        child: Child,
        stdin: ChildStdin,
        lines: Receiver<String>,
    }

    #[derive(Default)]
    pub struct Live(pub Mutex<Option<Helper>>);

    fn encoded(script: &str) -> String {
        use base64::Engine;
        let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        base64::engine::general_purpose::STANDARD.encode(utf16)
    }

    fn powershell() -> Command {
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NoLogo", "-NonInteractive", "-EncodedCommand"]);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }

    pub fn available() -> bool {
        Command::new("reg")
            .args(["query", r"HKCR\PowerPoint.Application\CLSID"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    pub fn connect(live: &Live) -> Result<Value, String> {
        let mut guard = live.0.lock().map_err(|_| "busy")?;
        if guard.is_none() {
            let mut cmd = powershell();
            cmd.arg(encoded(LIVE_SCRIPT)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
            let mut child = cmd.spawn().map_err(|e| format!("start-failed: {e}"))?;
            let stdin = child.stdin.take().ok_or("start-failed")?;
            let stdout = child.stdout.take().ok_or("start-failed")?;
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            });
            // The first line says the helper is up.
            rx.recv_timeout(Duration::from_secs(15)).map_err(|_| "start-failed: PowerShell did not answer")?;
            *guard = Some(Helper { child, stdin, lines: rx });
        }
        request(guard.as_mut().unwrap(), r#"{"op":"status"}"#)
    }

    fn request(h: &mut Helper, line: &str) -> Result<Value, String> {
        while h.lines.try_recv().is_ok() {}
        writeln!(h.stdin, "{line}").and_then(|_| h.stdin.flush()).map_err(|_| "helper-ended".to_string())?;
        let answer = h.lines.recv_timeout(Duration::from_secs(10)).map_err(|_| "timeout".to_string())?;
        serde_json::from_str(&answer).map_err(|_| "bad-answer".to_string())
    }

    pub fn command(live: &Live, line: &str) -> Result<Value, String> {
        let mut guard = live.0.lock().map_err(|_| "busy")?;
        let h = guard.as_mut().ok_or("not-connected")?;
        let r = request(h, line);
        if matches!(&r, Err(e) if e == "helper-ended") {
            *guard = None;
        }
        r
    }

    pub fn disconnect(live: &Live) {
        if let Ok(mut g) = live.0.lock() {
            if let Some(mut h) = g.take() {
                let _ = writeln!(h.stdin, r#"{{"op":"quit"}}"#);
                let _ = h.stdin.flush();
                let _ = h.child.kill();
                let _ = h.child.wait();
            }
        }
    }

    /// Exports the slides of `pptx` as PNG (1920 × 1080) into `out`; PowerPoint opens the file read-only, without a window.
    pub fn export(pptx: &str, out: &str) -> Result<(), String> {
        let q = |s: &str| s.replace('\'', "''");
        let script = format!(
            r#"
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
$p = $app.Presentations.Open('{}', -1, 0, 0)
try {{ $p.Export('{}', 'PNG', 1920, 1080) }} finally {{ $p.Close() }}
if ($app.Presentations.Count -eq 0) {{ try {{ $app.Quit() }} catch {{}} }}
"#,
            q(pptx),
            q(out)
        );
        let o = powershell().arg(encoded(&script)).stdout(Stdio::null()).stderr(Stdio::piped()).output().map_err(|e| format!("start-failed: {e}"))?;
        if o.status.success() { Ok(()) } else { Err(format!("export-failed: {}", String::from_utf8_lossy(&o.stderr).trim())) }
    }
}

#[cfg(windows)]
pub use win::Live;

/// On other systems there is no helper: the state is empty.
#[cfg(not(windows))]
#[derive(Default)]
pub struct Live;

/// Is PowerPoint installed? (A registry key is read; nothing is started.)
#[tauri::command(async)]
pub fn ppt_available() -> bool {
    #[cfg(windows)]
    {
        win::available()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Starts the live helper (once) and answers the state of the open presentation.
#[tauri::command(async)]
pub fn ppt_connect(live: tauri::State<Live>) -> Result<Value, String> {
    #[cfg(windows)]
    {
        win::connect(&live)
    }
    #[cfg(not(windows))]
    {
        let _ = live;
        Err("windows-only".into())
    }
}

/// `op`: `next`, `previous`, `goto` (with `slide`), `start`, `status`.
#[tauri::command(async)]
pub fn ppt_command(live: tauri::State<Live>, op: String, slide: Option<u32>) -> Result<Value, String> {
    #[cfg(windows)]
    {
        if !matches!(op.as_str(), "next" | "previous" | "goto" | "start" | "status") {
            return Err("bad-command".into());
        }
        win::command(&live, &serde_json::json!({ "op": op, "slide": slide }).to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (live, op, slide);
        Err("windows-only".into())
    }
}

#[tauri::command]
pub fn ppt_disconnect(live: tauri::State<Live>) {
    shutdown(&live);
}

/// Ends the helper (also at exit).
pub fn shutdown(live: &Live) {
    #[cfg(windows)]
    win::disconnect(live);
    #[cfg(not(windows))]
    let _ = live;
}

/// Exports the slides of a `.pptx` as PNG files into a new temporary folder; returns the folder and the files in
/// slide order.
#[tauri::command(async)]
pub fn ppt_export(pptx: String, out_dir: String) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        if !pptx.to_ascii_lowercase().ends_with(".pptx") && !pptx.to_ascii_lowercase().ends_with(".ppt") && !pptx.to_ascii_lowercase().ends_with(".pptm") {
            return Err("not-powerpoint".into());
        }
        let dir = std::path::PathBuf::from(&out_dir);
        std::fs::create_dir_all(&dir).map_err(|e| format!("io: {e}"))?;
        win::export(&pptx, &out_dir)?;
        let mut files: Vec<(u32, String)> = std::fs::read_dir(&dir)
            .map_err(|e| format!("io: {e}"))?
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let p = e.path();
                let name = p.file_stem()?.to_string_lossy().to_string();
                (p.extension()?.to_ascii_lowercase() == "png").then(|| (slide_number(&name), p.to_string_lossy().to_string()))
            })
            .collect();
        files.sort();
        Ok(files.into_iter().map(|(_, p)| p).collect())
    }
    #[cfg(not(windows))]
    {
        let _ = (pptx, out_dir);
        Err("windows-only".into())
    }
}

/// A new temporary folder for an export (`%TEMP%\cue-slides-<id>`).
#[tauri::command]
pub fn ppt_temp_dir() -> String {
    std::env::temp_dir().join(format!("cue-slides-{}", &crate::tcue::new_id()[..12])).to_string_lossy().to_string()
}

/// Removes an export folder made by `ppt_temp_dir` (nothing else).
#[tauri::command(async)]
pub fn ppt_cleanup(dir: String) {
    let p = std::path::PathBuf::from(&dir);
    let ours = p.parent() == Some(std::env::temp_dir().as_path()) && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("cue-slides-"));
    if ours {
        let _ = std::fs::remove_dir_all(p);
    }
}

/// "Slide12" / "Diapositiva12" → 12 (the number at the end of the name).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn slide_number(stem: &str) -> u32 {
    let digits: String = stem.chars().rev().take_while(|c| c.is_ascii_digit()).collect::<Vec<_>>().into_iter().rev().collect();
    digits.parse().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slide_numbers_sort_numerically() {
        assert_eq!(slide_number("Slide2"), 2);
        assert_eq!(slide_number("Diapositiva12"), 12);
        assert_eq!(slide_number("x"), 0);
        let mut v = ["Slide10", "Slide2", "Slide1"].map(slide_number).to_vec();
        v.sort();
        assert_eq!(v, [1, 2, 10]);
    }

    #[test]
    #[cfg(not(windows))]
    fn says_windows_only_elsewhere() {
        assert!(!ppt_available());
        assert_eq!(ppt_export("a.pptx".into(), "x".into()).unwrap_err(), "windows-only");
    }
}
