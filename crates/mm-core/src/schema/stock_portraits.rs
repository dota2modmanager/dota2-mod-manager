//! Hero pictures as Valve drew them, whatever the hero wears: the `heroPortraitsStock` setting.
//!
//! An arcana or a persona changes the hero's picture in the pick grid, the top bar and the
//! scoreboard. The game does it from the item's `icon_replacement_hero` modifier, and the item
//! builder copies the item's picture over the plain one as well (PICTURES in
//! item_builder_assets.rs). Someone who wants the look in the match but the grid they know asks
//! for neither, so both go: the modifier out of every block, the copies out of the files. The
//! minimap's icon stays, it is the hero on the map and not a portrait.

use crate::kv::{self, KvError};
use crate::schema::schema_build::Built;

/// The modifier the game swaps the hero's picture by.
const MODIFIER: &[u8] = b"icon_replacement_hero";

/// A file the builder writes as the hero's picture: panorama/images/heroes/ and its selection
/// folder, not its minimap icons.
pub fn is_portrait(path: &str) -> bool {
    let p = path.to_ascii_lowercase().replace('\\', "/");
    p.starts_with("panorama/images/heroes/") && !p.starts_with("panorama/images/heroes/icons/")
}

/// An item block without the asset modifiers that swap the hero's picture.
pub fn without_portrait_swaps(block: &[u8]) -> Result<Vec<u8>, KvError> {
    let root = kv::block_bounds(block, 0)?;
    let Some(visuals) =
        kv::children(block, root)?.into_iter().find(|c| c.is_block() && c.key.eq_ignore_ascii_case(b"visuals"))
    else {
        return Ok(block.to_vec());
    };
    let mut cut = Vec::new();
    for c in kv::children(block, visuals.body.expect("a block"))? {
        let Some(body) = c.body else { continue };
        // "asset_modifier" and "asset_modifier0".."N": the table has both
        if !c.key.to_ascii_lowercase().starts_with(b"asset_modifier") {
            continue;
        }
        let swaps_picture = kv::children(block, body)?
            .iter()
            .any(|f| f.key.eq_ignore_ascii_case(b"type") && f.value.is_some_and(|v| v.eq_ignore_ascii_case(MODIFIER)));
        if swaps_picture {
            cut.push((c.start, c.end));
        }
    }
    let mut out = block.to_vec();
    for (start, end) in cut.into_iter().rev() {
        out.drain(start..end);
    }
    Ok(out)
}

/// The build with Valve's hero pictures kept: no block swaps them, no file covers them.
pub fn keep_stock_portraits(built: &mut Built) -> Result<(), String> {
    for p in built.list.iter_mut() {
        p.block = without_portrait_swaps(&p.block).map_err(|e| e.to_string())?;
        if let Some(assets) = p.assets.as_mut() {
            assets.retain(|e| !is_portrait(&e.path()));
        }
    }
    built.beneath.retain(|e| !is_portrait(&e.path()));
    // the picks' own pak, when the table is off, is made from these
    built.files_shared.entries.retain(|e| !is_portrait(&e.path()));
    built.files_shared.paths.retain(|p| !is_portrait(p));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::schema_build::{FilesShared, TablePatch};
    use crate::vpk::Entry;

    #[test]
    fn the_picture_swap_goes_and_everything_else_stays() {
        let block = b"\"9000\"\n{\n\t\"name\" \"x\"\n\t\"visuals\"\n\t{\n\t\t\"asset_modifier0\"\n\t\t{\n\t\t\t\"type\" \"icon_replacement_hero\"\n\t\t\t\"asset\" \"npc_dota_hero_pudge\"\n\t\t\t\"modifier\" \"npc_dota_hero_pudge_persona\"\n\t\t}\n\t\t\"asset_modifier1\"\n\t\t{\n\t\t\t\"type\" \"icon_replacement_hero_minimap\"\n\t\t\t\"asset\" \"npc_dota_hero_pudge\"\n\t\t\t\"modifier\" \"npc_dota_hero_pudge_persona\"\n\t\t}\n\t\t\"asset_modifier2\"\n\t\t{\n\t\t\t\"type\" \"entity_model\"\n\t\t\t\"asset\" \"npc_dota_hero_pudge\"\n\t\t\t\"modifier\" \"models/x.vmdl\"\n\t\t}\n\t}\n}\n";
        let out = String::from_utf8(without_portrait_swaps(block).unwrap()).unwrap();
        assert!(!out.contains("\"icon_replacement_hero\""), "{out}");
        assert!(out.contains("icon_replacement_hero_minimap"));
        assert!(out.contains("entity_model"));
        assert!(kv::block_bounds(out.as_bytes(), 0).is_ok(), "still one block: {out}");
    }

    #[test]
    fn only_the_portraits_count_as_portraits() {
        assert!(is_portrait("panorama/images/heroes/npc_dota_hero_pudge_png.vtex_c"));
        assert!(is_portrait("panorama/images/heroes/selection/npc_dota_hero_pudge_png.vtex_c"));
        assert!(!is_portrait("panorama/images/heroes/icons/npc_dota_hero_pudge_png.vtex_c"));
        assert!(!is_portrait("panorama/images/spellicons/pudge_meat_hook_png.vtex_c"));
    }

    fn entry(path: &str) -> Entry {
        let (folder, file) = path.rsplit_once('/').unwrap();
        let (name, ext) = file.rsplit_once('.').unwrap();
        Entry {
            ext: ext.into(),
            folder: folder.into(),
            name: name.into(),
            crc: 0,
            preload: Default::default(),
            data: Default::default(),
        }
    }

    #[test]
    fn a_build_keeps_no_portrait_anywhere_and_every_other_file() {
        let portrait = "panorama/images/heroes/npc_dota_hero_juggernaut_png.vtex_c";
        let selection = "panorama/images/heroes/selection/npc_dota_hero_juggernaut_png.vtex_c";
        let icon = "panorama/images/heroes/icons/npc_dota_hero_juggernaut_png.vtex_c";
        let model = "models/heroes/juggernaut/juggernaut_arcana.vmdl_c";
        let block = b"\"9059\"
{
	\"visuals\"
	{
		\"asset_modifier\"
		{
			\"type\" \"icon_replacement_hero\"
			\"asset\" \"npc_dota_hero_juggernaut\"
			\"modifier\" \"npc_dota_hero_juggernaut_alt1\"
		}
	}
}
";
        let mut built = Built {
            list: vec![TablePatch::of(block, vec![entry(portrait), entry(selection), entry(icon), entry(model)])],
            beneath: vec![entry(portrait), entry(model)],
            files_shared: FilesShared {
                paths: vec![selection.into(), model.into()],
                entries: vec![entry(selection), entry(model)],
            },
        };
        keep_stock_portraits(&mut built).unwrap();
        let paths = |v: &[Entry]| v.iter().map(Entry::path).collect::<Vec<_>>();
        assert_eq!(paths(built.list[0].assets.as_deref().unwrap()), vec![icon.to_string(), model.to_string()]);
        assert_eq!(paths(&built.beneath), vec![model.to_string()]);
        assert_eq!(paths(&built.files_shared.entries), vec![model.to_string()]);
        assert_eq!(built.files_shared.paths, vec![model.to_string()]);
        assert!(!String::from_utf8_lossy(&built.list[0].block).contains("icon_replacement_hero"));
    }

    #[test]
    fn a_block_without_visuals_comes_back_as_it_was() {
        let block = b"\"1\"\n{\n\t\"name\" \"x\"\n}\n";
        assert_eq!(without_portrait_swaps(block).unwrap(), block.to_vec());
    }
}
