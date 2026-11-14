//! An arcana base in a colour of the user's: Terrorblade's, for the arcana window
//! (src/arcana-base-color.ts, issue #118). The base was compiled with the gem's colour written in,
//! so that colour is what moves: written particle colours move as far as the gem's colour moves to
//! the chosen one, a particle that sets the gem's colour on control point 15 gets the chosen colour
//! there, and a material's constant near the gem's colour becomes the chosen one.

use std::sync::Mutex;

use serde_json::Value;
use sha1::{Digest, Sha1};

use crate::arcana_bases::TERRORBLADE_BASE;
use crate::item_builder_personas::ReadyBase;
use crate::kv3::{self, Block, Cell, Node};
use crate::recolor::{self, Rgb};
use crate::vpk::Entry;

/// How far a typed-in channel may be from the gem's and still be the gem's.
const NEAR: f64 = 0.01;

/// The set the arcana window builds, as its records carry it.
pub const WINDOW_SET: &str = "terrorblade-arcana";

fn is_gem(value: Option<&[f64]>, gem: Rgb) -> bool {
    value.is_some_and(|v| v.len() >= 3 && gem.iter().enumerate().all(|(i, c)| (v[i] - c / 255.0).abs() <= NEAR))
}

/// A base's material with the gem's colour, written in, made the chosen one.
pub fn material_in_color(file: &[u8], target: Rgb, gem: Rgb) -> Result<(Vec<u8>, usize), String> {
    crate::material::rewrite_expressions(file, |e| {
        let value = crate::material::constant_of(&e.code);
        if !is_gem(value.as_deref(), gem) {
            return Ok(None);
        }
        let value = value.unwrap_or_default();
        let mut next: Vec<f64> = target.iter().map(|n| n / 255.0).collect();
        next.extend_from_slice(&value[3..]);
        Ok(Some(crate::material::constant_expression(&next)))
    })
}

/// The cells of each C_OP_SetSingleControlPointPosition that sets control point 15; None for a
/// channel written as a bare zero.
fn gem_points(kv: &Block) -> Vec<Vec<Option<Cell>>> {
    fn visit(kv: &Block, node: &Node, out: &mut Vec<Vec<Option<Cell>>>) {
        match &node.value {
            kv3::Value::Array { items, .. } => items.iter().for_each(|n| visit(kv, n, out)),
            kv3::Value::Object(m) => {
                let cls = m.get("_class").and_then(|n| match &n.value {
                    kv3::Value::Str(s) => Some(s.as_str()),
                    _ => None,
                });
                let cp = m.get("m_nCP1").filter(|n| matches!(n.value, kv3::Value::Number { .. }));
                if cls == Some("C_OP_SetSingleControlPointPosition") && cp.and_then(|c| kv.number_of(c)) == Some(15.0) {
                    if let Some(kv3::Value::Array { items, .. }) = m.get("m_vecCP1Pos").map(|n| &n.value) {
                        let cells: Option<Vec<Option<Cell>>> = items
                            .iter()
                            .map(|x| match &x.value {
                                kv3::Value::Number { cell, .. } => Some(*cell),
                                _ => None,
                            })
                            .collect();
                        if let Some(cells) = cells.filter(|c| c.len() == 3) {
                            out.push(cells);
                        }
                    }
                }
                m.values().for_each(|n| visit(kv, n, out));
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    visit(kv, &kv.root, &mut out);
    out
}

/// A base's particle in the chosen colour.
pub fn particle_in_color(file: &[u8], target: Rgb, gem: Rgb) -> Result<(Vec<u8>, usize), String> {
    let data = crate::resource::data_block(file).map_err(|e| e.to_string())?;
    let mut kv = kv3::read(data).map_err(|e| e.to_string())?;
    let points = gem_points(&kv);
    if points.is_empty() {
        let o = recolor::Options { bake: true, from: Some(gem), ..Default::default() };
        return recolor::recolor_resource(file, target, &o).map(|(f, n)| (f, n.changed));
    }
    let mut changed = 0;
    for pos in points {
        // a zero written as "zero" has no bytes to change
        let Some(cells) = pos.into_iter().collect::<Option<Vec<Cell>>>() else { continue };
        let now: Rgb = [0, 1, 2].map(|c| (kv.read_cell(cells[c]) + 0.5).floor());
        let next = recolor::shade(now, target, Some(gem));
        for (c, n) in next.into_iter().enumerate() {
            kv.write_cell(cells[c], n).map_err(|e| e.to_string())?;
        }
        changed += 1;
    }
    changed += recolor::shade_colors(&mut kv, target, false, Some(gem))?.changed;
    if changed == 0 {
        return Ok((file.to_vec(), 0));
    }
    let next = kv.encode().map_err(|e| e.to_string())?;
    Ok((crate::resource::replace(file, "DATA", 0, &next).map_err(|e| e.to_string())?, changed))
}

/// A base's files in the chosen colour: particles and materials moved, every other file as it is.
pub fn base_in_color(entries: &[Entry], target: Rgb, gem: Rgb) -> (Vec<Entry>, usize, Vec<String>) {
    // its own colour is the base as it was made, not the base rounded through HSV and back
    if target == gem {
        return (entries.to_vec(), 0, Vec::new());
    }
    let (mut changed, mut failed) = (0, Vec::new());
    let out = entries
        .iter()
        .map(|e| {
            let p = e.path();
            let particle = p.ends_with(".vpcf_c");
            if !particle && !p.ends_with(".vmat_c") {
                return e.clone();
            }
            let r = if particle {
                particle_in_color(&e.data, target, gem)
            } else {
                material_in_color(&e.data, target, gem)
            };
            match r {
                Ok((_, 0)) => e.clone(),
                Ok((file, _)) => {
                    changed += 1;
                    crate::vpk::entry_at(&p, file.into())
                }
                Err(_) => {
                    failed.push(p);
                    e.clone()
                }
            }
        })
        .collect();
    (out, changed, failed)
}

/// Whether a record is the arcana window's.
pub fn is_window_record(rec: &Value) -> bool {
    rec.get("generated").and_then(|g| g.get("set")).and_then(Value::as_str) == Some(WINDOW_SET)
}

/// The colour the arcana window has Terrorblade in, while its record is on.
pub fn window_color(records: &[Value]) -> Option<Rgb> {
    let rec = records.iter().find(|r| is_window_record(r) && r.get("enabled") != Some(&Value::Bool(false)))?;
    let c = rec.get("generated")?.get("color")?.as_array()?;
    let n: Vec<f64> =
        c.iter().filter_map(Value::as_f64).filter(|n| n.fract() == 0.0 && (0.0..=255.0).contains(n)).collect();
    (c.len() == 3 && n.len() == 3).then(|| [n[0], n[1], n[2]])
}

fn window_gem() -> Rgb {
    crate::data::recolor_sets().iter().find(|(k, _)| k == WINDOW_SET).map(|(_, s)| s.gem).unwrap_or([0.0; 3])
}

/// The builder's bases with Terrorblade's in a colour, the last one made kept, by what the
/// files say and the colour.
#[derive(Default)]
pub struct ColoredBases {
    kept: Mutex<Option<(String, Vec<Entry>)>>,
}

impl ColoredBases {
    pub fn apply(&self, ready: Vec<ReadyBase>, color: Option<Rgb>, log: &mut dyn FnMut(String)) -> Vec<ReadyBase> {
        ready
            .into_iter()
            .map(|r| {
                let Some(color) = color.filter(|_| r.base.id == TERRORBLADE_BASE) else { return r };
                let mut h = Sha1::new();
                for e in &r.entries {
                    h.update(e.path().as_bytes());
                    h.update(&e.data);
                }
                let key = format!("{:x}|{}", h.finalize(), color.map(crate::js::number).join(","));
                let mut kept = self.kept.lock().unwrap_or_else(|e| e.into_inner());
                if kept.as_ref().is_none_or(|(k, _)| *k != key) {
                    let (entries, _, failed) = base_in_color(&r.entries, color, window_gem());
                    if let Some(first) = failed.first() {
                        log(format!(
                            "schema: {} files of {} kept their own colour, first {first}",
                            failed.len(),
                            r.base.id
                        ));
                    }
                    *kept = Some((key, entries));
                }
                let entries = kept.as_ref().map(|(_, e)| e.clone()).unwrap_or_default();
                ReadyBase { base: r.base, paths: r.paths, entries }
            })
            .collect()
    }
}
