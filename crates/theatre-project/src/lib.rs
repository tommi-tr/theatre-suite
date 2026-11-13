//! Theatre Suite — the shared model of a show project.
//!
//! A project is one folder per show with a readable JSON index
//! (`progetto.theatre`). The index lists the documents made by the suite's
//! apps; the documents themselves stay in their own formats. Everything
//! here is plain Rust without any window or system dependency, so it can be
//! tested anywhere and reused by every app.
//!
//! Principles (see docs/launcher):
//! - Unknown fields are kept when a file is read and written back, so a
//!   newer app never loses what an older launcher does not understand.
//! - Writes are atomic (temporary file + rename).
//! - A damaged index never loses documents: it is set aside and rebuilt by
//!   scanning the folder.

pub mod apps;
pub mod copy;
pub mod exports;
pub mod manifest;
pub mod model;
pub mod ready;
pub mod registry;
pub mod scan;
pub mod updates;

pub use model::*;

/// Error type shared by the crate. Messages are meant to be shown to the user.
#[derive(Debug)]
pub enum Error {
    Io(String),
    NotAProject(String),
    Damaged(String),
    TooNew { found: u32, supported: u32 },
    AlreadyExists(String),
    InvalidName(String),
    Other(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Io(m) | Error::Damaged(m) | Error::Other(m) => write!(f, "{m}"),
            Error::NotAProject(p) => write!(f, "No show project found in {p}"),
            Error::TooNew { found, supported } => write!(
                f,
                "This project was made with a newer version of the Theatre Suite (format {found}, this launcher understands up to {supported}). Update the launcher to open it."
            ),
            Error::AlreadyExists(p) => write!(f, "{p} already exists"),
            Error::InvalidName(n) => write!(f, "\"{n}\" cannot be used as a folder name"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
