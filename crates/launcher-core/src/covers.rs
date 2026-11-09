use crate::Result;
use base64::{Engine, engine::general_purpose::STANDARD};
use std::path::{Path, PathBuf};
use theatre_project::manifest::{self, atomic_write};

const MAX_READ: u64 = 25 * 1024 * 1024;

fn mime(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        _ => "image/jpeg",
    }
}

/// An image file as a `data:` address the interface can show. Refuses very large files.
pub fn data_url(path: &Path) -> Result<String> {
    let len = std::fs::metadata(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?.len();
    if len > MAX_READ {
        return Err("The image is too large (over 25 MB)".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    Ok(format!("data:{};base64,{}", mime(path), STANDARD.encode(bytes)))
}

/// Stores the (already resized) cover in the project folder and records it in the index.
pub fn set_image(dir: &Path, jpeg_base64: &str, color: Option<String>) -> Result<String> {
    let bytes = STANDARD.decode(jpeg_base64.trim()).map_err(|_| "The image data is not valid".to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("The cover is too large".into());
    }
    let mut project = manifest::load(dir).map_err(|e| e.to_string())?;
    let name = "copertina.jpg";
    atomic_write(&dir.join(name), &bytes).map_err(|e| e.to_string())?;
    project.cover.image = Some(name.to_string());
    if color.is_some() {
        project.cover.color = color;
    }
    manifest::save(dir, &project).map_err(|e| e.to_string())?;
    Ok(name.to_string())
}

/// Removes the cover image (the colour stays).
pub fn clear_image(dir: &Path) -> Result<()> {
    let mut project = manifest::load(dir).map_err(|e| e.to_string())?;
    if let Some(img) = project.cover.image.take() {
        let _ = std::fs::remove_file(dir.join(img));
    }
    manifest::save(dir, &project).map_err(|e| e.to_string())
}

pub fn image_path(dir: &Path, rel: &str) -> PathBuf {
    dir.join(rel)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cover_roundtrip() {
        let d = tempfile::tempdir().unwrap();
        manifest::create(d.path(), "Amleto", "").unwrap();
        let b64 = STANDARD.encode([0xFFu8, 0xD8, 0xFF, 0xD9]);
        set_image(d.path(), &b64, Some("#7a2e4a".into())).unwrap();
        let p = manifest::load(d.path()).unwrap();
        assert_eq!(p.cover.image.as_deref(), Some("copertina.jpg"));
        assert_eq!(p.cover.color.as_deref(), Some("#7a2e4a"));
        assert!(data_url(&d.path().join("copertina.jpg")).unwrap().starts_with("data:image/jpeg;base64,"));
        clear_image(d.path()).unwrap();
        assert!(!d.path().join("copertina.jpg").exists());
        assert!(set_image(d.path(), "%%%", None).is_err());
    }
}
