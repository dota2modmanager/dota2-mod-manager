//! mm-core on the command line, for the Node tools under tools/ and the tests: each command prints
//! JSON. `app` runs the app's own command line over a userData without the window. A command
//! nothing calls goes, rather than staying here.

mod builds;
mod modkit;
mod parse_each;
mod sandbox_assets;

use std::path::Path;
use std::process::ExitCode;

use mm_core::{resource, vpk};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};

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
        // a mod's VPK as tools/catalog/gen-fingerprints.js keeps it: its fingerprint, what kind of mod
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
        "catalog-base" => Ok(json!(mm_core::RAW_BASE)),
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
            let catalog = mm_core::Catalog::new(Path::new(arg(1)?), None, None, Box::new(mm_core::net_fetch::now_ms));
            let data = catalog.load(&mm_core::net_fetch::Net::default(), true)?;
            Ok(json!({ "rawBase": mm_core::RAW_BASE, "data": data }))
        }
        // a gameinfo_branchspecific.gi with this app's search path taken out, in place
        "strip-patch" => {
            let file = Path::new(arg(1)?);
            let text = mm_core::kv::latin1(&std::fs::read(file).map_err(|x| x.to_string())?);
            std::fs::write(file, mm_core::kv::to_latin1(&mm_core::patcher_gameinfo::strip_patch(&text)))
                .map_err(|x| x.to_string())?;
            Ok(Value::Null)
        }
        // a look built out of the game into a VPK (builds.rs)
        "look-sets" => Ok(builds::sets()),
        "kv3-tree" => modkit::tree(Path::new(arg(1)?), Path::new(arg(2)?)),
        "kv3-put" => modkit::put(Path::new(arg(1)?), Path::new(arg(2)?), Path::new(arg(3)?)),
        "recolor-files" => modkit::recolor_files(Path::new(arg(1)?), Path::new(arg(2)?)),
        "model-fx" => modkit::model_fx(Path::new(arg(1)?), Path::new(arg(2)?)),
        "find-dota" => Ok(json!(mm_core::steam::find_dota_game_path())),
        "content-root" => Ok(json!(mm_core::vpk_pack::find_content_root(Path::new(arg(1)?), 0))),
        "bench-install" => builds::bench_install(Path::new(arg(1)?), arg(2)?, Path::new(arg(3)?)),
        "parse-each" => parse_each::run(arg(1)?, Path::new(arg(2)?)),
        "config-rules" => builds::config_rules(Path::new(arg(1)?)),
        "build" => builds::run(arg(1)?, Path::new(arg(2)?), Path::new(arg(3)?)),
        // a single-file VPK from a folder (every file under it, at its path inside the folder) or
        // from a list.json of [path inside the VPK, file on disk] pairs; the sandbox and the test
        // fixtures build theirs this way
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
        // list.json: [[name, ...args]]; each answered {ok} or {error} (crates/mm-core/src/owner/calls.rs)
        "call" => {
            let list: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(arg(1)?).map_err(|x| x.to_string())?)
                .map_err(|x| x.to_string())?;
            Ok(json!(mm_core::calls::call_all(&list)))
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
/// driven while a real copy of the app is open. It needs --write-jail, and its user data inside the
/// jail, so it cannot write a real game or the installed app's settings.
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
    let jail = mm_core::write_jail::from_argv(&argv);
    if jail.is_empty() {
        eprintln!("mm-cli app: --write-jail=<dir> is required");
        return ExitCode::from(mm_core::cli::USAGE as u8);
    }
    mm_core::write_jail::install(&jail);
    let ud = std::path::absolute(&ud).unwrap_or_else(|_| ud.into());
    if let Err(e) = mm_core::write_jail::refuse_outside("user data", &ud) {
        eprintln!("mm-cli app: {e}");
        return ExitCode::from(mm_core::cli::USAGE as u8);
    }
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
