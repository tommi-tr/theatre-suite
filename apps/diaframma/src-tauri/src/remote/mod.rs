//! Connections that are OFF until the user turns them on (see 03_sicurezza_installazione.md):
//! - `ext`: a WebSocket on 127.0.0.1 only, for the Diaframma extension for Chrome;
//! - `phone`: a small web page on the local Wi-Fi, protected by an access code.

pub mod ext;
pub mod phone;

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};

/// Random code of `n` easy-to-read characters (no 0/O, 1/I).
pub fn random_code(n: usize) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut out = String::with_capacity(n);
    let mut h = RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let mut x = h.finish();
    for i in 0..n {
        if i % 10 == 9 {
            let mut h2 = RandomState::new().build_hasher();
            h2.write_u64(x);
            x = h2.finish();
        }
        out.push(ALPHABET[(x % ALPHABET.len() as u64) as usize] as char);
        x /= ALPHABET.len() as u64;
        if x == 0 {
            let mut h3 = RandomState::new().build_hasher();
            h3.write_usize(i);
            x = h3.finish();
        }
    }
    out
}
