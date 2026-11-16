//! A texture from a mod (vtex_c), decoded to pixels the way previews and recolours read it.
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = mm_core::vtex::rgba_from_vtex(data);
    let _ = mm_core::vtex::picture_from_vtex(data);
});
