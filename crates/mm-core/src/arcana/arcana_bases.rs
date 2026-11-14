//! Arcana bases (src/arcana-bases.ts): an arcana rebuilt by hand so it works as the hero's own
//! look. Which base a set of picks puts on, and how its files share the hero with the user's
//! other picks: a pick of another item wins over the base, a pick of one of the set's own parts
//! leaves the base's paths to the base.

use crate::arcana_notes::ArcanaBase;
use crate::item_builder_personas::ReadyBase;
use crate::vpk::Entry;

/// The Terrorblade base, which the arcana window builds in the user's colour.
pub const TERRORBLADE_BASE: &str = "fractal_horns_of_inner_abysm";

/// A pick as the builder keeps it: the item and its style.
#[derive(Debug, Clone)]
pub struct BasePick {
    pub item_id: String,
    pub style: u64,
}

/// The bases a set of picks puts on, at most one per hero, in the order of the picks.
pub fn choose_bases<'a>(picks: &[BasePick], bases: &'a [ArcanaBase]) -> Vec<&'a ArcanaBase> {
    let picked: std::collections::HashSet<&str> = picks.iter().map(|p| p.item_id.as_str()).collect();
    let mut out: Vec<&ArcanaBase> = Vec::new();
    for pick in picks {
        let mut fit: Vec<&ArcanaBase> = bases
            .iter()
            .filter(|b| {
                b.item == pick.item_id
                    && b.styles.as_ref().is_none_or(|s| s.contains(&pick.style))
                    && b.requires.iter().flatten().all(|r| picked.contains(r.as_str()))
            })
            .collect();
        // most requirements first; a stable sort keeps the table's order between equals
        fit.sort_by_key(|b| std::cmp::Reverse(b.requires.as_ref().map_or(0, Vec::len)));
        if let Some(best) = fit.first() {
            if !out.iter().any(|b| b.hero == best.hero) {
                out.push(best);
            }
        }
    }
    out
}

/// Where a build reads bases from (src/arcana-base-store.ts): the files of one that is here, and
/// a wish for one (fetched or refreshed in the background).
pub trait BaseSource {
    fn entries(&self, id: &str) -> Option<Vec<Entry>>;
    fn want(&self, id: &str);
}

/// The bases a set of picks puts on that are here. One that is not is asked for, and the build
/// goes on from the game's files.
pub fn bases_here(picks: &[BasePick], store: &dyn BaseSource, log: &mut dyn FnMut(String)) -> Vec<ReadyBase> {
    let mut out = Vec::new();
    for base in choose_bases(picks, crate::data::arcana_bases()) {
        let entries = store.entries(&base.id);
        store.want(&base.id);
        match entries {
            Some(e) => out.push(ReadyBase::new(base.clone(), e)),
            None => log(format!(
                "schema: the arcana base {} is not here yet; built from the game's files until it is",
                base.id
            )),
        }
    }
    out
}

/// A pick's own files without the ones a base of its set provides.
pub fn without_base_files(item_id: &str, assets: Vec<Entry>, ready: &[ReadyBase]) -> Vec<Entry> {
    let own: Vec<&ReadyBase> = ready.iter().filter(|r| r.base.parts.iter().any(|p| p == item_id)).collect();
    if own.is_empty() {
        return assets;
    }
    assets.into_iter().filter(|e| !own.iter().any(|r| r.paths.contains(&e.path().to_lowercase()))).collect()
}

/// A base's files with each model numbered as the game's model at its path
/// (src/model-attachments.ts entriesAttachedAs): online the server tells attachments by number.
pub fn entries_attached_as(entries: Vec<Entry>, read: &dyn Fn(&str) -> Option<Vec<u8>>) -> Vec<Entry> {
    entries
        .into_iter()
        .map(|e| {
            let p = e.path();
            let Some(plain) = p.ends_with(".vmdl_c").then(|| read(&p)).flatten() else { return e };
            let fixed = crate::model_attachments::attached_as(&e.data, &plain);
            if *fixed == *e.data {
                e
            } else {
                crate::vpk::entry_at(&p, fixed.into())
            }
        })
        .collect()
}

/// The arcana bases of a build with their models numbered as the game's (basesAttachedSteps).
pub fn bases_attached(ready: Vec<ReadyBase>, read: &dyn Fn(&str) -> Option<Vec<u8>>) -> Vec<ReadyBase> {
    ready
        .into_iter()
        .map(|r| {
            let entries = entries_attached_as(r.entries, read);
            ReadyBase { base: r.base, paths: r.paths, entries }
        })
        .collect()
}
