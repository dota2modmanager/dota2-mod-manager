//! A VPK from a mod archive: its directory listed both ways. A refusal is fine; a panic, a hang
//! or an allocation the input asked for is a bug.
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = mm_core::vpk::list_paths(data);
    let _ = mm_core::vpk::list_entries(data);
});
