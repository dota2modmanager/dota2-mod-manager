//! Bytes under a folder: the number Settings shows beside each cache, and the one the removal
//! window shows beside the app's data (src/folder-size.ts). It counts what it can read and skips
//! what it cannot, a file gone between the listing and the look included.

use std::path::Path;

/// Bytes under a folder, however deep. A folder that is not there holds nothing.
pub fn folder_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    let mut bytes = 0;
    for e in entries.flatten() {
        let full = e.path();
        // a link to a folder is not walked, as Dirent.isDirectory() says no to it
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            bytes += folder_size(&full);
        } else if let Ok(m) = std::fs::metadata(&full) {
            bytes += m.len();
        }
    }
    bytes
}
