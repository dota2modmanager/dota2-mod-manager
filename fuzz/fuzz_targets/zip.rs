//! A mod archive: opened through the app's one door for archives, and every file in it read.
#![no_main]
use libfuzzer_sys::fuzz_target;
use mm_core::safe_zip::{OpenedZip, Source};

fuzz_target!(|data: &[u8]| {
    if let Ok(mut z) = OpenedZip::open(Source::Bytes(data.to_vec()), Some("fuzz.zip"), None) {
        for f in z.files.clone() {
            let _ = z.read(&f);
        }
    }
});
