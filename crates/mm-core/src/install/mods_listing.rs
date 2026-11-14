//! What My mods is drawn from: the answer to mods:list (src/mods-listing.ts), which every screen
//! asks for again after anything changes. A mod whose files were deleted from the game folder
//! drops out of the library; a foreign file is named as a copy of a library mod or as a catalog
//! mod; an import still called "pakNN" gets a real name once; every row says which switched-on
//! mod hides its files; the item blocks stay behind; the ownership note is kept current.

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::fingerprints::Fingerprints;
use crate::installer::Installer;
use crate::installer_slots::CoverageMod;
use crate::library::Library;
use crate::overlays::files_of;
use crate::terrain_age::TerrainAges;

/// The paths of each kind a pre-patch mark carries to the window.
const PATHS_SHOWN: usize = 100;

/// The time now as `Date.toISOString` writes it.
pub fn iso_now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// Which mods a Dota update reached, by id (UpdateImpact::marked).
pub type Marked<'a> = dyn Fn(&Library) -> Result<IndexMap<String, Value>, String> + 'a;
/// Switches off a copy of the pumpkin's mod nobody earned here (scream_guard::guard).
pub type Guard<'a> = dyn FnMut(&mut Library) -> Result<(), String> + 'a;

/// What the listing reads besides the installer and the library.
pub struct ListingDeps<'a> {
    pub fingerprints: &'a mut Fingerprints,
    pub terrain_ages: &'a TerrainAges,
    /// which mods a Dota update reached, by id (UpdateImpact::marked); None marks none
    pub marked: Option<&'a Marked<'a>>,
    /// switches off a copy of the pumpkin's mod nobody earned here
    pub guard: Option<&'a mut Guard<'a>>,
    /// the files the notice text owns (NoticeText::owned_files)
    pub notice_owned: Vec<String>,
    /// whether the item-table patch is on (schema service state)
    pub schema_on: bool,
    pub verify_stuck: Value,
    pub diag: &'a mut dyn FnMut(String),
}

/// What the caller does after the answer: the notice text, Discord, the emblem ring line.
pub struct After {
    /// the ring line belongs in autoexec (an emblem is on and the master switch is not off)
    pub ring_on: Option<bool>,
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).map(crate::js::string).unwrap_or_default()
}

fn err_text(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// The mods:list answer.
pub fn list_mods(inst: &Installer, lib: &mut Library, deps: ListingDeps) -> (Value, After) {
    let ListingDeps { fingerprints, terrain_ages, marked, guard, notice_owned, schema_on, verify_stuck, diag } = deps;
    // a mod still on the slot the notice text took moves off it
    match crate::slot_zones::vacate_app_pak(inst, lib) {
        Ok(true) => diag("a mod moved off the notice slot".into()),
        Ok(false) => {}
        Err(e) => diag(format!("notice slot not freed: {}", err_text(e))),
    }
    // folder sync: a mod deleted straight from the game folder drops out of the library
    let sync = (|| -> Result<(), String> {
        for rec in lib.list().to_vec() {
            let pack = rec.get("kind").and_then(Value::as_str) == Some("pack");
            let has_files = rec.get("files").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
            if pack {
                if has_files && !inst.lang_primary_present(&rec) {
                    inst.remove_pack_fully(&rec)?;
                    lib.remove_record(&rec["id"], None).map_err(err_text)?;
                }
            } else if !inst.lang_primary_present(&rec) {
                lib.remove_record(&rec["id"], None).map_err(err_text)?;
            }
        }
        Ok(())
    })();
    let _ = sync; // no game path yet: nothing to sync
    if let Some(g) = guard {
        if let Err(e) = g(lib) {
            diag(format!("scream guard: {e}"));
        }
    }

    // fingerprint -> a mod already in the library, so a byte-identical file is called a copy
    let mut installed_fps: HashMap<String, String> = HashMap::new();
    let mut behind: HashSet<String> = HashSet::new();
    let mut analyses: HashMap<String, Option<Value>> = HashMap::new();
    for rec in lib.list() {
        if rec.get("kind").and_then(Value::as_str) == Some("pack") {
            continue;
        }
        let a = inst.analyze_record(&files_of(rec.get("files").unwrap_or(&Value::Null)));
        let fp = a.as_ref().and_then(|a| a.get("fp")).filter(|f| crate::js::truthy(f)).map(crate::js::string);
        if let Some(fp) = &fp {
            installed_fps.entry(fp.clone()).or_insert_with(|| s(rec, "name"));
        }
        if crate::mod_update::behind_catalog(rec, fp.as_deref(), &mut |c, n, st| {
            fingerprints.prints_of(c, n, st).cloned()
        }) {
            behind.insert(s(rec, "id"));
        }
        analyses.insert(s(rec, "id"), a);
    }

    let mut external: Vec<Value> = Vec::new();
    let known = lib.known_files().unwrap_or_default();
    let can_match = fingerprints.has_data();
    if let Ok(found) = inst.external_files(&known, can_match) {
        for f in found {
            let mut v = serde_json::to_value(&f).unwrap_or(Value::Null);
            if let Some(fp) = f.fp.as_deref().filter(|f| !f.is_empty()) {
                v["match"] = json!(fingerprints.matches(Some(fp)));
                if let Some(name) = installed_fps.get(fp) {
                    v["duplicateOf"] = json!(name);
                }
            }
            // lang-root files are always worth listing; maps and cursors only when recognised
            if f.primary || v.get("match").is_some_and(crate::js::truthy) {
                external.push(v);
            }
        }
        // fonts share panorama/fonts with vanilla: matched as a subset, not by a folder print
        if can_match && !fingerprints.fonts.is_empty() && !known.iter().any(|f| s(f, "root") == "fonts") {
            let fonts = inst.font_folder_hashes().map(|h| fingerprints.match_fonts(&h)).unwrap_or_default();
            for m in fonts {
                let style = m.style_label.clone().filter(crate::js::truthy).unwrap_or(Value::Null);
                external.push(json!({
                    "kind": "font", "key": format!("__font__{}", m.name), "name": m.name, "primary": false,
                    "size": 0, "enabled": true,
                    "files": m.files.keys().map(|bn| json!({ "root": "fonts", "relPath": bn })).collect::<Vec<_>>(),
                    "match": [{ "name": m.name, "categoryId": m.category_id, "styleLabel": style }],
                }));
            }
        }
    }

    // imported mods have no catalog identity: tagged by content, matched to the catalog if known
    let pak_name = regex::Regex::new(r"(?i)^!?pak\d+$").unwrap();
    let dir_re = regex::Regex::new(r"(?i)_dir\.vpk$").unwrap();
    let mut installed: Vec<Value> = Vec::new();
    for rec in lib.list().to_vec() {
        if s(&rec, "categoryId") != "imported" {
            installed.push(rec);
            continue;
        }
        let id = s(&rec, "id");
        let a = analyses
            .remove(&id)
            .unwrap_or_else(|| inst.analyze_record(&files_of(rec.get("files").unwrap_or(&Value::Null))));
        let original = rec.get("fpOriginal").filter(|v| crate::js::truthy(v)).map(crate::js::string);
        let fp = original
            .or_else(|| a.as_ref().and_then(|a| a.get("fp")).filter(|f| crate::js::truthy(f)).map(crate::js::string));
        let matches = fingerprints.matches(fp.as_deref());
        let mut rec = rec;
        if pak_name.is_match(&s(&rec, "name")) {
            let dir = files_of(rec.get("files").unwrap_or(&Value::Null))
                .into_iter()
                .find(|f| f.root == "lang" && dir_re.is_match(&f.rel_path));
            let first = matches.as_ref().and_then(|m| m.first()).map(|m| s(m, "name")).filter(|n| !n.is_empty());
            let nm = first.or_else(|| dir.and_then(|d| inst.display_name_for_file(&d.rel_path)));
            if let Some(nm) = nm.filter(|n| *n != s(&rec, "name")) {
                let _ = lib.update(&rec["id"], &json!({ "name": nm }), None);
                rec["name"] = json!(nm);
            }
        }
        let mut row = rec.as_object().cloned().unwrap_or_default();
        if let Some(Value::Object(a)) = &a {
            for (k, v) in a {
                row.insert(k.clone(), v.clone());
            }
        }
        row.insert("match".into(), json!(matches));
        installed.push(Value::Object(row));
    }

    // who is quietly covering whom, over the switched-on mods of both lists
    let mut live: Vec<CoverageMod> = Vec::new();
    for r in installed.iter().filter(|r| r.get("enabled").is_some_and(crate::js::truthy)) {
        live.push(CoverageMod {
            key: r["id"].clone(),
            name: r["name"].clone(),
            files: r["files"].as_array().cloned().unwrap_or_default(),
        });
    }
    for f in external.iter().filter(|f| f.get("enabled").is_some_and(crate::js::truthy)) {
        live.push(CoverageMod {
            key: f["key"].clone(),
            name: f["name"].clone(),
            files: f["files"].as_array().cloned().unwrap_or_default(),
        });
    }
    let covered = if inst.game.is_some() { inst.coverage(&live) } else { IndexMap::new() };
    for f in &mut external {
        if let Some(by) = covered.get(&s(f, "key")) {
            f["coveredBy"] = json!(by);
        }
    }

    // a whole-map terrain built for an older map than the game's; its build date kept once found
    let terrains = terrain_ages.for_records(&installed);
    for (id, a) in &terrains {
        if let Some(b) = a.built_at {
            let idv = json!(id);
            if lib.find(&idv).is_some_and(|r| r.get("mapBuiltAt").and_then(Value::as_f64) != Some(b)) {
                let _ = lib.update(&idv, &json!({ "mapBuiltAt": crate::js::json_number(b) }), None);
                // the row is the stored record in the TypeScript, so it shows the date at once
                if let Some(row) = installed.iter_mut().find(|r| r.get("id") == Some(&idv)) {
                    row["mapBuiltAt"] = crate::js::json_number(b);
                }
            }
        }
    }

    // a mod whose copies of Valve's files a Dota update changed since
    let mut pre_patch: IndexMap<String, Value> = IndexMap::new();
    if let Some(marked) = marked {
        match marked(lib) {
            Ok(m) => {
                for (id, m) in m {
                    let list = |k: &str| m.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
                    let (ch, rm) = (list("changed"), list("removed"));
                    pre_patch.insert(
                        id,
                        json!({
                            "since": m.get("since").cloned().unwrap_or(Value::Null),
                            "changed": ch.len(), "removed": rm.len(),
                            "changedPaths": ch.iter().take(PATHS_SHOWN).collect::<Vec<_>>(),
                            "removedPaths": rm.iter().take(PATHS_SHOWN).collect::<Vec<_>>(),
                        }),
                    );
                }
            }
            Err(e) => diag(format!("update impact not read: {e}")),
        }
    }

    let slots = inst.used_mod_slots().unwrap_or(0);
    let mut owned: Vec<String> = lib.known_lang_rel_paths().unwrap_or_default().iter().map(crate::js::string).collect();
    owned.extend(notice_owned);
    inst.write_ownership(&owned, &iso_now());

    let ring_on = inst.game.as_ref().map(|_| {
        !inst.master_is_off().unwrap_or(false)
            && installed.iter().any(|r| {
                crate::emblem_ring::RING_CATEGORIES.contains(&s(r, "categoryId").as_str())
                    && r.get("enabled") != Some(&Value::Bool(false))
            })
    });

    let listed: Vec<Value> = installed
        .into_iter()
        .map(|rec| {
            let id = s(&rec, "id");
            let mut row: Map<String, Value> = rec.as_object().cloned().unwrap_or_default();
            let schema = row.get("schema").and_then(Value::as_array).map(Vec::len);
            if schema.is_some() {
                row.shift_remove("schema");
            }
            row.insert("zone".into(), json!(crate::slot_zones::zone_for(&s(&rec, "categoryId"))));
            row.insert("staleMap".into(), json!(terrains.get(&id).is_some_and(|a| a.stale)));
            if let Some(n) = schema {
                row.insert("schemaCount".into(), json!(n));
                row.insert("schemaLive".into(), json!(schema_on));
            }
            if let Some(by) = covered.get(&id) {
                row.insert("coveredBy".into(), json!(by));
            }
            if let Some(p) = pre_patch.get(&id) {
                row.insert("prePatch".into(), p.clone());
            }
            if behind.contains(&id) {
                row.insert("updateAvailable".into(), json!(true));
            }
            Value::Object(row)
        })
        .collect();
    let answer = json!({ "installed": listed, "external": external, "slots": slots, "slotCeil": 98, "verifyStuck": verify_stuck });
    (answer, After { ring_on })
}
