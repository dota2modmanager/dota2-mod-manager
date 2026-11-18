//! Writing a mod into the game folder and taking it out again, replacing src/installer-write.ts:
//! a catalog archive unpacked into the language folder, a tool into the app's own folder, a
//! mod's files switched on and off, and removed with Valve's own put back where a font or
//! cursor sat. Whatever touches several files runs as one change (file_tx.rs).

use std::fs;
use std::path::Path;

use regex::Regex;

use crate::disk_space::ensure_space;
use crate::file_tx::{copy_into, write_into, FileTx};
use crate::installer::{with_suffix, Installer};
use crate::installer_files::MASTER_OFF;
use crate::overlays::LibFile;
use crate::safe_zip::{safe_join, OpenedZip, Source};

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn base_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// What an install is: its catalog group, the name it goes by, the file it came as.
pub struct InstallJob<'a> {
    pub category_id: &'a str,
    pub mod_name: &'a str,
    pub local: &'a Path,
}

fn skipped(lower: &str) -> bool {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?i)(^|/)(guide\.txt|install\.bat|uninstall\.bat|readme[^/]*)$").unwrap());
    let base = lower.rsplit('/').next().unwrap_or("");
    base.is_empty() || lower.contains("!guide") || re.is_match(lower)
}

fn is_maps_path(lower: &str) -> bool {
    lower.starts_with("maps/") || lower.contains("/maps/")
}

impl Installer {
    /// The writing half of install, inside the change it is handed.
    pub fn install_into(&self, tx: &mut FileTx, job: &InstallJob) -> Result<Vec<LibFile>, String> {
        let is_priority = crate::slot_zones::PRIORITY_CATEGORIES.contains(&job.category_id);
        match job.category_id {
            "fonts" => return self.install_fonts(Source::File(job.local), job.mod_name, Some(tx)),
            "cursors" => return self.install_cursor(Source::File(job.local), job.mod_name, Some(tx)),
            "tools" => return self.install_tool(job.local, job.mod_name, Some(tx)),
            _ => {}
        }
        let lang = self.lang_folder()?;
        self.ensure_lang_folder()?;
        let mut used = self.used_pak_names()?;
        let mut records = Vec::new();
        let lower_local = job.local.to_string_lossy().to_lowercase();
        if !lower_local.ends_with(".zip") {
            ensure_space(&lang, fs::metadata(job.local).map_err(io)?.len(), None)?;
        }
        if lower_local.ends_with(".vpk") {
            let pak = self.allocate_pak(&mut used, is_priority)?;
            copy_into(job.local, &lang.join(&pak), Some(tx)).map_err(io)?;
            records.push(LibFile::new("lang", &pak));
            return Ok(records);
        }
        if !lower_local.ends_with(".zip") {
            let base = base_name(job.local);
            copy_into(job.local, &lang.join(&base), Some(tx)).map_err(io)?;
            records.push(LibFile::new("lang", &base));
            return Ok(records);
        }

        let mut archive = OpenedZip::open(Source::File(job.local), Some(job.mod_name), None)?;
        let kept: Vec<_> = archive.files.iter().filter(|f| !skipped(&f.path.to_lowercase())).cloned().collect();
        ensure_space(&lang, kept.iter().map(|f| f.size).sum(), None)?;
        let vpks: Vec<String> = kept
            .iter()
            .map(|f| f.path.clone())
            .filter(|rel| rel.to_lowercase().ends_with(".vpk") && !is_maps_path(&rel.to_lowercase()))
            .collect();
        let plan = self.plan_pak_names(&vpks, &mut used, is_priority)?;
        for file in &kept {
            let rel = &file.path;
            let lower = rel.to_lowercase();
            let rel_path = if is_maps_path(&lower) {
                let parts: Vec<&str> = rel.split('/').collect();
                let at = parts.iter().position(|p| p.eq_ignore_ascii_case("maps")).unwrap_or(0);
                parts[at..].join("/")
            } else if let Some(pak) = plan.get(rel) {
                pak.clone()
            } else {
                let parts: Vec<&str> = rel.split('/').collect();
                let r = if parts.len() > 1 { parts[1..].join("/") } else { rel.clone() };
                if r.is_empty() {
                    continue;
                }
                r
            };
            let data = archive.read(file)?;
            write_into(&data, &safe_join(&lang, &rel_path)?, Some(tx)).map_err(io)?;
            records.push(LibFile::new("lang", &rel_path));
        }
        Ok(records)
    }

    /// A tool from the catalog, unpacked into the app's own folder rather than the game's.
    pub fn install_tool(&self, local: &Path, mod_name: &str, tx: Option<&mut FileTx>) -> Result<Vec<LibFile>, String> {
        let folder: String = mod_name.chars().map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect();
        let dest = self.tools_dir().join(&folder);
        fs::create_dir_all(&dest).map_err(io)?;
        if local.to_string_lossy().to_lowercase().ends_with(".zip") {
            OpenedZip::open(Source::File(local), Some(mod_name), None)?.extract_to(&dest, tx)?;
        } else {
            copy_into(local, &dest.join(base_name(local)), tx).map_err(io)?;
        }
        Ok(vec![LibFile::new("tools", &base_name(&dest))])
    }

    /// Switch a mod's files on or off, as one change: a mod switched half off is worse than either.
    pub fn set_enabled(&self, files: &[LibFile], enabled: bool, rec_id: Option<&str>) -> Result<(), String> {
        if let Some(id) = rec_id.filter(|r| !r.is_empty()) {
            if !Self::cursor_files(files).is_empty() {
                if enabled {
                    self.deploy_cursor(id, files)?;
                } else {
                    self.undeploy_cursor(id, files)?;
                }
                return Ok(());
            }
        }
        FileTx::run(self.journal_dir.as_deref(), self.tx_log(), |tx| {
            for f in files {
                if matches!(f.root.as_str(), "tools" | "fonts" | "cursor") {
                    continue;
                }
                let abs = self.root_abs(&f.root)?.join(&f.rel_path);
                let off = with_suffix(&abs, ".off");
                if enabled && off.exists() {
                    tx.rename(&off, &abs).map_err(io)?;
                }
                if !enabled && abs.exists() {
                    tx.rename(&abs, &off).map_err(io)?;
                }
            }
            Ok::<(), String>(())
        })
    }

    /// Take a mod's files out, and put Valve's own back where a font or cursor sat, as one change.
    /// `deployed`: false says the files are not the ones on disk right now (it was switched off).
    pub fn remove(&self, files: &[LibFile], rec_id: Option<&str>, deployed: bool) -> Result<(), String> {
        self.drop_cursor_store(rec_id);
        let files: Vec<LibFile> =
            if deployed { files.to_vec() } else { files.iter().filter(|f| f.root != "cursor").cloned().collect() };
        FileTx::run(self.journal_dir.as_deref(), self.tx_log(), |tx| {
            for f in &files {
                let root = self.root_abs(&f.root)?;
                if f.root == "tools" {
                    tx.remove(&root.join(&f.rel_path)).map_err(io)?;
                    continue;
                }
                let abs = root.join(&f.rel_path);
                for p in [abs.clone(), with_suffix(&abs, ".off"), with_suffix(&abs, MASTER_OFF)] {
                    if p.exists() {
                        tx.remove(&p).map_err(io)?;
                    }
                }
                if f.root == "fonts" || f.root == "cursor" {
                    let backup = self.backups_dir().join(&f.root).join(&f.rel_path);
                    if backup.exists() {
                        copy_into(&backup, &abs, Some(tx)).map_err(io)?;
                    }
                }
            }
            Ok::<(), String>(())
        })?;
        self.forget_written(&files);
        Ok(())
    }
}
