//! Replace a small file so that whoever reads it next finds the old contents or the new ones, never
//! half of either. Replacing src/atomic-file.ts, which tells the story (a cut-off manifest.json
//! once showed every installed mod as somebody else's file).

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::Path;
use std::time::Duration;

/// Is this the error Windows gives for a file somebody else has open for a moment?
fn busy(e: &std::io::Error) -> bool {
    e.kind() == ErrorKind::PermissionDenied || e.raw_os_error() == Some(32) // ERROR_SHARING_VIOLATION
}

/// Write `data` to `file` through a temporary file beside it. An antivirus or a backup tool holding
/// the old file makes Windows refuse the rename for a moment, so it is tried a few times; if the
/// file stays held, it is written in place rather than not written at all.
pub fn write_file_atomic(file: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut name = file.as_os_str().to_owned();
    name.push(format!(".{}.tmp", std::process::id()));
    let tmp = std::path::PathBuf::from(name);
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }
    for attempt in 0.. {
        match fs::rename(&tmp, file) {
            Ok(()) => return Ok(()),
            Err(e) if !busy(&e) => {
                let _ = fs::remove_file(&tmp);
                return Err(e);
            }
            Err(_) if attempt >= 4 => break,
            Err(_) => std::thread::sleep(Duration::from_millis(25)),
        }
    }
    let written = fs::write(file, data);
    let _ = fs::remove_file(&tmp);
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_and_leaves_nothing_beside() {
        let dir = std::env::temp_dir().join(format!("mm-atomic-{}", std::process::id()));
        let file = dir.join("a").join("x.json");
        write_file_atomic(&file, b"one").unwrap();
        write_file_atomic(&file, b"two").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"two");
        assert_eq!(fs::read_dir(file.parent().unwrap()).unwrap().count(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }
}
