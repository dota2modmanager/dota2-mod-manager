//! The main menu background of the user's own (src/menu-background.ts, issue #418): a WebM behind
//! the menu, dimmed and blurred as they chose, in a pak made out of the game's own layouts.
//!
//! The manager panel of the menu's background is told to show the last match's background, and
//! that background gets a movie: the three compiled layouts are read out of pak01 and written back
//! with one change each in their LaCo tree, so nothing else in them is a copy of an older patch.

use indexmap::IndexMap;

use crate::i18n::t;
use crate::kv3::{Node, Value};
use serde_json::json;

/// Where the movie sits in the pak.
pub const MOVIE: &str = "d2mm/menu_background.webm";
pub const DASHBOARD: &str = "panorama/layout/dashboard.vxml_c";
pub const MANAGER: &str = "panorama/layout/dashboard_background_manager.vxml_c";
pub const LAST_MATCH: &str = "panorama/layout/dashboard_background_last_match.vxml_c";
const SHOWN: &str = "DOTADashboardBackgroundLastMatch";

/// How the movie is shown: how dark the veil over it is (0 to 0.9) and how blurred (0 to 20 px).
#[derive(Debug, Clone, Copy)]
pub struct Look {
    pub dim: f64,
    pub blur: f64,
}

fn str_node(s: &str) -> Node {
    Node::new(Value::Str(s.to_string()))
}
fn obj(members: Vec<(&str, Node)>) -> Node {
    Node::new(Value::Object(members.into_iter().map(|(k, v)| (k.to_string(), v)).collect::<IndexMap<_, _>>()))
}
fn list(items: Vec<Node>) -> Node {
    Node::new(Value::Array { items, element: None, ty: 8 })
}
fn field<'a>(n: &'a Node, k: &str) -> Option<&'a str> {
    n.get(k).and_then(Node::as_str)
}

/// A panel's attribute as the compiler writes one: a name and its value under it.
pub fn attribute(name: &str, value: &str) -> Node {
    obj(vec![
        ("eType", str_node("PANEL_ATTRIBUTE")),
        ("name", str_node(name)),
        ("child", obj(vec![("eType", str_node("PANEL_ATTRIBUTE_VALUE")), ("name", str_node(value))])),
    ])
}

/// A node's children as a list that can be changed: one child alone is stored as `child`, more as
/// `vecChildren`, which takes its place at the end.
pub fn children(node: &mut Node) -> &mut Vec<Node> {
    let Value::Object(m) = &mut node.value else { unreachable!("a panel is an object") };
    let is_list = matches!(m.get("vecChildren"), Some(Node { value: Value::Array { .. }, .. }));
    if !is_list {
        let one = m.shift_remove("child");
        m.insert("vecChildren".into(), list(one.into_iter().collect()));
    }
    match &mut m.get_mut("vecChildren").expect("just made").value {
        Value::Array { items, .. } => items,
        _ => unreachable!(),
    }
}

fn walk(n: &Node, name: &str, path: &mut Vec<usize>, out: &mut Vec<Vec<usize>>) {
    match &n.value {
        Value::Object(m) => {
            if field(n, "eType") == Some("PANEL") && field(n, "name") == Some(name) {
                out.push(path.clone());
            }
            for (i, v) in m.values().enumerate() {
                path.push(i);
                walk(v, name, path, out);
                path.pop();
            }
        }
        Value::Array { items, .. } => {
            for (i, v) in items.iter().enumerate() {
                path.push(i);
                walk(v, name, path, out);
                path.pop();
            }
        }
        _ => {}
    }
}

/// Where every panel of this name lies in the layout, in the order they come.
pub fn panels(root: &Node, name: &str) -> Vec<Vec<usize>> {
    let mut out = Vec::new();
    walk(root, name, &mut Vec::new(), &mut out);
    out
}

fn at_mut<'a>(mut n: &'a mut Node, path: &[usize]) -> &'a mut Node {
    for &i in path {
        n = match &mut n.value {
            Value::Object(m) => m.get_index_mut(i).expect("a path walk found").1,
            Value::Array { items, .. } => &mut items[i],
            _ => unreachable!("a path walk found"),
        };
    }
    n
}

/// The attribute `name` of a panel set to `value`, in place of the one it had.
pub fn set_attribute(panel: &mut Node, name: &str, value: &str) {
    let list = children(panel);
    let had = list.iter().position(|c| field(c, "eType") == Some("PANEL_ATTRIBUTE") && field(c, "name") == Some(name));
    match had {
        Some(i) => list[i] = attribute(name, value),
        None => list.push(attribute(name, value)),
    }
}

/// The compiled layout with its LaCo tree changed by `change`.
fn rewrite(file: &[u8], change: impl FnOnce(&mut Node) -> Result<(), String>) -> Result<Vec<u8>, String> {
    let laco = crate::resource::data(file, "LaCo", 0).map_err(|e| e.0)?;
    let mut kv = crate::kv3::read(laco).map_err(|e| e.0)?;
    change(&mut kv.root)?;
    let next = crate::kv3::write(&kv).map_err(|e| e.0)?;
    crate::resource::replace(file, "LaCo", 0, &next).map_err(|e| e.0)
}

/// The veil's colour: black, as opaque as the dimming.
pub fn veil(dim: f64) -> String {
    format!("#000000{:02x}", (dim.clamp(0.0, 0.9) * 255.0).round() as u32)
}

/// The panels the last match's background gets: the movie, then the veil over it.
fn movie_panels(look: Look, like: &Node) -> Vec<Node> {
    let blur = look.blur.clamp(0.0, 20.0).round() as i64;
    let line = like.get("sourceLineColumn").cloned();
    let panel = |name: &str, attrs: Vec<Node>| {
        let mut m = vec![("eType", str_node("PANEL")), ("name", str_node(name)), ("vecChildren", list(attrs))];
        if let Some(l) = &line {
            m.push(("sourceLineColumn", l.clone()));
        }
        obj(m)
    };
    let fill = "width: 100%; height: 100%; horizontal-align: center; vertical-align: center;";
    let blurred = if blur != 0 { format!(" blur: gaussian( {blur} );") } else { String::new() };
    vec![
        panel(
            "MoviePanel",
            vec![
                attribute("id", "D2MMBackground"),
                attribute("src", &format!("s2r://{MOVIE}")),
                attribute("repeat", "true"),
                attribute("autoplay", "onload"),
                attribute("hittest", "false"),
                attribute("style", &format!("{fill}{blurred}")),
            ],
        ),
        panel(
            "Panel",
            vec![
                attribute("id", "D2MMBackgroundDim"),
                attribute("hittest", "false"),
                attribute("style", &format!("{fill} background-color: {};", veil(look.dim))),
            ],
        ),
    ]
}

/// What reads a file out of the game's pak01: its bytes, or None when the game has no such file.
pub type Read<'a> = &'a dyn Fn(&str) -> Result<Option<Vec<u8>>, String>;

/// The three layouts with the movie in them, out of the game's own.
pub fn background_layouts(read: Read, look: Look) -> Result<Vec<(String, Vec<u8>)>, String> {
    let get = |file: &str| -> Result<Vec<u8>, String> {
        read(file)?.ok_or_else(|| t("В игре нет файла {0}", &[json!(file)]))
    };
    let no_panel = || t("В игре нет панели фона меню", &[]);
    let point = |root: &mut Node| -> Result<(), String> {
        let found = panels(root, "DOTADashboardBackgroundManager");
        if found.is_empty() {
            return Err(no_panel());
        }
        // the later ones first: a panel inside another keeps its path while the outer one changes
        for p in found.iter().rev() {
            set_attribute(at_mut(root, p), "override-background", SHOWN);
        }
        Ok(())
    };
    let last_match = rewrite(&get(LAST_MATCH)?, |root| {
        let p = panels(root, SHOWN).into_iter().next().ok_or_else(no_panel)?;
        let shown = at_mut(root, &p);
        let own: Vec<usize> = children(shown)
            .iter()
            .enumerate()
            .filter(|(_, c)| field(c, "eType") == Some("PANEL"))
            .map(|(i, _)| i)
            .collect();
        // hidden rather than removed: the panel's code finds its children by id
        for &i in &own {
            set_attribute(&mut children(shown)[i], "style", "visibility: collapse;");
        }
        let made = match own.first() {
            Some(&i) => movie_panels(look, &children(shown)[i]),
            None => movie_panels(look, shown),
        };
        let list = children(shown);
        let at = own.first().map_or(list.len(), |&i| i + 1);
        list.splice(at..at, made);
        Ok(())
    })?;
    Ok(vec![
        (DASHBOARD.to_string(), rewrite(&get(DASHBOARD)?, point)?),
        (MANAGER.to_string(), rewrite(&get(MANAGER)?, point)?),
        (LAST_MATCH.to_string(), last_match),
    ])
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

/// Why these bytes cannot be the menu's movie, or None: a WebM, with a VP8 or VP9 track.
pub fn webm_problem(webm: &[u8], max: usize) -> Option<String> {
    if webm.len() < 64 || webm[..4] != [0x1a, 0x45, 0xdf, 0xa3] || !contains(&webm[..webm.len().min(256)], b"webm") {
        return Some(t("Это не WebM", &[]));
    }
    if webm.len() > max {
        return Some(t("Фон больше {0} МБ", &[json!((max as f64 / 1024.0 / 1024.0).round() as i64)]));
    }
    let head = &webm[..webm.len().min(4096)];
    if !contains(head, b"V_VP9") && !contains(head, b"V_VP8") {
        return Some(t("В WebM нет видео VP8 или VP9", &[]));
    }
    None
}

/// The largest movie the menu takes.
pub const MAX: usize = 48 * 1024 * 1024;

/// The pak: the three layouts and the movie.
pub fn build_background(read: Read, webm: &[u8], look: Look) -> Result<Vec<u8>, String> {
    if let Some(why) = webm_problem(webm, MAX) {
        return Err(why);
    }
    let mut entries: Vec<crate::vpk::Entry> = background_layouts(read, look)?
        .into_iter()
        .map(|(p, data)| crate::vpk::entry_at(&p, std::sync::Arc::from(data)))
        .collect();
    entries.push(crate::vpk::entry_at(MOVIE, std::sync::Arc::from(webm.to_vec())));
    Ok(crate::vpk::build(&entries))
}
