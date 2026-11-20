//! Each hero's own pedestal in the item builder: the one the person chose for the hero
//! (settings `heroPedestals`, hero id to model), else the one an arcana or persona picked for it
//! brings (its `portrait_background_model`, in the style worn). Either is sewn into the hero's
//! loadout animation (loadout_pedestal.rs), never given through items_game.
//!
//! What happens to the game's own pedestal under it, which every hero stands on:
//!   - with the item table on, the hero's item says the pedestal is a model that draws nothing,
//!     for that hero alone (`hide_in_table`);
//!   - without it, a file can only hide it for everybody: with `pedestalHideBase` on it is
//!     replaced by that empty model (heroes with no pedestal of their own stand on none), off the
//!     chosen pedestal stands over the game's.

use std::collections::HashSet;

use indexmap::IndexMap;
use serde::Serialize;
use serde_json::Value;

use crate::item_builder_everyone::SchemaPatch;
use crate::item_builder_slots::item_heroes;
use crate::kv::{self, Bounds, KvError};
use crate::loadout_pedestal::{pedestal_particle, sew_into_loadout, BASE_PEDESTAL, EMPTY_MODEL, PARTICLE_BASE};
use crate::schema::items_of;
use crate::vpk::{entry_at, Entry};

/// Where the pedestals' particles are written.
const PARTICLES: &str = "particles/mm_pedestal";
/// Models in the pedestals' folder that are no pedestal: the block an effigy of Zeus is carved from.
const NOT_PEDESTALS: [&str; 1] = ["models/heroes/pedestal/mesh/effigy_zeus_arcana.vmdl"];
/// The modifier that names an item's pedestal.
const MODIFIER: &str = "portrait_background_model";

/// What the person asked for: each hero's pedestal (`heroPedestals`), and whether the game's own
/// goes for everybody when the table is off (`pedestalHideBase`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PedestalAsk {
    pub chosen: IndexMap<String, String>,
    pub hide_base: bool,
    /// each hero's pedestal moved up (or down) from its feet, in the game's units
    pub lifts: IndexMap<String, f64>,
}

impl PedestalAsk {
    pub fn of(settings: &crate::settings::Settings) -> Self {
        PedestalAsk {
            chosen: chosen(settings.get("heroPedestals")),
            hide_base: settings.get("pedestalHideBase").is_some_and(crate::js::truthy),
            lifts: lifts(settings.get("heroPedestalHeights")),
        }
    }
}

/// The heroes' pedestals the person chose: hero id (`juggernaut`) to model path.
pub fn chosen(settings: Option<&Value>) -> IndexMap<String, String> {
    settings
        .and_then(Value::as_object)
        .map(|m| {
            m.iter().filter_map(|(hero, model)| Some((hero.to_lowercase(), clean_model(model.as_str()?)?))).collect()
        })
        .unwrap_or_default()
}

/// Each hero's pedestal height (settings `heroPedestalHeights`): hero id to units, within LIFT_MAX.
pub fn lifts(settings: Option<&Value>) -> IndexMap<String, f64> {
    settings
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(hero, n)| Some((hero.to_lowercase(), n.as_f64().filter(|n| n.is_finite())?)))
                .map(|(hero, n)| (hero, n.clamp(-crate::loadout_pedestal::LIFT_MAX, crate::loadout_pedestal::LIFT_MAX)))
                .collect()
        })
        .unwrap_or_default()
}

/// A model path as the game names it, or None for one that is not a model.
pub fn clean_model(m: &str) -> Option<String> {
    let m = m.trim().replace('\\', "/").to_lowercase();
    let m = m.strip_suffix("_c").unwrap_or(&m).to_string();
    let ok = m.starts_with("models/")
        && m.ends_with(".vmdl")
        && !m.contains("..")
        && m.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'/' | b'.' | b'-'));
    ok.then_some(m)
}

fn first_child<'a>(text: &'a [u8], bounds: Bounds, key: &str) -> Result<Option<kv::Child<'a>>, KvError> {
    Ok(kv::children(text, bounds)?.into_iter().find(|c| c.is_block() && c.key.eq_ignore_ascii_case(key.as_bytes())))
}

/// One pedestal modifier: where its block starts and ends, its model, its style.
type Modifier = (usize, usize, String, Option<String>);

/// The item's pedestal modifiers in its visuals.
fn pedestal_modifiers(block: &[u8]) -> Result<Vec<Modifier>, KvError> {
    let Some(visuals) = first_child(block, kv::block_bounds(block, 0)?, "visuals")? else { return Ok(vec![]) };
    let mut out = Vec::new();
    for c in kv::children(block, visuals.body.expect("a block"))? {
        let Some(body) = c.body else { continue };
        if !c.key.eq_ignore_ascii_case(b"asset_modifier") {
            continue;
        }
        let fields: Vec<(String, String)> = kv::children(block, body)?
            .iter()
            .filter_map(|f| Some((kv::latin1(f.key).to_lowercase(), kv::latin1(f.value?))))
            .collect();
        let field = |k: &str| fields.iter().find(|(f, _)| f == k).map(|(_, v)| v.clone());
        if field("type").is_some_and(|t| t.eq_ignore_ascii_case(MODIFIER)) {
            out.push((c.start, c.end, field("asset").unwrap_or_default(), field("style")));
        }
    }
    Ok(out)
}

/// The pedestal a built pick brings: its modifier for the style worn (a pick's block keeps the
/// worn style as style 0, item_builder_styles.rs), not one that draws nothing.
pub fn pedestal_of_block(block: &[u8]) -> Option<String> {
    pedestal_modifiers(block)
        .ok()?
        .into_iter()
        .filter(|(_, _, _, style)| style.as_deref().is_none_or(|s| s.trim() == "0"))
        .filter_map(|(_, _, asset, _)| clean_model(&asset))
        .find(|m| m != EMPTY_MODEL)
}

/// What the 3D preview stands each hero on: the settings as the window last asked for a hero
/// (owner_preview3d.rs sets it before each preview).
static PREVIEW_ASK: std::sync::Mutex<Option<PedestalAsk>> = std::sync::Mutex::new(None);

/// The heroes' pedestals the next previews stand on.
pub fn set_preview_ask(ask: PedestalAsk) {
    *PREVIEW_ASK.lock().unwrap_or_else(|e| e.into_inner()) = Some(ask);
}

/// The 3D preview's stage with the pedestal the build sews for `hero` (`stage.pedestal`, none
/// leaves the window's own stand) and its height (`stage.pedestalLift`, the game's units): the one
/// chosen, else the one a pick worn (`slots` as the preview asks) brings in its style.
pub fn stage_pedestal(
    stage: &mut Value,
    text: &[u8],
    library: &[Value],
    slots: &[Value],
    hero: &str,
) -> Result<(), String> {
    let ask = PREVIEW_ASK.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default();
    let short = hero.strip_prefix("npc_dota_hero_").unwrap_or(hero).to_string();
    let text_of = |v: Option<&Value>| v.filter(|v| crate::js::truthy(v)).map(crate::js::string).unwrap_or_default();
    let installed: Vec<Value> = library
        .iter()
        .filter(|r| {
            r.get("categoryId").and_then(Value::as_str) == Some("cosmetic")
                && r.get("enabled") != Some(&Value::Bool(false))
                && r.get("itemId").is_some_and(crate::js::truthy)
        })
        .cloned()
        .collect();
    let worn = || -> Result<Option<String>, String> {
        let equipped =
            crate::hero_preview_picks::preview_equipment(text, &installed, slots).map_err(|e| e.to_string())?;
        Ok(equipped.iter().find_map(|r| {
            let slot = text_of(r.get("slot"));
            let hero_of = slot.strip_prefix("item:").and_then(|s| s.split(':').next()).unwrap_or("");
            if !hero_of.split('+').any(|h| h == short) {
                return None;
            }
            let style = crate::item_builder_styles::style_of(&text_of(r.get("effectId")));
            item_pedestal(text, &text_of(r.get("itemId")), style)
        }))
    };
    let own = match ask.chosen.get(&short) {
        Some(m) => Some(m.clone()),
        None => worn()?,
    };
    stage["pedestalLift"] = serde_json::json!(ask.lifts.get(&short).copied().unwrap_or(0.0));
    stage["pedestal"] = own.map_or(Value::Null, Value::String);
    Ok(())
}

/// The pedestal's GLB for the preview, its pictures inside, at the stage's height.
pub fn preview_glb(stand: Option<std::path::PathBuf>, stage: &Value) -> Result<Option<Vec<u8>>, String> {
    let lift = stage.get("pedestalLift").and_then(Value::as_f64).unwrap_or(0.0);
    stand
        .map(|s| crate::glb_embed::embed_glb(&s).and_then(|g| crate::loadout_pedestal::lifted_glb(&g, lift)))
        .transpose()
}

/// The pedestal an item of the game's table brings worn in style `style`: its modifier of that
/// style, or one for every style. For the 3D preview, which reads the game's own blocks.
pub fn item_pedestal(text: &[u8], item_id: &str, style: u64) -> Option<String> {
    let (start, end) = crate::schema::find_item(text, item_id, None).ok()??;
    let want = style.to_string();
    pedestal_modifiers(&text[start..end])
        .ok()?
        .into_iter()
        .filter(|(_, _, _, s)| s.as_deref().is_none_or(|s| s.trim() == want))
        .filter_map(|(_, _, asset, _)| clean_model(&asset))
        .find(|m| m != EMPTY_MODEL)
}

/// The heroes of an item block, by their ids (`juggernaut`).
fn heroes_of(block: &[u8]) -> Vec<String> {
    item_heroes(block, 0)
        .unwrap_or_default()
        .into_iter()
        .map(|h| h.strip_prefix("npc_dota_hero_").unwrap_or(&h).to_string())
        .collect()
}

/// Each hero's pedestal: the one chosen, else the one a pick brings. `picks` are the built
/// item picks' blocks.
pub fn pedestals<'a>(
    chosen: &IndexMap<String, String>,
    picks: impl Iterator<Item = &'a [u8]>,
) -> IndexMap<String, String> {
    let mut out = chosen.clone();
    for block in picks {
        let Some(model) = pedestal_of_block(block) else { continue };
        for hero in heroes_of(block) {
            out.entry(hero).or_insert_with(|| model.clone());
        }
    }
    out
}

/// What sewing the pedestals made: the files, and the heroes that got theirs.
#[derive(Debug, Default)]
pub struct PedestalFiles {
    pub entries: Vec<Entry>,
    pub heroes: Vec<String>,
}

/// The files that put each hero's pedestal on: the hero's model sewn (the one at its path in
/// `current`, the picks' build, else the game's), the particles it creates, and with `hide_base`
/// the game's pedestal made one that draws nothing. They go over any file of the same path.
pub fn pedestal_files(
    pedestals: &IndexMap<String, String>,
    lifts: &IndexMap<String, f64>,
    current: &dyn Fn(&str) -> Option<Vec<u8>>,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    hide_base: bool,
    log: &mut dyn FnMut(String),
) -> PedestalFiles {
    let mut out = Vec::new();
    let mut heroes = Vec::new();
    let mut made: HashSet<String> = HashSet::new();
    let base = read(PARTICLE_BASE);
    for (hero, model) in pedestals {
        let r = (|| -> Result<(), String> {
            let base = base.as_deref().ok_or("the game's particle the pedestal is made from is not there")?;
            let at = crate::item_builder_assets::hero_model_path(read, &format!("npc_dota_hero_{hero}"))?;
            let at = format!("{}_c", at.replace('\\', "/").to_lowercase());
            let body = current(&at).or_else(|| read(&at)).ok_or_else(|| format!("{at} is not in the game"))?;
            let stem = model.rsplit('/').next().unwrap_or("pedestal").trim_end_matches(".vmdl").to_string();
            let name = |frames: i64| format!("{PARTICLES}/{hero}_{stem}_{frames}.vpcf");
            let Some(sewn) = sew_into_loadout(&body, &name)? else {
                return Err(format!("{at} has no loadout clip to carry it"));
            };
            for p in &sewn.particles {
                let path = format!("{}_c", p.path);
                if made.insert(path.clone()) {
                    let lift = lifts.get(hero).copied().unwrap_or(0.0);
                    out.push(entry_at(&path, pedestal_particle(base, model, p.seconds, lift)?.into()));
                }
            }
            out.push(entry_at(&at, sewn.model.into()));
            heroes.push(hero.clone());
            Ok(())
        })();
        if let Err(e) = r {
            log(format!("pedestal: {hero} left on the game's own: {e}"));
        }
    }
    if hide_base && !out.is_empty() {
        match read(&format!("{EMPTY_MODEL}_c")) {
            Some(empty) => out.push(entry_at(&format!("{BASE_PEDESTAL}_c"), empty.into())),
            None => log("pedestal: the empty model is not in the game, the game's pedestal stays".into()),
        }
    }
    PedestalFiles { entries: out, heroes }
}

/// `entries` with `over` in place of any of the same path, `over` first.
pub fn put_over(entries: Vec<Entry>, over: Vec<Entry>) -> Vec<Entry> {
    let paths: HashSet<String> = over.iter().map(|e| e.path().to_lowercase()).collect();
    over.into_iter().chain(entries.into_iter().filter(|e| !paths.contains(&e.path().to_lowercase()))).collect()
}

/// An item block without pedestal modifiers of its own.
pub fn without_pedestals(block: &[u8]) -> Result<Vec<u8>, KvError> {
    let mut out = block.to_vec();
    for (start, end, _, _) in pedestal_modifiers(block)?.into_iter().rev() {
        out.drain(start..end);
    }
    Ok(out)
}

/// An item block whose pedestal is a model that draws nothing: its own pedestal modifiers out,
/// one with the empty model in its visuals (a visuals block made when it has none).
pub fn with_base_hidden(block: &[u8]) -> Result<Vec<u8>, KvError> {
    let mut out = without_pedestals(block)?;
    let modifier = format!(
        "\n\t\t\t\t\"asset_modifier\"\n\t\t\t\t{{\n\t\t\t\t\t\"type\"\t\t\"{MODIFIER}\"\n\t\t\t\t\t\"asset\"\t\t\"{EMPTY_MODEL}\"\n\t\t\t\t}}"
    );
    let item = kv::block_bounds(&out, 0)?;
    match first_child(&out, item, "visuals")? {
        Some(v) => {
            let close = v.body.expect("a block").1 - 1;
            out.splice(close..close, modifier.bytes().chain("\n\t\t\t".bytes()));
        }
        None => {
            let close = item.1 - 1;
            let visuals = format!("\n\t\t\t\"visuals\"\n\t\t\t{{{modifier}\n\t\t\t}}\n\t\t");
            out.splice(close..close, visuals.bytes());
        }
    }
    Ok(out)
}

/// The table with the game's pedestal hidden for each of `heroes`: the pedestals their items
/// bring taken out (the sewn one is on), and the empty one on the hero's own item, the hero's
/// free item when no pick is there.
pub fn hide_in_table(list: &mut Vec<SchemaPatch>, text: &[u8], heroes: &[String]) -> Result<(), String> {
    let e = |x: KvError| x.to_string();
    for hero in heroes {
        let mut own: Option<usize> = None;
        for (k, p) in list.iter_mut().enumerate() {
            let of = heroes_of(&p.block);
            if !of.contains(hero) {
                continue;
            }
            p.block = without_pedestals(&p.block).map_err(e)?;
            if own.is_none() && of.len() == 1 {
                own = Some(k);
            }
        }
        match own {
            Some(k) => list[k].block = with_base_hidden(&list[k].block).map_err(e)?,
            None => {
                let (id, block) =
                    default_item(text, hero).ok_or_else(|| format!("{hero} has no free item to carry it"))?;
                list.push(SchemaPatch {
                    id,
                    block: with_base_hidden(&block).map_err(e)?,
                    assets: vec![],
                    source: "pedestal".into(),
                });
            }
        }
    }
    Ok(())
}

/// The free item a hero always wears, by id and block, for a hero with no pick in the table.
pub fn default_item(text: &[u8], hero: &str) -> Option<(String, Vec<u8>)> {
    let want = format!("npc_dota_hero_{hero}");
    let items = items_of(text).ok()?;
    items
        .iter()
        .filter(|i| i.prefab.eq_ignore_ascii_case("default_item"))
        .find(|i| item_heroes(&text[i.start..i.end], 0).is_ok_and(|h| h.contains(&want)))
        .map(|i| (i.id.clone(), text[i.start..i.end].to_vec()))
}

/// Where a pedestal's picture is kept (drawn once by the window out of its model,
/// preview3d/model-thumb.ts): the app's folder, under the hash of the model's path. None for a
/// path that is not a model's.
pub fn picture_path(user_data: &std::path::Path, model: &str) -> Option<std::path::PathBuf> {
    use sha1::{Digest, Sha1};
    let model = clean_model(model)?;
    let name = hex::encode(Sha1::digest(model.as_bytes()));
    Some(user_data.join("pedestal-pictures").join(format!("{}.webp", &name[..20])))
}

/// The largest picture kept: a card's is a few dozen kilobytes.
pub const PICTURE_MAX: usize = 2 * 1024 * 1024;

/// A pedestal's picture kept before, or None.
pub fn kept_picture(user_data: &std::path::Path, model: &str) -> Option<Vec<u8>> {
    std::fs::read(picture_path(user_data, model)?).ok().filter(|b| !b.is_empty() && b.len() <= PICTURE_MAX)
}

/// Keep a pedestal's picture for the next time; a WebP only.
pub fn keep_picture(user_data: &std::path::Path, model: &str, webp: &[u8]) -> Result<(), String> {
    let at = picture_path(user_data, model).ok_or("not a model")?;
    if webp.len() > PICTURE_MAX || webp.len() < 12 || &webp[..4] != b"RIFF" || &webp[8..12] != b"WEBP" {
        return Err("not a picture".into());
    }
    std::fs::create_dir_all(at.parent().expect("a folder")).map_err(|e| e.to_string())?;
    let tmp = at.with_extension("tmp");
    std::fs::write(&tmp, webp).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &at).map_err(|e| e.to_string())
}

/// One pedestal the picker offers: its model, and the item of the game that brings it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PedestalOption {
    pub model: String,
    pub item_id: Option<String>,
    pub name: String,
    pub image: Option<String>,
}

/// Every pedestal of the game: those the items bring (in each of their styles), then the plain
/// ones in models/heroes/pedestal/ no item names. `paths` are pak01's.
pub fn pedestal_options<'a>(text: &[u8], paths: impl Iterator<Item = &'a str>) -> Vec<PedestalOption> {
    let mut out: Vec<PedestalOption> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    if let Ok(items) = items_of(text) {
        for i in items.iter() {
            let block = &text[i.start..i.end];
            // most items name no pedestal: look for the word before reading the block
            if !block.windows(MODIFIER.len()).any(|w| w.eq_ignore_ascii_case(MODIFIER.as_bytes())) {
                continue;
            }
            // an item with a pedestal for each style is told apart by the number of the style
            let mut own = 0;
            for (_, _, asset, _) in pedestal_modifiers(block).unwrap_or_default() {
                let Some(model) = clean_model(&asset) else { continue };
                if model == EMPTY_MODEL || model == BASE_PEDESTAL || !seen.insert(model.clone()) {
                    continue;
                }
                own += 1;
                let name = crate::schema::to_utf8(&i.name);
                out.push(PedestalOption {
                    model,
                    item_id: Some(i.id.clone()),
                    name: if own > 1 { format!("{name} {own}") } else { name },
                    image: (!i.image.is_empty()).then(|| i.image.clone()),
                });
            }
        }
    }
    let mut plain: Vec<String> = paths
        .filter_map(|p| p.strip_suffix("_c"))
        .filter(|p| p.starts_with("models/heroes/pedestal/") && p.ends_with(".vmdl"))
        .filter_map(clean_model)
        .filter(|m| m != BASE_PEDESTAL && !NOT_PEDESTALS.contains(&m.as_str()) && !seen.contains(m))
        .collect();
    plain.sort();
    plain.dedup();
    out.extend(plain.into_iter().map(|model| {
        let name = model.rsplit('/').next().unwrap_or(&model).trim_end_matches(".vmdl").replace('_', " ");
        PedestalOption { model, item_id: None, name, image: None }
    }));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const ARCANA: &str = r#""6996"
		{
			"name"		"Demon Eater"
			"used_by_heroes"
			{
				"npc_dota_hero_nevermore"		"1"
			}
			"visuals"
			{
				"asset_modifier"
				{
					"type"		"portrait_background_model"
					"asset"		"models/heroes/shadow_fiend/shadow_fiend_arcana_pedestal.vmdl"
					"style"		"0"
				}
				"asset_modifier"
				{
					"type"		"particle"
					"asset"		"a.vpcf"
					"modifier"		"b.vpcf"
				}
			}
		}"#;

    #[test]
    fn a_pick_brings_its_pedestal_for_its_heroes() {
        assert_eq!(
            pedestal_of_block(ARCANA.as_bytes()).as_deref(),
            Some("models/heroes/shadow_fiend/shadow_fiend_arcana_pedestal.vmdl")
        );
        let mut chosen = IndexMap::new();
        chosen.insert("juggernaut".to_string(), "models/heroes/pedestal/pedestal_1.vmdl".to_string());
        let all = pedestals(&chosen, [ARCANA.as_bytes()].into_iter());
        assert_eq!(
            all.get("nevermore").map(String::as_str),
            Some("models/heroes/shadow_fiend/shadow_fiend_arcana_pedestal.vmdl")
        );
        assert_eq!(all.get("juggernaut").map(String::as_str), Some("models/heroes/pedestal/pedestal_1.vmdl"));
        // the person's choice wins over the arcana's
        chosen.insert("nevermore".to_string(), "models/heroes/pedestal/pedestal_1.vmdl".to_string());
        let all = pedestals(&chosen, [ARCANA.as_bytes()].into_iter());
        assert_eq!(all.get("nevermore").map(String::as_str), Some("models/heroes/pedestal/pedestal_1.vmdl"));
    }

    #[test]
    fn hiding_the_base_puts_the_empty_model_in_its_place() {
        let hidden = with_base_hidden(ARCANA.as_bytes()).unwrap();
        let mods = pedestal_modifiers(&hidden).unwrap();
        assert_eq!(mods.len(), 1, "{}", String::from_utf8_lossy(&hidden));
        assert_eq!(mods[0].2, EMPTY_MODEL);
        assert!(String::from_utf8_lossy(&hidden).contains("\"particle\""));
        assert_eq!(pedestal_of_block(&hidden), None);
        let bare = b"\"100\"\n\t\t{\n\t\t\t\"name\"\t\t\"Axe Default Head\"\n\t\t}";
        let hidden = with_base_hidden(bare).unwrap();
        assert_eq!(pedestal_modifiers(&hidden).unwrap()[0].2, EMPTY_MODEL, "{}", String::from_utf8_lossy(&hidden));
    }

    #[test]
    fn a_picture_is_kept_for_its_model_alone() {
        let dir = std::env::temp_dir().join(format!("mm-pedestal-pictures-{}", std::process::id()));
        let model = "models/heroes/pedestal/pedestal_1.vmdl";
        let webp = b"RIFF\x10\0\0\0WEBPVP8 data".to_vec();
        assert_eq!(kept_picture(&dir, model), None);
        keep_picture(&dir, model, &webp).unwrap();
        assert_eq!(kept_picture(&dir, model).as_deref(), Some(webp.as_slice()));
        assert_eq!(kept_picture(&dir, "models/heroes/pedestal/pedestal_1_large.vmdl"), None);
        assert!(keep_picture(&dir, "../../x.vmdl", &webp).is_err());
        assert!(keep_picture(&dir, model, b"<html>").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_model_paths_are_taken() {
        assert_eq!(
            clean_model("Models\\Heroes\\Pedestal\\Pedestal_1.vmdl_c").as_deref(),
            Some("models/heroes/pedestal/pedestal_1.vmdl")
        );
        assert_eq!(clean_model("models/../x.vmdl"), None);
        assert_eq!(clean_model("particles/x.vpcf"), None);
        let settings =
            serde_json::json!({ "Juggernaut": "models/heroes/pedestal/pedestal_1.vmdl", "axe": 3, "lina": "x" });
        let c = chosen(Some(&settings));
        assert_eq!(c.len(), 1);
        assert_eq!(c.get("juggernaut").map(String::as_str), Some("models/heroes/pedestal/pedestal_1.vmdl"));
    }

    #[test]
    fn the_options_are_the_items_pedestals_and_the_plain_ones() {
        let text = format!("\"items_game\"\n{{\n\t\"items\"\n\t{{\n\t\t{ARCANA}\n\t}}\n}}\n");
        let paths = [
            "models/heroes/pedestal/pedestal_1.vmdl_c",
            "models/heroes/pedestal/loadout_pedestal_2023.vmdl_c",
            "models/heroes/pedestal/mesh/effigy_zeus_arcana.vmdl_c",
        ];
        let o = pedestal_options(text.as_bytes(), paths.into_iter());
        let models: Vec<&str> = o.iter().map(|p| p.model.as_str()).collect();
        assert_eq!(
            models,
            ["models/heroes/shadow_fiend/shadow_fiend_arcana_pedestal.vmdl", "models/heroes/pedestal/pedestal_1.vmdl"]
        );
        assert_eq!(o[0].name, "Demon Eater");
    }
}
