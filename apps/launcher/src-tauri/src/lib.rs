//! Theatre Suite launcher — native side.
//!
//! This file only forwards commands from the interface to the two crates that hold the
//! real logic (`theatre-project` and `launcher-core`), which are tested on their own.
//! The launcher writes only inside its own data folder and inside the show folders the
//! user creates or opens; it contacts the internet only for the update check the user
//! allowed (see docs/launcher/ARCHITECTURE.md).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use launcher_core::settings::Settings;
use launcher_core::{Result, covers, detect, launch, update_check};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use theatre_project::apps::{KNOWN_APPS, app_by_id};
use theatre_project::model::*;
use theatre_project::registry::{Node, Registry};
use theatre_project::{Error as ProjectError, copy, manifest, ready, registry, updates};

struct Ctx {
    settings: PathBuf,
    registry: PathBuf,
    cache: PathBuf,
    /// Serialises read-modify-write on the small files of the data folder.
    lock: Mutex<()>,
}

fn s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn load_settings(ctx: &Ctx) -> Settings {
    Settings::load(&ctx.settings)
}

fn with_registry<T>(ctx: &Ctx, f: impl FnOnce(&mut Registry) -> T) -> Result<T> {
    let _g = ctx.lock.lock().map_err(|_| "Internal error".to_string())?;
    let mut reg = Registry::load(&ctx.registry);
    let out = f(&mut reg);
    reg.save(&ctx.registry).map_err(s)?;
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    version: String,
    os: &'static str,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo { name: "Theatre Suite", version: app.package_info().version.to_string(), os: std::env::consts::OS }
}

/// A `.theatre` file given on the command line (double click on a show index): its folder.
#[tauri::command]
fn startup_show() -> Option<String> {
    std::env::args().skip(1).find(|a| a.to_lowercase().ends_with(".theatre")).and_then(|a| Path::new(&a).parent().map(|p| p.to_string_lossy().to_string()))
}

// ---------------------------------------------------------------- settings

#[tauri::command(async)]
fn settings_load(ctx: State<Ctx>) -> Result<Settings> {
    Ok(load_settings(&ctx))
}

#[tauri::command(async)]
fn settings_save(ctx: State<Ctx>, settings: Settings) -> Result<()> {
    let _g = ctx.lock.lock().map_err(|_| "Internal error".to_string())?;
    settings.save(&ctx.settings)
}

#[tauri::command(async)]
fn default_shows_dir(app: AppHandle, ctx: State<Ctx>) -> Result<String> {
    if let Some(d) = load_settings(&ctx).shows_dir.filter(|d| !d.is_empty()) {
        return Ok(d);
    }
    let docs = app.path().document_dir().map_err(s)?;
    Ok(docs.join("Theatre Suite").to_string_lossy().to_string())
}

// ------------------------------------------------------------------- shows

#[tauri::command(async)]
fn shows_list(ctx: State<Ctx>) -> Result<Vec<Node>> {
    let _g = ctx.lock.lock();
    Ok(registry::tree(&Registry::load(&ctx.registry)))
}

/// Looks inside every known show for copies that are not in the list yet (for example a copy
/// made by hand or arrived on a USB stick), and returns the updated tree.
#[tauri::command(async)]
fn shows_rescan(ctx: State<Ctx>) -> Result<Vec<Node>> {
    with_registry(&ctx, |reg| {
        let paths: Vec<String> = reg.projects.iter().map(|e| e.path.clone()).collect();
        for p in paths {
            reg.add_nested(Path::new(&p));
        }
        registry::tree(reg)
    })
}

fn unique_dir(parent: &Path, name: &str) -> PathBuf {
    let first = parent.join(name);
    if !first.exists() {
        return first;
    }
    (2..1000).map(|n| parent.join(format!("{name} {n}"))).find(|p| !p.exists()).unwrap_or(first)
}

#[tauri::command(async)]
fn show_create(ctx: State<Ctx>, title: String, subtitle: String, parent_dir: String) -> Result<String> {
    let folder = copy::sanitize_name(&title).map_err(s)?;
    let dir = unique_dir(Path::new(&parent_dir), &folder);
    manifest::create(&dir, &title, &subtitle).map_err(s)?;
    let path = dir.to_string_lossy().to_string();
    with_registry(&ctx, |reg| {
        reg.add(&path);
        reg.touch(&path);
    })?;
    Ok(path)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenResult {
    path: String,
    /// The folder has no show index (the interface may offer to adopt it).
    not_a_show: bool,
    /// The index was damaged and has been rebuilt.
    rebuilt: bool,
    /// Number of documents found in the folder.
    found_documents: usize,
}

#[tauri::command(async)]
fn show_open(ctx: State<Ctx>, path: String) -> Result<OpenResult> {
    let dir = Path::new(&path);
    match manifest::open_or_rebuild(dir) {
        Ok(o) => {
            with_registry(&ctx, |reg| {
                reg.add(&path);
                reg.add_nested(dir);
                reg.touch(&path);
            })?;
            Ok(OpenResult { path, not_a_show: false, rebuilt: o.rebuilt, found_documents: o.project.documents.len() })
        }
        Err(ProjectError::NotAProject(_)) => {
            let found = theatre_project::scan::scan_documents(dir).len();
            Ok(OpenResult { path, not_a_show: true, rebuilt: false, found_documents: found })
        }
        Err(e) => Err(s(e)),
    }
}

/// Turns an existing folder into a show: documents of known apps found inside are listed.
#[tauri::command(async)]
fn show_adopt(ctx: State<Ctx>, path: String, title: String) -> Result<String> {
    let dir = Path::new(&path);
    let t = if title.trim().is_empty() { dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() } else { title };
    manifest::create(dir, &t, "").map_err(s)?;
    with_registry(&ctx, |reg| {
        reg.add(&path);
        reg.add_nested(dir);
        reg.touch(&path);
    })?;
    Ok(path)
}

/// Takes a show off the list. The folder and its files are not touched.
#[tauri::command(async)]
fn show_forget(ctx: State<Ctx>, path: String) -> Result<()> {
    with_registry(&ctx, |reg| reg.remove(&path))
}

#[tauri::command(async)]
fn copy_size(path: String) -> u64 {
    copy::copy_size(Path::new(&path))
}

#[tauri::command(async)]
fn nested_default(path: String) -> String {
    copy::nested_parent(Path::new(&path)).to_string_lossy().to_string()
}

#[tauri::command(async)]
fn show_copy(ctx: State<Ctx>, path: String, dest_parent: String, name: String) -> Result<String> {
    let (dest, _p) = copy::copy_project(Path::new(&path), Path::new(&dest_parent), &name).map_err(s)?;
    let d = dest.to_string_lossy().to_string();
    with_registry(&ctx, |reg| {
        reg.add(&d);
        reg.touch(&d);
    })?;
    Ok(d)
}

// ---------------------------------------------------------------- project

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectView {
    path: String,
    project: Project,
    /// Does the file of each document exist? (id → bool)
    exists: HashMap<String, bool>,
    readiness: ready::Report,
    /// Documents found in the folder and just added to the list.
    added: usize,
    rebuilt: bool,
}

#[tauri::command(async)]
fn project_get(path: String) -> Result<ProjectView> {
    let dir = Path::new(&path);
    let opened = manifest::open_or_rebuild(dir).map_err(s)?;
    let mut project = opened.project;
    let added = manifest::refresh(dir, &mut project);
    if added > 0 {
        manifest::save(dir, &project).map_err(s)?;
    }
    let exists = project.documents.iter().map(|d| (d.id.clone(), ready::document_path(dir, d).is_file())).collect();
    let readiness = ready::check(dir, &project);
    Ok(ProjectView { path, project, exists, readiness, added, rebuilt: opened.rebuilt })
}

#[tauri::command(async)]
fn project_set_meta(path: String, title: String, subtitle: String) -> Result<()> {
    let dir = Path::new(&path);
    let mut p = manifest::load(dir).map_err(s)?;
    if title.trim().is_empty() {
        return Err("The title cannot be empty".into());
    }
    p.title = title.trim().to_string();
    p.subtitle = subtitle.trim().to_string();
    manifest::save(dir, &p).map_err(s)
}

/// `patch` may contain `phase` (string or null), `archived`, `inShow`, `title`.
#[tauri::command(async)]
fn document_set(path: String, doc_id: String, patch: Value) -> Result<()> {
    let dir = Path::new(&path);
    let mut p = manifest::load(dir).map_err(s)?;
    let doc = p.documents.iter_mut().find(|d| d.id == doc_id).ok_or("Document not found")?;
    if let Some(v) = patch.get("phase") {
        doc.phase = match v.as_str() {
            Some("preparation") => Some(Phase::Preparation),
            Some("rehearsals") => Some(Phase::Rehearsals),
            Some("show") => Some(Phase::Show),
            _ => None,
        };
    }
    if let Some(b) = patch.get("archived").and_then(Value::as_bool) {
        doc.archived = b;
        if b {
            doc.in_show = false;
        }
    }
    if let Some(b) = patch.get("inShow").and_then(Value::as_bool) {
        doc.in_show = b;
    }
    if let Some(t) = patch.get("title").and_then(Value::as_str).filter(|t| !t.trim().is_empty()) {
        doc.title = t.trim().to_string();
    }
    manifest::save(dir, &p).map_err(s)
}

/// Creates an empty document of an app inside the show folder and lists it.
#[tauri::command(async)]
fn document_new(path: String, app_id: String, title: String) -> Result<String> {
    let dir = Path::new(&path);
    let app = app_by_id(&app_id).ok_or("Unknown app")?;
    let template = app.new_document.ok_or("This app creates its own documents")?;
    let stem = copy::sanitize_name(&title).map_err(s)?;
    let mut file = dir.join(format!("{stem}.{}", app.new_extension));
    let mut n = 2;
    while file.exists() {
        file = dir.join(format!("{stem} {n}.{}", app.new_extension));
        n += 1;
    }
    manifest::atomic_write(&file, template.as_bytes()).map_err(s)?;
    let mut p = manifest::load(dir).map_err(s)?;
    let rel = file.strip_prefix(dir).unwrap_or(&file).to_string_lossy().replace('\\', "/");
    let idx = manifest::add_document(&mut p, &rel, Some(app.id)).ok_or("The document is already listed")?;
    p.documents[idx].title = title.trim().to_string();
    let id = p.documents[idx].id.clone();
    manifest::save(dir, &p).map_err(s)?;
    Ok(id)
}

fn program_for(ctx: &Ctx, app: &theatre_project::apps::KnownApp) -> Option<String> {
    let settings = load_settings(ctx);
    detect::find(app, settings.app_paths.get(app.id).map(String::as_str)).map(|i| i.path)
}

#[tauri::command(async)]
fn document_open(ctx: State<Ctx>, path: String, doc_id: String) -> Result<()> {
    let dir = Path::new(&path);
    let p = manifest::load(dir).map_err(s)?;
    let doc = p.documents.iter().find(|d| d.id == doc_id).ok_or("Document not found")?;
    let app = app_by_id(&doc.app).ok_or("Unknown app")?;
    let program = program_for(&ctx, app).ok_or_else(|| format!("NOT_INSTALLED:{}", app.name))?;
    let file = ready::document_path(dir, doc);
    if !file.is_file() {
        return Err(format!("MISSING:{}", doc.path));
    }
    launch::open_with(Path::new(&program), &file)
}

/// Starts an app on its own, without a document.
#[tauri::command(async)]
fn app_launch(ctx: State<Ctx>, app_id: String) -> Result<()> {
    let app = app_by_id(&app_id).ok_or("Unknown app")?;
    let program = program_for(&ctx, app).ok_or_else(|| format!("NOT_INSTALLED:{}", app.name))?;
    launch::start(Path::new(&program))
}

#[tauri::command(async)]
fn show_open_all(ctx: State<Ctx>, path: String) -> Result<launch::OpenAllReport> {
    let dir = Path::new(&path);
    let p = manifest::load(dir).map_err(s)?;
    Ok(launch::open_all(dir, &p, |app| program_for(&ctx, app), launch::open_with))
}

#[tauri::command(async)]
fn reveal(path: String) -> Result<()> {
    launch::reveal(Path::new(&path))
}

// ------------------------------------------------------------------ covers

#[tauri::command(async)]
fn cover_get(path: String) -> Option<String> {
    let dir = Path::new(&path);
    let p = manifest::load(dir).ok()?;
    let img = p.cover.image?;
    covers::data_url(&covers::image_path(dir, &img)).ok()
}

/// Reads any image the user picked, to preview it before it is resized and stored.
#[tauri::command(async)]
fn image_preview(file: String) -> Result<String> {
    covers::data_url(Path::new(&file))
}

#[tauri::command(async)]
fn cover_set_image(path: String, jpeg_base64: String, color: Option<String>) -> Result<String> {
    covers::set_image(Path::new(&path), &jpeg_base64, color)
}

#[tauri::command(async)]
fn cover_clear_image(path: String) -> Result<()> {
    covers::clear_image(Path::new(&path))
}

/// `None` goes back to the colour derived from the title.
#[tauri::command(async)]
fn cover_set_color(path: String, color: Option<String>) -> Result<()> {
    let dir = Path::new(&path);
    if let Some(c) = &color {
        let ok = c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
        if !ok {
            return Err("The colour must look like #7a2e4a".into());
        }
    }
    let mut p = manifest::load(dir).map_err(s)?;
    p.cover.color = color;
    manifest::save(dir, &p).map_err(s)
}

// -------------------------------------------------------- apps and versions

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    id: String,
    name: String,
    installed: Option<detect::Installed>,
    status: updates::Status,
    latest: Option<updates::Latest>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppsView {
    apps: Vec<AppStatus>,
    launcher: AppStatus,
    checked_at: u64,
    error: Option<String>,
}

fn apps_view(app: &AppHandle, ctx: &Ctx) -> AppsView {
    let settings = load_settings(ctx);
    let cache = update_check::Cache::load(&ctx.cache);
    let apps = KNOWN_APPS
        .iter()
        .map(|a| {
            let installed = detect::find(a, settings.app_paths.get(a.id).map(String::as_str));
            let latest = cache.latest.get(a.id).cloned();
            let status = updates::status(installed.as_ref().map(|i| i.version.as_deref().unwrap_or("")), latest.as_ref());
            AppStatus { id: a.id.into(), name: a.name.into(), installed, status, latest }
        })
        .collect();
    let me = app.package_info().version.to_string();
    let latest = cache.latest.get("launcher").cloned();
    let launcher = AppStatus {
        id: "launcher".into(),
        name: "Theatre Suite".into(),
        installed: Some(detect::Installed { path: String::new(), version: Some(me.clone()) }),
        status: updates::status(Some(&me), latest.as_ref()),
        latest,
    };
    AppsView { apps, launcher, checked_at: cache.checked_at, error: cache.error }
}

#[tauri::command(async)]
fn apps_status(app: AppHandle, ctx: State<Ctx>) -> Result<AppsView> {
    Ok(apps_view(&app, &ctx))
}

#[tauri::command(async)]
fn app_path_set(ctx: State<Ctx>, app_id: String, program: Option<String>) -> Result<()> {
    let _g = ctx.lock.lock().map_err(|_| "Internal error".to_string())?;
    let mut st = Settings::load(&ctx.settings);
    match program.filter(|p| !p.is_empty()) {
        Some(p) => {
            st.app_paths.insert(app_id, p);
        }
        None => {
            st.app_paths.remove(&app_id);
        }
    }
    st.save(&ctx.settings)
}

/// The user pressed "Check now": one request, always allowed.
#[tauri::command(async)]
fn updates_check(app: AppHandle, ctx: State<Ctx>) -> Result<AppsView> {
    let st = load_settings(&ctx);
    let cache = update_check::run(&st.update_source, &ctx.cache);
    if cache.error.is_none() {
        let _g = ctx.lock.lock();
        let mut st = Settings::load(&ctx.settings);
        st.last_check = cache.checked_at;
        let _ = st.save(&ctx.settings);
    }
    Ok(apps_view(&app, &ctx))
}

/// Called when the launcher starts: checks only if the weekly check is on and a week has passed.
/// Offline or errors are silent here (the next start tries again).
#[tauri::command(async)]
fn updates_check_if_due(app: AppHandle, ctx: State<Ctx>) -> Result<Option<AppsView>> {
    let st = load_settings(&ctx);
    // Nothing goes online before the person has read the first-run notice.
    if !st.weekly_check || !st.update_notice_seen || !update_check::is_due(st.last_check, now_secs()) {
        return Ok(None);
    }
    updates_check(app, ctx).map(Some)
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(file) = args.iter().skip(1).find(|a| a.to_lowercase().ends_with(".theatre"))
                && let Some(dir) = Path::new(file).parent()
            {
                let _ = app.emit("open-show", dir.to_string_lossy().to_string());
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create the data folder: {e}"))?;
            app.manage(Ctx { settings: dir.join("settings.json"), registry: dir.join("shows.json"), cache: dir.join("updates-cache.json"), lock: Mutex::new(()) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            startup_show,
            settings_load,
            settings_save,
            default_shows_dir,
            shows_list,
            shows_rescan,
            show_create,
            show_open,
            show_adopt,
            show_forget,
            copy_size,
            nested_default,
            show_copy,
            project_get,
            project_set_meta,
            document_set,
            document_new,
            document_open,
            show_open_all,
            app_launch,
            reveal,
            cover_get,
            image_preview,
            cover_set_image,
            cover_clear_image,
            cover_set_color,
            apps_status,
            app_path_set,
            updates_check,
            updates_check_if_due,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Theatre Suite launcher");
    app.run(|_, _| {});
}
