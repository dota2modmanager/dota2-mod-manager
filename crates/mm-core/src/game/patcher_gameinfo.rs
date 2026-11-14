//! The two gameinfo files (src/patcher.ts explains the patch): the SearchPaths block read out of
//! gameinfo.gi with our folder added, that block spliced into gameinfo_branchspecific.gi, and the
//! same file taken back to what Valve shipped, byte for byte. Replacing src/patcher-gameinfo.ts,
//! which says why each step is the way it is.
//!
//! Texts here are the files as latin1: one char per byte.

use regex::Regex;
use std::sync::OnceLock;

use crate::i18n::t;
use crate::js;
use crate::patcher_signatures::{matches_vanilla, Hashes};

/// Written beside every line this app adds, so its own edit can be found and taken out again.
pub const MARKER: &str = "Dota 2 Mod Manager";

/// s.lastIndexOf(needle, from): the last start at or before `from`, a negative `from` read as 0.
fn last_index_of(s: &str, needle: &str, from: i64) -> Option<usize> {
    let from = from.max(0) as usize;
    let end = (from + needle.len()).min(s.len());
    let mut end = end;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].rfind(needle)
}

/// Where the braces are counted from: the first '{' at or after `at`, else (indexOf giving -1, and
/// a loop from -1) the start of the text.
fn scan_from(text: &str, at: usize) -> usize {
    text[at..].find('{').map_or(0, |o| at + o)
}

/// The end of the {...} block that opens at `open`: braces counted, nothing else.
fn block_end(text: &str, open: usize) -> Option<usize> {
    let mut depth = 0i64;
    for (i, c) in text[open..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(open + i);
                }
            }
            _ => {}
        }
    }
    None
}

/// Pull the SearchPaths block out of gameinfo.gi (branchspecific has none by default).
pub fn search_paths_block(gameinfo: &str) -> Result<String, String> {
    let Some(at) = gameinfo.find("SearchPaths") else {
        return Err(t("gameinfo.gi: блок SearchPaths не найден", &[]));
    };
    match block_end(gameinfo, scan_from(gameinfo, at)) {
        Some(c) => Ok(if c + 1 > at { gameinfo[at..=c].to_string() } else { String::new() }),
        None => Err(t("gameinfo.gi: блок SearchPaths не закрыт", &[])),
    }
}

fn path_line(key: &'static str, slot: &'static OnceLock<Regex>) -> &'static Regex {
    slot.get_or_init(|| {
        let ws = js::SPACE_CLASS;
        Regex::new(&format!(r"^({ws}*){key}({ws}+)dota{ws}*$")).unwrap()
    })
}

/// Add our folder to a SearchPaths block: as the first Game path (which is also what the engine
/// turns into the MOD path) and as the first Mod path.
pub fn with_mod_folder(block: &str, folder: &str) -> Result<String, String> {
    static GAME: OnceLock<Regex> = OnceLock::new();
    static MOD: OnceLock<Regex> = OnceLock::new();
    let (game_re, mod_re) = (path_line("Game", &GAME), path_line("Mod", &MOD));
    let mut out: Vec<String> = Vec::new();
    let (mut added_game, mut added_mod) = (false, false);
    for line in js::lines(block) {
        if let Some(g) = game_re.captures(line).filter(|_| !added_game) {
            out.push(format!("{}Game{}{folder}\t\t// {MARKER}", &g[1], &g[2]));
            added_game = true;
        }
        if let Some(m) = mod_re.captures(line).filter(|_| !added_mod) {
            out.push(format!("{}Mod{}{folder}\t\t// {MARKER}", &m[1], &m[2]));
            added_mod = true;
        }
        out.push(line.to_string());
    }
    if !added_game || !added_mod {
        return Err(t("gameinfo.gi: не найдены строки Game/Mod dota", &[]));
    }
    Ok(out.join("\r\n"))
}

/// The lines of a SearchPaths block the engine acts on: comments and blank lines dropped,
/// whitespace inside a line collapsed. Two blocks with the same lines mount the same folders.
pub fn search_path_lines(block: &str) -> Vec<String> {
    js::lines(block)
        .into_iter()
        .map(|l| {
            let l = l.find("//").map_or(l, |c| &l[..c]);
            let mut out = String::new();
            let mut gap = false;
            for c in js::trim(l).chars() {
                if js::is_space(c) {
                    gap = true;
                } else {
                    if gap {
                        out.push(' ');
                    }
                    gap = false;
                    out.push(c);
                }
            }
            out
        })
        .filter(|l| !l.is_empty() && l != "SearchPaths" && l != "{" && l != "}")
        .collect()
}

/// Whether the search paths our patch put in the branch file are still the ones the game's
/// current gameinfo.gi gives, plus our folder (a Valve update can move gameinfo.gi on).
pub fn patch_is_current(branch: &str, gameinfo: &str, folder: &str) -> Result<bool, String> {
    let ours = search_path_lines(&search_paths_block(branch)?);
    let want = search_path_lines(&with_mod_folder(&search_paths_block(gameinfo)?, folder)?);
    Ok(ours == want)
}

/// Put the block inside branchspecific's FileSystem section (its keys win over gameinfo.gi).
pub fn patched_branch(branch: &str, block: &str) -> Result<String, String> {
    let Some(at) = branch.find("FileSystem") else {
        return Err(t("gameinfo_branchspecific.gi: блок FileSystem не найден", &[]));
    };
    let close = block_end(branch, scan_from(branch, at));
    let Some(close) = close else {
        return Err(t("gameinfo_branchspecific.gi: блок FileSystem не закрыт", &[]));
    };
    // the original ends its FileSystem body with a lone indent meant for its closing brace
    let head = branch[..close].trim_end_matches([' ', '\t']);
    let indented: Vec<String> = js::lines(block)
        .into_iter()
        .map(|l| if js::trim(l).is_empty() { l.to_string() } else { format!("\t\t{}", js::trim(l)) })
        .collect();
    Ok(format!("{head}{}\r\n\t{}", indented.join("\r\n"), &branch[close..]))
}

fn is_gap(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\r' | '\n')
}

/// Undo our own insertion in a gameinfo file, byte for byte: the whitespace on both sides of the
/// block is taken out and the one shape the original always has ("\r\n\t" before the closing
/// brace) is written in its place.
pub fn strip_patch(text: &str) -> String {
    let mut out = text.to_string();
    for _ in 0..8 {
        let Some(mark) = out.find(MARKER) else { break };
        let Some(kw) = last_index_of(&out, "SearchPaths", mark as i64) else { break };
        let Some(open) = out[kw..].find('{').map(|o| kw + o) else { break };
        let Some(end) = block_end(&out, open).map(|e| e + 1) else { break };
        let start = out[..kw].trim_end_matches(is_gap).len();
        let end = end + (out[end..].len() - out[end..].trim_start_matches(is_gap).len());
        // the block always sits at the end of the FileSystem body: its closing brace wants one tab
        let joiner = if out[end..].starts_with('}') { "\r\n\t" } else { "\r\n" };
        out = format!("{}{joiner}{}", &out[..start], &out[end..]);
    }
    out
}

/// The original branchspecific file, reconstructed and checked against Valve's own hashes: when
/// they disagree, the few shapes the indent before FileSystem's closing brace can take are tried.
pub fn restore_branch(text: &str, want: Option<&Hashes>) -> (String, bool) {
    let base = strip_patch(text);
    if matches_vanilla(&base, want) {
        return (base, want.is_some());
    }
    let last = base.rfind('}').map_or(-1, |l| l as i64);
    let before = last_index_of(&base, "}", last - 1).map_or(-1, |b| b as i64);
    let at = last_index_of(&base, "\n", before);
    if let Some(at) = at {
        let end = at + 1 + (base[at + 1..].len() - base[at + 1..].trim_start_matches([' ', '\t']).len());
        for indent in ["\t", "", "\t\t"] {
            let candidate = format!("{}{indent}{}", &base[..=at], &base[end..]);
            if matches_vanilla(&candidate, want) {
                return (candidate, true);
            }
        }
    }
    (base, false)
}
