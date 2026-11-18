//! `mm-cli sandbox-assets <real pak01_dir.vpk> <items_game.txt> <out dir> <spec.json>`: the files
//! tools/dev/sandbox.js copies out of the real game into the sandbox's pak01, written under <out dir>
//! at their paths inside the archive, so `vpk-build` can pack the folder. The real archive is tens
//! of gigabytes; these are the few MB the app needs to show and build what the sandbox tests.
//!
//! spec.json, every field optional:
//!   items    item names whose files to copy, with every effect the builder offers on them
//!   unusual  also the game's unusual effects on those items (the `item` command)
//!   heroes   every hero's two portraits and its script (the hub groups heroes by attribute)
//!   text     the dota_ and items_ text in english, russian and schinese
//!   chat     every language's chat file (the anti-cheat notice is built from them)
//!   arcana   what the Terrorblade arcana window builds from
//! It prints {"written": n, "found": [the item names the builder offers]}.

use std::collections::BTreeSet;
use std::path::Path;

use mm_core::{data, gamelang, item_builder_details, item_builder_slots, item_effect_patch, unusual_effects, vpk};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize, Default)]
#[serde(default)]
struct Spec {
    items: Vec<String>,
    unusual: bool,
    heroes: bool,
    text: bool,
    chat: bool,
    arcana: bool,
}

/// A path as the archive keeps it: lower case, forward slashes, the compiled `_c` name.
fn compiled(p: &str) -> String {
    let c = p.to_lowercase().replace('\\', "/");
    if c.ends_with("_c") {
        c
    } else {
        format!("{c}_c")
    }
}

/// What the built block points at and what the build copies, for one item with one effect.
fn patch_files(schema: &[u8], id: &str, effect: Option<&str>, want: &mut BTreeSet<String>) {
    let ids: Vec<String> = effect.map(|e| vec![e.to_string()]).unwrap_or_default();
    let Ok(built) = item_effect_patch(schema, id, &ids, None, None, None) else { return };
    let block = mm_core::kv::latin1(&built.block);
    let re = regex::Regex::new(r#"(?i)"((?:models|particles|materials)/[^"]+\.(?:vmdl|vpcf|vmat|vtex))""#).unwrap();
    for m in re.captures_iter(&block) {
        want.insert(compiled(&m[1]));
    }
    for copy in &built.assets.asset_copies {
        let v = serde_json::to_value(copy).unwrap_or(Value::Null);
        for key in ["from", "to"] {
            if let Some(p) = v.get(key).and_then(Value::as_str).filter(|p| !p.is_empty()) {
                want.insert(compiled(p));
            }
        }
    }
}

pub fn run(pak: &Path, schema_file: &Path, out: &Path, spec_file: &Path) -> Result<Value, String> {
    let spec: Spec = serde_json::from_str(&std::fs::read_to_string(spec_file).map_err(|e| e.to_string())?)
        .map_err(|e| format!("{}: {e}", spec_file.display()))?;
    let ix = vpk::Index::open(pak).map_err(|e| e.to_string())?;
    let schema = std::fs::read(schema_file).map_err(|e| e.to_string())?;
    let mut want = BTreeSet::new();
    let mut found = BTreeSet::new();

    let slots = item_builder_slots::item_slots(&schema).map_err(|e| e.to_string())?;
    if !spec.items.is_empty() {
        let mut effects: Vec<Option<String>> = vec![None];
        effects.extend(data::item_effects().iter().map(|fx| Some(fx.id.clone())));
        if spec.unusual {
            let offered = unusual_effects::offered_unusual(&schema, |_| true).map_err(|e| e.to_string())?;
            effects.extend(offered.into_iter().map(|fx| Some(fx.id)));
        }
        for sl in &slots {
            for o in sl.options.iter().filter(|o| spec.items.contains(&o.name)) {
                found.insert(o.name.clone());
                for fx in &effects {
                    patch_files(&schema, &o.id, fx.as_deref(), &mut want);
                }
            }
        }
    }
    if spec.heroes {
        let mut heroes: BTreeSet<String> = slots.iter().flat_map(|sl| sl.hero_ids.iter().cloned()).collect();
        heroes.extend(item_builder_details::game_hero_ids(ix.paths()));
        for id in heroes {
            want.insert(format!("panorama/images/heroes/npc_dota_hero_{id}_png.vtex_c"));
            want.insert(format!("panorama/images/heroes/selection/npc_dota_hero_{id}_png.vtex_c"));
            want.insert(format!("scripts/npc/heroes/npc_dota_hero_{id}.txt"));
        }
    }
    if spec.text {
        for file in ["dota", "items"] {
            for lang in ["english", "russian", "schinese"] {
                want.insert(format!("resource/localization/{file}_{lang}.txt"));
            }
        }
    }
    if spec.chat {
        for lang in gamelang::DOTA_LANGUAGES {
            want.insert(format!("resource/localization/chat_{lang}.txt"));
        }
    }
    if spec.arcana {
        let set = data::recolor_sets().iter().find(|(k, _)| k == "terrorblade-arcana").map(|(_, s)| s);
        let arcana = data::arcana_sets().iter().find(|(k, _)| k == "terrorblade-arcana").map(|(_, s)| s);
        if let (Some(set), Some(arcana)) = (set, arcana) {
            let prefixes: Vec<&String> = set.own.iter().chain(&set.shared).chain(&set.materials).collect();
            for p in ix.paths() {
                let effect = (p.ends_with(".vpcf_c") || p.ends_with(".vmat_c"))
                    && prefixes.iter().any(|f| p.starts_with(f.as_str()));
                let model = arcana.models.values().any(|m| m.from == p) || arcana.models.contains_key(p);
                let picture = p.starts_with("panorama/images/")
                    && p.contains("terrorblade")
                    && (p.contains("_alt1") || p.contains("arcana") || !p.contains("/econ/"));
                if effect || model || picture {
                    want.insert(p.to_string());
                }
            }
        }
    }

    let mut written = 0;
    for rel in &want {
        if let Some(data) = ix.read(rel).map_err(|e| e.to_string())? {
            let to = out.join(rel);
            if let Some(dir) = to.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            std::fs::write(&to, data).map_err(|e| e.to_string())?;
            written += 1;
        }
    }
    Ok(json!({ "written": written, "found": found }))
}
