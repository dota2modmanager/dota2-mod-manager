//! Taking in a mod the user already has: a .vpk, a .zip, a folder, or bytes off a drop,
//! replacing src/import.ts. A Skinchanger pack unzips to a whole game tree with the archive
//! several folders down; a Dota2Changer mod arrives as an index plus data volumes, folded into
//! one file on the way in; an author's working folder holds no archive and is packed.

use std::fs;
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Value};

use crate::file_tx::{copy_into, write_into, FileTx};
use crate::i18n::t;
use crate::installer::Installer;
use crate::installer_files::MERGE_SIZE_CAP;
use crate::safe_zip::{safe_join, OpenedZip, Source};

fn io(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn base_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn is_vpk(name: &str) -> bool {
    name.to_lowercase().ends_with(".vpk")
}

/// A temp folder of our own, removed when dropped.
pub struct Staged(pub PathBuf);

impl Drop for Staged {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// fs.mkdtempSync(os.tmpdir() + prefix): a fresh folder under the temp folder.
pub fn mkdtemp(prefix: &str) -> Result<Staged, String> {
    let base = std::env::temp_dir();
    for _ in 0..100 {
        let tag: String = uuid::Uuid::new_v4().simple().to_string().chars().take(6).collect();
        let dir = base.join(format!("{prefix}{tag}"));
        match fs::create_dir(&dir) {
            Ok(()) => return Ok(Staged(dir)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("no temp folder".into())
}

/// Every .vpk under a dropped folder, six levels down at most.
fn scan_vpk_tree(root: &Path, depth: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if depth > 6 {
        return out;
    }
    for name in crate::js::dir_names(root) {
        let full = root.join(&name);
        let Ok(st) = fs::metadata(&full) else { continue };
        if st.is_dir() {
            out.extend(scan_vpk_tree(&full, depth + 1));
        } else if is_vpk(&name) {
            out.push(full);
        }
    }
    out
}

/// Pack an author's working folder into a VPK, parked where the importer will find it.
fn stage_folder_as_vpk(dir: &Path, staged: &mut Vec<Staged>) -> Result<Option<PathBuf>, String> {
    let Some(root) = crate::vpk_pack::find_content_root(dir, 0) else { return Ok(None) };
    let buf = crate::vpk_pack::pack_folder(&root)?;
    let tmp = mkdtemp("mm-folder-")?;
    let cleaned: String =
        base_name(dir).chars().filter(|&c| !"<>:\"/\\|?*".contains(c) && c > '\u{1f}').collect::<String>();
    let trimmed = crate::js::trim(&cleaned);
    let base: String = if trimmed.is_empty() { "mod".to_string() } else { crate::js::slice_utf16(trimmed, 60) };
    let dest = tmp.0.join(format!("{base}_dir.vpk"));
    fs::write(&dest, buf).map_err(io)?;
    staged.push(tmp);
    Ok(Some(dest))
}

/// What the user dropped, as a flat list of .vpk paths (and what could not be read).
fn expand_inputs(paths: &[PathBuf], staged: &mut Vec<Staged>) -> (Vec<PathBuf>, Vec<Value>) {
    let mut files = Vec::new();
    let mut errors = Vec::new();
    for src in paths {
        let label = base_name(src);
        let st = fs::metadata(src).ok();
        if st.as_ref().is_some_and(|s| s.is_dir()) {
            let found = scan_vpk_tree(src, 0);
            if !found.is_empty() {
                files.extend(found);
                continue;
            }
            match stage_folder_as_vpk(src, staged) {
                Ok(Some(built)) => {
                    files.push(built);
                    continue;
                }
                Ok(None) => {}
                Err(e) => {
                    errors.push(json!({ "source": label, "error": e }));
                    continue;
                }
            }
            errors.push(json!({ "source": label, "error": t("в папке нет ни .vpk, ни файлов игры", &[]) }));
            continue;
        }
        if src.to_string_lossy().to_lowercase().ends_with(".zip") {
            let tmp = match mkdtemp("mm-zip-") {
                Ok(t) => t,
                Err(e) => {
                    errors.push(json!({ "source": label, "error": e }));
                    continue;
                }
            };
            let mut found = Vec::new();
            let r = (|| -> Result<(), String> {
                let mut z = OpenedZip::open(Source::File(src), Some(&label), None)?;
                for file in z.files.clone() {
                    if !is_vpk(&file.path) {
                        continue;
                    }
                    let dest = safe_join(&tmp.0, &file.path)?;
                    if let Some(d) = dest.parent() {
                        fs::create_dir_all(d).map_err(io)?;
                    }
                    fs::write(&dest, z.read(&file)?).map_err(io)?;
                    found.push(dest);
                }
                Ok(())
            })();
            let n = found.len();
            files.extend(found);
            staged.push(tmp);
            if let Err(e) = r {
                errors.push(json!({ "source": label, "error": e }));
                continue;
            }
            if n == 0 {
                errors.push(json!({ "source": label, "error": t("в архиве нет .vpk файлов", &[]) }));
            }
            continue;
        }
        files.push(src.clone());
    }
    (files, errors)
}

struct Set {
    src_dir: PathBuf,
    base: String,
    dir_file: Option<PathBuf>,
    source_label: String,
    single: bool,
}

fn dir_re() -> &'static Regex {
    static R: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)^(.*)_dir\.vpk$").unwrap())
}

fn part_re() -> &'static Regex {
    static R: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)^(.*)_\d{3}\.vpk$").unwrap())
}

/// Take these .vpk files in, one mod per set, each in its own change.
fn import_vpk_files(
    inst: &Installer,
    paths: &[PathBuf],
    on_step: &mut dyn FnMut(usize, usize),
) -> Result<Vec<Value>, String> {
    let lang = inst.lang_folder()?;
    inst.ensure_lang_folder()?;
    let mut used = inst.used_pak_names()?;
    let mut results = Vec::new();
    let mut sets: IndexMap<String, Set> = IndexMap::new();
    for src in paths {
        let file_name = base_name(src);
        if !is_vpk(&file_name) {
            results.push(json!({ "source": file_name, "error": t("не .vpk файл", &[]) }));
            continue;
        }
        let src_dir = src.parent().map(Path::to_path_buf).unwrap_or_default();
        let m_dir = dir_re().captures(&file_name).map(|c| c[1].to_string());
        let m_part = part_re().captures(&file_name).map(|c| c[1].to_string());
        let base = m_dir
            .clone()
            .filter(|s| !s.is_empty())
            .or_else(|| m_part.clone().filter(|s| !s.is_empty()))
            .unwrap_or_else(|| file_name[..file_name.len() - 4].to_string());
        let key = format!("{}|{}", src_dir.to_string_lossy().to_lowercase(), base.to_lowercase());
        let set = sets.entry(key).or_insert_with(|| Set {
            src_dir: src_dir.clone(),
            base: base.clone(),
            dir_file: None,
            source_label: file_name.clone(),
            single: false,
        });
        if m_dir.is_some() {
            set.dir_file = Some(src.clone());
            set.source_label = file_name.clone();
        } else if m_part.is_none() {
            set.dir_file = Some(src.clone());
            set.single = true;
            set.source_label = file_name.clone();
        }
    }
    let total = sets.len();
    let mut done = 0;
    for set in sets.values() {
        let r = FileTx::run(inst.journal_dir.as_deref(), inst.tx_log(), |tx| -> Result<Value, String> {
            if set.single {
                let pak = inst.allocate_pak(&mut used, false)?;
                copy_into(set.dir_file.as_ref().unwrap(), &lang.join(&pak), Some(tx)).map_err(io)?;
                return Ok(
                    json!({ "source": set.source_label, "name": set.base, "files": [{ "root": "lang", "relPath": pak }] }),
                );
            }
            let dir_src = set.dir_file.clone().or_else(|| {
                let guess = set.src_dir.join(format!("{}_dir.vpk", set.base));
                guess.exists().then_some(guess)
            });
            let Some(dir_src) = dir_src else {
                return Ok(
                    json!({ "source": set.source_label, "error": t("нет {0}_dir.vpk рядом с data-частями", &[json!(set.base)]) }),
                );
            };
            let pak_dir = inst.allocate_pak(&mut used, false)?;
            let new_base = &pak_dir[..pak_dir.len() - "_dir.vpk".len()];
            let re = Regex::new(&format!(r"(?i)^{}_(\d{{3}})\.vpk$", regex::escape(&set.base))).unwrap();
            let mut parts: Vec<(String, String)> = crate::js::dir_names(&set.src_dir)
                .into_iter()
                .filter_map(|f| re.captures(&f).map(|c| c[1].to_string()).map(|n| (f, n)))
                .collect();
            parts.sort_by(|x, y| crate::js::locale_compare(&x.1, &y.1));
            let parts_bytes: u64 =
                parts.iter().filter_map(|(f, _)| fs::metadata(set.src_dir.join(f)).ok()).map(|m| m.len()).sum();
            if !parts.is_empty() && parts_bytes <= MERGE_SIZE_CAP {
                let merged = (|| -> Option<Vec<u8>> {
                    let for_part = |i: u16| -> crate::vpk::Result<PathBuf> {
                        Ok(set.src_dir.join(format!("{}_{i:03}.vpk", set.base)))
                    };
                    let buf = fs::read(&dir_src).ok()?;
                    Some(crate::vpk::build(&crate::vpk::read_entries(&buf, &dir_src, Some(&for_part)).ok()?))
                })();
                if let Some(buf) = merged {
                    write_into(&buf, &lang.join(&pak_dir), Some(tx)).map_err(io)?;
                    return Ok(json!({
                        "source": format!("{}_dir.vpk", set.base), "name": set.base, "merged": parts.len() + 1,
                        "files": [{ "root": "lang", "relPath": pak_dir }],
                    }));
                }
            }
            copy_into(&dir_src, &lang.join(&pak_dir), Some(tx)).map_err(io)?;
            let mut files = vec![json!({ "root": "lang", "relPath": pak_dir })];
            for (f, n) in &parts {
                let part = format!("{new_base}_{n}.vpk");
                copy_into(&set.src_dir.join(f), &lang.join(&part), Some(tx)).map_err(io)?;
                files.push(json!({ "root": "lang", "relPath": part }));
            }
            Ok(json!({ "source": format!("{}_dir.vpk", set.base), "name": set.base, "files": files }))
        });
        results.push(r.unwrap_or_else(|e| json!({ "source": set.source_label, "error": e })));
        done += 1;
        on_step(done, total);
    }
    Ok(results)
}

/// Import whatever the user pointed at: one result per mod, { source, name, files, merged? }
/// or { source, error }.
pub fn import_vpks(
    inst: &Installer,
    paths: &[PathBuf],
    on_step: &mut dyn FnMut(usize, usize),
) -> Result<Vec<Value>, String> {
    let mut staged = Vec::new();
    let (files, mut errors) = expand_inputs(paths, &mut staged);
    errors.extend(import_vpk_files(inst, &files, on_step)?);
    Ok(errors)
}

/// Dropped .vpk/.zip files given as bytes, staged and imported as paths.
pub fn import_vpk_buffers(
    inst: &Installer,
    items: &[(String, Vec<u8>)],
    on_step: &mut dyn FnMut(usize, usize),
) -> Result<Vec<Value>, String> {
    let tmp = mkdtemp("mm-import-")?;
    let mut paths = Vec::new();
    for (name, data) in items {
        let lower = name.to_lowercase();
        if !(lower.ends_with(".vpk") || lower.ends_with(".zip")) {
            continue;
        }
        let p = tmp.0.join(base_name(Path::new(name)));
        fs::write(&p, data).map_err(io)?;
        paths.push(p);
    }
    import_vpks(inst, &paths, on_step)
}

/// A VPK handed over as bytes (a mod in a shared preset): parsed first, so only a real VPK
/// reaches the game folder, under a slot name of ours.
pub fn install_vpk_buffer(inst: &Installer, buf: &[u8]) -> Result<Vec<Value>, String> {
    if crate::vpk::list_paths(buf).map_err(io)?.is_empty() {
        return Err(t("Пустой VPK", &[]));
    }
    let lang = inst.lang_folder()?;
    inst.ensure_lang_folder()?;
    let pak = inst.allocate_pak(&mut inst.used_pak_names()?, false)?;
    write_into(buf, &lang.join(&pak), None).map_err(io)?;
    Ok(vec![json!({ "root": "lang", "relPath": pak })])
}
