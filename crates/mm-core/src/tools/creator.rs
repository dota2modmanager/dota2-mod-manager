//! The author's drafts (src/creator.ts, issue #236, step 1): a mod being made for the catalog,
//! kept on the author's disk until it is ready, and then written out as the archive the catalog's
//! own packer makes (src/creator-premod.ts) for the catalog's maintainer. Nothing is uploaded.
//!
//! A draft is a folder under userData/creator/<id>/: draft.json and the files it names, copied in
//! so the draft survives the originals being moved. Each style is a look of the mod with its own
//! VPK and picture, the way the catalog lists styles.
//!
//! The draft is kept as the JSON it is on disk, so a field this app does not know stays as it was.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Map, Value};

use crate::i18n::t;
use crate::js::{slice_utf16, string, stringify, trim, truthy};

const MAX_ARCHIVE: usize = 100 * 1024 * 1024;
/// The most looks one catalog mod may have.
pub const MAX_STYLES: usize = 3;
const MAX_LABEL: usize = 12;
const HERO_CATEGORIES: [&str; 4] = ["heroes", "hero-items", "herofx", "hero-sounds"];
const NOT_TAKEN: [&str; 8] = ["packs", "cursors", "tools", "news", "guides", "sites", "fonts", "creeps"];
const LONG_HEROES: [&str; 2] = ["keeperofthelight", "naturesprophet"];
const MAX_TEXT: usize = 2000;
/// The biggest picture the form is sent as a data URI.
const SHOWN: u64 = 6 * 1024 * 1024;

const NULL: Value = Value::Null;

fn field<'a>(v: &'a Value, key: &str) -> &'a Value {
    v.get(key).unwrap_or(&NULL)
}

fn str_of(v: &Value, key: &str) -> String {
    field(v, key).as_str().unwrap_or("").to_string()
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn bare(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).collect()
}

fn latin_name(s: &str) -> bool {
    !s.is_empty() && s.split(' ').all(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_alphanumeric()))
}

/// What the draft needs to fit the catalog's rules, beyond what is still missing, in words.
pub fn catalog_problems(d: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let (name, category) = (str_of(d, "name"), str_of(d, "category"));
    let hero = bare(&str_of(d, "hero"));
    let room = if LONG_HEROES.contains(&hero.as_str()) { 39 } else { 29 };
    if !name.is_empty() && !latin_name(&name) {
        out.push(t("название латиницей и цифрами, через одиночные пробелы", &[]));
    }
    if utf16_len(&name) > room {
        out.push(t("название не длиннее {0} символов", &[json!(room)]));
    }
    if NOT_TAKEN.contains(&category.as_str()) {
        out.push(t("эта категория в каталог через загрузку не принимается", &[]));
    }
    if HERO_CATEGORIES.contains(&category.as_str())
        && !hero.is_empty()
        && !name.is_empty()
        && !bare(&name).contains(&hero)
    {
        out.push(t("имя героя в названии", &[]));
    }
    let styles = field(d, "styles").as_array().cloned().unwrap_or_default();
    if styles.len() > MAX_STYLES {
        out.push(t("не больше {0} стилей", &[json!(MAX_STYLES)]));
    }
    if styles.len() > 1 && styles.iter().any(|s| utf16_len(&str_of(s, "label")) > MAX_LABEL) {
        out.push(t("название стиля не длиннее {0} символов", &[json!(MAX_LABEL)]));
    }
    out
}

/// Is this a WebP picture, by its RIFF header.
pub fn is_webp(b: Option<&[u8]>) -> bool {
    b.is_some_and(|b| b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP")
}

fn sha256_hex(b: &[u8]) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

/// One look of the mod, ready to pack: its label, its VPK, its WebP preview.
pub struct PackedStyle {
    pub label: String,
    pub vpk: Vec<u8>,
    pub preview: Vec<u8>,
}

fn safe_label(s: &str) -> String {
    s.chars().map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') { '_' } else { c }).collect()
}

/// The archive PreMod would make of these files, with the form's fields beside it: its file name and bytes.
pub fn premod_archive(d: &Value, styles: &[PackedStyle]) -> Result<(String, Vec<u8>), String> {
    let name = str_of(d, "name");
    let mut outer: Vec<(String, Vec<u8>)> = Vec::new();
    let mut named = Vec::new();
    for (i, s) in styles.iter().enumerate() {
        let base = if i == 0 {
            name.clone()
        } else {
            let label = if s.label.is_empty() { (i + 1).to_string() } else { s.label.clone() };
            format!("{name} {}", safe_label(&label))
        };
        let zip = crate::safe_zip::write_zip(&[(format!("{base}.vpk"), s.vpk.clone())])?;
        outer.push((format!("{base}.zip"), zip.clone()));
        outer.push((format!("{base}.webp"), s.preview.clone()));
        let label = if s.label.is_empty() { Value::Null } else { json!(s.label) };
        named.push((label, format!("{base}.zip"), format!("{base}.webp"), zip, &s.vpk));
    }
    let Some(first) = named.first() else {
        return Err("Cannot read properties of undefined (reading 'preview')".into());
    };
    let author = str_of(d, "author");
    let is_url = {
        let l = author.to_ascii_lowercase();
        l.starts_with("http://") || l.starts_with("https://")
    };
    let link =
        if is_url { json!({ "type": "author", "url": author }) } else { json!({ "type": "author", "name": author }) };
    let mut entry = Map::new();
    entry.insert("name".into(), json!(name));
    entry.insert("preview".into(), json!(first.2));
    entry.insert("file".into(), json!(first.1));
    if named.len() > 1 {
        let list: Vec<Value> = named.iter().map(|n| json!({ "label": n.0, "file": n.1, "preview": n.2 })).collect();
        entry.insert("styles".into(), Value::Array(list));
    }
    entry.insert("tags".into(), json!({}));
    entry.insert("links".into(), json!([link]));
    outer.push(("mod.json".into(), stringify(&Value::Object(entry), "  ").into_bytes()));
    let hash = json!({ "mod_name": name, "vpk_hash": sha256_hex(first.4), "vpk_zip_hash": sha256_hex(&first.3) });
    outer.push(("hash.json".into(), stringify(&hash, "  ").into_bytes()));
    let replaces = field(d, "replaces");
    let mut submit = Map::new();
    submit.insert("mode".into(), json!(if truthy(replaces) { "update" } else { "new" }));
    if truthy(replaces) {
        submit.insert("existingName".into(), field(replaces, "name").clone());
    }
    let category = Some(field(replaces, "category"))
        .filter(|v| truthy(v))
        .cloned()
        .unwrap_or_else(|| field(d, "category").clone());
    submit.insert("category".into(), category);
    let or_null = |k: &str| Some(field(d, k)).filter(|v| truthy(v)).cloned().unwrap_or(Value::Null);
    submit.insert("hero".into(), or_null("hero"));
    submit.insert("description".into(), or_null("description"));
    outer.push(("submit.json".into(), stringify(&Value::Object(submit), "  ").into_bytes()));
    let zip = crate::safe_zip::write_zip(&outer)?;
    if zip.len() > MAX_ARCHIVE {
        return Err(t("Архив больше 100 МБ: каталог такой не примет", &[]));
    }
    Ok((format!("{name}.zip"), zip))
}

fn text(v: &Value, max: usize) -> String {
    match v.as_str() {
        Some(s) => slice_utf16(trim(s), max),
        None => String::new(),
    }
}

fn is_id(id: &str) -> bool {
    id.len() == 36 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-')
}

fn is_picture(p: &str) -> bool {
    let l = p.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm"].iter().any(|e| l.ends_with(e))
}

fn new_style() -> Value {
    json!({ "label": "", "vpk": null, "picture": null })
}

/// The drafts under userData/creator, and the archive one of them becomes.
pub struct Creator {
    root: PathBuf,
    last: Mutex<f64>,
}

fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_millis() as f64)
}

impl Creator {
    pub fn new(user_data: &Path) -> Creator {
        Creator { root: user_data.join("creator"), last: Mutex::new(0.0) }
    }

    /// A draft's folder; an id that is not one is refused.
    pub fn folder(&self, id: &str) -> Result<PathBuf, String> {
        if !is_id(id) {
            return Err(t("Черновик не найден", &[]));
        }
        Ok(self.root.join(id))
    }

    fn read(&self, id: &str) -> Result<Value, String> {
        let gone = || t("Черновик не найден", &[]);
        let file = self.folder(id)?.join("draft.json");
        let bytes = std::fs::read(file).map_err(|_| gone())?;
        serde_json::from_str(&String::from_utf8_lossy(&bytes)).map_err(|_| gone())
    }

    // two saves in one millisecond still come out in the order they were made
    fn write(&self, mut d: Value) -> Result<Value, String> {
        let at = {
            let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
            *last = now_ms().max(*last + 1.0);
            *last
        };
        d["updatedAt"] = crate::js::json_number(at);
        let folder = self.folder(&string(field(&d, "id")))?;
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        std::fs::write(folder.join("draft.json"), stringify(&d, "  ")).map_err(|e| e.to_string())?;
        Ok(d)
    }

    /// Every draft, the one touched last first.
    pub fn list(&self) -> Vec<Value> {
        let mut ids: Vec<String> = match std::fs::read_dir(&self.root) {
            Ok(rd) => rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| is_id(n)).collect(),
            Err(_) => return vec![],
        };
        // readdirSync's order is the file system's: by name on NTFS
        ids.sort();
        let mut drafts: Vec<Value> = ids.iter().filter_map(|id| self.read(id).ok()).collect();
        let at = |d: &Value| crate::js::to_number(field(d, "updatedAt"));
        drafts.sort_by(|a, b| (at(b) - at(a)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
        drafts
    }

    fn drop_files(&self, id: &str, s: &Value) -> Result<(), String> {
        for k in ["vpk", "picture"] {
            let f = field(s, k);
            if truthy(f) {
                let _ = std::fs::remove_file(self.folder(id)?.join(string(f)));
            }
        }
        Ok(())
    }

    /// A new draft, or the fields of one changed. A style dropped takes its files with it.
    pub fn save(&self, id: Option<&str>, fields: &Value) -> Result<Value, String> {
        let mut d = match id {
            Some(id) => self.read(id)?,
            None => json!({
                "id": uuid::Uuid::new_v4().to_string(), "name": "", "category": "", "hero": "", "description": "",
                "author": "", "styles": [new_style()], "replaces": null, "updatedAt": 0,
            }),
        };
        for (k, max) in [("name", 120), ("category", 60), ("hero", 60), ("description", MAX_TEXT), ("author", 80)] {
            if let Some(v) = fields.get(k) {
                d[k] = json!(text(v, max));
            }
        }
        if let Some(r) = fields.get("replaces") {
            let (c, n) = (text(field(r, "category"), 60), text(field(r, "name"), 300));
            d["replaces"] = if truthy(r) && !c.is_empty() && !n.is_empty() {
                json!({ "category": c, "name": n })
            } else {
                Value::Null
            };
        }
        if let Some(Value::Array(want)) = fields.get("styles") {
            let old = field(&d, "styles").as_array().cloned().unwrap_or_default();
            let next: Vec<Value> = want
                .iter()
                .take(MAX_STYLES)
                .enumerate()
                .map(|(i, s)| {
                    let mut st = match old.get(i) {
                        Some(o @ Value::Object(_)) => o.clone(),
                        _ => json!({ "vpk": null, "picture": null }),
                    };
                    st["label"] = json!(text(field(s, "label"), 120));
                    st
                })
                .collect();
            let id = string(field(&d, "id"));
            for gone in old.iter().skip(next.len()) {
                self.drop_files(&id, gone)?;
            }
            d["styles"] = if next.is_empty() { json!([new_style()]) } else { Value::Array(next) };
        }
        self.write(d)
    }

    /// A style's VPK or picture, copied into the draft from where it is. Refuses anything else.
    pub fn attach(&self, id: &str, style: &Value, kind: &str, from: &Path) -> Result<Value, String> {
        let mut d = self.read(id)?;
        let index = style.as_f64().filter(|i| i.fract() == 0.0 && *i >= 0.0).map(|i| i as usize);
        let Some(i) = index.filter(|&i| field(&d, "styles").get(i).is_some_and(truthy)) else {
            return Err(t("Черновик не найден", &[]));
        };
        let from_s = from.to_string_lossy();
        if kind == "vpk" {
            let mut head = [0u8; 4];
            let mut f = std::fs::File::open(from).map_err(|e| e.to_string())?;
            let mut got = 0;
            while got < 4 {
                match f.read(&mut head[got..]) {
                    Ok(0) => break,
                    Ok(n) => got += n,
                    Err(e) => return Err(e.to_string()),
                }
            }
            if u32::from_le_bytes(head) != crate::vpk::SIGNATURE {
                return Err(t("Это не VPK-файл", &[]));
            }
        } else if !is_picture(&from_s) {
            return Err(t("Картинка должна быть PNG, JPG, WebP, GIF или видео MP4/WebM", &[]));
        }
        let ext = if kind == "vpk" { ".vpk".to_string() } else { node_extname(&from_s).to_lowercase() };
        let hex: String = uuid::Uuid::new_v4().simple().to_string()[..6].to_string();
        let name = format!("{kind}-{i}-{hex}{ext}");
        let folder = self.folder(id)?;
        let old = field(&d["styles"][i], kind).clone();
        std::fs::copy(from, folder.join(&name)).map_err(|e| e.to_string())?;
        if truthy(&old) {
            let _ = std::fs::remove_file(folder.join(string(&old)));
        }
        d["styles"][i][kind] = json!(name);
        self.write(d)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let folder = self.folder(id)?;
        match std::fs::remove_dir_all(&folder) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }

    /// What is still missing before the draft can go to the catalog, in words for the author.
    pub fn missing(d: &Value) -> Vec<String> {
        let mut out = Vec::new();
        if !truthy(field(d, "name")) {
            out.push(t("название", &[]));
        }
        if !truthy(field(d, "category")) {
            out.push(t("категория", &[]));
        }
        if !truthy(field(d, "author")) {
            out.push(t("автор", &[]));
        }
        let styles = field(d, "styles").as_array().cloned().unwrap_or_default();
        let many = styles.len() > 1;
        for (i, s) in styles.iter().enumerate() {
            // one look is the mod itself; with several, each is named
            let label = field(s, "label");
            let which = if many {
                format!(" {}", if truthy(label) { string(label) } else { (i + 1).to_string() })
            } else {
                String::new()
            };
            if !truthy(field(s, "vpk")) {
                out.push(if many { t("VPK стиля{0}", &[json!(which)]) } else { "VPK".into() });
            }
            if !truthy(field(s, "picture")) {
                out.push(if many {
                    t("картинка стиля{0}", &[json!(which)])
                } else {
                    t("картинка", &[])
                });
            }
            if many && !truthy(label) {
                out.push(t("название стиля {0}", &[json!(i + 1)]));
            }
        }
        out
    }

    /// The draft as the archive PreMod makes, for the catalog's maintainer. Each style's preview is
    /// the WebP the window drew from its picture; a style the window could not draw takes its
    /// picture as it is when that is a WebP already. Refused while something is missing or the
    /// catalog's rules say no.
    pub fn bundle(&self, id: &str, previews: &[Option<Vec<u8>>]) -> Result<(String, Vec<u8>), String> {
        let d = self.read(id)?;
        let gaps: Vec<String> = Creator::missing(&d).into_iter().chain(catalog_problems(&d)).collect();
        if !gaps.is_empty() {
            return Err(t("Не хватает: {0}", &[json!(gaps.join(", "))]));
        }
        let folder = self.folder(id)?;
        let mut styles = Vec::new();
        for (i, s) in field(&d, "styles").as_array().cloned().unwrap_or_default().iter().enumerate() {
            let drawn = previews.get(i).and_then(|p| p.as_deref());
            let own = std::fs::read(folder.join(string(field(s, "picture")))).map_err(|e| e.to_string())?;
            let preview = if is_webp(drawn) {
                drawn.map(<[u8]>::to_vec)
            } else if is_webp(Some(&own)) {
                Some(own)
            } else {
                None
            };
            let label = str_of(s, "label");
            let Some(preview) = preview else {
                let which = if label.is_empty() { str_of(&d, "name") } else { label };
                return Err(t("Каталогу нужна картинка-превью, а не видео: {0}", &[json!(which)]));
            };
            let vpk = std::fs::read(folder.join(string(field(s, "vpk")))).map_err(|e| e.to_string())?;
            styles.push(PackedStyle { label, vpk, preview });
        }
        premod_archive(&d, &styles)
    }

    /// A draft as the form shows it: its pictures as data URIs, and what is still missing.
    pub fn shown(&self, d: &Value) -> Value {
        let mut out = d.as_object().cloned().unwrap_or_default();
        let folder = self.folder(&string(field(d, "id"))).ok();
        let pictures: Vec<Value> = field(d, "styles")
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|s| {
                let p = string(field(s, "picture"));
                let mime = match node_extname(&p).to_lowercase().as_str() {
                    ".png" => "image/png",
                    ".jpg" | ".jpeg" => "image/jpeg",
                    ".webp" => "image/webp",
                    ".gif" => "image/gif",
                    _ => return Value::Null,
                };
                if !truthy(field(s, "picture")) {
                    return Value::Null;
                }
                let Some(folder) = &folder else { return Value::Null };
                // the size and the bytes from one open file, so what is measured is what is read
                let Ok(mut f) = std::fs::File::open(folder.join(&p)) else { return Value::Null };
                if f.metadata().map_or(true, |m| m.len() > SHOWN) {
                    return Value::Null;
                }
                let mut bytes = Vec::new();
                if f.read_to_end(&mut bytes).is_err() {
                    return Value::Null;
                }
                use base64::Engine;
                json!(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
            })
            .collect();
        out.insert("pictures".into(), Value::Array(pictures));
        out.insert("missing".into(), json!(Creator::missing(d)));
        out.insert("problems".into(), json!(catalog_problems(d)));
        Value::Object(out)
    }
}

/// path.extname: the last dot of the base name and what follows, "" for a name that only starts with one.
fn node_extname(p: &str) -> String {
    let base = p.rsplit(['/', '\\']).next().unwrap_or("");
    match base.rfind('.') {
        Some(0) | None => String::new(),
        Some(i) => base[i..].to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_latin_words_with_single_spaces() {
        assert!(latin_name("Arcana Pudge 2"));
        assert!(!latin_name("Arcana  Pudge"));
        assert!(!latin_name(" Arcana"));
        assert!(!latin_name("Пудж"));
        assert_eq!(node_extname("a/.png"), "");
        assert_eq!(node_extname("a/b.PNG"), ".PNG");
    }
}
