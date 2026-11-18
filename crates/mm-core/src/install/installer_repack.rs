//! What is already installed, read and rewritten, replacing src/installer-repack.ts and
//! src/installer-packs.ts: a mod's files merged into one or written out as a folder, the
//! whole-game tables stripped out of it, a pack of heroes split, and combined packs (several
//! mods in one slot, each kept as its own file in userData and rebuilt from the ones that are on).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use regex::Regex;
use serde_json::{json, Value};

use crate::installer::{with_suffix, Installer};
use crate::installer_files::{MASTER_OFF, MERGE_SIZE_CAP};
use crate::overlays::{files_of, LibFile};
use crate::vpk::{self, Entry};
use crate::vpk_analyze::{analyze_vpk_paths, describe_analysis, name_from_analysis, subject_heroes};

fn io(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Whole-game tables and tool branding that packaging tools bake into every export.
fn global_table() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(&format!(
            "^(?:{})",
            [
                r#"scripts/items/items_game(?:\.txt)?"?$"#,
                "resource/localization/",
                r#"panorama/styles/(?:hero_slot_item_picker_loadout|ui_econ_item)\.vcss_c"?$"#,
                "panorama/images/(?:ds|tg|tt|wb|yu|remove|header_credits|footer_credits)[^/]*$",
                r#"(?:models/heroes|panorama)/\d{8,}\.vxml_c"?$"#,
            ]
            .join("|")
        ))
        .unwrap()
    })
}

fn items_game_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"(^|/)items_game\.txt"?$"#).unwrap())
}

/// Above this a localization file is the game's whole table, not a mod's own few lines.
const LOC_COPY_MIN: usize = 256 * 1024;

fn is_dir_vpk(rel: &str) -> bool {
    rel.to_lowercase().ends_with("_dir.vpk")
}

fn strip_dir(rel: &str) -> String {
    rel[..rel.len() - "_dir.vpk".len()].to_string()
}

fn part_re(base: &str) -> Regex {
    Regex::new(&format!(r"(?i)^{}_\d{{3}}\.vpk$", regex::escape(base))).unwrap()
}

fn is_part(rel: &str) -> bool {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)_\d{3}\.vpk$").unwrap()).is_match(rel)
}

/// The first lang `_dir.vpk` of a record's files.
fn dir_file(files: &[LibFile]) -> Option<&LibFile> {
    files.iter().find(|f| f.root == "lang" && is_dir_vpk(&f.rel_path))
}

/// What a record's own file is (analyzeRecord's answer).
pub fn record_analysis(inst: &Installer, buf: &[u8]) -> Result<Value, String> {
    let paths = vpk::list_paths(buf).map_err(io)?;
    let a = analyze_vpk_paths(&paths);
    let (info, hero_names, items) = crate::installer_folder::describe_paths(inst, &paths, &a);
    let mut out = json!({
        "info": info,
        "heroes": a.heroes.len(),
        "subjects": subject_heroes(&a).iter().filter(|h| h.models > 0).count(),
    });
    if let Some(items) = items {
        out["items"] = json!(items);
    }
    out["heroNames"] = json!(hero_names);
    out["fp"] = json!(vpk::fingerprint_vpk(buf).map_err(io)?);
    Ok(out)
}

impl Installer {
    /// A record's lang files (a _dir and its volumes) merged into one self-contained VPK;
    /// `deltas` (the record's lifted item blocks) go back in for a file headed elsewhere.
    pub fn merge_to_single_vpk(&self, files: &[LibFile], deltas: Option<&[Vec<u8>]>) -> Result<Vec<u8>, String> {
        let lang = self.lang_folder()?;
        let dir =
            dir_file(files).ok_or_else(|| crate::i18n::t("У этого мода нет _dir.vpk — объединять нечего", &[]))?;
        let resolve = |rel: &str| -> PathBuf {
            let abs = lang.join(rel);
            ["", ".off", MASTER_OFF].iter().map(|s| with_suffix(&abs, s)).find(|p| p.exists()).unwrap_or(abs)
        };
        let dir_abs = resolve(&dir.rel_path);
        let base = strip_dir(&dir.rel_path);
        let for_part = |i: u16| -> vpk::Result<PathBuf> { Ok(resolve(&format!("{base}_{i:03}.vpk"))) };
        let buf = fs::read(&dir_abs).map_err(io)?;
        let mut entries = vpk::read_entries(&buf, &dir_abs, Some(&for_part)).map_err(io)?;
        let Some(deltas) = deltas.filter(|d| !d.is_empty()) else { return Ok(vpk::build(&entries)) };
        entries.retain(|e| !items_game_re().is_match(&e.path()));
        let blocks: Vec<&[u8]> = deltas.iter().map(Vec::as_slice).collect();
        entries
            .push(vpk::entry_at("scripts/items/items_game.txt", Arc::from(crate::schema_merge::delta_table(&blocks))));
        Ok(vpk::build(&entries))
    }

    /// A mod's own files written out as a tree, volumes followed.
    pub fn unpack_to_folder(&self, files: &[LibFile], dest: &Path) -> Result<(usize, u64), String> {
        let dir =
            dir_file(files).ok_or_else(|| crate::i18n::t("У этого мода нет _dir.vpk — распаковывать нечего", &[]))?;
        let dir_abs = self.lang_file_on_disk(&dir.rel_path)?;
        let base = strip_dir(&dir.rel_path);
        let for_part = |i: u16| -> vpk::Result<PathBuf> {
            self.lang_file_on_disk(&format!("{base}_{i:03}.vpk"))
                .map_err(|e| vpk::VpkError::Io(std::io::Error::other(e)))
        };
        let buf = fs::read(&dir_abs).map_err(io)?;
        let entries = vpk::read_entries(&buf, &dir_abs, Some(&for_part)).map_err(io)?;
        let mut bytes = 0u64;
        for en in &entries {
            let out = crate::safe_zip::safe_join(dest, &en.path())?;
            if let Some(d) = out.parent() {
                fs::create_dir_all(d).map_err(io)?;
            }
            let data = if en.data.is_empty() { &en.preload } else { &en.data };
            fs::write(&out, &data[..]).map_err(io)?;
            bytes += data.len() as u64;
        }
        Ok((entries.len(), bytes))
    }

    /// A content-derived display name for a lang VPK, or none.
    pub fn display_name_for_file(&self, rel_path: &str) -> Option<String> {
        let p = self.lang_file_on_disk(rel_path).ok()?;
        let buf = vpk::read_index_file(&p).ok()?;
        name_from_analysis(&analyze_vpk_paths(&vpk::list_paths(&buf).ok()?))
    }

    /// Take the whole-game tables out of a freshly installed mod and keep what they meant:
    /// the item blocks it changed. `records` is edited in place (volumes folded away).
    pub fn harvest_schema(
        &self,
        records: &mut Vec<LibFile>,
        vanilla: Option<&[u8]>,
    ) -> Result<(Vec<crate::schema_merge::Delta>, Vec<String>), String> {
        let lang = self.lang_folder()?;
        let mut deltas = Vec::new();
        let mut stripped = Vec::new();
        for rec in records.iter() {
            if rec.root != "lang" || !is_dir_vpk(&rec.rel_path) {
                continue;
            }
            let abs = lang.join(&rec.rel_path);
            if !abs.exists() {
                continue;
            }
            let Ok(paths) = vpk::read_index_file(&abs).and_then(|b| vpk::list_paths(&b)) else { continue };
            if !paths.iter().any(|p| global_table().is_match(p)) {
                continue;
            }
            let re = part_re(&strip_dir(&rec.rel_path));
            let parts: Vec<String> = crate::js::dir_names(&lang).into_iter().filter(|f| re.is_match(f)).collect();
            let total: u64 = std::iter::once(abs.clone())
                .chain(parts.iter().map(|f| lang.join(f)))
                .map(|f| fs::metadata(f).map(|m| m.len()).unwrap_or(0))
                .sum();
            if total > MERGE_SIZE_CAP {
                continue;
            }
            let Ok(buf) = fs::read(&abs) else { continue };
            let Ok(entries) = vpk::read_entries(&buf, &abs, None) else { continue };
            let schema = entries.iter().filter(|e| items_game_re().is_match(&e.path())).fold(
                None::<&Entry>,
                |best, e| match best {
                    Some(b) if b.data.len() >= e.data.len() => Some(b),
                    _ => Some(e),
                },
            );
            if let (Some(s), Some(v)) = (schema, vanilla) {
                if !s.data.is_empty() {
                    if let Ok(ds) = crate::schema_merge::extract_deltas(&s.data, &paths, Some(v)) {
                        deltas.extend(ds);
                    }
                }
            }
            let drop = |e: &Entry| {
                let p = e.path();
                global_table().is_match(&p) && !(p.starts_with("resource/localization/") && e.data.len() < LOC_COPY_MIN)
            };
            let keep: Vec<Entry> = entries.iter().filter(|e| !drop(e)).cloned().collect();
            if keep.len() == entries.len() {
                continue;
            }
            fs::write(&abs, vpk::build(&keep)).map_err(io)?;
            for f in &parts {
                let _ = fs::remove_file(lang.join(f));
            }
            stripped.push(rec.rel_path.clone());
        }
        records.retain(|r| !(r.root == "lang" && is_part(&r.rel_path) && !lang.join(&r.rel_path).exists()));
        Ok((deltas, stripped))
    }

    /// A mod's packs written again without the shop's item pictures (src/item-icons-drop.ts),
    /// switched on or off as they were; folded volumes drop out of `records`. How many went.
    pub fn drop_item_icons(&self, records: &mut Vec<LibFile>) -> Result<usize, String> {
        let lang = self.lang_folder()?;
        let on_disk =
            |rel: &str| ["", ".off", MASTER_OFF].iter().map(|s| with_suffix(&lang.join(rel), s)).find(|p| p.exists());
        let icon = |p: &str| p.starts_with("panorama/images/items/");
        let mut dropped = 0;
        for rec in records.iter() {
            if rec.root != "lang" || !is_dir_vpk(&rec.rel_path) {
                continue;
            }
            let Some(abs) = on_disk(&rec.rel_path) else { continue };
            let Ok(paths) = vpk::read_index_file(&abs).and_then(|b| vpk::list_paths(&b)) else { continue };
            if !paths.iter().any(|p| icon(p)) {
                continue;
            }
            let buf = fs::read(&abs).map_err(io)?;
            let entries = vpk::read_entries(&buf, &abs, None).map_err(io)?;
            let keep: Vec<Entry> = entries.iter().filter(|e| !icon(&e.path())).cloned().collect();
            dropped += entries.len() - keep.len();
            let re = part_re(&strip_dir(&rec.rel_path));
            let parts: Vec<String> = crate::js::dir_names(&lang).into_iter().filter(|f| re.is_match(f)).collect();
            fs::write(&abs, vpk::build(&keep)).map_err(io)?;
            for f in parts {
                let _ = fs::remove_file(lang.join(f));
            }
        }
        records.retain(|r| !(r.root == "lang" && is_part(&r.rel_path) && on_disk(&r.rel_path).is_none()));
        Ok(dropped)
    }

    /// Bytes a record occupies in the language folder.
    pub fn installed_size(&self, files: &[LibFile]) -> Result<u64, String> {
        let lang = self.lang_folder()?;
        Ok(files
            .iter()
            .filter(|f| f.root == "lang")
            .filter_map(|f| fs::metadata(lang.join(&f.rel_path)).ok())
            .map(|m| m.len())
            .sum())
    }

    /// What a stored record actually changes, read from its _dir.vpk on disk.
    pub fn analyze_record(&self, files: &[LibFile]) -> Option<Value> {
        let dir = dir_file(files)?;
        let buf = vpk::read_index_file(&self.lang_file_on_disk(&dir.rel_path).ok()?).ok()?;
        record_analysis(self, &buf).ok()
    }

    /// A merged multi-hero VPK split into one per hero, each in a fresh slot: (hero, paths, files).
    pub fn split_vpk_file(&self, source_rel: &str) -> Result<Vec<Value>, String> {
        let lang = self.lang_folder()?;
        let parts = split_by_hero(&lang.join(source_rel))?;
        if parts.is_empty() {
            return Ok(Vec::new());
        }
        let mut used = self.used_pak_names()?;
        let mut out = Vec::new();
        for (name, buf, paths) in parts {
            let pak = self.allocate_pak(&mut used, false)?;
            crate::file_tx::write_into(&buf, &lang.join(&pak), None).map_err(io)?;
            out.push(
                json!({ "hero": name, "name": name, "paths": paths, "files": [{ "root": "lang", "relPath": pak }] }),
            );
        }
        Ok(out)
    }

    /// Old imports still sitting as a _dir plus volumes are folded into one file now.
    pub fn merge_multi_part_records(&self, lib: &mut crate::library::Library) -> Result<(), String> {
        let lang = self.lang_folder()?;
        if !lang.exists() {
            return Ok(());
        }
        let on_disk =
            |rel: &str| ["", ".off", MASTER_OFF].iter().map(|s| with_suffix(&lang.join(rel), s)).find(|p| p.exists());
        for rec in lib.list().to_vec() {
            if rec.get("kind").and_then(Value::as_str) == Some("pack") {
                continue;
            }
            let files = files_of(rec.get("files").unwrap_or(&Value::Null));
            let parts: Vec<LibFile> =
                files.iter().filter(|f| f.root == "lang" && is_part(&f.rel_path)).cloned().collect();
            let Some(dir) = dir_file(&files) else { continue };
            if parts.is_empty() {
                continue;
            }
            let Some(dir_abs) = on_disk(&dir.rel_path) else { continue };
            let base = strip_dir(&dir.rel_path);
            let total: u64 = parts
                .iter()
                .filter_map(|f| on_disk(&f.rel_path))
                .filter_map(|p| fs::metadata(p).ok())
                .map(|m| m.len())
                .sum();
            if total > MERGE_SIZE_CAP {
                continue;
            }
            let attempt = || -> Result<(), String> {
                let for_part = |i: u16| -> vpk::Result<PathBuf> {
                    on_disk(&format!("{base}_{i:03}.vpk")).ok_or(vpk::VpkError::NotSingle)
                };
                let buf = fs::read(&dir_abs).map_err(io)?;
                let merged = vpk::build(&vpk::read_entries(&buf, &dir_abs, Some(&for_part)).map_err(io)?);
                let tmp = with_suffix(&dir_abs, ".merging");
                fs::write(&tmp, merged).map_err(io)?;
                fs::rename(&tmp, &dir_abs).map_err(io)?;
                for f in &parts {
                    for s in ["", ".off", MASTER_OFF] {
                        let _ = fs::remove_file(with_suffix(&lang.join(&f.rel_path), s));
                    }
                }
                Ok(())
            };
            if attempt().is_err() {
                continue;
            }
            let keep: Vec<LibFile> = files.into_iter().filter(|f| !parts.contains(f)).collect();
            lib.update(&rec["id"], &json!({ "files": crate::overlays::files_value(&keep) }), None).map_err(io)?;
        }
        Ok(())
    }

    // ---------- combined packs ----------

    pub fn pack_folder(&self, pack_id: &str) -> PathBuf {
        self.packs_dir().join(pack_id)
    }

    pub fn pack_member_file(&self, pack_id: &str, member_id: &str) -> PathBuf {
        self.pack_folder(pack_id).join(format!("{member_id}.vpk"))
    }

    /// Flatten a record into one VPK stored as a pack member; the member descriptor comes back.
    pub fn add_pack_member_from_record(&self, pack_id: &str, rec: &Value, member_id: &str) -> Result<Value, String> {
        let buf = self.merge_to_single_vpk(&files_of(rec.get("files").unwrap_or(&Value::Null)), None)?;
        fs::create_dir_all(self.pack_folder(pack_id)).map_err(io)?;
        fs::write(self.pack_member_file(pack_id, member_id), &buf).map_err(io)?;
        let (mut heroes, mut info, mut fp) = (0usize, String::new(), Value::Null);
        if let Ok(paths) = vpk::list_paths(&buf) {
            let a = analyze_vpk_paths(&paths);
            heroes = a.heroes.len();
            info = describe_analysis(&a);
            if let Ok(f) = vpk::fingerprint_vpk(&buf) {
                fp = json!(f);
            }
        }
        let or_null = |k: &str| rec.get(k).filter(|v| crate::js::truthy(v)).cloned().unwrap_or(Value::Null);
        Ok(json!({
            "id": member_id, "name": rec.get("name").cloned().unwrap_or(Value::Null),
            "categoryId": rec.get("categoryId").cloned().unwrap_or(Value::Null),
            "styleLabel": or_null("styleLabel"), "preview": or_null("preview"),
            "enabled": rec.get("enabled") != Some(&Value::Bool(false)), "heroes": heroes, "info": info, "fp": fp,
        }))
    }

    /// The slot base ("pak10") a pack deploys to, from its recorded files.
    pub fn pack_base(files: &[LibFile]) -> Option<String> {
        dir_file(files).map(|d| strip_dir(&d.rel_path))
    }

    /// A pack's deployed files (index and volumes, in any state) taken out of the language folder.
    pub fn remove_pack_deployed(&self, files: &[LibFile]) -> Result<(), String> {
        let lang = self.lang_folder()?;
        if !lang.exists() {
            return Ok(());
        }
        let Some(base) = Self::pack_base(files) else { return Ok(()) };
        let re = Regex::new(&format!(r"(?i)^{}(_dir|_\d{{3}})\.vpk(\.off|\.moff)?$", regex::escape(&base))).unwrap();
        for f in crate::js::dir_names(&lang) {
            if re.is_match(&f) {
                let _ = fs::remove_file(lang.join(&f));
            }
        }
        Ok(())
    }

    /// (Re)build a pack's deployed VPK from its enabled members: (files, conflicts).
    pub fn deploy_pack(&self, pack: &Value) -> Result<Value, String> {
        let lang = self.lang_folder()?;
        self.ensure_lang_folder()?;
        let files = files_of(pack.get("files").unwrap_or(&Value::Null));
        self.remove_pack_deployed(&files)?;
        let id = pack.get("id").map(crate::js::string).unwrap_or_default();
        let members: Vec<&Value> = pack
            .get("members")
            .and_then(Value::as_array)
            .map(|m| m.iter().filter(|m| m.get("enabled").is_some_and(crate::js::truthy)).collect())
            .unwrap_or_default();
        if members.is_empty() {
            return Ok(json!({ "files": [], "conflicts": [] }));
        }
        let base = match Self::pack_base(&files) {
            Some(b) => b,
            None => strip_dir(&self.allocate_pak(&mut self.used_pak_names()?, false)?),
        };
        let mut bufs = Vec::new();
        for m in members {
            let mid = m.get("id").map(crate::js::string).unwrap_or_default();
            bufs.push((mid.clone(), fs::read(self.pack_member_file(&id, &mid)).map_err(io)?));
        }
        let c = vpk::combine_to_files(&bufs, &lang, &base, 1 << 30).map_err(io)?;
        let mut out = vec![json!({ "root": "lang", "relPath": c.dir })];
        out.extend(c.parts.iter().map(|p| json!({ "root": "lang", "relPath": p })));
        let conflicts: Vec<Value> = c.conflicts.iter().map(|(k, p)| json!({ "key": k, "path": p })).collect();
        Ok(json!({ "files": out, "conflicts": conflicts }))
    }

    /// Fully delete a pack: its deployed VPK and every stored member.
    pub fn remove_pack_fully(&self, pack: &Value) -> Result<(), String> {
        self.remove_pack_deployed(&files_of(pack.get("files").unwrap_or(&Value::Null)))?;
        let _ = fs::remove_dir_all(self.pack_folder(&pack.get("id").map(crate::js::string).unwrap_or_default()));
        Ok(())
    }

    /// A stored member turned back into a standalone mod in a fresh slot.
    pub fn deploy_member_as_mod(&self, pack_id: &str, member_id: &str) -> Result<Vec<LibFile>, String> {
        let lang = self.lang_folder()?;
        self.ensure_lang_folder()?;
        let buf = fs::read(self.pack_member_file(pack_id, member_id)).map_err(io)?;
        let pak = self.allocate_pak(&mut self.used_pak_names()?, false)?;
        crate::file_tx::write_into(&buf, &lang.join(&pak), None).map_err(io)?;
        Ok(vec![LibFile::new("lang", &pak)])
    }
}

/// One hero's part of a split: its name, its VPK, the paths it owns.
pub type HeroPart = (String, Vec<u8>, Vec<String>);

/// A merged multi-hero VPK as one self-contained VPK per hero it is about (src/vpk-write.ts
/// splitVpkByHero): (hero name, bytes, the paths it owns). Empty under two heroes.
pub fn split_by_hero(dir_path: &Path) -> Result<Vec<HeroPart>, String> {
    let buf = fs::read(dir_path).map_err(io)?;
    let entries = vpk::read_entries(&buf, dir_path, None).map_err(io)?;
    let paths: Vec<String> = entries.iter().map(Entry::path).collect();
    let heroes: Vec<_> = subject_heroes(&analyze_vpk_paths(&paths)).into_iter().filter(|h| h.models > 0).collect();
    if heroes.len() < 2 {
        return Ok(Vec::new());
    }
    let ids: Vec<&str> = heroes.iter().map(|h| h.id.as_str()).collect();
    let owner_of = |p: &str| -> Option<usize> {
        ids.iter()
            .position(|id| {
                p.contains(&format!("/heroes/{id}/"))
                    || p.starts_with(&format!("heroes/{id}/"))
                    || p.contains(&format!("/hero_{id}/"))
                    || p.starts_with(&format!("hero_{id}/"))
            })
            .or_else(|| ids.iter().position(|id| p.contains(&format!("/{id}/")) || p.starts_with(&format!("{id}/"))))
            .or_else(|| {
                let base = p.rsplit('/').next().unwrap_or("");
                ids.iter().position(|id| base.starts_with(&format!("{id}_")))
            })
    };
    let mut buckets: Vec<Vec<Entry>> = vec![Vec::new(); ids.len()];
    let mut shared = Vec::new();
    for (en, p) in entries.into_iter().zip(&paths) {
        match owner_of(p) {
            Some(i) => buckets[i].push(en),
            None => shared.push(en),
        }
    }
    Ok(heroes
        .iter()
        .zip(buckets)
        .map(|(h, own)| {
            let own_paths = own.iter().map(Entry::path).collect();
            let mut all = own;
            all.extend(shared.iter().cloned());
            (h.name.clone(), vpk::build(&all), own_paths)
        })
        .collect())
}
