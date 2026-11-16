//! KV3 blocks from mods, read the way the app reads particles, models and sounds: a block that
//! lies about its sizes is refused, and nothing is reserved on its word first.

use mm_core::kv3;

// libFuzzer, 2026-11-16: 59 bytes claiming 0x48000000 strings. The reader reserved room for all
// of them before reading one, 29 GB, and a failed allocation ends the process: a mod carrying this
// would have closed the app.
#[test]
fn a_string_count_the_block_cannot_hold_is_refused_before_anything_is_reserved() {
    let block = [
        1u8, 51, 86, 75, 1, 0, 0, 48, 0, 0, 0, 28, 1, 0, 0, 0, 0, 59, 8, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
        0, 59, 8, 1, 0, 0, 0, 0, 0, 72, 72, 45, 250, 250, 0, 0, 0, 0, 0, 0, 0, 0, 0, 215,
    ];
    assert!(kv3::read(&block).is_err());
}
