//! Keys, signatures and random values of the link.
//!
//! - Every message is signed with HMAC-SHA256 (`sign` / `verify`, constant-time comparison).
//! - Pairing: the primary shows a 6-digit code; both sides derive the **pairing key**
//!   `HMAC-SHA256(code, nonceP ‖ nonceS)` and remember it (no code at the next connection).
//! - Each connection gets a fresh **session key** `HMAC-SHA256(pairKey, "cue-session" ‖ nonceP ‖ nonceS)`,
//!   so messages of an old session can never be replayed into a new one (sequence numbers restart).
//! - Messages sent before pairing (discovery) use a fixed, public key: they carry nothing secret and
//!   nothing is decided on them alone.

use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

pub type Key = [u8; 32];
pub type Nonce = [u8; 16];

/// Key of the open (discovery) messages: public, it only detects garbage, it authenticates nothing.
pub const OPEN_KEY: &[u8] = b"theatre-suite.cue.link.open.v1";

/// HMAC-SHA256 over the concatenation of `parts`.
pub fn sign(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(key).expect("HMAC accepts keys of any length");
    for p in parts {
        mac.update(p);
    }
    mac.finalize().into_bytes().into()
}

/// Constant-time check of an HMAC-SHA256 over `data`.
pub fn verify(key: &[u8], data: &[u8], tag: &[u8]) -> bool {
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(key).expect("HMAC accepts keys of any length");
    mac.update(data);
    mac.verify_slice(tag).is_ok()
}

/// Random bytes from the operating system.
pub fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("the operating system has no random source");
    b
}

/// A new random identifier (32 hex digits).
pub fn new_id() -> String {
    to_hex(&random::<16>())
}

/// A uniformly random 6-digit code, "000000"–"999999".
pub fn pairing_code() -> String {
    // Rejection sampling: 4_294_000_000 is the largest multiple of 1_000_000 below 2^32.
    loop {
        let n = u32::from_le_bytes(random::<4>());
        if n < 4_294_000_000 {
            return format!("{:06}", n % 1_000_000);
        }
    }
}

/// The digits of a typed code ("123 456", "123-456" → "123456"); None if it is not 6 digits.
pub fn normalize_code(typed: &str) -> Option<String> {
    let digits: String = typed.chars().filter(|c| !c.is_whitespace() && *c != '-' && *c != '·').collect();
    (digits.len() == 6 && digits.chars().all(|c| c.is_ascii_digit())).then_some(digits)
}

/// The key both computers derive from the code: HMAC-SHA256(code, nonceP ‖ nonceS).
pub fn pair_key(code: &str, nonce_p: &Nonce, nonce_s: &Nonce) -> Key {
    sign(code.as_bytes(), &[nonce_p, nonce_s])
}

/// The key of one connection: HMAC-SHA256(pairKey, "cue-session" ‖ nonceP ‖ nonceS).
pub fn session_key(pair_key: &Key, nonce_p: &Nonce, nonce_s: &Nonce) -> Key {
    sign(pair_key, &[b"cue-session", nonce_p, nonce_s])
}

pub fn to_hex(bytes: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(H[(b >> 4) as usize] as char);
        s.push(H[(b & 15) as usize] as char);
    }
    s
}

pub fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let v = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    };
    s.as_bytes().chunks(2).map(|p| Some(v(p[0])? << 4 | v(p[1])?)).collect()
}

/// A fixed-size value from hex (keys, nonces).
pub fn from_hex_array<const N: usize>(s: &str) -> Option<[u8; N]> {
    from_hex(s)?.try_into().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_matches_rfc_4231_case_2() {
        let tag = sign(b"Jefe", &[b"what do ya want ", b"for nothing?"]);
        assert_eq!(to_hex(&tag), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
        assert!(verify(b"Jefe", b"what do ya want for nothing?", &tag));
        let mut bad = tag;
        bad[31] ^= 1;
        assert!(!verify(b"Jefe", b"what do ya want for nothing?", &bad));
        assert!(!verify(b"Jeff", b"what do ya want for nothing?", &tag));
        assert!(!verify(b"Jefe", b"what do ya want for nothing?", &tag[..31]));
    }

    #[test]
    fn codes_are_six_digits() {
        for _ in 0..200 {
            let c = pairing_code();
            assert_eq!(c.len(), 6);
            assert!(c.chars().all(|c| c.is_ascii_digit()));
        }
        assert_eq!(normalize_code(" 123 456 ").as_deref(), Some("123456"));
        assert_eq!(normalize_code("123-456").as_deref(), Some("123456"));
        assert_eq!(normalize_code("12345"), None);
        assert_eq!(normalize_code("12a456"), None);
    }

    #[test]
    fn keys_depend_on_code_and_both_nonces() {
        let (p, s) = (random::<16>(), random::<16>());
        let k = pair_key("123456", &p, &s);
        assert_eq!(k, pair_key("123456", &p, &s));
        assert_ne!(k, pair_key("123457", &p, &s));
        assert_ne!(k, pair_key("123456", &s, &p));
        let sk = session_key(&k, &p, &s);
        assert_ne!(sk, k);
        assert_ne!(sk, session_key(&k, &p, &random::<16>()));
    }

    #[test]
    fn hex_round_trip() {
        let b = random::<32>();
        assert_eq!(from_hex(&to_hex(&b)).unwrap(), b.to_vec());
        assert_eq!(from_hex_array::<32>(&to_hex(&b)), Some(b));
        assert_eq!(from_hex("abc"), None);
        assert_eq!(from_hex("zz"), None);
        assert_eq!(from_hex_array::<16>(&to_hex(&b)), None);
    }
}
