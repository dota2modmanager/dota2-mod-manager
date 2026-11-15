//! `mm-cli parse-each <vpk|zip> <list.json>`: each file of the list read by the parser that opens
//! other people's files, for tools/dev/fuzz-parsers.mjs. A refusal (an error the parser returns) is
//! the parser doing its job; a panic or a slow read is what the fuzzer is looking for. It prints,
//! per file, {"call": name, "panic": message} or {"call", "ms"} for each call, in the list's order.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::time::Instant;

use mm_core::safe_zip::{OpenedZip, Source};
use mm_core::vpk;
use serde_json::{json, Value};

type Call = (&'static str, fn(&[u8]) -> Result<(), String>);

fn vpk_paths(b: &[u8]) -> Result<(), String> {
    vpk::list_paths(b).map(|_| ()).map_err(|e| e.to_string())
}
fn vpk_entries(b: &[u8]) -> Result<(), String> {
    vpk::list_entries(b).map(|_| ()).map_err(|e| e.to_string())
}
fn zip_read(b: &[u8]) -> Result<(), String> {
    let mut z = OpenedZip::open(Source::Bytes(b.to_vec()), Some("fuzz.zip"), None)?;
    for f in z.files.clone() {
        z.read(&f)?;
    }
    Ok(())
}

pub fn run(kind: &str, list_file: &Path) -> Result<Value, String> {
    let calls: &[Call] = match kind {
        "vpk" => &[("listVpkPaths", vpk_paths), ("listVpkEntries", vpk_entries)],
        "zip" => &[("openZip", zip_read)],
        _ => return Err(format!("parse-each: no kind {kind} (vpk, zip)")),
    };
    let list: Vec<String> = serde_json::from_str(&std::fs::read_to_string(list_file).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    // a panic is reported in the answer, not printed as it happens
    std::panic::set_hook(Box::new(|_| {}));
    let mut out = Vec::new();
    for file in &list {
        let bytes = std::fs::read(file).map_err(|e| format!("{file}: {e}"))?;
        let mut row = Vec::new();
        for (name, f) in calls {
            let started = Instant::now();
            let r = catch_unwind(AssertUnwindSafe(|| f(&bytes)));
            let ms = started.elapsed().as_millis() as u64;
            row.push(match r {
                Ok(_) => json!({ "call": name, "ms": ms }),
                Err(p) => {
                    let msg =
                        p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()));
                    json!({ "call": name, "panic": msg.unwrap_or_else(|| "panic".into()) })
                }
            });
        }
        out.push(json!(row));
    }
    Ok(json!(out))
}
