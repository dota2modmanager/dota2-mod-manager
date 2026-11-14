//! Models out of the installed game as glTF, for a 3D preview of a hero in the chosen items
//! (src/model-glb.ts, issue #417).
//!
//! The Source 2 toolchain (toolchain.rs) turns a compiled model straight out of pak01 into a GLB
//! with its textures as PNG files beside it, and with the clips asked for. Most of an export is
//! the program starting, so the models a preview asks for go out in one call.
//!
//! The export runs as a child process; a caller waits on it off the main thread. The cache lives
//! in userData under the game's build: a new build can change any model, so the old cache goes.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex};
use std::time::Instant;

use indexmap::IndexMap;
use sha1::{Digest, Sha1};

/// A model path as the game names it, compiled or not, or None for one that is not a model.
pub fn model_file(model: &str) -> Option<String> {
    let m = model.replace('\\', "/");
    let m = m.trim();
    let low = m.to_lowercase();
    let stem = low.strip_suffix(".vmdl_c").or_else(|| low.strip_suffix(".vmdl"))?;
    let ok = stem.starts_with("models/")
        && stem.len() > "models/".len()
        && stem.bytes().all(|c| c.is_ascii_alphanumeric() || b"_/.-".contains(&c));
    // the lazy ([\w/.-]+?) before .vmdl(_c)$ takes the shortest stem, which is this one
    (ok && !stem.contains("..")).then(|| format!("{stem}.vmdl_c"))
}

/// Where the toolchain puts a model's GLB under its output folder: the archive's layout, .glb for .vmdl_c.
pub fn glb_at(root: &Path, file: &str) -> PathBuf {
    let rel = file.strip_suffix(".vmdl_c").map_or(file.to_string(), |s| format!("{s}.glb"));
    rel.split('/').fold(root.to_path_buf(), |p, part| p.join(part))
}

/// The GLB a model's export left, or None. Asked for one model the toolchain names the file after
/// -o; but a body that brings its physics along is two files, and then -o is a folder holding the
/// archive's layout: abaddon.glb/models/heroes/abaddon/abaddon.glb.
pub fn found_glb(root: &Path, file: &str) -> Option<PathBuf> {
    let at = glb_at(root, file);
    let meta = std::fs::metadata(&at).ok()?;
    if meta.is_file() {
        return Some(at);
    }
    let inside = glb_at(&at, file);
    (meta.is_dir() && inside.is_file()).then_some(inside)
}

/// A gameinfo.gi that sends the toolchain to this game folder for what a lone file refers to.
pub fn game_info(dota: &str) -> String {
    format!(
        "\"GameInfo\"\n{{\n\tFileSystem\n\t{{\n\t\tSearchPaths\n\t\t{{\n\t\t\tGame\t\"{}\"\n\t\t}}\n\t}}\n}}\n",
        dota.replace('\\', "/")
    )
}

/// A clip name no model has: the bones without any animation.
const NO_CLIP: &str = "mm-no-clip";

/// Which clips an export keeps: every one, or these (none is the bones alone).
#[derive(Debug, Clone, PartialEq)]
pub enum Clips {
    All,
    Some(Vec<String>),
}

/// The toolchain's arguments for these models out of this archive into this folder.
pub fn export_args(pak_file: &str, out: &str, files: &[String], clips: &Clips, materials: bool) -> Vec<String> {
    let s = |x: &str| x.to_string();
    let mut args = vec![s("-i"), s(pak_file), s("-o"), s(out), s("-d")];
    match clips {
        // a body for its clips alone: the window has its pictures already
        Clips::All => {
            args.extend([s("-f"), files.join(","), s("--gltf_export_format"), s("glb"), s("--gltf_export_animations")]);
            if materials {
                args.push(s("--gltf_export_materials"));
            }
        }
        Clips::Some(list) => {
            if !files.is_empty() {
                args.extend([s("-f"), files.join(",")]);
            }
            args.extend([s("--gltf_export_format"), s("glb"), s("--gltf_export_materials")]);
            // the toolchain writes a model's bones only with its clips; a wearable gets a list
            // that names no clip, so it follows the body's bones without its own animations
            args.extend([
                s("--gltf_export_animations"),
                s("--gltf_animation_list"),
                if list.is_empty() { s(NO_CLIP) } else { list.join(",") },
            ]);
        }
    }
    args
}

fn base_of(root: &Path, texture: &str) -> PathBuf {
    let t = texture.strip_suffix(".vtex").unwrap_or(texture);
    // path.join takes either slash
    t.split(['/', '\\']).fold(root.to_path_buf(), |p, part| p.join(part))
}

fn names_in(dir: &Path) -> Option<Vec<String>> {
    Some(std::fs::read_dir(dir).ok()?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect())
}

fn size(p: &Path) -> u64 {
    std::fs::metadata(p).map_or(0, |m| m.len())
}

/// `rest` as /_seq(0_\d+|\d+)\.png$/i: some "_seq" whose tail is digits, or 0_ and digits.
fn sheet_frame_suffix(rest: &str) -> bool {
    let l = rest.to_lowercase();
    let Some(body) = l.strip_suffix(".png") else { return false };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit());
    body.match_indices("_seq").any(|(i, _)| {
        let t = &body[i + 4..];
        digits(t) || t.strip_prefix("0_").is_some_and(digits)
    })
}

/// Where a texture's picture landed: the file itself, or the largest frame of its sheet.
pub fn sprite_at(root: &Path, texture: &str) -> Option<PathBuf> {
    let base = base_of(root, texture);
    let png = PathBuf::from(format!("{}.png", base.to_string_lossy()));
    if png.exists() {
        return Some(png);
    }
    let dir = base.parent()?;
    let names = names_in(dir)?;
    // a sheet comes out as frames of its first sequence (name_seq0_3.png), or a picture per
    // sequence (name_seq12.png: Crystal Maiden's fleks3); missed, its systems drew solid dots
    let stem = base.file_name()?.to_string_lossy().to_lowercase();
    let mut frames: Vec<PathBuf> = names
        .iter()
        .filter(|n| {
            let l = n.to_lowercase();
            l.starts_with(&format!("{stem}_seq")) && n.get(stem.len()..).is_some_and(sheet_frame_suffix)
        })
        .map(|n| dir.join(n))
        .collect();
    // a stable sort by size, largest first, after the directory's own order
    frames.sort_by_key(|p| std::cmp::Reverse(size(p)));
    frames.into_iter().next()
}

/// A cube texture's picture: its six faces as one strip, made once and kept beside them as name.png.
pub fn cube_at(root: &Path, texture: &str) -> Option<PathBuf> {
    let base = base_of(root, texture).to_string_lossy().into_owned();
    let faces: Vec<PathBuf> =
        crate::png_strip::CUBE_FACES.iter().map(|f| PathBuf::from(format!("{base}_{f}.png"))).collect();
    if !faces.iter().all(|f| f.exists()) {
        return None;
    }
    let bytes: Vec<Vec<u8>> = faces.iter().map(|f| std::fs::read(f).unwrap_or_default()).collect();
    let strip = crate::png_strip::cube_strip(&bytes)?;
    let at = PathBuf::from(format!("{base}.png"));
    std::fs::write(&at, strip).ok()?;
    Some(at)
}

/// A sheet's frames as the toolchain writes them (name_seqN_frame.png or name_seqN.png), by
/// sequence then frame, keyed `texture#seq=N&frame=F` (src/sprite-frames.ts); 128 MB at most.
pub fn sprite_frames(root: &Path, texture: &str) -> Vec<(String, PathBuf)> {
    let base = base_of(root, texture);
    let (Some(dir), Some(stem)) = (base.parent(), base.file_name()) else { return vec![] };
    let stem = stem.to_string_lossy().to_lowercase();
    let Some(names) = names_in(dir) else { return vec![] };
    let mut found: Vec<(f64, f64, PathBuf)> = names
        .iter()
        .filter_map(|file| {
            if !file.to_lowercase().starts_with(&format!("{stem}_seq")) {
                return None;
            }
            let rest = file.get(stem.len()..)?.to_lowercase();
            let body = rest.strip_prefix("_seq")?.strip_suffix(".png")?;
            let (seq, frame) = body.split_once('_').map_or((body, None), |(a, b)| (a, Some(b)));
            let digits = |s: &str| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit());
            if !digits(seq) || frame.is_some_and(|f| !digits(f)) {
                return None;
            }
            let n = |s: &str| s.parse::<f64>().unwrap_or(f64::INFINITY);
            Some((n(seq), frame.map_or(0.0, n), dir.join(file)))
        })
        .collect();
    found.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    let mut bytes = 0u64;
    found
        .into_iter()
        .take(4096)
        .filter_map(|(seq, frame, file)| {
            bytes += size(&file);
            (bytes <= 128 * 1024 * 1024)
                .then(|| (format!("{texture}#seq={}&frame={}", crate::js::number(seq), crate::js::number(frame)), file))
        })
        .collect()
}

/// How many exports run at once: half the machine's cores, two to six. Most of an export is the
/// program opening the game's archive, which is work for a core, not the disk.
fn max_exports() -> usize {
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    (cores / 2).clamp(2, 6)
}

/// Runs the toolchain: its exe and arguments.
pub type Run = Box<dyn Fn(&Path, &[String]) -> Result<(), String> + Send + Sync>;

struct Slots {
    running: usize,
    busy: HashSet<String>,
}

/// GLB files of the game's models, made on demand and kept per game build.
pub struct ModelGlb {
    base: PathBuf,
    vrf: Box<dyn Fn() -> Option<PathBuf> + Send + Sync>,
    game: Box<dyn Fn() -> Option<PathBuf> + Send + Sync>,
    run: Run,
    log: Box<dyn Fn(&str) + Send + Sync>,
    slots: Mutex<Slots>,
    changed: Condvar,
    max: usize,
}

impl ModelGlb {
    pub fn new(
        user_data: &Path,
        vrf: Box<dyn Fn() -> Option<PathBuf> + Send + Sync>,
        game: Box<dyn Fn() -> Option<PathBuf> + Send + Sync>,
        run: Run,
        log: Box<dyn Fn(&str) + Send + Sync>,
    ) -> ModelGlb {
        ModelGlb {
            base: user_data.join("models3d"),
            vrf,
            game,
            run,
            log,
            slots: Mutex::new(Slots { running: 0, busy: HashSet::new() }),
            changed: Condvar::new(),
            max: max_exports(),
        }
    }

    /// A file on its way is waited for, not exported a second time over itself; a few exports
    /// at once, the rest wait their turn.
    fn export_once(&self, root: &Path, files: &[String], work: impl FnOnce(&[String])) {
        let key = |f: &String| format!("{}|{f}", root.to_string_lossy());
        let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
        let busy: Vec<String> = files.iter().map(key).filter(|k| slots.busy.contains(k)).collect();
        let fresh: Vec<String> = files.iter().filter(|f| !slots.busy.contains(&key(f))).cloned().collect();
        if !fresh.is_empty() {
            for f in &fresh {
                slots.busy.insert(key(f));
            }
            while slots.running >= self.max {
                slots = self.changed.wait(slots).unwrap_or_else(|e| e.into_inner());
            }
            slots.running += 1;
            drop(slots);
            work(&fresh);
            slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
            slots.running -= 1;
            for f in &fresh {
                slots.busy.remove(&key(f));
            }
            self.changed.notify_all();
        }
        while busy.iter().any(|k| slots.busy.contains(k)) {
            slots = self.changed.wait(slots).unwrap_or_else(|e| e.into_inner());
        }
    }

    /// This build's folder, made empty the first time a build is seen.
    fn build_root(&self, game: &Path) -> PathBuf {
        let stamp = crate::pak_stamp::game_schema_stamp(game).unwrap_or_else(|_| "unknown".into());
        let hash = format!("{:x}", Sha1::digest(stamp.as_bytes()));
        let dir = self.base.join(&hash[..12]);
        if !dir.exists() {
            let _ = std::fs::remove_dir_all(&self.base);
            let _ = std::fs::create_dir_all(&dir);
        }
        dir
    }

    fn error(&self, what: &str, e: &str) {
        (self.log)(&format!("{what} failed ({e})"));
    }

    /// The GLB of each model, exported if it is not in the cache yet; a model the game lacks, or
    /// any model when the toolchain is not downloaded, is None. `models` as items_game names them;
    /// `clips` the animation clips to keep, for the hero's body (wearables follow its bones).
    pub fn glbs(&self, models: &[String], clips: &Clips, materials: bool) -> IndexMap<String, Option<PathBuf>> {
        let mut out: IndexMap<String, Option<PathBuf>> = models.iter().map(|m| (m.clone(), None)).collect();
        let (Some(game), Some(exe)) = ((self.game)(), (self.vrf)()) else { return out };
        let pak = game.join("dota").join("pak01_dir.vpk");
        // the clips are part of the file: a body with its idle is another cache entry than one without
        let folder = match clips {
            Clips::All if materials => "full".to_string(),
            Clips::All => "motions".to_string(),
            Clips::Some(c) if !c.is_empty() => {
                let joined: String =
                    c.join("-").chars().filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-').collect();
                format!("clips-{joined}")
            }
            Clips::Some(_) => "bones".to_string(),
        };
        let root = self.build_root(&game).join(folder);
        let files: Vec<(String, Option<String>)> = models.iter().map(|m| (m.clone(), model_file(m))).collect();
        let missing = || -> Vec<String> {
            let mut seen = Vec::new();
            for f in files.iter().filter_map(|(_, f)| f.clone()) {
                if found_glb(&root, &f).is_none() && !seen.contains(&f) {
                    seen.push(f);
                }
            }
            seen
        };
        let wanted = missing();
        if !wanted.is_empty() {
            self.export_once(&root, &wanted, |wanted| {
                let started = Instant::now();
                // one model alone, the toolchain takes -o for the file itself, not a folder
                let to = if wanted.len() == 1 { glb_at(&root, &wanted[0]) } else { root.clone() };
                let made = if wanted.len() == 1 {
                    to.parent().map(Path::to_path_buf).unwrap_or(root.clone())
                } else {
                    root.clone()
                };
                let r = std::fs::create_dir_all(&made).map_err(|e| e.to_string()).and_then(|()| {
                    (self.run)(
                        &exe,
                        &export_args(&pak.to_string_lossy(), &to.to_string_lossy(), wanted, clips, materials),
                    )
                });
                match r {
                    Ok(()) => (self.log)(&format!(
                        "models 3d: {} exported in {} ms",
                        wanted.len(),
                        started.elapsed().as_millis()
                    )),
                    Err(e) => self.error("models 3d: export", &e),
                }
            });
        }
        for (m, f) in &files {
            if let Some(f) = f {
                out.insert(m.clone(), found_glb(&root, f));
            }
        }
        out
    }

    /// The GLB of a model in another material set, or None where it has no such set. The model
    /// is exported with the set made its own (model_skin.rs), alone in a little game folder whose
    /// gameinfo.gi points at the real game. `bytes`: the model's file out of the archive; `clips`:
    /// a wearable's own clips to keep.
    pub fn skinned(&self, model: &str, skin: usize, bytes: Option<&[u8]>, clips: &[String]) -> Option<PathBuf> {
        let game = (self.game)()?;
        let exe = (self.vrf)()?;
        let file = model_file(model)?;
        let bytes = bytes?;
        let key = crate::js::stringify(&serde_json::json!([skin, clips]), "");
        let hash = format!("{:x}", Sha1::digest(key.as_bytes()));
        let root = self.build_root(&game).join("skins").join(&hash[..12]);
        if let Some(found) = found_glb(&root, &file) {
            return Some(found);
        }
        let worn = crate::model_skin::with_skin(bytes, skin).filter(|w| w.as_slice() != bytes)?;
        self.export_once(&root, std::slice::from_ref(&file), |_| {
            let r = (|| -> Result<(), String> {
                let folder = root.join("source").join("game").join("mm");
                let at = file.split('/').fold(folder.clone(), |p, part| p.join(part));
                std::fs::create_dir_all(at.parent().unwrap_or(&folder)).map_err(|e| e.to_string())?;
                std::fs::write(&at, &worn).map_err(|e| e.to_string())?;
                std::fs::write(folder.join("gameinfo.gi"), game_info(&game.join("dota").to_string_lossy()))
                    .map_err(|e| e.to_string())?;
                let to = glb_at(&root, &file);
                std::fs::create_dir_all(to.parent().unwrap_or(&root)).map_err(|e| e.to_string())?;
                (self.run)(
                    &exe,
                    &export_args(
                        &at.to_string_lossy(),
                        &to.to_string_lossy(),
                        &[],
                        &Clips::Some(clips.to_vec()),
                        false,
                    ),
                )
            })();
            if let Err(e) = r {
                self.error("models 3d: skin export", &e);
            }
        });
        found_glb(&root, &file)
    }

    /// PNG textures plus every exported sheet frame, keyed by sequence and frame number; None for
    /// one the game lacks. `textures` as a particle names them, "materials/particle/smoke/wispy.vtex".
    pub fn sprites(&self, textures: &[String]) -> IndexMap<String, Option<Vec<u8>>> {
        let mut out: IndexMap<String, Option<Vec<u8>>> = textures.iter().map(|t| (t.clone(), None)).collect();
        let valid: Vec<&String> = textures
            .iter()
            .filter(|t| {
                t.strip_prefix("materials/").and_then(|r| r.strip_suffix(".vtex")).is_some_and(|r| {
                    !r.is_empty() && r.bytes().all(|c| c.is_ascii_alphanumeric() || b"_/.-".contains(&c))
                }) && !t.contains("..")
            })
            .collect();
        let (Some(game), Some(exe)) = ((self.game)(), (self.vrf)()) else { return out };
        if valid.is_empty() {
            return out;
        }
        let root = self.build_root(&game).join("sprites");
        let mut wanted: Vec<String> = Vec::new();
        for t in &valid {
            if sprite_at(&root, t).is_none() && !wanted.contains(t) {
                wanted.push((*t).clone());
            }
        }
        if !wanted.is_empty() {
            self.export_once(&root, &wanted, |wanted| {
                let started = Instant::now();
                let pak = game.join("dota").join("pak01_dir.vpk");
                let list = wanted.iter().map(|t| format!("{t}_c")).collect::<Vec<_>>().join(",");
                let args: Vec<String> =
                    ["-i", &pak.to_string_lossy(), "-o", &root.to_string_lossy(), "-d", "-f", &list]
                        .iter()
                        .map(|s| s.to_string())
                        .collect();
                let r =
                    std::fs::create_dir_all(&root).map_err(|e| e.to_string()).and_then(|()| (self.run)(&exe, &args));
                match r {
                    Ok(()) => (self.log)(&format!(
                        "sprites: {} exported in {} ms",
                        wanted.len(),
                        started.elapsed().as_millis()
                    )),
                    Err(e) => self.error("sprites: export", &e),
                }
            });
        }
        for t in valid {
            let at = sprite_at(&root, t).or_else(|| cube_at(&root, t));
            out.insert(t.clone(), at.and_then(|a| std::fs::read(a).ok()));
            for (key, file) in sprite_frames(&root, t) {
                out.insert(key, std::fs::read(file).ok());
            }
        }
        out
    }

    /// Everything exported so far, gone.
    pub fn clear(&self) {
        let _ = std::fs::remove_dir_all(&self.base);
    }
}
