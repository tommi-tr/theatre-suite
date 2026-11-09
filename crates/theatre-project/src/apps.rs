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

/// An empty cue list in Diaframma's format 2 (see docs/diaframma/ARCHITECTURE.md).
const DIAFRAMMA_EMPTY: &str = r#"{
  "format": "diaframma.cuelist",
  "formatVersion": 2,
  "app": { "name": "Diaframma", "version": "0.0.0" },
  "tracks": []
}
"#;

pub const KNOWN_APPS: &[KnownApp] = &[
    KnownApp { id: "diaframma", name: "Diaframma", extensions: &["diaframma"], multi_document: false, exe: "Diaframma.exe", new_document: Some(DIAFRAMMA_EMPTY), new_extension: "diaframma" },
    KnownApp { id: "bardo", name: "Bardo", extensions: &["bardo"], multi_document: false, exe: "Bardo.exe", new_document: None, new_extension: "bardo" },
];

pub fn app_for_extension(ext: &str) -> Option<&'static KnownApp> {
    let ext = ext.to_ascii_lowercase();
    KNOWN_APPS.iter().find(|a| a.extensions.contains(&ext.as_str()))
}

pub fn app_by_id(id: &str) -> Option<&'static KnownApp> {
    KNOWN_APPS.iter().find(|a| a.id == id)
}
