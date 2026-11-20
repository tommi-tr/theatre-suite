//! What the link remembers on this computer: `link.json` in Cue's data folder (per instance).
//!
//! `{ version, id, role, name?, wifiBackup, manualPeer?, firewallNoticeSeen, pairing? }` where
//! `pairing = { peerId, peerName, key }` (key: 64 hex digits). The key is the pairing key derived from the
//! code: with it the two computers reconnect without a code; "Dimentica" removes it.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::crypto;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    /// No link: the network is off (default).
    #[default]
    None,
    Primary,
    Secondary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPairing {
    pub peer_id: String,
    pub peer_name: String,
    pub key: String,
}

impl StoredPairing {
    pub fn key(&self) -> Option<crypto::Key> {
        crypto::from_hex_array(&self.key)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Stored {
    pub version: u32,
    /// This computer's id on the link (random, kept).
    pub id: String,
    pub role: Role,
    /// Name shown to the other computer; none = the computer's name.
    pub name: Option<String>,
    pub wifi_backup: bool,
    /// IPv4 address of the other computer typed by hand (when discovery finds nothing).
    pub manual_peer: Option<String>,
    /// The Windows firewall explanation was shown (it is shown before the first listen).
    pub firewall_notice_seen: bool,
    pub pairing: Option<StoredPairing>,
}

impl Default for Stored {
    fn default() -> Self {
        Self { version: 1, id: String::new(), role: Role::None, name: None, wifi_backup: false, manual_peer: None, firewall_notice_seen: false, pairing: None }
    }
}

impl Stored {
    /// Reads `link.json`; a missing or damaged file gives the defaults (a damaged one is kept aside).
    pub fn load(path: Option<&Path>) -> Stored {
        let mut s = path
            .and_then(|p| {
                let text = std::fs::read_to_string(p).ok()?;
                match serde_json::from_str::<Stored>(&text) {
                    Ok(s) => Some(s),
                    Err(_) => {
                        let _ = std::fs::rename(p, p.with_extension("damaged.json"));
                        None
                    }
                }
            })
            .unwrap_or_default();
        if s.id.len() != 32 || !s.id.chars().all(|c| c.is_ascii_hexdigit()) {
            s.id = crypto::new_id();
        }
        if s.pairing.as_ref().is_some_and(|p| p.key().is_none()) {
            s.pairing = None;
        }
        s.version = 1;
        s
    }

    pub fn save(&self, path: Option<&Path>) -> Result<(), String> {
        let Some(path) = path else { return Ok(()) };
        let json = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        crate::storage::atomic_write(path, &json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("link.json");
        let s = Stored::load(Some(&p));
        assert_eq!(s.role, Role::None);
        assert_eq!(s.id.len(), 32);
        let mut s2 = s.clone();
        s2.role = Role::Primary;
        s2.pairing = Some(StoredPairing { peer_id: "b".repeat(32), peer_name: "Regia".into(), key: "ab".repeat(32) });
        s2.save(Some(&p)).unwrap();
        assert_eq!(Stored::load(Some(&p)), s2);
        std::fs::write(&p, "{ not json").unwrap();
        let s3 = Stored::load(Some(&p));
        assert_eq!(s3.role, Role::None);
        assert!(p.with_extension("damaged.json").exists());
    }
}
