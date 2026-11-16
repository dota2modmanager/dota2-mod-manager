//! Valve's text KeyValues (items_game.txt, gameinfo.gi): the first block and its children.
#![no_main]
use libfuzzer_sys::fuzz_target;
use mm_core::kv;

fuzz_target!(|data: &[u8]| {
    if let Ok(b) = kv::block_bounds(data, 0) {
        let _ = kv::children(data, b);
    }
});
