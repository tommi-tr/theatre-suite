use crate::net::fetch_text;
use crate::settings::UpdateSource;
use crate::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use theatre_project::manifest::atomic_write;
use theatre_project::model::now_secs;
use theatre_project::updates::{Latest, parse_github_releases, parse_manifest};

pub const WEEK_SECS: u64 = 7 * 24 * 3600;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Cache {
    pub checked_at: u64,
    pub latest: HashMap<String, Latest>,
    /// Why the last attempt failed (shown quietly; offline is normal).
    pub error: Option<String>,
}

impl Cache {
    pub fn load(file: &Path) -> Cache {
        std::fs::read_to_string(file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
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
                && parts.iter().all(|p| !p.is_empty() && !p.starts_with('.') && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')));
            if !ok {
                return Err("The GitHub address must look like owner/repository".into());
            }
            Ok(format!("https://api.github.com/repos/{v}/releases?per_page=50"))
        }
        "url" => Ok(source.value.trim().to_string()),
        other => Err(format!("Unknown update source: {other}")),
    }
}

/// Fetches the newest version of every app. Does a network request: call it only
/// when the user asked or the weekly check is on.
pub fn check(source: &UpdateSource) -> Result<HashMap<String, Latest>> {
    let url = url_for(source)?;
    let text = fetch_text(&url, 4 * 1024 * 1024)?;
    let parsed = if source.kind == "github" { parse_github_releases(&text) } else { parse_manifest(&text) };
    parsed.map_err(|e| e.to_string())
}

/// Runs a check and stores the result next to the previous one. On failure the old
/// list is kept and the reason is recorded.
pub fn run(source: &UpdateSource, cache_file: &Path) -> Cache {
    let mut cache = Cache::load(cache_file);
    match check(source) {
        Ok(latest) => {
            cache.latest = latest;
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
        let gh = |v: &str| UpdateSource { kind: "github".into(), value: v.into() };
        assert!(url_for(&gh("tommi-tr/theatre-suite")).unwrap().starts_with("https://api.github.com/repos/tommi-tr/theatre-suite/"));
        assert!(url_for(&gh("../etc")).is_err());
        assert!(url_for(&gh("a/b/c")).is_err());
        assert!(fetch_text("http://example.com/x", 10).is_err());
    }
}
