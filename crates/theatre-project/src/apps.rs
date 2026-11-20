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

/// Cantinella's file format (`FILE_FORMAT_VERSION` in `apps/cantinella/src/model/types.ts`).
/// Cantinella gives every missing field its default, so the title is enough.
const CANTINELLA_FORMAT_VERSION: u32 = 1;

/// Cue's file format (`.tcue`, a zip whose `show.json` carries this number; see `docs/cue/WORKPLAN.md`).
const CUE_FORMAT_VERSION: u32 = 1;

/// A random UUID version 4 (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`), built on `new_id`'s randomness.
fn new_uuid_v4() -> String {
    let mut b = [0u8; 16];
    let hex = crate::model::new_id();
    for (i, byte) in b.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(0);
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

/// A new empty Cue document: a zip archive holding only `show.json`.
fn new_cue_document(title: &str) -> Option<Vec<u8>> {
    use std::io::Write;
    let v = serde_json::json!({
        "format": "theatre.cue",
        "formatVersion": CUE_FORMAT_VERSION,
        "id": new_uuid_v4(),
        "title": title.trim()
    });
    let json = serde_json::to_string_pretty(&v).ok()?;
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("show.json", opts).ok()?;
    zip.write_all(json.as_bytes()).ok()?;
    Some(zip.finish().ok()?.into_inner())
}

/// Bytes of a new empty document of `app`, titled `title`; `None` if the launcher cannot make one.
/// Text formats come from `new_document_text`; Cue's `.tcue` is a zip archive.
pub fn new_document_bytes(app: &KnownApp, title: &str) -> Option<Vec<u8>> {
    match app.id {
        "cue" => new_cue_document(title),
        _ => new_document_text(app, title).map(String::into_bytes),
    }
}

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
        "cantinella" => {
            let v = serde_json::json!({
                "format": "cantinella",
                "formatVersion": CANTINELLA_FORMAT_VERSION,
                "app": { "name": "Theatre Suite", "version": env!("CARGO_PKG_VERSION") },
                "savedAt": "",
                "data": { "title": title.trim(), "people": [] }
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
    KnownApp {
        id: "cantinella",
        name: "Cantinella",
        extensions: &["cantinella"],
        multi_document: false,
        exe: "Cantinella.exe",
        new_document: None,
        new_extension: "cantinella",
    },
    KnownApp {
        id: "cue",
        name: "Cue",
        extensions: &["tcue"],
        multi_document: false,
        exe: "Cue.exe",
        new_document: None,
        new_extension: "tcue",
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
    fn new_cantinella_document_is_in_the_current_format() {
        let app = app_by_id("cantinella").unwrap();
        assert_eq!(app_for_extension("CANTINELLA").unwrap().id, "cantinella");
        let text = new_document_text(app, " Produzione ").unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["format"], "cantinella");
        // Must match FILE_FORMAT_VERSION in apps/cantinella/src/model/types.ts.
        assert_eq!(v["formatVersion"], 1);
        assert_eq!(v["data"]["title"], "Produzione");
        assert!(v["data"]["people"].as_array().unwrap().is_empty());
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

    #[test]
    fn new_cue_document_is_a_zip_with_only_show_json() {
        use std::io::Read;
        let app = app_by_id("cue").unwrap();
        assert_eq!(app_for_extension("TCUE").unwrap().id, "cue");
        let bytes = new_document_bytes(app, " La locandiera ").unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        assert_eq!(zip.len(), 1);
        let mut text = String::new();
        zip.by_name("show.json").unwrap().read_to_string(&mut text).unwrap();
        assert!(text.contains('\n'), "pretty-printed");
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["format"], "theatre.cue");
        assert_eq!(v["formatVersion"], 1);
        assert_eq!(v["title"], "La locandiera");
        let id = v["id"].as_str().unwrap();
        assert_eq!(id.len(), 36);
        assert_eq!(id.as_bytes()[14], b'4');
        assert!(matches!(id.as_bytes()[19], b'8' | b'9' | b'a' | b'b'));
        let other = new_document_bytes(app, "x").unwrap();
        let mut z2 = zip::ZipArchive::new(std::io::Cursor::new(other)).unwrap();
        let mut t2 = String::new();
        z2.by_name("show.json").unwrap().read_to_string(&mut t2).unwrap();
        assert_ne!(serde_json::from_str::<serde_json::Value>(&t2).unwrap()["id"], v["id"]);
    }
}
