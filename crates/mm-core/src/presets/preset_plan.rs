//! How a preset travels to somebody else (src/preset-plan.ts). A mod the catalog can hand the
//! receiver goes as its identity, a few bytes; one it cannot goes as its own bytes, packed into
//! the file; one with neither is named and left out. This is where that is decided, for the share
//! dialog's plan, for a link, and for the card that says what installing a received preset would do.
//!
//! The catalog comes in as the data it loaded (`mods.modsData`); fetching it is the caller's.

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use crate::i18n::t;
use crate::installer::Installer;
use crate::js::{string, truthy};
use crate::library::Library;
use crate::overlays::files_of;

/// A template string of a value as JavaScript writes it: `${undefined}` is "undefined".
fn tmpl(v: Option<&Value>) -> String {
    v.map_or_else(|| "undefined".into(), string)
}

fn or_empty(v: Option<&Value>) -> String {
    match v {
        Some(v) if truthy(v) => string(v),
        _ => String::new(),
    }
}

fn key(c: Option<&Value>, n: Option<&Value>, s: Option<&Value>) -> String {
    format!("{}|{}|{}", tmpl(c), tmpl(n), or_empty(s))
}

/// The mods of one catalog category: a flat array, or grouped under `groups` (creeps, towers,
/// hero items...), the two shapes the catalog view walks.
pub fn category_mod_list(data: &Value) -> Vec<Value> {
    match data {
        Value::Array(a) => a.clone(),
        Value::Object(o) => match o.get("groups") {
            Some(Value::Array(g)) => {
                g.iter().flat_map(|g| g.get("mods").and_then(Value::as_array).cloned().unwrap_or_default()).collect()
            }
            _ => vec![],
        },
        _ => vec![],
    }
}

/// Every catalog mod by "<categoryId>|<name>|<styleLabel>": what mods:install needs to fetch it.
/// Empty means nothing in the catalog (offline, nothing cached), and a preset's own embedded
/// mods still travel.
#[derive(Default)]
pub struct CatalogIndex {
    map: HashMap<String, Value>,
}

impl CatalogIndex {
    /// Over the catalog as loaded; None for one that could not be.
    pub fn new(data: Option<&Value>) -> CatalogIndex {
        let mut map = HashMap::new();
        let mods = data.and_then(|d| d.get("mods")).and_then(|m| m.get("modsData")).and_then(Value::as_object);
        for (category, list) in mods.into_iter().flatten() {
            let c = json!(category);
            for m in category_mod_list(list) {
                let Some(name) = m.get("name").filter(|n| truthy(n)) else { continue };
                let hit = |label: Value, file: Option<&Value>, preview: Option<&Value>| {
                    let mut o = Map::new();
                    o.insert("categoryId".into(), c.clone());
                    o.insert("name".into(), name.clone());
                    o.insert("styleLabel".into(), label);
                    if let Some(f) = file {
                        o.insert("fileRef".into(), f.clone());
                    }
                    if let Some(p) = preview {
                        o.insert("preview".into(), p.clone());
                    }
                    Value::Object(o)
                };
                match m.get("styles") {
                    Some(Value::Array(styles)) => {
                        for s in styles {
                            let label = s.get("label");
                            map.insert(
                                key(Some(&c), Some(name), label),
                                hit(label.cloned().unwrap_or(Value::Null), s.get("file"), s.get("preview")),
                            );
                        }
                    }
                    _ => {
                        map.insert(key(Some(&c), Some(name), None), hit(Value::Null, m.get("file"), m.get("preview")));
                    }
                }
            }
        }
        CatalogIndex { map }
    }

    pub fn lookup(&self, c: Option<&Value>, n: Option<&Value>, s: Option<&Value>) -> Option<&Value> {
        self.map.get(&key(c, n, s))
    }

    fn has(&self, rec: &Value) -> bool {
        self.lookup(rec.get("categoryId"), rec.get("name"), rec.get("styleLabel")).is_some()
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}

/// Where an embedded mod's bytes come from once the file is written.
#[derive(Debug, Clone)]
pub enum Load {
    /// a record's lang files merged into one VPK, its lifted item blocks back in
    Merge { files: Value, schema: Value },
    /// a pack member, already one VPK on disk
    File(PathBuf),
}

/// A mod as it would be shared: its line, and for an embedded one where its bytes are.
#[derive(Debug, Clone)]
pub struct ShareEntry {
    pub line: Map<String, Value>,
    pub load: Option<Load>,
    pub members: Vec<ShareEntry>,
}

impl ShareEntry {
    fn of(line: Value) -> ShareEntry {
        ShareEntry { line: line.as_object().cloned().unwrap_or_default(), load: None, members: vec![] }
    }

    pub fn kind(&self) -> &str {
        self.line.get("kind").and_then(Value::as_str).unwrap_or("")
    }

    /// The bytes of an embedded mod.
    pub fn data(&self, inst: &Installer) -> Result<Option<Vec<u8>>, String> {
        match &self.load {
            None => Ok(None),
            Some(Load::File(p)) => std::fs::read(p).map(Some).map_err(|e| e.to_string()),
            Some(Load::Merge { files, schema }) => {
                let deltas: Option<Vec<Vec<u8>>> = schema
                    .as_array()
                    .map(|d| d.iter().map(|b| string(&b["block"]).chars().map(|c| c as u8).collect()).collect());
                inst.merge_to_single_vpk(&files_of(files), deltas.as_deref()).map(Some)
            }
        }
    }

    /// The line with its members, as the window and the file see it.
    pub fn to_value(&self) -> Value {
        let mut line = self.line.clone();
        if self.kind() == "pack" {
            line.insert("members".into(), Value::Array(self.members.iter().map(ShareEntry::to_value).collect()));
        }
        Value::Object(line)
    }
}

fn analysis(inst: &Installer, rec: &Value) -> Value {
    inst.analyze_record(&files_of(rec.get("files").unwrap_or(&Value::Null))).unwrap_or(json!({}))
}

fn or_null(v: Option<&Value>) -> Value {
    v.filter(|v| truthy(v)).cloned().unwrap_or(Value::Null)
}

fn get(v: &Value, k: &str) -> Value {
    v.get(k).cloned().unwrap_or(Value::Null)
}

fn lang_files(rec: &Value) -> Vec<Value> {
    rec.get("files")
        .and_then(Value::as_array)
        .map(|f| f.iter().filter(|f| f.get("root").and_then(Value::as_str) == Some("lang")).cloned().collect())
        .unwrap_or_default()
}

/// Whether a record has a _dir.vpk among its lang files.
pub fn has_lang_vpk(rec: &Value) -> bool {
    lang_files(rec).iter().any(|f| string(&get(f, "relPath")).to_lowercase().ends_with("_dir.vpk"))
}

/// How one library record travels: as a catalog identity when the catalog can hand it to the
/// receiver, otherwise as its own bytes, which are read only when the file is written.
pub fn share_entry_for(inst: &Installer, rec: &Value, cat: &CatalogIndex) -> ShareEntry {
    let imported = rec.get("categoryId").and_then(Value::as_str) == Some("imported");
    if !imported && cat.has(rec) {
        return ShareEntry::of(
            json!({ "kind": "catalog", "categoryId": get(rec, "categoryId"), "name": get(rec, "name"),
            "styleLabel": or_null(rec.get("styleLabel")), "fp": or_null(analysis(inst, rec).get("fp")), "size": 0 }),
        );
    }
    if !has_lang_vpk(rec) {
        return ShareEntry::of(
            json!({ "kind": "missing", "name": get(rec, "name"), "reason": t("нет в каталоге и нечего вложить", &[]) }),
        );
    }
    let mut size = 0u64;
    if let Ok(lang) = inst.lang_folder() {
        for f in lang_files(rec) {
            let abs = lang.join(string(&get(&f, "relPath")));
            let found = ["", ".off", ".moff"]
                .iter()
                .map(|s| PathBuf::from(format!("{}{s}", abs.display())))
                .find(|p| p.exists());
            if let Some(p) = found {
                size += std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    let a = analysis(inst, rec);
    let mut e =
        ShareEntry::of(json!({ "kind": "embedded", "name": get(rec, "name"), "categoryId": get(rec, "categoryId"),
        "info": or_empty(a.get("info")), "fp": or_null(a.get("fp")), "size": size }));
    e.load = Some(Load::Merge { files: get(rec, "files"), schema: get(rec, "schema") });
    e
}

/// A pack travels as its members: each keeps its own identity, and the receiver rebuilds the pack.
pub fn pack_share_entry(inst: &Installer, rec: &Value, cat: &CatalogIndex) -> ShareEntry {
    let pack_id = string(&get(rec, "id"));
    let members = rec
        .get("members")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let imported = m.get("categoryId").and_then(Value::as_str) == Some("imported");
            if !imported && cat.has(m) {
                return ShareEntry::of(json!({ "kind": "catalog", "categoryId": get(m, "categoryId"), "name": get(m, "name"),
                    "styleLabel": or_null(m.get("styleLabel")), "fp": or_null(m.get("fp")), "size": 0 }));
            }
            let src = inst.pack_member_file(&pack_id, &tmpl(m.get("id")));
            let Ok(meta) = std::fs::metadata(&src) else {
                return ShareEntry::of(json!({ "kind": "missing", "name": get(m, "name"), "reason": t("файл участника пака не найден", &[]) }));
            };
            let mut e = ShareEntry::of(json!({ "kind": "embedded", "name": get(m, "name"), "categoryId": get(m, "categoryId"),
                "info": or_empty(m.get("info")), "fp": or_null(m.get("fp")), "size": meta.len() }));
            e.load = Some(Load::File(src));
            e
        })
        .collect();
    let mut e = ShareEntry::of(json!({ "kind": "pack", "name": get(rec, "name") }));
    e.members = members;
    e
}

fn cosmetic_entry(p: &Value) -> Value {
    let mut o = Map::new();
    o.insert("kind".into(), json!("cosmetic"));
    if let Some(p) = p.as_object() {
        for (k, v) in p {
            o.insert(k.clone(), v.clone());
        }
    }
    Value::Object(o)
}

/// Every mod of a preset, described the way it would be shared; its looks as slot and item.
pub fn preset_share_entries(
    lib: &Library,
    inst: &Installer,
    preset: &Value,
    cat: &CatalogIndex,
) -> Result<Vec<ShareEntry>, String> {
    let mut out = Vec::new();
    for id in lib.preset_mod_ids(Some(preset))? {
        let Some(rec) = lib.find(&id) else { continue };
        out.push(if rec.get("kind").and_then(Value::as_str) == Some("pack") {
            pack_share_entry(inst, rec, cat)
        } else {
            share_entry_for(inst, rec, cat)
        });
    }
    for p in preset.get("picks").and_then(Value::as_array).into_iter().flatten() {
        out.push(ShareEntry::of(cosmetic_entry(p)));
    }
    Ok(out)
}

/// The plan as the window is shown it: no loaders, and a `key` it sends back to leave one out.
pub fn plan_shape(entries: &[ShareEntry]) -> Vec<Value> {
    fn plain(e: &ShareEntry, key: String) -> Map<String, Value> {
        let field = |k: &str, zero: Value| e.line.get(k).filter(|v| truthy(v)).cloned().unwrap_or(zero);
        let mut o = Map::new();
        o.insert("key".into(), json!(key));
        o.insert("kind".into(), get(&Value::Object(e.line.clone()), "kind"));
        o.insert("name".into(), get(&Value::Object(e.line.clone()), "name"));
        o.insert("size".into(), field("size", json!(0)));
        o.insert("info".into(), field("info", json!("")));
        o.insert("reason".into(), field("reason", json!("")));
        o
    }
    entries
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let mut o = plain(e, i.to_string());
            if e.kind() == "pack" {
                o.insert(
                    "members".into(),
                    Value::Array(
                        e.members
                            .iter()
                            .enumerate()
                            .map(|(j, m)| Value::Object(plain(m, format!("{i}.{j}"))))
                            .collect(),
                    ),
                );
            }
            Value::Object(o)
        })
        .collect()
}

/// fingerprint -> installed record id, so a shared mod already on disk is not written twice.
pub fn installed_fp_index(lib: &Library, inst: &Installer) -> HashMap<String, Value> {
    let mut map = HashMap::new();
    for rec in lib.list() {
        if rec.get("kind").and_then(Value::as_str) == Some("pack") {
            continue;
        }
        if let Some(fp) = inst
            .analyze_record(&files_of(rec.get("files").unwrap_or(&Value::Null)))
            .and_then(|a| a.get("fp").filter(|f| truthy(f)).map(string))
        {
            map.insert(fp, get(rec, "id"));
        }
    }
    map
}

/// The mods of a preset flattened for a link, and the names of those that cannot ride along (a
/// user's own import): the rest of the build still travels. A pack flattens to its members.
pub fn preset_link_mods(lib: &Library, preset: &Value, cat: &CatalogIndex) -> Result<(Vec<Value>, Vec<Value>), String> {
    let mut mods = Vec::new();
    let mut skipped = Vec::new();
    for id in lib.preset_mod_ids(Some(preset))? {
        let Some(rec) = lib.find(&id) else { continue };
        let items: Vec<Value> = if rec.get("kind").and_then(Value::as_str) == Some("pack") {
            rec.get("members").and_then(Value::as_array).cloned().unwrap_or_default()
        } else {
            vec![rec.clone()]
        };
        for it in items {
            if it.get("categoryId").and_then(Value::as_str) == Some("imported") || !cat.has(&it) {
                skipped.push(get(&it, "name"));
                continue;
            }
            mods.push(json!({ "kind": "catalog", "categoryId": get(&it, "categoryId"), "name": get(&it, "name"), "styleLabel": or_null(it.get("styleLabel")) }));
        }
    }
    for p in preset.get("picks").and_then(Value::as_array).into_iter().flatten() {
        mods.push(cosmetic_entry(p));
    }
    Ok((mods, skipped))
}

/// What installing a received preset would do, for its card in the Presets tab.
pub fn shared_preset_status(lib: &Library, inst: &Installer, preset: &Value, cat: &CatalogIndex) -> Value {
    let fps = installed_fp_index(lib, inst);
    let (mut installed, mut download, mut embedded, mut free) = (0, 0, 0, 0);
    let mut unavailable = Vec::new();
    let mut visit = |e: &Value| match e.get("kind").and_then(Value::as_str) {
        Some("catalog") => {
            if lib.find_by_key(&get(e, "categoryId"), &get(e, "name"), e.get("styleLabel")).is_some() {
                installed += 1;
            } else if cat.has(e) {
                download += 1;
            } else {
                unavailable.push(get(e, "name"));
            }
        }
        Some("embedded") => {
            if e.get("fp").filter(|f| truthy(f)).is_some_and(|f| fps.contains_key(&string(f))) {
                installed += 1;
            } else {
                embedded += 1;
            }
        }
        Some("cosmetic") => {
            let effect = |v: &Value| or_empty(v.get("effectId"));
            let have = lib.list().iter().find(|r| {
                r.get("categoryId").and_then(Value::as_str) == Some("cosmetic")
                    && r.get("slot") == e.get("slot")
                    && r.get("itemId") == e.get("itemId")
                    && effect(r) == effect(e)
            });
            if have.is_some_and(|h| h.get("enabled") != Some(&Value::Bool(false))) {
                installed += 1;
            } else {
                free += 1;
            }
        }
        _ => unavailable.push(get(e, "name")),
    };
    for e in preset.get("wanted").and_then(Value::as_array).into_iter().flatten() {
        if e.get("kind").and_then(Value::as_str) == Some("pack") {
            e.get("members").and_then(Value::as_array).into_iter().flatten().for_each(&mut visit);
        } else {
            visit(e);
        }
    }
    json!({ "installed": installed, "download": download, "embedded": embedded, "free": free, "unavailable": unavailable })
}
