//! Copies exported from a document (PDF, Word… made by Bardo) that sit in the show folder.
//! They are not part of the index: they are found each time by name, so moving or deleting
//! them in the folder is always reflected.

use crate::manifest::is_project;
use crate::model::Project;
use crate::ready::document_path;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// File types an export can have.
const EXPORT_EXTENSIONS: &[&str] = &["pdf", "docx", "odt", "txt", "rtf"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportFile {
    /// File name with extension.
    pub name: String,
    /// Path relative to the show folder, with `/`.
    pub path: String,
    /// Seconds since 1970 of the last change.
    pub modified: u64,
}

/// Every file with an export extension in the show folder (subfolders too, but not nested shows
/// or hidden folders), as (relative path, name, stem, modified).
fn candidates(dir: &Path) -> Vec<(String, String, String, u64)> {
    fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<(String, String, String, u64)>) {
        if depth > 3 {
            return;
        }
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || ft.is_symlink() {
                continue;
            }
            let p = e.path();
            if ft.is_dir() {
                if !is_project(&p) {
                    walk(root, &p, depth + 1, out);
                }
                continue;
            }
            let ext = p
                .extension()
                .map(|x| x.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            if !EXPORT_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }
            let stem = p
                .file_stem()
                .map(|x| x.to_string_lossy().to_string())
                .unwrap_or_default();
            let rel = p
                .strip_prefix(root)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            let modified = e
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            out.push((rel, name, stem, modified));
        }
    }
    let mut out = vec![];
    walk(dir, dir, 0, &mut out);
    out
}

/// The title written inside a Bardo script (`data.meta.title`), if it can be read.
fn bardo_title(file: &Path) -> Option<String> {
    let text = fs::read_to_string(file).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let t = v
        .get("data")?
        .get("meta")?
        .get("title")?
        .as_str()?
        .trim()
        .to_string();
    (!t.is_empty()).then_some(t)
}

fn starts_with_ci(s: &str, prefix: &str) -> bool {
    s.len() >= prefix.len()
        && s.is_char_boundary(prefix.len())
        && s[..prefix.len()].eq_ignore_ascii_case(prefix)
}

/// Exports of each Bardo script of the show (document id → files, newest first).
/// A file belongs to a script when its name starts with the script's file name
/// ("Amleto - copione 1.0.bardo" → "Amleto - copione 1.0 - Ofelia.pdf") or with the
/// script's title followed by " - " (Bardo names exports "<title> - copione <version>…").
pub fn bardo_exports(dir: &Path, project: &Project) -> HashMap<String, Vec<ExportFile>> {
    let docs: Vec<_> = project
        .documents
        .iter()
        .filter(|d| d.app == "bardo")
        .collect();
    if docs.is_empty() {
        return HashMap::new();
    }
    let files = candidates(dir);
    let mut out = HashMap::new();
    for d in docs {
        let file = document_path(dir, d);
        let stem = file
            .file_stem()
            .map(|x| x.to_string_lossy().to_string())
            .unwrap_or_default();
        let title = bardo_title(&file).map(|t| format!("{t} - "));
        let mut list: Vec<ExportFile> = files
            .iter()
            .filter(|(_, _, s, _)| {
                (!stem.is_empty() && starts_with_ci(s, &stem))
                    || title.as_deref().is_some_and(|t| starts_with_ci(s, t))
            })
            .map(|(rel, name, _, m)| ExportFile {
                name: name.clone(),
                path: rel.clone(),
                modified: *m,
            })
            .collect();
        list.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.name.cmp(&b.name)));
        if !list.is_empty() {
            out.insert(d.id.clone(), list);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest;

    #[test]
    fn exports_are_found_by_file_name_and_by_title() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        fs::write(
            d.join("Amleto - copione 1.0.bardo"),
            r#"{"format":"bardo","data":{"meta":{"title":"Amleto"}}}"#,
        )
        .unwrap();
        fs::write(d.join("Amleto - copione 1.0.pdf"), "x").unwrap();
        fs::create_dir(d.join("Esportazioni")).unwrap();
        fs::write(
            d.join("Esportazioni")
                .join("Amleto - copione 1.1 - Ofelia.docx"),
            "x",
        )
        .unwrap();
        fs::write(d.join("Altro.pdf"), "x").unwrap();
        fs::write(d.join("Amleto - note.bardo.bak"), "x").unwrap();
        // A nested show is not searched.
        fs::create_dir_all(d.join("Copie").join("Tour")).unwrap();
        manifest::create(&d.join("Copie").join("Tour"), "Tour", "").unwrap();
        fs::write(
            d.join("Copie").join("Tour").join("Amleto - copione 9.pdf"),
            "x",
        )
        .unwrap();
        let p = manifest::create(d, "Amleto", "").unwrap();
        let doc = p.documents.iter().find(|x| x.app == "bardo").unwrap();
        let found = bardo_exports(d, &p);
        let mut names: Vec<_> = found[&doc.id].iter().map(|e| e.path.clone()).collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "Amleto - copione 1.0.pdf",
                "Esportazioni/Amleto - copione 1.1 - Ofelia.docx"
            ]
        );
    }
}
