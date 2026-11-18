//! `mm-cli build <kind> <out.vpk> <args.json>`: the looks the app builds out of the game, written
//! to a file for the tools that make them by hand (tools/mods/recolor.mjs, tools/mods/tower-looks.mjs,
//! tools/mods/trees.mjs). It prints what the build says beside the file.
//!
//!   recolor  {pak01, set, target: [r, g, b]}       an item set in one colour
//!   arcana   {pak01, set, target: [r, g, b]}       the arcana as a mod, in one colour
//!   towers   {pak01, table, radiant?, dire?}      each side's towers in a look's style
//!   trees    {pak01, radiant?, dire?}             each side's trees from one of the sets

use std::path::Path;

use mm_core::build_arcana;
use mm_core::vpk;
use mm_core::{recolor, tower_looks, tree_sets};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize, Default)]
#[serde(default)]
struct Args {
    pak01: String,
    set: String,
    target: Vec<f64>,
    table: String,
    radiant: Option<String>,
    dire: Option<String>,
}

fn rgb(a: &Args) -> Result<recolor::Rgb, String> {
    match a.target.as_slice() {
        [r, g, b] => Ok([*r, *g, *b]),
        _ => Err("target is [r, g, b]".into()),
    }
}

pub fn run(kind: &str, out: &Path, args_file: &Path) -> Result<Value, String> {
    let a: Args = serde_json::from_str(&std::fs::read_to_string(args_file).map_err(|e| e.to_string())?)
        .map_err(|e| format!("{}: {e}", args_file.display()))?;
    let pak01 = Path::new(&a.pak01);
    let (bytes, report) = match kind {
        "recolor" => {
            let ix = vpk::Index::open(pak01).map_err(|e| e.to_string())?;
            let (bytes, r) = recolor::build_recolor(&ix, &a.set, rgb(&a)?, |_| false)?;
            let failed: Vec<Value> = r.failed.iter().map(|f| json!({ "path": f.path, "error": f.error })).collect();
            (bytes, json!({ "files": r.files.len(), "changed": r.changed, "skipped": r.skipped, "failed": failed }))
        }
        "arcana" => {
            let ix = vpk::Index::open(pak01).map_err(|e| e.to_string())?;
            let x = build_arcana(&ix, &a.set, rgb(&a)?, &|_| false, &[])?;
            let failed: Vec<Value> = x.failed.iter().map(|f| json!({ "path": f.path, "error": f.error })).collect();
            (x.vpk, json!({ "files": x.files, "changed": x.changed, "skipped": 0, "failed": failed }))
        }
        "towers" => {
            let table = std::fs::read(&a.table).map_err(|e| format!("{}: {e}", a.table))?;
            let t = tower_looks::build_towers(pak01, &table, a.radiant.as_deref(), a.dire.as_deref())?;
            (t.vpk, json!({ "names": t.names, "files": t.files, "missing": t.missing, "skipped": t.skipped }))
        }
        "trees" => {
            let (bytes, files, missing) = tree_sets::build_trees(pak01, a.radiant.as_deref(), a.dire.as_deref())?;
            (bytes, json!({ "files": files, "missing": missing }))
        }
        _ => return Err(format!("build: no kind {kind} (recolor, arcana, towers, trees)")),
    };
    std::fs::write(out, bytes).map_err(|e| format!("{}: {e}", out.display()))?;
    Ok(report)
}

/// `mm-cli config-rules <ops.json>`: the rules the app reads its remote config by, for
/// tools/release/rollback.mjs to write one the app will honour. Each op is answered in turn:
/// ["normalize", raw], ["cmp", a, b], ["idHash", id, salt], ["verify", file, signature, key],
/// ["basesListing", manifest, signature], ["constants"].
pub fn config_rules(ops_file: &Path) -> Result<Value, String> {
    use mm_core::{beta, catalog_signature, remote_config as rc};
    let ops: Vec<Vec<Value>> = serde_json::from_str(&std::fs::read_to_string(ops_file).map_err(|e| e.to_string())?)
        .map_err(|e| format!("{}: {e}", ops_file.display()))?;
    let st = |op: &[Value], i: usize| op.get(i).and_then(Value::as_str).unwrap_or("").to_string();
    let mut out = Vec::new();
    for op in &ops {
        out.push(match st(op, 0).as_str() {
            "normalize" => rc::normalize(op.get(1).unwrap_or(&Value::Null)),
            "cmp" => json!(rc::cmp_version(&st(op, 1), &st(op, 2))),
            "idHash" => json!(beta::id_hash(&st(op, 1), &st(op, 2))),
            "verify" => {
                let bytes = std::fs::read(st(op, 1)).map_err(|e| e.to_string())?;
                json!(catalog_signature::verify(&bytes, &st(op, 2), &st(op, 3)))
            }
            // the arcana bases a signed manifest lists, as the app reads it, or null for a bad signature
            "basesListing" => {
                let key = mm_core::arcana_base_store::BASES_PUBLIC_KEY;
                json!(mm_core::arcana_base_store::signed_listing(&st(op, 1), &st(op, 2), key))
            }
            "constants" => json!({
                "SWITCHABLE": rc::SWITCHABLE, "BLOCKS_SINCE": rc::BLOCKS_SINCE, "MAX_TESTERS": rc::MAX_TESTERS,
                "MAX_MIRRORS": rc::MAX_MIRRORS, "CONFIG_PUBLIC_KEY": rc::CONFIG_PUBLIC_KEY,
            }),
            other => return Err(format!("config-rules: no op {other}")),
        });
    }
    Ok(json!(out))
}

/// `mm-cli look-sets`: the tree sets and the recolour sets' names, for the tools to list.
pub fn sets() -> Value {
    let trees: Vec<Value> =
        tree_sets::tree_sets().iter().map(|s| json!({ "id": s.id, "name": s.name, "models": s.models })).collect();
    let recolor: serde_json::Map<String, Value> =
        mm_core::data::recolor_sets().iter().map(|(id, s)| (id.clone(), json!(s.name))).collect();
    json!({ "trees": trees, "recolor": recolor })
}

/// `mm-cli bench-install <game> <language suffix> <vpk>`: a mod into a free slot of the language
/// folder, the way the app's installer puts one there, for tools/mods/dota-bench.mjs; the file it wrote.
pub fn bench_install(game: &Path, lang: &str, vpk_file: &Path) -> Result<Value, String> {
    let inst = mm_core::installer::Installer::new(Some(game.to_path_buf()), lang);
    inst.ensure_lang_folder()?;
    let mut used = inst.used_pak_names()?;
    let pak = inst.allocate_pak(&mut used, true)?;
    let to = inst.lang_folder()?.join(pak);
    let bytes = std::fs::read(vpk_file).map_err(|e| format!("{}: {e}", vpk_file.display()))?;
    mm_core::file_tx::write_into(&bytes, &to, None).map_err(|e| e.to_string())?;
    Ok(json!(to))
}
