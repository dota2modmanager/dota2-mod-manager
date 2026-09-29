// Minimal reader for the index of Source-engine VPK "_dir" files (v1/v2).
// Only walks the directory tree — enough to list which game files a mod overrides.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { t } = require('./i18n');
const { HERO_DISPLAY, HERO_ALIAS, heroDisplayName, heroKey } = require('./hero-names');

const VPK_SIGNATURE = 0x55aa1234;

function readCString(buf, pos) {
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
 * src/minify.js reads another tool's files, neither inside a try. Measured on a three-entry VPK:
 * 54 of its truncations escaped that way (test/vpk-fuzz.test.js).
 *
 * `next` is always at least 18 bytes past `pos`, so a tree cannot stall a walker either.
 */
function readEntryRecord(buf, pos) {
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
function joinPath(folder, name, ext) {
  const dir = folder === ' ' ? '' : folder + '/';
  const suffix = ext === ' ' ? '' : '.' + ext;
  return `${dir}${name}${suffix}`.toLowerCase();
}

/**
 * Read only the header + directory tree of a *_dir.vpk off disk. A self-contained mod
 * is tens of MB of payload sitting behind a few KB of index, and the index is all any
 * of the listing/analysis/fingerprint helpers ever touch — so scanning a whole library
 * never has to pull the payloads into memory.
 * @param {string} filePath
 * @returns {Buffer} header + tree — what every listing / analysis helper here parses
 */
function readVpkIndexFile(filePath) {
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
 * @param {Buffer} buf contents of a *_dir.vpk file
 * @returns {string[]} lowercased inner paths like "materials/water/water_ti10_000.vmat_c"
 */
function listVpkPaths(buf) {
  if (buf.length < 12 || buf.readUInt32LE(0) !== VPK_SIGNATURE) {
    throw new Error(t('VPK: неверная сигнатура'));
  }
  const version = buf.readUInt32LE(4);
  let pos = version === 2 ? 28 : 12; // v2 header carries 16 extra bytes of section sizes

  const paths = [];
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

function listVpkPathsFile(filePath) {
  return listVpkPaths(readVpkIndexFile(filePath));
}

/**
 * Like listVpkPaths, but returns each inner path together with the CRC32 the VPK index
 * stores for it. Two mods that carry a byte-identical filler asset share the same CRC, so
 * comparing CRCs (not just paths) tells a real override apart from a coincidental shared file.
 * @param {Buffer} buf contents of a *_dir.vpk file
 * @returns {Map<string, number>} lowercased inner path -> crc32
 */
function listVpkPathCrcs(buf) {
  if (buf.length < 12 || buf.readUInt32LE(0) !== VPK_SIGNATURE) {
    throw new Error(t('VPK: неверная сигнатура'));
  }
  const version = buf.readUInt32LE(4);
  let pos = version === 2 ? 28 : 12;
  const map = new Map();
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

function listVpkPathCrcsFile(filePath) {
  return listVpkPathCrcs(readVpkIndexFile(filePath));
}

/**
 * Read the bytes of ONE file out of a *_dir.vpk without touching the rest. The game's
 * own pak01 is a 25 GB set behind a 22 MB index, so pulling items_game.txt out of it
 * has to be a seek, not a walk: index (already memo-cached) -> offset -> single read.
 * @param {string} dirPath  path to the *_dir.vpk
 * @param {string} wanted   lowercased inner path, e.g. "scripts/items/items_game.txt"
 * @returns {{ data: Buffer, crc: number } | null}
 */
function readVpkEntryFile(dirPath, wanted) {
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
 * @param {string} dirPath path to the *_dir.vpk
 * @returns {{ size: number, has: (p: string) => boolean, read: (p: string) => Buffer|null }}
 */
function openVpkIndex(dirPath) {
  const buf = readVpkIndexFile(dirPath);
  const version = buf.readUInt32LE(4);
  const treeSize = buf.readUInt32LE(8);
  const headerSize = version === 2 ? 28 : 12;
  const inlineBase = headerSize + treeSize;
  const entries = new Map();
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
  const read = (wanted) => {
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
    has: (p) => entries.has(String(p).toLowerCase()),
    read,
  };
}

// ---------- content analysis (which hero / equip slots a mod touches) ----------

// keyword found in a model filename token -> canonical equip slot
const SLOT_KEYWORDS = [
  ['shoulder', 'shoulder'], ['pauldron', 'shoulder'],
  ['helmet', 'head'], ['helm', 'head'], ['head', 'head'], ['hood', 'head'], ['mask', 'head'],
  ['hair', 'head'], ['face', 'head'], ['hat', 'head'], ['crown', 'head'], ['horn', 'head'],
  ['weapon', 'weapon'], ['sword', 'weapon'], ['blade', 'weapon'], ['staff', 'weapon'],
  ['bow', 'weapon'], ['axe', 'weapon'], ['hammer', 'weapon'], ['scythe', 'weapon'],
  ['offhand', 'offhand'], ['shield', 'shield'],
  ['bracer', 'arms'], ['glove', 'arms'], ['hand', 'arms'], ['arm', 'arms'],
  ['shoulders', 'shoulder'], ['belt', 'belt'], ['waist', 'belt'],
  ['cape', 'back'], ['cloak', 'back'], ['back', 'back'], ['wing', 'wings'], ['tail', 'tail'],
  ['skirt', 'legs'], ['leg', 'legs'], ['boot', 'legs'], ['feet', 'legs'], ['foot', 'legs'],
  ['mount', 'mount'], ['armor', 'armor'], ['ambient', 'ambient'],
];
const SLOT_DISPLAY = {
  head: 'голова', weapon: 'оружие', offhand: 'оружие (2)', shield: 'щит', armor: 'броня',
  shoulder: 'плечи', belt: 'пояс', arms: 'руки', back: 'спина', wings: 'крылья', tail: 'хвост',
  legs: 'ноги', mount: 'ездовое', ambient: 'эффекты', misc: 'разное', base: 'модель',
};

function slotDisplayName(slot) { return t(SLOT_DISPLAY[slot] || slot); }

function slotFromModelStem(hero, stem) {
  if (stem === hero || /^\d+$/.test(stem)) return 'base'; // bare hero name or "1.vmdl" = base body override
  let tok = stem.startsWith(hero + '_') ? stem.slice(hero.length + 1) : stem;
  tok = tok.replace(/_(lod\d+|c|model|hero|full|default|\d+)$/g, '');
  if (!tok || /^\d+$/.test(tok) || /(^|_)(base|body|model)$/.test(tok)) return 'base';
  // the last token is what the piece IS ("transmuted_armaments_back" is a back item);
  // matching the whole string first made every set item an "arm" because "armaments"
  // happens to contain "arm"
  for (const part of [tok.split('_').pop(), tok]) {
    for (const [kw, slot] of SLOT_KEYWORDS) if (part.includes(kw)) return slot;
  }
  return 'misc';
}

const HERO_MODEL_RE = /^models\/heroes\/([a-z0-9_]+)\/(.+)$/;
const HERO_PARTICLE_RE = /^particles\/units\/heroes\/hero_([a-z0-9_]+)\//;
// Valve files every cosmetic item under the hero it belongs to, and every hero material
// under materials/models/heroes. A set mod - by far the most common thing people install -
// touches only these, and none of them used to be read at all: an arcana or a courier set
// came out with no hero, no name and no picture, which is what left a row saying nothing
// but "pak90_dir.vpk". The item roots also carry things that are not heroes (consumables,
// couriers, wards...), so the folder is only taken as a hero when it is not one of those.
const ITEM_MODEL_RE = /^models\/items\/([a-z0-9_]+)\/(.+)$/;
const ITEM_MATERIAL_RE = /^materials\/models\/(?:heroes|items)\/([a-z0-9_]+)\//;
const ECON_PARTICLE_RE = /^particles\/econ\/items\/([a-z0-9_]+)\//;
// Dota 2 Skinchanger writes its own content root named after the cart: "8213/heroes/<hero>/"
// and "8213/particles/<hero>/". Those two are as canonical as Valve's own layout, unlike the
// free-form folders authors put under materials/ — so they count, and only under a numeric
// root, where the name after it can only be a hero.
const CART_MODEL_RE = /^\d{3,}\/heroes\/([a-z0-9_]+)\/(.+)$/;
const CART_PARTICLE_RE = /^\d{3,}\/particles\/([a-z0-9_]+)\//;
// folder names that sit where a hero name would but are not one
const NON_HERO_FOLDER = new Set([
  'misc', 'common', 'shared', 'econ', 'items', 'generic', 'ui', 'props',
  'weather', 'ambient', 'effects', 'base', 'default', 'error', 'test',
  // things Valve also files under models/items and particles/econ/items
  'consumables', 'consumable', 'courier', 'couriers', 'ward', 'wards',
  'creeps', 'creep', 'towers', 'tower', 'neutral', 'neutrals', 'roshan',
  'pedestal', 'pedestals', 'taunts', 'taunt', 'emblems', 'emblem', 'sprays',
  'loadingscreens', 'loadingscreen', 'announcer', 'music', 'hud', 'terrain',
  'chests', 'chest', 'bundles', 'bundle', 'tools', 'dev', 'nomodel',
]);

/**
 * Classify what a mod's inner path list actually changes.
 * @param {string[]} paths lowercased inner VPK paths (from listVpkPaths)
 * @returns {{ heroes: Array<{id,name,slots:string[],base:boolean,models:number}>, kind: string, pathCount: number }}
 */
function analyzeVpkPaths(paths) {
  const heroes = new Map(); // id -> { slots:Set, base:bool, models:int, seen:bool }
  const hero = (id) => {
    if (!heroes.has(id)) heroes.set(id, { slots: new Set(), base: false, models: 0 });
    return heroes.get(id);
  };
  for (const p of paths) {
    let m = HERO_MODEL_RE.exec(p) || CART_MODEL_RE.exec(p);
    if (m && !NON_HERO_FOLDER.has(m[1])) {
      const h = hero(m[1]);
      if (/\.vmdl_c$/.test(p)) {
        const stem = m[2].replace(/\.vmdl_c$/, '').split('/').pop();
        const slot = slotFromModelStem(m[1], stem);
        if (slot === 'base') h.base = true; else h.slots.add(slot);
        h.models++;
      }
      continue;
    }
    // a cosmetic item: models/items/<hero>/<set>/<piece>.vmdl_c — never a base override,
    // so it adds a slot and never sets `base`
    m = ITEM_MODEL_RE.exec(p);
    if (m && !NON_HERO_FOLDER.has(m[1])) {
      const h = hero(m[1]);
      if (/\.vmdl_c$/.test(p)) {
        h.slots.add(slotFromModelStem(m[1], m[2].replace(/\.vmdl_c$/, '').split('/').pop()));
        h.models++;
      }
      continue;
    }
    m = HERO_PARTICLE_RE.exec(p) || CART_PARTICLE_RE.exec(p) || ECON_PARTICLE_RE.exec(p) || ITEM_MATERIAL_RE.exec(p);
    if (m && !NON_HERO_FOLDER.has(m[1])) hero(m[1]);
  }
  // authors sometimes use both the canonical folder (nerubian_assassin) and a custom
  // alias (nyx, crystalmaiden) for the same hero — merge everything that resolves to the
  // same hero, and keep the id the engine itself uses so splitting can find the files
  const byKey = new Map();
  for (const [id, v] of heroes) {
    const key = heroKey(id);
    const cur = byKey.get(key) || { id, name: heroDisplayName(id), slots: new Set(), base: false, models: 0 };
    // Of several spellings, keep the one the app has a proper name for: "crystal_maiden"
    // reads as "Crystal Maiden", the "crystalmaiden" an author typed reads as "Crystalmaiden".
    // The id matters too — splitting looks for the hero's files by it.
    if (HERO_DISPLAY[HERO_ALIAS[id] || id] && !HERO_DISPLAY[HERO_ALIAS[cur.id] || cur.id]) {
      cur.id = id;
      cur.name = heroDisplayName(id);
    }
    for (const s of v.slots) cur.slots.add(s);
    cur.base = cur.base || v.base;
    cur.models += v.models;
    byKey.set(key, cur);
  }
  const list = [...byKey.values()].map((v) => ({
    id: v.id, name: v.name, slots: [...v.slots], base: v.base, models: v.models,
  })).sort((a, b) => b.models - a.models || a.name.localeCompare(b.name));

  let kind = 'other';
  if (list.length) kind = 'hero';
  else if (paths.some((p) => /(^|\/)ward|models\/props_gameplay\/.*ward/.test(p))) kind = 'wards';
  else if (paths.some((p) => p.startsWith('particles/econ/courier') || p.includes('/courier'))) kind = 'courier';
  else if (paths.some((p) => p.startsWith('panorama/'))) kind = 'ui';
  else if (paths.some((p) => p.startsWith('sounds/'))) kind = 'sounds';
  else if (paths.some((p) => p.startsWith('maps/'))) kind = 'terrain';

  return { heroes: list, kind, pathCount: paths.length };
}

function analyzeVpk(buf) {
  return analyzeVpkPaths(listVpkPaths(buf));
}

// Human one-liner for a single detected hero, e.g. "Nyx Assassin (model, weapon)".
function describeHero(h) {
  const parts = [];
  if (h.base) parts.push(t('модель'));
  for (const s of h.slots) parts.push(slotDisplayName(s));
  if (!parts.length && !h.models) parts.push(t('перекраска'));
  return h.name + (parts.length ? ` (${parts.join(', ')})` : '');
}

const KIND_LABEL = { wards: 'варды', courier: 'курьер', ui: 'интерфейс', sounds: 'звуки', terrain: 'террейн', other: '' };

/**
 * The heroes a mod is actually about, as opposed to the ones it merely touches.
 *
 * A hero's folder is also where authors borrow generic lookup textures from - fresnel warps,
 * colourwarps, detail masks - and one borrowed file used to count as a whole hero. That is
 * how a set that dresses Grimstroke alone announced itself as a bundle of eight heroes, and
 * how a Dazzle skin claimed to also change Bane and Slardar (measured over 84 installed
 * mods: 12 heroes invented across 5 of them).
 *
 * A hero the mod carries no model for is not the subject. When none of them has a model the
 * mod is a plain recolour, and then every hero it touches is as good an answer as there is.
 *
 * Nor is a hero the mod carries one model for while carrying eight of somebody else's. Skins
 * borrow a prop from another hero - a Clinkz set hangs a Phoenix immortal off its bow, a Sven
 * one wears Disruptor's back piece - and that single model used to make the mod read as two
 * heroes. It came in named "Clinkz, Phoenix", and an import of two to four heroes splits
 * itself, so the set arrived in two halves with the bow in one of them.
 */
function subjectHeroes(a) {
  const carried = a.heroes.filter((h) => h.models > 0 || h.base);
  if (carried.length < 2) return carried.length ? carried : a.heroes;
  // A quarter of the leading hero's models is the line between "this mod is also about him"
  // and "it borrowed something of his": measured across 75 split mods, every borrowed prop
  // was a single model against five to eight, and no real two-hero pack was near it.
  const top = Math.max(...carried.map((h) => h.models));
  const main = carried.filter((h) => h.base || h.models * 4 >= top);
  return main.length ? main : carried;
}

// Human summary of a whole analysis: hero skins, or a coarse content kind.
function describeAnalysis(a) {
  const heroes = subjectHeroes(a);
  if (heroes.length) return heroes.map(describeHero).join('; ');
  return t(KIND_LABEL[a.kind] || '');
}

// A short display NAME for a mod from its analysis — used to name imported VPKs by their
// content (a hero, a set, or a content kind) instead of a bare "pakNN" slot. Null if the
// content isn't recognisable enough to name.
const KIND_NAME = { wards: 'Варды', courier: 'Курьер', ui: 'Интерфейс меню', sounds: 'Звуки', terrain: 'Ландшафт' };
function nameFromAnalysis(a) {
  const heroes = subjectHeroes(a);
  if (heroes.length === 1) return heroes[0].name;
  if (heroes.length >= 2 && heroes.length <= 3) return heroes.map((h) => h.name).join(', ');
  if (heroes.length > 3) return t('Сборка · {0} героев', heroes.length);
  return KIND_NAME[a.kind] ? t(KIND_NAME[a.kind]) : null;
}

const EMPTY = Buffer.alloc(0);
const INLINE = 0x7fff; // archiveIndex meaning "data lives in the _dir file itself"

// full inner path of a read entry, lowercased (" " means the root / no extension)
function entryPath(en) {
  return joinPath(en.folder, en.name, en.ext);
}

// Read every entry of a _dir.vpk (following external _NNN archives) into a flat list
// with its bytes: [{ ext, folder, name, crc, preload, data }], in on-disk tree order.
function readVpkEntries(dirBuf, dirPath, archivePathFor) {
  if (dirBuf.length < 12 || dirBuf.readUInt32LE(0) !== VPK_SIGNATURE) {
    throw new Error(t('VPK: неверная сигнатура'));
  }
  const version = dirBuf.readUInt32LE(4);
  const treeSize = dirBuf.readUInt32LE(8);
  const headerSize = version === 2 ? 28 : 12;
  const embeddedBase = headerSize + treeSize; // where inline (0x7fff) data sits

  const archiveCache = new Map();
  const readArchive = (idx) => {
    if (idx === INLINE) return dirBuf;
    if (!archiveCache.has(idx)) {
      const p = archivePathFor
        ? archivePathFor(idx)
        : dirPath.replace(/_dir\.vpk$/i, `_${String(idx).padStart(3, '0')}.vpk`);
      archiveCache.set(idx, fs.readFileSync(p));
    }
    return archiveCache.get(idx);
  };

  const entries = [];
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
        let data = EMPTY;
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

// The VPK index carries a CRC32 per entry. Hand-rolled because Node's own zlib.crc32 is
// newer than the Node inside our Electron; src/schema.js re-exports this one.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Build one self-contained single-file VPK v2 from a flat entry list. Groups entries
// by ext -> folder (first-seen order), embeds every entry's data inline (0x7fff).
function buildVpk(entries) {
  const tree = new Map();
  for (const en of entries) {
    let folders = tree.get(en.ext); if (!folders) { folders = new Map(); tree.set(en.ext, folders); }
    let names = folders.get(en.folder); if (!names) { names = []; folders.set(en.folder, names); }
    names.push(en);
  }

  const dataChunks = [];
  let dataLen = 0;
  for (const [, folders] of tree) for (const [, names] of folders) for (const en of names) {
    en._offset = dataLen;
    if (en.data.length) { dataChunks.push(en.data); dataLen += en.data.length; }
  }

  const z = Buffer.from([0]);
  const cstr = (s) => Buffer.concat([Buffer.from(s, 'utf-8'), z]);
  const parts = [];
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
        meta.writeUInt32LE(en._offset >>> 0, 8);
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
 * @returns {string|null} absolute path, or null if nothing game-shaped is under there
 */
function findContentRoot(dir, depth = 0) {
  if (depth > 6) return null;
  let names;
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
 * @param {string} root the content root (see findContentRoot)
 * @returns {Buffer}
 */
function packFolder(root) {
  const entries = [];
  let total = 0;
  const walk = (dir, prefix) => {
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (JUNK.test(e.name)) continue;
      // a symlink is somebody else's file, and following one can walk in a circle
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(full, rel); continue; }
      if (!e.isFile()) continue;
      let data;
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

// Build a _dir.vpk index that references data in *external* archives (_NNN.vpk). Entries
// must already carry { archiveIndex, offset, length } pointing into those archives. Unlike
// buildVpk (single-file, inline 0x7fff) this holds no file data — the tree only.
function buildVpkDir(entries) {
  const tree = new Map();
  for (const en of entries) {
    let folders = tree.get(en.ext); if (!folders) { folders = new Map(); tree.set(en.ext, folders); }
    let names = folders.get(en.folder); if (!names) { names = []; folders.set(en.folder, names); }
    names.push(en);
  }
  const z = Buffer.from([0]);
  const cstr = (s) => Buffer.concat([Buffer.from(s, 'utf-8'), z]);
  const parts = [];
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
 * @param {Array<{key:string, buf:Buffer}>} members  self-contained VPK buffers, in priority order
 * @param {string} outDir   directory to write <base>_dir.vpk and volumes into
 * @param {string} outBase  slot base name, e.g. "pak10"
 * @param {{volumeCap?:number}} [opts]
 * @returns {{ dir:string, parts:string[], memberPaths:Record<string,string[]>, conflicts:Array }}
 */
function combineVpksToFiles(members, outDir, outBase, { volumeCap = 1 << 30 } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const entries = [];
  const seen = new Set();
  const conflicts = [];
  const memberPaths = /** @type {Record<string, string[]>} */ ({});
  const partName = (i) => `${outBase}_${String(i).padStart(3, '0')}.vpk`;

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
 * @param {string} dirPath  path to the *_dir.vpk index file
 * @param {(idx: number) => string} [archivePathFor]  resolves external archive N to a path
 * @returns {Buffer} the merged single-file VPK
 */
function mergeVpkToSingle(dirPath, archivePathFor) {
  return buildVpk(readVpkEntries(fs.readFileSync(dirPath), dirPath, archivePathFor));
}

/**
 * Split a merged multi-hero VPK into one self-contained VPK per detected hero — the
 * inverse of tools that pack several skins into one file (e.g. Dota 2 Skinchanger).
 * A file that clearly belongs to a hero (…/heroes/<hero>/… or …/hero_<hero>/…) goes to
 * that hero; everything else (shared stock, cross-hero assets) is copied into every
 * output so each result stands alone and installs/removes independently.
 *
 * @returns {Array<{ id: string, name: string, buf: Buffer, paths: string[] }>} empty if <2 heroes.
 */
function splitVpkByHero(dirPath, archivePathFor) {
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
  const ownerOf = (p) => ids.find((id) =>
    p.includes(`/heroes/${id}/`) || p.startsWith(`heroes/${id}/`) ||
    p.includes(`/hero_${id}/`) || p.startsWith(`hero_${id}/`))
    || ids.find((id) => p.includes(`/${id}/`) || p.startsWith(`${id}/`))
    // ability icons and the like are named after their hero rather than filed under it
    || ids.find((id) => (p.split('/').pop() || '').startsWith(`${id}_`))
    || null;

  const buckets = new Map(ids.map((id) => [id, []]));
  const shared = [];
  entries.forEach((en, i) => {
    const owner = ownerOf(paths[i]);
    if (owner) buckets.get(owner).push(en); else shared.push(en);
  });
  return heroes.map((h) => {
    const own = buckets.get(h.id);
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

// Content fingerprint of a mod: sha1 over its sorted (path:crc) index. Independent of
// packaging (multi-part vs single, filename), so the same mod installed from the site,
// from another tool, or via this app all hash identically — the basis for recognising
// a foreign vpk as a specific catalog mod.
function fingerprintEntries(entries) {
  const canon = entries.map((e) => `${e.path}:${e.crc}`).sort().join('\n');
  return crypto.createHash('sha1').update(canon).digest('hex');
}

function fingerprintVpk(buf) {
  return fingerprintEntries(listVpkEntries(buf));
}

// Content fingerprint of a loose-file mod (cursors, fonts): sha1 over sorted
// "path:sha1(bytes)". Paths should already be normalized (top folder stripped,
// lowercased) so it reproduces from either the source zip or the installed files.
function fingerprintFiles(files) {
  const rows = files.map((f) => `${f.path}:${crypto.createHash('sha1').update(f.data).digest('hex')}`);
  return crypto.createHash('sha1').update(rows.sort().join('\n')).digest('hex');
}

// Lightweight (path, crc) list — the mod's content signature, no archive reads.
function listVpkEntries(buf) {
  if (buf.length < 12 || buf.readUInt32LE(0) !== VPK_SIGNATURE) throw new Error(t('VPK: неверная сигнатура'));
  const version = buf.readUInt32LE(4);
  let pos = version === 2 ? 28 : 12;
  const out = [];
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

module.exports = {
  listVpkPaths, listVpkPathsFile, listVpkPathCrcs, listVpkPathCrcsFile, listVpkEntries, openVpkIndex, mergeVpkToSingle, splitVpkByHero,
  readVpkEntries, readVpkIndexFile, readVpkEntryFile, buildVpk, buildVpkDir, combineVpksToFiles, entryPath,
  findContentRoot, packFolder, crc32,
  fingerprintVpk, fingerprintEntries, fingerprintFiles,
  analyzeVpk, analyzeVpkPaths, heroDisplayName, slotDisplayName,
  describeHero, describeAnalysis, nameFromAnalysis, subjectHeroes,
};
