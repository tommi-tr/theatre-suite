//! Launcher logic without any window code: settings, finding installed apps,
//! opening documents, covers and update checks. The Tauri layer only forwards
//! commands to these functions, so everything here is testable on its own.

pub mod covers;
pub mod detect;
pub mod launch;
pub mod net;
pub mod settings;
pub mod update_check;

pub type Result<T> = std::result::Result<T, String>;
