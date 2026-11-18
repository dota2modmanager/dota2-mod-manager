//! The app's own log (src/app-log.ts): a small file every install keeps, so a support report does
//! not depend on reproducing the problem live. Past a megabyte the file moves aside to app.log.1
//! and a new one starts. Nothing here fails: logging is never the reason the app stops.
//!
//! The lines are also kept in memory, the newest few thousand, for the harness that compares two
//! processes' logs (test/rust-owner.test.ts) to take.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Past this size the log moves to app.log.1 and starts again.
pub const LOG_MAX_BYTES: u64 = 1024 * 1024;
/// The lines kept in memory when nobody takes them.
const KEPT: usize = 5000;

pub struct AppLog {
    file: PathBuf,
    lines: Mutex<Vec<String>>,
}

impl AppLog {
    pub fn new(user_data: &Path) -> AppLog {
        AppLog { file: user_data.join("logs").join("app.log"), lines: Mutex::new(Vec::new()) }
    }

    /// The log file.
    pub fn file(&self) -> &Path {
        &self.file
    }

    fn append(&self, text: &str) {
        let f = &self.file;
        if let Some(dir) = f.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::metadata(f).is_ok_and(|m| m.len() > LOG_MAX_BYTES) {
            let mut aside = f.clone().into_os_string();
            aside.push(".1");
            let _ = std::fs::rename(f, aside);
        }
        if let Ok(mut out) = std::fs::OpenOptions::new().create(true).append(true).open(f) {
            let _ = out.write_all(text.as_bytes());
        }
    }

    fn keep(&self, add: impl FnOnce(&mut Vec<String>)) {
        let mut l = self.lines.lock().unwrap_or_else(|e| e.into_inner());
        add(&mut l);
        let over = l.len().saturating_sub(KEPT);
        l.drain(..over);
    }

    /// One line, stamped with the time.
    pub fn push(&self, msg: &str) {
        self.append(&format!("{} {msg}\n", crate::mods_listing::iso_now()));
        self.keep(|l| l.push(msg.to_string()));
    }

    /// Several lines, in order.
    pub fn extend(&self, msgs: impl IntoIterator<Item = String>) {
        for m in msgs {
            self.push(&m);
        }
    }

    /// Lines that happened before the log existed (the start's first steps), written first.
    pub fn prepend(&self, msgs: Vec<String>) {
        let now = crate::mods_listing::iso_now();
        let text: String = msgs.iter().map(|m| format!("{now} {m}\n")).collect();
        if !text.is_empty() {
            self.append(&text);
        }
        self.keep(|l| {
            l.splice(0..0, msgs);
        });
    }

    /// The lines kept so far, emptied.
    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.lines.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_full_log_moves_aside_and_starts_again() {
        let dir = std::env::temp_dir().join(format!("mm-app-log-{}", uuid::Uuid::new_v4().simple()));
        let log = AppLog::new(&dir);
        log.push("first");
        std::fs::write(log.file(), vec![b'x'; LOG_MAX_BYTES as usize + 1]).unwrap();
        log.push("second");
        let now = std::fs::read_to_string(log.file()).unwrap();
        assert!(now.ends_with(" second\n") && !now.contains("first"));
        assert!(dir.join("logs").join("app.log.1").exists());
        log.prepend(vec!["zero".into()]);
        assert_eq!(log.take(), vec!["zero", "first", "second"]);
        assert!(log.take().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
