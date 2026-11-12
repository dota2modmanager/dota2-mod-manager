//! An item's effects in a colour of the user's choosing, built from the game's own files,
//! replacing src/recolor.ts (the sets are src/recolor-sets.ts, here data/recolor-sets.json).
//!
//! The game passes a gem's colour to the hero's particles through control point 15 and to its
//! materials as `$GemColor`. Neither can be set from a mod, so the mod changes what the files do
//! with the gem's colour instead:
//! - a particle that takes its colour from control point 15 scales it, channel by channel, into a
//!   range (`m_vOutputMax`); the range is scaled again by chosen / gem;
//! - a material reads `exists($GemColor) ? $GemColor : <its own colour>`; the read becomes the
//!   chosen colour (material.rs) and the other branch stays;
//! - a particle only the item uses, with colours written in it and no gem tint, has those colours
//!   moved to the chosen one, keeping their brightness and saturation scaled by the chosen colour's.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::kv3::{self, Block, Cell, Node, Value};
use crate::material;
use crate::resource;
use crate::vpk::{self, Index};

/// A colour as three whole numbers 0-255.
pub type Rgb = [f64; 3];

/// What can be recoloured, by path prefix in pak01, and the colour of the gem the item comes with.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecolorSet {
    pub name: String,
    pub gem: Rgb,
    pub own: Vec<String>,
    pub shared: Vec<String>,
    pub materials: Vec<String>,
    #[serde(default)]
    pub abilities: Vec<String>,
    #[serde(default)]
    pub bake: bool,
}

/// Math.round: halves go up, toward positive infinity.
fn round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// A member name that holds a colour (/^m_(?!b)\w*(Colou?r|Tint)\w*$/i). Not
/// m_bSaturateColorPreAlphaBlend: that one is a switch.
fn is_color_key(key: &str) -> bool {
    let k = key.as_bytes();
    if k.len() < 2 || !k[..2].eq_ignore_ascii_case(b"m_") || k.get(2).is_some_and(|c| *c == b'b' || *c == b'B') {
        return false;
    }
    let rest = &key[2..];
    if !rest.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_') {
        return false;
    }
    let lower = rest.to_ascii_lowercase();
    lower.contains("color") || lower.contains("colour") || lower.contains("tint")
}

/// The colours a particle starts from, which a gem's tint replaces or scales.
fn is_initial(key: &str) -> bool {
    matches!(key, "m_ConstantColor" | "m_ColorMin" | "m_ColorMax")
}

fn to_hsv([r, g, b]: Rgb) -> [f64; 3] {
    let max = r.max(g).max(b) / 255.0;
    let min = r.min(g).min(b) / 255.0;
    let d = max - min;
    let mut h = 0.0;
    if d != 0.0 {
        h = if max == r / 255.0 {
            ((g - b) / 255.0 / d) % 6.0
        } else if max == g / 255.0 {
            (b - r) / 255.0 / d + 2.0
        } else {
            (r - g) / 255.0 / d + 4.0
        };
        h = (h * 60.0 + 360.0) % 360.0;
    }
    [h, if max != 0.0 { d / max } else { 0.0 }, max]
}

fn from_hsv([h, s, v]: [f64; 3]) -> Rgb {
    let c = v * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = v - c;
    let [r, g, b] = if h < 60.0 {
        [c, x, 0.0]
    } else if h < 120.0 {
        [x, c, 0.0]
    } else if h < 180.0 {
        [0.0, c, x]
    } else if h < 240.0 {
        [0.0, x, c]
    } else if h < 300.0 {
        [x, 0.0, c]
    } else {
        [c, 0.0, x]
    };
    [r, g, b].map(|n| round((n + m) * 255.0))
}

/// One colour moved to the chosen one. A colour with almost no saturation has no hue to move and
/// is left alone; anything else takes the target's hue, with saturation and brightness scaled by
/// it. With `from`, the colour the file was made in, it moves as far as `from` would to the target.
pub fn shade(color: Rgb, target: Rgb, from: Option<Rgb>) -> Rgb {
    let [h, s, v] = to_hsv(color);
    if s < 0.1 {
        return color;
    }
    let [th, ts, tv] = to_hsv(target);
    let Some(from) = from else { return from_hsv([th, (s * ts).min(1.0), (v * tv).min(1.0)]) };
    let [fh, fs, fv] = to_hsv(from);
    from_hsv([
        (h + th - fh + 360.0) % 360.0,
        (s * if fs != 0.0 { ts / fs } else { 1.0 }).min(1.0),
        (v * if fv != 0.0 { tv / fv } else { 1.0 }).min(1.0),
    ])
}

/// A gem tint in a particle: its range, whether it scales the colour or replaces it, and when it
/// runs (0: an initializer, as a particle is born; 1: an operator, every frame after).
struct Tint {
    hi: Option<Vec<Node>>,
    lo: Option<Vec<Node>>,
    from: Option<Vec<Node>>,
    scale: bool,
    stage: u8,
}

fn num(kv: &Block, n: &Node) -> f64 {
    // numberOf in src/kv3.ts: its bytes, or its type
    match &n.value {
        Value::Number { cell: Some(c), .. } => kv.read_cell(*c),
        Value::Number { ty, .. } => {
            if matches!(ty, 16 | 18 | 27) {
                1.0
            } else {
                0.0
            }
        }
        _ => f64::NAN,
    }
}

fn cell_of(n: &Node) -> Option<Cell> {
    match &n.value {
        Value::Number { cell, .. } => *cell,
        _ => None,
    }
}

/// The operators in a particle that colour it from control point 15, where the game puts a gem's colour.
fn gem_tints(kv: &Block) -> Vec<Tint> {
    fn vector(n: Option<&Node>) -> Option<Vec<Node>> {
        let items = match &n?.value {
            Value::Array { items, .. } => items,
            _ => return None,
        };
        (items.len() >= 3 && items.iter().all(|x| matches!(x.value, Value::Number { .. }))).then(|| items.clone())
    }
    fn visit(kv: &Block, node: &Node, out: &mut Vec<Tint>) {
        let m = match &node.value {
            Value::Array { items, .. } => {
                for x in items {
                    visit(kv, x, out);
                }
                return;
            }
            Value::Object(m) => m,
            _ => return,
        };
        let is_num = |k: &str, want: f64| {
            m.get(k).is_some_and(|n| matches!(n.value, Value::Number { .. }) && num(kv, n) == want)
        };
        if let Some(cls) = m.get("_class").and_then(Node::as_str) {
            if matches!(cls, "C_INIT_RemapCPtoVector" | "C_OP_RemapCPtoVector")
                && is_num("m_nCPInput", 15.0)
                && is_num("m_nFieldOutput", 6.0)
            {
                out.push(Tint {
                    hi: vector(m.get("m_vOutputMax")),
                    lo: vector(m.get("m_vOutputMin")),
                    from: vector(m.get("m_vInputMin")),
                    scale: m.get("m_nSetMethod").and_then(Node::as_str) == Some("PARTICLE_SET_SCALE_INITIAL_VALUE"),
                    stage: if cls.starts_with("C_INIT_") { 0 } else { 1 },
                });
            }
        }
        for v in m.values() {
            visit(kv, v, out);
        }
    }
    let mut out = Vec::new();
    visit(kv, &kv.root, &mut out);
    out
}

/// A tint's range, channel by channel: what a full channel of the gem comes out as (None: cannot be read).
fn range(kv: &Block, t: &Tint) -> Option<[f64; 3]> {
    let hi = t.hi.as_ref()?;
    if t.from.as_ref().is_some_and(|f| f.iter().any(|x| num(kv, x) != 0.0)) {
        return None;
    }
    Some([0, 1, 2].map(|c| num(kv, &hi[c]) - t.lo.as_ref().map_or(0.0, |lo| num(kv, &lo[c]))))
}

/// How many were changed, and how many could not be (no bytes to write to).
#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize)]
pub struct Count {
    pub changed: usize,
    pub skipped: usize,
}

/// Make the gem's tint give the chosen colour: each channel's range scaled by chosen / gem.
fn retarget(kv: &mut Block, tints: &[Tint], gem: Rgb, target: Rgb) -> Result<Count, String> {
    let mut n = Count::default();
    for t in tints {
        let cells: Option<Vec<Cell>> = t.hi.as_ref().map(|hi| hi.iter().filter_map(cell_of).collect());
        let (Some(_), Some(cells)) = (range(kv, t), cells.filter(|c| Some(c.len()) == t.hi.as_ref().map(Vec::len)))
        else {
            n.skipped += 1;
            continue;
        };
        for c in 0..3 {
            if gem[c] == 0.0 {
                continue; // a channel the gem has none of cannot be scaled into anything
            }
            let low = t.lo.as_ref().map_or(0.0, |lo| num(kv, &lo[c]));
            let next = low + (kv.read_cell(cells[c]) - low) * (target[c] / gem[c]);
            kv.write_cell(cells[c], next).map_err(|e| e.to_string())?;
        }
        n.changed += 1;
    }
    Ok(n)
}

/// A colour brought into 0..255 with its hue kept: a channel over 255 takes the others down with it.
fn fit(rgb: [f64; 3]) -> [f64; 3] {
    let over = rgb.iter().fold(255.0f64, |a, b| a.max(*b)) / 255.0;
    rgb.map(|n| round(n / over).max(0.0))
}

/// The arrays of whole numbers under a key `want` takes, three or four long, each with its cells.
fn color_arrays(kv: &Block, want: impl Fn(&str) -> bool) -> Vec<(String, Vec<Option<Cell>>)> {
    kv.arrays
        .iter()
        .filter(|a| want(&a.key) && (a.cells.len() == 3 || a.cells.len() == 4))
        .map(|a| (a.key.clone(), a.cells.clone()))
        .collect()
}

/// For a hero with no gem: write into the colours a particle starts from what the gem's tints
/// would have made of them in the chosen colour, the tints run as the game runs them.
fn bake_tint(kv: &mut Block, tints: &[Tint], target: Rgb) -> Result<Count, String> {
    let mut ordered: Vec<&Tint> = tints.iter().collect();
    ordered.sort_by_key(|t| t.stage);
    let spans: Option<Vec<[f64; 3]>> = ordered.iter().map(|t| range(kv, t)).collect();
    let Some(spans) = spans else { return Ok(Count { changed: 0, skipped: 1 }) };
    let mut n = Count::default();
    for (_, cells) in color_arrays(kv, is_initial) {
        if cells.iter().any(|c| c.is_some_and(|c| c.float)) {
            continue;
        }
        let Some(cells) = cells.into_iter().collect::<Option<Vec<Cell>>>() else {
            n.skipped += 1;
            continue;
        };
        let mut rgb = [0, 1, 2].map(|c| kv.read_cell(cells[c]));
        for (t, span) in ordered.iter().zip(&spans) {
            rgb = [0, 1, 2].map(|c| target[c] * span[c] * if t.scale { rgb[c] / 255.0 } else { 1.0 });
        }
        for (c, v) in fit(rgb).into_iter().enumerate() {
            kv.write_cell(cells[c], v).map_err(|e| e.to_string())?;
        }
        n.changed += 1;
    }
    Ok(n)
}

/// The colours written in a particle moved to the chosen one (but the initial ones, with
/// `skip_initial`); `skipped` counts those with no room.
pub fn shade_colors(kv: &mut Block, target: Rgb, skip_initial: bool, from: Option<Rgb>) -> Result<Count, String> {
    let mut n = Count::default();
    for (_, cells) in color_arrays(kv, |k| is_color_key(k) && !(skip_initial && is_initial(k))) {
        if cells.iter().any(|c| c.is_some_and(|c| c.float)) {
            continue; // a colour is whole numbers; floats here are scales
        }
        // a zero written as "zero" has no bytes to change; recolouring the other channels alone
        // would give a hue nobody chose
        let Some(cells) = cells.into_iter().collect::<Option<Vec<Cell>>>() else {
            n.skipped += 1;
            continue;
        };
        let rgb = [0, 1, 2].map(|c| kv.read_cell(cells[c]));
        if rgb.iter().any(|v| *v < 0.0 || *v > 255.0) {
            continue;
        }
        let next = shade(rgb, target, from);
        if next == rgb {
            continue;
        }
        for (c, v) in next.into_iter().enumerate() {
            kv.write_cell(cells[c], v).map_err(|e| e.to_string())?;
        }
        n.changed += 1;
    }
    Ok(n)
}

fn read_data(file: &[u8]) -> Result<Block, String> {
    kv3::read(resource::data_block(file).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn with_data(file: &[u8], kv: &mut Block) -> Result<Vec<u8>, String> {
    let next = kv.encode().map_err(|e| e.to_string())?;
    resource::replace(file, "DATA", 0, &next).map_err(|e| e.to_string())
}

/// A particle drawn with a MOD2X renderer multiplies what is under it by twice its colour, so a
/// channel near zero there wipes that channel off the ground. Every channel of its colours is
/// lifted to at least `share` of the strongest; particles drawn any other way come back as they were.
pub fn lift_for_mod2x(file: &[u8], share: f64) -> Result<(Vec<u8>, usize), String> {
    let mut kv = read_data(file)?;
    if !kv.strings.iter().any(|s| s.contains("BLEND_MODE_MOD2X")) {
        return Ok((file.to_vec(), 0));
    }
    let mut changed = 0;
    for (_, cells) in color_arrays(&kv, is_color_key) {
        let Some(cells) = cells.into_iter().collect::<Option<Vec<Cell>>>().filter(|c| c.iter().all(|c| !c.float))
        else {
            continue;
        };
        let rgb = [0, 1, 2].map(|c| kv.read_cell(cells[c]));
        let floor = round(rgb.iter().fold(f64::NEG_INFINITY, |a, b| a.max(*b)) * share);
        if rgb.iter().all(|v| *v >= floor) {
            continue;
        }
        for (c, v) in rgb.into_iter().enumerate() {
            if v < floor {
                kv.write_cell(cells[c], floor).map_err(|e| e.to_string())?;
            }
        }
        changed += 1;
    }
    Ok((if changed > 0 { with_data(file, &mut kv)? } else { file.to_vec() }, changed))
}

/// How a particle takes the chosen colour (recolor_resource).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Options {
    /// the gem's tint pointed at the chosen colour
    pub gem: Option<Rgb>,
    /// a particle the gem does not tint has its written colours moved (true when not given)
    pub own: Option<bool>,
    /// for a hero who has no gem: what the tint would have given is written in
    pub bake: bool,
    /// the written colours move as far as this would (shade)
    pub from: Option<Rgb>,
}

/// One compiled particle in the chosen colour, with how many colours changed and could not.
pub fn recolor_resource(file: &[u8], target: Rgb, o: &Options) -> Result<(Vec<u8>, Count), String> {
    let mut kv = read_data(file)?;
    let own = o.own.unwrap_or(true);
    let tints = gem_tints(&kv);
    let baked = if o.bake && !tints.is_empty() { bake_tint(&mut kv, &tints, target)? } else { Count::default() };
    let tint = match o.gem {
        Some(gem) => retarget(&mut kv, &tints, gem, target)?,
        None => Count::default(),
    };
    let written = if o.bake && !tints.is_empty() {
        shade_colors(&mut kv, target, true, o.from)?
    } else if if o.bake { own } else { own && tint.changed == 0 } {
        shade_colors(&mut kv, target, false, o.from)?
    } else {
        Count::default()
    };
    let n = Count {
        changed: baked.changed + tint.changed + written.changed,
        skipped: baked.skipped + tint.skipped + written.skipped,
    };
    Ok((if n.changed > 0 { with_data(file, &mut kv)? } else { file.to_vec() }, n))
}

/// One material with its reads of the gem's colour replaced by the chosen colour. With `bake`, an
/// expression that reads the gem becomes the chosen colour whole: with no gem, the other branch is
/// the one that shows.
pub fn recolor_material(file: &[u8], target: Rgb, bake: bool) -> Result<(Vec<u8>, usize), String> {
    let value = target.map(|n| n / 255.0);
    let gem = material::attribute_token("$GemColor");
    material::rewrite_expressions(file, |e| {
        let next = material::with_constant(&e.code, gem, &value)?;
        Ok(if next.is_some() && bake { Some(material::constant_expression(&value)) } else { next })
    })
}

/// A file of a set that failed to read: its path and why.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Failed {
    pub path: String,
    pub error: String,
}

/// A set's files in the chosen colour, read from the game's pak01.
#[derive(Debug, Clone, Default)]
pub struct Recolored {
    pub files: IndexMap<String, Vec<u8>>,
    pub changed: usize,
    pub skipped: usize,
    pub failed: Vec<Failed>,
}

/// The set of this name.
pub fn recolor_set(name: &str) -> Option<&'static RecolorSet> {
    crate::data::recolor_sets().iter().find(|(k, _)| k == name).map(|(_, s)| s)
}

/// The files of a set in the chosen colour, read from the game's pak01 (`bake`: as above). Files
/// that fail to read are reported and left out, so a mod carries Valve's own version of them.
pub fn recolor_files(index: &Index, set: &str, target: Rgb, bake: bool) -> Result<Recolored, String> {
    let def = recolor_set(set).ok_or_else(|| format!("recolor: no set {set}"))?;
    let under = |p: &str, prefixes: &[String]| prefixes.iter().any(|f| p.starts_with(f.as_str()));
    let mut out = Recolored::default();
    for p in index.paths() {
        let particle = p.ends_with(".vpcf_c") && (under(p, &def.own) || under(p, &def.shared));
        let is_material = p.ends_with(".vmat_c") && under(p, &def.materials);
        if !particle && !is_material {
            continue;
        }
        let run = || -> Result<(Vec<u8>, Count), String> {
            let file =
                index.read(p).map_err(|e| e.to_string())?.ok_or("recolor: a file the index names is not there")?;
            // an ability's effect is baked: the game hands the gem to Sunder, not to Terror Wave
            // or Demon Zeal, whose tint then never ran and left Valve's blue
            let ability = under(p, &def.abilities);
            if particle {
                let o = Options {
                    gem: if def.bake { None } else { Some(def.gem) },
                    own: Some(under(p, &def.own) || ability),
                    bake: bake || ability,
                    from: None,
                };
                recolor_resource(&file, target, &o)
            } else {
                recolor_material(&file, target, bake).map(|(f, changed)| (f, Count { changed, skipped: 0 }))
            }
        };
        match run() {
            Ok((file, n)) => {
                out.changed += n.changed;
                out.skipped += n.skipped;
                if n.changed > 0 {
                    out.files.insert(p.to_string(), file);
                }
            }
            Err(error) => out.failed.push(Failed { path: p.to_string(), error }),
        }
    }
    Ok(out)
}

/// A set recoloured into one VPK, from the game's pak01, for a hero whose item brings its gem (but
/// the paths `skip` names), with how many files went in.
pub fn build_recolor(
    index: &Index,
    set: &str,
    target: Rgb,
    skip: impl Fn(&str) -> bool,
) -> Result<(Vec<u8>, Recolored), String> {
    let mut r = recolor_files(index, set, target, recolor_set(set).is_some_and(|s| s.bake))?;
    if r.files.is_empty() {
        return Err("recolor: nothing in the set took the colour".into());
    }
    r.files.retain(|p, _| !skip(&p.to_lowercase()));
    let entries: Vec<vpk::Entry> =
        r.files.iter().map(|(p, f)| vpk::entry_at(p, std::sync::Arc::from(f.clone()))).collect();
    Ok((vpk::build(&entries), r))
}
