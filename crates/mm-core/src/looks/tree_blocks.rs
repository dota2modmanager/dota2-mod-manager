//! Blocks in place of the trees: a tree set the window "Своя карта" offers beside the game's own
//! (map_looks_service.rs), for reading the map's paths. A tree blocks the square of two cells each
//! way round its place (128 units) and nothing more; a block is that square, as a low box, so the
//! eye sees where a hero can walk and where not. With every tree at its own size and straight
//! (map_build.rs one_size_trees, the switch under the trees), each block is the tree's square of
//! the grid. Where the trees stand and what they block is the server's and stays.
//!
//! The game has no such model: each is drawn here as OBJ and compiled by Valve's compiler
//! (resource_compiler.rs) into one model per default tree model, put under that tree's path as the
//! game's tree sets are (tree_sets.rs). They wear a material of the game's own, the cropped hedge
//! of Crownfall's palace garden, so they look like the map and need no picture of ours. Nothing in
//! them is the game's own file, so a build after a Dota update takes over the blocks of the pak
//! before.

use crate::resource_compiler::{CompileJob, SourceFile};
use crate::vpk::{Entry, Index};

/// The id a tree side picks for blocks.
pub const BLOCKS_ID: &str = "blocks";
/// The models of the blocks' set as the window names them: it draws them itself (map-blocks.ts).
pub const RADIANT_MODEL: &str = "blocks:radiant";
pub const DIRE_MODEL: &str = "blocks:dire";

/// The hedge the blocks wear: the game's own, a leafy picture that tiles.
pub const MATERIAL: &str = "models/events/crownfall/survivors/foliage/palace/materials/cf_palace_garden_topiary.vmat";
/// Where our models live while compiled, and the mark of their look kept beside them in the pak.
const MODELS: &str = "models/d2mm_blocks";
const LOOK: u32 = 1;

/// Half a block's side: half of the 128 units a tree blocks.
pub const HALF: f64 = 64.0;
/// How tall a block is: low, so it hides no hero and throws no long shadow.
pub const HEIGHT: f64 = 96.0;
/// How many times the hedge's picture goes across a block's side.
const TILES: f64 = 1.0;

/// The file that marks the blocks' look in a pak: blocks of another look are compiled again.
pub fn look_mark() -> String {
    format!("{MODELS}/blocks_v{LOOK}.txt")
}

/// A block as OBJ: 128 square, `HEIGHT` tall, its foot at the origin, its sides along the map's x
/// and y. Valve's compiler reads an OBJ's x, y, z as the model's y, z, x: each point and normal is
/// written turned so.
pub fn block_obj(material: &str) -> String {
    let (h, z) = (HALF, HEIGHT);
    // each face: its normal and its four corners, counter-clockwise seen from outside
    let faces: [([f64; 3], [[f64; 3]; 4]); 5] = [
        ([0.0, 0.0, 1.0], [[-h, -h, z], [h, -h, z], [h, h, z], [-h, h, z]]),
        ([1.0, 0.0, 0.0], [[h, -h, 0.0], [h, h, 0.0], [h, h, z], [h, -h, z]]),
        ([-1.0, 0.0, 0.0], [[-h, h, 0.0], [-h, -h, 0.0], [-h, -h, z], [-h, h, z]]),
        ([0.0, 1.0, 0.0], [[h, h, 0.0], [-h, h, 0.0], [-h, h, z], [h, h, z]]),
        ([0.0, -1.0, 0.0], [[-h, -h, 0.0], [h, -h, 0.0], [h, -h, z], [-h, -h, z]]),
    ];
    let (mut v, mut vn, mut f) = (String::new(), String::new(), String::new());
    let v_up = z / (2.0 * h) * TILES;
    let vt = format!("vt 0 0\nvt {TILES} 0\nvt {TILES} {TILES}\nvt 0 {TILES}\nvt {TILES} {v_up:.4}\nvt 0 {v_up:.4}\n");
    for (k, (n, corners)) in faces.iter().enumerate() {
        for c in corners {
            v.push_str(&format!("v {:.4} {:.4} {:.4}\n", c[1], c[2], c[0]));
        }
        vn.push_str(&format!("vn {:.4} {:.4} {:.4}\n", n[1], n[2], n[0]));
        let (a, ni) = (k * 4 + 1, k + 1);
        // the top takes the whole picture; a side as much of it as it is tall
        let t = if k == 0 { [1, 2, 3, 4] } else { [1, 2, 5, 6] };
        f.push_str(&format!("f {}/{}/{ni} {}/{}/{ni} {}/{}/{ni}\n", a, t[0], a + 1, t[1], a + 2, t[2]));
        f.push_str(&format!("f {}/{}/{ni} {}/{}/{ni} {}/{}/{ni}\n", a, t[0], a + 2, t[2], a + 3, t[3]));
    }
    format!("o block\n{v}{vt}{vn}usemtl {material}\n{f}")
}

/// Which block stands in for which default tree of the sides picked: (block, tree path).
pub fn blocks_for(sides: &[&str]) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for side in sides {
        for (i, tree) in crate::tree_sets::default_trees(side).iter().enumerate() {
            out.push((format!("{MODELS}/block_{side}_{i}.vmdl"), tree.to_string()));
        }
    }
    out
}

fn model_source(obj: &str) -> String {
    format!(
        "<!-- kv3 encoding:text:version{{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d}} format:modeldoc28:version{{fb63b6ca-f435-4aa0-a2c7-c66ddc651dca}} -->
{{
\trootNode =
\t{{
\t\t_class = \"RootNode\"
\t\tchildren =
\t\t[
\t\t\t{{
\t\t\t\t_class = \"RenderMeshList\"
\t\t\t\tchildren =
\t\t\t\t[
\t\t\t\t\t{{
\t\t\t\t\t\t_class = \"RenderMeshFile\"
\t\t\t\t\t\tname = \"block\"
\t\t\t\t\t\tfilename = \"{obj}\"
\t\t\t\t\t\timport_scale = 1.0
\t\t\t\t\t}},
\t\t\t\t]
\t\t\t}},
\t\t]
\t\tmodel_archetype = \"\"
\t\tprimary_associated_entity = \"\"
\t\tanim_graph_name = \"\"
\t}}
}}
"
    )
}

/// The compile of the blocks for these sides ("radiant", "dire"); None for no side. One OBJ for
/// all, a model per default tree (each tree's path needs a model of its own).
pub fn job(sides: &[&str]) -> Result<Option<CompileJob>, String> {
    let blocks = blocks_for(sides);
    if blocks.is_empty() {
        return Ok(None);
    }
    let obj = format!("{MODELS}/block.obj");
    let mut files = vec![SourceFile { path: obj.clone(), data: block_obj(MATERIAL).into_bytes() }];
    let mut compile = Vec::new();
    for (model, _) in &blocks {
        files.push(SourceFile { path: model.clone(), data: model_source(&obj).into_bytes() });
        compile.push(model.clone());
    }
    Ok(Some(CompileJob { id: "map_blocks".into(), files, compile }))
}

/// The compiler's output put where the game reads trees: each block under the default tree's path
/// it stands in for, with the mark of their look. The hedge is the game's and stays out.
pub fn placed(out: &[Entry], sides: &[&str]) -> Vec<Entry> {
    let blocks = blocks_for(sides);
    let mut placed = Vec::new();
    for e in out {
        let p = e.path();
        for (block, tree) in &blocks {
            if p == format!("{block}_c") {
                placed.push(crate::vpk::entry_at(&format!("{tree}_c"), e.data.clone()));
            }
        }
    }
    if !placed.is_empty() {
        placed.push(crate::vpk::entry_at(&look_mark(), b"blocks".to_vec().into()));
    }
    placed
}

/// The blocks an earlier build put in a pak, for these sides, with the mark of their look.
pub fn kept(pak: &Index, sides: &[&str]) -> Vec<Entry> {
    let mut wanted: Vec<String> = blocks_for(sides).into_iter().map(|(_, t)| format!("{t}_c")).collect();
    wanted.push(look_mark());
    let paths: Vec<String> = pak.paths().filter(|p| wanted.iter().any(|w| w == p)).map(str::to_string).collect();
    paths.into_iter().filter_map(|p| pak.read(&p).ok().flatten().map(|d| crate::vpk::entry_at(&p, d.into()))).collect()
}

/// Whether `had` (kept from the pak before) holds every block these sides need, of this look.
pub fn complete(had: &[Entry], sides: &[&str]) -> bool {
    let trees: Vec<String> = blocks_for(sides).into_iter().map(|(_, t)| format!("{t}_c")).collect();
    !trees.is_empty()
        && had.iter().any(|e| e.path() == look_mark())
        && trees.iter().all(|t| had.iter().any(|e| e.path() == *t))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_block_is_the_trees_square_turned_for_the_compiler() {
        let obj = block_obj("materials/x.vmat");
        let parse = |prefix: &str| -> Vec<[f64; 3]> {
            obj.lines()
                .filter_map(|l| l.strip_prefix(prefix))
                .map(|l| {
                    let v: Vec<f64> = l.split(' ').map(|x| x.parse().unwrap()).collect();
                    [v[0], v[1], v[2]]
                })
                .collect()
        };
        let points = parse("v ");
        assert_eq!(points.len(), 20);
        assert_eq!(obj.lines().filter(|l| l.starts_with("f ")).count(), 10);
        // written as (y, z, x): 128 across on both of the map's axes, HEIGHT tall
        let span = |k: usize| {
            points.iter().map(|p| p[k]).fold(f64::MIN, f64::max) - points.iter().map(|p| p[k]).fold(f64::MAX, f64::min)
        };
        assert_eq!((span(0), span(2)), (128.0, 128.0));
        assert_eq!(span(1), HEIGHT);
        // every face names a point, a texture place and a normal that are there
        let count = |k: &str| obj.lines().filter(|l| l.starts_with(k)).count();
        let (nv, nt, nn) = (count("v "), count("vt "), count("vn "));
        for l in obj.lines().filter(|l| l.starts_with("f ")) {
            for c in l[2..].split(' ') {
                let i: Vec<usize> = c.split('/').map(|x| x.parse().unwrap()).collect();
                assert!(i[0] >= 1 && i[0] <= nv && i[1] >= 1 && i[1] <= nt && i[2] >= 1 && i[2] <= nn, "{l}");
            }
        }
        // each face turns outward: its corners go round counter-clockwise about its normal
        for (k, n) in parse("vn ").iter().enumerate() {
            let (a, b, c) = (points[k * 4], points[k * 4 + 1], points[k * 4 + 2]);
            let (u, w) = ([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
            let cross = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
            assert!(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > 0.0, "face {k}");
        }
    }

    #[test]
    fn the_blocks_stand_in_for_each_sides_trees_and_are_kept_by_their_look() {
        let b = blocks_for(&["dire"]);
        assert_eq!(b.len(), crate::tree_sets::DEFAULT_DIRE.len());
        assert_eq!(b[0], ("models/d2mm_blocks/block_dire_0.vmdl".into(), "models/props_tree/dire_tree004.vmdl".into()));
        let job = job(&["radiant", "dire"]).unwrap().unwrap();
        assert_eq!(job.compile.len(), 12);
        assert!(job.compile.iter().all(|c| job.files.iter().any(|f| &f.path == c)));
        assert!(job.files[0].data.windows(MATERIAL.len()).any(|w| w == MATERIAL.as_bytes()));
        assert!(super::job(&[]).unwrap().is_none());
        let out: Vec<Entry> = blocks_for(&["dire"])
            .iter()
            .map(|(s, _)| crate::vpk::entry_at(&format!("{s}_c"), vec![1].into()))
            .collect();
        let all = placed(&out, &["dire"]);
        assert_eq!(all.len(), 5);
        assert_eq!(all[1].path(), "models/props_tree/dire_tree004b.vmdl_c");
        assert!(complete(&all, &["dire"]));
        assert!(!complete(&all, &["radiant"]));
        // blocks without the mark of this look are not taken over
        let old: Vec<Entry> = all.iter().filter(|e| e.path() != look_mark()).cloned().collect();
        assert!(!complete(&old, &["dire"]));
    }
}
