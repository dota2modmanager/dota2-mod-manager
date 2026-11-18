//! A pick with an effect the person added, sewn into the hero's body (item_files.rs): the item's
//! mesh goes inside the body model (model_merge.rs), boxes made from the item's own vertices go in
//! the body as a hitbox set of that pick alone (model_hitboxes.rs), the added effect is copied to
//! spread over those boxes (particle_surface.rs, a scope per pick) and the body lists it among its
//! own particles. The item's points (attachments) go into the body under names of its own
//! (`mm_<token>_<name>`) and its particles are copied to look for them there: by the old names they
//! found the body's point of that name, and an arm's effect sat in the head. The item's stock path
//! is left with nothing to draw, so the item is not worn twice. Only a pick with an added effect goes this way: the others stay under their stock path.

use std::collections::HashSet;

use crate::particle_surface::{item_scope, scoped_system, Rework};

/// What a sewn item's points are renamed with: `mm_<token>_`.
pub fn point_prefix(token: &str) -> String {
    format!("mm_{token}_")
}

/// What sewing one pick in made: the body, the item's stock path emptied, and the effect's copies.
#[derive(Debug, Clone, PartialEq)]
pub struct Sewn {
    pub body: Vec<u8>,
    pub empty_item: Vec<u8>,
    pub files: Vec<(String, Vec<u8>)>,
}

/// Whether a model moves by itself: a clip of its own other than its bind pose, or cloth. Such a
/// wearable keeps its own model, its clips and its simulation, as dota-studio keeps an animated one
/// on its own runtime, and its effect is built on it there; inside the body it would stand still.
/// A model this cannot read counts as one that moves.
pub fn moves_by_itself(model: &[u8]) -> bool {
    let clips = match crate::mod_doctor::clips_of(model) {
        Ok(c) => c,
        Err(_) => return true,
    };
    clips.iter().any(|c| !c.name.eq_ignore_ascii_case("bind_pose") || !c.acts.is_empty())
        || crate::model_cloth::has_cloth(model)
}

/// Whether an added effect is a courier's (Ethereal Flame, Trail of Burning Doom, Touch of Frost:
/// its system is under particles/econ/courier/). A courier wears it on its whole body, and so does
/// the hero: it goes on the body's own particle list (and its mount's), as dota-studio puts every
/// such effect on the hero, and not on the item it was picked with.
pub fn on_hero(system: &str) -> bool {
    system.replace('\\', "/").to_lowercase().starts_with("particles/econ/courier/")
}

/// Whether an item's block (its table entry) says it has to stay a wearable of its own: an arcana,
/// or an item that changes the hero's motions (`activity`), its model or a summon's
/// (`entity_model`, `hero_model_change`), a persona, or swaps the particles of the attack and the
/// abilities (`particle`). Sewn into the body such an item broke in a match (a headless body, an
/// arm's effect in the head) while the lobby showed it whole.
pub fn stays_apart(block: &[u8]) -> bool {
    static RE: std::sync::OnceLock<regex::bytes::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::bytes::Regex::new(
            r#"(?i-u)"item_rarity"\s+"arcana"|"type"\s+"(activity|entity_model|hero_model_change|persona|particle)""#,
        )
        .unwrap()
    });
    re.is_match(block)
}

/// Whether a model has morphs of its own (MRPH): their controllers are the model's, and the body's
/// would not drive them. A model this cannot read counts as one that has.
fn has_morphs(model: &[u8]) -> bool {
    crate::resource::blocks(model).map_or(true, |b| b.iter().any(|b| b.name == "MRPH"))
}

/// The token a pick's scope goes by: its stock item and the path it is worn under, as 8 hex digits.
pub fn pick_token(id: &str, own: &str) -> String {
    format!("{:08x}", crc32fast::hash(format!("{id}\0{}", own.to_lowercase()).as_bytes()))
}

/// `item` (worn in material set `skin`) sewn into `body`, with `systems` its effects, of which the
/// ones in `added` (lowercased) spread over the item. None where a model cannot be read or joined,
/// or the item has no vertices of its own: the pick then keeps its effect on itself. So does an item
/// that moves by itself (a mount that flaps its wings, a cape), with its clips on its own model,
/// and one with morphs. The caller asks `stays_apart` of the item's block first.
pub fn sewn_into_body(
    body: &[u8],
    item: &[u8],
    skin: f64,
    systems: &[String],
    added: &HashSet<String>,
    token: &str,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Result<Option<Sewn>, String> {
    if moves_by_itself(item) || has_morphs(item) {
        return Ok(None);
    }
    // a set the model has not got leaves it in its own, as the game shows it
    let worn = if skin != 0.0 && !skin.is_nan() {
        crate::model_skin::with_skin(item, skin as usize).unwrap_or_else(|| item.to_vec())
    } else {
        item.to_vec()
    };
    let boxes = match crate::model_hitboxes::surface_boxes(&worn) {
        Ok(b) if !b.is_empty() => b,
        _ => return Ok(None),
    };
    let scope = item_scope(token);
    // the item's points under names of its own: the body's point of the same name would win
    let prefix = point_prefix(token);
    let (worn, renamed) = crate::model_attachments::namespaced(&worn, &prefix).unwrap_or((worn, HashSet::new()));
    let mut files = Vec::new();
    // the item's own ambients go with it: its key values do not come along into the body
    let mut all: Vec<String> =
        crate::model_particles::model_particle_entries(Some(&worn)).into_iter().map(|l| l.path).collect();
    for s in systems {
        if !all.iter().any(|a| a.eq_ignore_ascii_case(s)) {
            all.push(s.clone());
        }
    }
    let mut roots: Vec<String> = Vec::new();
    for s in &all {
        let rework =
            Rework { spread: added.contains(&s.to_lowercase()), body: Some((renamed.clone(), prefix.clone())) };
        let mut r = |p: &str| read(p);
        let copy = scoped_system(&mut r, s, &scope, &rework)?;
        let root = match copy {
            Some((root, made)) => {
                files.extend(made);
                root
            }
            None => s.clone(),
        };
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    let Some(joined) = crate::model_merge::merged_model(body, &worn).ok().flatten() else { return Ok(None) };
    let Some(boxed) = crate::model_hitboxes::with_hitbox_set(&joined, &scope.set, &boxes) else { return Ok(None) };
    let refs: Vec<&str> = roots.iter().map(String::as_str).collect();
    let Some(body) = crate::model_particles::with_more_particles(&boxed, &refs) else { return Ok(None) };
    let Some(empty_item) = crate::model_bodygroups::without_meshes(item)? else { return Ok(None) };
    Ok(Some(Sewn { body, empty_item, files }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Whether the game let an item roll an unusual (`"can roll unusual"` in its static attributes).
    fn rolls(block: &[u8]) -> bool {
        regex::bytes::Regex::new(r#"(?i-u)"can roll unusual"\s+(\{[^}]*"value"\s+)?"1""#).unwrap().is_match(block)
    }

    fn meshes(model: &[u8]) -> usize {
        let ctrl = crate::kv3::read(crate::resource::data(model, "CTRL", 0).unwrap()).unwrap();
        ctrl.root.get("embedded_meshes").map_or(0, |m| m.items().len())
    }

    /// On the game's own files (MM_TEST_PAK01 = a pak01_dir.vpk): an item that rolled an unusual,
    /// with Ethereal Flame, goes into its hero's body. The body has the item's meshes, keeps its own
    /// particles and lists the effect's copy, the copy reads the pick's set, and the item's path draws nothing.
    #[test]
    fn on_the_games_own_files() {
        let Ok(pak) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = crate::vpk::Index::open(std::path::Path::new(&pak)).unwrap();
        let read = |p: &str| ix.read(p).ok().flatten();
        let text = read(crate::schema::SCHEMA_REL).unwrap();
        let flame =
            crate::unusual_effects::effects_of(&text).unwrap().iter().find(|e| e.id == 15.0).unwrap().system.clone();
        let mut tried = 0;
        let rolled: Vec<_> = crate::schema::items_of(&text)
            .unwrap()
            .iter()
            .filter(|i| !i.model.is_empty() && rolls(&text[i.start..i.end]))
            .cloned()
            .collect();
        // a model that only has its bind pose is sewn in; one with a motion of its own or cloth is not
        let moving: Vec<String> = rolled
            .iter()
            .filter(|i| read(&format!("{}_c", i.model)).is_some_and(|m| moves_by_itself(&m)))
            .map(|i| i.model.clone())
            .collect();
        eprintln!("{} items rolled an unusual, {} of them move by themselves", rolled.len(), moving.len());
        assert!(moving.contains(&"models/items/batrider/owl_rider_mount_v1/owl_rider_mount_v1.vmdl".to_string()));
        let still = "models/items/troll_warlord/the_icewrack_marauder_weapon/the_icewrack_marauder_weapon.vmdl";
        assert!(!moving.contains(&still.to_string()), "a bind pose alone is no motion");
        let owl = read("models/items/batrider/owl_rider_mount_v1/owl_rider_mount_v1.vmdl_c").unwrap();
        let bat = read("models/heroes/batrider/batrider.vmdl_c").unwrap();
        let fire: HashSet<String> = [flame.to_lowercase()].into();
        let kept = sewn_into_body(&bat, &owl, 0.0, std::slice::from_ref(&flame), &fire, "ab12", &read).unwrap();
        assert_eq!(kept, None, "the owl keeps its wings flapping on its own model");
        for item in crate::schema::items_of(&text).unwrap().iter() {
            if item.model.is_empty() || !rolls(&text[item.start..item.end]) {
                continue;
            }
            let heroes = crate::item_builder_slots::item_heroes(&text, item.start).unwrap();
            let [hero] = heroes.as_slice() else { continue };
            let Ok(model) = crate::item_builder_assets::hero_model_path(&read, hero) else { continue };
            let (Some(body), Some(worn)) = (read(&format!("{model}_c")), read(&format!("{}_c", item.model))) else {
                continue;
            };
            tried += 1;
            let own = crate::model_particles::model_particle_entries(Some(&body));
            let added: HashSet<String> = [flame.to_lowercase()].into();
            let token = pick_token(&item.id, &item.model);
            let Some(sewn) =
                sewn_into_body(&body, &worn, 0.0, std::slice::from_ref(&flame), &added, &token, &read).unwrap()
            else {
                continue;
            };
            assert_eq!(meshes(&sewn.body), meshes(&body) + meshes(&worn), "{}", item.model);
            let listed: Vec<String> =
                crate::model_particles::model_particle_entries(Some(&sewn.body)).into_iter().map(|l| l.path).collect();
            assert!(own.iter().all(|o| listed.contains(&o.path)), "the body keeps its own particles");
            let root = format!("particles/mm_fx/{token}/");
            assert!(listed.iter().any(|p| p.starts_with(&root)), "{listed:?}");
            assert!(!sewn.files.is_empty() && sewn.files.iter().all(|(p, _)| p.starts_with(&root)));
            let copy = &sewn.files.iter().find(|(p, _)| listed.iter().any(|l| format!("{l}_c") == *p)).unwrap().1;
            let kv = crate::kv3::read(crate::resource::data(copy, "DATA", 0).unwrap()).unwrap();
            let set = format!("mm_fx_{token}");
            let reads = kv
                .root
                .get("m_Initializers")
                .unwrap()
                .items()
                .iter()
                .any(|op| op.get("m_HitboxSetName").and_then(crate::kv3::Node::as_str) == Some(set.as_str()));
            assert!(reads, "the copy reads the pick's own set");
            let data = crate::kv3::read(crate::resource::data_block(&sewn.empty_item).unwrap()).unwrap();
            let mask = data.root.get("m_nDefaultMeshGroupMask").and_then(|n| data.number_of(n));
            assert_eq!(mask, Some(0.0), "the item's own path draws nothing");
            eprintln!("sewn {} into {model} after {tried} tried", item.model);
            return;
        }
        panic!("no item that rolled an unusual went into its hero's body ({tried} tried)");
    }

    /// Every attachment name of every mesh of a model.
    fn points(model: &[u8]) -> Vec<String> {
        let n = crate::resource::blocks(model).unwrap().iter().filter(|b| b.name == "MDAT").count();
        (0..n)
            .flat_map(|i| {
                let kv = crate::kv3::read(crate::resource::data(model, "MDAT", i).unwrap()).unwrap();
                kv.root
                    .get("m_attachments")
                    .map(|a| {
                        a.items()
                            .iter()
                            .filter_map(|x| x.get("key")?.as_str().map(String::from))
                            .collect::<Vec<String>>()
                    })
                    .unwrap_or_default()
            })
            .collect()
    }

    /// The attachment names a system's control point drivers name.
    fn driven(system: &[u8]) -> Vec<String> {
        let kv = crate::kv3::read(crate::resource::data(system, "DATA", 0).unwrap()).unwrap();
        let configs = kv.root.get("m_controlPointConfigurations").map(|c| c.items().to_vec()).unwrap_or_default();
        configs
            .iter()
            .flat_map(|c| c.get("m_drivers").map(|d| d.items().to_vec()).unwrap_or_default())
            .filter_map(|d| d.get("m_attachmentName")?.as_str().map(String::from))
            .filter(|n| !n.is_empty())
            .collect()
    }

    /// On the game's own files (MM_TEST_PAK01): an item whose own particle hangs on a point of its
    /// own goes into the body with that point under a name of its own, and the particle's copy looks
    /// for it by that name, not for the body's point of the old name.
    #[test]
    fn an_items_own_effect_keeps_its_own_point_in_the_body() {
        let Ok(pak) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = crate::vpk::Index::open(std::path::Path::new(&pak)).unwrap();
        let read = |p: &str| ix.read(p).ok().flatten();
        let text = read(crate::schema::SCHEMA_REL).unwrap();
        for item in crate::schema::items_of(&text).unwrap().iter() {
            if item.model.is_empty() {
                continue;
            }
            let Some(worn) = read(&format!("{}_c", item.model.to_lowercase())) else { continue };
            let own = crate::model_particles::model_particle_entries(Some(&worn));
            let mine: HashSet<String> = points(&worn).iter().map(|p| p.to_lowercase()).collect();
            // a particle of its list that hangs on one of its points
            let Some(system) = own.iter().find(|l| {
                read(&format!("{}_c", l.path))
                    .is_some_and(|s| driven(&s).iter().any(|d| mine.contains(&d.to_lowercase())))
            }) else {
                continue;
            };
            let heroes = crate::item_builder_slots::item_heroes(&text, item.start).unwrap();
            let [hero] = heroes.as_slice() else { continue };
            let Ok(model) = crate::item_builder_assets::hero_model_path(&read, hero) else { continue };
            let Some(body) = read(&format!("{model}_c")) else { continue };
            let token = pick_token(&item.id, &item.model);
            let Some(sewn) = sewn_into_body(&body, &worn, 0.0, &[], &HashSet::new(), &token, &read).unwrap() else {
                continue;
            };
            let prefix = point_prefix(&token);
            let named = points(&sewn.body);
            assert!(named.iter().any(|p| p.starts_with(&prefix)), "the body has the item's points: {named:?}");
            let copy = format!("particles/mm_fx/{token}/{}_c", system.path.trim_start_matches("particles/"));
            let made = &sewn.files.iter().find(|(p, _)| *p == copy).unwrap_or_else(|| panic!("{copy} not copied")).1;
            let drives = driven(made);
            assert!(drives.iter().any(|d| d.starts_with(&prefix)), "{drives:?}");
            assert!(!drives.iter().any(|d| mine.contains(&d.to_lowercase())), "an old name is left: {drives:?}");
            let listed = crate::model_particles::model_particle_entries(Some(&sewn.body));
            assert!(listed.iter().any(|l| format!("{}_c", l.path) == copy), "the body lists the copy");
            eprintln!("{} into {model}: {} by {drives:?}", item.model, system.path);
            return;
        }
        panic!("no item with an effect on a point of its own went into a body");
    }

    #[test]
    fn an_arcana_or_an_item_that_changes_the_hero_stays_a_wearable_of_its_own() {
        let modifier = |ty: &str| {
            format!("\"1\"\n{{\n\t\"visuals\"\n\t{{\n\t\t\"asset_modifier\"\n\t\t{{\n\t\t\t\"type\"\t\t\"{ty}\"\n\t\t}}\n\t}}\n}}")
        };
        for ty in ["activity", "entity_model", "hero_model_change", "persona", "particle", "ACTIVITY"] {
            assert!(stays_apart(modifier(ty).as_bytes()), "{ty}");
        }
        for ty in ["particle_create", "model_skin", "additional_wearable", "ability_icon"] {
            assert!(!stays_apart(modifier(ty).as_bytes()), "{ty}");
        }
        assert!(stays_apart(b"\"1\"\n{\n\t\"item_rarity\"\t\t\"arcana\"\n}"));
        assert!(!stays_apart(b"\"1\"\n{\n\t\"item_rarity\"\t\t\"immortal\"\n}"));
    }

    /// On the game's own files (MM_TEST_PAK01): the Dead Heat Coronet asks for material set 2 of a
    /// model with no sets at all. It keeps the effect, in the model's own look; the set it could
    /// not take dropped the effect once, and the item went to a match bare.
    #[test]
    fn a_set_the_model_has_not_got_keeps_the_effect() {
        let Ok(pak) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = crate::vpk::Index::open(std::path::Path::new(&pak)).unwrap();
        let model = ix.read("models/items/lina/lina_calavera/lina_calavera_head.vmdl_c").unwrap().unwrap();
        assert!(crate::model_skin::with_skin(&model, 2).is_none(), "the model has no set 2");
        let worn = crate::item_files::worn_model(&model, 2.0, &["particles/mm_fx/ab12/x.vpcf"], "mm_fx_ab12").unwrap();
        let listed = crate::model_particles::model_particle_entries(Some(&worn));
        assert!(listed.iter().any(|l| l.path == "particles/mm_fx/ab12/x.vpcf"), "{listed:?}");
    }

    /// On the game's own files (MM_TEST_PAK01): the Arms of Desolation, whose effect sat
    /// in the head once sewn in, changes the hero's motions and stays apart.
    #[test]
    fn arms_of_desolation_stay_apart() {
        let Ok(pak) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = crate::vpk::Index::open(std::path::Path::new(&pak)).unwrap();
        let text = ix.read(crate::schema::SCHEMA_REL).unwrap().unwrap();
        let items = crate::schema::items_of(&text).unwrap();
        let arms = items.iter().find(|i| crate::schema::to_utf8(&i.name) == "Arms of Desolation").unwrap();
        assert!(stays_apart(&text[arms.start..arms.end]));
    }

    #[test]
    fn a_couriers_effect_goes_on_the_hero_and_a_seasonal_one_on_the_item() {
        assert!(on_hero("particles/econ/courier/courier_trail_lava/courier_trail_lava.vpcf"));
        assert!(on_hero("particles\\econ\\courier\\courier_roshan_frost\\courier_roshan_frost_ambient.vpcf"));
        assert!(on_hero("PARTICLES/econ/courier/courier_trail_01/courier_trail_01.vpcf"));
        assert!(!on_hero("particles/econ/seasonal/seasonal_ambient_silver.vpcf"));
        assert!(!on_hero("particles/econ/items/lina/lina_revenants_cinder/lina_revenants_cinder_head_ambient.vpcf"));
    }

    #[test]
    fn a_picks_token_is_its_own_and_steady() {
        let a = pick_token("8001", "models/heroes/x/x_head.vmdl_c");
        assert_eq!(a, pick_token("8001", "MODELS/heroes/x/x_head.vmdl_c"));
        assert_ne!(a, pick_token("8002", "models/heroes/x/x_head.vmdl_c"));
        assert!(a.len() == 8 && a.bytes().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn a_file_that_is_not_a_model_is_left_to_the_old_way() {
        let read = |_: &str| None;
        let made = sewn_into_body(b"body", b"item", 0.0, &[], &HashSet::new(), "ab12", &read).unwrap();
        assert_eq!(made, None);
    }
}
