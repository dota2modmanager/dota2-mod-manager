//! The Source engine's VPK: reading an index (v1/v2) and the files it lists, writing one, and the
//! content fingerprint that recognises a mod whatever it is packed as.
//!
//! Rewritten from src/vpk-read.ts, src/vpk-write.ts and src/vpk-fingerprint.ts. Every rule those
//! files spell out holds here byte for byte (test/vpk.test.js is the reference, and the parity
//! test in tests/ compares this crate against it): a single space means "empty" for a folder and
//! for an extension, paths are lower case, a truncated tree is a refusal and never a panic, and
//! one buffer under many paths is written once.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use indexmap::IndexMap;
use rustc_hash::FxHashMap;
use sha1::{Digest, Sha1};

/// The first four bytes of every VPK index.
pub const SIGNATURE: u32 = 0x55aa_1234;
/// The archive index meaning "the data lives in the _dir file itself".
pub const INLINE: u16 = 0x7fff;

#[derive(Debug, thiserror::Error)]
pub enum VpkError {
    #[error("VPK: bad signature")]
    Signature,
    #[error("VPK: damaged tree")]
    Tree,
    #[error("VPK: unterminated string in the tree")]
    String,
    #[error("combine: a member must be a single-file VPK")]
    NotSingle,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, VpkError>;

/// Bytes shared between entries: one model under every wearable of a slot is one allocation.
pub type Bytes = Arc<[u8]>;

pub fn empty() -> Bytes {
    Arc::from(Vec::new())
}

/// One file inside a VPK, with its bytes: what `read_entries` hands out and `build` takes.
#[derive(Clone, Debug)]
pub struct Entry {
    pub ext: String,
    pub folder: String,
    pub name: String,
    pub crc: u32,
    pub preload: Bytes,
    pub data: Bytes,
}

impl Entry {
    /// The full inner path, lower case.
    pub fn path(&self) -> String {
        join_path(&self.folder, &self.name, &self.ext)
    }
}

/// An entry of a multi-part index: where its bytes sit in the _NNN volumes.
#[derive(Clone, Debug)]
pub struct DirEntry {
    pub ext: String,
    pub folder: String,
    pub name: String,
    pub crc: u32,
    pub preload: Bytes,
    pub archive_index: u16,
    pub offset: u32,
    pub length: u32,
}

/// One record of the tree: crc(4) preloadBytes(2) archiveIndex(2) offset(4) length(4) end(2).
#[derive(Clone, Copy, Debug)]
pub struct Record {
    pub crc: u32,
    pub preload_bytes: u16,
    pub archive_index: u16,
    pub offset: u32,
    pub length: u32,
    pub preload_at: usize,
    pub next: usize,
}

fn u16_at(buf: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([buf[at], buf[at + 1]])
}
fn u32_at(buf: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([buf[at], buf[at + 1], buf[at + 2], buf[at + 3]])
}

fn read_record(buf: &[u8], pos: usize) -> Result<Record> {
    if pos + 18 > buf.len() {
        return Err(VpkError::Tree);
    }
    let preload_bytes = u16_at(buf, pos + 4);
    let preload_at = pos + 18;
    if preload_at + preload_bytes as usize > buf.len() {
        return Err(VpkError::Tree);
    }
    Ok(Record {
        crc: u32_at(buf, pos),
        preload_bytes,
        archive_index: u16_at(buf, pos + 6),
        offset: u32_at(buf, pos + 8),
        length: u32_at(buf, pos + 12),
        preload_at,
        next: preload_at + preload_bytes as usize,
    })
}

fn read_cstr(buf: &[u8], pos: usize) -> Result<(&str, usize)> {
    let rest = buf.get(pos..).ok_or(VpkError::String)?;
    let end = rest.iter().position(|&b| b == 0).ok_or(VpkError::String)?;
    // the TypeScript reader decodes UTF-8 leniently; a tree is ASCII in practice
    let s = std::str::from_utf8(&rest[..end]).unwrap_or("\u{fffd}");
    Ok((s, pos + end + 1))
}

/// A tree path: a single space is "empty" for the folder and for the extension.
pub fn join_path(folder: &str, name: &str, ext: &str) -> String {
    let mut out = String::with_capacity(folder.len() + name.len() + ext.len() + 2);
    if folder != " " {
        out.push_str(folder);
        out.push('/');
    }
    out.push_str(name);
    if ext != " " {
        out.push('.');
        out.push_str(ext);
    }
    out.make_ascii_lowercase();
    if !out.is_ascii() {
        out = out.to_lowercase();
    }
    out
}

/// Where the tree starts and how long it is.
pub fn header(buf: &[u8]) -> Result<(usize, usize)> {
    if buf.len() < 12 || u32_at(buf, 0) != SIGNATURE {
        return Err(VpkError::Signature);
    }
    let header_size = if u32_at(buf, 4) == 2 { 28 } else { 12 };
    Ok((header_size, u32_at(buf, 8) as usize))
}

/// Every entry of the tree in stored order. `visit` returning false stops the walk.
pub fn each_entry(buf: &[u8], mut visit: impl FnMut(&str, &str, &str, &Record) -> bool) -> Result<()> {
    let (mut pos, _) = header(buf)?;
    loop {
        let (ext, next) = read_cstr(buf, pos)?;
        pos = next;
        if ext.is_empty() {
            return Ok(());
        }
        loop {
            let (folder, next) = read_cstr(buf, pos)?;
            pos = next;
            if folder.is_empty() {
                break;
            }
            loop {
                let (name, next) = read_cstr(buf, pos)?;
                pos = next;
                if name.is_empty() {
                    break;
                }
                let rec = read_record(buf, pos)?;
                pos = rec.next;
                if !visit(ext, folder, name, &rec) {
                    return Ok(());
                }
            }
        }
    }
}

/// pak01_dir.vpk -> pak01_007.vpk
pub fn volume_path(dir_path: &Path, idx: u16) -> PathBuf {
    let s = dir_path.to_string_lossy();
    let lower = s.to_ascii_lowercase();
    if lower.ends_with("_dir.vpk") {
        PathBuf::from(format!("{}_{:03}.vpk", &s[..s.len() - 8], idx))
    } else {
        dir_path.to_path_buf()
    }
}

fn read_at(path: &Path, offset: u64, len: usize) -> Result<Vec<u8>> {
    let mut f = File::open(path)?;
    f.seek(SeekFrom::Start(offset))?;
    let mut body = vec![0u8; len];
    let mut got = 0;
    while got < len {
        let n = f.read(&mut body[got..])?;
        if n == 0 {
            break;
        }
        got += n;
    }
    Ok(body)
}

/// One entry's bytes: its preload out of the index and the rest read at its offset on disk.
fn entry_bytes(index: &[u8], dir_path: &Path, inline_base: usize, rec: &Record) -> Result<Vec<u8>> {
    let preload = &index[rec.preload_at..rec.preload_at + rec.preload_bytes as usize];
    if rec.length == 0 {
        return Ok(preload.to_vec());
    }
    let (src, base) = if rec.archive_index == INLINE {
        (dir_path.to_path_buf(), inline_base as u64)
    } else {
        (volume_path(dir_path, rec.archive_index), 0)
    };
    let body = read_at(&src, base + rec.offset as u64, rec.length as usize)?;
    if preload.is_empty() {
        return Ok(body);
    }
    let mut out = Vec::with_capacity(preload.len() + body.len());
    out.extend_from_slice(preload);
    out.extend_from_slice(&body);
    Ok(out)
}

/// The header and tree of a *_dir.vpk off disk, without the payload behind it.
pub fn read_index_file(path: &Path) -> Result<Vec<u8>> {
    let mut f = File::open(path)?;
    let size = f.metadata()?.len() as usize;
    let mut head = [0u8; 28];
    let mut got = 0;
    while got < 28 {
        let n = f.read(&mut head[got..])?;
        if n == 0 {
            break;
        }
        got += n;
    }
    if got < 12 || u32_at(&head, 0) != SIGNATURE {
        return Err(VpkError::Signature);
    }
    let header_size = if u32_at(&head, 4) == 2 { 28 } else { 12 };
    let tree_size = u32_at(&head, 8) as usize;
    if got < header_size || header_size + tree_size > size {
        return Err(VpkError::Signature);
    }
    let mut buf = vec![0u8; header_size + tree_size];
    buf[..header_size].copy_from_slice(&head[..header_size]);
    f.seek(SeekFrom::Start(header_size as u64))?;
    f.read_exact(&mut buf[header_size..])?;
    Ok(buf)
}

/// Every file a VPK holds, by lower-case path, in stored order.
pub fn list_paths(buf: &[u8]) -> Result<Vec<String>> {
    let mut out = Vec::new();
    each_entry(buf, |ext, folder, name, _| {
        out.push(join_path(folder, name, ext));
        true
    })?;
    Ok(out)
}

/// path -> the CRC32 the index stores for it; a repeated path keeps its first place, last crc.
pub fn list_path_crcs(buf: &[u8]) -> Result<IndexMap<String, u32>> {
    let mut out = IndexMap::new();
    each_entry(buf, |ext, folder, name, rec| {
        out.insert(join_path(folder, name, ext), rec.crc);
        true
    })?;
    Ok(out)
}

/// (path, crc) in stored order, duplicates kept: a mod's content signature.
pub fn list_entries(buf: &[u8]) -> Result<Vec<(String, u32)>> {
    let mut out = Vec::new();
    each_entry(buf, |ext, folder, name, rec| {
        out.push((join_path(folder, name, ext), rec.crc));
        true
    })?;
    Ok(out)
}

/// One file's bytes out of a *_dir.vpk, found by a walk of the tree.
pub fn read_entry_file(dir_path: &Path, wanted: &str) -> Result<Option<(Vec<u8>, u32)>> {
    let buf = read_index_file(dir_path)?;
    let (h, t) = header(&buf)?;
    let want = wanted.to_lowercase();
    let mut found = None;
    each_entry(&buf, |ext, folder, name, rec| {
        if join_path(folder, name, ext) != want {
            return true;
        }
        found = Some(*rec);
        false
    })?;
    match found {
        Some(rec) => Ok(Some((entry_bytes(&buf, dir_path, h + t, &rec)?, rec.crc))),
        None => Ok(None),
    }
}

/// A reader over one index that seeks straight to a file: the game's pak01, 388 000 entries.
pub struct Index {
    buf: Vec<u8>,
    dir_path: PathBuf,
    inline_base: usize,
    entries: FxHashMap<String, usize>,
    order: Vec<String>,
}

impl Index {
    pub fn open(dir_path: &Path) -> Result<Self> {
        let buf = read_index_file(dir_path)?;
        let (h, t) = header(&buf)?;
        let mut entries = FxHashMap::with_capacity_and_hasher(400_000, Default::default());
        let mut order = Vec::with_capacity(400_000);
        each_entry(&buf, |ext, folder, name, rec| {
            let p = join_path(folder, name, ext);
            if let std::collections::hash_map::Entry::Vacant(v) = entries.entry(p) {
                order.push(v.key().clone());
                v.insert(rec.preload_at - 18);
            }
            true
        })?;
        Ok(Index { buf, dir_path: dir_path.to_path_buf(), inline_base: h + t, entries, order })
    }
    pub fn size(&self) -> usize {
        self.entries.len()
    }
    pub fn has(&self, p: &str) -> bool {
        self.entries.contains_key(&p.to_lowercase())
    }
    pub fn paths(&self) -> impl Iterator<Item = &str> {
        self.order.iter().map(|s| s.as_str())
    }
    pub fn crc(&self, p: &str) -> Option<u32> {
        let at = *self.entries.get(&p.to_lowercase())?;
        read_record(&self.buf, at).ok().map(|r| r.crc)
    }
    pub fn read(&self, p: &str) -> Result<Option<Vec<u8>>> {
        let Some(&at) = self.entries.get(&p.to_lowercase()) else { return Ok(None) };
        let rec = read_record(&self.buf, at)?;
        entry_bytes(&self.buf, &self.dir_path, self.inline_base, &rec).map(Some)
    }
}

/// Every entry of a _dir.vpk with its bytes, in tree order, following external _NNN archives.
pub fn read_entries(
    dir_buf: &[u8],
    dir_path: &Path,
    archive_path_for: Option<&dyn Fn(u16) -> Result<PathBuf>>,
) -> Result<Vec<Entry>> {
    let (h, t) = header(dir_buf)?;
    let embedded_base = h + t;
    let mut archives: HashMap<u16, Vec<u8>> = HashMap::new();
    let mut records = Vec::new();
    each_entry(dir_buf, |ext, folder, name, rec| {
        records.push((ext.to_string(), folder.to_string(), name.to_string(), *rec));
        true
    })?;
    let mut out = Vec::with_capacity(records.len());
    for (ext, folder, name, rec) in records {
        let preload: Bytes = Arc::from(&dir_buf[rec.preload_at..rec.preload_at + rec.preload_bytes as usize]);
        let data: Bytes = if rec.length > 0 {
            let (start, end, src): (usize, usize, &[u8]) = if rec.archive_index == INLINE {
                let s = embedded_base + rec.offset as usize;
                (s, s + rec.length as usize, dir_buf)
            } else {
                let a = match archives.entry(rec.archive_index) {
                    std::collections::hash_map::Entry::Occupied(o) => o.into_mut(),
                    std::collections::hash_map::Entry::Vacant(v) => {
                        let p = match archive_path_for {
                            Some(f) => f(rec.archive_index)?,
                            None => volume_path(dir_path, rec.archive_index),
                        };
                        v.insert(std::fs::read(p)?)
                    }
                };
                let s = rec.offset as usize;
                (s, s + rec.length as usize, a.as_slice())
            };
            // Buffer.subarray clamps a range past the end; so does this
            let end = end.min(src.len());
            let start = start.min(end);
            Arc::from(&src[start..end])
        } else {
            empty()
        };
        out.push(Entry { ext, folder, name, crc: rec.crc, preload, data });
    }
    Ok(out)
}

/// CRC-32 as the index records it.
pub fn crc32(data: &[u8]) -> u32 {
    crc32fast::hash(data)
}

/// One file for `build`, from its path inside the archive (read the way the game reads it).
pub fn entry_at(rel_path: &str, data: Bytes) -> Entry {
    let norm = rel_path.replace('\\', "/");
    let norm = norm.trim_start_matches('/').to_lowercase();
    let (folder, file) = match norm.rfind('/') {
        Some(i) => (norm[..i].to_string(), &norm[i + 1..]),
        None => (" ".to_string(), norm.as_str()),
    };
    let (name, ext) = match file.rfind('.') {
        Some(i) => (file[..i].to_string(), file[i + 1..].to_string()),
        None => (file.to_string(), " ".to_string()),
    };
    let crc = crc32(&data);
    Entry { ext, folder, name, crc, preload: empty(), data }
}

/// Entries grouped as the index stores them: by extension, then folder, in first-seen order.
fn group<'a, E>(
    entries: &'a [E],
    key: impl Fn(&'a E) -> (&'a str, &'a str),
) -> IndexMap<&'a str, IndexMap<&'a str, Vec<&'a E>>> {
    let mut tree: IndexMap<&str, IndexMap<&str, Vec<&E>>> = IndexMap::new();
    for en in entries {
        let (ext, folder) = key(en);
        tree.entry(ext).or_default().entry(folder).or_default().push(en);
    }
    tree
}

fn tree_bytes<E>(
    tree: &IndexMap<&str, IndexMap<&str, Vec<&E>>>,
    name: impl Fn(&E) -> (&str, u32, &[u8]),
    mut place: impl FnMut(&E) -> (u16, u32, u32),
) -> Vec<u8> {
    let mut out = Vec::new();
    for (ext, folders) in tree {
        out.extend_from_slice(ext.as_bytes());
        out.push(0);
        for (folder, names) in folders {
            out.extend_from_slice(folder.as_bytes());
            out.push(0);
            for en in names {
                let (n, crc, preload) = name(en);
                let (archive, offset, length) = place(en);
                out.extend_from_slice(n.as_bytes());
                out.push(0);
                out.extend_from_slice(&crc.to_le_bytes());
                out.extend_from_slice(&(preload.len() as u16).to_le_bytes());
                out.extend_from_slice(&archive.to_le_bytes());
                out.extend_from_slice(&offset.to_le_bytes());
                out.extend_from_slice(&length.to_le_bytes());
                out.extend_from_slice(&0xffffu16.to_le_bytes());
                out.extend_from_slice(preload);
            }
            out.push(0);
        }
        out.push(0);
    }
    out.push(0);
    out
}

/// A v2 header; the MD5 and signature sections are left at 0.
fn v2_header(tree_size: usize, data_size: usize) -> [u8; 28] {
    let mut h = [0u8; 28];
    h[0..4].copy_from_slice(&SIGNATURE.to_le_bytes());
    h[4..8].copy_from_slice(&2u32.to_le_bytes());
    h[8..12].copy_from_slice(&(tree_size as u32).to_le_bytes());
    h[12..16].copy_from_slice(&(data_size as u32).to_le_bytes());
    h
}

/// One self-contained single-file VPK v2, every entry's data inline. One buffer under many paths
/// (the same allocation, as the TypeScript compares Buffer identity) is written once.
pub fn build(entries: &[Entry]) -> Vec<u8> {
    let tree = group(entries, |e| (e.ext.as_str(), e.folder.as_str()));
    let mut offsets: HashMap<*const Entry, u32> = HashMap::new();
    let mut written: HashMap<*const u8, u32> = HashMap::new();
    let mut chunks: Vec<&[u8]> = Vec::new();
    let mut data_len: usize = 0;
    for folders in tree.values() {
        for names in folders.values() {
            for en in names {
                let key = *en as *const Entry;
                if !en.data.is_empty() {
                    if let Some(&at) = written.get(&en.data.as_ptr()) {
                        offsets.insert(key, at);
                        continue;
                    }
                }
                offsets.insert(key, data_len as u32);
                if !en.data.is_empty() {
                    written.insert(en.data.as_ptr(), data_len as u32);
                    chunks.push(&en.data);
                    data_len += en.data.len();
                }
            }
        }
    }
    let tree_buf = tree_bytes(
        &tree,
        |e| (e.name.as_str(), e.crc, &e.preload),
        |e| (INLINE, offsets.get(&(e as *const Entry)).copied().unwrap_or(0), e.data.len() as u32),
    );
    let mut out = Vec::with_capacity(28 + tree_buf.len() + data_len);
    out.extend_from_slice(&v2_header(tree_buf.len(), data_len));
    out.extend_from_slice(&tree_buf);
    for c in chunks {
        out.extend_from_slice(c);
    }
    out
}

/// A _dir.vpk index pointing into external _NNN archives; no data of its own.
pub fn build_dir(entries: &[DirEntry]) -> Vec<u8> {
    let tree = group(entries, |e| (e.ext.as_str(), e.folder.as_str()));
    let tree_buf =
        tree_bytes(&tree, |e| (e.name.as_str(), e.crc, &e.preload), |e| (e.archive_index, e.offset, e.length));
    let mut out = Vec::with_capacity(28 + tree_buf.len());
    out.extend_from_slice(&v2_header(tree_buf.len(), 0));
    out.extend_from_slice(&tree_buf);
    out
}

pub struct Combined {
    pub dir: String,
    pub parts: Vec<String>,
    pub member_paths: IndexMap<String, Vec<String>>,
    pub conflicts: Vec<(String, String)>,
}

/// Several single-file VPK mods as ONE multi-part VPK written to disk, volume by volume.
/// The first member to provide a path wins; later copies are dropped and listed as conflicts.
pub fn combine_to_files(
    members: &[(String, Vec<u8>)],
    out_dir: &Path,
    out_base: &str,
    volume_cap: usize,
) -> Result<Combined> {
    std::fs::create_dir_all(out_dir)?;
    let part_name = |i: u16| format!("{out_base}_{i:03}.vpk");
    let mut entries = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut conflicts = Vec::new();
    let mut member_paths = IndexMap::new();
    let mut vol_idx: u16 = 0;
    let mut vol_pos: usize = 0;
    let mut parts = vec![part_name(0)];
    let mut f = File::create(out_dir.join(part_name(0)))?;
    let refuse = |_: u16| -> Result<PathBuf> { Err(VpkError::NotSingle) };
    for (key, buf) in members {
        let mem = read_entries(buf, Path::new(""), Some(&refuse))?;
        let mine: &mut Vec<String> = member_paths.entry(key.clone()).or_default();
        for en in mem {
            let p = en.path();
            if !seen.insert(p.clone()) {
                conflicts.push((key.clone(), p));
                continue;
            }
            mine.push(p);
            if !en.data.is_empty() && vol_pos > 0 && vol_pos + en.data.len() > volume_cap {
                f.flush()?;
                vol_idx += 1;
                vol_pos = 0;
                f = File::create(out_dir.join(part_name(vol_idx)))?;
                parts.push(part_name(vol_idx));
            }
            let offset = vol_pos;
            if !en.data.is_empty() {
                f.write_all(&en.data)?;
                vol_pos += en.data.len();
            }
            entries.push(DirEntry {
                ext: en.ext,
                folder: en.folder,
                name: en.name,
                crc: en.crc,
                preload: en.preload,
                archive_index: vol_idx,
                offset: offset as u32,
                length: en.data.len() as u32,
            });
        }
    }
    f.flush()?;
    drop(f);
    std::fs::write(out_dir.join(format!("{out_base}_dir.vpk")), build_dir(&entries))?;
    Ok(Combined { dir: format!("{out_base}_dir.vpk"), parts, member_paths, conflicts })
}

/// A multi-part VPK rewritten as one self-contained file, bytes, CRCs and preload preserved.
pub fn merge_to_single(dir_path: &Path) -> Result<Vec<u8>> {
    let buf = std::fs::read(dir_path)?;
    Ok(build(&read_entries(&buf, dir_path, None)?))
}

fn sha1_hex(data: &[u8]) -> String {
    hex(&Sha1::digest(data))
}

fn hex(bytes: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(H[(b >> 4) as usize] as char);
        s.push(H[(b & 15) as usize] as char);
    }
    s
}

/// JavaScript's default sort compares UTF-16 code units; for the ASCII a tree holds that is
/// byte order, and for anything else this keeps the JavaScript order exactly.
fn js_sort(rows: &mut [String]) {
    if rows.iter().all(|r| r.is_ascii()) {
        rows.sort_unstable();
    } else {
        rows.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    }
}

/// sha1 over the sorted "path:crc" lines: the same mod hashes the same however it is packed.
pub fn fingerprint_entries(entries: &[(String, u32)]) -> String {
    let mut rows: Vec<String> = entries.iter().map(|(p, c)| format!("{p}:{c}")).collect();
    js_sort(&mut rows);
    sha1_hex(rows.join("\n").as_bytes())
}

pub fn fingerprint_vpk(buf: &[u8]) -> Result<String> {
    Ok(fingerprint_entries(&list_entries(buf)?))
}

/// A loose-file mod: sha1 over sorted "path:sha1(bytes)".
pub fn fingerprint_files(files: &[(String, &[u8])]) -> String {
    let mut rows: Vec<String> = files.iter().map(|(p, d)| format!("{p}:{}", sha1_hex(d))).collect();
    js_sort(&mut rows);
    sha1_hex(rows.join("\n").as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(s: &str) -> Bytes {
        Arc::from(s.as_bytes())
    }

    #[test]
    fn round_trip_through_build_and_read() {
        let shared = bytes("same model");
        let entries = vec![
            entry_at("models/heroes/axe/axe.vmdl_c", shared.clone()),
            entry_at("models/heroes/axe/axe_alt.vmdl_c", shared.clone()),
            entry_at("README", bytes("no ext")),
            entry_at("particles\\x.vpcf_c", bytes("fx")),
        ];
        let buf = build(&entries);
        let paths = list_paths(&buf).unwrap();
        assert_eq!(
            paths,
            vec!["models/heroes/axe/axe.vmdl_c", "models/heroes/axe/axe_alt.vmdl_c", "readme", "particles/x.vpcf_c"]
        );
        let back = read_entries(&buf, Path::new("x_dir.vpk"), None).unwrap();
        assert_eq!(&*back[0].data, b"same model");
        assert_eq!(&*back[1].data, b"same model");
        assert_eq!(&*back[2].data, b"no ext");
        // the shared buffer is in the file once
        let count = buf.windows(10).filter(|w| *w == b"same model").count();
        assert_eq!(count, 1);
        assert_eq!(back[3].crc, crc32(b"fx"));
    }

    #[test]
    fn a_cut_tree_is_a_refusal_not_a_panic() {
        let buf = build(&[entry_at("a/b.txt", bytes("hello")), entry_at("a/c.txt", bytes("world"))]);
        for cut in 0..buf.len() {
            let _ = list_paths(&buf[..cut]);
            let _ = read_entries(&buf[..cut], Path::new("x_dir.vpk"), None);
        }
    }

    #[test]
    fn fingerprint_ignores_packing() {
        let a = build(&[entry_at("a/b.txt", bytes("1")), entry_at("c/d.txt", bytes("2"))]);
        let b = build(&[entry_at("c/d.txt", bytes("2")), entry_at("a/b.txt", bytes("1"))]);
        assert_eq!(fingerprint_vpk(&a).unwrap(), fingerprint_vpk(&b).unwrap());
    }
}
