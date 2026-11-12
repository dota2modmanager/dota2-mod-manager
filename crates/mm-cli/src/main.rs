//! mm-core on the command line, for the parity tests (test/rust-parity.test.js): each command
//! prints JSON the test compares with what the TypeScript module answers for the same input.

use std::path::Path;
use std::process::ExitCode;

use mm_core::{schema, schema_merge, vpk};
use serde_json::{json, Value};
use std::time::Instant;

fn run(args: &[String]) -> Result<Value, String> {
    let cmd = args.first().map(String::as_str).unwrap_or("");
    let arg = |i: usize| args.get(i).map(String::as_str).ok_or_else(|| format!("{cmd}: missing argument {i}"));
    let e = |err: vpk::VpkError| err.to_string();
    match cmd {
        "vpk-entries" => {
            let buf = vpk::read_index_file(Path::new(arg(1)?)).map_err(e)?;
            let list = vpk::list_entries(&buf).map_err(e)?;
            Ok(json!(list.into_iter().map(|(p, c)| json!([p, c])).collect::<Vec<_>>()))
        }
        "vpk-fingerprint" => {
            let buf = std::fs::read(arg(1)?).map_err(|x| x.to_string())?;
            Ok(json!(vpk::fingerprint_vpk(&buf).map_err(e)?))
        }
        // read every entry and build a single file again: the TypeScript mergeVpkToSingle
        "vpk-merge" => {
            let out = vpk::merge_to_single(Path::new(arg(1)?)).map_err(e)?;
            std::fs::write(arg(2)?, &out).map_err(|x| x.to_string())?;
            Ok(json!(out.len()))
        }
        "vpk-read" => {
            let index = vpk::Index::open(Path::new(arg(1)?)).map_err(e)?;
            let data = index.read(arg(2)?).map_err(e)?;
            Ok(match data {
                Some(d) => json!({ "size": d.len(), "crc": vpk::crc32(&d) }),
                None => Value::Null,
            })
        }
        // patches.json: [{id, block, source}] with blocks as latin1 strings; the merged table to `out`
        "schema-merge" => {
            let (base, _) = schema::read_game_schema(Path::new(arg(1)?))?;
            let raw: Value = serde_json::from_str(&std::fs::read_to_string(arg(2)?).map_err(|x| x.to_string())?)
                .map_err(|x| x.to_string())?;
            let patches: Vec<schema_merge::Patch> = raw
                .as_array()
                .ok_or("patches: not a list")?
                .iter()
                .map(|p| schema_merge::Patch {
                    id: p["id"].as_str().map(String::from).unwrap_or_else(|| p["id"].to_string()),
                    block: p["block"].as_str().unwrap_or("").chars().map(|c| c as u32 as u8).collect(),
                    source: p["source"].as_str().unwrap_or("").to_string(),
                })
                .collect();
            let m = schema_merge::merge(&base, &patches).map_err(|x| x.to_string())?;
            let checked = schema_merge::validate(&m.text, Some(&base)).map_err(|x| x.to_string());
            std::fs::write(arg(3)?, &m.text).map_err(|x| x.to_string())?;
            Ok(json!({ "applied": m.applied, "missing": m.missing, "conflicts": m.conflicts,
                "validate": checked.map(|(items, bytes)| json!({ "items": items, "bytes": bytes })).unwrap_or_else(|e| json!({ "error": e })) }))
        }
        "schema-base-patch" => {
            let (base, _) = schema::read_game_schema(Path::new(arg(1)?))?;
            let block = schema_merge::base_item_patch(&base, arg(2)?, arg(3)?).map_err(|x| x.to_string())?;
            Ok(json!(mm_core::kv::latin1(&block)))
        }
        // the game's table, every numbered item as the pickers read it
        "schema-items" => {
            let (text, stamp) = schema::read_game_schema(Path::new(arg(1)?))?;
            let items = schema::list_items(&text).map_err(|x| x.to_string())?;
            Ok(json!({ "stamp": stamp, "items": items }))
        }
        // how long each step takes here, for tools/rust-bench.mjs: best of `runs`
        "bench" => {
            let game = Path::new(arg(1)?);
            let runs: usize = args.get(2).and_then(|r| r.parse().ok()).unwrap_or(5);
            let pak = game.join("dota").join("pak01_dir.vpk");
            let best = |f: &mut dyn FnMut() -> Result<(), String>| -> Result<f64, String> {
                let mut best = f64::MAX;
                for _ in 0..runs {
                    let t = Instant::now();
                    f()?;
                    best = best.min(t.elapsed().as_secs_f64() * 1000.0);
                }
                Ok(best)
            };
            let open = best(&mut || vpk::Index::open(&pak).map(|_| ()).map_err(|x| x.to_string()))?;
            let read = best(&mut || schema::read_game_schema(game).map(|_| ()))?;
            let (text, _) = schema::read_game_schema(game)?;
            let list = best(&mut || schema::list_items(&text).map(|_| ()).map_err(|x| x.to_string()))?;
            let count = best(&mut || schema::count_items(&text).map(|_| ()).map_err(|x| x.to_string()))?;
            let index_bytes = vpk::read_index_file(&pak).map_err(|x| x.to_string())?;
            let fp = best(&mut || vpk::fingerprint_vpk(&index_bytes).map(|_| ()).map_err(|x| x.to_string()))?;
            Ok(
                json!({ "openPak01Index": open, "readItemsGame": read, "listItems": list, "countItems": count, "fingerprintPak01": fp }),
            )
        }
        _ => Err(format!("unknown command {cmd:?}")),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(v) => {
            println!("{v}");
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("{err}");
            ExitCode::FAILURE
        }
    }
}
