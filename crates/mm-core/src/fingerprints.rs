//! The fingerprint index (src/fingerprints.ts): fp -> catalog mod identity, cached in userData,
//! so a foreign VPK in the game folder can be named as a specific catalog mod, and font mods are
//! known by the hash of every file they put in panorama/fonts. Fetching it moves with the network.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Where the map is published: the catalog-data branch the catalog job commits to.
pub const FP_URL: &str =
    "https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/catalog-data/fingerprints.json";

/// A catalog mod a fingerprint points at.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub name: String,
    pub category_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_label: Option<Value>,
}

/// A font mod, known by the hash of every file it puts in panorama/fonts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMod {
    pub name: String,
    pub category_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_label: Option<Value>,
    pub files: indexmap::IndexMap<String, String>,
}

pub struct Fingerprints {
    pub file: PathBuf,
    /// fingerprint -> the identity, or the list of identities, as the file has it; None until read
    map: Option<serde_json::Map<String, Value>>,
    pub fonts: Vec<FontMod>,
    by_mod: Option<HashMap<String, HashSet<String>>>,
}

fn identities(v: &Value) -> Vec<Identity> {
    match v {
        Value::Array(a) => a.iter().filter_map(|x| serde_json::from_value(x.clone()).ok()).collect(),
        other => serde_json::from_value(other.clone()).ok().into_iter().collect(),
    }
}

fn style_text(v: &Option<Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(v) if !crate::js::truthy(v) => String::new(),
        Some(v) => crate::js::string(v),
    }
}

impl Fingerprints {
    pub fn new(user_data: &Path) -> Fingerprints {
        Fingerprints { file: user_data.join("fingerprints.json"), map: None, fonts: Vec::new(), by_mod: None }
    }

    /// Take a parsed fingerprints.json.
    pub fn apply(&mut self, data: &Value) {
        self.map = Some(data.get("mods").and_then(Value::as_object).cloned().unwrap_or_default());
        self.by_mod = None;
        self.fonts = data
            .get("fonts")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|f| serde_json::from_value(f.clone()).ok()).collect())
            .unwrap_or_default();
    }

    pub fn load_cache(&mut self) {
        match fs::read_to_string(&self.file).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
            Some(v) if v.is_object() => self.apply(&v),
            _ => {
                self.map = Some(Default::default());
                self.fonts = Vec::new();
            }
        }
    }

    fn ensure(&mut self) -> &serde_json::Map<String, Value> {
        if self.map.is_none() {
            self.load_cache();
        }
        self.map.as_ref().unwrap()
    }

    /// Whether there is anything to match against (folder scans are skipped otherwise).
    pub fn has_data(&mut self) -> bool {
        !self.ensure().is_empty() || !self.fonts.is_empty()
    }

    /// Validate fetched text and keep it: the map in memory and the file in userData.
    pub fn store(&mut self, text: &str) -> Result<(), String> {
        let v: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
        self.apply(&v);
        if let Some(d) = self.file.parent() {
            fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        fs::write(&self.file, text).map_err(|e| e.to_string())
    }

    /// The catalog mods this fingerprint is (several can share a file), or None.
    pub fn matches(&mut self, fp: Option<&str>) -> Option<Vec<Value>> {
        let fp = fp.filter(|f| !f.is_empty())?;
        let v = self.ensure().get(fp)?.clone();
        if !crate::js::truthy(&v) {
            return None;
        }
        Some(match v {
            Value::Array(a) => a,
            other => vec![other],
        })
    }

    /// The fingerprints a catalog mod's file has today, or None when the index does not know it.
    pub fn prints_of(
        &mut self,
        category_id: &str,
        name: &str,
        style_label: &Option<Value>,
    ) -> Option<&HashSet<String>> {
        let key = |c: &str, n: &str, s: &Option<Value>| format!("{c}\u{0}{n}\u{0}{}", style_text(s));
        if self.by_mod.is_none() {
            let mut by: HashMap<String, HashSet<String>> = HashMap::new();
            for (fp, v) in self.ensure().clone() {
                for x in identities(&v) {
                    by.entry(key(&x.category_id, &x.name, &x.style_label)).or_default().insert(fp.clone());
                }
            }
            self.by_mod = Some(by);
        }
        self.by_mod.as_ref().unwrap().get(&key(category_id, name, style_label))
    }

    /// Font mods with every one of their files present in the folder, by name and hash.
    pub fn match_fonts(&mut self, folder: &BTreeMap<String, String>) -> Vec<FontMod> {
        self.ensure();
        self.fonts.iter().filter(|m| m.files.iter().all(|(n, h)| folder.get(n) == Some(h))).cloned().collect()
    }
}
