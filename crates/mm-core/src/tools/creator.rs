//! The author's drafts (src/creator.ts, issue #236): a mod being made for the catalog, kept on
//! the author's disk until it is ready, and then either written out as the archive the catalog's
//! own packer makes (src/creator-premod.ts) for the catalog's maintainer, or sent to the catalog's
//! upload API (src/creator-upload.ts) as the form that API takes.
//!
//! A draft is a folder under userData/creator/<id>/: draft.json and the files it names, copied in
//! so the draft survives the originals being moved. Each style is a look of the mod with its own
//! VPK, picture and up to two circle colours, the way the catalog lists styles.
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
const AUTHOR_MODES: [&str; 3] = ["existing", "new", "skip"];
const EXTRA_MODES: [&str; 4] = ["none", "author", "source", "modded"];
/// The palette the catalog offers for a style's circle, in the order a new style takes them.
pub const STYLE_COLORS: [&str; 3] = ["#ddd4ff", "#ff8f8f", "#8fd3ff"];

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

/// The upload page's regex: Latin words, separated once by a space or the hyphen in a hero's name.
fn latin_name(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with([' ', '-'])
        && !s.ends_with([' ', '-'])
        && s.split([' ', '-']).all(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_alphanumeric()))
}

fn one_of<'a>(v: &'a Value, allowed: &[&str], fallback: &'a str) -> String {
    match v.as_str().filter(|s| allowed.contains(s)) {
        Some(s) => s.to_string(),
        None => fallback.to_string(),
    }
}

fn is_hex(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// A style's circle colours: at most two `#rrggbb`, lowercased, with the palette as the default.
fn colors(v: &Value, i: usize) -> Vec<String> {
    let list: Vec<String> = v
        .as_array()
        .map(|a| {
            a.iter().filter_map(Value::as_str).filter(|c| is_hex(c)).take(2).map(str::to_ascii_lowercase).collect()
        })
        .unwrap_or_default();
    if list.is_empty() {
        vec![STYLE_COLORS.get(i).copied().unwrap_or(STYLE_COLORS[0]).to_string()]
    } else {
        list
    }
}

fn is_tag(k: &str) -> bool {
    (1..=40).contains(&k.len()) && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The catalog's tag switches, keeping only the ones that are on.
fn tag_switches(v: &Value) -> Value {
    let Some(o) = v.as_object() else { return json!({}) };
    let kept: Map<String, Value> = o
        .iter()
        .filter(|(k, on)| is_tag(k) && **on == Value::Bool(true))
        .take(40)
        .map(|(k, _)| (k.clone(), json!(true)))
        .collect();
    Value::Object(kept)
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
    if HERO_CATEGORIES.contains(&category.as_str()) && hero.is_empty() {
        out.push(t("выбери героя", &[]));
    }
    if HERO_CATEGORIES.contains(&category.as_str()) && !hero.is_empty() && !name.is_empty() {
        let flat = bare(&name);
        if !flat.contains(&hero) {
            out.push(t("имя героя в названии", &[]));
        } else if flat.split(&hero).collect::<String>().is_empty() {
            out.push(t("после имени героя нужно название", &[]));
        }
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

/// One look of the mod as the upload API takes it: its label, its circle colours, its VPK and preview.
pub struct UploadStyle {
    pub label: String,
    pub colors: Vec<String>,
    pub vpk: Vec<u8>,
    pub preview: Vec<u8>,
}

fn safe_label(s: &str) -> String {
    s.chars().map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') { '_' } else { c }).collect()
}

/// A name or a link, as the catalog's mod.json credits one.
fn credit(kind: &str, name: &str, url: &str) -> Value {
    let is_url = |s: &str| {
        let l = s.to_ascii_lowercase();
        l.starts_with("http://") || l.starts_with("https://")
    };
    if !url.is_empty() || is_url(name) {
        json!({ "type": kind, "url": if url.is_empty() { name } else { url } })
    } else {
        json!({ "type": kind, "name": name })
    }
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
    // the site's three choices: a name the catalog lists, a new one, or nobody (Anonymous)
    let mut links = Vec::new();
    let author = str_of(d, "author");
    if str_of(d, "authorMode") != "skip" && !author.is_empty() {
        links.push(credit("author", &author, &str_of(d, "authorUrl")));
    }
    let extra_name = str_of(d, "extraName");
    let extra_mode = str_of(d, "extraMode");
    if extra_mode != "none" && !extra_name.is_empty() {
        links.push(credit(&extra_mode, &extra_name, &str_of(d, "extraUrl")));
    }
    let mut entry = Map::new();
    entry.insert("name".into(), json!(name));
    entry.insert("preview".into(), json!(first.2));
    entry.insert("file".into(), json!(first.1));
    if named.len() > 1 {
        let list: Vec<Value> = named.iter().map(|n| json!({ "label": n.0, "file": n.1, "preview": n.2 })).collect();
        entry.insert("styles".into(), Value::Array(list));
    }
    entry.insert("tags".into(), json!({}));
    entry.insert("links".into(), Value::Array(links));
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
    json!({ "label": "", "vpk": null, "picture": null, "colors": [STYLE_COLORS[0]] })
}

fn null_or_string(v: &Value) -> Value {
    v.as_str().filter(|s| !s.is_empty()).map(|s| json!(s)).unwrap_or(Value::Null)
}

/// A draft as this build reads it: what older drafts had in a different shape becomes the current
/// fields, and a field this app does not know is kept as it was written.
fn normalize(raw: Value) -> Value {
    let mut d = match raw {
        Value::Object(m) => m,
        _ => Map::new(),
    };
    let raw_styles = d.get("styles").and_then(Value::as_array).cloned().unwrap_or_default();
    let styles: Vec<Value> = raw_styles
        .iter()
        .take(MAX_STYLES)
        .enumerate()
        .map(|(i, s)| {
            let mut st = s.as_object().cloned().unwrap_or_default();
            st.insert("label".into(), json!(text(field(s, "label"), 120)));
            st.insert("vpk".into(), null_or_string(field(s, "vpk")));
            st.insert("picture".into(), null_or_string(field(s, "picture")));
            st.insert("colors".into(), json!(colors(field(s, "colors"), i)));
            Value::Object(st)
        })
        .collect();
    let author = text(field(&Value::Object(d.clone()), "author"), 80);
    let author_mode = one_of(field(&Value::Object(d.clone()), "authorMode"), &AUTHOR_MODES, "new");
    // drafts from before the author modes keep the name they were typed with, as a new one
    let legacy_source = text(field(&Value::Object(d.clone()), "source"), 2048);
    let extra_mode = one_of(
        field(&Value::Object(d.clone()), "extraMode"),
        &EXTRA_MODES,
        if legacy_source.is_empty() { "none" } else { "source" },
    );
    let base = Value::Object(d.clone());
    for (k, max) in [
        ("name", 120),
        ("category", 60),
        ("subcategory", 60),
        ("hero", 60),
        ("description", MAX_TEXT),
        ("authorUrl", 2048),
        ("extraName", 2048),
        ("extraUrl", 2048),
        ("video", 2048),
    ] {
        d.insert(k.into(), json!(text(field(&base, k), max)));
    }
    d.insert("author".into(), json!(author));
    d.insert("authorMode".into(), json!(author_mode));
    d.insert("extraMode".into(), json!(extra_mode));
    d.insert("extraOrigin".into(), json!(one_of(field(&base, "extraOrigin"), &["existing", "new"], "new")));
    // a draft written before the extra link existed has its old source name in this field
    let extra_name = if !truthy(field(&base, "extraName")) && !legacy_source.is_empty() {
        legacy_source
    } else {
        text(field(&base, "extraName"), 2048)
    };
    d.insert("extraName".into(), json!(extra_name));
    d.insert("tags".into(), tag_switches(field(&base, "tags")));
    d.insert("styles".into(), Value::Array(styles));
    let r = field(&base, "replaces");
    let (rc, rn) = (text(field(r, "category"), 60), text(field(r, "name"), 300));
    d.insert(
        "replaces".into(),
        if truthy(r) && !rc.is_empty() && !rn.is_empty() { json!({ "category": rc, "name": rn }) } else { Value::Null },
    );
    Value::Object(d)
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
        let raw: Value = serde_json::from_str(&String::from_utf8_lossy(&bytes)).map_err(|_| gone())?;
        Ok(normalize(raw))
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
                "id": uuid::Uuid::new_v4().to_string(), "name": "", "category": "", "subcategory": "",
                "hero": "", "description": "", "authorMode": "new", "author": "", "authorUrl": "",
                "extraMode": "none", "extraOrigin": "existing", "extraName": "", "extraUrl": "",
                "video": "", "tags": {}, "styles": [new_style()], "replaces": null, "updatedAt": 0,
            }),
        };
        for (k, max) in [
            ("name", 120),
            ("category", 60),
            ("subcategory", 60),
            ("hero", 60),
            ("description", MAX_TEXT),
            ("author", 80),
            ("authorUrl", 2048),
            ("extraName", 2048),
            ("extraUrl", 2048),
            ("video", 2048),
        ] {
            if let Some(v) = fields.get(k) {
                d[k] = json!(text(v, max));
            }
        }
        if let Some(v) = fields.get("authorMode") {
            d["authorMode"] = json!(one_of(v, &AUTHOR_MODES, &str_of(&d, "authorMode")));
        }
        if let Some(v) = fields.get("extraMode") {
            d["extraMode"] = json!(one_of(v, &EXTRA_MODES, &str_of(&d, "extraMode")));
        }
        if let Some(v) = fields.get("extraOrigin") {
            d["extraOrigin"] = json!(one_of(v, &["existing", "new"], &str_of(&d, "extraOrigin")));
        }
        if let Some(v) = fields.get("tags") {
            d["tags"] = tag_switches(v);
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
                    st["colors"] = json!(colors(field(s, "colors"), i));
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
        if str_of(d, "authorMode") != "skip" && !truthy(field(d, "author")) {
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

    /// Each style's VPK and the WebP the window drew, or its own picture when that is already WebP.
    fn ready_styles(&self, id: &str, d: &Value, previews: &[Option<Vec<u8>>]) -> Result<Vec<UploadStyle>, String> {
        let folder = self.folder(id)?;
        let mut styles = Vec::new();
        for (i, s) in field(d, "styles").as_array().cloned().unwrap_or_default().iter().enumerate() {
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
                let which = if label.is_empty() { str_of(d, "name") } else { label };
                return Err(t("Каталогу нужна картинка-превью, а не видео: {0}", &[json!(which)]));
            };
            let vpk = std::fs::read(folder.join(string(field(s, "vpk")))).map_err(|e| e.to_string())?;
            styles.push(UploadStyle { label, colors: colors(field(s, "colors"), i), vpk, preview });
        }
        Ok(styles)
    }

    fn ready(&self, id: &str, previews: &[Option<Vec<u8>>]) -> Result<(Value, Vec<UploadStyle>), String> {
        let d = self.read(id)?;
        let gaps: Vec<String> = Creator::missing(&d).into_iter().chain(catalog_problems(&d)).collect();
        if !gaps.is_empty() {
            return Err(t("Не хватает: {0}", &[json!(gaps.join(", "))]));
        }
        let styles = self.ready_styles(id, &d, previews)?;
        Ok((d, styles))
    }

    /// The draft as the archive PreMod makes, for the catalog's maintainer.
    pub fn bundle(&self, id: &str, previews: &[Option<Vec<u8>>]) -> Result<(String, Vec<u8>), String> {
        let (d, styles) = self.ready(id, previews)?;
        let packed: Vec<PackedStyle> =
            styles.into_iter().map(|s| PackedStyle { label: s.label, vpk: s.vpk, preview: s.preview }).collect();
        premod_archive(&d, &packed)
    }

    /// What the upload API takes: the draft, and each style's VPK and WebP preview as bytes.
    pub fn upload_bundle(&self, id: &str, previews: &[Option<Vec<u8>>]) -> Result<(Value, Vec<UploadStyle>), String> {
        self.ready(id, previews)
    }

    /// The terms are per installation, as they are per browser on the site.
    fn consent_file(&self) -> PathBuf {
        self.root.join("consent.json")
    }

    /// The terms as recorded; an agreement to an older version of them is not one to these.
    pub fn consent(&self, current: &str) -> Value {
        let c: Value = std::fs::read_to_string(self.consent_file())
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or(Value::Null);
        json!({
            "accepted": field(&c, "accepted") == &Value::Bool(true) && str_of(&c, "version") == current,
            "version": str_of(&c, "version"),
            "at": field(&c, "at").as_str().map(|s| json!(s)).unwrap_or(Value::Null),
        })
    }

    pub fn accept_terms(&self, version: &str, at: &str) -> Result<Value, String> {
        let c = json!({ "accepted": true, "version": version, "at": at });
        std::fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        std::fs::write(self.consent_file(), stringify(&c, "  ")).map_err(|e| e.to_string())?;
        Ok(c)
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
        assert!(latin_name("Anti-Mage Blue Glow"));
        assert!(!latin_name("Arcana  Pudge"));
        assert!(!latin_name(" Arcana"));
        assert!(!latin_name("Пудж"));
        assert_eq!(node_extname("a/.png"), "");
        assert_eq!(node_extname("a/b.PNG"), ".PNG");
    }

    #[test]
    fn a_hero_mod_needs_the_hero_then_a_title() {
        let d = json!({ "name": "Blue Glow", "category": "heroes", "hero": "Anti-Mage", "styles": [] });
        assert!(catalog_problems(&d).contains(&t("имя героя в названии", &[])));
        let d = json!({ "name": "Anti-Mage", "category": "heroes", "hero": "Anti-Mage", "styles": [] });
        assert!(catalog_problems(&d).contains(&t("после имени героя нужно название", &[])));
        let d = json!({ "name": "Anti-Mage Blue Glow", "category": "heroes", "hero": "Anti-Mage", "styles": [] });
        assert!(catalog_problems(&d).is_empty());
    }

    #[test]
    fn a_style_takes_two_colours_and_falls_back_to_the_palette() {
        assert_eq!(colors(&json!(["#AABBCC", "#112233", "#445566"]), 0), vec!["#aabbcc", "#112233"]);
        assert_eq!(colors(&json!("nope"), 1), vec!["#ff8f8f"]);
    }

    struct Temp(PathBuf);

    impl Temp {
        fn new() -> Temp {
            let dir = std::env::temp_dir().join(format!("mm-creator-test-{}", uuid::Uuid::new_v4().simple()));
            std::fs::create_dir_all(&dir).unwrap();
            Temp(dir)
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct Fixture {
        _dir: Temp,
        vpk: PathBuf,
        png: PathBuf,
        txt: PathBuf,
        creator: Creator,
    }

    impl Fixture {
        fn new() -> Fixture {
            let dir = Temp::new();
            let vpk = dir.0.join("glow.vpk");
            let mut head = vec![0u8; 12];
            head[..4].copy_from_slice(&crate::vpk::SIGNATURE.to_le_bytes());
            std::fs::write(&vpk, &head).unwrap();
            let png = dir.0.join("glow.png");
            std::fs::write(&png, [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();
            let txt = dir.0.join("notes.txt");
            std::fs::write(&txt, "not a vpk").unwrap();
            let creator = Creator::new(&dir.0.join("user"));
            Fixture { _dir: dir, vpk, png, txt, creator }
        }
    }

    const WEBP: &[u8] = b"RIFF\0\0\0\0WEBPVP8 \0\0\0\0\0\0\0\0";

    fn entry(z: &mut crate::safe_zip::OpenedZip, name: &str) -> Vec<u8> {
        let file = z.get(name).unwrap_or_else(|| panic!("{name} is in the archive"));
        z.read(&file).unwrap()
    }

    fn style_file(f: &Fixture, id: &str, index: usize, kind: &str) -> PathBuf {
        let d = f.creator.list().into_iter().find(|d| d["id"] == id).unwrap();
        f.creator.folder(id).unwrap().join(d["styles"][index][kind].as_str().unwrap())
    }

    #[test]
    fn a_new_draft_is_trimmed_and_touched_drafts_list_first() {
        let f = Fixture::new();
        let a = f.creator.save(None, &json!({ "name": "  Blue glow  ", "author": "me" })).unwrap();
        assert_eq!(a["name"], "Blue glow");
        assert_eq!(a["styles"].as_array().unwrap().len(), 1);
        let a_id = a["id"].as_str().unwrap().to_string();

        let b = f.creator.save(None, &json!({ "name": "Second" })).unwrap();
        let b_id = b["id"].as_str().unwrap().to_string();
        let ids =
            |f: &Fixture| f.creator.list().iter().map(|d| d["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(ids(&f), vec![b_id.clone(), a_id.clone()]);

        let changed = f.creator.save(Some(&a_id), &json!({ "description": "x".repeat(5000) })).unwrap();
        assert_eq!(changed["description"].as_str().unwrap().len(), 2000);
        assert_eq!(ids(&f), vec![a_id, b_id], "two saves in one millisecond still keep their order");
    }

    #[test]
    fn a_draft_keeps_the_forms_credits_tags_and_style_colours() {
        let f = Fixture::new();
        let d = f
            .creator
            .save(
                None,
                &json!({
                    "name": "Blue Glow", "category": "hero-items", "subcategory": "weapons", "hero": "Anti-Mage",
                    "authorMode": "new", "author": "me", "authorUrl": "https://example.com/me",
                    "extraMode": "source", "extraOrigin": "new", "extraName": "someone", "extraUrl": "https://example.com/source",
                    "video": "https://youtu.be/x", "tags": { "weapon": true, "effects": false, "bad key": true },
                    "styles": [{ "label": "Day", "colors": ["#112233", "#445566"] }, { "label": "Night", "colors": ["#778899"] }],
                }),
            )
            .unwrap();
        let id = d["id"].as_str().unwrap().to_string();
        let listed = f.creator.list().into_iter().next().unwrap();
        assert_eq!(listed["hero"], "Anti-Mage");
        assert_eq!(listed["subcategory"], "weapons");
        assert_eq!(listed["authorMode"], "new");
        assert_eq!(listed["extraMode"], "source");
        assert_eq!(listed["extraOrigin"], "new");
        assert_eq!(listed["tags"], json!({ "weapon": true }), "only the switches that are on are kept");
        assert_eq!(listed["styles"][0]["colors"], json!(["#112233", "#445566"]));
        assert_eq!(listed["styles"][1]["colors"], json!(["#778899"]));

        let picked = f.creator.save(Some(&id), &json!({ "authorMode": "existing", "author": "" })).unwrap();
        assert_eq!(picked["authorMode"], "existing");
        let picked = f.creator.save(Some(&id), &json!({ "author": "Someone" })).unwrap();
        assert_eq!(picked["authorMode"], "existing");
        assert_eq!(picked["author"], "Someone");

        f.creator.save(Some(&id), &json!({ "tags": { "base": true } })).unwrap();
        assert_eq!(f.creator.list()[0]["tags"], json!({ "base": true }));
    }

    #[test]
    fn a_file_that_is_not_a_vpk_or_a_picture_is_refused_and_the_draft_is_unchanged() {
        let f = Fixture::new();
        let d = f.creator.save(None, &json!({ "name": "x" })).unwrap();
        let id = d["id"].as_str().unwrap();
        assert!(f.creator.attach(id, &json!(0), "vpk", &f.txt).is_err());
        assert!(f.creator.attach(id, &json!(0), "picture", &f.txt).is_err());
        assert!(f.creator.attach(id, &json!(9), "vpk", &f.vpk).is_err());
        assert_eq!(f.creator.list()[0]["styles"][0]["vpk"], Value::Null);
    }

    #[test]
    fn an_id_that_is_not_a_draft_id_does_not_reach_outside_the_drafts_folder() {
        let f = Fixture::new();
        assert!(f.creator.remove("../../etc").is_err());
        assert!(f.creator.save(Some("../x"), &json!({})).is_err());
    }

    #[test]
    fn what_is_missing_is_named_and_the_archive_is_refused_until_nothing_is() {
        let f = Fixture::new();
        let d = f.creator.save(None, &json!({})).unwrap();
        let id = d["id"].as_str().unwrap().to_string();
        assert_eq!(Creator::missing(&d).len(), 5);
        assert!(f.creator.bundle(&id, &[]).is_err());

        f.creator.save(Some(&id), &json!({ "name": "Blue glow", "category": "river", "author": "me" })).unwrap();
        f.creator.attach(&id, &json!(0), "vpk", &f.vpk).unwrap();
        let full = f.creator.attach(&id, &json!(0), "picture", &f.png).unwrap();
        assert!(Creator::missing(&full).is_empty());

        let two = f.creator.save(Some(&id), &json!({ "styles": [{ "label": "" }, { "label": "" }] })).unwrap();
        assert_eq!(Creator::missing(&two).len(), 4, "a second style asks for its own files and its own name");
    }

    #[test]
    fn the_archive_is_the_one_premod_makes_with_mod_json_and_hash_json() {
        let f = Fixture::new();
        let d = f
            .creator
            .save(
                None,
                &json!({
                    "name": "Blue glow", "category": "river", "author": "https://example.com/me",
                    "styles": [{ "label": "Day" }, { "label": "Night" }],
                }),
            )
            .unwrap();
        let id = d["id"].as_str().unwrap();
        for i in [0, 1] {
            f.creator.attach(id, &json!(i), "vpk", &f.vpk).unwrap();
            f.creator.attach(id, &json!(i), "picture", &f.png).unwrap();
        }
        assert!(f.creator.bundle(id, &[]).is_err(), "a PNG the window did not draw is no WebP preview");

        let (name, zip) = f.creator.bundle(id, &[Some(WEBP.to_vec()), Some(WEBP.to_vec())]).unwrap();
        assert_eq!(name, "Blue glow.zip");
        let mut z = crate::safe_zip::OpenedZip::open(crate::safe_zip::Source::Bytes(zip), None, None).unwrap();
        let mut names: Vec<String> = z.files.iter().map(|e| e.path.clone()).collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "Blue glow Night.webp".to_string(),
                "Blue glow Night.zip".to_string(),
                "Blue glow.webp".to_string(),
                "Blue glow.zip".to_string(),
                "hash.json".to_string(),
                "mod.json".to_string(),
                "submit.json".to_string(),
            ]
        );

        let modjson: Value = serde_json::from_slice(&entry(&mut z, "mod.json")).unwrap();
        assert_eq!(modjson["name"], "Blue glow");
        assert_eq!(modjson["file"], "Blue glow.zip");
        assert_eq!(modjson["preview"], "Blue glow.webp");
        assert_eq!(modjson["styles"][0]["label"], "Day");
        assert_eq!(modjson["styles"][1]["label"], "Night");
        assert_eq!(modjson["links"], json!([{ "type": "author", "url": "https://example.com/me" }]));

        let inner_zip = entry(&mut z, "Blue glow.zip");
        let mut inner =
            crate::safe_zip::OpenedZip::open(crate::safe_zip::Source::Bytes(inner_zip), None, None).unwrap();
        assert_eq!(inner.files.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), vec!["Blue glow.vpk"]);
        assert_eq!(entry(&mut inner, "Blue glow.vpk"), std::fs::read(&f.vpk).unwrap());

        let hash: Value = serde_json::from_slice(&entry(&mut z, "hash.json")).unwrap();
        assert_eq!(hash["mod_name"], "Blue glow");
        assert_eq!(hash["vpk_hash"].as_str().unwrap().len(), 64);
        assert_eq!(hash["vpk_zip_hash"].as_str().unwrap().len(), 64);
        assert!(hash["vpk_hash"].as_str().unwrap().bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(entry(&mut z, "Blue glow.webp"), WEBP);
        assert_eq!(
            serde_json::from_slice::<Value>(&entry(&mut z, "submit.json")).unwrap(),
            json!({ "mode": "new", "category": "river", "hero": null, "description": null })
        );
    }

    #[test]
    fn a_style_dropped_takes_its_files_and_a_deleted_draft_is_gone() {
        let f = Fixture::new();
        let d = f.creator.save(None, &json!({ "styles": [{ "label": "a" }, { "label": "b" }] })).unwrap();
        let id = d["id"].as_str().unwrap().to_string();
        f.creator.attach(&id, &json!(1), "vpk", &f.vpk).unwrap();
        let file = style_file(&f, &id, 1, "vpk");
        assert!(file.exists());

        let kept = f.creator.save(Some(&id), &json!({ "styles": [{ "label": "a" }] })).unwrap();
        assert_eq!(kept["styles"].as_array().unwrap().len(), 1);
        assert!(!file.exists(), "the dropped style's VPK goes with it");

        f.creator.remove(&id).unwrap();
        assert!(f.creator.list().is_empty());
    }

    #[test]
    fn the_terms_are_recorded_for_this_installation() {
        let f = Fixture::new();
        assert_eq!(f.creator.consent("1"), json!({ "accepted": false, "version": "", "at": null }));
        assert_eq!(
            f.creator.accept_terms("1", "2026-01-01T00:00:00.000Z").unwrap(),
            json!({ "accepted": true, "version": "1", "at": "2026-01-01T00:00:00.000Z" })
        );
        assert_eq!(
            f.creator.consent("1"),
            json!({ "accepted": true, "version": "1", "at": "2026-01-01T00:00:00.000Z" })
        );
        // new terms are asked for again
        assert_eq!(f.creator.consent("2")["accepted"], json!(false));
    }
}
