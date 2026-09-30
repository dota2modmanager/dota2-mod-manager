// Writing a Source-engine VPK: one self-contained file from a list of entries or a folder of loose
// files, a multi-part index over data volumes, and a merged pack split back by hero. Part of the
// VPK code src/vpk.ts gathers; the format itself is read in src/vpk-read.ts.
import { crc32 as zlibCrc32 } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.ts';
import {
  VPK_SIGNATURE, EMPTY, INLINE, readVpkEntries, entryPath,
  type VpkEntry, type VpkDirEntry, type ArchivePathFor,
} from './vpk-read.ts';
import { analyzeVpkPaths, subjectHeroes } from './vpk-analyze.ts';

/* The VPK index carries a CRC32 per entry. It was a table written out by hand while the Node
   inside Electron had no zlib.crc32; Electron 44 has Node 24, which does, and computes it natively.
   src/schema.ts re-exports this one. */
/** CRC-32 as the VPK index records it for each entry. */
export function crc32(buf: Buffer): number {
  return zlibCrc32(buf);
}

/**
 * One file for buildVpk, from its path inside the archive and its bytes. The path is read the
 * way the game reads it: forward slashes, lower case, no leading slash, and " " for a file at the
 * root or one with no extension.
 */
export function entryAt(relPath: string, data: Buffer): VpkEntry {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const slash = norm.lastIndexOf('/');
  const file = slash === -1 ? norm : norm.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return {
    ext: dot === -1 ? ' ' : file.slice(dot + 1),
    folder: slash === -1 ? ' ' : norm.slice(0, slash),
    name: dot === -1 ? file : file.slice(0, dot),
    data,
    preload: EMPTY,
    crc: crc32(data),
  };
}

/** Build one self-contained single-file VPK v2 from a flat entry list. Groups entries
 * by ext -> folder (first-seen order), embeds every entry's data inline (0x7fff). */
export function buildVpk(entries: VpkEntry[]): Buffer {
  const tree = new Map<string, Map<string, VpkEntry[]>>();
  for (const en of entries) {
    let folders = tree.get(en.ext); if (!folders) { folders = new Map(); tree.set(en.ext, folders); }
    let names = folders.get(en.folder); if (!names) { names = []; folders.set(en.folder, names); }
    names.push(en);
  }

  const dataChunks: Buffer[] = [];
  const offsets = new Map<VpkEntry, number>();
  let dataLen = 0;
  for (const [, folders] of tree) for (const [, names] of folders) for (const en of names) {
    offsets.set(en, dataLen);
    if (en.data.length) { dataChunks.push(en.data); dataLen += en.data.length; }
  }

  const z = Buffer.from([0]);
  const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'utf-8'), z]);
  const parts: Buffer[] = [];
  for (const [ext, folders] of tree) {
    parts.push(cstr(ext));
    for (const [folder, names] of folders) {
      parts.push(cstr(folder));
      for (const en of names) {
        parts.push(cstr(en.name));
        const meta = Buffer.alloc(18);
        meta.writeUInt32LE(en.crc >>> 0, 0);
        meta.writeUInt16LE(en.preload.length, 4);
        meta.writeUInt16LE(INLINE, 6);
        meta.writeUInt32LE((offsets.get(en) ?? 0) >>> 0, 8);
        meta.writeUInt32LE(en.data.length >>> 0, 12);
        meta.writeUInt16LE(0xffff, 16);
        parts.push(meta);
        if (en.preload.length) parts.push(en.preload);
      }
      parts.push(z); // end of names in this folder
    }
    parts.push(z); // end of folders for this ext
  }
  parts.push(z); // end of extensions
  const treeBuf = Buffer.concat(parts);

  const header = Buffer.alloc(28);
  header.writeUInt32LE(VPK_SIGNATURE, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(treeBuf.length, 8);
  header.writeUInt32LE(dataLen, 12); // fileDataSectionSize; MD5/signature sections left at 0
  return Buffer.concat([header, treeBuf, ...dataChunks]);
}

// ---------- packing a folder of loose files into a mod ----------

// The folders the game itself mounts. A mod author's working copy is a tree of these, and
// finding which directory they sit directly under is what tells us where the archive's root
// is - get that wrong and the mod installs, mounts, and changes nothing, because every path
// inside it is off by a folder.
const GAME_ROOTS = new Set([
  'models', 'materials', 'particles', 'panorama', 'sounds', 'soundevents',
  'scripts', 'resource', 'maps', 'vscripts', 'shaders', 'expressions',
]);

// Not content, and not something an author means to ship.
const JUNK = /^(thumbs\.db|desktop\.ini|\.ds_store|\.git|\.gitignore|\.svn|__macosx)$/i;

/**
 * Where the mod's content actually starts under `dir`.
 *
 * An author points at "MyMod", but the tree underneath may be MyMod/models/..., or the
 * game-shaped MyMod/game/dota_russian/models/..., or a single wrapper folder left by
 * unzipping. Whatever it is, the archive root is the directory that holds the game's own
 * folders - and everything beside them comes too: measured over 84 installed mods, 35 carry
 * a top folder of the author's own (dota2pornfx/, amir4an/, models123/) next to the
 * canonical ones, and three ship a readme.
 *
 * @returns absolute path, or null if nothing game-shaped is under there
 */
export function findContentRoot(dir: string, depth = 0): string | null {
  if (depth > 6) return null;
  let names: fs.Dirent[];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const dirs = names.filter((e) => e.isDirectory() && !JUNK.test(e.name));
  if (dirs.some((e) => GAME_ROOTS.has(e.name.toLowerCase()))) return dir;
  // no game folder here: follow the wrappers down, and only while they are unambiguous
  for (const e of dirs) {
    const hit = findContentRoot(path.join(dir, e.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}

// One buffer holds the whole archive while it is being built, so this is where a folder
// stops being something we can pack in one piece. The largest real mod measured is 46 MB;
// a gigabyte is twenty times that and still far below what a Buffer can hold.
const MAX_FOLDER_BYTES = 1024 * 1024 * 1024;

/**
 * Pack a folder of loose game files into a single self-contained VPK - the other half of
 * importing, for the author who has the files but not the archive.
 * @param root the content root (see findContentRoot)
 */
export function packFolder(root: string): Buffer {
  const entries: VpkEntry[] = [];
  let total = 0;
  const walk = (dir: string, prefix: string): void => {
    let names: fs.Dirent[];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (JUNK.test(e.name)) continue;
      // a symlink is somebody else's file, and following one can walk in a circle
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(full, rel); continue; }
      if (!e.isFile()) continue;
      let data: Buffer;
      try { data = fs.readFileSync(full); } catch { continue; }
      total += data.length;
      if (total > MAX_FOLDER_BYTES) throw new Error(t('Папка слишком большая, чтобы собрать её в один VPK'));
      // the game looks files up in lower case, and so does every reader here
      const lower = rel.toLowerCase();
      const slash = lower.lastIndexOf('/');
      const file = slash === -1 ? lower : lower.slice(slash + 1);
      const dot = file.lastIndexOf('.');
      entries.push({
        ext: dot === -1 ? ' ' : file.slice(dot + 1),
        folder: slash === -1 ? ' ' : lower.slice(0, slash),
        name: dot === -1 ? file : file.slice(0, dot),
        data,
        preload: EMPTY,
        crc: crc32(data),
      });
    }
  };
  walk(root, '');
  if (!entries.length) throw new Error(t('В папке нет файлов'));
  return buildVpk(entries);
}

/** Build a _dir.vpk index that references data in *external* archives (_NNN.vpk). Entries
 * must already carry { archiveIndex, offset, length } pointing into those archives. Unlike
 * buildVpk (single-file, inline 0x7fff) this holds no file data — the tree only. */
export function buildVpkDir(entries: VpkDirEntry[]): Buffer {
  const tree = new Map<string, Map<string, VpkDirEntry[]>>();
  for (const en of entries) {
    let folders = tree.get(en.ext); if (!folders) { folders = new Map(); tree.set(en.ext, folders); }
    let names = folders.get(en.folder); if (!names) { names = []; folders.set(en.folder, names); }
    names.push(en);
  }
  const z = Buffer.from([0]);
  const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'utf-8'), z]);
  const parts: Buffer[] = [];
  for (const [ext, folders] of tree) {
    parts.push(cstr(ext));
    for (const [folder, names] of folders) {
      parts.push(cstr(folder));
      for (const en of names) {
        parts.push(cstr(en.name));
        const meta = Buffer.alloc(18);
        meta.writeUInt32LE(en.crc >>> 0, 0);
        meta.writeUInt16LE(en.preload.length, 4);
        meta.writeUInt16LE(en.archiveIndex & 0xffff, 6);
        meta.writeUInt32LE(en.offset >>> 0, 8);
        meta.writeUInt32LE(en.length >>> 0, 12);
        meta.writeUInt16LE(0xffff, 16);
        parts.push(meta);
        if (en.preload.length) parts.push(en.preload);
      }
      parts.push(z); // end of names
    }
    parts.push(z); // end of folders
  }
  parts.push(z); // end of extensions
  const treeBuf = Buffer.concat(parts);

  const header = Buffer.alloc(28);
  header.writeUInt32LE(VPK_SIGNATURE, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(treeBuf.length, 8);
  header.writeUInt32LE(0, 12); // no inline data section — all data lives in _NNN archives
  return Buffer.concat([header, treeBuf]);
}

/**
 * Combine several independent single-file VPK mods into ONE multi-part VPK
 * (<base>_dir.vpk index + <base>_NNN.vpk data volumes) written straight to disk. This is
 * how many mods share a single pakNN slot — the game caps usable pak numbers at 99, so
 * packing lets a library grow past that. Data is streamed volume-by-volume (each capped at
 * `volumeCap`) so a multi-GB pack never has to sit in memory at once.
 *
 * When two members provide the same inner path the first member wins and the later one's
 * copy is dropped (recorded in `conflicts`) — a merged VPK can't hold two files at one path.
 *
 * @param members  self-contained VPK buffers, in priority order
 * @param outDir   directory to write <base>_dir.vpk and volumes into
 * @param outBase  slot base name, e.g. "pak10"
 */
export function combineVpksToFiles(members: { key: string; buf: Buffer }[], outDir: string, outBase: string, { volumeCap = 1 << 30 }: { volumeCap?: number } = {}): {
  dir: string; parts: string[]; memberPaths: Record<string, string[]>; conflicts: { key: string; path: string }[];
} {
  fs.mkdirSync(outDir, { recursive: true });
  const entries: VpkDirEntry[] = [];
  const seen = new Set<string>();
  const conflicts: { key: string; path: string }[] = [];
  const memberPaths: Record<string, string[]> = {};
  const partName = (i: number) => `${outBase}_${String(i).padStart(3, '0')}.vpk`;

  let volIdx = 0;
  let volPos = 0;
  let fd = fs.openSync(path.join(outDir, partName(0)), 'w');
  const parts = [partName(0)];
  const rollVolume = () => {
    fs.closeSync(fd);
    volIdx++; volPos = 0;
    fd = fs.openSync(path.join(outDir, partName(volIdx)), 'w');
    parts.push(partName(volIdx));
  };

  try {
    for (const m of members) {
      const memEntries = readVpkEntries(m.buf, '', () => { throw new Error('combine: member must be single-file'); });
      memberPaths[m.key] = [];
      for (const en of memEntries) {
        const p = entryPath(en);
        if (seen.has(p)) { conflicts.push({ key: m.key, path: p }); continue; }
        seen.add(p);
        memberPaths[m.key].push(p);
        // never split one file across volumes; roll to a fresh volume if it wouldn't fit
        if (en.data.length && volPos > 0 && volPos + en.data.length > volumeCap) rollVolume();
        const offset = volPos;
        if (en.data.length) { fs.writeSync(fd, en.data, 0, en.data.length, volPos); volPos += en.data.length; }
        entries.push({
          ext: en.ext, folder: en.folder, name: en.name, crc: en.crc, preload: en.preload,
          archiveIndex: volIdx, offset, length: en.data.length,
        });
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  fs.writeFileSync(path.join(outDir, `${outBase}_dir.vpk`), buildVpkDir(entries));
  return { dir: `${outBase}_dir.vpk`, parts, memberPaths, conflicts };
}

/**
 * Rewrites a multi-part VPK (_dir.vpk + _000.vpk, _001.vpk…) into one self-contained
 * single-file VPK v2 with every entry's data embedded — the format the Dota2PornFx
 * catalog uses. Data is copied byte-for-byte; CRCs and preload are preserved.
 *
 * @param dirPath  path to the *_dir.vpk index file
 * @param archivePathFor  resolves external archive N to a path
 * @returns the merged single-file VPK
 */
export function mergeVpkToSingle(dirPath: string, archivePathFor?: ArchivePathFor | null): Buffer {
  return buildVpk(readVpkEntries(fs.readFileSync(dirPath), dirPath, archivePathFor));
}

/**
 * Split a merged multi-hero VPK into one self-contained VPK per detected hero — the
 * inverse of tools that pack several skins into one file (e.g. Dota 2 Skinchanger).
 * A file that clearly belongs to a hero (…/heroes/<hero>/… or …/hero_<hero>/…) goes to
 * that hero; everything else (shared stock, cross-hero assets) is copied into every
 * output so each result stands alone and installs/removes independently.
 *
 * @returns empty if <2 heroes.
 */
export function splitVpkByHero(dirPath: string, archivePathFor?: ArchivePathFor | null): { id: string; name: string; buf: Buffer; paths: string[] }[] {
  const dirBuf = fs.readFileSync(dirPath);
  const entries = readVpkEntries(dirBuf, dirPath, archivePathFor);
  const paths = entries.map(entryPath);
  // Only a hero the file is really about can become a part of its own: one named by a stray
  // material is a reference, one it borrowed a single prop from is a loan, and a "part"
  // holding nothing but the shared leftovers is not a mod.
  const heroes = subjectHeroes(analyzeVpkPaths(paths)).filter((h) => h.models > 0);
  if (heroes.length < 2) return [];
  const ids = heroes.map((h) => h.id);
  // Canonical layouts first. Then any folder named after a hero we already found in this
  // pack: Skinchanger writes its own content root ("8213/particles/morphling/…"), and
  // without this those files would be copied into every part instead of just that hero's.
  const ownerOf = (p: string): string | null => ids.find((id) =>
    p.includes(`/heroes/${id}/`) || p.startsWith(`heroes/${id}/`) ||
    p.includes(`/hero_${id}/`) || p.startsWith(`hero_${id}/`))
    || ids.find((id) => p.includes(`/${id}/`) || p.startsWith(`${id}/`))
    // ability icons and the like are named after their hero rather than filed under it
    || ids.find((id) => (p.split('/').pop() || '').startsWith(`${id}_`))
    || null;

  const buckets = new Map<string, VpkEntry[]>(ids.map((id) => [id, []]));
  const shared: VpkEntry[] = [];
  entries.forEach((en, i) => {
    const owner = ownerOf(paths[i]);
    if (owner) buckets.get(owner)?.push(en); else shared.push(en);
  });
  return heroes.map((h) => {
    const own = buckets.get(h.id) || [];
    return {
      id: h.id,
      name: h.name,
      buf: buildVpk([...own, ...shared]),
      // what this part actually owns — the caller hands each part the item-schema blocks
      // that talk about its own files
      paths: own.map(entryPath),
    };
  });
}
