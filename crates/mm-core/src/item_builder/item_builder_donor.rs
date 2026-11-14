//! Another item's effect on the one worn (issue #383), replacing src/item-builder-donor.ts: the
//! donor's asset modifiers of the kinds an effect is made of (its particles, and the icon and sound
//! of an ability it restyles) worn beside the item's own. The donor rides in the pick's effect
//! string as `from-<id>`. Text is items_game's latin1 bytes.

use regex::bytes::Regex;
use serde_json::json;
use std::collections::HashMap;
use std::sync::OnceLock;

use crate::i18n::t;
use crate::kv;

/// The donor's id in an effect string, None for none.
pub fn donor_of(key: &str) -> Option<String> {
    key.split(',').map(str::trim).find_map(|token| {
        let id = token.strip_prefix("from-")?;
        (!id.is_empty() && id.bytes().all(|c| c.is_ascii_digit())).then(|| id.to_string())
    })
}

#[derive(Debug, Clone)]
struct Modifier {
    text: Vec<u8>,
    ty: Vec<u8>,
    asset: Vec<u8>,
    modifier: Vec<u8>,
}

const GIVEN: [&[u8]; 4] = [b"particle_create", b"particle", b"ability_icon", b"sound"];

fn lower(b: &[u8]) -> Vec<u8> {
    crate::schema_merge::latin1_lower(b)
}

fn is_modifier(key: &[u8]) -> bool {
    key.len() >= 14 && key[..14].eq_ignore_ascii_case(b"asset_modifier") && key[14..].iter().all(u8::is_ascii_digit)
}

fn unnumbered() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i-u)^"asset_modifier[0-9]*""#).unwrap())
}

/// The modifiers of a visuals block a donor can give, each as its text.
fn effect_modifiers(visuals: &[u8]) -> Result<Vec<Modifier>, kv::KvError> {
    let mut out = Vec::new();
    for c in kv::children(visuals, kv::block_bounds(visuals, 0)?)? {
        if !c.is_block() || !is_modifier(c.key) {
            continue;
        }
        let mut f: HashMap<Vec<u8>, &[u8]> = HashMap::new();
        kv::each_child(visuals, c.body.unwrap(), |x| {
            if !x.is_block() {
                f.insert(lower(x.key), x.value.unwrap_or(b""));
            }
            true
        })?;
        let get = |k: &str| f.get(k.as_bytes()).copied().unwrap_or(b"");
        let ty = lower(get("type"));
        let style = get("style");
        // one tied to a style other than the first is worn only in that style, which the pick is not in
        if !GIVEN.contains(&ty.as_slice()) || (if style.is_empty() { &b"0"[..] } else { style }) != b"0" {
            continue;
        }
        let text = unnumbered().replace(&visuals[c.start..c.end], &b"\"asset_modifier\""[..]).into_owned();
        out.push(Modifier { text, ty, asset: lower(get("asset")), modifier: lower(get("modifier")) });
    }
    Ok(out)
}

fn is_particle(m: &Modifier) -> bool {
    m.ty == b"particle_create" || m.ty == b"particle"
}

fn particle_word() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i-u)"particle(_create)?""#).unwrap())
}

/// Whether an item has an effect another item could wear: what the picker offers as a donor.
pub fn has_own_effect(block: &[u8], visuals: Option<&[u8]>) -> Result<bool, kv::KvError> {
    if !particle_word().is_match(block) {
        return Ok(false);
    }
    let v = visuals.filter(|v| !v.is_empty()).unwrap_or(b"\"visuals\"{}");
    Ok(effect_modifiers(v)?.iter().any(is_particle))
}

/// The donor's modifiers the worn item takes, each as its text: each particle it does not create
/// already, and each stock effect, ability icon and sound it leaves alone. An error when the donor
/// is not in the table or has no particle to give.
pub fn donor_additions(base: &[u8], visuals: &[u8], donor_id: &str) -> Result<Vec<Vec<u8>>, String> {
    let e = |x: kv::KvError| x.to_string();
    let Some((start, _)) = crate::schema_merge::items_by_id(base).map_err(e)?.find(base, donor_id).map_err(e)? else {
        return Err(t("items_game: предмет {0} не найден", &[json!(donor_id)]));
    };
    let mut donor_visuals: &[u8] = b"";
    kv::each_child(base, kv::block_bounds(base, start).map_err(e)?, |c| {
        if c.is_block() && c.key.eq_ignore_ascii_case(b"visuals") {
            donor_visuals = &base[c.start..c.end];
        }
        true
    })
    .map_err(e)?;
    let given = if donor_visuals.is_empty() { vec![] } else { effect_modifiers(donor_visuals).map_err(e)? };
    if !given.iter().any(is_particle) {
        return Err(t("У предмета {0} нет своего эффекта", &[json!(donor_id)]));
    }
    // a created particle is told apart by itself, a replacement by what it replaces
    let key_of =
        |m: &Modifier| [&m.ty[..], b" ", if m.ty == b"particle_create" { &m.modifier } else { &m.asset }].concat();
    let taken: std::collections::HashSet<Vec<u8>> = effect_modifiers(visuals).map_err(e)?.iter().map(key_of).collect();
    Ok(given.into_iter().filter(|m| !taken.contains(&key_of(m))).map(|m| m.text).collect())
}

/// The visuals with these modifiers added at the end of the block.
pub fn with_modifiers(visuals: &[u8], add: &[Vec<u8>]) -> Vec<u8> {
    let Some(close) = visuals.iter().rposition(|&c| c == b'}') else { return visuals.to_vec() };
    if add.is_empty() {
        return visuals.to_vec();
    }
    let mut head = &visuals[..close];
    while let Some((&c, rest)) = head.split_last() {
        if !matches!(c, b' ' | b'\t' | b'\r' | b'\n') {
            break;
        }
        head = rest;
    }
    [head, b"\r\n\t", &add.join(&b"\r\n\t"[..]), b"\r\n", &visuals[close..]].concat()
}

/// The visuals with the donor's effects added.
pub fn with_donor_effects(base: &[u8], visuals: &[u8], donor_id: &str) -> Result<Vec<u8>, String> {
    Ok(with_modifiers(visuals, &donor_additions(base, visuals, donor_id)?))
}
