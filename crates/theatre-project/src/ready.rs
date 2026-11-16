//! "Everything ready for the evening": are the documents of the show there,
//! and are the files they need (the audio of a cue list) still where they should be?

use crate::manifest;
use crate::model::*;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum IssueKind {
    DocumentMissing,
    FilesMissing { count: usize, examples: Vec<String> },
    Unreadable,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub doc_id: String,
    pub doc_title: String,
    /// File name inside the show folder (with extension), so the person knows which file it is.
    pub doc_path: String,
    pub app: String,
    #[serde(flatten)]
    pub kind: IssueKind,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// Documents in the `Show` phase.
    pub in_show: usize,
    pub issues: Vec<Issue>,
    /// At least one document and no issue.
    pub ready: bool,
}

pub fn document_path(dir: &Path, doc: &Document) -> PathBuf {
    dir.join(doc.path.replace('/', std::path::MAIN_SEPARATOR_STR))
}

pub fn check(dir: &Path, project: &Project) -> Report {
    let mut issues = vec![];
    let mut count = 0;
    for doc in project
        .documents
        .iter()
        .filter(|d| d.phase == Some(Phase::Show))
    {
        count += 1;
        let path = document_path(dir, doc);
        let mk = |kind| Issue {
            doc_id: doc.id.clone(),
            doc_title: doc.title.clone(),
            doc_path: doc.path.clone(),
            app: doc.app.clone(),
            kind,
        };
        if !path.is_file() {
            issues.push(mk(IssueKind::DocumentMissing));
            continue;
        }
        if doc.app == "diaframma" {
            match missing_cue_files(&path) {
                Ok(m) if !m.is_empty() => issues.push(mk(IssueKind::FilesMissing {
                    count: m.len(),
                    examples: m.into_iter().take(5).collect(),
                })),
                Ok(_) => {}
                Err(()) => issues.push(mk(IssueKind::Unreadable)),
            }
        }
    }
    let ready = count > 0 && issues.is_empty();
    Report {
        in_show: count,
        issues,
        ready,
    }
}

/// Audio files of a `.diaframma` cue list that cannot be found (hidden tracks are ignored).
fn missing_cue_files(doc_path: &Path) -> Result<Vec<String>, ()> {
    let text = std::fs::read_to_string(doc_path).map_err(|_| ())?;
    let v: Value = serde_json::from_str(&text).map_err(|_| ())?;
    let base = doc_path.parent().unwrap_or(Path::new("."));
    let mut missing = vec![];
    for track in v
        .get("tracks")
        .and_then(|t| t.as_array())
        .into_iter()
        .flatten()
    {
        if track
            .get("hidden")
            .and_then(|h| h.as_bool())
            .unwrap_or(false)
        {
            continue;
        }
        let Some(file) = track.get("file").filter(|f| !f.is_null()) else {
            continue;
        };
        let rel = file
            .get("relativePath")
            .and_then(|r| r.as_str())
            .filter(|s| !s.is_empty());
        let abs = file
            .get("path")
            .and_then(|r| r.as_str())
            .filter(|s| !s.is_empty());
        let found = rel.is_some_and(|r| base.join(r.replace('\\', "/")).is_file())
            || abs.is_some_and(|a| Path::new(a).is_file());
        if !found {
            let name = file
                .get("name")
                .and_then(|n| n.as_str())
                .or(abs)
                .or(rel)
                .unwrap_or("?");
            missing.push(name.to_string());
        }
    }
    Ok(missing)
}

/// Convenience used by the launcher: load the project and check it.
pub fn check_dir(dir: &Path) -> crate::Result<Report> {
    let p = manifest::load(dir)?;
    Ok(check(dir, &p))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn ready_when_documents_and_audio_exist() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        fs::write(d.join("tuono.wav"), "x").unwrap();
        fs::write(d.join("a.diaframma"), r#"{"tracks":[{"hidden":false,"file":{"path":"C:/nope/tuono.wav","relativePath":"tuono.wav","name":"tuono.wav"}},{"hidden":true,"file":{"path":"C:/nope/x.wav","name":"x.wav"}},{"file":null}]}"#).unwrap();
        let mut p = manifest::create(d, "X", "").unwrap();
        p.documents[0].phase = Some(Phase::Show);
        let r = check(d, &p);
        assert!(r.ready, "{r:?}");
        assert_eq!(r.in_show, 1);
    }

    #[test]
    fn reports_missing_audio_and_missing_documents() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        fs::write(
            d.join("a.diaframma"),
            r#"{"tracks":[{"file":{"path":"C:/nope/pioggia.wav","name":"pioggia.wav"}}]}"#,
        )
        .unwrap();
        let mut p = manifest::create(d, "X", "").unwrap();
        p.documents[0].phase = Some(Phase::Show);
        let r = check(d, &p);
        assert!(!r.ready);
        assert!(matches!(
            &r.issues[0].kind,
            IssueKind::FilesMissing { count: 1, .. }
        ));
        fs::remove_file(d.join("a.diaframma")).unwrap();
        assert_eq!(check(d, &p).issues[0].kind, IssueKind::DocumentMissing);
    }

    #[test]
    fn nothing_in_the_show_phase_is_not_ready() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        fs::write(d.join("a.diaframma"), "{}").unwrap();
        let mut p = manifest::create(d, "X", "").unwrap();
        assert!(!check(d, &p).ready);
        p.documents[0].phase = Some(Phase::Rehearsals);
        assert_eq!(check(d, &p).in_show, 0);
        p.documents[0].phase = Some(Phase::Show);
        assert_eq!(check(d, &p).in_show, 1);
    }
}
