//! manifest.json in userData: the installed mods and the presets. Replacing src/library.ts, whose
//! comments say why a preset holds a mod's identity and not its id, and why a look is kept apart.
//!
//! Records stay JSON objects, so every field another part of the app keeps on one survives a save.
//! A key the TypeScript left undefined (and JSON.stringify then dropped) is a key not inserted.

use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

use crate::atomic_file::write_file_atomic;
use crate::file_tx::FileTx;
use crate::js;

/// `o.key`, None for undefined.
fn get<'a>(o: &'a Value, k: &str) -> Option<&'a Value> {
    o.as_object().and_then(|m| m.get(k))
}

fn truthy(v: Option<&Value>) -> bool {
    v.is_some_and(js::truthy)
}

/// `x || null`.
fn or_null(v: Option<&Value>) -> Value {
    v.filter(|v| js::truthy(v)).cloned().unwrap_or(Value::Null)
}

/// `a === b`, undefined being equal to undefined only.
fn same(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(Value::Number(x)), Some(Value::Number(y))) => x.as_f64() == y.as_f64(),
        (Some(x @ (Value::Array(_) | Value::Object(_))), Some(y)) => std::ptr::eq(x, y),
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}

/// A value as a template literal writes it: undefined as "undefined".
fn template(v: Option<&Value>) -> String {
    v.map_or_else(|| "undefined".into(), js::string)
}

fn put(o: &mut Map<String, Value>, k: &str, v: Option<&Value>) {
    if let Some(v) = v {
        o.insert(k.to_string(), v.clone());
    }
}

fn now() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_millis() as f64)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// A preset's member: what it asks for, and the record on this machine that is it.
#[derive(Debug, Clone, PartialEq)]
pub struct Member {
    pub identity: Value,
    pub rec: Option<Value>,
}

/// The library.
pub struct Library {
    pub file: PathBuf,
    pub data: Map<String, Value>,
}

fn empty() -> Map<String, Value> {
    match json!({ "installed": [], "presets": [] }) {
        Value::Object(o) => o,
        _ => Map::new(),
    }
}

impl Library {
    pub fn new(user_data_dir: &Path) -> Library {
        let mut l = Library { file: user_data_dir.join("manifest.json"), data: empty() };
        l.load();
        l
    }

    /// Read the file; a corrupted one is kept beside itself as .bak and the library stays as it was.
    pub fn load(&mut self) {
        let Ok(bytes) = std::fs::read(&self.file) else { return };
        match serde_json::from_str::<Value>(&String::from_utf8_lossy(&bytes)) {
            Ok(parsed) => {
                let mut data = empty();
                match parsed {
                    Value::Object(o) => data.extend(o),
                    Value::Array(a) => data.extend(a.into_iter().enumerate().map(|(i, v)| (i.to_string(), v))),
                    Value::String(s) => data.extend(
                        s.encode_utf16()
                            .enumerate()
                            .map(|(i, c)| (i.to_string(), Value::String(String::from_utf16_lossy(&[c])))),
                    ),
                    _ => {}
                }
                self.data = data;
            }
            Err(_) => {
                let mut bak = self.file.as_os_str().to_owned();
                bak.push(".bak");
                let _ = std::fs::copy(&self.file, PathBuf::from(bak));
            }
        }
    }

    /// The file as JSON.stringify(data, null, 2) writes it.
    pub fn text(&self) -> String {
        js::stringify(&Value::Object(self.data.clone()), "  ")
    }

    /// Write the manifest: as one more step of a change when handed one (its record and its files
    /// commit together; a rollback leaves the caller to load() again), else in one step.
    pub fn save(&self, tx: Option<&mut FileTx>) -> std::io::Result<()> {
        let text = self.text();
        match tx {
            Some(tx) => tx.write(&self.file, text.as_bytes()).map(|_| ()),
            None => write_file_atomic(&self.file, text.as_bytes()),
        }
    }

    fn installed(&self) -> &[Value] {
        self.data.get("installed").and_then(Value::as_array).map_or(&[], Vec::as_slice)
    }

    fn installed_mut(&mut self) -> &mut Vec<Value> {
        let v = self.data.entry("installed").or_insert_with(|| json!([]));
        if !v.is_array() {
            *v = json!([]);
        }
        v.as_array_mut().expect("made an array above")
    }

    fn presets(&self) -> &[Value] {
        self.data.get("presets").and_then(Value::as_array).map_or(&[], Vec::as_slice)
    }

    fn presets_mut(&mut self) -> &mut Vec<Value> {
        let v = self.data.entry("presets").or_insert_with(|| json!([]));
        if !v.is_array() {
            *v = json!([]);
        }
        v.as_array_mut().expect("made an array above")
    }

    pub fn list(&self) -> &[Value] {
        self.installed()
    }

    fn index_of(&self, id: &Value) -> Option<usize> {
        self.installed().iter().position(|m| same(get(m, "id"), Some(id)))
    }

    pub fn find(&self, id: &Value) -> Option<&Value> {
        self.index_of(id).map(|i| &self.installed()[i])
    }

    pub fn find_by_key(&self, category_id: &Value, name: &Value, style_label: Option<&Value>) -> Option<&Value> {
        let want = or_null(style_label);
        self.installed().iter().find(|m| {
            same(get(m, "categoryId"), Some(category_id))
                && same(get(m, "name"), Some(name))
                && or_null(get(m, "styleLabel")) == want
        })
    }

    /// Add a record from `{ name, categoryId, styleLabel, fileRef, preview, files, kind, members }`.
    pub fn add(&mut self, new: &Value, tx: Option<&mut FileTx>) -> std::io::Result<Value> {
        let mut rec = Map::new();
        rec.insert("id".into(), Value::String(new_id()));
        put(&mut rec, "name", get(new, "name"));
        put(&mut rec, "categoryId", get(new, "categoryId"));
        rec.insert("styleLabel".into(), or_null(get(new, "styleLabel")));
        put(&mut rec, "fileRef", get(new, "fileRef"));
        rec.insert("preview".into(), or_null(get(new, "preview")));
        put(&mut rec, "files", get(new, "files"));
        rec.insert("enabled".into(), Value::Bool(true));
        rec.insert("installedAt".into(), js::json_number(now()));
        if truthy(get(new, "kind")) {
            put(&mut rec, "kind", get(new, "kind"));
        }
        if truthy(get(new, "members")) {
            put(&mut rec, "members", get(new, "members"));
        }
        let rec = Value::Object(rec);
        self.installed_mut().push(rec.clone());
        self.save(tx)?;
        Ok(rec)
    }

    pub fn update(&mut self, id: &Value, fields: &Value, tx: Option<&mut FileTx>) -> std::io::Result<Option<Value>> {
        let Some(i) = self.index_of(id) else { return Ok(None) };
        if let (Some(rec), Some(f)) = (self.installed_mut()[i].as_object_mut(), fields.as_object()) {
            rec.extend(f.clone());
        }
        self.save(tx)?;
        Ok(Some(self.installed()[i].clone()))
    }

    /// Drop fields from a record (TypeScript sets them undefined, and JSON leaves them out).
    pub fn drop_fields(
        &mut self,
        id: &Value,
        keys: &[&str],
        tx: Option<&mut FileTx>,
    ) -> std::io::Result<Option<Value>> {
        let Some(i) = self.index_of(id) else { return Ok(None) };
        if let Some(rec) = self.installed_mut()[i].as_object_mut() {
            for k in keys {
                rec.shift_remove(*k);
            }
        }
        self.save(tx)?;
        Ok(Some(self.installed()[i].clone()))
    }

    pub fn set_enabled(
        &mut self,
        id: &Value,
        enabled: bool,
        tx: Option<&mut FileTx>,
    ) -> std::io::Result<Option<Value>> {
        self.update(id, &json!({ "enabled": enabled }), tx)
    }

    pub fn remove_record(&mut self, id: &Value, tx: Option<&mut FileTx>) -> std::io::Result<()> {
        self.installed_mut().retain(|m| !same(get(m, "id"), Some(id)));
        self.save(tx)
    }

    fn files_of(m: &Value) -> Result<&[Value], String> {
        match get(m, "files") {
            Some(Value::Array(a)) => Ok(a),
            _ => Err("m.files is not iterable".into()),
        }
    }

    pub fn known_lang_rel_paths(&self) -> Result<Vec<Value>, String> {
        let mut out = Vec::new();
        for m in self.installed() {
            for f in Self::files_of(m)? {
                if get(f, "root") == Some(&json!("lang")) {
                    out.push(get(f, "relPath").cloned().unwrap_or(Value::Null));
                }
            }
        }
        Ok(out)
    }

    /// Every installed file across all roots, to tell app-managed content from foreign files.
    pub fn known_files(&self) -> Result<Vec<Value>, String> {
        let mut out = Vec::new();
        for m in self.installed() {
            for f in Self::files_of(m)? {
                let mut o = Map::new();
                put(&mut o, "root", get(f, "root"));
                put(&mut o, "relPath", get(f, "relPath"));
                out.push(Value::Object(o));
            }
        }
        Ok(out)
    }

    // ---------- presets ----------

    pub fn list_presets(&self) -> &[Value] {
        self.presets()
    }

    /// A preset's mods; a free cosmetic is not one of them.
    pub fn in_preset(rec: Option<&Value>) -> bool {
        rec.is_some_and(|r| js::truthy(r) && !same(get(r, "categoryId"), Some(&json!("cosmetic"))))
    }

    /// A look on the library's books: a cosmetic record with a slot and an item.
    pub fn is_pick(rec: Option<&Value>) -> bool {
        rec.is_some_and(|r| {
            js::truthy(r)
                && same(get(r, "categoryId"), Some(&json!("cosmetic")))
                && truthy(get(r, "slot"))
                && truthy(get(r, "itemId"))
        })
    }

    pub fn pick_of(rec: &Value) -> Value {
        let mut o = Map::new();
        o.insert("slot".into(), Value::String(template(get(rec, "slot"))));
        o.insert("itemId".into(), Value::String(template(get(rec, "itemId"))));
        put(&mut o, "name", get(rec, "name"));
        o.insert("effectId".into(), Value::String(js::string(&or_empty(get(rec, "effectId")))));
        Value::Object(o)
    }

    /// The looks that are on, slot by slot, apart from the mods.
    pub fn picks_on(&self) -> Vec<Value> {
        self.installed()
            .iter()
            .filter(|m| get(m, "enabled") != Some(&Value::Bool(false)) && Self::is_pick(Some(m)))
            .map(Self::pick_of)
            .collect()
    }

    /// What a preset remembers about one mod.
    pub fn identity_of(rec: &Value) -> Value {
        let mut o = Map::new();
        let cat = get(rec, "categoryId").filter(|v| js::truthy(v)).cloned().unwrap_or(json!("imported"));
        o.insert("categoryId".into(), cat);
        put(&mut o, "name", get(rec, "name"));
        o.insert("styleLabel".into(), or_null(get(rec, "styleLabel")));
        o.insert("fp".into(), or_null(get(rec, "fp")));
        Value::Object(o)
    }

    pub fn same_mod(identity: Option<&Value>, rec: Option<&Value>) -> bool {
        let (Some(identity), Some(rec)) = (identity.filter(|v| js::truthy(v)), rec.filter(|v| js::truthy(v))) else {
            return false;
        };
        if truthy(get(identity, "fp")) && truthy(get(rec, "fp")) {
            return same(get(identity, "fp"), get(rec, "fp"));
        }
        let cat = get(rec, "categoryId").filter(|v| js::truthy(v)).cloned().unwrap_or(json!("imported"));
        same(Some(&cat), get(identity, "categoryId"))
            && same(get(rec, "name"), get(identity, "name"))
            && or_null(get(rec, "styleLabel")) == or_null(get(identity, "styleLabel"))
    }

    fn mods_now(&self) -> Vec<Value> {
        self.installed()
            .iter()
            .filter(|m| truthy(get(m, "enabled")) && Self::in_preset(Some(m)))
            .map(Self::identity_of)
            .collect()
    }

    pub fn save_preset(&mut self, name: &Value, tx: Option<&mut FileTx>) -> std::io::Result<()> {
        let (mods, picks) = (Value::Array(self.mods_now()), Value::Array(self.picks_on()));
        let existing =
            self.presets().iter().position(|p| same(get(p, "name"), Some(name)) && !truthy(get(p, "wanted")));
        match existing {
            Some(i) => {
                if let Some(p) = self.presets_mut()[i].as_object_mut() {
                    p.insert("mods".into(), mods);
                    p.insert("picks".into(), picks);
                    p.shift_remove("modIds");
                    p.insert("updatedAt".into(), js::json_number(now()));
                }
            }
            None => {
                let p = json!({ "id": new_id(), "name": name, "mods": mods, "picks": picks, "updatedAt": js::json_number(now()) });
                self.presets_mut().push(p);
            }
        }
        self.save(tx)
    }

    fn preset_index(&self, id: &Value) -> Option<usize> {
        self.presets().iter().position(|p| same(get(p, "id"), Some(id)))
    }

    /// Re-capture what is enabled right now into an existing preset.
    pub fn update_preset_mods(&mut self, preset_id: &Value, tx: Option<&mut FileTx>) -> std::io::Result<Option<Value>> {
        let Some(i) = self.preset_index(preset_id) else { return Ok(None) };
        if truthy(get(&self.presets()[i], "wanted")) {
            return Ok(None);
        }
        let (mods, picks) = (Value::Array(self.mods_now()), Value::Array(self.picks_on()));
        if let Some(p) = self.presets_mut()[i].as_object_mut() {
            p.insert("mods".into(), mods);
            p.insert("picks".into(), picks);
            p.shift_remove("modIds");
            p.insert("updatedAt".into(), js::json_number(now()));
        }
        self.save(tx)?;
        Ok(Some(self.presets()[i].clone()))
    }

    /// A preset that arrived as a .d2mm and has not been installed: `{ name, note, author, wanted, sourceFile }`.
    pub fn add_shared_preset(&mut self, shared: &Value, tx: Option<&mut FileTx>) -> std::io::Result<Value> {
        let t = js::json_number(now());
        let mut p = Map::new();
        p.insert("id".into(), Value::String(new_id()));
        put(&mut p, "name", get(shared, "name"));
        p.insert("modIds".into(), json!([]));
        p.insert("updatedAt".into(), t.clone());
        put(&mut p, "wanted", get(shared, "wanted"));
        p.insert(
            "source".into(),
            json!({
                "note": or_empty(get(shared, "note")),
                "author": or_empty(get(shared, "author")),
                "file": or_null(get(shared, "sourceFile")),
                "importedAt": t,
            }),
        );
        let p = Value::Object(p);
        self.presets_mut().push(p.clone());
        self.save(tx)?;
        Ok(p)
    }

    pub fn update_preset(
        &mut self,
        id: &Value,
        fields: &Value,
        tx: Option<&mut FileTx>,
    ) -> std::io::Result<Option<Value>> {
        let Some(i) = self.preset_index(id) else { return Ok(None) };
        if let (Some(p), Some(f)) = (self.presets_mut()[i].as_object_mut(), fields.as_object()) {
            p.extend(f.clone());
        }
        self.save(tx)?;
        Ok(Some(self.presets()[i].clone()))
    }

    pub fn delete_preset(&mut self, preset_id: &Value, tx: Option<&mut FileTx>) -> std::io::Result<()> {
        self.presets_mut().retain(|p| !same(get(p, "id"), Some(preset_id)));
        self.save(tx)
    }

    pub fn get_preset(&self, preset_id: &Value) -> Option<&Value> {
        self.preset_index(preset_id).map(|i| &self.presets()[i])
    }

    /// What a preset asks for, and whether each one is on this machine; a preset of install ids
    /// (the shape before identities) is read as identities.
    pub fn preset_members(&self, preset: Option<&Value>) -> Result<Vec<Member>, String> {
        let mut out: Vec<Member> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut push = |identity: Value, rec: Option<&Value>| {
            let key = format!(
                "{}|{}|{}",
                template(get(&identity, "categoryId")),
                template(get(&identity, "name")),
                js::string(&or_empty(get(&identity, "styleLabel")))
            );
            if seen.insert(key) {
                out.push(Member { identity, rec: rec.cloned() });
            }
        };
        let preset = preset.filter(|p| !p.is_null());
        let mods = preset.and_then(|p| get(p, "mods")).filter(|m| js::truthy(m));
        if let Some(mods) = mods {
            let Some(list) = mods.as_array() else { return Err("preset.mods is not iterable".into()) };
            for identity in list {
                if identity.is_null() {
                    return Err("Cannot read properties of null (reading 'categoryId')".into());
                }
                if same(get(identity, "categoryId"), Some(&json!("cosmetic"))) {
                    continue;
                }
                push(identity.clone(), self.installed().iter().find(|r| Self::same_mod(Some(identity), Some(r))));
            }
        } else {
            let ids = preset.and_then(|p| get(p, "modIds")).filter(|m| js::truthy(m));
            for id in ids.and_then(Value::as_array).map_or(&[][..], Vec::as_slice) {
                let Some(rec) = self.find(id) else { continue };
                if !Self::in_preset(Some(rec)) {
                    continue;
                }
                push(Self::identity_of(rec), Some(rec));
            }
        }
        Ok(out)
    }

    /// The installed records a preset names.
    pub fn preset_mod_ids(&self, preset: Option<&Value>) -> Result<Vec<Value>, String> {
        Ok(self
            .preset_members(preset)?
            .into_iter()
            .filter_map(|m| m.rec.map(|r| get(&r, "id").cloned().unwrap_or(Value::Null)))
            .collect())
    }
}

/// `x || ''`.
fn or_empty(v: Option<&Value>) -> Value {
    v.filter(|v| js::truthy(v)).cloned().unwrap_or(json!(""))
}
