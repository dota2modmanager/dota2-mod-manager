//! Fonts and cursors: loose files written over the game's own, replacing src/overlays.ts and
//! src/overlays-cursor.ts.
//!
//! A font or a cursor set replaces files in dota\panorama\fonts and dota\resource\cursor that
//! the game needs, so the first write keeps the game's copy under backups\, and removing the mod
//! puts that copy back. Every write is recorded by hash in backups\written.json: a file that holds
//! what this app wrote is this app's file, whatever else it happens to match (a mod that ships a
//! few of Valve's files unchanged otherwise looked undone the moment it went in).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde_json::{json, Map, Value};

use crate::file_tx::{copy_into, write_into, FileTx};
use crate::i18n::t;
use crate::installer::Installer;
use crate::installer_folder::{CURSOR_SUBDIR, FONTS_SUBDIR};
use crate::safe_zip::{safe_join, sha1_hex, OpenedZip, Source};

const WRITTEN: &str = "written.json";

/// A library file record: which folder it is relative to, and where in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibFile {
    pub root: String,
    pub rel_path: String,
}

impl LibFile {
    pub fn new(root: &str, rel_path: &str) -> LibFile {
        LibFile { root: root.to_string(), rel_path: rel_path.to_string() }
    }
    pub fn from_value(v: &Value) -> LibFile {
        LibFile {
            root: v.get("root").map(crate::js::string).unwrap_or_default(),
            rel_path: v.get("relPath").map(crate::js::string).unwrap_or_default(),
        }
    }
    pub fn to_value(&self) -> Value {
        json!({ "root": self.root, "relPath": self.rel_path })
    }
}

pub fn files_of(v: &Value) -> Vec<LibFile> {
    v.as_array().map(|a| a.iter().map(LibFile::from_value).collect()).unwrap_or_default()
}

pub fn files_value(files: &[LibFile]) -> Value {
    Value::Array(files.iter().map(LibFile::to_value).collect())
}

/// Windows compares names without case, and a font mod names a file differently from Valve.
fn written_key(root: &str, rel_path: &str) -> String {
    format!("{root}/{}", rel_path.replace('\\', "/").to_lowercase())
}

fn rel_join(dir: &Path, rel: &str) -> PathBuf {
    rel.split(['/', '\\']).filter(|p| !p.is_empty()).fold(dir.to_path_buf(), |p, s| p.join(s))
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

impl Installer {
    pub fn live_dir(&self, root: &str) -> Result<PathBuf, String> {
        let game =
            self.game.as_ref().filter(|g| !g.as_os_str().is_empty()).ok_or_else(|| t("Путь к Dota 2 не задан", &[]))?;
        let sub: &[&str] = if root == "fonts" { &FONTS_SUBDIR } else { &CURSOR_SUBDIR };
        Ok(sub.iter().fold(game.clone(), |p, s| p.join(s)))
    }

    /// sha1 of the last write, by "root/relpath", in the file's own order.
    pub fn written(&self) -> Map<String, Value> {
        fs::read_to_string(self.backups_dir().join(WRITTEN))
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| match v {
                Value::Object(m) => Some(m),
                _ => None,
            })
            .unwrap_or_default()
    }

    /// Record (or with None, forget) what was written at each path.
    pub fn note_written(&self, root: &str, entries: &[(String, Option<String>)]) {
        if entries.is_empty() {
            return;
        }
        let mut map = self.written();
        for (rel, hash) in entries {
            match hash {
                Some(h) => {
                    map.insert(written_key(root, rel), json!(h));
                }
                None => {
                    map.shift_remove(&written_key(root, rel));
                }
            }
        }
        let _ = fs::create_dir_all(self.backups_dir());
        let _ = fs::write(self.backups_dir().join(WRITTEN), crate::js::stringify(&Value::Object(map), " "));
    }

    pub fn forget_written(&self, files: &[LibFile]) {
        for root in ["fonts", "cursor"] {
            let gone: Vec<(String, Option<String>)> =
                files.iter().filter(|f| f.root == root).map(|f| (f.rel_path.clone(), None)).collect();
            self.note_written(root, &gone);
        }
    }

    /// Keep the game's copy before the first write over it; a file that holds our own earlier
    /// write is not the game's.
    fn keep_original(&self, dest: &Path, backup: &Path, mine: Option<&str>) -> Result<(), String> {
        if !dest.exists() || backup.exists() {
            return Ok(());
        }
        if let Some(m) = mine {
            if sha1_hex(&fs::read(dest).map_err(io)?) == m {
                return Ok(());
            }
        }
        copy_into(dest, backup, None).map_err(io)
    }

    /// The files of one archive that match `pattern`, written over the game's folder for `root`.
    fn install_loose(
        &self,
        root: &str,
        source: Source,
        mod_name: &str,
        pattern: &Regex,
        mut tx: Option<&mut FileTx>,
    ) -> Result<Vec<LibFile>, String> {
        let target = self.live_dir(root)?;
        fs::create_dir_all(&target).map_err(io)?;
        let mut archive = OpenedZip::open(source, Some(mod_name), None)?;
        let backup_root = self.backups_dir().join(root);
        let before = self.written();
        let mut records = Vec::new();
        let mut hashes = Vec::new();
        for file in archive.files.clone() {
            let Some(m) = pattern.captures(&file.path) else { continue };
            let rel = m[1].to_string();
            let dest = safe_join(&target, &rel)?;
            let data = archive.read(&file)?;
            let mine = before.get(&written_key(root, &rel)).and_then(Value::as_str);
            self.keep_original(&dest, &safe_join(&backup_root, &rel)?, mine)?;
            write_into(&data, &dest, tx.as_deref_mut()).map_err(io)?;
            records.push(LibFile::new(root, &rel));
            hashes.push((rel, Some(sha1_hex(&data))));
        }
        self.note_written(root, &hashes);
        Ok(records)
    }

    /// A font archive's <Name>/assets/custom goes to game\dota\panorama\fonts.
    pub fn install_fonts(
        &self,
        source: Source,
        mod_name: &str,
        tx: Option<&mut FileTx>,
    ) -> Result<Vec<LibFile>, String> {
        static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
        let re = RE.get_or_init(|| Regex::new(r"(?i)assets/custom/(.+)$").unwrap());
        let records = self.install_loose("fonts", source, mod_name, re, tx)?;
        if records.is_empty() {
            return Err(t("{0}: в архиве не найдено assets/custom", &[json!(mod_name)]));
        }
        Ok(records)
    }

    /// A cursor archive's <Name>/cursor/* goes to game\dota\resource\cursor.
    pub fn install_cursor(
        &self,
        source: Source,
        mod_name: &str,
        tx: Option<&mut FileTx>,
    ) -> Result<Vec<LibFile>, String> {
        static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
        let re = RE.get_or_init(|| Regex::new(r"(?i)(?:^|/)cursor/(.+)$").unwrap());
        let records = self.install_loose("cursor", source, mod_name, re, tx)?;
        if records.is_empty() {
            return Err(t("{0}: в архиве не найдена папка cursor", &[json!(mod_name)]));
        }
        Ok(records)
    }

    // ---------- cursor sets ----------

    pub fn cursor_store_dir(&self, rec_id: &str) -> PathBuf {
        let clean: String = rec_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
        self.cursors_dir().join(clean)
    }

    pub fn cursor_files(files: &[LibFile]) -> Vec<LibFile> {
        files.iter().filter(|f| f.root == "cursor").cloned().collect()
    }

    /// Keep a copy of the set that is live right now (only for the record that owns it).
    pub fn ensure_cursor_store(&self, rec_id: Option<&str>, files: &[LibFile]) -> Result<bool, String> {
        let own = Self::cursor_files(files);
        let Some(rec_id) = rec_id.filter(|r| !r.is_empty()) else { return Ok(false) };
        if own.is_empty() {
            return Ok(false);
        }
        let store = self.cursor_store_dir(rec_id);
        if fs::read_dir(&store).is_ok_and(|mut d| d.next().is_some()) {
            return Ok(true);
        }
        let live = self.live_dir("cursor")?;
        let mut n = 0;
        for f in &own {
            let src = rel_join(&live, &f.rel_path);
            if !src.exists() {
                continue;
            }
            copy_into(&src, &rel_join(&store, &f.rel_path), None).map_err(io)?;
            n += 1;
        }
        Ok(n > 0)
    }

    /// Write the set over the game's cursor folder (vanilla files backed up once).
    pub fn deploy_cursor(&self, rec_id: &str, files: &[LibFile]) -> Result<usize, String> {
        let store = self.cursor_store_dir(rec_id);
        let live = self.live_dir("cursor")?;
        let backup_root = self.backups_dir().join("cursor");
        let mut hashes = Vec::new();
        for f in Self::cursor_files(files) {
            let src = rel_join(&store, &f.rel_path);
            if !src.exists() {
                continue;
            }
            let bytes = fs::read(&src).map_err(io)?;
            hashes.push((f.rel_path.clone(), Some(sha1_hex(&bytes))));
            let dest = rel_join(&live, &f.rel_path);
            if dest.exists() && fs::read(&dest).map_err(io)? == bytes {
                continue;
            }
            let backup = rel_join(&backup_root, &f.rel_path);
            if dest.exists() && !backup.exists() {
                copy_into(&dest, &backup, None).map_err(io)?;
            }
            copy_into(&src, &dest, None).map_err(io)?;
        }
        if hashes.is_empty() {
            return Err(t("Файлы курсора не сохранены — переустанови мод", &[]));
        }
        self.note_written("cursor", &hashes);
        Ok(hashes.len())
    }

    /// Put the vanilla cursor back, or drop a file Valve has no copy of.
    pub fn undeploy_cursor(&self, rec_id: &str, files: &[LibFile]) -> Result<(), String> {
        self.ensure_cursor_store(Some(rec_id), files)?;
        let live = self.live_dir("cursor")?;
        let backup_root = self.backups_dir().join("cursor");
        for f in Self::cursor_files(files) {
            let dest = rel_join(&live, &f.rel_path);
            let backup = rel_join(&backup_root, &f.rel_path);
            if backup.exists() {
                copy_into(&backup, &dest, None).map_err(io)?;
            } else if dest.exists() {
                let _ = fs::remove_file(&dest);
            }
        }
        self.forget_written(files);
        Ok(())
    }

    /// The set packed back into the catalog's layout, <Name>/cursor/<file>.
    pub fn cursor_zip(&self, rec_id: &str, name: &str, files: &[LibFile]) -> Result<Vec<u8>, String> {
        let store = self.cursor_store_dir(rec_id);
        let live = self.live_dir("cursor")?;
        let base = if name.is_empty() { "cursor" } else { name };
        let folder: String = base.chars().map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect();
        let mut entries = Vec::new();
        for f in Self::cursor_files(files) {
            let Some(src) =
                [rel_join(&store, &f.rel_path), rel_join(&live, &f.rel_path)].into_iter().find(|p| p.exists())
            else {
                continue;
            };
            entries.push((format!("{folder}/cursor/{}", f.rel_path), fs::read(src).map_err(io)?));
        }
        if entries.is_empty() {
            return Err(t("Файлы курсора не сохранены — переустанови мод", &[]));
        }
        crate::safe_zip::write_zip(&entries)
    }

    pub fn drop_cursor_store(&self, rec_id: Option<&str>) {
        if let Some(r) = rec_id.filter(|r| !r.is_empty()) {
            let _ = fs::remove_dir_all(self.cursor_store_dir(r));
        }
    }

    /// basename -> sha1 of every file in panorama\fonts, for matching a font mod by its files.
    pub fn font_folder_hashes(&self) -> Option<BTreeMap<String, String>> {
        self.game.as_ref().filter(|g| !g.as_os_str().is_empty())?;
        let dir = self.live_dir("fonts").ok()?;
        if !dir.exists() {
            return None;
        }
        let mut out = BTreeMap::new();
        fn walk(d: &Path, out: &mut BTreeMap<String, String>) {
            let Ok(entries) = crate::js::read_dir(d) else { return };
            for e in entries {
                let full = e.path();
                let Ok(ft) = e.file_type() else { continue };
                if ft.is_dir() {
                    walk(&full, out);
                } else if ft.is_file() {
                    if let Ok(b) = fs::read(&full) {
                        out.insert(e.file_name().to_string_lossy().to_lowercase(), sha1_hex(&b));
                    }
                }
            }
        }
        walk(&dir, &mut out);
        Some(out)
    }

    // ---------- after Steam's file check ----------

    /// Did the game take this file back?
    pub fn vanilla_is_back(&self, f: &LibFile, written: &Map<String, Value>) -> bool {
        if f.root != "fonts" && f.root != "cursor" {
            return false;
        }
        let Ok(live) = self.live_dir(&f.root) else { return false };
        let deployed = rel_join(&live, &f.rel_path);
        if !deployed.exists() {
            return true;
        }
        let backup = rel_join(&self.backups_dir().join(&f.root), &f.rel_path);
        if !backup.exists() {
            return false;
        }
        let (Ok(now), Ok(orig)) = (fs::read(&deployed), fs::read(&backup)) else { return false };
        if written.get(&written_key(&f.root, &f.rel_path)).and_then(Value::as_str) == Some(sha1_hex(&now).as_str()) {
            return false;
        }
        now == orig
    }

    /// Installed records (enabled ones) whose files the game has taken back: their indexes.
    pub fn lost_to_verify(&self, records: &[Value]) -> Vec<usize> {
        if self.game.as_ref().filter(|g| !g.as_os_str().is_empty()).is_none() {
            return Vec::new();
        }
        let written = self.written();
        records
            .iter()
            .enumerate()
            .filter(|(_, r)| r.get("enabled") != Some(&Value::Bool(false)))
            .filter(|(_, r)| {
                files_of(r.get("files").unwrap_or(&Value::Null)).iter().any(|f| self.vanilla_is_back(f, &written))
            })
            .map(|(i, _)| i)
            .collect()
    }

    /// Put one back without asking: a cursor from its store, a font from the download cache.
    pub fn restore_deployed(&self, rec: &Value) -> Result<Option<&'static str>, String> {
        let files = files_of(rec.get("files").unwrap_or(&Value::Null));
        let id = rec.get("id").map(crate::js::string).unwrap_or_default();
        let name = rec.get("name").map(crate::js::string).unwrap_or_default();
        let is_cursor = files.iter().any(|f| f.root == "cursor");
        if is_cursor && !Self::cursor_files(&files).is_empty() && self.cursor_store_dir(&id).exists() {
            self.deploy_cursor(&id, &files)?;
            return Ok(Some("store"));
        }
        let cat = rec.get("categoryId").and_then(Value::as_str);
        let file_ref = rec.get("fileRef").and_then(Value::as_str);
        let Some(local) = self.cached_archive(cat, file_ref) else { return Ok(None) };
        if is_cursor {
            self.install_cursor(Source::File(&local), &name, None)?;
        } else {
            self.install_fonts(Source::File(&local), &name, None)?;
        }
        Ok(Some("cache"))
    }
}
