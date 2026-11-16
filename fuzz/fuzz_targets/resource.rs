//! A compiled resource from a mod (a _c file): its blocks, the files it names, and its data block
//! read as KV3, which is how the app reads particles, sounds and models.
#![no_main]
use libfuzzer_sys::fuzz_target;
use mm_core::{kv3, resource};

fuzz_target!(|data: &[u8]| {
    let _ = resource::blocks(data);
    let _ = resource::references(data);
    if let Ok(block) = resource::data_block(data) {
        let _ = kv3::read(block);
    }
    let _ = kv3::read(data);
});
