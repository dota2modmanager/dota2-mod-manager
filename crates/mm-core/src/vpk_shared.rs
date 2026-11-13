//! A VPK index opened once for everything that reads the same file in a row (src/vpk-shared.ts).
//! Every pick of the item builder reads its models out of the game's pak01, and so do its sounds
//! and portraits. The index is large in memory, so it is let go 30 seconds after it was last
//! asked for; a changed file (size or time) is opened anew.

use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::vpk::Index;

const IDLE: Duration = Duration::from_secs(30);

struct Held {
    key: String,
    index: Arc<Index>,
    asked: Instant,
}

fn slot() -> &'static Mutex<Option<Held>> {
    static S: OnceLock<Mutex<Option<Held>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

fn key_of(p: &Path) -> std::io::Result<String> {
    let m = std::fs::metadata(p)?;
    let t = crate::terrain_age::mtime_ms(p).unwrap_or(0.0);
    Ok(format!("{}|{}|{}", p.to_string_lossy(), m.len(), crate::js::number(t)))
}

/// The index at `dir_path`, the one opened before when the file has not changed.
pub fn shared_index(dir_path: &Path) -> crate::vpk::Result<Arc<Index>> {
    let key = key_of(dir_path)?;
    {
        let mut held = slot().lock().unwrap_or_else(|e| e.into_inner());
        if let Some(h) = held.as_mut().filter(|h| h.key == key && h.asked.elapsed() < IDLE) {
            h.asked = Instant::now();
            return Ok(h.index.clone());
        }
        // let the old one go before the new one is read: two of them do not fit well
        *held = None;
    }
    let index = Arc::new(Index::open(dir_path)?);
    *slot().lock().unwrap_or_else(|e| e.into_inner()) = Some(Held { key, index: index.clone(), asked: Instant::now() });
    Ok(index)
}

/// Let the held index go once it has idled (a caller with a timer: the shell).
pub fn release_idle() {
    let mut held = slot().lock().unwrap_or_else(|e| e.into_inner());
    if held.as_ref().is_some_and(|h| h.asked.elapsed() >= IDLE) {
        *held = None;
    }
}
