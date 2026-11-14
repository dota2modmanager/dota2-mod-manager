//! The signature list, dota.signatures (src/patcher.ts explains the patch): the hashes the client
//! checks gameinfo_branchspecific.gi against, Valve's own entry for it, and the one line this app
//! appends after the DIGEST and takes off again. Replacing src/patcher-signatures.ts.
//!
//! Texts here are the files as latin1: one char per byte.

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

use crate::js;
use crate::kv::to_latin1;

const SIG_PREFIX: &str = r"...\..\..\dota\gameinfo_branchspecific.gi";

/// A file's hashes as the signature list writes them, uppercase hex.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hashes {
    pub sha1: String,
    pub crc: String,
}

fn upper_hex(b: &[u8]) -> String {
    b.iter().map(|b| format!("{b:02X}")).collect()
}

/// CRC-32 as the signature list records it.
pub fn crc32(buf: &[u8]) -> u32 {
    crate::vpk::crc32(buf)
}

/// The signature list stores the CRC little-endian, uppercase, like the SHA1 next to it.
pub fn file_hashes(buf: &[u8]) -> Hashes {
    Hashes { sha1: upper_hex(&Sha1::digest(buf)), crc: upper_hex(&crc32(buf).to_le_bytes()) }
}

/// The line the signature list needs for the patched file.
pub fn signature_line(buf: &[u8]) -> String {
    let Hashes { sha1, crc } = file_hashes(buf);
    format!("{SIG_PREFIX}~SHA1:{sha1};CRC:{crc}")
}

fn digest_at(lines: &[&str]) -> Option<usize> {
    lines.iter().position(|l| l.starts_with("DIGEST:"))
}

/// Valve's own recorded hash for the file we edit, read out of the signature list the game ships
/// with: their entry sits before the DIGEST line, ours (when present) after it.
pub fn vanilla_branch_hashes(signatures: &str) -> Option<Hashes> {
    let lines = js::lines(signatures);
    let scope = &lines[..digest_at(&lines).unwrap_or(lines.len())];
    static ENTRY: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let entry = ENTRY.get_or_init(|| {
        let ws = js::SPACE_CLASS;
        regex::Regex::new(&format!(
            r"gameinfo_branchspecific\.gi~SHA1:([0-9A-Fa-f]{{40}});CRC:([0-9A-Fa-f]{{8}}){ws}*$"
        ))
        .unwrap()
    });
    for l in scope {
        if let Some(m) = entry.captures(l) {
            return Some(Hashes { sha1: m[1].to_uppercase(), crc: m[2].to_uppercase() });
        }
    }
    None
}

/// Whether a file hashes to what Valve recorded; with no record there is nothing to contradict.
pub fn matches_vanilla(text: &str, want: Option<&Hashes>) -> bool {
    match want {
        None => true,
        Some(want) => file_hashes(&to_latin1(text)) == *want,
    }
}

/// Is our line present in a signature list? Only an entry appended after the DIGEST line is ours:
/// Valve's own file already names gameinfo_branchspecific.gi before it.
pub fn has_signature_patch(text: &str) -> bool {
    let lines = js::lines(text);
    let Some(digest) = digest_at(&lines) else { return false };
    let ours = format!("{SIG_PREFIX}~");
    lines[digest + 1..].iter().any(|l| l.starts_with(&ours))
}

/// The signature list with our line taken off: anything of ours past the DIGEST line comes off and
/// the file the game shipped is left behind.
pub fn strip_signatures(text: &str) -> String {
    let lines = js::lines(text);
    let Some(digest) = digest_at(&lines) else { return text.to_string() };
    let ours = format!("{SIG_PREFIX}~");
    let mut kept: Vec<&str> =
        lines.iter().enumerate().filter(|(i, l)| *i <= digest || !l.starts_with(&ours)).map(|(_, l)| *l).collect();
    while kept.last().is_some_and(|l| js::trim(l).is_empty()) {
        kept.pop();
    }
    kept.join("\r\n") + "\r\n"
}
