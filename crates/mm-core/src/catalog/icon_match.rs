//! Which wiki file is an item's picture (src/icon-match.ts): the file names to try first, and how
//! a wiki's listing is matched against the game's name, give or take a typo but never a different
//! number or an extra word.

use regex::Regex;

use crate::js::SPACE_CLASS;

fn re(p: &str) -> Regex {
    Regex::new(p).expect("a fixed pattern")
}

/// A name without spacing, punctuation or case, and without the "Skin" the schema gives some HUDs.
pub fn plain(s: &str) -> String {
    let s = re(r"(?i)(?-u:\b)HUD[ _]Skin$").replace(s, "HUD");
    let low = s.to_lowercase();
    re("[^a-z0-9]+").replace_all(&low, "").into_owned()
}

/// The parts a typo check never forgives: digits and roman numerals, in order.
pub fn numbering(s: &str) -> String {
    re(r"[0-9]+|(?-u:\b)[IVXLC]{1,6}(?-u:\b)").find_iter(s).map(|m| m.as_str()).collect::<Vec<_>>().join(" ")
}

/// Levenshtein distance over UTF-16 code units, as the TypeScript counts.
pub fn edit_distance(a: &str, b: &str) -> usize {
    let (a, b): (Vec<u16>, Vec<u16>) = (a.encode_utf16().collect(), b.encode_utf16().collect());
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut row = vec![i];
        for j in 1..=b.len() {
            let v = (prev[j] + 1).min(row[j - 1] + 1).min(prev[j - 1] + usize::from(a[i - 1] != b[j - 1]));
            row.push(v);
        }
        prev = row;
    }
    prev[b.len()]
}

/// A loading or versus screen's name without that suffix, the outfit's own name, or None.
pub fn strip_screen_suffix(name: &str) -> Option<String> {
    let pat = format!(r"(?i){SPACE_CLASS}*-?{SPACE_CLASS}*(?:Loading[ ]?Screen|Versus[ ]?Screen|LS)$");
    let base = re(&pat).replace(name, "");
    let base = crate::js::trim(&base);
    (!base.is_empty() && base != crate::js::trim(name)).then(|| base.to_string())
}

/// Which of a wiki listing's titles is this item's picture: the same name give or take two
/// letters, the same length and the same numbers, the closest one; None rather than a stranger's.
pub fn pick_title(name: &str, titles: &[String]) -> Option<String> {
    let want = plain(name);
    let file_re = re(r"(?i)^File:");
    let icon_re = re(r"(?i)^Cosmetic[ _]icon[ _]([^\n\r\u{2028}\u{2029}]+)\.(?:png|jpe?g|webp)$");
    let wanted_numbers = numbering(name);
    let mut best: Option<(usize, String)> = None;
    for raw in titles {
        let title = file_re.replace(raw, "");
        let Some(m) = icon_re.captures(&title) else { continue };
        if numbering(&m[1]) != wanted_numbers {
            continue;
        }
        let got = plain(&m[1]);
        let d = if got == want {
            0
        } else if got.encode_utf16().count() == want.encode_utf16().count() {
            edit_distance(&got, &want)
        } else {
            usize::MAX
        };
        if d <= 2 && best.as_ref().is_none_or(|b| d < b.0) {
            best = Some((d, title.replace(' ', "_")));
        }
    }
    best.map(|b| b.1)
}

/// What a wiki's bytes are: PNG, WebP or JPEG, or None.
pub fn sniff(b: &[u8]) -> Option<&'static str> {
    if b.get(..4) == Some(&[0x89, 0x50, 0x4e, 0x47]) {
        Some("image/png")
    } else if b.get(..4) == Some(b"RIFF") && b.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if b.first() == Some(&0xff) && b.get(1) == Some(&0xd8) {
        Some("image/jpeg")
    } else {
        None
    }
}

/// Wiki file names to try for a cosmetic: the schema's name, then without colons, with dashes for
/// them, and as it was; a typographic apostrophe as a plain one.
pub fn cosmetic_file_names(name: &str) -> Vec<String> {
    let ws = re(&format!("{SPACE_CLASS}+"));
    let quotes = name.replace(['\u{2018}', '\u{2019}'], "'");
    let clean = ws.replace_all(&quotes, " ");
    let clean = crate::js::trim(&clean).to_string();
    let mut out: Vec<String> = Vec::new();
    for form in [clean.clone(), clean.replace(':', ""), clean.replace(':', "-"), crate::js::trim(name).to_string()] {
        let file = format!("Cosmetic_icon_{}.png", ws.replace_all(&form, "_"));
        if !form.is_empty() && !out.contains(&file) {
            out.push(file);
        }
    }
    out
}

/// The listing prefix for a name: its first word, or two when the first is short.
pub fn prefix_of(name: &str) -> Option<String> {
    let kept =
        re(r"[^A-Za-z0-9_\t-\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}'.-]")
            .replace_all(name, "");
    let words: Vec<&str> = re(&format!("{SPACE_CLASS}+")).split(&kept).filter(|w| !w.is_empty()).collect();
    let first = words.first()?;
    let n = if first.encode_utf16().count() < 5 { 2 } else { 1 };
    Some(words.iter().take(n).copied().collect::<Vec<_>>().join("_"))
}

/// A hero's own portrait on the wiki: its icon, then its minimap icon.
pub fn hero_file_names(hero: &str) -> Vec<String> {
    let clean = re(&format!("{SPACE_CLASS}+")).replace_all(hero, "_");
    vec![format!("{clean}_icon.png"), format!("{clean}_minimap_icon.png")]
}
