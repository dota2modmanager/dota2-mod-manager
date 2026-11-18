//! The signed files every installed copy fetches from main: config/app.json and
//! config/presets.json, each beside its .sig. A copy that finds a signature which does not match
//! throws the file away and keeps its last good one, quietly, so an edit committed without
//! re-signing breaks remote config for everyone without a single error a person would see.
//! #682 did exactly that by rewriting a tool path inside app.json's `_readme`: from 15 November
//! 2026 every copy logged "remote config not fetched: signature does not match".
//!
//! The fix for a failure here is almost never the test: sign the file
//! (`CATALOG_KEY=... node tools/release/rollback.mjs sign`) or put back the bytes that were signed.

use mm_core::catalog_signature::verify;
use mm_core::remote_config::CONFIG_PUBLIC_KEY;
use std::path::PathBuf;

fn repo_file(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../config").join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn assert_signed(name: &str) {
    let bytes = repo_file(name);
    let sig = String::from_utf8(repo_file(&format!("{name}.sig"))).expect("a signature is base64 text");
    assert!(
        verify(&bytes, sig.trim(), CONFIG_PUBLIC_KEY),
        "config/{name} does not match config/{name}.sig under the key the app pins: every installed copy will refuse it"
    );
}

#[test]
fn remote_config_is_signed() {
    assert_signed("app.json");
}

#[test]
fn ready_presets_are_signed() {
    assert_signed("presets.json");
}
