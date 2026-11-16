//! Copying a show (for example one version per tour).
//!
//! The copy is a new folder with every file of the original. It can live inside
//! the original's folder (nested, default `Copie/<name>`) or anywhere else.
//! From the moment it is made, original and copy are independent; the copy only
//! remembers where it comes from.

use crate::manifest::{self, is_project};
use crate::model::*;
use crate::{Error, Result};
use std::fs;
use std::path::{Path, PathBuf};

/// Name of the folder that holds nested copies by default.
pub const NESTED_FOLDER: &str = "Copie";

/// Makes `name` safe as a folder name on Windows and macOS.
pub fn sanitize_name(name: &str) -> Result<String> {
    let cleaned: String = name.chars().filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') && !c.is_control()).collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    let upper = cleaned.to_uppercase();
    let stem = upper.split('.').next().unwrap_or("");
    let reserved = matches!(stem, "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.chars().last().is_some_and(|c| c.is_ascii_digit()));
    if cleaned.is_empty() || reserved || cleaned.len() > 120 {
        return Err(Error::InvalidName(name.into()));
    }
    Ok(cleaned)
}

/// Default place of a nested copy.
pub fn nested_parent(src: &Path) -> PathBuf {
    src.join(NESTED_FOLDER)
}

/// Total size in bytes of what a copy would contain (nested projects excluded).
pub fn copy_size(src: &Path) -> u64 {
    fn walk(root: &Path, dir: &Path) -> u64 {
        let mut total = 0;
        let Ok(rd) = fs::read_dir(dir) else { return 0 };
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            let p = e.path();
            if ft.is_dir() {
                if p != root && is_project(&p) {
                    continue;
                }
                total += walk(root, &p);
            } else if ft.is_file() {
                total += e.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
        total
    }
    walk(src, src)
}

fn copy_tree(root: &Path, from: &Path, to: &Path, staging: &Path) -> Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let ft = e.file_type()?;
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if ft.is_symlink() || p == staging {
            continue;
        }
        if ft.is_dir() {
            if p != root && is_project(&p) {
                continue; // another show (a previous copy): not part of this one
            }
            let had_entries = fs::read_dir(&p)?.next().is_some();
            let sub = to.join(&name);
            copy_tree(root, &p, &sub, staging)?;
            // A folder that only held other shows (like "Copie") is not worth keeping empty.
            if had_entries && fs::read_dir(&sub)?.next().is_none() {
                let _ = fs::remove_dir(&sub);
            }
        } else if ft.is_file() {
            if name.starts_with('.') && name.ends_with(".tmp") {
                continue; // leftover of an interrupted save
            }
            fs::copy(&p, to.join(&name)).map_err(|e| Error::Io(format!("Cannot copy {}: {e}", p.display())))?;
        }
    }
    Ok(())
}

/// Copies the show in `src` to `dest_parent/<name>`. Returns the new folder and its project.
/// The copy is built in a temporary folder and renamed at the end, so an interrupted
/// copy never leaves a half-made show behind.
pub fn copy_project(src: &Path, dest_parent: &Path, name: &str) -> Result<(PathBuf, Project)> {
    let source = manifest::load(src)?;
    let folder = sanitize_name(name)?;
    let dest = dest_parent.join(&folder);
    if dest.exists() {
        return Err(Error::AlreadyExists(dest.display().to_string()));
    }
    fs::create_dir_all(dest_parent)?;
    let staging = dest_parent.join(format!(".{folder}.copying"));
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    let result = (|| -> Result<Project> {
        copy_tree(src, src, &staging, &staging)?;
        let mut p = manifest::load(&staging).unwrap_or_else(|_| source.clone());
        p.id = new_id();
        p.title = name.trim().to_string();
        p.parent = Some(ParentRef { id: source.id.clone(), title: source.title.clone() });
        p.created = now_secs();
        manifest::save(&staging, &p)?;
        fs::rename(&staging, &dest).map_err(|e| Error::Io(format!("Cannot create {}: {e}", dest.display())))?;
        Ok(p)
    })();
    match result {
        Ok(p) => Ok((dest, p)),
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn show(dir: &Path) -> Project {
        fs::create_dir_all(dir.join("Audio")).unwrap();
        fs::write(dir.join("Audio/Atto I.diaframma"), "{\"tracks\":[]}").unwrap();
        fs::write(dir.join("Audio/tuono.wav"), vec![1u8; 1000]).unwrap();
        manifest::create(dir, "Amleto", "Teatro Comunale").unwrap()
    }

    #[test]
    fn nested_copy_has_all_files_a_new_id_and_remembers_the_parent() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("Amleto");
        let original = show(&src);
        let (dest, copy) = copy_project(&src, &nested_parent(&src), "Amleto · Tour Nord").unwrap();
        assert!(dest.starts_with(&src));
        assert!(dest.join("Audio/tuono.wav").is_file());
        assert_ne!(copy.id, original.id);
        assert_eq!(copy.parent.as_ref().unwrap().id, original.id);
        assert_eq!(copy.documents.len(), original.documents.len());
        assert_eq!(copy.documents[0].id, original.documents[0].id); // stable ids
        assert_eq!(manifest::load(&dest).unwrap().title, "Amleto · Tour Nord");
        // the original is untouched and no staging folder is left behind
        assert_eq!(manifest::load(&src).unwrap().id, original.id);
        assert!(!nested_parent(&src).join(".Amleto · Tour Nord.copying").exists());
    }

    #[test]
    fn a_second_copy_does_not_contain_the_first() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("Amleto");
        show(&src);
        copy_project(&src, &nested_parent(&src), "Tour Nord").unwrap();
        let (dest2, _) = copy_project(&src, &nested_parent(&src), "Tour Sud").unwrap();
        assert!(!dest2.join("Copie").exists());
        assert!(dest2.join("Audio/Atto I.diaframma").is_file());
    }

    #[test]
    fn copy_elsewhere_and_copy_of_a_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("Amleto");
        show(&src);
        let other = tmp.path().join("Chiavetta");
        let (d1, c1) = copy_project(&src, &other, "Tour Nord").unwrap();
        let (_d2, c2) = copy_project(&d1, &other, "Tour Nord · Teatro Verdi").unwrap();
        assert_eq!(c2.parent.unwrap().id, c1.id);
    }

    #[test]
    fn existing_name_is_refused_and_names_are_cleaned() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("Amleto");
        show(&src);
        copy_project(&src, &nested_parent(&src), "Tour").unwrap();
        assert!(matches!(copy_project(&src, &nested_parent(&src), "Tour"), Err(Error::AlreadyExists(_))));
        assert_eq!(sanitize_name("  Tour: Nord?  ").unwrap(), "Tour Nord");
        assert!(sanitize_name("CON").is_err());
        assert!(sanitize_name("  ...  ").is_err());
    }

    #[test]
    fn size_excludes_nested_copies() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("Amleto");
        show(&src);
        let before = copy_size(&src);
        copy_project(&src, &nested_parent(&src), "Tour").unwrap();
        assert_eq!(copy_size(&src), before);
    }
}
