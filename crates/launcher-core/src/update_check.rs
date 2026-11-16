use crate::Result;
use crate::net::fetch_text;
use crate::settings::UpdateSource;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use theatre_project::manifest::atomic_write;
use theatre_project::model::now_secs;
use theatre_project::updates::{
    Latest, Release, keep_newest, parse_github_all, parse_manifest, sort_releases,
};

pub const WEEK_SECS: u64 = 7 * 24 * 3600;

/// Public repository whose releases carry the installers and are read by the check.
/// Reading releases needs no account only when the repository is public: the code
/// repository may stay private while the installers are published here.
pub const PUBLIC_RELEASES_REPO: &str = "tommi-tr/theatre-suite-releases";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Cache {
    pub checked_at: u64,
    pub latest: HashMap<String, Latest>,
    /// Every published version of each app, newest first (to install an older one too).
    pub releases: HashMap<String, Vec<Release>>,
    /// Why the last attempt failed (shown quietly; offline is normal).
    pub error: Option<String>,
}

impl Cache {
    pub fn load(file: &Path) -> Cache {
        std::fs::read_to_string(file)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }
    pub fn save(&self, file: &Path) -> Result<()> {
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        atomic_write(file, text.as_bytes()).map_err(|e| e.to_string())
    }
}

/// Is a weekly check due? `last` = seconds of the last successful check.
pub fn is_due(last: u64, now: u64) -> bool {
    last == 0 || now.saturating_sub(last) >= WEEK_SECS
}

pub fn url_for(source: &UpdateSource) -> Result<String> {
    match source.kind.as_str() {
        "github" => {
            let v = source.value.trim();
            let parts: Vec<&str> = v.split('/').collect();
            let ok = parts.len() == 2
                && parts.iter().all(|p| {
                    !p.is_empty()
                        && !p.starts_with('.')
                        && p.chars()
                            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                });
            if !ok {
                return Err("The GitHub address must look like owner/repository".into());
            }
            Ok(format!(
                "https://api.github.com/repos/{v}/releases?per_page=50"
            ))
        }
        "url" => Ok(source.value.trim().to_string()),
        other => Err(format!("Unknown update source: {other}")),
    }
}

/// The places to look, in order: the one in the settings, then the public releases
/// repository (so the check also works when the code repository is private).
pub fn sources_for(source: &UpdateSource) -> Vec<UpdateSource> {
    let mut list = vec![source.clone()];
    let fallback = UpdateSource {
        kind: "github".into(),
        value: PUBLIC_RELEASES_REPO.into(),
    };
    if !(source.kind == "github"
        && source
            .value
            .trim()
            .eq_ignore_ascii_case(PUBLIC_RELEASES_REPO))
    {
        list.push(fallback);
    }
    list
}

fn check_one(source: &UpdateSource) -> Result<HashMap<String, Vec<Release>>> {
    let url = url_for(source)?;
    let text = fetch_text(&url, 8 * 1024 * 1024)?;
    if source.kind == "github" {
        parse_github_all(&text).map_err(|e| e.to_string())
    } else {
        let m = parse_manifest(&text).map_err(|e| e.to_string())?;
        Ok(m.into_iter()
            .map(|(k, l)| {
                (
                    k,
                    vec![Release {
                        version: l.version,
                        url: l.url,
                        notes: l.notes,
                        published: String::new(),
                        installer: None,
                    }],
                )
            })
            .collect())
    }
}

/// The newest version of each app in a list of releases.
pub fn newest(releases: &HashMap<String, Vec<Release>>) -> HashMap<String, Latest> {
    let mut out = HashMap::new();
    for (app, list) in releases {
        for r in list {
            keep_newest(&mut out, app.clone(), r.latest());
        }
    }
    out
}

/// Fetches the newest version of every app from every source that answers, keeping the
/// newest of each. It fails only if no source answered (the first reason is reported).
/// Does a network request: call it only when the user asked or the weekly check is on.
pub fn check(source: &UpdateSource) -> Result<HashMap<String, Vec<Release>>> {
    let mut merged: HashMap<String, Vec<Release>> = HashMap::new();
    let mut first_error: Option<String> = None;
    let mut answered = false;
    for src in sources_for(source) {
        match check_one(&src) {
            Ok(found) => {
                answered = true;
                for (app, list) in found {
                    merged.entry(app).or_default().extend(list);
                }
            }
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    for v in merged.values_mut() {
        sort_releases(v);
    }
    if answered {
        Ok(merged)
    } else {
        Err(first_error.unwrap_or_else(|| "NOT_FOUND".into()))
    }
}

/// Runs a check and stores the result next to the previous one. On failure the old
/// list is kept and the reason is recorded.
pub fn run(source: &UpdateSource, cache_file: &Path) -> Cache {
    let mut cache = Cache::load(cache_file);
    match check(source) {
        Ok(releases) => {
            cache.latest = newest(&releases);
            cache.releases = releases;
            cache.checked_at = now_secs();
            cache.error = None;
        }
        Err(e) => cache.error = Some(e),
    }
    let _ = cache.save(cache_file);
    cache
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weekly_rule() {
        assert!(is_due(0, 100));
        assert!(!is_due(1000, 1000 + WEEK_SECS - 1));
        assert!(is_due(1000, 1000 + WEEK_SECS));
    }

    #[test]
    fn sources_are_checked() {
        let gh = |v: &str| UpdateSource {
            kind: "github".into(),
            value: v.into(),
        };
        assert!(
            url_for(&gh("tommi-tr/theatre-suite"))
                .unwrap()
                .starts_with("https://api.github.com/repos/tommi-tr/theatre-suite/")
        );
        assert!(url_for(&gh("../etc")).is_err());
        assert!(url_for(&gh("a/b/c")).is_err());
        assert!(fetch_text("http://example.com/x", 10).is_err());
    }

    #[test]
    fn the_public_releases_repository_is_always_a_fallback() {
        let gh = |v: &str| UpdateSource {
            kind: "github".into(),
            value: v.into(),
        };
        let l = sources_for(&gh("tommi-tr/theatre-suite"));
        assert_eq!(l.len(), 2);
        assert_eq!(l[1].value, PUBLIC_RELEASES_REPO);
        assert_eq!(sources_for(&gh(PUBLIC_RELEASES_REPO)).len(), 1);
        let own = UpdateSource {
            kind: "url".into(),
            value: "https://example.org/u.json".into(),
        };
        assert_eq!(sources_for(&own).len(), 2);
    }
}
