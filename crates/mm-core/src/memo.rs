//! What a module keeps for the last table it was asked about, as the TypeScript keeps a cache per
//! text: here a table is told apart by its length and CRC, cheap next to reading it again.

use std::sync::{Arc, Mutex};

/// A slot holding the answer for one text.
pub type Slot<T> = Mutex<Option<(usize, u32, Arc<T>)>>;

/// `make(text)`, or what it gave last time for the same text.
pub fn per_text<T, E>(slot: &Slot<T>, text: &[u8], make: impl FnOnce(&[u8]) -> Result<T, E>) -> Result<Arc<T>, E> {
    let crc = crc32fast::hash(text);
    if let Some((len, c, v)) = slot.lock().unwrap().as_ref() {
        if *len == text.len() && *c == crc {
            return Ok(v.clone());
        }
    }
    let v = Arc::new(make(text)?);
    *slot.lock().unwrap() = Some((text.len(), crc, v.clone()));
    Ok(v)
}
