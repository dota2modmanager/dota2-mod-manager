//! A pick with an effect the person added, sewn into the hero's body (item_files.rs): the item's
//! mesh goes inside the body model (model_merge.rs), boxes made from the item's own vertices go in
//! the body as a hitbox set of that pick alone (model_hitboxes.rs), the added effect is copied to
//! spread over those boxes (particle_surface.rs, a scope per pick) and the body lists it among its
//! own particles. The item's stock path is left with nothing to draw, so the item is not worn
//! twice. Only a pick with an added effect goes this way: the others stay under their stock path.

use std::collections::HashSet;

use crate::particle_surface::{item_scope, surface_system_in};

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

/// The token a pick's scope goes by: its stock item and the path it is worn under, as 8 hex digits.
pub fn pick_token(id: &str, own: &str) -> String {
    format!("{:08x}", crc32fast::hash(format!("{id}\0{}", own.to_lowercase()).as_bytes()))
}

/// `item` (worn in material set `skin`) sewn into `body`, with `systems` its effects, of which the
/// ones in `added` (lowercased) spread over the item. None where a model cannot be read or joined,
/// or the item has no vertices of its own: the pick then keeps its effect on itself. So does an item
/// that moves by itself (a mount that flaps its wings, a cape), with its clips on its own model.
pub fn sewn_into_body(
    body: &[u8],
    item: &[u8],
    skin: f64,
    systems: &[String],
    added: &HashSet<String>,
    token: &str,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Result<Option<Sewn>, String> {
    if moves_by_itself(item) {
        return Ok(None);
    }
    let worn = if skin != 0.0 && !skin.is_nan() {
        match crate::model_skin::with_skin(item, skin as usize) {
            Some(w) => w,
            None => return Ok(None),
        }
    } else {
        item.to_vec()
    };
    let boxes = match crate::model_hitboxes::surface_boxes(&worn) {
        Ok(b) if !b.is_empty() => b,
        _ => return Ok(None),
    };
    let scope = item_scope(token);
    let mut files = Vec::new();
    // the item's own ambients go with it: its key values do not come along into the body
    let mut roots: Vec<String> =
        crate::model_particles::model_particle_entries(Some(&worn)).into_iter().map(|l| l.path).collect();
    for s in systems {
        let copy = if added.contains(&s.to_lowercase()) {
            let mut r = |p: &str| read(p);
            surface_system_in(&mut r, s, &scope)?
        } else {
            None
        };
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
            .filter(|i| !i.model.is_empty() && crate::unusual_fit::can_roll_unusual(&text[i.start..i.end]))
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
            if item.model.is_empty() || !crate::unusual_fit::can_roll_unusual(&text[item.start..item.end]) {
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
