//! A hero recoloured part by part, as one record in My mods (src/hero-paint-service.ts, issue
//! #422; what the parts are is recolor_layers.rs). The window lists the hero's layers and sends a
//! colour for each one that is on; the pak is built from the game's own pak01, a file at a time,
//! and goes early in the load order with the hero items, so it wins over a catalog mod of the hero.
//!
//! Particles take the colour through recolor.rs. A picture is a compiled texture: one with a PNG
//! inside (vtex.rs) is repainted and put back behind the same header; a block-compressed one is
//! read out as a PNG by ValveResourceFormat (`Decode`), repainted, and built again by Valve's
//! compiler (`Compile`), as the child of a stylesheet that names it, or as the colour of a material
//! of the hero shader for the body's textures. The repaint is the shell's image codec (`Repaint`).
//! A build is seconds of work: the shell runs it off the main thread, and a rebuild after a Dota
//! update is `due` and then `rebuild_now`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use indexmap::IndexMap;
use regex::bytes::Regex;
use serde_json::{json, Map, Value};

use crate::ability_sounds_service::Compile;
use crate::generated_pak::{files_json, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::recolor::Rgb;
use crate::recolor_layers::{
    hero_abilities, hero_layers, hero_model_folder, item_model_paths, model_color_textures, with_children, with_shares,
    RecolorLayer, WornItem,
};
use crate::recolor_modes::{parse_paint, rgb_of_hex};
use crate::resource_compiler::{CompileJob, SourceFile};
use crate::vpk::{Entry, Index};

/// A PNG in the chosen colour and mode; the shell's image codec in the app, a fake in tests.
pub type Repaint<'a> = &'a dyn Fn(&[u8], Rgb, &str) -> Result<Vec<u8>, String>;

/// A compressed picture read out as a PNG by ValveResourceFormat (its program, the texture).
pub type Decode<'a> = &'a mut dyn FnMut(&str, &[u8]) -> Result<Vec<u8>, String>;

/// The tools a build may use: ValveResourceFormat's program when it is downloaded, the reader of a
/// compressed picture, and Valve's compiler.
pub struct Tools<'a> {
    pub vrf: Option<String>,
    pub repaint: Repaint<'a>,
    pub decode: Decode<'a>,
    pub compile: Option<Compile<'a>>,
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn is_hero(h: &str) -> bool {
    (2..=40).contains(&h.len()) && h.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
}

/// The worn items as the window hands them: item ids, no more than a hero has slots for.
pub fn worn_of(items: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for x in items.as_array().into_iter().flatten() {
        if let Some(s) = x.as_str().filter(|s| (1..=9).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_digit())) {
            if !out.iter().any(|o| o == s) {
                out.push(s.to_string());
            }
        }
    }
    out.truncate(24);
    out
}

fn lang_file(lang: &str) -> &'static str {
    match lang {
        "ru" => "russian",
        "zh-CN" => "schinese",
        _ => "english",
    }
}

fn latin1(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

/// What a build made: the files that took the colour, and the compressed pictures still to do.
struct Built {
    entries: IndexMap<String, Entry>,
    compressed: Vec<(String, Vec<u8>, Rgb, &'static str)>,
}

/// The service the paint:* channels call.
pub struct HeroPaintService {
    pub game: Option<PathBuf>,
    /// the app's language, for the ability names
    pub lang: String,
}

impl HeroPaintService {
    pub fn new(game: Option<PathBuf>, lang: &str) -> Self {
        HeroPaintService { game, lang: lang.into() }
    }

    fn pak01(&self) -> Result<Arc<Index>, String> {
        let g = self.game.as_ref().ok_or_else(|| t("Не указана папка игры", &[]))?;
        crate::vpk_shared::shared_index(&g.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())
    }

    fn mine(lib: &Library, hero: &str) -> Option<Value> {
        lib.list().iter().find(|r| r["generated"]["paint"].as_str() == Some(hero)).cloned()
    }

    /// The items picked for the hero in the item builder, and the stock ones the window says he
    /// wears, with the particles they name and their model's colour textures.
    fn picked(&self, lib: &Library, vanilla: &[u8], hero: &str, worn: &[String]) -> Result<Vec<WornItem>, String> {
        let mut ids: Vec<String> = Vec::new();
        let prefix = format!("item:{hero}:");
        for r in lib.list() {
            let slot = r.get("slot").filter(|s| crate::js::truthy(s)).map(crate::js::string).unwrap_or_default();
            if r["categoryId"].as_str() == Some("cosmetic")
                && r.get("enabled") != Some(&Value::Bool(false))
                && slot.starts_with(&prefix)
                && r.get("itemId").is_some_and(crate::js::truthy)
            {
                let id = crate::js::string(&r["itemId"]);
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        for w in worn {
            if !ids.contains(w) {
                ids.push(w.clone());
            }
        }
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let index = self.pak01()?;
        let items = crate::schema::items_of(vanilla).map_err(|e| e.to_string())?;
        let name_re = Regex::new(r#"(?-u)"name"[\t-\r \xA0]+"([^"]+)""#).expect("a fixed pattern");
        let particle_re =
            Regex::new(r#"(?i-u)"(?:modifier|asset)"[\t-\r \xA0]+"(particles/[^"]+\.vpcf)""#).expect("a fixed pattern");
        let mut out = Vec::new();
        for id in ids {
            let range = match items.iter().find(|i| i.id == id) {
                Some(i) => Some((i.start, i.end)),
                None => crate::schema::find_item(vanilla, &id, None).map_err(|e| e.to_string())?,
            };
            let Some((start, end)) = range else { continue };
            let block = &vanilla[start..end];
            let name = name_re.captures(block).map(|c| latin1(&c[1]));
            let models = item_model_paths(&latin1(block));
            let textures = model_color_textures(&models, &mut |p| index.read(p).ok().flatten());
            out.push(WornItem {
                name: name.filter(|n| !n.is_empty()).unwrap_or_else(|| id.clone()),
                id,
                particles: particle_re.captures_iter(block).map(|c| latin1(&c[1])).collect(),
                textures: Some(textures),
            });
        }
        Ok(out)
    }

    fn layers(&self, lib: &Library, vanilla: &[u8], hero: &str, worn: &[String]) -> Result<Vec<RecolorLayer>, String> {
        let no_hero = || t("Нет такого героя: {0}", &[json!(hero)]);
        if !is_hero(hero) {
            return Err(no_hero());
        }
        let index = self.pak01()?;
        let script = index
            .read(&format!("scripts/npc/heroes/npc_dota_hero_{hero}.txt"))
            .map_err(|e| e.to_string())?
            .ok_or_else(no_hero)?;
        let text = String::from_utf8_lossy(&script).into_owned();
        let paths: Vec<&str> = index.paths().collect();
        let items = self.picked(lib, vanilla, hero, worn)?;
        let mut all = hero_layers(&paths, hero, &hero_abilities(&text), &items, hero_model_folder(&text).as_deref());
        // an item's particles create others: those are its effect too
        let mut refs = |p: &str| -> Vec<String> {
            let Some(file) = index.read(p).ok().flatten() else { return vec![] };
            crate::resource::references(&file)
                .map(|r| {
                    r.iter()
                        .map(|r| {
                            let l = r.to_lowercase();
                            if l.ends_with("_c") {
                                l
                            } else {
                                format!("{l}_c")
                            }
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        for l in all.iter_mut().filter(|l| l.kind == "item") {
            l.files = with_children(&l.files, &mut refs)
                .into_iter()
                .filter(|p| index.read(p).ok().flatten().is_some())
                .collect();
        }
        Ok(all)
    }

    /// Ability names in the app's language, out of the game's abilities_*.txt.
    fn ability_names(&self) -> IndexMap<String, String> {
        let file = format!("resource/localization/abilities_{}.txt", lang_file(&self.lang));
        self.pak01()
            .ok()
            .and_then(|ix| ix.read(&file).ok().flatten())
            .map(|d| crate::cosmetic_names::localization_tokens(&d))
            .unwrap_or_default()
    }

    #[allow(clippy::too_many_arguments)]
    fn build_files(
        &self,
        lib: &Library,
        vanilla: &[u8],
        hero: &str,
        colors: &Map<String, Value>,
        worn: &[String],
        repaint: Repaint,
        log: &mut dyn FnMut(String),
    ) -> Result<Built, String> {
        let index = self.pak01()?;
        let mut built = Built { entries: IndexMap::new(), compressed: Vec::new() };
        for layer in self.layers(lib, vanilla, hero, worn)? {
            let Some((hex, mode)) = colors.get(&layer.id).and_then(parse_paint) else { continue };
            let color = rgb_of_hex(&hex);
            for p in &layer.files {
                let Some(file) = index.read(p).ok().flatten() else { continue };
                let made = (|| -> Result<(), String> {
                    if p.ends_with(".vpcf_c") {
                        let o = crate::recolor::Options { own: Some(true), ..Default::default() };
                        let (out, n) = crate::recolor::recolor_resource(&file, color, &o)?;
                        if n.changed > 0 {
                            built.entries.insert(p.clone(), crate::vpk::entry_at(p, out.into()));
                        }
                    } else if let Some(png) = crate::vtex::png_from_vtex(&file) {
                        let mut out = file[..file.len() - png.len()].to_vec();
                        out.extend(repaint(png, color, mode)?);
                        built.entries.insert(p.clone(), crate::vpk::entry_at(p, out.into()));
                    } else {
                        built.compressed.push((p.clone(), file.clone(), color, mode));
                    }
                    Ok(())
                })();
                if let Err(e) = made {
                    log(format!("hero paint: {p} left as it is: {e}"));
                }
            }
        }
        Ok(built)
    }

    /// The compressed pictures, read out, repainted and compiled again; none without both tools.
    fn pictures(
        list: &[(String, Vec<u8>, Rgb, &'static str)],
        tools: &mut Tools,
        log: &mut dyn FnMut(String),
    ) -> Vec<Entry> {
        let (Some(exe), Some(compile)) = (tools.vrf.clone(), tools.compile.as_mut()) else {
            if !list.is_empty() {
                let why = if tools.vrf.is_some() { "no compiler" } else { "no ValveResourceFormat" };
                log(format!("hero paint: {} compressed picture(s) left as they are, {why}", list.len()));
            }
            return vec![];
        };
        if list.is_empty() {
            return vec![];
        }
        let made = (|| -> Result<Vec<Entry>, String> {
            let mut files: Vec<SourceFile> = Vec::new();
            let mut rules: Vec<String> = Vec::new();
            let mut compile_list: Vec<String> = Vec::new();
            // a model's texture comes back under a name of the compiler's: put it under the game's
            let mut textures: IndexMap<String, String> = IndexMap::new();
            for (p, file, color, mode) in list {
                let png = (tools.repaint)(&(tools.decode)(&exe, file)?, *color, mode)?;
                if p.starts_with("panorama/images/") {
                    let source = match p.strip_suffix("_png.vtex_c") {
                        Some(s) => format!("{s}.png"),
                        None => p.clone(),
                    };
                    rules.push(format!(
                        ".p{} {{ background-image: url(\"file://{{images}}/{}\"); }}",
                        rules.len(),
                        &source["panorama/images/".len()..]
                    ));
                    files.push(SourceFile { path: source, data: png });
                } else {
                    // a model's texture compiles as the colour of a material of the hero shader
                    let n = textures.len();
                    let source = format!("materials/d2mm_paint/t{n}.png");
                    let vmat = format!("materials/d2mm_paint/t{n}.vmat");
                    let mat = format!("Layer0\n{{\n\tshader \"hero.vfx\"\n\tTextureColor \"{source}\"\n}}\n");
                    files.push(SourceFile { path: source, data: png });
                    files.push(SourceFile { path: vmat.clone(), data: mat.into_bytes() });
                    compile_list.push(vmat);
                    textures.insert(format!("t{n}"), p.clone());
                }
            }
            // Panorama compiles a picture as the child of a style that names it
            if !rules.is_empty() {
                let css = "panorama/styles/d2mm_hero_paint.css".to_string();
                files.push(SourceFile { path: css.clone(), data: rules.join("\n").into_bytes() });
                compile_list.push(css);
            }
            let job = CompileJob { id: "hero_paint".into(), files, compile: compile_list };
            // Valve's compiler now and then dies after it has written its output: one more try
            let out = match compile(&job) {
                Ok(o) => o,
                Err(e) => {
                    log(format!("hero paint: compiling again after: {}", crate::js::slice_utf16(&e, 200)));
                    compile(&job)?
                }
            };
            let own =
                regex::Regex::new(r"^materials/d2mm_paint/(t\d+)_png_[0-9a-f]+\.vtex_c$").expect("a fixed pattern");
            Ok(out
                .into_iter()
                .filter_map(|e| {
                    let p = e.path();
                    if let Some(c) = own.captures(&p) {
                        return textures.get(&c[1]).map(|to| crate::vpk::entry_at(to, e.data.clone()));
                    }
                    list.iter().any(|l| l.0 == p).then_some(e)
                })
                .collect())
        })();
        made.unwrap_or_else(|e| {
            // no Workshop Tools, or the tool failed: the particles still go in
            log(format!("hero paint: {} compressed picture(s) left as they are: {e}", list.len()));
            vec![]
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn put(
        &self,
        inst: &Installer,
        lib: &mut Library,
        vanilla: &[u8],
        (hero, label, colors): (&str, &str, &Map<String, Value>),
        keep_off: bool,
        worn: &[String],
        tools: &mut Tools,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let Built { mut entries, compressed } =
            self.build_files(lib, vanilla, hero, colors, worn, tools.repaint, log)?;
        for e in Self::pictures(&compressed, tools, log) {
            entries.insert(e.path(), e);
        }
        if entries.is_empty() {
            return Err(t("Ни один файл не взял цвет", &[]));
        }
        let list: Vec<Entry> = entries.values().cloned().collect();
        let vpk = crate::vpk::build(&list);
        let count = entries.len();
        // pictures the tools could not build again stay as the game has them; the window says how many
        let left = compressed.iter().filter(|c| !entries.contains_key(&c.0)).count();
        let mut g = Map::new();
        g.insert("paint".into(), json!(hero));
        g.insert("label".into(), json!(label));
        g.insert("layers".into(), Value::Object(colors.clone()));
        if !worn.is_empty() {
            g.insert("items".into(), json!(worn));
        }
        if left > 0 {
            g.insert("left".into(), json!(left));
        }
        let name = t("Перекраска: {0}", &[json!(label)]);
        log(format!("hero paint: {hero}, {} layer(s), {count} file(s)", colors.len()));
        if let Some(old) = Self::mine(lib, hero) {
            let off = keep_off && old.get("enabled") == Some(&Value::Bool(false));
            let files = swap_pak(inst, &old, &vpk, off)?;
            let fields = json!({
                "name": name, "files": files_json(&files), "generated": g, "enabled": !off,
                "updatedAt": crate::js::json_number(crate::library::now()),
            });
            return Ok(lib.update(&old["id"], &fields, None).map_err(io)?.unwrap_or(Value::Null));
        }
        let files = write_pak(inst, &vpk)?;
        let new = json!({
            "name": name, "categoryId": "hero-items", "styleLabel": null, "fileRef": null, "preview": null,
            "files": files_json(&files),
        });
        let made = lib.add(&new, None).map_err(io)?;
        Ok(lib.update(&made["id"], &json!({ "generated": g }), None).map_err(io)?.unwrap_or(Value::Null))
    }

    /// The hero's layers and the colours on now (`vrf`: whether ValveResourceFormat is here).
    pub fn state(&self, lib: &Library, vanilla: &[u8], hero: &str, items: &Value, vrf: bool) -> Result<Value, String> {
        let names = self.ability_names();
        let rec = Self::mine(lib, hero);
        let g = rec.as_ref().and_then(|r| r.get("generated")).filter(|g| g.is_object());
        let mut worn: Vec<Value> = worn_of(items).into_iter().map(Value::String).collect();
        worn.extend(g.and_then(|g| g.get("items")).and_then(Value::as_array).cloned().unwrap_or_default());
        let layers = self.layers(lib, vanilla, hero, &worn_of(&Value::Array(worn)))?;
        let views: Vec<Value> = with_shares(&layers)
            .into_iter()
            .map(|s| {
                let l = s.layer;
                let mut v = Map::new();
                v.insert("id".into(), json!(l.id));
                v.insert("kind".into(), json!(l.kind));
                v.insert("files".into(), json!(l.files.len()));
                if !s.shares.is_empty() {
                    v.insert("shares".into(), json!(s.shares));
                }
                let name = if l.kind == "item" || l.kind == "itemModel" {
                    l.name.clone().map(Value::String)
                } else {
                    Some(match &l.name {
                        Some(n) if !n.is_empty() => json!(names
                            .get(&format!("dota_tooltip_ability_{n}"))
                            .filter(|s| !s.is_empty())
                            .unwrap_or(n)),
                        _ => Value::Null,
                    })
                };
                if let Some(n) = name {
                    v.insert("name".into(), n);
                }
                if l.kind == "item" || l.kind == "effects" {
                    v.insert("particles".into(), json!(l.files.iter().take(400).collect::<Vec<_>>()));
                }
                Value::Object(v)
            })
            .collect();
        let installed = match (&rec, g) {
            (Some(r), Some(g)) => json!({
                "id": r["id"], "layers": g.get("layers").cloned().unwrap_or(Value::Null),
                "enabled": r.get("enabled") != Some(&Value::Bool(false)),
            }),
            _ => Value::Null,
        };
        Ok(json!({ "layers": views, "installed": installed, "vrf": vrf }))
    }

    /// The hero in the colours given, one '#rrggbb' or '#rrggbb:mode' per layer that is on, in
    /// place of the record before: (hero, colours, the hero's name as the window shows it, the items
    /// he wears).
    #[allow(clippy::too_many_arguments)]
    pub fn install(
        &self,
        inst: &Installer,
        lib: &mut Library,
        vanilla: &[u8],
        (hero, colors, label, items): (&Value, &Value, &Value, &Value),
        tools: &mut Tools,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let Some(hero) = hero.as_str().filter(|h| is_hero(h)) else {
            return Err(t("Нет такого героя: {0}", &[json!(crate::js::string(hero))]));
        };
        let picked: Map<String, Value> = colors
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, v)| parse_paint(v).is_some())
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        if picked.is_empty() {
            return Err(t("Выбери цвет хотя бы для одного слоя", &[]));
        }
        let label = match label.as_str().map(crate::js::trim).filter(|l| !l.is_empty()) {
            Some(l) => crate::js::slice_utf16(l, 80),
            None => hero.to_string(),
        };
        self.put(inst, lib, vanilla, (hero, &label, &picked), false, &worn_of(items), tools, log)
    }

    /// After a Dota update: the records among `ids` to build again, which the app does with
    /// `rebuild_now`, out of the way of the start.
    pub fn due(&self, lib: &Library, ids: &[String]) -> Vec<String> {
        lib.list()
            .iter()
            .filter(|r| {
                ids.contains(&crate::js::string(&r["id"])) && r["generated"].get("paint").is_some_and(crate::js::truthy)
            })
            .map(|r| crate::js::string(&r["id"]))
            .collect()
    }

    /// One record built again with its colours; whether it was.
    pub fn rebuild_now(
        &self,
        inst: &Installer,
        lib: &mut Library,
        vanilla: &[u8],
        id: &str,
        tools: &mut Tools,
        log: &mut dyn FnMut(String),
    ) -> bool {
        let Some(rec) = lib.list().iter().find(|r| crate::js::string(&r["id"]) == id).cloned() else { return false };
        let g = &rec["generated"];
        let hero = crate::js::string(&g["paint"]);
        let label =
            g.get("label").filter(|l| crate::js::truthy(l)).map(crate::js::string).unwrap_or_else(|| hero.clone());
        let colors = g.get("layers").and_then(Value::as_object).cloned().unwrap_or_default();
        let worn = worn_of(g.get("items").unwrap_or(&Value::Null));
        match self.put(inst, lib, vanilla, (&hero, &label, &colors), true, &worn, tools, log) {
            Ok(_) => true,
            Err(e) => {
                log(format!("hero paint: could not build again after the update: {e}"));
                false
            }
        }
    }
}

/// A compressed picture read out as a PNG by ValveResourceFormat, in a folder of its own that goes after.
pub fn vrf_png(exe: &str, vtex: &[u8], tmp: &Path, run: crate::rank_look_service::Run) -> Result<Vec<u8>, String> {
    let dir = tmp.join(format!("d2mm-paint-{}-{}", std::process::id(), crate::library::now() as u64));
    std::fs::create_dir_all(&dir).map_err(io)?;
    let done = (|| {
        let src = dir.join("picture.vtex_c");
        let out = dir.join("picture.png");
        std::fs::write(&src, vtex).map_err(io)?;
        let args = ["-i", &src.to_string_lossy(), "-o", &out.to_string_lossy(), "-d"].map(String::from).to_vec();
        run(exe, &args)?;
        std::fs::read(&out).map_err(io)
    })();
    let _ = std::fs::remove_dir_all(&dir);
    done
}
