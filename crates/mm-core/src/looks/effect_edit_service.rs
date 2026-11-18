//! The effect editor's service (src/effect-edit-service.ts): finding an effect among the game's,
//! showing it changed, and a change put in My mods. The changes themselves are `effect_edit`. One
//! record per effect, built from the game's own file: making the same effect again replaces it, in
//! its place in the load order.
//!
//! The pictures and 3D resources the window plays an effect with (`sprites`, `resources`) are the
//! shell's: `load` answers without them. A rebuild after an update is `due`, then `rebuild_now`.

use std::path::PathBuf;
use std::sync::Arc;

use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Value};

use crate::effect_edit::{clean_edits, edited_entries, systems_of, EffectEdits};
use crate::effect_finder::EffectFinder;
use crate::generated_pak::{files_json, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::vpk::Index;

/// How many effects a search hands back: past that the words are too wide.
const SHOWN: usize = 60;
/// How many of an ability's effects the window plays at once.
const PLAYED: usize = 16;

/// The finder an ability's effects come from, with what it needs to be asked.
pub struct Finder<'a> {
    pub finder: &'a mut EffectFinder,
    pub lang: &'a str,
    /// the game's item table, for the particles items swap in
    pub table: Option<&'a str>,
}

fn ability_re() -> Regex {
    Regex::new(r"^ability:([a-z0-9_]{2,40})/([a-z0-9_]{2,80})$").expect("a fixed pattern")
}

fn unreadable() -> String {
    t("Не удалось прочитать эффект", &[])
}

fn valid(p: &Value) -> Result<String, String> {
    let s = crate::js::string(p).to_lowercase();
    let file = Regex::new(r"^particles/[A-Za-z0-9_/.-]+\.vpcf$").expect("a fixed pattern");
    if !file.is_match(&s) && !ability_re().is_match(&s) {
        return Err(unreadable());
    }
    Ok(s)
}

fn name_of(p: &str) -> String {
    let base = &p[p.rfind('/').map_or(0, |i| i + 1)..];
    base.strip_suffix(".vpcf").unwrap_or(base).to_string()
}

/// What one id stands for: the effects played, and what items put in their place.
struct Target {
    name: String,
    roots: Vec<String>,
    variants: Vec<String>,
}

fn effect_of(rec: &Value) -> Option<&str> {
    rec.get("generated").and_then(|g| g.get("effect")).and_then(Value::as_str).filter(|e| !e.is_empty())
}

/// The service the fx:* channels call.
pub struct EffectEdit {
    pub game: Option<PathBuf>,
    /// the game's particle paths, without `_c`, and the game they are of
    all: Option<(PathBuf, Arc<Vec<String>>)>,
}

impl EffectEdit {
    pub fn new(game: Option<PathBuf>) -> Self {
        EffectEdit { game, all: None }
    }

    fn index(&self) -> Result<(PathBuf, Arc<Index>), String> {
        let game =
            self.game.clone().filter(|g| !g.as_os_str().is_empty()).ok_or_else(|| t("Не указана папка игры", &[]))?;
        let ix =
            crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())?;
        Ok((game, ix))
    }

    fn paths(&mut self) -> Result<Arc<Vec<String>>, String> {
        let (game, ix) = self.index()?;
        if self.all.as_ref().map(|a| &a.0) != Some(&game) {
            let list: Vec<String> = ix
                .paths()
                .filter(|p| p.starts_with("particles/") && p.ends_with(".vpcf_c"))
                .map(|p| p[..p.len() - 2].to_string())
                .collect();
            self.all = Some((game, Arc::new(list)));
        }
        Ok(self.all.as_ref().expect("just set").1.clone())
    }

    fn target_of(&self, id: &str, finder: &mut Option<Finder>) -> Result<Target, String> {
        let (_, ix) = self.index()?;
        let Some(m) = ability_re().captures(id) else {
            let variants =
                finder.as_mut().map(|f| f.finder.variants(&ix, f.table, &[id.to_string()])).unwrap_or_default();
            return Ok(Target { name: name_of(id), roots: vec![id.to_string()], variants });
        };
        let f = finder.as_mut().ok_or_else(unreadable)?;
        let a = f.finder.ability(&ix, f.lang, &m[1], &m[2]).filter(|a| !a.paths.is_empty()).ok_or_else(unreadable)?;
        let variants = f.finder.variants(&ix, f.table, &a.files);
        Ok(Target {
            name: a.name.filter(|n| !n.is_empty()).unwrap_or_else(|| m[2].to_string()),
            roots: a.paths,
            variants,
        })
    }

    /// The changed files of a target, each once; an item's effect the reader cannot take stays as
    /// the game has it.
    fn entries_of(
        &self,
        target: &Target,
        edits: &EffectEdits,
        items: bool,
        log: &mut dyn FnMut(String),
    ) -> Result<IndexMap<String, Vec<u8>>, String> {
        let (_, ix) = self.index()?;
        let mut read = |p: &str| ix.read(p).ok().flatten();
        let mut out: IndexMap<String, Vec<u8>> = IndexMap::new();
        for r in &target.roots {
            for (p, data) in edited_entries(&mut read, r, edits)? {
                out.insert(p, data);
            }
        }
        if items {
            for v in &target.variants {
                match edited_entries(&mut read, v, edits) {
                    Ok(list) => {
                        for (p, data) in list {
                            out.entry(p).or_insert(data);
                        }
                    }
                    Err(e) => log(format!("effect edit: left {v} as it is: {e}")),
                }
            }
        }
        Ok(out)
    }

    /// The effects with changes on, as the window plays them.
    fn defs_of(&self, target: &Target, edits: &EffectEdits) -> Result<Vec<Value>, String> {
        let (_, ix) = self.index()?;
        let changed = self.entries_of(target, edits, false, &mut |_| {})?;
        let mut read = |p: &str| changed.get(p).cloned().or_else(|| ix.read(p).ok().flatten());
        Ok(target
            .roots
            .iter()
            .take(PLAYED)
            .filter_map(|r| {
                crate::particle_spec::particle_def(&mut read, r, &mut 128, 0, &std::collections::HashMap::new())
            })
            .collect())
    }

    /// The effects whose path has every word of `query`, shortest first.
    pub fn search(&mut self, query: &str) -> Result<Vec<String>, String> {
        let low = query.to_lowercase();
        let words: Vec<&str> =
            low.split(|c: char| c == '/' || crate::js::is_space(c)).filter(|w| !w.is_empty()).collect();
        if words.is_empty() {
            return Ok(vec![]);
        }
        let mut hits: Vec<String> =
            self.paths()?.iter().filter(|p| words.iter().all(|w| p.contains(w))).cloned().collect();
        hits.sort_by(|a, b| {
            a.encode_utf16().count().cmp(&b.encode_utf16().count()).then_with(|| crate::js::locale_compare(a, b))
        });
        hits.truncate(SHOWN);
        Ok(hits)
    }

    /// The effects changed so far.
    pub fn saved(lib: &Library) -> Vec<Value> {
        lib.list()
            .iter()
            .filter_map(|r| {
                let effect = effect_of(r)?;
                let name = r["generated"]
                    .get("name")
                    .filter(|n| crate::js::truthy(n))
                    .map_or_else(|| name_of(effect), crate::js::string);
                Some(json!({ "path": effect, "name": name }))
            })
            .collect()
    }

    /// One effect: its systems, the changes on it now, and how it plays with them. The window's
    /// pictures for it (`sprites`, `resources`) are the shell's to add.
    pub fn load(&self, lib: &Library, raw: &Value, mut finder: Option<Finder>) -> Result<Value, String> {
        let effect = valid(raw)?;
        let (_, ix) = self.index()?;
        let target = self.target_of(&effect, &mut finder)?;
        let made = lib.list().iter().find(|r| effect_of(r) == Some(effect.as_str())).map(|r| r["generated"].clone());
        let edits = made.as_ref().and_then(|m| m.get("edits")).map(clean_edits).unwrap_or_default();
        let edits_json = made.as_ref().and_then(|m| m.get("edits")).cloned().unwrap_or(json!({}));
        let defs = self.defs_of(&target, &edits)?;
        if defs.is_empty() {
            return Err(unreadable());
        }
        let mut read = |p: &str| ix.read(p).ok().flatten();
        let mut seen = std::collections::HashSet::new();
        let systems: Vec<Value> = target
            .roots
            .iter()
            .flat_map(|r| systems_of(&mut read, r))
            .filter(|(p, _)| seen.insert(p.clone()))
            .map(|(path, depth)| json!({ "path": path, "depth": depth }))
            .collect();
        Ok(json!({
            "path": effect, "name": target.name, "edits": edits_json, "defs": defs, "systems": systems,
            "variants": target.variants.len(),
            "items": made.as_ref().and_then(|m| m.get("items")).is_some_and(crate::js::truthy),
        }))
    }

    /// How an effect plays with these changes.
    pub fn preview(&self, raw: &Value, edits: &Value, mut finder: Option<Finder>) -> Result<Vec<Value>, String> {
        let target = self.target_of(&valid(raw)?, &mut finder)?;
        self.defs_of(&target, &clean_edits(edits))
    }

    /// The effect with these changes, put in My mods in place of the one before.
    pub fn install(
        &self,
        inst: &Installer,
        lib: &mut Library,
        (raw, raw_edits, items): (&Value, &Value, bool),
        mut finder: Option<Finder>,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let effect = valid(raw)?;
        let edits = clean_edits(raw_edits);
        let target = self.target_of(&effect, &mut finder)?;
        let entries = self.entries_of(&target, &edits, items, log)?;
        if entries.is_empty() {
            return Err(t("Здесь нечего менять: в этом эффекте нет таких чисел", &[]));
        }
        let list: Vec<crate::vpk::Entry> =
            entries.iter().map(|(p, d)| crate::vpk::entry_at(p, d.as_slice().into())).collect();
        let vpk = crate::vpk::build(&list);
        let generated = json!({ "effect": effect, "edits": edits, "items": items, "name": target.name });
        let name = t("Эффект: {0}", &[json!(target.name)]);
        let io = |e: std::io::Error| e.to_string();
        let old = lib.list().iter().find(|r| effect_of(r) == Some(effect.as_str())).cloned();
        log(format!("effect edit: {effect}, {} systems", entries.len()));
        if let Some(old) = old {
            let off = old.get("enabled") == Some(&Value::Bool(false));
            let files = swap_pak(inst, &old, &vpk, off)?;
            let fields = json!({
                "name": name, "files": files_json(&files), "generated": generated,
                "updatedAt": crate::js::json_number(crate::library::now()),
            });
            return Ok(lib.update(&old["id"], &fields, None).map_err(io)?.unwrap_or(Value::Null));
        }
        let files = write_pak(inst, &vpk)?;
        let new = json!({
            "name": name, "categoryId": "imported", "styleLabel": null, "fileRef": null, "preview": null,
            "files": files_json(&files),
        });
        let made = lib.add(&new, None).map_err(io)?;
        Ok(lib.update(&made["id"], &json!({ "generated": generated }), None).map_err(io)?.unwrap_or(Value::Null))
    }

    /// After a Dota update: the records among `ids` to build again, which the app does one at a
    /// time with `rebuild_now`, out of the way of the start. Nothing counts as built yet.
    pub fn due(lib: &Library, ids: &[String]) -> Vec<String> {
        lib.list()
            .iter()
            .filter(|r| effect_of(r).is_some())
            .filter_map(|r| r.get("id").map(crate::js::string))
            .filter(|id| ids.contains(id))
            .collect()
    }

    /// One record built again from the game's new files; whether it was.
    pub fn rebuild_now(
        &self,
        inst: &Installer,
        lib: &mut Library,
        id: &str,
        finder: Option<Finder>,
        log: &mut dyn FnMut(String),
    ) -> bool {
        let Some(rec) = lib.list().iter().find(|r| r.get("id").map(crate::js::string).as_deref() == Some(id)).cloned()
        else {
            return false;
        };
        let Some(effect) = effect_of(&rec).map(str::to_string) else { return false };
        let g = &rec["generated"];
        let items = g.get("items").is_some_and(crate::js::truthy);
        match self.install(inst, lib, (&json!(effect), g.get("edits").unwrap_or(&Value::Null), items), finder, log) {
            Ok(_) => true,
            Err(e) => {
                log(format!("effect edit: could not build {effect} again after the update: {e}"));
                false
            }
        }
    }
}
