//! A catalog mod of the world shown in 3D before it goes in: a ward, a creep, a tower, Roshan, an
//! ancient, the Tormentor, a courier, a pedestal or a tree set (the mod window's stage, beside the
//! heroes' of mod_look.rs).
//!
//! The mod is unpacked as a hero mod is (mod_look.rs), and the models shown are the mod's own: the
//! models it brings. A mod that brings none recolours the game's, so the game's models of the
//! category stand in, read with the mod's files over them: the units of the category in the game's
//! npc_units.txt, or for a pedestal the loadout's. Each is exported in its idle animation where it
//! has one, and dressed with its materials' pictures (loadout_resources.rs), the mod's own in place
//! of the game's, since the toolchain packs a model's colour from the game's file of the same name.
//!
//! The models of one side that stand in one place go together (an ancient and its base): the window
//! shows one group as the body with the rest as its parts, the other groups beside it. The body
//! plays the effects the game gives its category (an ancient's ambience, the Tormentor's shield),
//! the ones its model lists, and the roots of those the mod brings at the game's paths, so a mod
//! whose look is an effect (a dragon drawn by the ancient's ambience) shows.

use crate::model_loadout::{idle_sequence, model_sequences};

/// Models the game stands with a category's own, in the same place: an ancient's base.
fn extras_of(category: &str) -> &'static [&'static str] {
    match category {
        "ancient" => &["models/props_structures/dire_ancient_base001.vmdl"],
        _ => &[],
    }
}

/// The effects the game plays on a category's own, each on the side it is for.
fn effects_of(category: &str) -> &'static [&'static str] {
    match category {
        "ancient" => {
            &["particles/radiant_fx2/good_ancient001_ambient.vpcf", "particles/dire_fx/bad_ancient_ambient.vpcf"]
        }
        _ => &[],
    }
}

/// At most this many effects on the body: a tower mod brings a hundred and thirty.
pub const MAX_EFFECTS: usize = 8;

/// The side a path is for, by the words the game names its sides with; None for both.
pub fn side_of(path: &str) -> Option<&'static str> {
    let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    if ["bad_", "dire", "_bad"].iter().any(|w| name.contains(w)) {
        Some("dire")
    } else if ["good_", "radiant", "_good"].iter().any(|w| name.contains(w)) {
        Some("radiant")
    } else {
        None
    }
}

/// The models in groups of what stands in one place: for an ancient, each side's together, the
/// first its ancient; for the rest, each model alone.
pub fn groups_of(category: &str, models: &[String]) -> Vec<Vec<String>> {
    if category != "ancient" {
        return models.iter().map(|m| vec![m.clone()]).collect();
    }
    let mut out: Vec<Vec<String>> = Vec::new();
    for side in [Some("radiant"), Some("dire"), None] {
        let mut g: Vec<String> = models.iter().filter(|m| side_of(m) == side).cloned().collect();
        // the ancient first, its base after it
        g.sort_by_key(|m| m.contains("base"));
        if !g.is_empty() {
            out.push(g);
        }
    }
    out
}

/// The categories whose units play no effect on the stage: the Tormentor's shield needs the game's
/// own points and ground round its pit, and drew a blot of light on the stage (the user's call).
pub fn no_effects(category: &str) -> bool {
    category == "tormentor"
}

/// The effects to play on a body: the game's for its category and the roots of those the mod brings
/// at the game's own paths (`game_has`), each on the body's side or on both; at most [`MAX_EFFECTS`].
/// `named`: the particles a particle names, to tell a root from a child.
pub fn effects_for<'a>(
    category: &str,
    body: &str,
    mod_paths: impl Iterator<Item = &'a str>,
    game_has: &dyn Fn(&str) -> bool,
    named: &dyn Fn(&str) -> Vec<String>,
) -> Vec<String> {
    // a body of neither side (the Tormentor) stands on Radiant's: the game plays one side's shield
    // on it, and both at once drew one white blot
    let side = side_of(body).unwrap_or("radiant");
    let fits = |p: &str| side_of(p).is_none_or(|s| s == side) && !reaction(p);
    let mut out: Vec<String> = effects_of(category).iter().filter(|p| fits(p)).map(|p| p.to_string()).collect();
    let brought: Vec<String> = mod_paths
        .map(plain)
        .filter(|p| p.starts_with("particles/") && p.ends_with(".vpcf") && game_has(&format!("{p}_c")))
        .collect();
    let children: std::collections::HashSet<String> =
        brought.iter().flat_map(|p| named(p)).map(|c| plain(&c)).collect();
    for p in brought {
        if out.len() >= MAX_EFFECTS {
            break;
        }
        if !children.contains(&p) && fits(&p) && !out.contains(&p) {
            out.push(p);
        }
    }
    out.truncate(MAX_EFFECTS);
    out
}

/// An effect the game plays when something happens to the unit (a hit on the Tormentor's shield, a
/// death), not while it stands.
fn reaction(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    ["_hit", "_impact", "_death", "_destroy", "_destruction", "_spawn", "_attack", "_explode", "_explosion", "_break"]
        .iter()
        .any(|w| name.contains(w))
}

/// The catalog's categories this stage shows.
pub const PROPS: [&str; 9] =
    ["wards", "creeps", "towers", "roshan", "ancient", "tormentor", "couriers", "pedestal", "trees"];

/// At most this many models on the stage: a mod of a whole creep set brings a dozen.
pub const MAX_MODELS: usize = 6;

/// The pedestal the hero loadout stands on.
pub const PEDESTAL: &str = "models/heroes/pedestal/loadout_pedestal_2023.vmdl";

/// The units whose models stand for a category in npc_units.txt, Radiant's first.
pub fn units_of(category: &str) -> &'static [&'static str] {
    match category {
        "wards" => &["npc_dota_observer_wards", "npc_dota_sentry_wards"],
        "creeps" => &[
            "npc_dota_creep_goodguys_melee",
            "npc_dota_creep_goodguys_ranged",
            "npc_dota_goodguys_siege",
            "npc_dota_creep_badguys_melee",
            "npc_dota_creep_badguys_ranged",
            "npc_dota_badguys_siege",
        ],
        "towers" => &["npc_dota_goodguys_tower1_mid", "npc_dota_badguys_tower1_mid"],
        "roshan" => &["npc_dota_roshan"],
        "ancient" => &["npc_dota_goodguys_fort", "npc_dota_badguys_fort"],
        "tormentor" => &["npc_dota_miniboss"],
        "couriers" => &["npc_dota_courier"],
        _ => &[],
    }
}

fn plain(p: &str) -> String {
    let l = p.replace('\\', "/").to_lowercase();
    l.strip_suffix("_c").map(String::from).unwrap_or(l)
}

/// The "Model" of each of these units in npc_units.txt, in their order, each once.
pub fn unit_models(npc_units: &[u8], units: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for unit in units {
        let key = format!("\"{unit}\"");
        let Some(at) = memchr::memmem::find(npc_units, key.as_bytes()) else { continue };
        let Ok(bounds) = crate::kv::block_bounds(npc_units, at + key.len()) else { continue };
        let mut model = None;
        let _ = crate::kv::each_child(npc_units, bounds, |c| {
            if c.key.eq_ignore_ascii_case(b"Model") {
                model = c.value.map(|v| String::from_utf8_lossy(v).to_string());
                return false;
            }
            true
        });
        if let Some(m) = model.map(|m| plain(&m)).filter(|m| m.ends_with(".vmdl")) {
            if !out.contains(&m) {
                out.push(m);
            }
        }
    }
    out
}

/// A model of a mod the stage does not draw: the pieces a building falls into, its broken states, a
/// death, an effect's.
fn shown(model: &str) -> bool {
    let name = model.rsplit('/').next().unwrap_or(model);
    !["_death", "destruction", "debris", "_broken", "shard", "_fx", "_gib", "_lod", "_dest"]
        .iter()
        .any(|w| name.contains(w))
}

/// At most this many paths are looked at, before the same model under several of them is put together.
const MAX_LOOKED: usize = 64;

/// The models a mod brings that the stage shows, as plain paths.
pub fn mod_models<'a>(paths: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut out: Vec<String> =
        paths.map(plain).filter(|p| p.starts_with("models/") && p.ends_with(".vmdl") && shown(p)).collect();
    out.sort();
    out.dedup();
    out.truncate(MAX_LOOKED);
    out
}

/// Each model once, at most [`MAX_MODELS`]: a mod puts one model under every path the game has for
/// it (a tower's six, a courier's four, a tree set's dozen), and the same file shown six times in a
/// row says nothing. Two paths are one model when `read` gives the same bytes for both.
pub fn distinct(models: Vec<String>, read: &dyn Fn(&str) -> Option<Vec<u8>>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = models
        .into_iter()
        .filter(|m| read(&format!("{m}_c")).is_none_or(|b| seen.insert(crate::safe_zip::sha1_hex(&b))))
        .collect();
    out.truncate(MAX_MODELS);
    out
}

/// What the stage stands for a mod: its own models, else the category's in the game.
pub fn models_for<'a>(
    category: &str,
    mod_paths: impl Iterator<Item = &'a str>,
    npc_units: Option<&[u8]>,
) -> Vec<String> {
    let own = mod_models(mod_paths);
    if !own.is_empty() {
        return own;
    }
    if category == "pedestal" {
        return vec![PEDESTAL.to_string()];
    }
    let mut game = npc_units.map(|t| unit_models(t, units_of(category))).unwrap_or_default();
    game.extend(extras_of(category).iter().map(|m| m.to_string()));
    game
}

/// The animation a model is shown in: its idle, else its first, else none.
pub fn clip_of(model: Option<&[u8]>) -> Option<String> {
    let seqs = model_sequences(model);
    idle_sequence(&seqs).or_else(|| seqs.first().map(|s| s.name.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNITS: &str = r#""DOTAUnits"
{
	"npc_dota_roshan"
	{
		"BaseClass"		"npc_dota_roshan"
		"Model"		"models/creeps/roshan/roshan.vmdl"
		"AttackDamageMin"	"65"
	}
	"npc_dota_observer_wards"
	{
		"Model"		"models/props_gameplay/default_ward.vmdl"
	}
	"npc_dota_sentry_wards"
	{
		"Model"		"models/props_gameplay/default_ward.vmdl"
	}
}"#;

    #[test]
    fn a_units_model_is_read_from_its_own_block_once() {
        assert_eq!(unit_models(UNITS.as_bytes(), &["npc_dota_roshan"]), ["models/creeps/roshan/roshan.vmdl"]);
        // both wards wear one model: shown once
        assert_eq!(unit_models(UNITS.as_bytes(), units_of("wards")), ["models/props_gameplay/default_ward.vmdl"]);
        assert!(unit_models(UNITS.as_bytes(), &["npc_dota_nobody"]).is_empty());
    }

    #[test]
    fn a_mods_own_models_come_first_and_its_pieces_are_left_out() {
        let paths = [
            "models/props_gameplay/default_ward.vmdl_c",
            "models/props_structures/tower_good_destruction.vmdl_c",
            "materials/models/props_gameplay/ward_color.vtex_c",
            "models/courier/donkey/donkey_death.vmdl_c",
            "models/props_structures/default/radiant_tower002_dest_lvl1.vmdl_c",
        ];
        assert_eq!(
            models_for("wards", paths.into_iter(), Some(UNITS.as_bytes())),
            ["models/props_gameplay/default_ward.vmdl"]
        );
    }

    #[test]
    fn a_recolour_shows_the_games_models_of_its_category() {
        let paths = ["materials/models/creeps/roshan/roshan_color_png.vtex_c"];
        assert_eq!(
            models_for("roshan", paths.into_iter(), Some(UNITS.as_bytes())),
            ["models/creeps/roshan/roshan.vmdl"]
        );
        assert_eq!(models_for("pedestal", paths.into_iter(), None), [PEDESTAL]);
    }

    #[test]
    fn the_same_model_under_several_paths_is_shown_once_and_a_big_mod_is_cut_to_the_stages_room() {
        let paths: Vec<String> = (0..20).map(|i| format!("models/creeps/c{i:02}.vmdl_c")).collect();
        let models = mod_models(paths.iter().map(String::as_str));
        assert_eq!(models.len(), 20);
        // c00..c09 are one file, each of the rest its own
        let read = |p: &str| {
            let n: usize = p.trim_start_matches("models/creeps/c")[..2].parse().unwrap();
            Some(if n < 10 { b"same".to_vec() } else { format!("own{n}").into_bytes() })
        };
        let shown = distinct(models, &read);
        assert_eq!(shown.len(), MAX_MODELS);
        assert_eq!(shown[..3], ["models/creeps/c00.vmdl", "models/creeps/c10.vmdl", "models/creeps/c11.vmdl"]);
    }

    #[test]
    fn an_ancients_side_stands_together_and_the_rest_alone() {
        let models: Vec<String> = [
            "models/props_structures/good_ancient001.vmdl",
            "models/props_structures/dire_ancient_base001.vmdl",
            "models/props_structures/bad_ancient002.vmdl",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(
            groups_of("ancient", &models),
            [
                vec!["models/props_structures/good_ancient001.vmdl".to_string()],
                vec![
                    "models/props_structures/bad_ancient002.vmdl".to_string(),
                    "models/props_structures/dire_ancient_base001.vmdl".to_string()
                ],
            ]
        );
        assert_eq!(groups_of("creeps", &models).len(), 3);
    }

    #[test]
    fn a_body_plays_its_sides_effects_and_the_roots_the_mod_brings() {
        let mod_paths = [
            "particles/dire_fx/bad_ancient_ambient.vpcf_c",
            "kisilev/particles/dragon.vpcf_c",
            "particles/dire_fx/bad_ancient_child.vpcf_c",
            "particles/radiant_fx2/good_extra.vpcf_c",
        ];
        let has = |p: &str| p.starts_with("particles/");
        let named = |p: &str| {
            if p.contains("bad_ancient_ambient") {
                vec!["particles/dire_fx/bad_ancient_child.vpcf".to_string()]
            } else {
                vec![]
            }
        };
        let dire =
            effects_for("ancient", "models/props_structures/bad_ancient002.vmdl", mod_paths.into_iter(), &has, &named);
        assert_eq!(dire, ["particles/dire_fx/bad_ancient_ambient.vpcf"]);
        let radiant =
            effects_for("ancient", "models/props_structures/good_ancient001.vmdl", mod_paths.into_iter(), &has, &named);
        assert_eq!(
            radiant,
            ["particles/radiant_fx2/good_ancient001_ambient.vpcf", "particles/radiant_fx2/good_extra.vpcf"]
        );
        // a ward has no effect of the game's: only what its mod brings at the game's paths
        assert!(effects_for("wards", "models/props_gameplay/default_ward.vmdl", std::iter::empty(), &has, &named)
            .is_empty());
    }

    #[test]
    fn a_body_of_no_side_plays_one_sides_effects_and_no_hits() {
        let mod_paths = [
            "particles/neutral_fx/roshan_ambient.vpcf_c",
            "particles/neutral_fx/roshan_ambient_dire.vpcf_c",
            "particles/neutral_fx/roshan_hit.vpcf_c",
            "particles/neutral_fx/roshan_death.vpcf_c",
        ];
        let has = |p: &str| p.starts_with("particles/");
        let named = |_: &str| vec![];
        let got = effects_for("roshan", "models/creeps/roshan/roshan.vmdl", mod_paths.into_iter(), &has, &named);
        assert_eq!(got, ["particles/neutral_fx/roshan_ambient.vpcf"]);
        assert!(no_effects("tormentor") && !no_effects("roshan"));
    }

    /// The game's units name a model for every category (MM_TEST_PAK01: the game's pak01_dir.vpk).
    #[test]
    fn the_games_units_have_models_for_every_category() {
        let Ok(pak) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = crate::vpk::Index::open(std::path::Path::new(&pak)).unwrap();
        let units = ix.read("scripts/npc/npc_units.txt").unwrap().unwrap();
        for cat in ["wards", "creeps", "towers", "roshan", "ancient", "tormentor", "couriers"] {
            let models = unit_models(&units, units_of(cat));
            assert!(!models.is_empty(), "{cat}");
            for m in models {
                assert!(ix.has(&format!("{m}_c")), "{cat}: {m}");
            }
        }
    }
}
