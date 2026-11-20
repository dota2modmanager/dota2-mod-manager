//! A HUD mod carried over to a patched Dota, where it was switched off before (game_repair.rs).
//!
//! After 7.42 a catalog HUD stopped the game at start ("Unable to load layout file
//! hud/hud_reborn.xml"): the mod puts back the layout and scripts of the game it was made on. Being
//! switched off is safe but takes the HUD away, and in Discord the ask was to have it on the new
//! game. So the mod's pak is built again on the patched game's files:
//!
//! - a layout (`.vxml_c`) or script (`.vjs_c`) the patch changed goes out of the mod, and the
//!   game's new one is what loads: those are what fail the start, and Panorama has no way to tell a
//!   mod's edit of them from the layout of an older game;
//! - a style (`.vcss_c`) the patch changed is the game's new one with the mod's own rules carried
//!   into it (`merge_css`): the look of a HUD is in its styles, and a style that is a little off
//!   never stops the game;
//! - everything else the mod carries (its pictures, its fonts) stays as it is.

use indexmap::IndexMap;

use crate::panorama_files::{images_of, read_style, write_style};
use crate::vpk::Entry;

/// One top-level statement of a style: a rule with its selector, or an @-line, by its key.
#[derive(Debug, Clone, PartialEq)]
struct Statement {
    key: String,
    text: String,
}

/// The CSS without its comments.
fn without_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(i) = rest.find("/*") {
        out.push_str(&rest[..i]);
        match rest[i + 2..].find("*/") {
            Some(j) => rest = &rest[i + 2 + j + 2..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The style's top-level statements in order. A rule's key is its selector; a selector met again
/// is keyed with its count, so the second `.Foo` of a file pairs with the second of another.
fn statements(css: &str) -> Vec<Statement> {
    let css = without_comments(css);
    let b = css.as_bytes();
    let mut out = Vec::new();
    let mut seen: IndexMap<String, usize> = IndexMap::new();
    let mut at = 0;
    while at < b.len() {
        while at < b.len() && b[at].is_ascii_whitespace() {
            at += 1;
        }
        if at >= b.len() {
            break;
        }
        let start = at;
        // an @-line (`@define x: 1px;`) ends at its semicolon; anything else at its block's close
        let mut depth = 0usize;
        while at < b.len() {
            match b[at] {
                b'{' => depth += 1,
                b'}' => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        at += 1;
                        break;
                    }
                }
                b';' if depth == 0 => {
                    at += 1;
                    break;
                }
                _ => {}
            }
            at += 1;
        }
        let text = css[start..at].trim().to_string();
        let head = text.split(['{', ':', ';']).next().unwrap_or("");
        let head = squash(head);
        let n = seen.entry(head.clone()).or_insert(0);
        *n += 1;
        out.push(Statement { key: format!("{head}#{n}"), text });
    }
    out
}

/// The game's new style with the mod's rules in it: a rule the mod writes otherwise than `base`
/// (the style the mod was made on, when it is known) or else than the new game, takes the mod's
/// text; a rule only the mod has goes at the end; the rest is the new game's.
pub fn merge_css(new_game: &str, mods: &str, base: Option<&str>) -> String {
    let base: Option<IndexMap<String, String>> =
        base.map(|b| statements(b).into_iter().map(|s| (s.key, squash(&s.text))).collect());
    let game = statements(new_game);
    let game_keys: IndexMap<&str, &str> = game.iter().map(|s| (s.key.as_str(), s.text.as_str())).collect();
    let mut edits: IndexMap<String, String> = IndexMap::new();
    for s in statements(mods) {
        let edited = match (&base, game_keys.get(s.key.as_str())) {
            (Some(b), _) => b.get(&s.key) != Some(&squash(&s.text)),
            (None, Some(g)) => squash(g) != squash(&s.text),
            (None, None) => true,
        };
        if edited {
            edits.insert(s.key, s.text);
        }
    }
    let mut out = String::with_capacity(new_game.len() + 256);
    for s in &game {
        out.push_str(edits.shift_remove(&s.key).as_deref().unwrap_or(&s.text));
        out.push('\n');
    }
    for (_, text) in edits {
        out.push_str(&text);
        out.push('\n');
    }
    out
}

/// What became of a mod built again on the patched game.
#[derive(Debug, Default, PartialEq)]
pub struct Repatched {
    /// the layouts and scripts left to the game's own
    pub dropped: Vec<String>,
    /// the styles carried over to the game's new ones
    pub merged: Vec<String>,
}

fn is(p: &str, ext: &str) -> bool {
    let p = p.to_ascii_lowercase();
    p.starts_with("panorama/") && p.ends_with(ext)
}

/// The mod's files on the patched game, for the `changed` paths: layouts and scripts left out,
/// styles merged into the game's new ones (`game` reads the patched pak01). A style that cannot be
/// read either way is left out too, so the game's loads.
pub fn repatch_entries(
    entries: Vec<Entry>,
    changed: &[String],
    game: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> (Vec<Entry>, Repatched) {
    let changed: std::collections::HashSet<String> = changed.iter().map(|p| p.to_ascii_lowercase()).collect();
    let mut done = Repatched::default();
    let mut out = Vec::with_capacity(entries.len());
    for e in entries {
        let path = e.path();
        if !changed.contains(&path.to_ascii_lowercase()) {
            out.push(e);
            continue;
        }
        if is(&path, ".vxml_c") || is(&path, ".vjs_c") {
            done.dropped.push(path);
            continue;
        }
        if !is(&path, ".vcss_c") {
            out.push(e);
            continue;
        }
        let own = [&e.preload[..], &e.data[..]].concat();
        let merged = (|| -> Option<Vec<u8>> {
            let new_file = game(&path)?;
            let (_, new_css) = read_style(&new_file).ok()?;
            let (_, mod_css) = read_style(&own).ok()?;
            let css = merge_css(&new_css, &mod_css, None);
            let known = images_of(&[&own, &new_file]);
            write_style(&new_file, &css, &known, game).ok()
        })();
        match merged {
            Some(file) => {
                out.push(crate::vpk::entry_at(&path, file.into()));
                done.merged.push(path);
            }
            None => done.dropped.push(path),
        }
    }
    (out, done)
}

#[cfg(test)]
#[path = "hud_repatch_tests.rs"]
mod tests;
