//! The load order: which pak slot a mod sits in, moving and swapping slots, and which mods are
//! covered by which. Replacing src/installer-slots.ts, which explains the rules (a smaller pak
//! number sits on top; the first copy of a file wins).

use indexmap::IndexMap;
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;

use crate::file_tx::FileTx;
use crate::i18n::t;
use crate::installer::{with_suffix, Installer};
use crate::installer_files::{is_official_lang_file, MASTER_OFF};
use crate::library::Library;
use crate::minify::RESERVED_PAKS;
use crate::slot_zones::{free_slot_in, Zone, APP_PAK};

/// Engine stock that packing tools drop into every export: not a fight between two mods.
fn stock_asset() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"(^|/)(materials/(default|particle|transparent)|materials/models/cubemaps|particles/(basic_[a-z]+|error))/")
            .unwrap()
    })
}

/// Who covers one mod: winner key -> its key, its name and the paths it takes.
type Winners = IndexMap<String, (Value, Value, Vec<String>)>;

/// How many of the paths a winner takes are listed.
pub const COVER_PATHS: usize = 200;

/// A mod that covers another: who, how many files, and which.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Cover {
    pub key: Value,
    pub name: Value,
    pub files: usize,
    pub paths: Vec<String>,
}

/// A switched-on mod as coverage reads it: keyed, because two copies of one mod share a name.
pub struct CoverageMod {
    pub key: Value,
    pub name: Value,
    pub files: Vec<Value>,
}

/// The name without what the two switches add: `.moff`, then `.off`.
fn base_name(lower: &str) -> &str {
    let s = lower.strip_suffix(".moff").unwrap_or(lower);
    s.strip_suffix(".off").unwrap_or(s)
}

fn str_of<'a>(f: &'a Value, k: &str) -> Option<&'a str> {
    f.get(k).and_then(Value::as_str)
}

fn files_of(rec: &Value) -> &[Value] {
    rec.get("files").and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn utf16_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// The names in a folder, in the order the system lists them.
fn names_in(dir: &std::path::Path) -> Vec<String> {
    crate::js::dir_names(dir)
}

impl Installer {
    /// Every slot name the folder holds, whatever state its file is in.
    pub fn used_pak_names(&self) -> Result<HashSet<String>, String> {
        let lang = self.lang_folder()?;
        Ok(names_in(&lang).iter().map(|f| base_name(&f.to_lowercase()).to_string()).collect())
    }

    /// The next free slot for a mod, in the part of the order it belongs in; taken from `used`.
    pub fn allocate_pak(&self, used: &mut HashSet<String>, priority: bool) -> Result<String, String> {
        let name = priority
            .then(|| free_slot_in(Zone::Priority, used))
            .flatten()
            .or_else(|| free_slot_in(Zone::Normal, used))
            .ok_or_else(|| t("Свободных слотов pakNN не осталось (30-99 заняты)", &[]))?;
        used.insert(name.clone());
        Ok(name)
    }

    /// Map the .vpk files of an archive onto slots of ours, one slot per volume set.
    pub fn plan_pak_names(
        &self,
        rel_paths: &[String],
        used: &mut HashSet<String>,
        priority: bool,
    ) -> Result<IndexMap<String, String>, String> {
        static DIR: OnceLock<Regex> = OnceLock::new();
        static PART: OnceLock<Regex> = OnceLock::new();
        static VPK: OnceLock<Regex> = OnceLock::new();
        let dir_re = DIR.get_or_init(|| Regex::new(r"(?i)^(.*)_dir\.vpk$").unwrap());
        let part_re = PART.get_or_init(|| Regex::new(r"(?i)^(.*)_(\d{3})\.vpk$").unwrap());
        let vpk_re = VPK.get_or_init(|| Regex::new(r"(?i)\.vpk$").unwrap());
        let mut groups: IndexMap<String, Vec<(String, Option<String>)>> = IndexMap::new();
        for rel in rel_paths {
            let name = rel.rsplit('/').next().unwrap_or("");
            let folder = rel[..rel.len() - name.len()].to_lowercase();
            let m_dir = dir_re.captures(name);
            let m_part = part_re.captures(name);
            let base = m_dir
                .as_ref()
                .map(|m| m[1].to_string())
                .filter(|b| !b.is_empty())
                .or_else(|| m_part.as_ref().map(|m| m[1].to_string()).filter(|b| !b.is_empty()))
                .unwrap_or_else(|| vpk_re.replace(name, "").into_owned());
            let part = if m_dir.is_some() { None } else { m_part.as_ref().map(|m| m[2].to_string()) };
            groups.entry(format!("{folder}|{}", base.to_lowercase())).or_default().push((rel.clone(), part));
        }
        let mut plan = IndexMap::new();
        for items in groups.values() {
            let slot = self.allocate_pak(used, priority)?;
            let slot = slot.strip_suffix("_dir.vpk").unwrap_or(&slot).to_string();
            for (rel, part) in items {
                let name = match part {
                    Some(p) => format!("{slot}_{p}.vpk"),
                    None => format!("{slot}_dir.vpk"),
                };
                plan.insert(rel.clone(), name);
            }
        }
        Ok(plan)
    }

    /// The slot a record occupies ("pak07"), or None for a mod outside a numbered pak.
    pub fn slot_base(&self, rec: &Value) -> Option<String> {
        static R: OnceLock<Regex> = OnceLock::new();
        let r = R.get_or_init(|| Regex::new(r"(?i)^pak[0-9]+_dir\.vpk$").unwrap());
        files_of(rec)
            .iter()
            .find(|f| str_of(f, "root") == Some("lang") && str_of(f, "relPath").is_some_and(|p| r.is_match(p)))
            .and_then(|f| str_of(f, "relPath"))
            .map(|p| p[..p.len() - 8].to_lowercase())
    }

    /// A record's slot as a number.
    pub fn slot_number(&self, rec: &Value) -> Option<u32> {
        self.slot_base(rec).and_then(|b| b[3..].parse().ok())
    }

    /// Which mods are quietly covering which, file by file; worst first, with the paths each takes.
    pub fn coverage(&self, mods: &[CoverageMod]) -> IndexMap<String, Vec<Cover>> {
        struct Owner<'a> {
            key: &'a Value,
            name: &'a Value,
            slot: u32,
            crc: u32,
        }
        static DIR: OnceLock<Regex> = OnceLock::new();
        let dir_re = DIR.get_or_init(|| Regex::new(r"(?i)_dir\.vpk$").unwrap());
        let mut owners: IndexMap<String, Vec<Owner>> = IndexMap::new();
        for m in mods {
            let dir = m.files.iter().find(|f| {
                str_of(f, "root") == Some("lang") && str_of(f, "relPath").is_some_and(|p| dir_re.is_match(p))
            });
            let Some(rel) = dir.and_then(|f| str_of(f, "relPath")) else { continue };
            let Some(slot) = self.slot_number(&serde_json::json!({ "files": m.files })) else { continue };
            let crcs = self
                .lang_file_on_disk(rel)
                .ok()
                .and_then(|p| crate::vpk::read_index_file(&p).ok())
                .and_then(|b| crate::vpk::list_path_crcs(&b).ok());
            let Some(crcs) = crcs else { continue };
            for (p, crc) in crcs {
                if stock_asset().is_match(&p) {
                    continue;
                }
                owners.entry(p).or_default().push(Owner { key: &m.key, name: &m.name, slot, crc });
            }
        }
        let key_of = |k: &Value| crate::js::string(k);
        // loser key -> winner key -> the winner's name and the paths it takes
        let mut covered: IndexMap<String, (Value, Winners)> = IndexMap::new();
        for (p, list) in &owners {
            if list.len() < 2 {
                continue;
            }
            let top = list.iter().fold(&list[0], |a, b| if b.slot < a.slot { b } else { a });
            for other in list {
                if key_of(other.key) == key_of(top.key) || other.crc == top.crc {
                    continue;
                }
                let by =
                    &mut covered.entry(key_of(other.key)).or_insert_with(|| (other.key.clone(), IndexMap::new())).1;
                let won = by.entry(key_of(top.key)).or_insert_with(|| (top.key.clone(), top.name.clone(), Vec::new()));
                won.2.push(p.clone());
            }
        }
        let mut out = IndexMap::new();
        for (loser, (_, by)) in covered {
            let mut list: Vec<Cover> = by
                .into_values()
                .map(|(key, name, mut paths)| {
                    paths.sort_by(|a, b| utf16_cmp(a, b));
                    let files = paths.len();
                    paths.truncate(COVER_PATHS);
                    Cover { key, name, files, paths }
                })
                .collect();
            list.sort_by_key(|a| std::cmp::Reverse(a.files));
            out.insert(loser, list);
        }
        out
    }

    /// The highest free slot strictly below `n`, as "pakNN".
    pub fn free_slot_below(&self, n: u32, used: &HashSet<String>) -> Option<String> {
        (2..n)
            .rev()
            .filter(|i| !RESERVED_PAKS.contains(i) && *i != APP_PAK)
            .map(crate::slot_zones::pak_base)
            .find(|base| !used.contains(&format!("{base}_dir.vpk")))
    }

    /// Rename every pak file of a record to another slot, keeping .off/.moff state and the volume
    /// numbering; all of them or none. Answers the record's new files.
    pub fn move_to_slot(
        &self,
        rec: &Value,
        new_base: &str,
        old_base: Option<&str>,
        tx: Option<&mut FileTx>,
    ) -> Result<Vec<Value>, String> {
        let lang = self.lang_folder()?;
        let old = match old_base {
            Some(o) => Some(o.to_string()),
            None => self.slot_base(rec),
        };
        let Some(old) = old.filter(|o| !o.is_empty()) else {
            return Err(t("У мода нет слота pakNN", &[]));
        };
        let mine =
            Regex::new(&format!(r"(?i)^{}(_dir|_\d{{3}})\.vpk$", regex::escape(&old))).map_err(|e| e.to_string())?;
        let files = files_of(rec).to_vec();
        let mv = |into: &mut FileTx| -> Result<Vec<Value>, String> {
            let mut out = Vec::new();
            for f in &files {
                let rel = str_of(f, "relPath").filter(|p| str_of(f, "root") == Some("lang") && mine.is_match(p));
                let Some(rel) = rel else {
                    out.push(f.clone());
                    continue;
                };
                // the regex matched old as the start, case-insensitively: its length is old's
                let next = format!("{new_base}{}", &rel[old.len()..]);
                for suf in ["", ".off", MASTER_OFF] {
                    let from = with_suffix(&lang.join(rel), suf);
                    if from.exists() {
                        into.rename(&from, &with_suffix(&lang.join(&next), suf)).map_err(|e| e.to_string())?;
                    }
                }
                let mut g = f.clone();
                g["relPath"] = Value::String(next);
                out.push(g);
            }
            Ok(out)
        };
        match tx {
            Some(tx) => mv(tx),
            None => FileTx::run(self.journal_dir.as_deref(), self.tx_log(), mv),
        }
    }

    /// Trade two records' slots; pak00, which the game never mounts, is the parking spot.
    /// Answers the records to save, as (id, files).
    pub fn swap_slots(&self, a: &Value, b: &Value) -> Result<Vec<(Value, Vec<Value>)>, String> {
        let (Some(a_base), Some(b_base)) = (self.slot_base(a), self.slot_base(b)) else {
            return Err(t("У мода нет слота pakNN", &[]));
        };
        FileTx::run(self.journal_dir.as_deref(), self.tx_log(), |tx| {
            let parked = self.move_to_slot(a, "pak00", Some(&a_base), Some(tx))?;
            let moved_b = self.move_to_slot(b, &a_base, Some(&b_base), Some(tx))?;
            let mut a2 = a.clone();
            a2["files"] = Value::Array(parked);
            let moved_a = self.move_to_slot(&a2, &b_base, Some("pak00"), Some(tx))?;
            Ok(vec![(a["id"].clone(), moved_a), (b["id"].clone(), moved_b)])
        })
    }

    /// Number of occupied mod pak slots, the game's own and ours left out.
    pub fn used_mod_slots(&self) -> Result<usize, String> {
        let lang = self.lang_folder()?;
        static R: OnceLock<Regex> = OnceLock::new();
        let r = R.get_or_init(|| Regex::new(r"^(pak[0-9]+)_dir\.vpk$").unwrap());
        let mut bases = HashSet::new();
        for f in names_in(&lang) {
            let lower = f.to_lowercase();
            if let Some(m) = r.captures(base_name(&lower)) {
                if !is_official_lang_file(&format!("{}_dir.vpk", &m[1])) {
                    bases.insert(m[1].to_string());
                }
            }
        }
        Ok(bases.len())
    }

    /// Older versions wrote priority mods as "!pakNN_dir.vpk", a name the game never mounts:
    /// renamed to real low slots, and the records with them.
    pub fn migrate_legacy_priority_paks(&self, library: &mut Library) -> Result<(), String> {
        let Ok(lang) = self.lang_folder() else { return Err(t("Путь к Dota 2 не задан", &[])) };
        if !lang.exists() {
            return Ok(());
        }
        static R: OnceLock<Regex> = OnceLock::new();
        let r = R.get_or_init(|| Regex::new(r"(?i)^!pak[0-9]+_dir\.vpk(\.off)?$").unwrap());
        let legacy: Vec<String> = names_in(&lang).into_iter().filter(|f| r.is_match(f)).collect();
        if legacy.is_empty() {
            return Ok(());
        }
        let mut used = self.used_pak_names()?;
        let mut changed = false;
        for f in legacy {
            let lower = f.to_lowercase();
            let disabled = lower.ends_with(".off");
            let old_base = if disabled { &f[..f.len() - 4] } else { &f[..] };
            let new_base = self.allocate_pak(&mut used, true)?;
            std::fs::rename(lang.join(&f), lang.join(format!("{new_base}{}", if disabled { ".off" } else { "" })))
                .map_err(|e| e.to_string())?;
            let want = old_base.to_lowercase();
            for rec in library.data.get_mut("installed").and_then(Value::as_array_mut).into_iter().flatten() {
                for fr in rec.get_mut("files").and_then(Value::as_array_mut).into_iter().flatten() {
                    let hit = fr.get("root").and_then(Value::as_str) == Some("lang")
                        && fr.get("relPath").and_then(Value::as_str).is_some_and(|p| p.to_lowercase() == want);
                    if hit {
                        fr["relPath"] = Value::String(new_base.clone());
                        changed = true;
                    }
                }
            }
        }
        if changed {
            library.save(None).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
