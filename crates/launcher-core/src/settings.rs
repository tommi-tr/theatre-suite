use crate::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use theatre_project::manifest::atomic_write;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSource {
    /// `github` (value = `owner/repo`, reads the public releases) or `url` (value = address of an update file).
    pub kind: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// `it` or `en`.
    pub language: String,
    /// `dark`, `light` or `system`.
    pub theme: String,
    /// Look for news once a week (only tells; installing is always the user's choice).
    pub weekly_check: bool,
    pub update_source: UpdateSource,
    /// Folder chosen by hand for an app the launcher could not find (app id → program path).
    pub app_paths: HashMap<String, String>,
    /// Seconds since 1970 of the last successful check.
    pub last_check: u64,
    pub update_notice_seen: bool,
    /// Where new shows are created.
    pub shows_dir: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            language: "it".into(),
            theme: "system".into(),
            weekly_check: true,
            update_source: UpdateSource { kind: "github".into(), value: crate::update_check::PUBLIC_RELEASES_REPO.into() },
            app_paths: HashMap::new(),
            last_check: 0,
            update_notice_seen: false,
            shows_dir: None,
        }
    }
}

impl Settings {
    /// A missing or damaged file gives the defaults (a damaged one is kept aside).
    pub fn load(file: &Path) -> Settings {
        match std::fs::read_to_string(file) {
            Ok(t) => serde_json::from_str(&t).unwrap_or_else(|_| {
                let _ = std::fs::rename(file, file.with_extension("json.damaged"));
                Settings::default()
            }),
            Err(_) => Settings::default(),
        }
    }

    pub fn save(&self, file: &Path) -> Result<()> {
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        atomic_write(file, text.as_bytes()).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_partial_files() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("settings.json");
        assert_eq!(Settings::load(&f), Settings::default());
        std::fs::write(&f, r#"{"language":"en","somethingNew":1}"#).unwrap();
        let s = Settings::load(&f);
        assert_eq!(s.language, "en");
        assert!(s.weekly_check);
        s.save(&f).unwrap();
        std::fs::write(&f, "garbage").unwrap();
        assert_eq!(Settings::load(&f), Settings::default());
        assert!(d.path().join("settings.json.damaged").is_file());
    }
}
