//! Room on the disk, checked before a mod is written (issue #426), replacing src/disk-space.ts.
//! A disk that fills up halfway through a pak leaves the change to roll back and the user with
//! an error about a file they never heard of; asking first says what is wrong in megabytes.

use std::path::Path;

use serde_json::json;

use crate::i18n::t;

/// Kept free on top of what the write needs: the journal's copies and the OS's own work.
pub const SPACE_MARGIN: u64 = 64 * 1024 * 1024;

/// Free bytes on the drive that holds `dir`, asking the nearest folder above it that exists.
pub fn free_bytes(dir: &Path) -> Option<u64> {
    let mut at = crate::safe_zip::resolve(dir);
    loop {
        if let Ok(n) = fs4::available_space(&at) {
            return Some(n);
        }
        match at.parent() {
            Some(up) if up != at => at = up.to_path_buf(),
            _ => return None,
        }
    }
}

/// Refuse before writing when `dir`'s drive has less than `need` bytes plus the margin.
/// `free` stands in for the drive (tests); a drive that cannot be asked is let through.
pub fn ensure_space(dir: &Path, need: u64, free: Option<Option<u64>>) -> Result<(), String> {
    let Some(free) = free.unwrap_or_else(|| free_bytes(dir)) else { return Ok(()) };
    let short = (need + SPACE_MARGIN) as i128 - free as i128;
    if short > 0 {
        let mb = ((short as f64) / (1024.0 * 1024.0)).ceil().max(1.0) as u64;
        return Err(t("Не хватает места на диске: освободи ещё {0} МБ", &[json!(mb)]));
    }
    Ok(())
}
