//! Printing and PDF.
//!
//! The PDF is produced by the same web engine that draws the pages on screen,
//! from the print view the interface prepares: what you see is what you get.
//! On Windows WebView2 writes the PDF directly ("PrintToPdf"); elsewhere the
//! system print panel is used (it has "Save as PDF").

use std::sync::mpsc;
use std::time::Duration;

use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct PageSpec {
    /// Page width in millimetres.
    pub width_mm: f64,
    /// Page height in millimetres.
    pub height_mm: f64,
}

/// True when this system can write a PDF without asking (Windows).
#[tauri::command]
pub fn pdf_direct_supported() -> bool {
    cfg!(windows)
}

/// Opens the system print panel for the current page (the print view).
#[tauri::command]
pub fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Writes the print view to `path` as a PDF (Windows only).
#[tauri::command]
pub async fn print_to_pdf(window: tauri::WebviewWindow, path: String, page: PageSpec) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    #[cfg(windows)]
    {
        let tx2 = tx.clone();
        window
            .with_webview(move |wv| {
                // SAFETY: called on the main thread with a live WebView2 controller.
                if let Err(e) = unsafe { win::start(wv, &path, page, tx2.clone()) } {
                    let _ = tx2.send(Err(e));
                }
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (&window, &path, page);
        let _ = tx.send(Err("Direct PDF export is available on Windows; use Print and choose \"Save as PDF\".".into()));
    }
    drop(tx);
    tauri::async_runtime::spawn_blocking(move || match rx.recv_timeout(Duration::from_secs(180)) {
        Ok(r) => r,
        Err(_) => Err("The PDF took too long to be written.".into()),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod win {
    use super::PageSpec;
    use std::sync::mpsc::Sender;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_2, ICoreWebView2_7, ICoreWebView2Environment6, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    const MM_PER_INCH: f64 = 25.4;

    pub unsafe fn start(wv: tauri::webview::PlatformWebview, path: &str, page: PageSpec, tx: Sender<Result<(), String>>) -> Result<(), String> {
        unsafe {
            let controller = wv.controller();
            let core = controller.CoreWebView2().map_err(|e| e.to_string())?;
            let core2: ICoreWebView2_2 = core.cast().map_err(|e| e.to_string())?;
            let core7: ICoreWebView2_7 = core.cast().map_err(|_| "This version of WebView2 cannot write PDF files. Please update Microsoft Edge WebView2.".to_string())?;
            let env: ICoreWebView2Environment6 = core2.Environment().map_err(|e| e.to_string())?.cast().map_err(|e| e.to_string())?;
            let settings = env.CreatePrintSettings().map_err(|e| e.to_string())?;
            settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT).map_err(|e| e.to_string())?;
            settings.SetPageWidth(page.width_mm / MM_PER_INCH).map_err(|e| e.to_string())?;
            settings.SetPageHeight(page.height_mm / MM_PER_INCH).map_err(|e| e.to_string())?;
            settings.SetMarginTop(0.0).map_err(|e| e.to_string())?;
            settings.SetMarginBottom(0.0).map_err(|e| e.to_string())?;
            settings.SetMarginLeft(0.0).map_err(|e| e.to_string())?;
            settings.SetMarginRight(0.0).map_err(|e| e.to_string())?;
            settings.SetScaleFactor(1.0).map_err(|e| e.to_string())?;
            settings.SetShouldPrintBackgrounds(true).map_err(|e| e.to_string())?;
            settings.SetShouldPrintHeaderAndFooter(false).map_err(|e| e.to_string())?;
            let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
                let _ = tx.send(match result {
                    Ok(()) if ok => Ok(()),
                    Ok(()) => Err("The PDF could not be written (is the file open in another program?).".to_string()),
                    Err(e) => Err(e.message().to_string()),
                });
                Ok(())
            }));
            core7.PrintToPdf(&HSTRING::from(path), &settings, &handler).map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}
