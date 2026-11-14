//! The language folder as a whole: the "mods off" switch, the note of which files are ours, the
//! leftovers of a change the app died in, and the files nobody installed through the app.
//! Replacing src/installer-folder.ts, which says why each rule is the way it is.

use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::i18n::t;
use crate::installer::{with_suffix, Installer};
use crate::installer_files::{is_official_lang_file, staged_re, MASTER_MARK, MASTER_OFF, OWNERSHIP_FILE};
use crate::minify::{is_minify_file, is_minify_pak};
use crate::vpk_analyze::{analyze_vpk_paths, describe_analysis, name_from_analysis, subject_heroes, Analysis};

/// Where fonts and cursors live under the game folder (src/overlays.ts).
pub const FONTS_SUBDIR: [&str; 3] = ["dota", "panorama", "fonts"];
pub const CURSOR_SUBDIR: [&str; 3] = ["dota", "resource", "cursor"];

/// A file in the game folder nobody installed through the app, as the library lists it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignItem {
    pub kind: &'static str,
    pub key: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    pub primary: bool,
    pub size: u64,
    pub enabled: bool,
    pub files: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heroes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subjects: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero_names: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fp: Option<String>,
}

/// What the game's own item table says a path list is (src/mod-id.ts).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Guess {
    pub items: Vec<String>,
    pub slots: Vec<String>,
    pub hero_names: Vec<String>,
}

fn names_in(dir: &Path) -> Vec<String> {
    crate::js::dir_names(dir)
}

fn is_file(p: &Path) -> bool {
    fs::metadata(p).is_ok_and(|m| m.is_file())
}

fn strip_off(lower: &str) -> &str {
    lower.strip_suffix(".off").unwrap_or(lower)
}

/// What a path list is, as precisely as this machine allows: the game's names when it knows
/// them, merged with the guess from the paths.
pub fn describe_paths(inst: &Installer, paths: &[String], a: &Analysis) -> (String, Vec<String>, Option<Vec<String>>) {
    let info = describe_analysis(a);
    let hero_names: Vec<String> = a.heroes.iter().map(|h| h.name.clone()).collect();
    let Some(named) = inst.identify.as_ref().and_then(|f| f(paths)) else { return (info, hero_names, None) };
    let mut carried: Vec<String> = Vec::new();
    for h in subject_heroes(a).into_iter().map(|h| h.name).chain(named.hero_names.iter().cloned()) {
        if !carried.contains(&h) {
            carried.push(h);
        }
    }
    let info = if named.items.len() <= 3 {
        named.items.join(", ")
    } else {
        format!("{} +{}", named.items[..2].join(", "), named.items.len() - 2)
    };
    (info, carried, Some(named.items))
}

impl Installer {
    /// What the master switch is allowed to rename: not the game's files, not Minify's, not our note.
    pub fn is_togglable_mod_file(&self, base_lower: &str) -> bool {
        !is_official_lang_file(base_lower) && !is_minify_file(base_lower) && base_lower != OWNERSHIP_FILE
    }

    /// Whether the master switch is off: any .moff file in the folder.
    pub fn master_is_off(&self) -> Result<bool, String> {
        let lang = self.lang_folder()?;
        Ok(names_in(&lang).iter().any(|f| f.to_lowercase().ends_with(MASTER_OFF)))
    }

    /// Every mod pak on or off at once without losing per-mod state; maps/ too.
    pub fn set_master_enabled(&self, enabled: bool) -> Result<usize, String> {
        let lang = self.lang_folder()?;
        if !lang.exists() {
            return Ok(0);
        }
        let e = |e: std::io::Error| e.to_string();
        let mut changed = 0;
        let mut sweep = |dir: &Path| -> Result<(), String> {
            for f in names_in(dir) {
                let full = dir.join(&f);
                if !is_file(&full) {
                    continue;
                }
                let lower = f.to_lowercase();
                if enabled {
                    if dir == lang && lower == MASTER_MARK {
                        let _ = fs::remove_file(&full);
                    } else if lower.ends_with(MASTER_OFF) {
                        fs::rename(&full, dir.join(&f[..f.len() - MASTER_OFF.len()])).map_err(e)?;
                        changed += 1;
                    }
                } else {
                    if lower.ends_with(MASTER_OFF) || lower.ends_with(".off") {
                        continue;
                    }
                    if dir == lang && !self.is_togglable_mod_file(&lower) {
                        continue;
                    }
                    fs::rename(&full, with_suffix(&full, MASTER_OFF)).map_err(e)?;
                    changed += 1;
                }
            }
            Ok(())
        };
        sweep(&lang)?;
        let maps = lang.join("maps");
        if maps.exists() {
            sweep(&maps)?;
        }
        if !enabled {
            fs::write(lang.join(MASTER_MARK), "").map_err(e)?;
        }
        Ok(changed)
    }

    /// Say on disk which files in the language folder are ours; never fails an operation.
    /// `updated`: the time written, as toISOString gives it.
    pub fn write_ownership(&self, rel_paths: &[String], updated: &str) {
        let Ok(lang) = self.lang_folder() else { return };
        if !lang.exists() {
            return;
        }
        let mut files: Vec<String> = Vec::new();
        for r in rel_paths {
            let r = r.replace('\\', "/");
            if !files.contains(&r) {
                files.push(r);
            }
        }
        files.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        let body = json!({
            "app": "Dota 2 Mod Manager",
            "url": "https://dota2modmanager.com",
            "note": "Files listed here were installed by this app. Anything else in this folder is not ours.",
            "updated": updated,
            "files": files,
        });
        let _ = fs::write(lang.join(OWNERSHIP_FILE), crate::js::stringify(&body, "  "));
    }

    /// Whether this app installed the file at `rel_path`, according to the note on disk.
    pub fn owns_file(&self, rel_path: &str) -> bool {
        let Ok(lang) = self.lang_folder() else { return false };
        let Ok(bytes) = fs::read(lang.join(OWNERSHIP_FILE)) else { return false };
        let Ok(raw) = serde_json::from_str::<Value>(&String::from_utf8_lossy(&bytes)) else { return false };
        let want = rel_path.replace('\\', "/").to_lowercase();
        match raw.get("files") {
            Some(Value::Array(a)) => a.iter().any(|f| crate::js::string(f).to_lowercase() == want),
            Some(v) if crate::js::truthy(v) => false,
            _ => false,
        }
    }

    /// Clean up after a change that never finished: a parked file whose original is gone goes
    /// back; one whose original is there is dropped after `max_age_ms`.
    pub fn sweep_staged(&self, tools_dir: &Path, max_age_ms: f64) -> (usize, usize) {
        let (mut restored, mut dropped) = (0, 0);
        let Some(game) = self.game.as_ref().filter(|g| !g.as_os_str().is_empty()) else { return (0, 0) };
        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Ok(l) = self.lang_folder() {
            dirs.push(l);
        }
        dirs.push(FONTS_SUBDIR.iter().fold(game.clone(), |p, s| p.join(s)));
        dirs.push(CURSOR_SUBDIR.iter().fold(game.clone(), |p, s| p.join(s)));
        dirs.push(tools_dir.to_path_buf());
        let now = std::time::SystemTime::now();
        for dir in dirs {
            for name in names_in(&dir) {
                if !staged_re().is_match(&name) {
                    continue;
                }
                let parked = dir.join(&name);
                let original = dir.join(staged_re().replace(&name, "").as_ref());
                if !original.exists() {
                    if fs::rename(&parked, &original).is_ok() {
                        restored += 1;
                    }
                    continue;
                }
                let age = fs::metadata(&parked)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|m| now.duration_since(m).ok())
                    .map_or(0.0, |d| d.as_secs_f64() * 1000.0);
                if age > max_age_ms {
                    let gone = if parked.is_dir() { fs::remove_dir_all(&parked) } else { fs::remove_file(&parked) };
                    if gone.is_ok() {
                        dropped += 1;
                    }
                }
            }
        }
        (restored, dropped)
    }

    /// Does a record's primary VPK still exist on disk (as is, .off or .moff)?
    pub fn lang_primary_present(&self, rec: &Value) -> bool {
        let Ok(lang) = self.lang_folder() else { return true };
        if !lang.exists() {
            return true;
        }
        let files = rec.get("files").and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
        let primary = files.iter().find(|f| {
            f.get("root").and_then(Value::as_str) == Some("lang")
                && f.get("relPath").and_then(Value::as_str).is_some_and(|p| p.to_lowercase().ends_with(".vpk"))
        });
        let Some(rel) = primary.and_then(|f| f.get("relPath")).and_then(Value::as_str) else { return true };
        ["", ".off", ".moff"].iter().any(|s| with_suffix(&lang.join(rel), s).exists())
    }

    /// "<base>_NNN.vpk" volumes next to a "<base>_dir.vpk".
    pub fn sibling_parts(&self, dir_rel_path: &str) -> Vec<String> {
        let lower = dir_rel_path.to_lowercase();
        if !lower.ends_with("_dir.vpk") {
            return Vec::new();
        }
        let Ok(lang) = self.lang_folder() else { return Vec::new() };
        let full = lang.join(dir_rel_path);
        let dir = full.parent().map(Path::to_path_buf).unwrap_or(lang.clone());
        let file = full.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
        let prefix = &file[..file.len() - 8];
        let Ok(re) = Regex::new(&format!(r"(?i)^{}_\d{{3}}\.vpk$", regex::escape(prefix))) else { return Vec::new() };
        let sub = Path::new(dir_rel_path).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        let off = off_re();
        names_in(&dir)
            .into_iter()
            .filter(|f| re.is_match(&off.replace(f, "")))
            .map(|f| {
                let rel = if sub.is_empty() || sub == "." { f } else { format!("{sub}/{f}") };
                off.replace(&rel, "").into_owned()
            })
            .collect()
    }

    /// A foreign VPK item: read enough of the file to name it, illustrate it and recognise it.
    pub fn vpk_item(
        &self,
        abs: &Path,
        rel_path: &str,
        display_name: &str,
        primary: bool,
    ) -> Result<ForeignItem, String> {
        let base = off_re().replace(rel_path, "").into_owned();
        let size = fs::metadata(abs).map_err(|e| e.to_string())?.len();
        let mut files = vec![json!({ "root": "lang", "relPath": base })];
        for part in self.sibling_parts(&base) {
            files.push(json!({ "root": "lang", "relPath": part }));
        }
        let mut item = ForeignItem {
            kind: "vpk",
            key: rel_path.to_string(),
            name: display_name.to_string(),
            file_name: Some(base),
            primary,
            size,
            enabled: !abs.to_string_lossy().to_lowercase().ends_with(".off"),
            files,
            info: None,
            heroes: None,
            subjects: None,
            items: None,
            hero_names: None,
            kind_tag: None,
            fp: None,
        };
        let read = crate::vpk::read_index_file(abs).and_then(|buf| crate::vpk::list_paths(&buf).map(|p| (buf, p)));
        if let Ok((buf, paths)) = read {
            let a = analyze_vpk_paths(&paths);
            let (info, hero_names, items) = describe_paths(self, &paths, &a);
            item.info = Some(info);
            item.heroes = Some(a.heroes.len());
            item.subjects = Some(subject_heroes(&a).iter().filter(|h| h.models > 0).count());
            item.items = items;
            item.hero_names = Some(hero_names);
            item.kind_tag = Some(a.kind.clone());
            item.fp = crate::vpk::fingerprint_vpk(&buf).ok();
            if let Some(n) = name_from_analysis(&a).filter(|n| !n.is_empty()) {
                item.name = n;
            }
        }
        Ok(item)
    }

    /// Foreign content across every place a mod can live: the language folder, its maps/, and a
    /// cursor set. `scan_extras` false skips the last two.
    pub fn external_files(&self, known_files: &[Value], scan_extras: bool) -> Result<Vec<ForeignItem>, String> {
        let Some(game) = self.game.as_ref().filter(|g| !g.as_os_str().is_empty()) else { return Ok(Vec::new()) };
        let str_of = |f: &Value, k: &str| f.get(k).map(crate::js::string).unwrap_or_default();
        let known_lang: std::collections::HashSet<String> = known_files
            .iter()
            .filter(|f| f.get("root").and_then(Value::as_str) == Some("lang"))
            .map(|f| str_of(f, "relPath").to_lowercase())
            .collect();
        let known_cursor = known_files.iter().any(|f| f.get("root").and_then(Value::as_str) == Some("cursor"));
        let mut out = Vec::new();
        let lang = self.lang_folder()?;
        if lang.exists() {
            let names = names_in(&lang);
            static DIR: OnceLock<Regex> = OnceLock::new();
            static PART: OnceLock<Regex> = OnceLock::new();
            let dir_re = DIR.get_or_init(|| Regex::new(r"^(.*)_dir\.vpk$").unwrap());
            let part_re = PART.get_or_init(|| Regex::new(r"^(.*)_\d{3}\.vpk$").unwrap());
            let indexed: std::collections::HashSet<String> = names
                .iter()
                .filter_map(|f| dir_re.captures(strip_off(&f.to_lowercase())).map(|m| m[1].to_string()))
                .collect();
            for f in &names {
                let full = lang.join(f);
                if !is_file(&full) {
                    continue;
                }
                let lower = f.to_lowercase();
                if lower.ends_with(MASTER_OFF) || staged_re().is_match(f) {
                    continue;
                }
                let base = strip_off(&lower);
                if is_official_lang_file(base) || known_lang.contains(base) || base == OWNERSHIP_FILE {
                    continue;
                }
                if is_minify_file(base) || is_minify_pak(&full) {
                    continue;
                }
                if part_re.captures(base).is_some_and(|m| indexed.contains(&m[1])) {
                    continue;
                }
                out.push(self.vpk_item(&full, f, f, true)?);
            }
            let maps = lang.join("maps");
            if scan_extras && maps.exists() {
                for f in names_in(&maps) {
                    if !f.to_lowercase().ends_with(".vpk") {
                        continue;
                    }
                    let rel = format!("maps/{f}");
                    if known_lang.contains(strip_off(&rel.to_lowercase())) {
                        continue;
                    }
                    if is_minify_pak(&maps.join(&f)) {
                        continue;
                    }
                    out.push(self.vpk_item(&maps.join(&f), &rel, &rel, false)?);
                }
            }
        }
        if scan_extras && !known_cursor {
            let cursor = CURSOR_SUBDIR.iter().fold(game.clone(), |p, s| p.join(s));
            if cursor.exists() {
                let mut files: Vec<(String, Vec<u8>)> = Vec::new();
                let mut rels: Vec<String> = Vec::new();
                fn walk(d: &Path, pre: &str, files: &mut Vec<(String, Vec<u8>)>, rels: &mut Vec<String>) {
                    let Ok(read) = crate::js::read_dir(d) else { return };
                    for e in read {
                        let name = e.file_name().to_string_lossy().into_owned();
                        let rel = if pre.is_empty() { name.clone() } else { format!("{pre}/{name}") };
                        let Ok(kind) = e.file_type() else { continue };
                        if kind.is_dir() {
                            walk(&e.path(), &rel, files, rels);
                        } else if kind.is_file() {
                            if let Ok(data) = fs::read(e.path()) {
                                files.push((name.to_lowercase(), data));
                                rels.push(rel);
                            }
                        }
                    }
                }
                walk(&cursor, "", &mut files, &mut rels);
                if !files.is_empty() {
                    let size = files.iter().map(|(_, d)| d.len() as u64).sum();
                    let refs: Vec<(String, &[u8])> = files.iter().map(|(p, d)| (p.clone(), d.as_slice())).collect();
                    out.push(ForeignItem {
                        kind: "cursor",
                        key: "__cursor__".into(),
                        name: t("Курсор", &[]),
                        file_name: None,
                        primary: false,
                        size,
                        enabled: true,
                        files: rels.iter().map(|r| json!({ "root": "cursor", "relPath": r })).collect(),
                        info: None,
                        heroes: None,
                        subjects: None,
                        items: None,
                        hero_names: None,
                        kind_tag: None,
                        fp: Some(crate::vpk::fingerprint_files(&refs)),
                    });
                }
            }
        }
        Ok(out)
    }
}

fn off_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)\.off$").unwrap())
}
