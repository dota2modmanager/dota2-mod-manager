//! An emblem draws on the ring under the selected hero, and Dota hides that ring unless
//! r_draw_selected_ring is 1 (src/emblem-ring.ts). While an emblem is on, the line is kept in the
//! game's autoexec.cfg under a comment of ours; only our two lines are ever touched.

use std::path::Path;

/// The comment the line sits under, which is how the app knows the line is its own.
pub const RING_MARK: &str = "// Dota 2 Mod Manager: emblems show on the selection ring";
/// The command that shows the ring.
pub const RING_LINE: &str = "r_draw_selected_ring 1";
/// The categories whose mods need the ring.
pub const RING_CATEGORIES: [&str; 1] = ["emblems"];

fn theirs(l: &str) -> bool {
    static R: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let ws = crate::js::SPACE_CLASS;
    R.get_or_init(|| regex::Regex::new(&format!(r#"^{ws}*r_draw_selected_ring{ws}+"?1"?{ws}*(//.*)?$"#)).unwrap())
        .is_match(l)
}

/// autoexec's text with our line in it when `on`, without it otherwise; the user's lines kept.
pub fn with_ring(text: &str, on: bool) -> String {
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let lines = crate::js::lines(text);
    let mut kept: Vec<&str> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if crate::js::trim(lines[i]) == RING_MARK {
            if lines.get(i + 1).is_some_and(|l| crate::js::trim(l) == RING_LINE) {
                i += 1;
            }
            i += 1;
            continue;
        }
        kept.push(lines[i]);
        i += 1;
    }
    while kept.last().is_some_and(|l| crate::js::trim(l).is_empty()) {
        kept.pop();
    }
    if on && !kept.iter().any(|l| theirs(l)) {
        kept.push(RING_MARK);
        kept.push(RING_LINE);
    }
    if kept.is_empty() {
        String::new()
    } else {
        kept.join(eol) + eol
    }
}

/// Put the line in or take it out of <game>/dota/cfg/autoexec.cfg; writes only on a change.
pub fn keep_ring(game: &Path, on: bool) -> Result<Option<&'static str>, String> {
    let file = game.join("dota").join("cfg").join("autoexec.cfg");
    let text = match std::fs::read(&file) {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(_) if !on => return Ok(None),
        Err(_) => String::new(),
    };
    let next = with_ring(&text, on);
    if next == text {
        return Ok(None);
    }
    if let Some(d) = file.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(&file, next).map_err(|e| e.to_string())?;
    Ok(Some(if on { "added" } else { "removed" }))
}
