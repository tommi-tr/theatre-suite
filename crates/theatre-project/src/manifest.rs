use crate::apps::app_for_extension;
use crate::model::*;
use crate::scan;
use crate::{Error, Result};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;

pub fn manifest_path(dir: &Path) -> PathBuf {
    dir.join(MANIFEST_FILE)
}

pub fn is_project(dir: &Path) -> bool {
    manifest_path(dir).is_file()
}

/// Atomic write: temporary file in the same folder, flush, rename.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::Io("Invalid path".into()))?;
    if !parent.as_os_str().is_empty() {
        fs::create_dir_all(parent)?;
    }
    let name = path
        .file_name()
        .ok_or_else(|| Error::Io("Invalid file name".into()))?
        .to_string_lossy()
        .to_string();
    let tmp = parent.join(format!(".{name}.tmp"));
    {
        let mut f = fs::File::create(&tmp)
            .map_err(|e| Error::Io(format!("Cannot write {}: {e}", path.display())))?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        Error::Io(format!("Cannot save {}: {e}", path.display()))
    })
}

/// Reads the index of the project in `dir`. Does not touch the disk otherwise.
pub fn load(dir: &Path) -> Result<Project> {
    let path = manifest_path(dir);
    if !path.is_file() {
        return Err(Error::NotAProject(dir.display().to_string()));
    }
    let meta = fs::metadata(&path)?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return Err(Error::Damaged(format!(
            "{} is too large to be a project index",
            path.display()
        )));
    }
    let text = String::from_utf8(fs::read(&path)?)
        .map_err(|_| Error::Damaged(format!("{} is not a text file", path.display())))?;
    let project: Project = serde_json::from_str(&text)
        .map_err(|e| Error::Damaged(format!("{} is damaged: {e}", path.display())))?;
    if project.format != FORMAT_ID {
        return Err(Error::Damaged(format!(
            "{} is not a Theatre Suite project index",
            path.display()
        )));
    }
    if project.format_version > FORMAT_VERSION {
        return Err(Error::TooNew {
            found: project.format_version,
            supported: FORMAT_VERSION,
        });
    }
    Ok(project)
}

pub fn save(dir: &Path, project: &Project) -> Result<()> {
    let mut p = project.clone();
    p.updated = now_secs();
    let text = serde_json::to_string_pretty(&p).map_err(|e| Error::Other(e.to_string()))?;
    atomic_write(&manifest_path(dir), text.as_bytes())
}

/// Creates a new empty project in `dir` (the folder is created if needed).
pub fn create(dir: &Path, title: &str, subtitle: &str) -> Result<Project> {
    if title.trim().is_empty() {
        return Err(Error::InvalidName(title.into()));
    }
    if is_project(dir) {
        return Err(Error::AlreadyExists(
            manifest_path(dir).display().to_string(),
        ));
    }
    fs::create_dir_all(dir)?;
    let mut p = Project::new(title, subtitle);
    scan::sync_documents(dir, &mut p);
    save(dir, &p)?;
    Ok(p)
}

/// Builds a project index from the documents found in a folder (used when the
/// index is missing or damaged, and to adopt an existing folder of files).
pub fn rebuild(dir: &Path) -> Result<Project> {
    let title = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Show".into());
    let mut p = Project::new(&title, "");
    scan::sync_documents(dir, &mut p);
    Ok(p)
}

pub struct Opened {
    pub project: Project,
    /// The index was damaged and has been rebuilt from the folder.
    pub rebuilt: bool,
}

/// Opens the project in `dir`. A damaged index is set aside (`progetto.theatre.damaged`)
/// and rebuilt from the documents in the folder: nothing is lost.
pub fn open_or_rebuild(dir: &Path) -> Result<Opened> {
    match load(dir) {
        Ok(project) => Ok(Opened {
            project,
            rebuilt: false,
        }),
        Err(Error::Damaged(_)) => {
            let path = manifest_path(dir);
            let aside = dir.join(format!("{MANIFEST_FILE}.damaged"));
            let _ = fs::remove_file(&aside);
            fs::rename(&path, &aside)?;
            let project = rebuild(dir)?;
            save(dir, &project)?;
            Ok(Opened {
                project,
                rebuilt: true,
            })
        }
        Err(e) => Err(e),
    }
}

/// Adds to the index the documents found in the folder that are not listed yet.
/// Returns how many were added. Documents that disappeared are kept (flagged at read time).
pub fn refresh(dir: &Path, project: &mut Project) -> usize {
    scan::sync_documents(dir, project)
}

/// Takes a document off the list (the file itself is not touched). Returns false if it was not there.
pub fn remove_document(project: &mut Project, id: &str) -> bool {
    let before = project.documents.len();
    project.documents.retain(|d| d.id != id);
    project.documents.len() != before
}

/// Registers one document explicitly (for example just created from an app).
pub fn add_document(project: &mut Project, rel_path: &str, app: Option<&str>) -> Option<usize> {
    let rel = rel_path.replace('\\', "/");
    if project
        .documents
        .iter()
        .any(|d| d.path.eq_ignore_ascii_case(&rel))
    {
        return None;
    }
    let ext = Path::new(&rel)
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();
    let app_id = app
        .map(|s| s.to_string())
        .or_else(|| app_for_extension(&ext).map(|a| a.id.to_string()))?;
    let title = Path::new(&rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    project.documents.push(Document {
        id: new_id(),
        app: app_id,
        title,
        path: rel,
        phase: None,
        extra: Default::default(),
    });
    Some(project.documents.len() - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_load_roundtrip_keeps_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let p = create(dir.path(), "Amleto", "Teatro Comunale").unwrap();
        assert_eq!(p.title, "Amleto");
        // A newer app adds fields the launcher does not know.
        let text = fs::read_to_string(manifest_path(dir.path())).unwrap();
        let mut v: serde_json::Value = serde_json::from_str(&text).unwrap();
        v["futureThing"] = serde_json::json!({"links": [1, 2, 3]});
        fs::write(
            manifest_path(dir.path()),
            serde_json::to_string(&v).unwrap(),
        )
        .unwrap();
        let mut loaded = load(dir.path()).unwrap();
        loaded.title = "Amleto 2".into();
        save(dir.path(), &loaded).unwrap();
        let again: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(manifest_path(dir.path())).unwrap()).unwrap();
        assert_eq!(again["futureThing"]["links"][2], 3);
        assert_eq!(again["title"], "Amleto 2");
    }

    #[test]
    fn newer_format_is_refused_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        create(dir.path(), "X", "").unwrap();
        let text = fs::read_to_string(manifest_path(dir.path())).unwrap();
        fs::write(
            manifest_path(dir.path()),
            text.replace("\"formatVersion\": 1", "\"formatVersion\": 99"),
        )
        .unwrap();
        assert!(matches!(
            load(dir.path()),
            Err(Error::TooNew { found: 99, .. })
        ));
    }

    #[test]
    fn damaged_index_is_rebuilt_without_losing_documents() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Atto I.diaframma"), "{}").unwrap();
        fs::write(manifest_path(dir.path()), "{ this is not json").unwrap();
        let opened = open_or_rebuild(dir.path()).unwrap();
        assert!(opened.rebuilt);
        assert_eq!(opened.project.documents.len(), 1);
        assert!(dir.path().join("progetto.theatre.damaged").is_file());
        assert!(load(dir.path()).is_ok());
    }

    #[test]
    fn missing_index_is_not_a_project() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            open_or_rebuild(dir.path()),
            Err(Error::NotAProject(_))
        ));
    }
}
