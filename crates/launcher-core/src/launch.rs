use crate::Result;
use serde::Serialize;
use std::path::Path;
use std::process::Command;
use theatre_project::apps::{KnownApp, app_by_id};
use theatre_project::model::Project;
use theatre_project::ready::document_path;

/// Starts `program` with the document as its only argument. The launcher does not wait for it.
pub fn open_with(program: &Path, doc: &Path) -> Result<()> {
    let mut cmd = if cfg!(target_os = "macos") && program.extension().is_some_and(|e| e == "app") {
        let mut c = Command::new("open");
        c.arg("-a").arg(program).arg(doc);
        c
    } else {
        let mut c = Command::new(program);
        c.arg(doc);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| format!("Cannot start {}: {e}", program.display()))
}

/// Shows a file or folder in the system file manager.
pub fn reveal(path: &Path) -> Result<()> {
    let r = if cfg!(windows) {
        if path.is_dir() { Command::new("explorer").arg(path).spawn() } else { Command::new("explorer").arg(format!("/select,{}", path.display())).spawn() }
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(if path.is_dir() { path.to_path_buf() } else { path.parent().unwrap_or(path).to_path_buf() }).spawn()
    } else {
        Command::new("xdg-open").arg(if path.is_dir() { path } else { path.parent().unwrap_or(path) }).spawn()
    };
    r.map(|_| ()).map_err(|e| format!("Cannot open the folder: {e}"))
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    pub doc_id: String,
    pub title: String,
    /// `notInstalled`, `oneAtATime`, `missing`, `failed`.
    pub reason: String,
    pub detail: String,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenAllReport {
    pub opened: Vec<String>,
    pub skipped: Vec<Skipped>,
}

/// Opens every document marked for the show. `program_of` gives the program of an app (None = not installed).
/// An app that works on one document at a time is started only for the first one: the others are reported.
pub fn open_all(
    dir: &Path,
    project: &Project,
    program_of: impl Fn(&KnownApp) -> Option<String>,
    open: impl Fn(&Path, &Path) -> Result<()>,
) -> OpenAllReport {
    let mut report = OpenAllReport::default();
    let mut used: Vec<String> = vec![];
    for doc in project.documents.iter().filter(|d| d.in_show && !d.archived) {
        let skip = |reason: &str, detail: String| Skipped { doc_id: doc.id.clone(), title: doc.title.clone(), reason: reason.into(), detail };
        let path = document_path(dir, doc);
        if !path.is_file() {
            report.skipped.push(skip("missing", doc.path.clone()));
            continue;
        }
        let Some(app) = app_by_id(&doc.app) else {
            report.skipped.push(skip("notInstalled", doc.app.clone()));
            continue;
        };
        if !app.multi_document && used.iter().any(|u| u == app.id) {
            report.skipped.push(skip("oneAtATime", app.name.to_string()));
            continue;
        }
        let Some(program) = program_of(app) else {
            report.skipped.push(skip("notInstalled", app.name.to_string()));
            continue;
        };
        match open(Path::new(&program), &path) {
            Ok(()) => {
                used.push(app.id.to_string());
                report.opened.push(doc.id.clone());
            }
            Err(e) => report.skipped.push(skip("failed", e)),
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use theatre_project::manifest;

    #[test]
    fn opens_marked_documents_one_per_single_document_app() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.diaframma"), "{}").unwrap();
        std::fs::write(d.path().join("b.diaframma"), "{}").unwrap();
        std::fs::write(d.path().join("c.bardo"), "{}").unwrap();
        let mut p = manifest::create(d.path(), "X", "").unwrap();
        for doc in p.documents.iter_mut() {
            doc.in_show = true;
        }
        p.documents.push(theatre_project::model::Document { id: "gone".into(), app: "diaframma".into(), title: "gone".into(), path: "gone.diaframma".into(), phase: None, archived: false, in_show: true, extra: Default::default() });
        let log = RefCell::new(vec![]);
        let r = open_all(
            d.path(),
            &p,
            |a| (a.id == "diaframma").then(|| "C:/Diaframma.exe".to_string()),
            |prog, doc| {
                log.borrow_mut().push((prog.to_string_lossy().to_string(), doc.file_name().unwrap().to_string_lossy().to_string()));
                Ok(())
            },
        );
        assert_eq!(log.borrow().len(), 1); // only the first Diaframma document
        let reasons: Vec<&str> = r.skipped.iter().map(|s| s.reason.as_str()).collect();
        assert!(reasons.contains(&"oneAtATime"));
        assert!(reasons.contains(&"notInstalled")); // Bardo
        assert!(reasons.contains(&"missing"));
        assert_eq!(r.opened.len(), 1);
    }
}
