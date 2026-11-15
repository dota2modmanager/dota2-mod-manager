//! mm-core on the command line, for the parity tests (test/rust-parity.test.js): each command
//! prints JSON the test compares with what the TypeScript module answers for the same input.

mod owner_wire;
mod sandbox_assets;

use std::path::Path;
use std::process::ExitCode;

use mm_core::{kv3, resource, schema, schema_merge, vpk};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::time::Instant;

/// What `vpk-build` packs: a folder's files by their path under it, sorted so a build is the same
/// bytes every time, or the pairs a list.json names.
fn build_entries(src: &Path) -> Result<Vec<vpk::Entry>, String> {
    let read = |f: &Path| std::fs::read(f).map(vpk::Bytes::from).map_err(|x| format!("{}: {x}", f.display()));
    if src.is_dir() {
        let mut files = Vec::new();
        let mut stack = vec![src.to_path_buf()];
        while let Some(dir) = stack.pop() {
            for e in std::fs::read_dir(&dir).map_err(|x| x.to_string())? {
                let p = e.map_err(|x| x.to_string())?.path();
                if p.is_dir() {
                    stack.push(p);
                } else {
                    let rel = p.strip_prefix(src).map_err(|x| x.to_string())?.to_string_lossy().replace('\\', "/");
                    files.push((rel, p));
                }
            }
        }
        files.sort();
        return files.iter().map(|(rel, p)| Ok(vpk::entry_at(rel, read(p)?))).collect();
    }
    let list: Vec<(String, String)> =
        serde_json::from_str(&std::fs::read_to_string(src).map_err(|x| x.to_string())?).map_err(|x| x.to_string())?;
    let base = src.parent().unwrap_or(Path::new(""));
    list.iter().map(|(rel, f)| Ok(vpk::entry_at(rel, read(&base.join(f))?))).collect()
}

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
        // a mod's VPK as tools/gen-fingerprints.js keeps it: its fingerprint, what kind of mod
        // it is, the heroes it is about, and its paths sorted
        "vpk-analyze" => {
            let buf = std::fs::read(arg(1)?).map_err(|x| x.to_string())?;
            let fp = vpk::fingerprint_vpk(&buf).map_err(e)?;
            let mut paths = vpk::list_paths(&buf).map_err(e)?;
            let a = mm_core::vpk_analyze::analyze_vpk_paths(&paths);
            let subjects: Vec<Value> = mm_core::vpk_analyze::subject_heroes(&a)
                .into_iter()
                .map(|h| json!({ "id": h.id, "name": h.name, "slots": h.slots, "models": h.models }))
                .collect();
            paths.sort();
            Ok(json!({ "fp": fp, "kind": a.kind, "subjects": subjects, "paths": paths }))
        }
        // where the catalog's files are served from
        "catalog-base" => Ok(json!(mm_core::catalog::RAW_BASE)),
        // a loose-file mod's fingerprint, from a list.json of [path in the mod, file] pairs
        // relative to the list
        "files-fingerprint" => {
            let list_file = Path::new(arg(1)?);
            let list: Vec<(String, String)> =
                serde_json::from_str(&std::fs::read_to_string(list_file).map_err(|x| x.to_string())?)
                    .map_err(|x| x.to_string())?;
            let base = list_file.parent().unwrap_or(Path::new(""));
            let data = list
                .iter()
                .map(|(rel, f)| std::fs::read(base.join(f)).map(|d| (rel.clone(), d)).map_err(|x| x.to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            let files: Vec<(String, &[u8])> = data.iter().map(|(p, d)| (p.clone(), d.as_slice())).collect();
            Ok(json!(vpk::fingerprint_files(&files)))
        }
        // read every entry and build a single file again: the TypeScript mergeVpkToSingle
        "vpk-merge" => {
            let out = vpk::merge_to_single(Path::new(arg(1)?)).map_err(e)?;
            std::fs::write(arg(2)?, &out).map_err(|x| x.to_string())?;
            Ok(json!(out.len()))
        }
        // a single-file VPK from a folder (every file under it, at its path inside the folder) or
        // from a list.json of [path inside the VPK, file on disk] pairs; the sandbox and the test
        // fixtures build theirs this way
        // files of a VPK written to a folder at their paths inside it: every file, or those a
        // paths.json lists; prints the paths written
        "vpk-extract" => {
            let index = vpk::Index::open(Path::new(arg(1)?)).map_err(e)?;
            let out = Path::new(arg(2)?);
            let wanted: Vec<String> = match args.get(3) {
                Some(list) => serde_json::from_str(&std::fs::read_to_string(list).map_err(|x| x.to_string())?)
                    .map_err(|x| x.to_string())?,
                None => index.paths().map(String::from).collect(),
            };
            let mut written = Vec::new();
            for rel in &wanted {
                if let Some(data) = index.read(rel).map_err(e)? {
                    let to = out.join(rel);
                    if let Some(dir) = to.parent() {
                        std::fs::create_dir_all(dir).map_err(|x| x.to_string())?;
                    }
                    std::fs::write(&to, data).map_err(|x| x.to_string())?;
                    written.push(rel.clone());
                }
            }
            Ok(json!(written))
        }
        // the files the sandbox copies out of the real game (sandbox_assets.rs)
        "sandbox-assets" => {
            sandbox_assets::run(Path::new(arg(1)?), Path::new(arg(2)?), Path::new(arg(3)?), Path::new(arg(4)?))
        }
        // the catalog fetched fresh into <user data>/catalog-cache, as the app fetches it, and where
        // its files are served from
        "catalog-load" => {
            let catalog =
                mm_core::catalog::Catalog::new(Path::new(arg(1)?), None, None, Box::new(mm_core::net_fetch::now_ms));
            let data = catalog.load(&mm_core::net_fetch::Net::default(), true)?;
            Ok(json!({ "rawBase": mm_core::catalog::RAW_BASE, "data": data }))
        }
        // a gameinfo_branchspecific.gi with this app's search path taken out, in place
        "strip-patch" => {
            let file = Path::new(arg(1)?);
            let text = mm_core::kv::latin1(&std::fs::read(file).map_err(|x| x.to_string())?);
            std::fs::write(file, mm_core::kv::to_latin1(&mm_core::patcher_gameinfo::strip_patch(&text)))
                .map_err(|x| x.to_string())?;
            Ok(Value::Null)
        }
        "vpk-build" => {
            let out = Path::new(arg(1)?);
            let entries = build_entries(Path::new(arg(2)?))?;
            let buf = vpk::build(&entries);
            if let Some(dir) = out.parent().filter(|d| !d.as_os_str().is_empty()) {
                std::fs::create_dir_all(dir).map_err(|x| x.to_string())?;
            }
            std::fs::write(out, &buf).map_err(|x| x.to_string())?;
            Ok(json!({ "entries": entries.len(), "size": buf.len() }))
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
        // list.json: [[name, ...args]]; each answered {ok} or {error} (test/rust-calls.test.ts)
        "call" => {
            let list: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(arg(1)?).map_err(|x| x.to_string())?)
                .map_err(|x| x.to_string())?;
            Ok(json!(mm_core::calls::call_all(&list)))
        }
        // list.json: block files (a resource's DATA block); each one's tree, and its bytes
        // encoded back and written anew, as SHA-1s
        "kv3-dump" => {
            let list: Vec<String> = serde_json::from_str(&std::fs::read_to_string(arg(1)?).map_err(|x| x.to_string())?)
                .map_err(|x| x.to_string())?;
            Ok(json!(list
                .iter()
                .map(|f| {
                    let bytes = std::fs::read(f).map_err(|x| x.to_string())?;
                    let mut kv = kv3::read(&bytes).map_err(|x| x.to_string())?;
                    let dump = kv.dump();
                    let written = kv3::write(&kv).map(|b| sha(&b)).map_err(|x| x.to_string());
                    let encoded = kv.encode().map_err(|x| x.to_string());
                    // the bytes encoded back read as the same tree (zstd's bytes differ from Node's)
                    let reread = encoded.as_ref().ok().map(|b| kv3::read(b).map(|k| k.dump() == dump).unwrap_or(false));
                    let encoded = encoded.map(|b| sha(&b));
                    Ok::<_, String>(
                        json!({ "dump": dump, "encode": result(encoded), "write": result(written), "reread": reread }),
                    )
                })
                .map(|r| r.unwrap_or_else(|e| json!({ "error": e })))
                .collect::<Vec<_>>()))
        }
        // list.json: compiled resources; their blocks, the resources they name, and the file with
        // one more reference added, as a SHA-1
        "resource" => {
            let list: Vec<String> = serde_json::from_str(&std::fs::read_to_string(arg(1)?).map_err(|x| x.to_string())?)
                .map_err(|x| x.to_string())?;
            Ok(json!(list
                .iter()
                .map(|f| {
                    let file = std::fs::read(f).map_err(|x| x.to_string())?;
                    let blocks = resource::blocks(&file).map_err(|x| x.to_string())?;
                    let refs = resource::references(&file).map_err(|x| x.to_string())?;
                    let ids: Vec<String> = refs.iter().map(|r| resource::resource_id(r).to_string()).collect();
                    let added = resource::with_references(&file, &["particles/added/one.vpcf_c"]).map(|b| sha(&b)).map_err(|x| x.to_string());
                    Ok::<_, String>(json!({
                        "blocks": blocks.iter().map(|b| json!({ "name": b.name, "entry": b.entry, "at": b.at, "size": b.size })).collect::<Vec<_>>(),
                        "references": refs, "ids": ids, "added": result(added),
                    }))
                })
                .map(|r| r.unwrap_or_else(|e| json!({ "error": e })))
                .collect::<Vec<_>>()))
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

fn sha(b: &[u8]) -> String {
    Sha1::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn result(r: Result<String, String>) -> Value {
    match r {
        Ok(v) => json!(v),
        Err(e) => json!({ "error": e }),
    }
}

/// `mm-cli app --user-data-dir=<dir> --write-jail=<dir> --list`: the app's command line
/// (mm_core::cli) over a userData, without the shell's single-instance lock, so the sandbox can be
/// driven while a real copy of the app is open. Never point it at a real game: pass --write-jail.
fn app(args: &[String]) -> ExitCode {
    let mut argv = vec!["mm-cli".to_string()];
    argv.extend(args.iter().cloned());
    let Some(parsed) = mm_core::cli::command(&argv) else {
        eprintln!("mm-cli app: no command (--apply, --list, --disable-all)");
        return ExitCode::from(mm_core::cli::USAGE as u8);
    };
    let flag = |name: &str| argv.iter().find_map(|a| a.strip_prefix(&format!("--{name}=")).map(String::from));
    let Some(ud) = flag("user-data-dir") else {
        eprintln!("mm-cli app: --user-data-dir=<dir> is required");
        return ExitCode::from(mm_core::cli::USAGE as u8);
    };
    mm_core::write_jail::install(&mm_core::write_jail::from_argv(&argv));
    let ud = std::path::absolute(&ud).unwrap_or_else(|_| ud.into());
    let opts = mm_core::owner::Options {
        downloads: ud.clone(),
        app_root: std::env::current_dir().unwrap_or_default(),
        user_data: ud,
        app_version: env!("CARGO_PKG_VERSION").into(),
        uninstall: false,
        system_languages: None,
        // the game in the settings or none: never one looked up on this machine
        find_game: Box::new(|| None),
        dota_running: Box::new(mm_core::game_watch::dota_is_running),
        now: mm_core::net_fetch::now_ms,
    };
    ExitCode::from(mm_core::cli::main(parsed, opts, std::sync::Arc::new(mm_core::cli::Stdio)) as u8)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("app") {
        return app(&args[1..]);
    }
    if args.first().map(String::as_str) == Some("owner") {
        return match owner_wire::run(&args[1..]) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("{err}");
                ExitCode::FAILURE
            }
        };
    }
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
