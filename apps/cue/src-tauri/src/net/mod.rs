//! Primary/secondary link (phase 3). Protocol and rules: docs/cue/NETWORK.md.
//!
//! The network is off until the user picks a role (Settings → Collegamento); it talks only to the
//! paired computer, on the local network (TTL 1), with signed messages. Cue never touches the firewall.

pub mod addr;
pub mod crypto;
pub mod health;
pub mod link;
pub mod reliable;
pub mod store;
pub mod transfer;
pub mod wire;

mod commands;
pub use commands::*;

use std::path::Path;

pub use link::{Configure, Holder, Link, LinkConfig, LinkInfo, Outcome, Phase, SendShow, Sink};
pub use store::Role;

/// UDP: heartbeats and messages.
pub const UDP_PORT: u16 = 47810;
/// TCP: the show file.
pub const TCP_PORT: u16 = 47811;
/// `--instance n` moves both ports by 10·(n−1).
pub const INSTANCE_PORT_STEP: u16 = 10;
/// Instances a secondary looks for on 127.0.0.1 (development).
pub const DEV_INSTANCES: u16 = 5;

pub fn ports_for_instance(n: u32) -> (u16, u16) {
    let off = INSTANCE_PORT_STEP * (n.clamp(1, 99) as u16 - 1);
    (UDP_PORT + off, TCP_PORT + off)
}

/// The configuration of this process. 127.0.0.1 is accepted as the peer only with `--instance n ≥ 2`
/// or in a debug build (two instances on one computer).
pub fn config_for(instance: u32, data_dir: &Path) -> LinkConfig {
    let (udp, tcp) = ports_for_instance(instance);
    let allow_loopback = instance >= 2 || cfg!(debug_assertions);
    let discovery_ports = if allow_loopback {
        (1..=DEV_INSTANCES as u32).map(|i| ports_for_instance(i).0).filter(|p| *p != udp).collect()
    } else {
        vec![UDP_PORT]
    };
    let host = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "Cue".into());
    let default_name = if instance >= 2 { format!("{host} · {instance}") } else { host };
    LinkConfig {
        udp_port: udp,
        tcp_port: tcp,
        discovery_ports,
        allow_loopback,
        store_path: Some(data_dir.join("link.json")),
        received_dir: data_dir.join("link").join("received"),
        default_name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_ports() {
        assert_eq!(ports_for_instance(1), (47810, 47811));
        assert_eq!(ports_for_instance(2), (47820, 47821));
        let c = config_for(2, Path::new("/tmp/x"));
        assert!(c.allow_loopback);
        assert!(c.discovery_ports.contains(&47810));
        assert!(!c.discovery_ports.contains(&47820));
    }
}
