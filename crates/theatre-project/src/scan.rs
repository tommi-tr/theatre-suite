use crate::apps::app_for_extension;
use crate::manifest::is_project;
use crate::model::*;
use std::fs;
use std::path::Path;

const MAX_DEPTH: usize = 6;

pub struct Found {
    pub app: String,
    /// Relative path with `/`.
    pub path: String,
    pub title: String,
}

/// Documents of known apps inside `dir`. Nested projects (copies) and hidden
/// folders are not entered; the project's own cover and index are ignored.
pub fn scan_documents(dir: &Path) -> Vec<Found> {
    let mut out = vec![];
    walk(dir, dir, 0, &mut out);
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    out
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<Found>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            if path != root && is_project(&path) {
                continue;
            }
            walk(root, &path, depth + 1, out);
        } else if ft.is_file() {
            let Some(ext) = path.extension().map(|e| e.to_string_lossy().to_string()) else { continue };
            let Some(app) = app_for_extension(&ext) else { continue };
            let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            let title = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            out.push(Found { app: app.id.to_string(), path: rel, title });
        }
    }
}

/// Adds the found documents that the index does not list yet. Returns how many.
pub fn sync_documents(dir: &Path, project: &mut Project) -> usize {
    let mut added = 0;
    for f in scan_documents(dir) {
        if project.documents.iter().any(|d| d.path.eq_ignore_ascii_case(&f.path)) {
            continue;
        }
        project.documents.push(Document { id: new_id(), app: f.app, title: f.title, path: f.path, phase: None, archived: false, in_show: false, extra: Default::default() });
        added += 1;
    }
    added
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest;

    #[test]
    fn finds_documents_but_not_inside_nested_projects() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("Audio")).unwrap();
        fs::write(root.join("Audio/Atto I.diaframma"), "{}").unwrap();
        fs::write(root.join("note.txt"), "x").unwrap();
        fs::create_dir_all(root.join("Copie/Tour Nord")).unwrap();
        manifest::create(&root.join("Copie/Tour Nord"), "Tour Nord", "").unwrap();
        fs::write(root.join("Copie/Tour Nord/Atto I.diaframma"), "{}").unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::write(root.join(".hidden/x.diaframma"), "{}").unwrap();
        let found = scan_documents(root);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, "Audio/Atto I.diaframma");
        assert_eq!(found[0].app, "diaframma");
    }

    #[test]
    fn sync_does_not_duplicate() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.diaframma"), "{}").unwrap();
        let mut p = Project::new("X", "");
        assert_eq!(sync_documents(dir.path(), &mut p), 1);
        assert_eq!(sync_documents(dir.path(), &mut p), 0);
    }
}
