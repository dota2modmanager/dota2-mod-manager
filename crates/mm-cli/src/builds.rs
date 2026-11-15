//! `mm-cli build <kind> <out.vpk> <args.json>`: the looks the app builds out of the game, written
//! to a file for the tools that make them by hand (tools/recolor.mjs, tools/tower-looks.mjs,
//! tools/trees.mjs). It prints what the build says beside the file.
//!
//!   recolor  {pak01, set, target: [r, g, b]}       an item set in one colour
//!   arcana   {pak01, set, target: [r, g, b]}       the arcana as a mod, in one colour
//!   towers   {pak01, table, radiant?, dire?}      each side's towers in a look's style
//!   trees    {pak01, radiant?, dire?}             each side's trees from one of the sets

use std::path::Path;

use mm_core::arcana::build_arcana;
use mm_core::looks::{recolor, tower_looks, tree_sets};
use mm_core::vpk;
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

/// `mm-cli look-sets`: the tree sets and the recolour sets' names, for the tools to list.
pub fn sets() -> Value {
    let trees: Vec<Value> =
        tree_sets::tree_sets().iter().map(|s| json!({ "id": s.id, "name": s.name, "models": s.models })).collect();
    let recolor: serde_json::Map<String, Value> =
        mm_core::data::recolor_sets().iter().map(|(id, s)| (id.clone(), json!(s.name))).collect();
    json!({ "trees": trees, "recolor": recolor })
}
