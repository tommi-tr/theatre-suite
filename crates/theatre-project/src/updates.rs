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

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Status {
    /// The app is not installed.
    NotInstalled,
    UpToDate,
    Available { latest: String, url: String },
    /// We could not tell (no information about this app, or a version we cannot read).
    Unknown,
}

fn parse_version(s: &str) -> Option<Version> {
    Version::parse(s.trim().trim_start_matches(['v', 'V'])).ok().or_else(|| {
        // "1.0" → "1.0.0"
        let t = s.trim().trim_start_matches(['v', 'V']);
        let parts = t.split('.').count();
        (parts == 2).then(|| Version::parse(&format!("{t}.0")).ok()).flatten()
    })
}

pub fn compare(a: &str, b: &str) -> Option<Ordering> {
    Some(parse_version(a)?.cmp(&parse_version(b)?))
}

pub fn status(installed: Option<&str>, latest: Option<&Latest>) -> Status {
    let Some(inst) = installed else { return Status::NotInstalled };
    let Some(l) = latest else { return Status::Unknown };
    match compare(inst, &l.version) {
        Some(Ordering::Less) => Status::Available { latest: l.version.clone(), url: l.url.clone() },
        Some(_) => Status::UpToDate,
        None => Status::Unknown,
    }
}

fn keep_newest(map: &mut HashMap<String, Latest>, app: String, l: Latest) {
    match map.get(&app) {
        Some(cur) if compare(&cur.version, &l.version) != Some(Ordering::Less) => {}
        _ => {
            map.insert(app, l);
        }
    }
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
}

/// GitHub "list releases" answer. Tags look like `diaframma-v1.2.0` or `launcher-v1.0.0`.
pub fn parse_github_releases(json: &str) -> Result<HashMap<String, Latest>> {
    let list: Vec<GhRelease> = serde_json::from_str(json).map_err(|e| Error::Other(format!("Unexpected answer from GitHub: {e}")))?;
    let mut out = HashMap::new();
    for r in list.into_iter().filter(|r| !r.draft && !r.prerelease) {
        let Some((app, ver)) = r.tag_name.rsplit_once("-v") else { continue };
        if parse_version(ver).is_none() || app.is_empty() {
            continue;
        }
        keep_newest(&mut out, app.to_string(), Latest { version: ver.to_string(), url: r.html_url, notes: r.body.unwrap_or_default() });
    }
    Ok(out)
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
    let m: Manifest = serde_json::from_str(json).map_err(|e| Error::Other(format!("Unexpected update file: {e}")))?;
    Ok(m.apps.into_iter().filter(|(_, a)| parse_version(&a.version).is_some()).map(|(k, a)| (k, Latest { version: a.version, url: a.url, notes: a.notes })).collect())
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
    fn status_cases() {
        let l = Latest { version: "1.1.0".into(), url: "u".into(), notes: String::new() };
        assert_eq!(status(None, Some(&l)), Status::NotInstalled);
        assert_eq!(status(Some("1.0.0"), Some(&l)), Status::Available { latest: "1.1.0".into(), url: "u".into() });
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
