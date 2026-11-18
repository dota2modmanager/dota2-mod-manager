//! A VPK index opened once for everything that reads the same file in a row (src/vpk-shared.ts).
//! Every pick of the item builder reads its models out of the game's pak01, and so do its sounds
//! and portraits. The index is large in memory, so it is let go 30 seconds after it was last
//! asked for; a changed file (size or time) is opened anew.

use std::path::Path;
use std::sync::{Arc, Mutex, Once, OnceLock};
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
    watch_idle();
    Ok(index)
}

/// A thread, started with the first index, that lets the held one go once it has idled. Without
/// it the index (~90 MB for the game's pak01) stayed until the app closed: the TypeScript let it go
/// on a timer of its own, and the Rust start had nothing in that timer's place.
fn watch_idle() {
    static STARTED: Once = Once::new();
    STARTED.call_once(|| {
        std::thread::spawn(|| loop {
            std::thread::sleep(IDLE / 2);
            release(&mut slot().lock().unwrap_or_else(|e| e.into_inner()), IDLE);
        });
    });
}

/// The held index let go when nothing has asked for it for `idle`.
fn release(held: &mut Option<Held>, idle: Duration) {
    if held.as_ref().is_some_and(|h| h.asked.elapsed() >= idle) {
        *held = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_index_asked_for_lately_stays_and_an_idle_one_goes() {
        let dir = std::env::temp_dir().join(format!("mm-vpk-shared-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("pak01_dir.vpk");
        std::fs::write(&file, crate::vpk::build(&[crate::vpk::entry_at("a/b.txt", b"x".to_vec().into())])).unwrap();
        let index = Arc::new(Index::open(&file).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
        let mut h = Some(Held { key: "k".into(), index, asked: Instant::now() });
        release(&mut h, IDLE);
        assert!(h.is_some(), "asked for a moment ago");
        release(&mut h, Duration::ZERO);
        assert!(h.is_none(), "idle for longer than the limit");
    }
}
