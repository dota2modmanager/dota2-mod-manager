//! The window's half of a hero's ability icons picked from his own cosmetics'
//! (src/ability-icons-service.ts); what there is to pick and how it goes in is `ability_icons`.
//! One record in My mods per hero; each ability's pick can be put back to the game's own on its
//! own, and putting back the last takes the record with it.
//!
//! The record goes early in the load order with the hero items (categoryId hero-items). What it
//! holds is copies of the game's own pictures, so a Dota update that reached it builds it again
//! from the new ones, before `rebuild` returns.

use std::path::PathBuf;
use std::sync::Arc;

use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Map, Value};

use crate::ability_icons::{
    hero_icon_choices, icon_entries, icon_modifiers, icon_name_ok, modifier_sets, AbilityIcons, IconModifier,
    IconSource,
};
use crate::generated_pak::{files_json, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::vpk::Index;

fn hero_ok(h: &str) -> bool {
    Regex::new(r"^[a-z0-9_]{2,40}$").expect("a fixed pattern").is_match(h)
}

fn no_hero(h: &str) -> String {
    t("Нет такого героя: {0}", &[json!(h)])
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

/// A pick list as the record keeps it, in its order.
pub type Picks = IndexMap<String, String>;

fn hero_of(rec: &Value) -> Option<&str> {
    rec.get("generated").and_then(|g| g.get("abilityIcons")).and_then(Value::as_str).filter(|h| !h.is_empty())
}

fn picks_in(rec: &Value) -> Picks {
    rec.get("generated")
        .and_then(|g| g.get("picks"))
        .and_then(Value::as_object)
        .map(|o| o.iter().map(|(k, v)| (k.clone(), crate::js::string(v))).collect())
        .unwrap_or_default()
}

fn picks_json(p: &Picks) -> Value {
    Value::Object(p.iter().map(|(k, v)| (k.clone(), json!(v))).collect::<Map<_, _>>())
}

fn id_of(rec: &Value) -> Value {
    rec.get("id").cloned().unwrap_or(Value::Null)
}

/// The service the icons:* channels call, over one item table (a new table is a new service).
pub struct AbilityIconsService {
    pub game: Option<PathBuf>,
    /// the app's language: ru, en or zh-CN
    pub lang: String,
    /// ValveResourceFormat is there
    pub vrf: bool,
    text: Vec<u8>,
    sources: Vec<IconSource>,
    modifiers: Vec<IconModifier>,
    heroes: Option<(Arc<Index>, Vec<Value>)>,
}

impl AbilityIconsService {
    pub fn new(game: Option<PathBuf>, table: Vec<u8>, lang: &str, vrf: bool) -> Result<Self, String> {
        let items = crate::schema::list_items(&table).map_err(|e| e.to_string())?;
        let mut sources: Vec<IconSource> = items
            .into_iter()
            .map(|i| IconSource { id: i.id, name: i.name, start: i.start, end: i.end, shared: false, loc_key: None })
            .collect();
        sources.extend(modifier_sets(&table).map_err(|e| e.to_string())?);
        let modifiers = icon_modifiers(&table);
        Ok(AbilityIconsService { game, lang: lang.to_string(), vrf, text: table, sources, modifiers, heroes: None })
    }

    fn pak01(&self) -> Result<Arc<Index>, String> {
        let game =
            self.game.clone().filter(|g| !g.as_os_str().is_empty()).ok_or_else(|| t("Не указана папка игры", &[]))?;
        crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())
    }

    fn script(ix: &Index, hero: &str) -> Option<String> {
        let data = ix.read(&format!("scripts/npc/heroes/npc_dota_hero_{hero}.txt")).ok().flatten()?;
        Some(String::from_utf8_lossy(&data).into_owned())
    }

    fn choices(&self, ix: &Index, hero: &str, order: &[String]) -> Result<Vec<AbilityIcons>, String> {
        let has = |f: &str| ix.has(f);
        hero_icon_choices(&self.text, &self.sources, hero, order, &has, &self.modifiers).map_err(|e| e.to_string())
    }

    fn choices_of(&self, hero: &str) -> Result<Vec<AbilityIcons>, String> {
        if !hero_ok(hero) {
            return Err(no_hero(hero));
        }
        let ix = self.pak01()?;
        let script = Self::script(&ix, hero).ok_or_else(|| no_hero(hero))?;
        self.choices(&ix, hero, &crate::recolor_layers::hero_abilities(&script))
    }

    /// Game text in the app's language, English for what it lacks.
    fn words(&self) -> IndexMap<String, String> {
        let mut out = IndexMap::new();
        let Ok(ix) = self.pak01() else { return out };
        let first = match self.lang.as_str() {
            "ru" => "russian",
            "zh-CN" => "schinese",
            _ => "english",
        };
        let langs: Vec<&str> = if first == "english" { vec!["english"] } else { vec![first, "english"] };
        for language in langs {
            for file in ["abilities", "dota"] {
                if let Ok(Some(data)) = ix.read(&format!("resource/localization/{file}_{language}.txt")) {
                    for (k, v) in crate::cosmetic_names::localization_tokens(&data) {
                        out.entry(k).or_insert(v);
                    }
                }
            }
        }
        out
    }

    fn record_of(lib: &Library, hero: &str) -> Option<Value> {
        lib.list().iter().find(|r| hero_of(r) == Some(hero)).cloned()
    }

    fn picks_of(lib: &Library, hero: &str) -> Picks {
        Self::record_of(lib, hero).map(|r| picks_in(&r)).unwrap_or_default()
    }

    /// The hero built with `picks`: in his record's slot, a new record, or none when nothing is picked.
    fn apply(
        &self,
        inst: &Installer,
        lib: &mut Library,
        hero: &str,
        mut picks: Picks,
        keep_off: bool,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let old = Self::record_of(lib, hero);
        let ix = self.pak01()?;
        let order = Self::script(&ix, hero).map(|s| crate::recolor_layers::hero_abilities(&s)).unwrap_or_default();
        let rank = |a: &str| order.iter().position(|o| o == a).unwrap_or(order.len());
        // a picture two abilities share goes to the one first in the hero's script
        let mut ordered: Vec<(String, String)> = picks.iter().map(|(a, i)| (a.clone(), i.clone())).collect();
        ordered.sort_by(|(a, _), (b, _)| rank(a).cmp(&rank(b)).then_with(|| crate::js::locale_compare(a, b)));
        let ordered: Picks = ordered.into_iter().collect();
        let mut read = |f: &str| ix.read(f).ok().flatten();
        let has = |f: &str| ix.has(f);
        let (entries, gone) = icon_entries(&mut read, &ordered, &self.modifiers, &has);
        if let Some(g) = gone.first() {
            log(format!(
                "ability icons: {hero}: {} pick(s) the game has no picture for any more, first {g}",
                gone.len()
            ));
        }
        for a in &gone {
            picks.shift_remove(a);
        }
        if entries.is_empty() {
            if let Some(old) = old {
                let id = crate::js::string(&id_of(&old));
                inst.remove(&crate::overlays::files_of(&old["files"]), Some(&id), true)?;
                lib.remove_record(&id_of(&old), None).map_err(io)?;
            }
            return Ok(Value::Null);
        }
        let paths: Vec<String> = entries.iter().map(|(p, _)| p.clone()).collect();
        let list: Vec<crate::vpk::Entry> = entries.into_iter().map(|(_, e)| e).collect();
        let vpk = crate::vpk::build(&list);
        let name = t("Иконки способностей: {0}", &[json!(crate::hero_names::display_name(hero))]);
        let generated = json!({ "abilityIcons": hero, "picks": picks_json(&picks) });
        log(format!("ability icons: {hero}, {} icon(s)", list.len()));
        if let Some(old) = old {
            let off = keep_off && old.get("enabled") == Some(&Value::Bool(false));
            let files = swap_pak(inst, &old, &vpk, off)?;
            let fields = json!({
                "name": name, "files": files_json(&files), "generated": generated, "enabled": !off,
                "updatedAt": crate::js::json_number(crate::library::now()),
            });
            let rec = lib.update(&id_of(&old), &fields, None).map_err(io)?.unwrap_or(Value::Null);
            return self.ahead(inst, lib, rec, &paths, log);
        }
        let files = write_pak(inst, &vpk)?;
        let new = json!({
            "name": name, "categoryId": "hero-items", "styleLabel": null, "fileRef": null, "preview": null,
            "files": files_json(&files),
        });
        let made = lib.add(&new, None).map_err(io)?;
        let rec = lib.update(&made["id"], &json!({ "generated": generated }), None).map_err(io)?.unwrap_or(Value::Null);
        self.ahead(inst, lib, rec, &paths, log)
    }

    fn slot_of(inst: &Installer, rec: &Value) -> Option<u32> {
        let base = inst.slot_base(rec)?;
        let n = base.strip_prefix("pak")?;
        if n.is_empty() || !n.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        n.parse().ok()
    }

    /// The record moved ahead of every switched-on mod that carries one of its files, since the
    /// lower pak wins: into a free slot below the first such mod, or in its place (swapped).
    fn ahead(
        &self,
        inst: &Installer,
        lib: &mut Library,
        rec: Value,
        files: &[String],
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let Some(mine) = Self::slot_of(inst, &rec) else { return Ok(rec) };
        let lang = inst.lang_folder()?;
        let mut first: Option<(Value, u32)> = None;
        for other in lib.list() {
            if other.get("id") == rec.get("id") || other.get("enabled") == Some(&Value::Bool(false)) {
                continue;
            }
            let Some(n) = Self::slot_of(inst, other) else { continue };
            if n >= mine || first.as_ref().is_some_and(|(_, f)| n >= *f) {
                continue;
            }
            let covers = other.get("files").and_then(Value::as_array).into_iter().flatten().any(|f| {
                let rel = f.get("relPath").map(crate::js::string).unwrap_or_default();
                if f.get("root").and_then(Value::as_str) != Some("lang") || !rel.to_lowercase().ends_with("_dir.vpk") {
                    return false;
                }
                match crate::vpk_shared::shared_index(&lang.join(&rel)) {
                    Ok(pak) => files.iter().any(|p| pak.has(p)),
                    Err(_) => false,
                }
            });
            if covers {
                first = Some((other.clone(), n));
            }
        }
        let Some((first, below)) = first else { return Ok(rec) };
        let used = inst.used_pak_names()?;
        let mut free = None;
        let mut i = below as i64 - 1;
        while i >= 2 && free.is_none() {
            let base = format!("pak{i:02}");
            if !used.contains(&format!("{base}_dir.vpk")) {
                free = Some(base);
            }
            i -= 1;
        }
        let first_name = first.get("name").map(crate::js::string).unwrap_or_default();
        log(format!("ability icons: {first_name} covered the icons from a lower slot, moving ahead of it"));
        if let Some(free) = free {
            let moved = inst.move_to_slot(&rec, &free, None, None)?;
            return Ok(lib.update(&id_of(&rec), &json!({ "files": moved }), None).map_err(io)?.unwrap_or(Value::Null));
        }
        let mut out = rec.clone();
        for (id, files) in inst.swap_slots(&rec, &first)? {
            let updated = lib.update(&id, &json!({ "files": files }), None).map_err(io)?.unwrap_or(Value::Null);
            if id == id_of(&rec) {
                out = updated;
            }
        }
        Ok(out)
    }

    /// Every hero his cosmetics give a choice of icons to, by his npc name, with his name.
    pub fn heroes(&mut self) -> Result<Vec<Value>, String> {
        let ix = self.pak01()?;
        if let Some((of, list)) = &self.heroes {
            if Arc::ptr_eq(of, &ix) {
                return Ok(list.clone());
            }
        }
        let re = Regex::new(r"^scripts/npc/heroes/npc_dota_hero_([a-z0-9_]+)\.txt$").expect("a fixed pattern");
        let mut out: Vec<(String, String)> = Vec::new();
        let paths: Vec<String> = ix.paths().map(str::to_string).collect();
        for p in paths {
            let Some(hero) = re.captures(&p).map(|c| c[1].to_string()) else { continue };
            if !hero_ok(&hero) {
                continue;
            }
            let script =
                ix.read(&p).ok().flatten().map(|d| String::from_utf8_lossy(&d).into_owned()).unwrap_or_default();
            if !self.choices(&ix, &hero, &crate::recolor_layers::hero_abilities(&script))?.is_empty() {
                let name = crate::hero_names::display_name(&hero);
                out.push((hero, name));
            }
        }
        out.sort_by(|a, b| crate::js::locale_compare(&a.1, &b.1));
        let list: Vec<Value> = out.into_iter().map(|(hero, name)| json!({ "hero": hero, "name": name })).collect();
        self.heroes = Some((ix, list.clone()));
        Ok(list)
    }

    /// A hero's abilities with the icons there are for each, and the picks on now.
    pub fn hero(&self, lib: &Library, hero: &str) -> Result<Value, String> {
        let tokens = self.words();
        let word = |k: &str| tokens.get(k).filter(|v| !v.is_empty()).cloned();
        let abilities: Vec<Value> = self
            .choices_of(hero)?
            .into_iter()
            .map(|a| {
                let name = word(&format!("dota_tooltip_ability_{}", a.ability)).unwrap_or_else(|| a.ability.clone());
                let choices: Vec<Value> = a
                    .choices
                    .iter()
                    .map(|c| {
                        let item =
                            c.loc_key.as_ref().and_then(|l| word(&l.to_lowercase())).unwrap_or_else(|| c.item.clone());
                        json!({ "icon": c.icon, "item": item, "style": c.style })
                    })
                    .collect();
                json!({ "ability": a.ability, "name": name, "choices": choices })
            })
            .collect();
        let rec = Self::record_of(lib, hero);
        Ok(json!({
            "hero": hero, "abilities": abilities, "picks": picks_json(&Self::picks_of(lib, hero)),
            "recId": rec.as_ref().map(id_of).unwrap_or(Value::Null),
            "enabled": rec.as_ref().is_some_and(|r| r.get("enabled") != Some(&Value::Bool(false))),
            "vrf": self.vrf,
        }))
    }

    /// `icon` on `ability`, or the game's own back on it when `icon` is None.
    pub fn set(
        &self,
        inst: &Installer,
        lib: &mut Library,
        (hero, ability, icon): (&str, &str, Option<&str>),
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        if !icon_name_ok(ability) {
            return Err(t("У героя нет такой способности", &[]));
        }
        let mut picks = Self::picks_of(lib, hero);
        match icon {
            None => {
                picks.shift_remove(ability);
            }
            Some(icon) => {
                let offered = self.choices_of(hero)?.into_iter().find(|a| a.ability == ability);
                let offered = offered.ok_or_else(|| t("У героя нет такой способности", &[]))?;
                if !offered.choices.iter().any(|c| c.icon == icon) {
                    return Err(t("Этой иконки нет у героя", &[]));
                }
                picks.insert(ability.to_string(), icon.to_string());
            }
        }
        let rec = self.apply(inst, lib, hero, picks, false, log)?;
        log(format!("ability icons: {hero}: {ability} {}", icon.unwrap_or("back to the game’s")));
        Ok(rec)
    }

    /// Every pick of the hero taken off, and his record with them.
    pub fn clear(
        &self,
        inst: &Installer,
        lib: &mut Library,
        hero: &str,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        if !hero_ok(hero) {
            return Err(no_hero(hero));
        }
        self.apply(inst, lib, hero, Picks::new(), false, log)
    }

    /// After a Dota update: the records among `ids` built again from the game's new pictures; the
    /// ids done.
    pub fn rebuild(
        &self,
        inst: &Installer,
        lib: &mut Library,
        ids: &[String],
        log: &mut dyn FnMut(String),
    ) -> Vec<String> {
        let mut done = Vec::new();
        let due: Vec<Value> = lib
            .list()
            .iter()
            .filter(|r| hero_of(r).is_some() && ids.contains(&crate::js::string(&id_of(r))))
            .cloned()
            .collect();
        for rec in due {
            let hero = hero_of(&rec).unwrap_or_default().to_string();
            match self.apply(inst, lib, &hero, picks_in(&rec), true, log) {
                Ok(_) => done.push(crate::js::string(&id_of(&rec))),
                Err(e) => log(format!("ability icons: could not build again after the update: {e}")),
            }
        }
        done
    }
}
