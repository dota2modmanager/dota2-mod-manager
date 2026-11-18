//! An answer too big for one message (src/large-answer.ts). A model of 787 MB once ended the
//! Electron main process with nothing to catch, so the big pieces of an answer stay here: the
//! answer names each one, and the window fetches it in slices.

use std::collections::HashMap;

use base64::Engine;
use serde_json::{json, Map, Value};

const SMALLEST: usize = 1024 * 1024;
const SLICE: usize = 32 * 1024 * 1024;
/// a window that was reloaded halfway never asks for the rest
const KEEP_MS: f64 = 5.0 * 60.0 * 1000.0;

/// The pieces held for one channel's answers.
#[derive(Default)]
pub struct LargeAnswers {
    held: HashMap<u64, (Vec<u8>, f64)>,
    next: u64,
}

fn b64_len(s: &str) -> usize {
    let pad = s.bytes().rev().take_while(|b| *b == b'=').count();
    (s.len() / 4) * 3 - pad.min(2)
}

impl LargeAnswers {
    fn hold(&mut self, bytes: Vec<u8>, text: bool, now: f64) -> Value {
        self.next += 1;
        let id = self.next;
        let size = bytes.len();
        self.held.insert(id, (bytes, now));
        json!({ "$large": id, "size": size, "text": text })
    }

    fn pack_value(&mut self, v: Value, now: f64) -> Value {
        match v {
            Value::Object(o) if o.len() == 1 && o.get("$b64").is_some_and(Value::is_string) => {
                let s = o["$b64"].as_str().unwrap_or("");
                if b64_len(s) < SMALLEST {
                    return Value::Object(o);
                }
                let bytes = base64::engine::general_purpose::STANDARD.decode(s).unwrap_or_default();
                self.hold(bytes, false, now)
            }
            // a JavaScript string's length is in UTF-16 units, never more than its UTF-8 bytes
            Value::String(s) if s.len() >= SMALLEST && s.encode_utf16().count() >= SMALLEST => {
                self.hold(s.into_bytes(), true, now)
            }
            Value::Array(a) => Value::Array(a.into_iter().map(|x| self.pack_value(x, now)).collect()),
            Value::Object(o) => {
                Value::Object(o.into_iter().map(|(k, x)| (k, self.pack_value(x, now))).collect::<Map<_, _>>())
            }
            other => other,
        }
    }

    /// The answer with its big pieces left here; bytes in it are `{$b64}`.
    pub fn pack(&mut self, answer: Value, now: f64) -> Value {
        self.held.retain(|_, (_, at)| now - *at <= KEEP_MS);
        self.pack_value(answer, now)
    }

    /// A slice of a piece from `offset`; the last slice lets the piece go. None for one not held.
    pub fn slice(&mut self, id: u64, offset: usize) -> Option<Vec<u8>> {
        let (bytes, _) = self.held.get(&id)?;
        let end = offset.saturating_add(SLICE);
        let out = bytes.get(offset.min(bytes.len())..end.min(bytes.len())).unwrap_or_default().to_vec();
        if end >= bytes.len() {
            self.held.remove(&id);
        }
        Some(out)
    }

    pub fn waiting(&self) -> usize {
        self.held.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn big_bytes_stay_and_come_back_in_slices() {
        let mut l = LargeAnswers::default();
        let big = vec![7u8; SMALLEST + 5];
        let b64 = base64::engine::general_purpose::STANDARD.encode(&big);
        let small = json!({ "$b64": "AAEC" });
        let out = l.pack(json!({ "a": { "$b64": b64 }, "b": small.clone(), "c": [1, "x"] }), 0.0);
        assert_eq!(out["b"], small);
        assert_eq!(out["a"], json!({ "$large": 1, "size": SMALLEST + 5, "text": false }));
        assert_eq!(l.slice(1, 0).unwrap(), big);
        assert_eq!(l.waiting(), 0);
        assert!(l.slice(1, 0).is_none());
    }

    #[test]
    fn a_piece_nobody_fetched_goes_after_five_minutes() {
        let mut l = LargeAnswers::default();
        l.pack(json!("x".repeat(SMALLEST)), 0.0);
        assert_eq!(l.waiting(), 1);
        l.pack(json!(1), KEEP_MS + 1.0);
        assert_eq!(l.waiting(), 0);
    }
}
