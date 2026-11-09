//! The list of shows the launcher knows about, and the tree of copies shown in the Home.

use crate::manifest::{self, atomic_write, is_project};
use crate::model::*;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    #[serde(default)]
    pub last_opened: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub projects: Vec<Entry>,
}

fn same(a: &str, b: &str) -> bool {
    let n = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    n(a) == n(b)
}

impl Registry {
    /// A missing or damaged file gives an empty list (a damaged one is kept aside).
    pub fn load(file: &Path) -> Registry {
        match fs::read_to_string(file) {
            Ok(t) => serde_json::from_str(&t).unwrap_or_else(|_| {
                let _ = fs::rename(file, file.with_extension("json.damaged"));
                Registry::default()
            }),
            Err(_) => Registry::default(),
        }
    }

    pub fn save(&self, file: &Path) -> Result<()> {
        let mut r = self.clone();
        r.version = 1;
        let text = serde_json::to_string_pretty(&r).map_err(|e| Error::Other(e.to_string()))?;
        atomic_write(file, text.as_bytes())
    }

    /// Returns true when the path was new.
    pub fn add(&mut self, path: &str) -> bool {
        if self.projects.iter().any(|e| same(&e.path, path)) {
            return false;
        }
        self.projects.push(Entry { path: path.to_string(), last_opened: 0 });
        true
    }

    pub fn remove(&mut self, path: &str) {
        self.projects.retain(|e| !same(&e.path, path));
    }

    pub fn touch(&mut self, path: &str) {
        if let Some(e) = self.projects.iter_mut().find(|e| same(&e.path, path)) {
            e.last_opened = now_secs();
        }
    }

    /// Adds the shows found inside `dir` (nested copies). Returns how many were new.
    pub fn add_nested(&mut self, dir: &Path) -> usize {
        let mut n = 0;
        for p in discover_nested(dir) {
            if self.add(&p.to_string_lossy()) {
                n += 1;
            }
        }
        n
    }
}

/// Shows (folders with an index) inside `dir`, excluding `dir` itself.
pub fn discover_nested(dir: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth > 5 {
            return;
        }
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            if !ft.is_dir() || ft.is_symlink() || e.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let p = e.path();
            if is_project(&p) {
                out.push(p.clone());
            }
            walk(&p, depth + 1, out);
        }
    }
    let mut out = vec![];
    walk(dir, 0, &mut out);
    out
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub path: String,
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub cover: Cover,
    pub documents: usize,
    pub in_show: usize,
    pub archived: usize,
    /// Distinct apps with at least one visible document.
    pub apps: Vec<String>,
    pub created: u64,
    pub updated: u64,
    pub last_opened: u64,
    pub parent: Option<ParentRef>,
    /// The folder is gone (moved, deleted, drive not connected).
    pub missing: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    #[serde(flatten)]
    pub summary: Summary,
    pub children: Vec<Node>,
}

pub fn summarize(entry: &Entry) -> Summary {
    let dir = Path::new(&entry.path);
    let fallback_title = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| entry.path.clone());
    let base = |missing: bool, error: Option<String>| Summary {
        path: entry.path.clone(),
        id: String::new(),
        title: fallback_title.clone(),
        subtitle: String::new(),
        cover: Cover::default(),
        documents: 0,
        in_show: 0,
        archived: 0,
        apps: vec![],
        created: 0,
        updated: 0,
        last_opened: entry.last_opened,
        parent: None,
        missing,
        error,
    };
    if !dir.is_dir() {
        return base(true, None);
    }
    match manifest::load(dir) {
        Ok(p) => {
            let visible: Vec<&Document> = p.documents.iter().filter(|d| !d.archived).collect();
            let mut apps: Vec<String> = vec![];
            for d in &visible {
                if !apps.contains(&d.app) {
                    apps.push(d.app.clone());
                }
            }
            Summary {
                id: p.id.clone(),
                title: p.title.clone(),
                subtitle: p.subtitle.clone(),
                cover: p.cover.clone(),
                documents: visible.len(),
                in_show: visible.iter().filter(|d| d.in_show).count(),
                archived: p.documents.len() - visible.len(),
                apps,
                created: p.created,
                updated: p.updated,
                parent: p.parent.clone(),
                ..base(false, None)
            }
        }
        Err(Error::NotAProject(_)) => base(true, None),
        Err(e) => base(false, Some(e.to_string())),
    }
}

/// All known shows as a tree: copies sit under the show they were made from.
pub fn tree(registry: &Registry) -> Vec<Node> {
    let summaries: Vec<Summary> = registry.projects.iter().map(summarize).collect();
    let ids: Vec<&str> = summaries.iter().filter(|s| !s.id.is_empty()).map(|s| s.id.as_str()).collect();
    let is_child = |s: &Summary| s.parent.as_ref().is_some_and(|p| ids.contains(&p.id.as_str()) && p.id != s.id);
    fn build(s: &Summary, all: &[Summary], depth: usize) -> Node {
        let mut kids: Vec<&Summary> = if depth < 8 { all.iter().filter(|c| c.parent.as_ref().is_some_and(|p| !s.id.is_empty() && p.id == s.id) && c.id != s.id).collect() } else { vec![] };
        kids.sort_by_key(|c| c.created);
        Node { summary: s.clone(), children: kids.into_iter().map(|c| build(c, all, depth + 1)).collect() }
    }
    let mut roots: Vec<&Summary> = summaries.iter().filter(|s| !is_child(s)).collect();
    roots.sort_by(|a, b| b.last_opened.max(b.updated).cmp(&a.last_opened.max(a.updated)));
    roots.into_iter().map(|s| build(s, &summaries, 0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::copy;

    #[test]
    fn tree_nests_copies_and_flags_missing_folders() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("Amleto");
        manifest::create(&src, "Amleto", "").unwrap();
        let (c1, _) = copy::copy_project(&src, &copy::nested_parent(&src), "Tour Nord").unwrap();
        let other = tmp.path().join("Altrove");
        let (_c2, _) = copy::copy_project(&src, &other, "Tour Sud").unwrap();
        let mut reg = Registry::default();
        reg.add(&src.to_string_lossy());
        assert_eq!(reg.add_nested(&src), 1); // finds Tour Nord inside
        assert!(!reg.add(&c1.to_string_lossy()));
        reg.add(&other.join("Tour Sud").to_string_lossy());
        reg.add(&tmp.path().join("sparito").to_string_lossy());
        let t = tree(&reg);
        let amleto = t.iter().find(|n| n.summary.title == "Amleto").unwrap();
        assert_eq!(amleto.children.len(), 2);
        assert!(t.iter().any(|n| n.summary.missing));
    }

    #[test]
    fn registry_roundtrip_and_damaged_file() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("registry.json");
        let mut r = Registry::default();
        r.add("C:\\Teatro\\Amleto");
        assert!(!r.add("c:/teatro/amleto/"));
        r.save(&f).unwrap();
        assert_eq!(Registry::load(&f).projects.len(), 1);
        fs::write(&f, "garbage").unwrap();
        assert!(Registry::load(&f).projects.is_empty());
        assert!(tmp.path().join("registry.json.damaged").is_file());
    }
}
