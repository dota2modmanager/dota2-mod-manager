//! The item builder's offer, replacing src/item-builder-slots.ts and the slot-making halves of
//! src/item-builder-personas.ts and src/item-builder-ability-fx.ts: for each hero, the slots it
//! can dress, the paid wearables that fit each one, a persona's own slots, and the hidden ability
//! effects slots.
//!
//! Written by h6rd (https://github.com/h6rd) in #117, developed further with TheFleece
//! (https://github.com/TheFleece).
//! Copyright (C) 2026 h6rd
//! Copyright (C) 2026 TheFleece
//! SPDX-License-Identifier: GPL-3.0-or-later
//! The additional terms in NOTICE apply: whoever carries this code keeps both names here and in
//! the credits of the program it goes into.

use indexmap::IndexMap;
use regex::bytes::Regex;
use serde::Serialize;
use serde_json::json;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

use crate::arcana_notes::{item_note, until_reconnect, ArcanaBase, ItemNote};
use crate::data;
use crate::hero_names::display_name;
use crate::i18n::t;
use crate::item_builder_ability_fx::{fx_slot_of, fx_slots_of, fx_target};
use crate::item_builder_details::item_facts;
use crate::item_builder_donor::has_own_effect;
use crate::item_builder_styles::style_tokens;
use crate::js::locale_compare;
use crate::kv::{self, KvError};
use crate::schema::{inferred_item_slot, items_of, to_utf8, SchemaItem};

/// One paid item a slot offers.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SlotOption {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rarity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub styles: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<ItemNote>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fx: Option<bool>,
}

/// A persona's slot: `part` false where the persona is picked.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PersonaOf {
    pub hero: String,
    pub part: bool,
}

/// A slot of a hero the builder can dress, and the paid items that fit it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSlot {
    pub slot: String,
    pub kind: &'static str,
    pub base: String,
    pub target_id: String,
    pub equip_slot: String,
    pub hero_ids: Vec<String>,
    pub hero_label: String,
    pub slot_label: String,
    pub label: String,
    pub icon: &'static str,
    pub options: Vec<SlotOption>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persona: Option<PersonaOf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ability_fx: Option<u64>,
}

fn label_of(slot: &str) -> Option<&'static str> {
    Some(match slot {
        "head" => "голова",
        "body_head" => "голова (2)",
        "hair" => "волосы",
        "weapon" => "оружие",
        "offhand" => "оружие (2)",
        "offhand_weapon" => "доп. оружие",
        "shield" => "щит",
        "armor" => "броня",
        "shoulder" | "shoulders" => "плечи",
        "neck" => "шея",
        "belt" => "пояс",
        "arm" | "arms" => "руки",
        "gloves" => "перчатки",
        "back" => "спина",
        "wings" => "крылья",
        "tail" => "хвост",
        "legs" => "ноги",
        "mount" => "ездовое",
        "costume" => "костюм",
        "misc" => "разное",
        "ambient" | "ambient_effects" => "эффекты",
        "ability1" => "способность 1",
        "ability2" => "способность 2",
        "ability3" => "способность 3",
        "ability4" => "способность 4",
        "ability_ultimate" => "ультимейт",
        "summon" => "призыв",
        "voice" => "голос",
        "shapeshift" => "форма",
        "hero_base" => "база героя",
        "persona_selector" => "персона",
        _ => return None,
    })
}

const SLOT_ORDER: [&str; 33] = [
    "persona_selector",
    "head",
    "body_head",
    "hair",
    "neck",
    "shoulder",
    "shoulders",
    "arm",
    "arms",
    "gloves",
    "back",
    "weapon",
    "offhand",
    "offhand_weapon",
    "shield",
    "armor",
    "belt",
    "legs",
    "mount",
    "wings",
    "tail",
    "costume",
    "ambient",
    "ambient_effects",
    "ability1",
    "ability2",
    "ability3",
    "ability4",
    "ability_ultimate",
    "summon",
    "voice",
    "shapeshift",
    "misc",
];

fn order_of(slot: &str) -> usize {
    if let Some(i) = SLOT_ORDER.iter().position(|s| *s == slot) {
        return i;
    }
    match slot.strip_prefix("ability_effects_") {
        Some(d) if d.len() == 1 && (b'1'..=b'9').contains(&d.as_bytes()[0]) => {
            SLOT_ORDER.len() + (d.as_bytes()[0] - b'1') as usize
        }
        _ => 999,
    }
}

/// A hero id as the builder keys its slots: no npc_dota_hero_ prefix, lower case, Io as wisp.
pub fn canonical_hero_id(hero: &str) -> String {
    let lower = hero.to_lowercase();
    let clean = lower.strip_prefix("npc_dota_hero_").unwrap_or(&lower);
    if clean == "io" {
        "wisp".into()
    } else {
        clean.to_string()
    }
}

/// A slot name as the table writes it, lower-cased.
pub fn canonical_item_slot(slot: &str) -> String {
    slot.to_lowercase()
}

/// A slot name with its aliases folded together (offhand_weapon is offhand, shoulder is shoulders).
pub fn match_item_slot(slot: &str) -> String {
    let clean = canonical_item_slot(slot);
    match clean.as_str() {
        "offhand_weapon" | "offhand" => "offhand".into(),
        "shoulder" | "shoulders" => "shoulders".into(),
        "arm" | "arms" => "arms".into(),
        _ => clean,
    }
}

/// A builder slot's id: its heroes and its slot, item:pudge:weapon.
pub fn item_slot_id(hero_ids: &[String], slot: &str) -> String {
    format!("item:{}:{slot}", hero_ids.join("+"))
}

fn title_label(s: &str) -> String {
    let mut c = s.chars();
    c.next().map_or(String::new(), |f| f.to_uppercase().collect::<String>() + c.as_str())
}

/// A slot's name for an ability effects slot, before the hero's script names its ability.
pub fn fx_slot_label(n: u64) -> String {
    t("Эффекты способности {0}", &[json!(n)])
}

/// A slot's name as a tile says it, in the user's language: "Оружие".
pub fn slot_display_label(slot: &str) -> String {
    let equip = canonical_item_slot(slot);
    let fx = fx_slot_of(&equip);
    if fx != 0 {
        return fx_slot_label(fx);
    }
    title_label(&match label_of(&equip) {
        Some(ru) => t(ru, &[]),
        None => t(&equip.replace('_', " "), &[]),
    })
}

/// A slot's name with its heroes ahead of it: "Pudge · Оружие".
pub fn item_slot_label(hero_ids: &[String], slot: &str) -> String {
    let heroes: Vec<String> = hero_ids.iter().map(|id| display_name(&canonical_hero_id(id))).collect();
    format!("{} · {}", heroes.join(" / "), slot_display_label(slot))
}

fn search_text(item: &SchemaItem) -> String {
    [
        &item.slot,
        &item.prefab,
        &item.name,
        &item.item_name,
        &item.item_description,
        &item.image,
        &item.model,
        &item.type_name,
    ]
    .iter()
    .filter(|s| !s.is_empty())
    .map(|s| s.as_str())
    .collect::<Vec<_>>()
    .join(" ")
    .to_lowercase()
}

/// A persona's slot: weapon_persona_1 is the first persona's weapon. (part, number)
fn own_slot(slot: &str) -> Option<(&str, &str)> {
    let at = slot.rfind("_persona_")?;
    let (part, n) = (&slot[..at], &slot[at + 9..]);
    (!part.is_empty() && !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit())).then_some((part, n))
}

/// A persona, by its name or its slot: the plain hero's slots leave these out.
pub fn is_persona_item(item: &SchemaItem) -> bool {
    let slot = canonical_item_slot(&inferred_item_slot(item));
    search_text(item).contains("persona") || slot == "persona_selector" || own_slot(&slot).is_some()
}

/// The icon a slot's tile shows while nothing in it has a picture.
pub fn item_slot_icon(slot: &str) -> &'static str {
    if fx_slot_of(slot) != 0 {
        return "auto_awesome";
    }
    match canonical_item_slot(slot).as_str() {
        "head" | "body_head" => "face",
        "hair" => "content_cut",
        "neck" | "belt" | "back" | "costume" | "misc" => "checkroom",
        "weapon" => "swords",
        "offhand" | "offhand_weapon" | "shield" => "shield",
        "armor" => "security",
        "shoulder" | "shoulders" => "accessibility_new",
        "arm" | "arms" | "gloves" => "front_hand",
        "wings" => "flutter_dash",
        "tail" => "gesture",
        "legs" => "directions_run",
        "mount" | "summon" | "shapeshift" => "pets",
        "ambient" | "ambient_effects" => "auto_awesome",
        "ability1" | "ability2" | "ability3" | "ability4" => "auto_fix_high",
        "ability_ultimate" => "flash_on",
        "voice" => "mic",
        "persona_selector" => "theater_comedy",
        _ => "checkroom",
    }
}

/// An item's visuals block, as bytes; None when it has none.
fn visuals_of(text: &[u8], start: usize) -> Result<Option<&[u8]>, KvError> {
    let mut out = None;
    kv::each_child(text, kv::block_bounds(text, start)?, |c| {
        if c.is_block() && c.key.eq_ignore_ascii_case(b"visuals") {
            out = Some(&text[c.start..c.end]);
            return false;
        }
        true
    })?;
    Ok(out)
}

fn styles_of(text: &[u8], item: &SchemaItem) -> Result<Vec<String>, KvError> {
    let block = &text[item.start..item.end];
    if memchr::memmem::find(block, b"\"styles\"").is_none() {
        return Ok(vec![]);
    }
    Ok(style_tokens(visuals_of(text, item.start)?)?.iter().map(|t| kv::latin1(t)).collect())
}

/// The heroes an item block says it is used by, as npc_dota_hero_* ids, sorted.
pub fn item_heroes(text: &[u8], start: usize) -> Result<Vec<String>, KvError> {
    let mut out = Vec::new();
    for c in kv::children(text, kv::block_bounds(text, start)?)? {
        let Some(body) = c.body else { continue };
        if !c.key.eq_ignore_ascii_case(b"used_by_heroes") {
            continue;
        }
        for h in kv::children(text, body)? {
            if h.value == Some(&b"1"[..]) && h.key.len() >= 14 && h.key[..14].eq_ignore_ascii_case(b"npc_dota_hero_") {
                out.push(kv::latin1(h.key).to_lowercase());
            }
        }
    }
    // JavaScript's sort: by UTF-16 code units, which latin1 ids share with their chars
    out.sort();
    Ok(out)
}

/// A slot of one hero, with nothing in it yet.
fn slot_fields(hero: &str, equip_slot: &str, target_id: &str) -> ItemSlot {
    let hero_ids = vec![canonical_hero_id(hero)];
    ItemSlot {
        slot: item_slot_id(&hero_ids, equip_slot),
        kind: "item-effect",
        base: target_id.into(),
        target_id: target_id.into(),
        equip_slot: equip_slot.into(),
        hero_label: display_name(&hero_ids[0]),
        slot_label: slot_display_label(equip_slot),
        label: item_slot_label(&hero_ids, equip_slot),
        icon: item_slot_icon(equip_slot),
        hero_ids,
        options: vec![],
        persona: None,
        ability_fx: None,
    }
}

fn option_of(text: &[u8], item: &SchemaItem) -> SlotOption {
    let facts = item_facts(&text[item.start..item.end]);
    SlotOption {
        id: item.id.clone(),
        name: to_utf8(&item.name),
        rarity: facts.rarity,
        date: facts.date,
        styles: None,
        note: None,
        fx: None,
    }
}

// ---- personas ----

const SELECTOR: &str = "persona_selector";
const NOT_HOSTS: [&str; 5] = [SELECTOR, "summon", "voice", "hero_base", "costume"];
const HOST_ORDER: [&str; 14] = [
    "head",
    "body_head",
    "hair",
    "neck",
    "shoulder",
    "arms",
    "back",
    "weapon",
    "offhand_weapon",
    "armor",
    "belt",
    "legs",
    "mount",
    "misc",
];

fn persona_bases() -> impl Iterator<Item = &'static ArcanaBase> {
    data::arcana_bases().iter().filter(|b| b.persona == Some(true))
}

/// One of a persona's slots: the plain stock item it is worn under, the game's own item for it, and the paid ones.
#[derive(Debug, Clone)]
pub struct PersonaPart {
    pub slot: String,
    pub host: SchemaItem,
    pub given: Option<SchemaItem>,
    pub options: Vec<SchemaItem>,
}

/// A hero's persona as the builder puts it on.
#[derive(Debug, Clone)]
pub struct PersonaLayout {
    pub hero: String,
    pub selector: SchemaItem,
    pub personas: Vec<SchemaItem>,
    pub parts: Vec<PersonaPart>,
    pub voice: Option<SchemaItem>,
}

fn slot_of(item: &SchemaItem) -> String {
    canonical_item_slot(&inferred_item_slot(item))
}

fn rank(slot: &str) -> usize {
    HOST_ORDER.iter().position(|s| *s == slot).unwrap_or(HOST_ORDER.len())
}

fn persona_number(text: &[u8], item: &SchemaItem) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        let s = r"[\t\n\x0B\x0C\r \xA0]+";
        Regex::new(&format!(r#"(?-u)"type"{s}"persona"{s}"persona"{s}"(\d+)""#)).unwrap()
    });
    re.captures(&text[item.start..item.end]).map_or("1".into(), |c| kv::latin1(&c[1]))
}

/// JavaScript's Number() of an item id, for the order of the free slots.
fn id_number(id: &str) -> f64 {
    crate::js::to_number(&serde_json::Value::String(id.to_string()))
}

fn js_cmp(a: f64, b: f64) -> Ordering {
    // a comparator's NaN is 0 to Array.prototype.sort: equal
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}

struct Own {
    given: Option<SchemaItem>,
    options: Vec<SchemaItem>,
}

fn modelled(o: &Own) -> bool {
    o.given.as_ref().is_some_and(|g| !g.model.is_empty()) || o.options.iter().any(|x| !x.model.is_empty())
}

fn layout_of(text: &[u8], hero: &str, items: &[SchemaItem]) -> Option<PersonaLayout> {
    let personas: Vec<SchemaItem> = persona_bases()
        .filter(|b| b.hero == hero)
        .filter_map(|b| items.iter().find(|i| i.id == b.item).cloned())
        .collect();
    let selector = items.iter().find(|i| i.prefab == "default_item" && slot_of(i) == SELECTOR)?.clone();
    if personas.is_empty() {
        return None;
    }
    let n = persona_number(text, &personas[0]);
    let mut own: IndexMap<String, Own> = IndexMap::new();
    for i in items {
        let slot = slot_of(i);
        let Some((part, num)) = own_slot(&slot) else { continue };
        if num != n || part == "voice" {
            continue;
        }
        let at = own.entry(slot.clone()).or_insert(Own { given: None, options: vec![] });
        if i.prefab == "default_item" {
            if at.given.is_none() {
                at.given = Some(i.clone());
            }
        } else if !i.name.is_empty() {
            at.options.push(i.clone());
        }
    }
    let mut free: Vec<&SchemaItem> = items
        .iter()
        .filter(|i| {
            let s = slot_of(i);
            i.prefab == "default_item" && own_slot(&s).is_none() && !NOT_HOSTS.contains(&s.as_str())
        })
        .collect();
    stable_sort(&mut free, |a, b| {
        rank(&slot_of(a)).cmp(&rank(&slot_of(b))).then_with(|| js_cmp(id_number(&a.id), id_number(&b.id)))
    });
    let mut slots: Vec<String> = own.keys().cloned().collect();
    stable_sort(&mut slots, |a, b| rank(own_slot(a).unwrap().0).cmp(&rank(own_slot(b).unwrap().0)));
    let mut hosts: HashMap<String, SchemaItem> = HashMap::new();
    let summon = items.iter().find(|i| i.prefab == "default_item" && slot_of(i) == "summon");
    for slot in &slots {
        if let (Some(s), "summon") = (summon, own_slot(slot).unwrap().0) {
            hosts.insert(slot.clone(), s.clone());
        }
    }
    for pass in 0..4 {
        for slot in &slots {
            let part = own_slot(slot).unwrap().0;
            if hosts.contains_key(slot) || part == "summon" {
                continue;
            }
            let o = &own[slot];
            let fits = |host: &SchemaItem| match pass {
                0 => slot_of(host) == part,
                1 => match_item_slot(&slot_of(host)) == match_item_slot(part),
                2 => modelled(o) && !host.model.is_empty(),
                _ => modelled(o),
            };
            if let Some(at) = free.iter().position(|h| fits(h)) {
                hosts.insert(slot.clone(), free.remove(at).clone());
            }
        }
    }
    let parts = slots
        .iter()
        .filter_map(|slot| {
            let host = hosts.get(slot)?.clone();
            let o = &own[slot];
            Some(PersonaPart { slot: slot.clone(), host, given: o.given.clone(), options: o.options.clone() })
        })
        .collect();
    let voice =
        items.iter().find(|i| i.prefab == "default_item" && slot_of(i) == format!("voice_persona_{n}")).cloned();
    Some(PersonaLayout { hero: hero.into(), selector, personas, parts, voice })
}

type Layouts = Arc<IndexMap<String, PersonaLayout>>;

/// Each hero with a persona the builder offers, and how it is put on. Kept while the table is the same.
pub fn persona_layouts(text: &[u8]) -> Result<Layouts, KvError> {
    static SLOT: crate::memo::Slot<IndexMap<String, PersonaLayout>> = Mutex::new(None);
    crate::memo::per_text(&SLOT, text, |text| {
        let heroes: HashSet<&str> = persona_bases().map(|b| b.hero.as_str()).collect();
        let mut by_hero: IndexMap<String, Vec<SchemaItem>> = IndexMap::new();
        for item in items_of(text)?.iter() {
            if item.prefab != "default_item" && item.prefab != "wearable" {
                continue;
            }
            let ids = item_heroes(text, item.start)?;
            let hero = if ids.len() == 1 {
                ids[0].strip_prefix("npc_dota_hero_").unwrap_or(&ids[0]).to_string()
            } else {
                String::new()
            };
            if heroes.contains(hero.as_str()) {
                by_hero.entry(hero).or_default().push(item.clone());
            }
        }
        let mut layouts = IndexMap::new();
        for (hero, items) in &by_hero {
            if let Some(l) = layout_of(text, hero, items) {
                layouts.insert(hero.clone(), l);
            }
        }
        Ok(layouts)
    })
}

/// Each persona with a base: a slot to pick it in, and a slot for each of its own.
pub fn persona_slots(text: &[u8]) -> Result<Vec<ItemSlot>, KvError> {
    let mut out = Vec::new();
    for l in persona_layouts(text)?.values() {
        let mut rows: Vec<(&str, &SchemaItem, &[SchemaItem], bool)> = vec![(SELECTOR, &l.selector, &l.personas, false)];
        rows.extend(l.parts.iter().map(|p| (p.slot.as_str(), &p.host, p.options.as_slice(), true)));
        for (slot, target, options, part) in rows {
            let plain = own_slot(slot).map_or(slot, |(p, _)| p);
            let hero_ids = vec![l.hero.clone()];
            out.push(ItemSlot {
                slot: item_slot_id(&hero_ids, slot),
                kind: "item-effect",
                base: target.id.clone(),
                target_id: target.id.clone(),
                equip_slot: slot.into(),
                hero_label: display_name(&l.hero),
                slot_label: slot_display_label(plain),
                label: item_slot_label(&hero_ids, plain),
                icon: item_slot_icon(plain),
                hero_ids,
                options: options.iter().map(|o| option_of(text, o)).collect(),
                persona: Some(PersonaOf { hero: l.hero.clone(), part }),
                ability_fx: None,
            });
        }
    }
    Ok(out)
}

// ---- ability effects slots ----

const TAG: &str = "apply_when_equipped_in_ability_effects_slot";

/// The builder's ability effects slots: one for each hero and slot some item of his fits.
fn fx_slots(
    text: &[u8],
    items: &[SchemaItem],
    heroes_of: &mut dyn FnMut(&SchemaItem) -> Result<Vec<String>, KvError>,
) -> Result<Vec<ItemSlot>, KvError> {
    let mut slots: IndexMap<String, ItemSlot> = IndexMap::new();
    let mut targets: HashMap<u64, Option<String>> = HashMap::new();
    for item in items {
        if item.prefab != "wearable" || item.name.is_empty() {
            continue;
        }
        let block = &text[item.start..item.end];
        if memchr::memmem::find(block, b"can_equip_as_ability_effects").is_none() {
            continue;
        }
        for n in fx_slots_of(block) {
            // an item that names the slot and gives it nothing would be a pick that does nothing
            let gives = Regex::new(&format!(r#"(?-u)"{TAG}"[\t\n\x0B\x0C\r \xA0]*"{n}""#)).unwrap();
            if !gives.is_match(block) {
                continue;
            }
            let target = targets.entry(n).or_insert_with(|| fx_target(items, n).map(|i| i.id.clone())).clone();
            let Some(target) = target else { continue };
            let styles = styles_of(text, item)?;
            for hero in heroes_of(item)? {
                let made = slot_fields(&hero, &format!("ability_effects_{n}"), &target);
                let at = slots.entry(made.slot.clone()).or_insert_with(|| ItemSlot { ability_fx: Some(n), ..made });
                let mut o = option_of(text, item);
                o.styles = (!styles.is_empty()).then(|| styles.clone());
                at.options.push(o);
            }
        }
    }
    Ok(slots.into_values().collect())
}

/// A stable merge sort that, unlike slice::sort_by, takes any comparator, as Array.prototype.sort
/// does: for a consistent one both give the same order.
pub fn stable_sort<T: Clone>(v: &mut [T], mut cmp: impl FnMut(&T, &T) -> Ordering) {
    fn go<T: Clone>(v: &mut [T], buf: &mut Vec<T>, cmp: &mut dyn FnMut(&T, &T) -> Ordering) {
        let n = v.len();
        if n < 2 {
            return;
        }
        let mid = n / 2;
        go(&mut v[..mid], buf, cmp);
        go(&mut v[mid..], buf, cmp);
        buf.clear();
        let (mut i, mut j) = (0, mid);
        while i < mid && j < n {
            if cmp(&v[j], &v[i]) == Ordering::Less {
                buf.push(v[j].clone());
                j += 1;
            } else {
                buf.push(v[i].clone());
                i += 1;
            }
        }
        buf.extend_from_slice(&v[i..mid]);
        buf.extend_from_slice(&v[j..n]);
        v.clone_from_slice(buf);
    }
    let mut buf = Vec::with_capacity(v.len());
    go(v, &mut buf, &mut cmp);
}

/// Hero item slots built from real default_item entries, with one list of paid items per slot.
pub fn item_slots(text: &[u8]) -> Result<Vec<ItemSlot>, KvError> {
    let items = items_of(text)?;
    let mut hero_cache: HashMap<String, Vec<String>> = HashMap::new();
    let mut heroes_of = |item: &SchemaItem| -> Result<Vec<String>, KvError> {
        if let Some(h) = hero_cache.get(&item.id) {
            return Ok(h.clone());
        }
        let h = item_heroes(text, item.start)?;
        hero_cache.insert(item.id.clone(), h.clone());
        Ok(h)
    };
    let mut slots: IndexMap<String, ItemSlot> = IndexMap::new();
    let mut match_slots: HashMap<String, Vec<String>> = HashMap::new();
    // the stock items with no model of their own: a pick for their slot has no path to go under
    let mut bare: HashSet<String> = HashSet::new();
    for item in items.iter() {
        let equip = canonical_item_slot(&inferred_item_slot(item));
        if item.prefab != "default_item" || equip.is_empty() || is_persona_item(item) {
            continue;
        }
        let heroes = heroes_of(item)?;
        if heroes.is_empty() {
            continue;
        }
        let hero_ids: Vec<String> = heroes.iter().map(|h| canonical_hero_id(h)).collect();
        let slot_id = item_slot_id(&hero_ids, &equip);
        if item.model.is_empty() {
            bare.insert(item.id.clone());
        }
        slots.insert(
            slot_id.clone(),
            ItemSlot {
                slot: slot_id.clone(),
                kind: "item-effect",
                base: item.id.clone(),
                target_id: item.id.clone(),
                equip_slot: equip.clone(),
                hero_label: hero_ids
                    .iter()
                    .map(|id| display_name(&canonical_hero_id(id)))
                    .collect::<Vec<_>>()
                    .join(" / "),
                slot_label: slot_display_label(&equip),
                label: item_slot_label(&hero_ids, &equip),
                icon: item_slot_icon(&equip),
                hero_ids: hero_ids.clone(),
                options: vec![],
                persona: None,
                ability_fx: None,
            },
        );
        match_slots.entry(item_slot_id(&hero_ids, &match_item_slot(&equip))).or_default().push(slot_id);
    }
    for item in items.iter() {
        let equip = canonical_item_slot(&inferred_item_slot(item));
        if item.prefab != "wearable" || equip.is_empty() || item.name.is_empty() || is_persona_item(item) {
            continue;
        }
        let heroes = heroes_of(item)?;
        if heroes.is_empty() {
            continue;
        }
        let hero_ids: Vec<String> = heroes.iter().map(|h| canonical_hero_id(h)).collect();
        let mut key = item_slot_id(&hero_ids, &equip);
        if !slots.contains_key(&key) {
            match match_slots.get(&item_slot_id(&hero_ids, &match_item_slot(&equip))) {
                Some(hits) if hits.len() == 1 => key = hits[0].clone(),
                _ => continue,
            }
        }
        let Some(target_base) = slots.get(&key).map(|s| s.base.clone()) else { continue };
        let block = &text[item.start..item.end];
        let styles = styles_of(text, item)?;
        let noted = item_note(&hero_ids, block, Some(&item.id));
        let note = if !item.model.is_empty() && bare.contains(&target_base) {
            Some(until_reconnect(noted.as_ref(), |ru| t(ru, &[])))
        } else {
            noted.map(|n| ItemNote { status: n.status, text: t(&n.note, &[]) })
        };
        let fx = has_own_effect(block, visuals_of(text, item.start)?)?;
        let mut o = option_of(text, item);
        o.styles = (!styles.is_empty()).then_some(styles);
        o.note = note;
        o.fx = fx.then_some(true);
        if let Some(target) = slots.get_mut(&key) {
            target.options.push(o);
        }
    }
    // a persona's items have styles as well: the Acolyte's Dark Artistry Throwback Hair has two
    let by_id: HashMap<&str, &SchemaItem> = items.iter().map(|i| (i.id.as_str(), i)).collect();
    for mut s in persona_slots(text)? {
        for o in s.options.iter_mut() {
            if let Some(item) = by_id.get(o.id.as_str()) {
                let styles = styles_of(text, item)?;
                if !styles.is_empty() {
                    o.styles = Some(styles);
                }
            }
        }
        slots.insert(s.slot.clone(), s);
    }
    // the hidden ones the game wears an item's ability effects in, without its model
    for s in fx_slots(text, &items, &mut heroes_of)? {
        slots.insert(s.slot.clone(), s);
    }
    let mut out: Vec<ItemSlot> = slots.into_values().filter(|s| !s.options.is_empty()).collect();
    for s in out.iter_mut() {
        stable_sort(&mut s.options, |a, b| locale_compare(&a.name, &b.name));
    }
    stable_sort(&mut out, |a, b| {
        let by_hero = locale_compare(&a.label, &b.label);
        if by_hero != Ordering::Equal && a.hero_ids.join(",") != b.hero_ids.join(",") {
            return by_hero;
        }
        order_of(&a.equip_slot).cmp(&order_of(&b.equip_slot)).then_with(|| locale_compare(&a.label, &b.label))
    });
    Ok(out)
}

/// Wearable items with visuals and a matching stock default_item, offered under cosmetics/items.
pub fn item_options(text: &[u8]) -> Result<Vec<SlotOption>, KvError> {
    Ok(item_slots(text)?.into_iter().flat_map(|s| s.options).collect())
}

/// The model_player of each stock item any of these heroes wears, as the table writes it.
pub fn stock_models(text: &[u8], heroes: &[String]) -> Result<Vec<String>, KvError> {
    static SLOT: crate::memo::Slot<HashMap<String, Vec<String>>> = Mutex::new(None);
    let by_hero = crate::memo::per_text(&SLOT, text, |text| {
        let mut by_hero: HashMap<String, Vec<String>> = HashMap::new();
        for i in items_of(text)?.iter() {
            if i.prefab != "default_item" || i.model.is_empty() {
                continue;
            }
            for h in item_heroes(text, i.start)? {
                by_hero.entry(h).or_default().push(i.model.clone());
            }
        }
        Ok(by_hero)
    })?;
    Ok(heroes.iter().flat_map(|h| by_hero.get(h).cloned().unwrap_or_default()).collect())
}
