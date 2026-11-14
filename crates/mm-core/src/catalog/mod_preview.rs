//! A picture for a mod that came with none, taken out of the mod itself (src/mod-preview.ts).
//!
//! The catalog ships a preview for every mod it lists; a mod the user dragged in, or one lying in
//! the game folder, has nothing. Almost every mod carries its own picture though: the hero's
//! portrait, the selection art, spell and item icons, because the game draws those from there.
//! Which file to show and whether it is worth showing are mod_preview_pick.rs. The picture inside
//! a mod is a compiled Source 2 texture, so this needs the toolchain; without it nothing here
//! answers and the old fallbacks stand.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use base64::Engine;
use indexmap::IndexMap;
use regex::Regex;
use sha1::{Digest, Sha1};

use crate::mod_preview_pick::{pick_candidate, worth_showing, Kind};

/// A decoded picture: 4 bytes a pixel, alpha last.
#[derive(Debug, Clone, PartialEq)]
pub struct Bitmap {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

/// Decoding and resizing, a seam so the tests can stand in for them.
pub trait Images: Send + Sync {
    fn read(&self, file: &Path) -> Option<Bitmap>;
    fn to_small_png(&self, bmp: &Bitmap) -> Vec<u8>;
}

/// Where the texture tool is, if it is.
pub type ToolPath = Box<dyn Fn() -> Option<PathBuf> + Send + Sync>;
/// Where a mod's *_dir.vpk actually is.
pub type LangFileOf = Box<dyn Fn(&str) -> Option<PathBuf> + Send + Sync>;
/// The texture tool: (exe, args).
pub type Run = Box<dyn Fn(&Path, &[String]) -> Result<(), String> + Send + Sync>;

// One call decodes a whole folder, so a batch costs what a single file costs. This caps how much
// work one screenful can ask for.
const MAX_PER_CALL: usize = 40;
// Rows are 76x47 CSS pixels; 320 leaves room for a denser screen without caching megabytes.
const MAX_SIDE: usize = 320;
// What crosses to the window in one piece; the hero portraits measured are 3.3 MB.
const MAX_VIDEO_BYTES: usize = 24 * 1024 * 1024;

/// The key prefix for a mod's own video.
pub const VID: &str = "modvid:";
/// The key prefix for a mod's drawn art.
pub const ART: &str = "modart:";
/// The key prefix for a model texture out of a mod.
pub const TEX: &str = "modtex:";

/// What a mod's file may be called: "pak24_dir.vpk", "maps/dota.vpk"; no walking up out of the
/// mod folder, no drive letters, no backslashes.
fn safe_rel(rel: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9_.\-]*(/[A-Za-z0-9][A-Za-z0-9_.\-]*)*$").unwrap())
        .is_match(rel)
}

/// PNG decoding and a box-filtered shrink, the decoder the app uses.
pub struct PngImages;

impl Images for PngImages {
    fn read(&self, file: &Path) -> Option<Bitmap> {
        let img = crate::png_strip::decode_png(&std::fs::read(file).ok()?)?;
        Some(Bitmap { width: img.width as usize, height: img.height as usize, data: img.rgba })
    }
    fn to_small_png(&self, bmp: &Bitmap) -> Vec<u8> {
        let long = bmp.width.max(bmp.height);
        if long <= MAX_SIDE {
            return crate::png_strip::encode_png(bmp.width as u32, bmp.height as u32, &bmp.data);
        }
        let w = ((bmp.width * MAX_SIDE) as f64 / long as f64).round().max(1.0) as usize;
        let h = ((bmp.height * MAX_SIDE) as f64 / long as f64).round().max(1.0) as usize;
        let small = shrink(bmp, w, h);
        crate::png_strip::encode_png(w as u32, h as u32, &small)
    }
}

/// Each target pixel the mean of the source pixels under it.
fn shrink(bmp: &Bitmap, w: usize, h: usize) -> Vec<u8> {
    let mut out = vec![0u8; w * h * 4];
    for y in 0..h {
        let (y0, y1) = (y * bmp.height / h, ((y + 1) * bmp.height / h).max(y * bmp.height / h + 1));
        for x in 0..w {
            let (x0, x1) = (x * bmp.width / w, ((x + 1) * bmp.width / w).max(x * bmp.width / w + 1));
            let mut sum = [0u64; 4];
            let mut n = 0u64;
            for sy in y0..y1.min(bmp.height) {
                for sx in x0..x1.min(bmp.width) {
                    let i = (sy * bmp.width + sx) * 4;
                    for (c, s) in sum.iter_mut().enumerate() {
                        *s += u64::from(bmp.data.get(i + c).copied().unwrap_or(0));
                    }
                    n += 1;
                }
            }
            let o = (y * w + x) * 4;
            for c in 0..4 {
                out[o + c] = (sum[c] / n.max(1)) as u8;
            }
        }
    }
    out
}

/// One picture to make: the mod file, the texture inside it, and where the answer is kept.
#[derive(Debug, Clone)]
struct Job {
    file: PathBuf,
    inner: String,
    cache: PathBuf,
    miss: PathBuf,
}

fn parse_key(key: &str) -> Option<(Kind, &str)> {
    [(VID, Kind::Video), (ART, Kind::Art), (TEX, Kind::Texture)]
        .into_iter()
        .find_map(|(p, k)| key.strip_prefix(p).map(|rel| (k, rel)))
}

fn data_uri(file: &Path) -> Option<String> {
    let b = std::fs::read(file).ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
}

/// Pictures for mods that came with none, cached in userData.
pub struct ModPreviews {
    pub root: PathBuf,
    vrf: ToolPath,
    lang_file_of: LangFileOf,
    images: Box<dyn Images>,
    run: Run,
    log: Box<dyn Fn(&str) + Send + Sync>,
}

impl ModPreviews {
    /// `lang_file_of`: where a mod's *_dir.vpk actually is.
    pub fn new(
        user_data: &Path,
        vrf: ToolPath,
        lang_file_of: LangFileOf,
        images: Box<dyn Images>,
        run: Run,
        log: Box<dyn Fn(&str) + Send + Sync>,
    ) -> Self {
        Self { root: user_data.join("icons").join("mods"), vrf, lang_file_of, images, run, log }
    }

    pub fn ready(&self) -> bool {
        (self.vrf)().is_some()
    }

    /// What this mod would show, and under what name it is cached: the CRC comes with the index,
    /// so a mod moved to another pak slot keeps its picture.
    fn candidate_for(&self, kind: Kind, rel: &str) -> Option<Job> {
        if !safe_rel(rel) {
            return None;
        }
        let file = (self.lang_file_of)(rel).filter(|f| f.exists())?;
        let crcs = crate::vpk::list_path_crcs(&crate::vpk::read_index_file(&file).ok()?).ok()?;
        let inner = pick_candidate(crcs.keys().map(String::as_str), kind)?;
        let mut h = Sha1::new();
        h.update(format!("{inner}:{}", crcs[&inner]));
        let stamp: String = format!("{:x}", h.finalize()).chars().take(16).collect();
        Some(Job {
            file,
            cache: self.root.join(format!("{stamp}.png")),
            miss: self.root.join(format!("{stamp}.none")),
            inner,
        })
    }

    /// Decode these candidates into the cache in one call: the tool takes a folder with
    /// --recursive, so a batch costs what one file costs.
    fn decode_into(&self, jobs: &[Job]) -> Result<(), String> {
        let Some(exe) = (self.vrf)() else { return Ok(()) };
        if jobs.is_empty() {
            return Ok(());
        }
        let tmp = crate::import::mkdtemp("d2mm-preview-")?;
        let mut staged: Vec<(&Job, String)> = Vec::new();
        for job in jobs {
            let entry = match crate::vpk::read_entry_file(&job.file, &job.inner) {
                Ok(e) => e,
                Err(e) => {
                    (self.log)(&format!("mod preview: {} not readable ({e})", job.inner));
                    continue;
                }
            };
            let Some((data, _)) = entry.filter(|(d, _)| !d.is_empty()) else { continue };
            let stem = staged.len().to_string();
            std::fs::write(tmp.0.join(format!("{stem}.vtex_c")), data).map_err(|e| e.to_string())?;
            staged.push((job, stem));
        }
        if staged.is_empty() {
            return Ok(());
        }
        let dir = tmp.0.to_string_lossy().to_string();
        (self.run)(&exe, &["-i".into(), dir.clone(), "-o".into(), dir, "-d".into(), "--recursive".into()])?;
        std::fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        for (job, stem) in staged {
            let produced = tmp.0.join(format!("{stem}.png"));
            if !produced.exists() {
                std::fs::write(&job.miss, b"").map_err(|e| e.to_string())?;
                continue;
            }
            match self.images.read(&produced).filter(|b| worth_showing(b.width, b.height, &b.data)) {
                Some(bmp) => std::fs::write(&job.cache, self.images.to_small_png(&bmp)).map_err(|e| e.to_string())?,
                // remembered, so a mod whose only texture is empty is not decoded again every
                // time its row scrolls past
                None => std::fs::write(&job.miss, b"").map_err(|e| e.to_string())?,
            }
        }
        Ok(())
    }

    /// Pictures for these keys, as data URIs. Keys that are not ours, mods with nothing to show,
    /// and everything doubtful come back missing, and the caller falls through to what it had.
    pub fn get_many(&self, keys: &[String]) -> IndexMap<String, String> {
        let mut out = IndexMap::new();
        // cache path -> job, and the keys waiting on it: two keys can want the same picture
        let mut todo: IndexMap<PathBuf, Job> = IndexMap::new();
        let mut asking: IndexMap<PathBuf, Vec<String>> = IndexMap::new();
        for key in keys {
            let Some((kind, rel)) = parse_key(key) else { continue };
            let Some(job) = self.candidate_for(kind, rel) else { continue };
            if job.cache.exists() {
                if let Some(uri) = data_uri(&job.cache) {
                    out.insert(key.clone(), uri);
                }
                continue;
            }
            // already looked and there was nothing; a still out of a video is made in the window
            if job.miss.exists() || kind == Kind::Video || !self.ready() {
                continue;
            }
            asking.entry(job.cache.clone()).or_default().push(key.clone());
            todo.entry(job.cache.clone()).or_insert(job);
        }
        if todo.is_empty() {
            return out;
        }
        let jobs: Vec<Job> = todo.into_values().collect();
        for batch in jobs.chunks(MAX_PER_CALL) {
            if let Err(e) = self.decode_into(batch) {
                (self.log)(&format!("mod preview: extraction failed ({e})"));
                break; // the old fallbacks answer for the rest
            }
        }
        for (cache, waiting) in asking {
            let Some(uri) = cache.exists().then(|| data_uri(&cache)).flatten() else { continue };
            for key in waiting {
                out.insert(key, uri.clone());
            }
        }
        out
    }

    /// Whether there is a clip here whose frame has not been taken yet; reads indexes only.
    pub fn has_video(&self, key: &str) -> bool {
        match parse_key(key) {
            Some((Kind::Video, rel)) => {
                self.candidate_for(Kind::Video, rel).is_some_and(|j| !j.cache.exists() && !j.miss.exists())
            }
            _ => false,
        }
    }

    /// The mod's own video, for the window to take a frame out of; asked for once per mod.
    pub fn video_bytes(&self, key: &str) -> Option<Vec<u8>> {
        let Some((Kind::Video, rel)) = parse_key(key) else { return None };
        let job = self.candidate_for(Kind::Video, rel)?;
        if job.cache.exists() || job.miss.exists() {
            return None;
        }
        let entry = match crate::vpk::read_entry_file(&job.file, &job.inner) {
            Ok(e) => e,
            Err(e) => {
                (self.log)(&format!("mod preview: {} not readable ({e})", job.inner));
                return None;
            }
        };
        let (data, _) = entry.filter(|(d, _)| !d.is_empty())?;
        if data.len() > MAX_VIDEO_BYTES {
            let _ = std::fs::create_dir_all(&self.root);
            let _ = std::fs::write(&job.miss, b"");
            return None;
        }
        Some(data)
    }

    /// Keep the frame the window decoded, if it is worth keeping: a portrait that opens on a fade
    /// from black is a black square. The picture, or None.
    pub fn save_frame(&self, key: &str, png: Option<&[u8]>) -> Option<String> {
        let Some((Kind::Video, rel)) = parse_key(key) else { return None };
        let png = png.filter(|p| !p.is_empty())?;
        let job = self.candidate_for(Kind::Video, rel)?;
        std::fs::create_dir_all(&self.root).ok()?;
        let stem = job.cache.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let tmp = self.root.join(format!("{stem}.frame"));
        let kept = (|| {
            std::fs::write(&tmp, png).ok()?;
            match self.images.read(&tmp).filter(|b| worth_showing(b.width, b.height, &b.data)) {
                Some(bmp) => {
                    std::fs::write(&job.cache, self.images.to_small_png(&bmp)).ok()?;
                    data_uri(&job.cache)
                }
                None => {
                    let _ = std::fs::write(&job.miss, b"");
                    None
                }
            }
        })();
        let _ = std::fs::remove_file(&tmp);
        kept
    }

    pub fn size(&self) -> u64 {
        crate::folder_size::folder_size(&self.root)
    }

    pub fn clear(&self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bitmap(w: usize, h: usize) -> Bitmap {
        let data = (0..w * h).flat_map(|i| [(i % w) as u8, (i / w) as u8, 128, 255]).collect();
        Bitmap { width: w, height: h, data }
    }

    #[test]
    fn a_big_picture_comes_back_at_320_on_its_long_side_and_a_small_one_as_it_was() {
        let dir = crate::import::mkdtemp("mm-png-").unwrap();
        let small = PngImages.to_small_png(&bitmap(640, 200));
        let file = dir.0.join("a.png");
        std::fs::write(&file, &small).unwrap();
        let back = PngImages.read(&file).unwrap();
        assert_eq!((back.width, back.height), (320, 100));
        // each pixel the mean of the two-by-two under it
        assert_eq!(&back.data[..4], &[0, 0, 128, 255]);
        assert_eq!(&back.data[4..8], &[2, 0, 128, 255]);
        let kept = bitmap(100, 40);
        std::fs::write(&file, PngImages.to_small_png(&kept)).unwrap();
        assert_eq!(PngImages.read(&file).unwrap(), kept);
    }

    #[test]
    fn a_key_is_ours_only_with_our_prefix_and_a_plain_relative_name() {
        assert_eq!(parse_key("modart:pak24_dir.vpk"), Some((Kind::Art, "pak24_dir.vpk")));
        assert_eq!(parse_key("hero:Brewmaster"), None);
        assert!(safe_rel("maps/dota.vpk"));
        for bad in ["../x_dir.vpk", "C:/x_dir.vpk", r"a\b_dir.vpk", "/x.vpk", ""] {
            assert!(!safe_rel(bad), "{bad}");
        }
    }
}
