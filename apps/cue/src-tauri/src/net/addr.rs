//! Which addresses the link may talk to, and where the secondary looks for the primary.
//!
//! Only IPv4 addresses of a local network: link-local 169.254.x.x (a direct cable), the private ranges
//! 10/8, 172.16/12, 192.168/16, and 127.0.0.1 for two instances on one computer (development only).
//! Datagrams are sent with TTL 1, so they never cross a router.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

/// Is `ip` an address of the local network the link may talk to?
pub fn allowed(ip: IpAddr, allow_loopback: bool) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_link_local() || v4.is_private() || (allow_loopback && v4.is_loopback()),
        IpAddr::V6(_) => false,
    }
}

/// Rank of a path to the peer: 0 = the cable (link-local, typed by hand, or loopback in development),
/// 1 = another local network (the Wi-Fi backup).
pub fn rank(ip: IpAddr, manual: Option<Ipv4Addr>) -> u8 {
    match ip {
        IpAddr::V4(v4) if v4.is_link_local() || v4.is_loopback() || Some(v4) == manual => 0,
        _ => 1,
    }
}

/// The broadcast address of every IPv4 interface that is up (link-local first), as the secondary's
/// HELLO targets. Loopback interfaces are skipped (handled by `allow_loopback`).
pub fn broadcast_addresses() -> Vec<Ipv4Addr> {
    let mut out: Vec<(u8, Ipv4Addr)> = Vec::new();
    if let Ok(list) = if_addrs::get_if_addrs() {
        for itf in list {
            if itf.is_loopback() || !itf.is_oper_up() {
                continue;
            }
            if let if_addrs::IfAddr::V4(v4) = &itf.addr {
                let b = v4.broadcast.unwrap_or_else(|| Ipv4Addr::from(u32::from(v4.ip) | !u32::from(v4.netmask)));
                if !allowed(IpAddr::V4(v4.ip), false) {
                    continue;
                }
                let r = if v4.ip.is_link_local() { 0 } else { 1 };
                if !out.iter().any(|(_, a)| *a == b) {
                    out.push((r, b));
                }
            }
        }
    }
    out.sort_by_key(|(r, _)| *r);
    out.into_iter().map(|(_, a)| a).collect()
}

/// Where the secondary sends HELLO: every interface's broadcast address, the address typed by hand,
/// and 127.0.0.1 when two instances share one computer; each on every port a primary may listen on.
pub fn discovery_targets(ports: &[u16], manual: Option<Ipv4Addr>, allow_loopback: bool, broadcasts: &[Ipv4Addr]) -> Vec<SocketAddr> {
    let mut ips: Vec<Ipv4Addr> = Vec::new();
    if let Some(m) = manual {
        ips.push(m);
    }
    if allow_loopback {
        ips.push(Ipv4Addr::LOCALHOST);
    }
    ips.extend_from_slice(broadcasts);
    let mut out = Vec::new();
    for ip in ips {
        for p in ports {
            let a = SocketAddr::new(IpAddr::V4(ip), *p);
            if !out.contains(&a) {
                out.push(a);
            }
        }
    }
    out
}

pub fn parse_manual(s: Option<&str>) -> Option<Ipv4Addr> {
    let ip: Ipv4Addr = s?.trim().parse().ok()?;
    allowed(IpAddr::V4(ip), false).then_some(ip)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn only_local_networks() {
        assert!(allowed(ip("169.254.10.2"), false));
        assert!(allowed(ip("192.168.1.20"), false));
        assert!(allowed(ip("10.0.0.5"), false));
        assert!(allowed(ip("172.20.0.5"), false));
        assert!(!allowed(ip("8.8.8.8"), false));
        assert!(!allowed(ip("127.0.0.1"), false));
        assert!(allowed(ip("127.0.0.1"), true));
        assert!(!allowed(ip("::1"), true));
        assert!(!allowed(ip("224.0.0.1"), false));
    }

    #[test]
    fn cable_ranks_first() {
        assert_eq!(rank(ip("169.254.3.4"), None), 0);
        assert_eq!(rank(ip("127.0.0.1"), None), 0);
        assert_eq!(rank(ip("192.168.1.9"), None), 1);
        assert_eq!(rank(ip("192.168.1.9"), Some("192.168.1.9".parse().unwrap())), 0);
    }

    #[test]
    fn targets() {
        let t = discovery_targets(&[47810, 47820], Some("10.0.0.2".parse().unwrap()), true, &["169.254.255.255".parse().unwrap()]);
        assert_eq!(t.len(), 6);
        assert_eq!(t[0], "10.0.0.2:47810".parse().unwrap());
        assert_eq!(t[2], "127.0.0.1:47810".parse().unwrap());
        assert_eq!(parse_manual(Some(" 169.254.1.2 ")), Some("169.254.1.2".parse().unwrap()));
        assert_eq!(parse_manual(Some("8.8.8.8")), None);
        assert_eq!(parse_manual(Some("nope")), None);
    }
}
