//! The apps of the suite the launcher knows about. Adding an app = adding a row.

#[derive(Debug, Clone, Copy)]
pub struct KnownApp {
    pub id: &'static str,
    pub name: &'static str,
    /// File extensions (lower case, no dot) of the documents the app makes.
    pub extensions: &'static [&'static str],
    /// Can the app keep several documents open at once?
    pub multi_document: bool,
    /// Name of the program file on Windows, used to find an installed copy.
    pub exe: &'static str,
    /// Content of a new empty document, when the launcher can create one itself.
    pub new_document: Option<&'static str>,
    /// File extension for a new document (when `new_document` is set).
    pub new_extension: &'static str,
}

/// An empty cue list in Diaframma's current format (3; `FORMAT_VERSION` in
/// `apps/diaframma/src/state/types.ts`). Until the suite is published Diaframma reads only
/// its current format, so this number must change together with Diaframma's.
const DIAFRAMMA_EMPTY: &str = r#"{
  "format": "diaframma.cuelist",
  "formatVersion": 3,
  "app": { "name": "Diaframma", "version": "0.0.0" },
  "tracks": []
}
"#;

/// Bardo's file format (`FILE_FORMAT_VERSION` in `apps/bardo/src/model/file.ts`). Bardo fills
/// every missing field with its defaults, so title and language are enough.
const BARDO_FORMAT_VERSION: u32 = 1;

/// Text of a new empty document of `app`, titled `title`; `None` if the launcher cannot make one.
pub fn new_document_text(app: &KnownApp, title: &str) -> Option<String> {
    match app.id {
        "bardo" => {
            let v = serde_json::json!({
                "format": "bardo",
                "formatVersion": BARDO_FORMAT_VERSION,
                "app": "Bardo",
                "savedAt": "",
                "data": { "lang": "it", "meta": { "title": title.trim() } },
                "content": [],
                "versions": []
            });
            serde_json::to_string_pretty(&v).ok()
        }
        _ => app.new_document.map(str::to_string),
    }
}

pub const KNOWN_APPS: &[KnownApp] = &[
    KnownApp {
        id: "diaframma",
        name: "Diaframma",
        extensions: &["diaframma"],
        multi_document: false,
        exe: "Diaframma.exe",
        new_document: Some(DIAFRAMMA_EMPTY),
        new_extension: "diaframma",
    },
    KnownApp {
        id: "bardo",
        name: "Bardo",
        extensions: &["bardo"],
        multi_document: false,
        exe: "Bardo.exe",
        new_document: None,
        new_extension: "bardo",
    },
];

pub fn app_for_extension(ext: &str) -> Option<&'static KnownApp> {
    let ext = ext.to_ascii_lowercase();
    KNOWN_APPS
        .iter()
        .find(|a| a.extensions.contains(&ext.as_str()))
}

pub fn app_by_id(id: &str) -> Option<&'static KnownApp> {
    KNOWN_APPS.iter().find(|a| a.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_bardo_document_carries_the_title() {
        let text = new_document_text(app_by_id("bardo").unwrap(), " Amleto \"2\" ").unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["format"], "bardo");
        assert_eq!(v["formatVersion"], 1);
        assert_eq!(v["data"]["meta"]["title"], "Amleto \"2\"");
        assert!(v["content"].as_array().unwrap().is_empty());
    }

    #[test]
    fn new_diaframma_document_is_valid_json_in_the_current_format() {
        let text = app_by_id("diaframma").unwrap().new_document.unwrap();
        let v: serde_json::Value = serde_json::from_str(text).unwrap();
        assert_eq!(v["format"], "diaframma.cuelist");
        // Must match FORMAT_VERSION in apps/diaframma/src/state/types.ts.
        assert_eq!(v["formatVersion"], 3);
        assert!(v["tracks"].as_array().unwrap().is_empty());
    }
}
