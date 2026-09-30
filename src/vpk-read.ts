// Reading a Source-engine VPK: the index of a "_dir" file (v1/v2), the files it lists and their
// bytes, and the content fingerprint that recognises a mod whatever it is packed as. Part of the
// VPK code src/vpk.ts gathers; writing is src/vpk-write.ts, what a mod changes src/vpk-analyze.ts.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { t } from './i18n.ts';

/** The first four bytes of every VPK index. */
export const VPK_SIGNATURE = 0x55aa1234;

/** One file inside a VPK, with its bytes: what readVpkEntries hands out and buildVpk takes. */
export interface VpkEntry { ext: string; folder: string; name: string; crc: number; preload: Buffer; data: Buffer }

/** An entry of a multi-part index: where its bytes sit in the _NNN volumes, not the bytes. */
export interface VpkDirEntry {
  ext: string; folder: string; name: string; crc: number; preload: Buffer;
  archiveIndex: number; offset: number; length: number;
}

/** A reader over one index that seeks straight to a file; see openVpkIndex. */
export interface VpkIndex { size: number; has(p: string): boolean; read(p: string): Buffer | null }

/** Resolves external archive N of a multi-part VPK to its path on disk. */
export type ArchivePathFor = (idx: number) => string;

function readCString(buf: Buffer, pos: number): { str: string; next: number } {
  const end = buf.indexOf(0, pos);
  if (end === -1) throw new Error(t('VPK: незакрытая строка в дереве'));
  return { str: buf.toString('utf-8', pos, end), next: end + 1 };
}

/* One entry of the tree, read only when all of it is there.
 *
 * Layout: crc(4) preloadBytes(2) archiveIndex(2) offset(4) length(4) terminator(2), then the
 * preload block. The six walkers below used to read those fields straight out of the buffer at
 * whatever offset the tree claimed, and a file cut short - or one whose preload length was a
 * fiction - came back as a RangeError from Buffer. That is not a refusal this app makes, and the
 * callers do not catch it: src/installer.js walks the mod folder on every start and
 * src/minify.ts reads another tool's files, neither inside a try. Measured on a three-entry VPK:
 * 54 of its truncations escaped that way (test/vpk-fuzz.test.ts).
 *
 * `next` is always at least 18 bytes past `pos`, so a tree cannot stall a walker either.
 */
function readEntryRecord(buf: Buffer, pos: number) {
  if (pos < 0 || pos + 18 > buf.length) throw new Error(t('VPK: повреждённое дерево'));
  const preloadBytes = buf.readUInt16LE(pos + 4);
  const preloadAt = pos + 18;
  if (preloadAt + preloadBytes > buf.length) throw new Error(t('VPK: повреждённое дерево'));
  return {
    crc: buf.readUInt32LE(pos),
    preloadBytes,
    archiveIndex: buf.readUInt16LE(pos + 6),
    offset: buf.readUInt32LE(pos + 8),
    length: buf.readUInt32LE(pos + 12),
    preloadAt,
    next: preloadAt + preloadBytes,
  };
}

// A VPK tree stores "empty" as a single space, for the folder AND for the extension.
// Only the folder case used to be handled, so an extension-less entry came out as
// "name. " — Dota 2 Skinchanger writes a whole decoy tree of those, and every one of
// them showed up as a bogus game path in analysis and conflict checks.
function joinPath(folder: string, name: string, ext: string): string {
  const dir = folder === ' ' ? '' : folder + '/';
  const suffix = ext === ' ' ? '' : '.' + ext;
  return `${dir}${name}${suffix}`.toLowerCase();
}

/**
 * Read only the header + directory tree of a *_dir.vpk off disk. A self-contained mod
 * is tens of MB of payload sitting behind a few KB of index, and the index is all any
 * of the listing/analysis/fingerprint helpers ever touch — so scanning a whole library
 * never has to pull the payloads into memory.
 * @returns header + tree — what every listing / analysis helper here parses
 */
export function readVpkIndexFile(filePath: string): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(28);
    const got = fs.readSync(fd, head, 0, 28, 0);
    if (got < 12 || head.readUInt32LE(0) !== VPK_SIGNATURE) throw new Error(t('VPK: неверная сигнатура'));
    const version = head.readUInt32LE(4);
    const treeSize = head.readUInt32LE(8);
    const headerSize = version === 2 ? 28 : 12;
    const size = fs.fstatSync(fd).size;
    if (got < headerSize || headerSize + treeSize > size) throw new Error(t('VPK: неверная сигнатура'));
    const buf = Buffer.alloc(headerSize + treeSize);
    head.copy(buf, 0, 0, headerSize);
    fs.readSync(fd, buf, headerSize, treeSize, headerSize);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Every file a VPK holds, by path.
 * @param buf contents of a *_dir.vpk file
 * @returns lowercased inner paths like "materials/water/water_ti10_000.vmat_c"
 */
export function listVpkPaths(buf: Buffer): string[] {
  if (buf.length < 12 || buf.readUInt32LE(0) !== VPK_SIGNATURE) {
    throw new Error(t('VPK: неверная сигнатура'));
  }
  const version = buf.readUInt32LE(4);
  let pos = version === 2 ? 28 : 12; // v2 header carries 16 extra bytes of section sizes

  const paths: string[] = [];
  for (;;) {
    const ext = readCString(buf, pos);
    pos = ext.next;
    if (!ext.str) break;
    for (;;) {
      const folder = readCString(buf, pos);
      pos = folder.next;
      if (!folder.str) break;
      for (;;) {
        const name = readCString(buf, pos);
        pos = name.next;
        if (!name.str) break;
        pos = readEntryRecord(buf, pos).next;
        paths.push(joinPath(folder.str, name.str, ext.str));
      }
    }
  }
  return paths;
}

/** listVpkPaths for a file on disk, reading only its index. */
export function listVpkPathsFile(filePath: string): string[] {
  return listVpkPaths(readVpkIndexFile(filePath));
}

/**
 * Like listVpkPaths, but returns each inner path together with the CRC32 the VPK index
 * stores for it. Two mods that carry a byte-identical filler asset share the same CRC, so
 * comparing CRCs (not just paths) tells a real override apart from a coincidental shared file.
 * @param buf contents of a *_dir.vpk file
 * @returns lowercased inner path -> crc32
 */
export function listVpkPathCrcs(buf: Buffer): Map<string, number> {
  if (buf.length < 12 || buf.readUInt32LE(0) !== VPK_SIGNATURE) {
    throw new Error(t('VPK: неверная сигнатура'));
  }
  const version = buf.readUInt32LE(4);
  let pos = version === 2 ? 28 : 12;
  const map = new Map<string, number>();
  for (;;) {
    const ext = readCString(buf, pos);
    pos = ext.next;
    if (!ext.str) break;
    for (;;) {
      const folder = readCString(buf, pos);
      pos = folder.next;
      if (!folder.str) break;
      for (;;) {
        const name = readCString(buf, pos);
        pos = name.next;
        if (!name.str) break;
        const rec = readEntryRecord(buf, pos);
        pos = rec.next;
        map.set(joinPath(folder.str, name.str, ext.str), rec.crc);
      }
    }
  }
  return map;
}

/** listVpkPathCrcs for a file on disk, reading only its index. */
export function listVpkPathCrcsFile(filePath: string): Map<string, number> {
  return listVpkPathCrcs(readVpkIndexFile(filePath));
}

/**
 * Read the bytes of ONE file out of a *_dir.vpk without touching the rest. The game's
 * own pak01 is a 25 GB set behind a 22 MB index, so pulling items_game.txt out of it
 * has to be a seek, not a walk: index (already memo-cached) -> offset -> single read.
 * @param dirPath  path to the *_dir.vpk
 * @param wanted   lowercased inner path, e.g. "scripts/items/items_game.txt"
 */
export function readVpkEntryFile(dirPath: string, wanted: string): { data: Buffer; crc: number } | null {
  const buf = readVpkIndexFile(dirPath);
  const version = buf.readUInt32LE(4);
  const treeSize = buf.readUInt32LE(8);
  const headerSize = version === 2 ? 28 : 12;
  const want = wanted.toLowerCase();
  let pos = headerSize;
  for (;;) {
    const ext = readCString(buf, pos); pos = ext.next; if (!ext.str) break;
    for (;;) {
      const folder = readCString(buf, pos); pos = folder.next; if (!folder.str) break;
      for (;;) {
        const name = readCString(buf, pos); pos = name.next; if (!name.str) break;
        const { crc, preloadBytes, archiveIndex, offset, length, preloadAt, next } = readEntryRecord(buf, pos);
        pos = next;
        if (joinPath(folder.str, name.str, ext.str) !== want) continue;

        const preload = preloadBytes ? Buffer.from(buf.subarray(preloadAt, preloadAt + preloadBytes)) : EMPTY;
        if (!length) return { data: preload, crc };
        const src = archiveIndex === INLINE
          ? dirPath
          : dirPath.replace(/_dir\.vpk$/i, `_${String(archiveIndex).padStart(3, '0')}.vpk`);
        const base = archiveIndex === INLINE ? headerSize + treeSize : 0;
        const body = Buffer.alloc(length);
        const fd = fs.openSync(src, 'r');
        try {
          let read = 0;
          while (read < length) {
            const got = fs.readSync(fd, body, read, length - read, base + offset + read);
            if (!got) break;
            read += got;
          }
        } finally {
          fs.closeSync(fd);
        }
        return { data: preloadBytes ? Buffer.concat([preload, body]) : body, crc };
      }
    }
  }
  return null;
}

/**
 * The same seek, for callers with a list rather than one name.
 *
 * readVpkEntryFile walks the tree on every call, which is right for the one file it was
 * written for and wrong for sixty: the game's index holds 384 001 entries and re-reading it
 * per icon costs seconds. This walks it once and hands back a reader that seeks.
 * @param dirPath path to the *_dir.vpk
 */
export function openVpkIndex(dirPath: string): VpkIndex {
  const buf = readVpkIndexFile(dirPath);
  const version = buf.readUInt32LE(4);
  const treeSize = buf.readUInt32LE(8);
  const headerSize = version === 2 ? 28 : 12;
  const inlineBase = headerSize + treeSize;
  const entries = new Map<string, { preloadAt: number; preloadBytes: number; archiveIndex: number; offset: number; length: number }>();
  let pos = headerSize;
  for (;;) {
    const ext = readCString(buf, pos); pos = ext.next; if (!ext.str) break;
    for (;;) {
      const folder = readCString(buf, pos); pos = folder.next; if (!folder.str) break;
      for (;;) {
        const name = readCString(buf, pos); pos = name.next; if (!name.str) break;
        const { preloadBytes, archiveIndex, offset, length, preloadAt, next } = readEntryRecord(buf, pos);
        pos = next;
        entries.set(joinPath(folder.str, name.str, ext.str), { preloadAt, preloadBytes, archiveIndex, offset, length });
      }
    }
  }
  const read = (wanted: string): Buffer | null => {
    const e = entries.get(String(wanted).toLowerCase());
    if (!e) return null;
    const preload = e.preloadBytes ? Buffer.from(buf.subarray(e.preloadAt, e.preloadAt + e.preloadBytes)) : EMPTY;
    if (!e.length) return preload;
    const src = e.archiveIndex === INLINE
      ? dirPath
      : dirPath.replace(/_dir\.vpk$/i, `_${String(e.archiveIndex).padStart(3, '0')}.vpk`);
    const base = e.archiveIndex === INLINE ? inlineBase : 0;
    const body = Buffer.alloc(e.length);
    const fd = fs.openSync(src, 'r');
    try {
      let got = 0;
      while (got < e.length) {
        const n = fs.readSync(fd, body, got, e.length - got, base + e.offset + got);
        if (!n) break;
        got += n;
      }
    } finally {
      fs.closeSync(fd);
    }
    return e.preloadBytes ? Buffer.concat([preload, body]) : body;
  };
  return {
    size: entries.size,
    has: (p: string) => entries.has(String(p).toLowerCase()),
    read,
  };
}

/** A preload or data section with nothing in it. */
export const EMPTY = Buffer.alloc(0);
/** The archiveIndex meaning "data lives in the _dir file itself". */
export const INLINE = 0x7fff;

/** Full inner path of a read entry, lowercased (" " means the root / no extension). */
export function entryPath(en: { folder: string; name: string; ext: string }): string {
  return joinPath(en.folder, en.name, en.ext);
}

/** Read every entry of a _dir.vpk (following external _NNN archives) into a flat list
 * with its bytes, in on-disk tree order. */
export function readVpkEntries(dirBuf: Buffer, dirPath: string, archivePathFor?: ArchivePathFor | null): VpkEntry[] {
  if (dirBuf.length < 12 || dirBuf.readUInt32LE(0) !== VPK_SIGNATURE) {
    throw new Error(t('VPK: неверная сигнатура'));
  }
  const version = dirBuf.readUInt32LE(4);
  const treeSize = dirBuf.readUInt32LE(8);
  const headerSize = version === 2 ? 28 : 12;
  const embeddedBase = headerSize + treeSize; // where inline (0x7fff) data sits

  const archiveCache = new Map<number, Buffer>();
  const readArchive = (idx: number): Buffer => {
    if (idx === INLINE) return dirBuf;
    let archive = archiveCache.get(idx);
    if (!archive) {
      const p = archivePathFor
        ? archivePathFor(idx)
        : dirPath.replace(/_dir\.vpk$/i, `_${String(idx).padStart(3, '0')}.vpk`);
      archive = fs.readFileSync(p);
      archiveCache.set(idx, archive);
    }
    return archive;
  };

  const entries: VpkEntry[] = [];
  let pos = headerSize;
  for (;;) {
    const ext = readCString(dirBuf, pos); pos = ext.next; if (!ext.str) break;
    for (;;) {
      const folder = readCString(dirBuf, pos); pos = folder.next; if (!folder.str) break;
      for (;;) {
        const name = readCString(dirBuf, pos); pos = name.next; if (!name.str) break;
        const rec = readEntryRecord(dirBuf, pos);
        const { crc, preloadBytes, archiveIndex, preloadAt } = rec;
        const entryOffset = rec.offset;
        const entryLength = rec.length;
        pos = rec.next;
        const preload = preloadBytes ? Buffer.from(dirBuf.subarray(preloadAt, preloadAt + preloadBytes)) : EMPTY;
        let data: Buffer = EMPTY;
        if (entryLength > 0) {
          const src = readArchive(archiveIndex);
          const base = archiveIndex === INLINE ? embeddedBase : 0;
          data = src.subarray(base + entryOffset, base + entryOffset + entryLength);
        }
        entries.push({ ext: ext.str, folder: folder.str, name: name.str, crc, preload, data });
      }
    }
  }
  return entries;
}

/** Content fingerprint of a mod: sha1 over its sorted (path:crc) index. Independent of
 * packaging (multi-part vs single, filename), so the same mod installed from the site,
 * from another tool, or via this app all hash identically — the basis for recognising
 * a foreign vpk as a specific catalog mod. */
export function fingerprintEntries(entries: { path: string; crc: number }[]): string {
  const canon = entries.map((e) => `${e.path}:${e.crc}`).sort().join('\n');
  return crypto.createHash('sha1').update(canon).digest('hex');
}

/** fingerprintEntries over one VPK's index. */
export function fingerprintVpk(buf: Buffer): string {
  return fingerprintEntries(listVpkEntries(buf));
}

/** Content fingerprint of a loose-file mod (cursors, fonts): sha1 over sorted
 * "path:sha1(bytes)". Paths should already be normalized (top folder stripped,
 * lowercased) so it reproduces from either the source zip or the installed files. */
export function fingerprintFiles(files: { path: string; data: Buffer }[]): string {
  const rows = files.map((f) => `${f.path}:${crypto.createHash('sha1').update(f.data).digest('hex')}`);
  return crypto.createHash('sha1').update(rows.sort().join('\n')).digest('hex');
}

/** Lightweight (path, crc) list — the mod's content signature, no archive reads. */
export function listVpkEntries(buf: Buffer): { path: string; crc: number }[] {
  if (buf.length < 12 || buf.readUInt32LE(0) !== VPK_SIGNATURE) throw new Error(t('VPK: неверная сигнатура'));
  const version = buf.readUInt32LE(4);
  let pos = version === 2 ? 28 : 12;
  const out: { path: string; crc: number }[] = [];
  for (;;) {
    const ext = readCString(buf, pos); pos = ext.next; if (!ext.str) break;
    for (;;) {
      const folder = readCString(buf, pos); pos = folder.next; if (!folder.str) break;
      for (;;) {
        const name = readCString(buf, pos); pos = name.next; if (!name.str) break;
        const rec = readEntryRecord(buf, pos);
        pos = rec.next;
        out.push({ path: joinPath(folder.str, name.str, ext.str), crc: rec.crc >>> 0 });
      }
    }
  }
  return out;
}
