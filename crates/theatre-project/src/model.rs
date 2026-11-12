use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MANIFEST_FILE: &str = "progetto.theatre";
pub const FORMAT_ID: &str = "theatre.project";
/// Version of the index format. Bump only when an older launcher could misread a file.
pub const FORMAT_VERSION: u32 = 1;

/// Stage of the production a document belongs to (a label, never a rule).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Preparation,
    Rehearsals,
    Show,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cover {
    /// Image file inside the project folder (relative path), if the user chose one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    /// Colour of the show, `#rrggbb`. When absent the interface derives one from the title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// Where a copy comes from.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParentRef {
    pub id: String,
    pub title: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    /// Stable identifier: it never changes when the file is renamed or the project is copied.
    pub id: String,
    /// Identifier of the app that made it (`diaframma`, `bardo`…).
    pub app: String,
    pub title: String,
    /// Path relative to the project folder, always with `/`.
    pub path: String,
    /// Documents in the `Show` phase are the ones "Open everything for the show" opens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<Phase>,
    /// Fields written by newer versions: kept untouched.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub format: String,
    pub format_version: u32,
    pub id: String,
    pub title: String,
    /// Free line under the title: venue, season, company…
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub cover: Cover,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<ParentRef>,
    #[serde(default)]
    pub created: u64,
    #[serde(default)]
    pub updated: u64,
    #[serde(default)]
    pub documents: Vec<Document>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Project {
    pub fn new(title: &str, subtitle: &str) -> Project {
        let now = now_secs();
        Project {
            format: FORMAT_ID.into(),
            format_version: FORMAT_VERSION,
            id: new_id(),
            title: title.trim().into(),
            subtitle: subtitle.trim().into(),
            cover: Cover::default(),
            parent: None,
            created: now,
            updated: now,
            documents: vec![],
            extra: Map::new(),
        }
    }
}

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Random 128-bit identifier as 32 hex digits (no external crate needed).
pub fn new_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mut out = String::with_capacity(32);
    for salt in 0u8..2 {
        let mut h = RandomState::new().build_hasher();
        h.write_u128(nanos);
        h.write_u8(salt);
        h.write_u32(std::process::id());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}
