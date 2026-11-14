//! Making the catalog's own author the only person who can change the catalog
//! (src/catalog-signature.ts).
//!
//! The catalog files can arrive through public proxies, and a proxy is a stranger handing over
//! bytes that claim to be GitHub's. The author signs each file with an ed25519 key only they hold
//! and publishes `<name>.sig` beside it; the app checks against the public key pinned here.
//! Without a key this answers "nothing pinned, carry on".

use ed25519_dalek::{Signature, Verifier, VerifyingKey};

/// Base64 SPKI of the catalog author's ed25519 public key; empty means verification is off.
pub const CATALOG_PUBLIC_KEY: &str = "MCowBQYDK2VwAyEAkzP+iIJLaFlc20Uj3OyLnDX4arckiBuSpPk1BcRKUsk=";
pub const SIG_DIR: &str = "assets/signatures";
pub const SIG_SUFFIX: &str = ".sig";

/// The DER header of an ed25519 SubjectPublicKeyInfo; the 32 bytes of the key follow it.
const SPKI_PREFIX: [u8; 12] = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];

/// Is there a key to check against at all?
pub fn configured(key: &str) -> bool {
    !crate::js::trim(key).is_empty()
}

/// Whether `signature_b64` is this key's signature over `payload`. A malformed key or signature
/// is a failed check, never a passed one.
pub fn verify(payload: &[u8], signature_b64: &str, key: &str) -> bool {
    if !configured(key) {
        return true;
    }
    let der = crate::js::base64_decode(crate::js::trim(key));
    let Some(raw) = der.strip_prefix(&SPKI_PREFIX[..]).filter(|r| r.len() == 32) else { return false };
    let Ok(pub_key) = VerifyingKey::from_bytes(raw.try_into().unwrap()) else { return false };
    let sig = crate::js::base64_decode(crate::js::trim(signature_b64));
    let Ok(sig) = Signature::from_slice(&sig) else { return false };
    pub_key.verify(payload, &sig).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_key_lets_everything_through_and_a_bad_signature_fails() {
        assert!(verify(b"x", "", " "));
        assert!(!verify(b"x", "", CATALOG_PUBLIC_KEY));
        assert!(!verify(b"x", "AAAA", CATALOG_PUBLIC_KEY));
        assert!(!verify(b"x", &"A".repeat(88), CATALOG_PUBLIC_KEY));
        assert!(!verify(b"x", &"A".repeat(88), "not a key"));
    }
}
