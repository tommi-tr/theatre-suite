//! Knowing whether a newer version of an app exists. Pure logic: the launcher
//! fetches the text (only when allowed) and hands it here.

use crate::{Error, Result};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Latest {
    pub version: String,
    pub url: String,
    pub notes: String,
}

/// The Windows installer attached to a release.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installer {
    /// Download address (https, on github.com).
    pub url: String,
    /// File name, e.g. `Diaframma_0.2.0_x64-setup.exe`.
    pub name: String,
    pub size: u64,
    /// SHA-256 in hex, when the source gives it: the download is checked against it.
    #[serde(default)]
    pub sha256: Option<String>,
}

/// One published version of an app.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub version: String,
    /// Page of the release (notes, files).
    pub url: String,
    pub notes: String,
    /// ISO date of publication ("" when unknown).
    #[serde(default)]
    pub published: String,
    #[serde(default)]
    pub installer: Option<Installer>,
}

impl Release {
    pub fn latest(&self) -> Latest {
        Latest {
            version: self.version.clone(),
            url: self.url.clone(),
            notes: self.notes.clone(),
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Status {
    /// The app is not installed.
    NotInstalled,
    UpToDate,
    Available {
        latest: String,
        url: String,
    },
    /// A newer version exists but the person chose to keep the installed one.
    Held {
        latest: String,
    },
    /// We could not tell (no information about this app, or a version we cannot read).
    Unknown,
}

fn parse_version(s: &str) -> Option<Version> {
    Version::parse(s.trim().trim_start_matches(['v', 'V']))
        .ok()
        .or_else(|| {
            // "1.0" → "1.0.0"
            let t = s.trim().trim_start_matches(['v', 'V']);
            let parts = t.split('.').count();
            (parts == 2)
                .then(|| Version::parse(&format!("{t}.0")).ok())
                .flatten()
        })
}

pub fn compare(a: &str, b: &str) -> Option<Ordering> {
    Some(parse_version(a)?.cmp(&parse_version(b)?))
}

pub fn status(installed: Option<&str>, latest: Option<&Latest>) -> Status {
    let Some(inst) = installed else {
        return Status::NotInstalled;
    };
    let Some(l) = latest else {
        return Status::Unknown;
    };
    match compare(inst, &l.version) {
        Some(Ordering::Less) => Status::Available {
            latest: l.version.clone(),
            url: l.url.clone(),
        },
        Some(_) => Status::UpToDate,
        None => Status::Unknown,
    }
}

/// Adds `l` to `map` unless a newer (or equal) version of that app is already there.
pub fn keep_newest(map: &mut HashMap<String, Latest>, app: String, l: Latest) {
    match map.get(&app) {
        Some(cur) if compare(&cur.version, &l.version) != Some(Ordering::Less) => {}
        _ => {
            map.insert(app, l);
        }
    }
}

/// Like `status`, but a version the person decided to keep is not offered as an update.
pub fn status_held(installed: Option<&str>, latest: Option<&Latest>, held: bool) -> Status {
    match status(installed, latest) {
        Status::Available { latest, .. } if held => Status::Held { latest },
        other => other,
    }
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
    /// "sha256:<hex>" (GitHub adds it to assets since 2025).
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

/// The Windows installer among the files of a release: an `.exe` downloaded from github.com.
fn windows_installer(assets: &[GhAsset]) -> Option<Installer> {
    let ok = |a: &&GhAsset| {
        a.name.to_ascii_lowercase().ends_with(".exe")
            && a.browser_download_url.starts_with("https://github.com/")
    };
    let a = assets
        .iter()
        .filter(ok)
        .find(|a| a.name.to_ascii_lowercase().contains("setup"))
        .or_else(|| assets.iter().find(ok))?;
    let sha256 = a
        .digest
        .as_deref()
        .and_then(|d| d.strip_prefix("sha256:"))
        .filter(|h| h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()))
        .map(|h| h.to_ascii_lowercase());
    Some(Installer {
        url: a.browser_download_url.clone(),
        name: a.name.clone(),
        size: a.size,
        sha256,
    })
}

/// Sorts newest first and drops repeated versions.
pub fn sort_releases(list: &mut Vec<Release>) {
    list.sort_by(|a, b| compare(&b.version, &a.version).unwrap_or(Ordering::Equal));
    list.dedup_by(|a, b| compare(&a.version, &b.version) == Some(Ordering::Equal));
}

/// Every published version of every app, newest first. Tags look like `diaframma-v1.2.0`.
pub fn parse_github_all(json: &str) -> Result<HashMap<String, Vec<Release>>> {
    let list: Vec<GhRelease> = serde_json::from_str(json)
        .map_err(|e| Error::Other(format!("Unexpected answer from GitHub: {e}")))?;
    let mut out: HashMap<String, Vec<Release>> = HashMap::new();
    for r in list.into_iter().filter(|r| !r.draft && !r.prerelease) {
        let Some((app, ver)) = r.tag_name.rsplit_once("-v") else {
            continue;
        };
        if parse_version(ver).is_none() || app.is_empty() {
            continue;
        }
        out.entry(app.to_string()).or_default().push(Release {
            version: ver.to_string(),
            url: r.html_url,
            notes: r.body.unwrap_or_default(),
            published: r.published_at.unwrap_or_default(),
            installer: windows_installer(&r.assets),
        });
    }
    for v in out.values_mut() {
        sort_releases(v);
    }
    Ok(out)
}

/// GitHub "list releases" answer: the newest version of each app.
pub fn parse_github_releases(json: &str) -> Result<HashMap<String, Latest>> {
    Ok(parse_github_all(json)?
        .into_iter()
        .filter_map(|(k, v)| v.first().map(|r| (k, r.latest())))
        .collect())
}

#[derive(Deserialize)]
struct ManifestApp {
    version: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    notes: String,
}

#[derive(Deserialize)]
struct Manifest {
    apps: HashMap<String, ManifestApp>,
}

/// Own update file: `{ "schema": 1, "apps": { "diaframma": { "version": "1.1.0", "url": "…", "notes": "…" } } }`.
pub fn parse_manifest(json: &str) -> Result<HashMap<String, Latest>> {
    let m: Manifest = serde_json::from_str(json)
        .map_err(|e| Error::Other(format!("Unexpected update file: {e}")))?;
    Ok(m.apps
        .into_iter()
        .filter(|(_, a)| parse_version(&a.version).is_some())
        .map(|(k, a)| {
            (
                k,
                Latest {
                    version: a.version,
                    url: a.url,
                    notes: a.notes,
                },
            )
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_like_people_expect() {
        assert_eq!(compare("1.0.0", "1.1.0"), Some(Ordering::Less));
        assert_eq!(compare("v1.10.0", "1.9.0"), Some(Ordering::Greater));
        assert_eq!(compare("1.0", "1.0.0"), Some(Ordering::Equal));
        assert_eq!(compare("abc", "1.0.0"), None);
    }

    #[test]
    fn github_releases_pick_newest_per_app_and_skip_drafts() {
        let json = r#"[
          {"tag_name":"diaframma-v1.1.0","html_url":"https://x/1","draft":false,"prerelease":false,"body":"New"},
          {"tag_name":"diaframma-v1.2.0","html_url":"https://x/2","draft":true,"prerelease":false},
          {"tag_name":"diaframma-v1.0.0","html_url":"https://x/0","draft":false,"prerelease":false},
          {"tag_name":"launcher-v0.3.0","html_url":"https://x/l","draft":false,"prerelease":false},
          {"tag_name":"bardo-v0.1.0-beta","html_url":"https://x/b","draft":false,"prerelease":true},
          {"tag_name":"random","html_url":"https://x/r"}
        ]"#;
        let m = parse_github_releases(json).unwrap();
        assert_eq!(m["diaframma"].version, "1.1.0");
        assert_eq!(m["launcher"].version, "0.3.0");
        assert!(!m.contains_key("bardo"));
        assert_eq!(m.len(), 2);
    }

    #[test]
    fn every_version_with_its_windows_installer() {
        let json = r#"[
          {"tag_name":"bardo-v0.1.0","html_url":"https://x/b1","published_at":"2026-11-01T10:00:00Z","assets":[
            {"name":"Bardo_0.1.0_x64-setup.exe","browser_download_url":"https://github.com/o/r/releases/download/bardo-v0.1.0/Bardo_0.1.0_x64-setup.exe","size":100,"digest":"sha256:ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789"}]},
          {"tag_name":"bardo-v0.2.0","html_url":"https://x/b2","assets":[
            {"name":"notes.txt","browser_download_url":"https://github.com/o/r/notes.txt"},
            {"name":"evil.exe","browser_download_url":"https://example.com/evil.exe"}]}
        ]"#;
        let m = parse_github_all(json).unwrap();
        let b = &m["bardo"];
        assert_eq!(b.len(), 2);
        assert_eq!(b[0].version, "0.2.0");
        assert!(
            b[0].installer.is_none(),
            "only installers on github.com are accepted"
        );
        let i = b[1].installer.as_ref().unwrap();
        assert_eq!(i.size, 100);
        assert_eq!(
            i.sha256.as_deref(),
            Some("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789")
        );
        assert_eq!(b[1].published, "2026-11-01T10:00:00Z");
    }

    #[test]
    fn a_kept_version_is_not_offered_as_an_update() {
        let l = Latest {
            version: "1.1.0".into(),
            url: "u".into(),
            notes: String::new(),
        };
        assert_eq!(
            status_held(Some("1.0.0"), Some(&l), true),
            Status::Held {
                latest: "1.1.0".into()
            }
        );
        assert_eq!(status_held(Some("1.1.0"), Some(&l), true), Status::UpToDate);
    }

    #[test]
    fn status_cases() {
        let l = Latest {
            version: "1.1.0".into(),
            url: "u".into(),
            notes: String::new(),
        };
        assert_eq!(status(None, Some(&l)), Status::NotInstalled);
        assert_eq!(
            status(Some("1.0.0"), Some(&l)),
            Status::Available {
                latest: "1.1.0".into(),
                url: "u".into()
            }
        );
        assert_eq!(status(Some("1.1.0"), Some(&l)), Status::UpToDate);
        assert_eq!(status(Some("2.0.0"), Some(&l)), Status::UpToDate);
        assert_eq!(status(Some("1.0.0"), None), Status::Unknown);
    }

    #[test]
    fn own_manifest() {
        let m = parse_manifest(r#"{"schema":1,"apps":{"diaframma":{"version":"1.2.0","url":"https://d"},"bad":{"version":"x"}}}"#).unwrap();
        assert_eq!(m.len(), 1);
        assert_eq!(m["diaframma"].url, "https://d");
    }
}
