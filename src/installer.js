// Installer engine: download, extract, pak allocation, per-category install/uninstall
const fs = require('fs');
const path = require('path');
const { RAW_BASE } = require('./catalog');
const { listVpkPaths, listVpkPathsFile, listVpkPathCrcs, readVpkIndexFile, readVpkEntries, entryPath, buildVpk, mergeVpkToSingle, splitVpkByHero, combineVpksToFiles, analyzeVpkPaths, describeAnalysis, nameFromAnalysis, subjectHeroes, fingerprintVpk, fingerprintFiles,
  } = require('./vpk');
const { extractDeltas, deltaTable, crc32 } = require('./schema');
// Whole-game tables and tool branding that packaging tools bake into EVERY export.
// Dota 2 Skinchanger, for one, ships a full 47 MB scripts/items/items_game.txt plus the
// localization files, its loadout stylesheets, its logo strip and a steam-id watermark in
// every single pack it builds. None of it belongs in a language folder - the localization
// copy in particular outranks the game's own and rolls UI text back to whenever the pack
// was built - so harvestSchema strips them on the way in.
const GLOBAL_TABLE_RE = new RegExp('^(?:' + [
  'scripts/items/items_game(?:\\.txt)?"?$',            // the game's whole item table
  'resource/localization/',                            // full dota_<lang>.txt copies
  'panorama/styles/(?:hero_slot_item_picker_loadout|ui_econ_item)\\.vcss_c"?$',
  'panorama/images/(?:ds|tg|tt|wb|yu|remove|header_credits|footer_credits)[^/]*$',
  '(?:models/heroes|panorama)/\\d{8,}\\.vxml_c"?$',    // <steam id>.vxml_c watermark
].join('|') + ')');
const { ensureLangFolder } = require('./gamelang');
const { openZip, safeJoin } = require('./safe-zip');
const { validateGamePath } = require('./steam.ts');
const { FileTx, copyInto, writeInto } = require('./file-tx.ts');
const { Overlays, FONTS_SUBDIR, CURSOR_SUBDIR } = require('./overlays');
const { RESERVED_PAKS, isMinifyFile, isMinifyPak } = require('./minify');
const { downloadFile } = require('./net');
const { t } = require('./i18n');

// The categories that load before the rest, and the slots they get: src/slot-zones.js.
const zones = require('./slot-zones');
const { PRIORITY_CATEGORIES } = zones;

// Merging a multi-volume import into one file holds the whole mod in memory once. Well
// above any real skin pack (a Skinchanger export is ~70 MB), but a multi-GB set is left
// in its original volumes rather than risking the allocation.
const MERGE_SIZE_CAP = 1200 * 1024 * 1024;

// Above this a resource/localization file is the game's whole table rather than a mod's own
// few lines: Dota's own dota_english.txt is ~4 MB, a deliberate edit is a few KB.
const LOC_COPY_MIN = 256 * 1024;

// Master "mods off" switch: every active mod pak is renamed <file>.moff so the game
// ignores it (it only mounts pakNN_dir.vpk). Distinct from the per-mod ".off" state so
// the two never clobber each other. Official localization (pak01_*) / gameinfo.gi are
// never touched — turning mods off must not strip the game's own language files.
const MASTER_OFF = '.moff';

/* Which files in the language folder are ours, written where another program can read it.
 *
 * Minify marks its work by packing metadata into the VPKs it builds, and checks for that
 * before deleting one. The same courtesy in the other direction cannot be done the same way:
 * mods from the catalog are copied byte for byte and identified by a hash of their contents,
 * and the project is building integrity guarantees on the file being exactly what the catalog
 * published - sha256 on download, a signed catalog after that. Repacking every install to
 * insert a marker is cheap enough (35ms against 15ms for a plain copy of a 46 MB mod, and the
 * hash survives if marker names are left out of it), but it would end byte-identity, which is
 * worth more than the convenience.
 *
 * So the marker is one file beside the mods instead of a marker inside each one. Anything
 * reading it learns which files in the folder belong to this app, which is the question a
 * second mod manager actually needs answered before it deletes anything.
 */
const OWNERSHIP_FILE = 'dota2modmanager.json';
function isOfficialLangFile(baseLower) {
  return /^pak01_/.test(baseLower) || baseLower === 'gameinfo.gi' || zones.isAppPak(baseLower);
}

// What a FileTx parks next to a file it is about to replace or delete (see src/file-tx.ts).
// Nothing should outlive its transaction; one that does means the app died mid-write, and
// sweepStaged() cleans up after that on the next start.
const STAGED_RE = /\.[a-z0-9]+\.mmtx$/i;

// Engine stock that packing tools drop into every export they build: reflection cubemaps,
// the basic particle set, the error placeholder, the transparency helper, the default
// textures. Different tools compile them to slightly different bytes, so two mods carrying
// them look like they are fighting over a file - and they are not. Nobody's mod looks
// different because another mod's copy of basic_smoke won.
//
// Measured over 84 installed mods: of the 84 paths carried by two mods with different bytes,
// every single one shared by more than four mods matches this, and not one of them is a hero
// model or an item texture. Matched anywhere in the path, because authors wrap the same stock
// in a content folder of their own.
const STOCK_ASSET = /(^|\/)(materials\/(default|particle|transparent)|materials\/models\/cubemaps|particles\/(basic_[a-z]+|error))\//;

function fileUrl(categoryId, fileRef) {
  if (/^https?:\/\//i.test(fileRef)) return fileRef;
  return `${RAW_BASE}/assets/files/${categoryId}/${encodeURIComponent(fileRef)}`;
}

/* A name from the catalog is a name, never a path.
 *
 * What a mod is called on disk used to be decodeURIComponent(last segment of the URL), and
 * a catalog entry pointing at ".../..%2F..%2F..%2Fsomething" decoded straight back into
 * "../../../something" - a file the app then wrote wherever that landed. Slashes cannot
 * survive this, so nothing here can climb out of the folder it was given.
 *
 * Spaces, brackets and Cyrillic are left alone on purpose: real catalog files are called
 * things like "Red Abaddon (v2).zip", they are the keys of the download cache, and
 * scrubbing them would re-download every mod on disk to no benefit.
 */
function safeFileName(raw, fallback) {
  const flat = String(raw || '').replace(/\\/g, '/');
  const last = flat.slice(flat.lastIndexOf('/') + 1);
  const cleaned = [...last]
    .filter((ch) => ch >= ' ' && !'<>:"|?*'.includes(ch)) // what Windows refuses in a name
    .join('')
    .slice(0, 150);
  return /^\.*$/.test(cleaned) ? fallback : cleaned; // "", "." and ".." are not names
}

class Installer {
  /**
   * @param {object} opts
   * @param {string} opts.userDataDir
   * @param {() => string|null} opts.getGamePath   e.g. ...\dota 2 beta\game
   * @param {() => string} opts.getLangSuffix      e.g. "123"
   * @param {(evt: object) => void} opts.onProgress
   * @param {((paths: string[]) => Array<object>) | null} [opts.identify]  catalog mods these files are
   * @param {((categoryId: string, file: string) => string|null) | null} [opts.publishedHash]  its sha256
   */
  constructor({ userDataDir, getGamePath, getLangSuffix, onProgress, identify = null, publishedHash = null }) {
    this.downloadsDir = path.join(userDataDir, 'downloads');
    this.toolsDir = path.join(userDataDir, 'tools');
    this.backupsDir = path.join(userDataDir, 'backups');
    this.packsDir = path.join(userDataDir, 'packs'); // per-member source VPKs of combined packs
    this.cursorsDir = path.join(userDataDir, 'cursors'); // per-record copy of each cursor set
    fs.mkdirSync(this.downloadsDir, { recursive: true });
    fs.mkdirSync(this.toolsDir, { recursive: true });
    fs.mkdirSync(this.backupsDir, { recursive: true });
    fs.mkdirSync(this.packsDir, { recursive: true });
    fs.mkdirSync(this.cursorsDir, { recursive: true });
    this.getGamePath = getGamePath;
    // fonts and cursors, the files written over the game's own: src/overlays.js
    this.overlays = new Overlays({
      getGamePath, backupsDir: this.backupsDir, cursorsDir: this.cursorsDir,
      cachedArchive: (categoryId, fileRef) => this.cachedArchive(categoryId, fileRef),
    });
    this.getLangSuffix = getLangSuffix;
    this.onProgress = onProgress || (() => {});
    // asks the game which of its own items a path list replaces (src/mod-id.js); optional,
    // because without a game path there is nothing to ask and the path guess still answers
    this.identify = identify || (() => null);
    // what the catalog says an archive should hash to (src/catalog.js); optional and often
    // null, which means the download is checked the way it always was
    this.publishedHash = publishedHash || (() => null);
  }

  /**
   * What a path list is, told as precisely as this machine allows: the game's own item names
   * when it recognises them, the guess from the paths otherwise. The two are merged rather
   * than one replacing the other - a mod can dress a hero in named items AND replace another
   * hero's bare body, and only the guess sees the second.
   */
  describePaths(paths, analysis) {
    const out = { info: describeAnalysis(analysis), heroNames: analysis.heroes.map((h) => h.name) };
    let named = null;
    try { named = this.identify(paths); } catch { /* no game, no table: the guess stands */ }
    if (!named) return out;
    out.items = named.items;
    // the table is the authority on who wears what, so a hero it never mentions and the mod
    // carries no model for was a borrowed texture, not a subject
    const carried = new Set(subjectHeroes(analysis).map((h) => h.name));
    for (const h of named.heroNames) carried.add(h);
    out.heroNames = [...carried];
    out.info = named.items.length <= 3
      ? named.items.join(', ')
      : `${named.items.slice(0, 2).join(', ')} +${named.items.length - 2}`;
    return out;
  }

  langFolder() {
    const game = this.getGamePath();
    if (!game) throw new Error(t('Путь к Dota 2 не задан'));
    return path.join(game, `dota_${this.getLangSuffix()}`);
  }

  /**
   * Where a mod's file actually is right now. Switching a mod off renames it to ".off" and
   * the master switch renames everything to ".moff", so anything that reads a mod's own
   * bytes has to look for those too - reading the plain name only meant a disabled mod
   * became unreadable, and with it nameless and pictureless in the library.
   * Falls back to the plain path so callers still get a sensible error.
   */
  langFileOnDisk(relPath) {
    const base = path.join(this.langFolder(), relPath);
    return ['', '.off', MASTER_OFF].map((s) => base + s).find((p) => fs.existsSync(p)) || base;
  }

  // Called before writing into the folder. English is the one language Valve ships no
  // folder for, so there we also lay down the layer definition it would have had.
  /**
   * There is a game to install into, or there is nothing to do.
   *
   * mkdir is recursive, so a wrong path never failed on its own: it built the whole tree and
   * filled it. That is how a user ended up with 43 mods in the leftovers of a library he had
   * moved to another drive, reported as installed and visible to nobody.
   */
  requireGameFolder() {
    const game = this.getGamePath();
    if (!game) throw new Error(t('Путь к Dota 2 не задан'));
    if (!validateGamePath(game)) {
      throw new Error(t('По сохранённому пути нет файлов Dota 2 — укажи папку игры заново в настройках'));
    }
    return game;
  }

  ensureLangFolder() {
    return ensureLangFolder(this.requireGameFolder(), this.getLangSuffix());
  }

  // ---------- download ----------

  // What each downloaded archive hashed to, so a cached copy can be trusted and a mirror
  // cannot hand over a different file under the same name.
  downloadIndex() {
    try { return JSON.parse(fs.readFileSync(path.join(this.downloadsDir, 'index.json'), 'utf-8')); } catch { return {}; }
  }

  rememberDownload(key, entry) {
    const index = this.downloadIndex();
    index[key] = entry;
    try { fs.writeFileSync(path.join(this.downloadsDir, 'index.json'), JSON.stringify(index, null, 2)); } catch { /* the cache still works without it */ }
  }

  async download(categoryId, fileRef, label) {
    const url = fileUrl(categoryId, fileRef);
    // the last URL segment without its query, decoded, and then made into a plain name
    const tail = url.split(/[?#]/)[0].split('/').pop();
    let decoded = tail;
    try { decoded = decodeURIComponent(tail); } catch { /* a stray % is not an escape */ }
    const safeName = safeFileName(decoded, 'mod');
    const destDir = path.join(this.downloadsDir, safeFileName(categoryId, 'other'));
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, safeName);
    const key = `${categoryId}/${safeName}`;
    const known = this.downloadIndex()[key] || null;
    // The catalog's own answer, keyed by the name upstream uses rather than the one this
    // machine is allowed to write: safeFileName can rewrite a character that a filesystem
    // dislikes, and the published list knows nothing about that.
    const published = this.publishedHash(categoryId, decoded);

    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      // A cached file is reused on its name alone, so a copy that was cut short by a crash
      // or a full disk would be installed forever after. Its size is checked against what
      // was recorded when it arrived; hashing 300 MB on every install is not worth it, and
      // a truncated file is what actually happens.
      // A cached copy that the catalog now disagrees with is not a cached copy worth having.
      // This costs no hashing: what it arrived as was written down when it arrived.
      const disowned = published && known && known.sha256 && known.sha256 !== published;
      if (!disowned && (!known || known.size === fs.statSync(dest).size)) return dest;
      this.onProgress({ type: 'stage', label: label || safeName, stage: t('перекачиваю повреждённый файл') });
      fs.rmSync(dest, { force: true });
    }

    try {
      const res = await downloadFile(url, dest, {
        // the catalog's published hash when it has one, and otherwise what this file was the
        // first time it arrived here
        expectSha256: published || (known ? known.sha256 : null),
        /* Neither of those is a hash this project pinned. One is a list somebody else's bot
           rebuilds, the other is a note about a file this machine saw weeks ago, and both go
           out of date the moment a mod's author replaces the archive. So they outrank every
           proxy and nothing else: see downloadFile. */
        fromPublishedList: true,
        onProgress: (loaded, total) => this.onProgress({ type: 'download', label: label || safeName, loaded, total }),
      });
      this.rememberDownload(key, { size: res.bytes, sha256: res.sha256, at: Date.now() });
      return dest;
    } catch (err) {
      /* "checksum mismatch for Earthshaker Arcana.zip" is a sentence for whoever wrote the
         downloader. What it means to the player is that every copy of this mod he can reach
         is not the mod the catalog describes, and that this is not something he did or can
         fix from here. Said in his own language, with the technical half kept for the
         diagnostics report. */
      if (err.checksum) throw new Error(t('{0}: скачанный файл не совпадает с тем, что опубликовал автор мода. Попробуй позже', safeName));
      throw new Error(t('Не удалось скачать {0}: {1}', safeName, String(err.message || err)));
    }
  }

  // ---------- pak allocation ----------

  usedPakNames() {
    const lang = this.langFolder();
    const used = new Set();
    if (fs.existsSync(lang)) {
      for (const f of fs.readdirSync(lang)) {
        // disabled (.off) and master-off (.moff) files still occupy their base slot
        used.add(f.toLowerCase().replace(/\.moff$/, '').replace(/\.off$/, ''));
      }
    }
    return used;
  }

  // ---------- master mods on/off ----------

  // Is this base name a mod pak the master switch may toggle? (i.e. not the game's own
  // localization / gameinfo). Accepts a lowercased name without .off/.moff suffix.
  /* What the master switch is allowed to rename.
   *
   * Not the game's own files, and not Minify's: the switch sweeps the folder rather than
   * asking the library, so in the arrangement we recommend - both apps sharing one language
   * folder - "mods off" would rename pak65 to pak67 out from under it and Minify would find
   * its own work missing. Ours are the only mods this switch has any business touching.
   */
  isTogglableModFile(baseLower) {
    return !isOfficialLangFile(baseLower) && !isMinifyFile(baseLower) && baseLower !== OWNERSHIP_FILE;
  }

  // true when the master switch is currently "off" (any .moff file present in lang root)
  masterIsOff() {
    const lang = this.langFolder();
    if (!fs.existsSync(lang)) return false;
    for (const f of fs.readdirSync(lang)) if (f.toLowerCase().endsWith(MASTER_OFF)) return true;
    return false;
  }

  // Enable/disable every mod pak at once without losing per-mod state:
  //  off -> rename each active mod file <f> to <f>.moff (skips .off and official files)
  //  on  -> rename each <f>.moff back to <f>
  // Also covers the language\maps folder (terrain mods live there as dota.vpk).
  setMasterEnabled(enabled) {
    const lang = this.langFolder();
    if (!fs.existsSync(lang)) return { changed: 0 };
    let changed = 0;
    const sweep = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (!fs.statSync(full).isFile()) continue;
        const lower = f.toLowerCase();
        if (enabled) {
          if (lower.endsWith(MASTER_OFF)) {
            fs.renameSync(full, path.join(dir, f.slice(0, -MASTER_OFF.length)));
            changed++;
          }
        } else {
          if (lower.endsWith(MASTER_OFF) || lower.endsWith('.off')) continue; // already off
          if (dir === lang && !this.isTogglableModFile(lower)) continue;       // official files
          fs.renameSync(full, full + MASTER_OFF);
          changed++;
        }
      }
    };
    sweep(lang);
    const mapsDir = path.join(lang, 'maps');
    if (fs.existsSync(mapsDir)) sweep(mapsDir);
    return { changed };
  }

  /** Which part of the load order a category's mods belong in (src/slot-zones.js). */
  zoneFor(categoryId) {
    return zones.zoneFor(categoryId);
  }

  allocatePak(used, priority) {
    // A priority mod past the 28 slots of its own still goes in, in the first free slot after
    // them: ahead of nothing, but installed. The rest never take a priority slot.
    const name = (priority && zones.freeSlotIn('priority', used)) || zones.freeSlotIn('normal', used);
    if (!name) throw new Error(t('Свободных слотов pakNN не осталось (30-99 заняты)'));
    used.add(name);
    return name;
  }

  /** Into the part of the load order its category belongs in (src/slot-zones.js). */
  moveToZone(rec) {
    return zones.moveToZone(this, rec);
  }

  /** The one-time layout of an order from before the two parts (src/slot-zones.js). */
  migrateSlotZones(library) {
    return zones.migrateSlotZones(this, library);
  }

  /**
   * Map the .vpk files of an archive onto slots of ours: one slot per volume set - a
   * "<base>_dir.vpk" index plus its "<base>_NNN.vpk" data archives - so a set stays whole
   * and no foreign name reaches the game folder. It has to be a plan made up front rather
   * than a rename per file, because the volumes only work under the index's own name.
   *
   * This is what the "!pakNN" prefix in Dota2PornFx cart archives runs into: it is a merge
   * hint for VPKMerge, and a file called "!pak51_000.vpk" is one the game never mounts.
   * @param {string[]} relPaths  .vpk paths inside the archive
   * @returns {Map<string, string>} archive path -> file name in the language folder
   */
  planPakNames(relPaths, used, priority) {
    const groups = new Map(); // "<folder>|<base>" -> [{ rel, part }]
    for (const rel of relPaths) {
      const name = rel.split('/').pop();
      const folder = rel.slice(0, rel.length - name.length).toLowerCase();
      const mDir = name.match(/^(.*)_dir\.vpk$/i);
      const mPart = name.match(/^(.*)_(\d{3})\.vpk$/i);
      const base = (mDir && mDir[1]) || (mPart && mPart[1]) || name.replace(/\.vpk$/i, '');
      const key = `${folder}|${base.toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ rel, part: mDir ? null : (mPart && mPart[2]) || null });
    }
    const plan = new Map();
    for (const items of groups.values()) {
      const slot = this.allocatePak(used, priority).replace(/_dir\.vpk$/i, '');
      for (const it of items) plan.set(it.rel, it.part ? `${slot}_${it.part}.vpk` : `${slot}_dir.vpk`);
    }
    return plan;
  }

  // ---------- load order ----------
  //
  // The game mounts pakNN_dir.vpk in numeric order and the FIRST copy of a file wins, so a
  // mod's pak number is its priority: a smaller number sits on top. That is what makes
  // "put these arms over that hero set" a real thing rather than a conflict - both mods
  // load, and the one on top supplies the files they share.

  // The slot a record occupies ("pak07"), or null for mods that live outside a numbered
  // pak (terrain maps, fonts, cursors).
  slotBase(rec) {
    const dir = (rec.files || []).find((f) => f.root === 'lang' && /^pak\d+_dir\.vpk$/i.test(f.relPath));
    return dir ? dir.relPath.replace(/_dir\.vpk$/i, '').toLowerCase() : null;
  }

  slotNumber(rec) {
    const base = this.slotBase(rec);
    return base ? Number(base.slice(3)) : null;
  }

  /**
   * Which mods are quietly covering which, file by file.
   *
   * Two mods can carry the same file, and then only one of them is the one the game loads -
   * the lower pak number, as above. Nothing said so, so a mod that had been overruled looked
   * installed and switched on while doing nothing, and the usual conclusion was that the app
   * had broken it. Measured on 84 installed mods: 801 paths are carried by more than one mod,
   * but only 84 of those hold *different* bytes. The rest is filler both authors happened to
   * ship, which is why the CRC decides and a shared path on its own does not.
   *
   * @param {Array<{key: string, name: string, files: Array<{root: string, relPath: string}>}>} mods
   *   enabled mods only - a switched-off mod is renamed on disk and the game never sees it.
   *   Keyed rather than named, because two copies of the same mod in two slots share a name
   *   and are exactly the case worth reporting.
   * @returns {Map<string, Array<{name: string, files: number}>>} mod key -> who covers it
   */
  coverage(mods) {
    const owners = new Map(); // inner path -> [{ key, name, slot, crc }]
    for (const mod of mods) {
      const dir = (mod.files || []).find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
      if (!dir) continue;
      const slot = this.slotNumber(mod);
      if (slot === null) continue;
      let crcs;
      try { crcs = listVpkPathCrcs(readVpkIndexFile(this.langFileOnDisk(dir.relPath))); } catch { continue; }
      for (const [p, crc] of crcs) {
        if (STOCK_ASSET.test(p)) continue;
        if (!owners.has(p)) owners.set(p, []);
        owners.get(p).push({ key: mod.key, name: mod.name, slot, crc });
      }
    }

    const covered = new Map(); // loser key -> Map(winner name -> file count)
    for (const [, list] of owners) {
      if (list.length < 2) continue;
      const top = list.reduce((a, b) => (b.slot < a.slot ? b : a));
      for (const other of list) {
        // same bytes is not a fight: whichever the game picks, the file is identical
        if (other.key === top.key || other.crc === top.crc) continue;
        if (!covered.has(other.key)) covered.set(other.key, new Map());
        const by = covered.get(other.key);
        by.set(top.name, (by.get(top.name) || 0) + 1);
      }
    }

    const out = new Map();
    for (const [loser, by] of covered) {
      out.set(loser, [...by].map(([name, files]) => ({ name, files })).sort((a, b) => b.files - a.files));
    }
    return out;
  }

  // highest free slot strictly below `n`, so climbing over one mod does not eat the whole
  // low range that the priority categories want
  freeSlotBelow(n, used) {
    for (let i = n - 1; i >= 2; i--) {
      // `used` is read off the folder, so Minify's paks are already in it once it has run.
      // Skipped by number as well, for the machine where it is installed but has not patched
      // yet: taking 66 today means losing that mod the first time it does.
      if (RESERVED_PAKS.includes(i) || i === zones.APP_PAK) continue;
      const base = `pak${String(i).padStart(2, '0')}`;
      if (!used.has(`${base}_dir.vpk`)) return base;
    }
    return null;
  }

  /**
   * Rename every pak file of a record to another slot, keeping .off/.moff state and the
   * volume numbering of a multi-volume pack.
   * @returns {Array<object>} the record's new files array (caller stores it)
   */
  moveToSlot(rec, newBase, oldBase = this.slotBase(rec)) {
    const lang = this.langFolder();
    if (!oldBase) throw new Error(t('У мода нет слота pakNN'));
    const mine = new RegExp(`^${oldBase}(_dir|_\\d{3})\\.vpk$`, 'i');
    return (rec.files || []).map((f) => {
      if (f.root !== 'lang' || !mine.test(f.relPath)) return f;
      const next = newBase + f.relPath.slice(oldBase.length);
      for (const suf of ['', '.off', MASTER_OFF]) {
        const from = path.join(lang, f.relPath + suf);
        if (fs.existsSync(from)) fs.renameSync(from, path.join(lang, next + suf));
      }
      return { ...f, relPath: next };
    });
  }

  /**
   * Trade two records' slots, which is how a mod moves up or down the load order.
   * pak00 is the parking spot for the swap - the game never mounts it, so a crash
   * mid-swap leaves a file that is merely inactive, not one fighting for a name in use.
   * @returns {Array<{ id: string, files: Array<object> }>} records to save
   */
  swapSlots(a, b) {
    const aBase = this.slotBase(a);
    const bBase = this.slotBase(b);
    if (!aBase || !bBase) throw new Error(t('У мода нет слота pakNN'));
    const parked = this.moveToSlot(a, 'pak00');
    try {
      const movedB = this.moveToSlot(b, aBase);
      const movedA = this.moveToSlot({ ...a, files: parked }, bBase);
      return [{ id: a.id, files: movedA }, { id: b.id, files: movedB }];
    } catch (err) {
      // put ours back where it was rather than leave it parked in a slot nothing mounts
      try { this.moveToSlot({ ...a, files: parked }, aBase); } catch { /* nothing else to try */ }
      throw err;
    }
  }

  // ---------- helpers ----------

  // Both take an optional transaction: the operations that touch several files at once run
  // inside one (see FileTx), the odd single write does not need it.
  copyInto(src, destAbs, tx = null) {
    copyInto(src, destAbs, tx);
  }

  writeInto(buf, destAbs, tx = null) {
    writeInto(buf, destAbs, tx);
  }

  // ---------- install ----------

  /**
   * Installs a mod. Returns array of installed file records:
   * [{ root: 'lang'|'fonts'|'cursor'|'tools', relPath, backup? }]
   */
  async install({ categoryId, modName, fileRef }) {
    // Before the download, not after it. The folder check used to happen at the write, so a
    // mod with nowhere to go still cost the user a 300 MB download first and only then said
    // no. Tools are the exception: they live in the app's own folder and need no game.
    if (categoryId !== 'tools') this.requireGameFolder();
    const local = await this.download(categoryId, fileRef, modName);
    this.onProgress({ type: 'stage', label: modName, stage: t('установка') });
    // A mod is rarely one file, and everything below writes into somebody else's game
    // folder. One transaction around the lot: a failure on the fourth file takes the first
    // three with it, instead of leaving paks nothing in the library points at.
    return FileTx.run((tx) => this.installInto(tx, { categoryId, modName, local }));
  }

  installInto(tx, { categoryId, modName, local }) {
    const isPriority = PRIORITY_CATEGORIES.includes(categoryId);
    if (categoryId === 'fonts') return this.overlays.installFonts(local, modName, tx);
    if (categoryId === 'cursors') return this.overlays.installCursor(local, modName, tx);
    if (categoryId === 'tools') return this.installTool(local, modName, tx);

    const lang = this.langFolder();
    this.ensureLangFolder();
    const used = this.usedPakNames();
    const records = [];

    if (local.toLowerCase().endsWith('.vpk')) {
      const pakName = this.allocatePak(used, isPriority);
      this.copyInto(local, path.join(lang, pakName), tx);
      records.push({ root: 'lang', relPath: pakName });
      return records;
    }

    if (!local.toLowerCase().endsWith('.zip')) {
      // unknown single file — drop into lang folder as-is
      const base = path.basename(local);
      this.copyInto(local, path.join(lang, base), tx);
      records.push({ root: 'lang', relPath: base });
      return records;
    }

    const archive = openZip(local, { label: modName });
    const kept = archive.files.filter((file) => {
      const lower = file.path.toLowerCase();
      const baseName = lower.split('/').pop();
      return !!baseName && !lower.includes('!guide')
        && !/(^|\/)(guide\.txt|install\.bat|uninstall\.bat|readme[^/]*)$/i.test(lower);
    });
    // slots for the archive's VPKs, decided before a byte is written (see planPakNames).
    // A "maps/..." payload is not a pak: terrains and the mods that come with them replace
    // the map file itself, which only works from maps\dota.vpk (the same rule the importer
    // reads by), so those keep their path.
    const isMapsPath = (l) => /(^|\/)maps\//.test(l);
    const pakPlan = this.planPakNames(
      kept.map((f) => f.path).filter((rel) => /\.vpk$/i.test(rel) && !isMapsPath(rel.toLowerCase())),
      used, isPriority
    );

    for (const file of kept) {
      const rel = file.path;
      const lower = rel.toLowerCase();

      if (isMapsPath(lower)) {
        // keep maps/... structure inside the language folder
        const parts = rel.split('/');
        const mapsIdx = parts.findIndex((p) => p.toLowerCase() === 'maps');
        const relPath = parts.slice(mapsIdx).join('/');
        this.writeInto(file.read(), safeJoin(lang, relPath), tx);
        records.push({ root: 'lang', relPath });
      } else if (pakPlan.has(rel)) {
        const pakName = pakPlan.get(rel);
        this.writeInto(file.read(), safeJoin(lang, pakName), tx);
        records.push({ root: 'lang', relPath: pakName });
      } else {
        // any other payload file — preserve relative path inside lang folder,
        // stripping the zip's top-level "<Mod Name>/" wrapper if present
        const parts = rel.split('/');
        const relPath = parts.length > 1 ? parts.slice(1).join('/') : rel;
        if (!relPath) continue;
        this.writeInto(file.read(), safeJoin(lang, relPath), tx);
        records.push({ root: 'lang', relPath });
      }
    }
    return records;
  }

  installTool(localZip, modName, tx = null) {
    const dest = path.join(this.toolsDir, modName.replace(/[<>:"/\\|?*]/g, '_'));
    fs.mkdirSync(dest, { recursive: true });
    if (localZip.toLowerCase().endsWith('.zip')) {
      openZip(localZip, { label: modName }).extractTo(dest, tx);
    } else {
      this.copyInto(localZip, path.join(dest, path.basename(localZip)), tx);
    }
    return [{ root: 'tools', relPath: path.basename(dest) }];
  }

  // ---------- fonts and cursors ----------

  // Loose files over the game's own live in src/overlays.js; these are the calls the rest of
  // the app makes.
  cursorStoreDir(recId) { return this.overlays.cursorStoreDir(recId); }
  ensureCursorStore(recId, files) { return this.overlays.ensureCursorStore(recId, files); }
  deployCursor(recId, files) { return this.overlays.deployCursor(recId, files); }
  undeployCursor(recId, files) { return this.overlays.undeployCursor(recId, files); }
  cursorZip(rec) { return this.overlays.cursorZip(rec); }
  fontFolderHashes() { return this.overlays.fontFolderHashes(); }
  lostToVerify(records) { return this.overlays.lostToVerify(records); }
  restoreDeployed(rec) { return this.overlays.restoreDeployed(rec); }

  // ---------- enable / disable / remove ----------

  rootAbs(root) {
    const game = this.getGamePath();
    switch (root) {
      case 'lang': return this.langFolder();
      case 'fonts': return path.join(game, ...FONTS_SUBDIR);
      case 'cursor': return path.join(game, ...CURSOR_SUBDIR);
      case 'tools': return this.toolsDir;
      default: throw new Error(t('Неизвестный root: {0}', root));
    }
  }

  // recId is needed for cursor sets (see the cursor section above); without it a cursor
  // record is left alone, exactly as before.
  // A mod switched half off is worse than either state: the game mounts the paks that kept
  // their name and loads a mod that is missing pieces. So the renames are one transaction -
  // if Dota grabs the third file, the first two go back to how they were.
  setEnabled(files, enabled, recId = null) {
    if (recId && this.overlays.cursorFiles(files).length) {
      if (enabled) this.overlays.deployCursor(recId, files);
      else this.overlays.undeployCursor(recId, files);
      return;
    }
    FileTx.run((tx) => {
      for (const f of files) {
        if (f.root === 'tools') continue;
        if (f.root === 'fonts' || f.root === 'cursor') continue; // handled by reinstall/restore
        const abs = path.join(this.rootAbs(f.root), f.relPath);
        const off = abs + '.off';
        if (enabled && fs.existsSync(off)) tx.move(off, abs);
        if (!enabled && fs.existsSync(abs)) tx.move(abs, off);
      }
    });
  }

  // opts.recId drops the record's stored cursor copy; opts.deployed=false says its files are
  // not the ones on disk right now (it was switched off), so vanilla must not be restored
  // over whatever cursor took its place.
  remove(files, opts = {}) {
    const { recId = null, deployed = true } = opts;
    this.overlays.dropCursorStore(recId);
    if (!deployed) files = files.filter((f) => f.root !== 'cursor');
    // Removing is deleting files AND putting Valve's own back where a font or cursor sat on
    // top of one. Half of that leaves a mod that is gone from the library but still on disk,
    // or a game missing a font it shipped with, so it is all one change.
    FileTx.run((tx) => {
      for (const f of files) {
        const rootAbs = this.rootAbs(f.root);
        if (f.root === 'tools') {
          tx.remove(path.join(rootAbs, f.relPath));
          continue;
        }
        const abs = path.join(rootAbs, f.relPath);
        for (const p of [abs, abs + '.off', abs + MASTER_OFF]) {
          if (fs.existsSync(p)) tx.remove(p);
        }
        if (f.root === 'fonts' || f.root === 'cursor') {
          // restore vanilla file from backup if we have one
          const backupAbs = path.join(this.backupsDir, f.root === 'fonts' ? 'fonts' : 'cursor', f.relPath);
          if (fs.existsSync(backupAbs)) {
            this.copyInto(backupAbs, abs, tx);
          }
        }
      }
    });
    this.overlays.forgetWritten(files);
  }

  /**
   * Clean up after a transaction that never finished, which can only mean the app was killed
   * mid-write. Two cases, and they need opposite answers:
   *   the original is missing → the parked copy IS the file, put it back (an interrupted
   *     remove or rename, e.g. switching a mod off);
   *   the original is there   → the write went through and the parked copy is the old
   *     version commit would have deleted. Left alone for a week in case somebody wants it,
   *     then dropped so the folder does not collect them.
   * @returns {{ restored: number, dropped: number }}
   */
  sweepStaged(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    const out = { restored: 0, dropped: 0 };
    const game = this.getGamePath();
    if (!game) return out;
    const dirs = [];
    try { dirs.push(this.langFolder()); } catch { /* no language folder yet */ }
    dirs.push(path.join(game, ...FONTS_SUBDIR), path.join(game, ...CURSOR_SUBDIR), this.toolsDir);
    for (const dir of dirs) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const name of names) {
        if (!STAGED_RE.test(name)) continue;
        const parked = path.join(dir, name);
        const original = path.join(dir, name.replace(STAGED_RE, ''));
        try {
          if (!fs.existsSync(original)) { fs.renameSync(parked, original); out.restored++; continue; }
          if (Date.now() - fs.statSync(parked).mtimeMs > maxAgeMs) { fs.rmSync(parked, { recursive: true, force: true }); out.dropped++; }
        } catch { /* locked or gone: it will be here next start too */ }
      }
    }
    return out;
  }

  // ---------- export as a single self-contained vpk ----------

  /**
   * A mod's lang files (including multi-part _dir + _NNN sets) merged into one
   * self-contained VPK buffer - the single-file format the catalog uses, e.g. for sharing
   * an imported Dota2Changer pack with a catalog author.
   * @param {object} rec
   * @param {Array<{id, name, block}>} [deltas]  the record's lifted item blocks, for a file
   *   headed somewhere other than this install (an export, a shared preset). Installing
   *   strips the table a mod ships and keeps its blocks on the record instead, so without
   *   these the copy leaves without its effects - see harvestSchema / schema.deltaTable.
   */
  mergeToSingleVpk(rec, deltas) {
    const lang = this.langFolder();
    const dirRec = rec.files.find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
    if (!dirRec) throw new Error(t('У этого мода нет _dir.vpk — объединять нечего'));
    // resolve real on-disk name (files may be disabled -> ".off")
    const resolve = (relPath) => {
      const abs = path.join(lang, relPath);
      for (const suf of ['', '.off', MASTER_OFF]) if (fs.existsSync(abs + suf)) return abs + suf;
      return abs;
    };
    const dirAbs = resolve(dirRec.relPath);
    const base = dirRec.relPath.replace(/_dir\.vpk$/i, '');
    const archivePathFor = (idx) => resolve(`${base}_${String(idx).padStart(3, '0')}.vpk`);
    if (!deltas || !deltas.length) return mergeVpkToSingle(dirAbs, archivePathFor);

    const entries = readVpkEntries(fs.readFileSync(dirAbs), dirAbs, archivePathFor)
      .filter((e) => !/(^|\/)items_game\.txt"?$/.test(entryPath(e)));
    // latin1 keeps the blocks byte-exact, the way the whole schema path reads and writes them
    const data = Buffer.from(deltaTable(deltas), 'latin1');
    entries.push({ ext: 'txt', folder: 'scripts/items', name: 'items_game', crc: crc32(data), preload: Buffer.alloc(0), data });
    return buildVpk(entries);
  }

  // ---------- reading, repacking and unpacking what is already installed ----------
  //
  // Taking a mod IN - from a file, a zip, a folder or bytes off a drop - moved to
  // src/import.js. What is left here works on what the folder already holds.
  /**
   * The inverse of packing a folder: write a mod's own files out as a tree, so the author
   * who wants to change one texture can open it, edit it, and drop the folder back in.
   * Multi-volume sets are followed, exactly as exporting to one file does.
   * @returns {{ files: number, bytes: number }}
   */
  unpackToFolder(rec, dest) {
    const dirRec = (rec.files || []).find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
    if (!dirRec) throw new Error(t('У этого мода нет _dir.vpk — распаковывать нечего'));
    const dirAbs = this.langFileOnDisk(dirRec.relPath);
    const base = dirRec.relPath.replace(/_dir\.vpk$/i, '');
    const archivePathFor = (idx) => this.langFileOnDisk(`${base}_${String(idx).padStart(3, '0')}.vpk`);
    const entries = readVpkEntries(fs.readFileSync(dirAbs), dirAbs, archivePathFor);

    let bytes = 0;
    for (const en of entries) {
      const rel = entryPath(en);
      // the archive names the file, so the archive could name a path outside the folder;
      // safeJoin is the same guard foreign zips go through (see src/safe-zip.js)
      const out = safeJoin(dest, rel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const data = en.data.length ? en.data : en.preload;
      fs.writeFileSync(out, data);
      bytes += data.length;
    }
    return { files: entries.length, bytes };
  }

  /**
   * Say on disk which files in the language folder are this app's.
   *
   * Rewritten from the library rather than appended to, so a mod removed outside the app
   * drops out on the next write instead of lingering as a claim on a file we do not have.
   * Never fails an operation: an unwritable game folder is a problem for installing, not for
   * a note about installing.
   * @param {string[]} relPaths every lang-root relPath the library holds
   */
  writeOwnership(relPaths) {
    try {
      const lang = this.langFolder();
      if (!fs.existsSync(lang)) return;
      const files = [...new Set((relPaths || []).map((r) => String(r).replace(/\\/g, '/')))].sort();
      const body = {
        app: 'Dota 2 Mod Manager',
        url: 'https://dota2modmanager.com',
        note: 'Files listed here were installed by this app. Anything else in this folder is not ours.',
        updated: new Date().toISOString(),
        files,
      };
      fs.writeFileSync(path.join(lang, OWNERSHIP_FILE), JSON.stringify(body, null, 2));
    } catch { /* a note nobody can write is not worth failing an install over */ }
  }

  /** Whether this app installed the file at `relPath`, according to what is on disk. */
  ownsFile(relPath) {
    try {
      const lang = this.langFolder();
      const raw = JSON.parse(fs.readFileSync(path.join(lang, OWNERSHIP_FILE), 'utf-8'));
      const want = String(relPath).replace(/\\/g, '/').toLowerCase();
      return (raw.files || []).some((f) => String(f).toLowerCase() === want);
    } catch {
      return false;
    }
  }

  // A content-derived display name for a lang VPK (hero / set / kind), or null if the
  // content isn't recognisable — used to name imported files instead of a bare "pakNN".
  displayNameForFile(relPath) {
    try {
      return nameFromAnalysis(analyzeVpkPaths(listVpkPathsFile(this.langFileOnDisk(relPath))));
    } catch { return null; }
  }

  /**
   * Take the whole-game tables out of a freshly installed mod and keep what they meant.
   *
   * Skinchanger-style packs ship a full copy of scripts/items/items_game.txt and of the
   * localization files - tens of MB of stale game data per mod. The schema copy is dead
   * weight in a language folder (the engine reads that file through the MOD path only),
   * and the localization copy is worse than dead: it outranks the game's own and rolls
   * text back to whenever the pack was built. So: lift the item blocks the mod actually
   * changed, then repack the VPK without any of those tables.
   *
   * @param {Array<{root: string, relPath: string}>} records  install records, edited in place
   * @param {string} vanillaText  the game's current items_game.txt
   * @returns {{ deltas: Array<{id, name, block}>, stripped: string[] }}
   */
  harvestSchema(records, vanillaText) {
    const lang = this.langFolder();
    const deltas = [];
    const stripped = [];
    for (const rec of records) {
      if (rec.root !== 'lang' || !/_dir\.vpk$/i.test(rec.relPath)) continue;
      const abs = path.join(lang, rec.relPath);
      if (!fs.existsSync(abs)) continue;
      let paths;
      try { paths = listVpkPathsFile(abs); } catch { continue; }
      if (!paths.some((p) => GLOBAL_TABLE_RE.test(p))) continue;

      const base = rec.relPath.replace(/_dir\.vpk$/i, '');
      const partRe = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d{3}\\.vpk$`, 'i');
      const parts = fs.readdirSync(lang).filter((f) => partRe.test(f));
      const total = [abs, ...parts.map((f) => path.join(lang, f))].reduce((n, f) => n + fs.statSync(f).size, 0);
      if (total > MERGE_SIZE_CAP) continue; // repacking holds the mod in memory once

      let entries;
      try { entries = readVpkEntries(fs.readFileSync(abs), abs); } catch { continue; }
      const schemaEntry = entries
        .filter((e) => /(^|\/)items_game\.txt"?$/.test(entryPath(e)))
        .sort((a, b) => b.data.length - a.data.length)[0];
      // Any size: a mod off the internet ships the whole 47 MB table, but a mod exported by
      // this app carries only its own blocks (see mergeToSingleVpk), and that file is small.
      if (schemaEntry && schemaEntry.data.length && vanillaText) {
        try {
          for (const d of extractDeltas(schemaEntry.data.toString('latin1'), paths, vanillaText)) deltas.push(d);
        } catch { /* a mangled table is not worth failing the install over */ }
      }

      // A localization file the size of the game's own is a stale copy of it; a small one
      // is a deliberate edit (a mod renaming an item), and that we keep.
      const drop = (e) => {
        const p = entryPath(e);
        if (!GLOBAL_TABLE_RE.test(p)) return false;
        if (/^resource\/localization\//.test(p) && e.data.length < LOC_COPY_MIN) return false;
        return true;
      };
      const keep = entries.filter((e) => !drop(e));
      if (keep.length === entries.length) continue;
      fs.writeFileSync(abs, buildVpk(keep));
      for (const f of parts) fs.rmSync(path.join(lang, f), { force: true });
      stripped.push(rec.relPath);
    }
    // volume files are folded into the single-file rebuild above
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (r.root === 'lang' && /_\d{3}\.vpk$/i.test(r.relPath) && !fs.existsSync(path.join(lang, r.relPath))) {
        records.splice(i, 1);
      }
    }
    return { deltas, stripped };
  }

  // Bytes a record occupies in the language folder (its pak plus any data volumes).
  installedSize(rec) {
    const lang = this.langFolder();
    let total = 0;
    for (const f of rec.files || []) {
      if (f.root !== 'lang') continue;
      const abs = path.join(lang, f.relPath);
      try { total += fs.statSync(abs).size; } catch { /* removed by hand */ }
    }
    return total;
  }

  // What a stored library record (or a foreign vpk) actually changes — hero(es) and
  // slots — read from its _dir.vpk on disk. Returns { info, heroes } or null.
  analyzeRecord(rec) {
    const dir = rec.files.find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
    if (!dir) return null;
    try {
      const buf = readVpkIndexFile(this.langFileOnDisk(dir.relPath));
      const paths = listVpkPaths(buf);
      const a = analyzeVpkPaths(paths);
      const told = this.describePaths(paths, a);
      return {
        info: told.info, heroes: a.heroes.length,
        // What the file is actually about — the heroes it could be split into. Every hero it
        // merely mentions counts for the summary, not for splitting, and neither does one it
        // borrowed a prop from: subjectHeroes is what draws that line, and drawing it here a
        // second time is how a Clinkz set with a Phoenix immortal on its bow kept splitting
        // itself in half after the line had already moved.
        subjects: subjectHeroes(a).filter((h) => h.models > 0).length,
        // the game's own names for what this replaces, when it recognises any of it
        items: told.items,
        // which hero(es) the content is for, by display name - lets the renderer show a
        // hero's own portrait as a stand-in for an import with no picture of its own
        heroNames: told.heroNames,
        fp: fingerprintVpk(buf),
      };
    } catch { return null; }
  }

  // Split a merged multi-hero VPK sitting in the lang folder into one managed VPK per
  // hero, each written to a fresh pak slot. Returns [{ hero, name, files }]; caller
  // registers them and deletes the source. Empty if fewer than 2 heroes are found.
  splitVpkFile(sourceRelPath) {
    const lang = this.langFolder();
    const parts = splitVpkByHero(path.join(lang, sourceRelPath));
    if (!parts.length) return [];
    const used = this.usedPakNames();
    return parts.map((part) => {
      const pakName = this.allocatePak(used, false);
      this.writeInto(part.buf, path.join(lang, pakName));
      return { hero: part.name, name: part.name, paths: part.paths, files: [{ root: 'lang', relPath: pakName }] };
    });
  }

  // ---------- combined packs (many mods -> one pakNN slot) ----------

  packFolder(packId) { return path.join(this.packsDir, packId); }
  packMemberFile(packId, memberId) { return path.join(this.packFolder(packId), `${memberId}.vpk`); }

  // Flatten a library record into one self-contained VPK and store it as a pack member.
  // Returns the member descriptor (identity + a content summary for the UI) to record in
  // the pack manifest. The record's own deployed files are left for the caller to remove.
  addPackMemberFromRecord(packId, rec, memberId) {
    const buf = this.mergeToSingleVpk(rec);
    fs.mkdirSync(this.packFolder(packId), { recursive: true });
    fs.writeFileSync(this.packMemberFile(packId, memberId), buf);
    let heroes = 0, info = '', fp = null;
    try {
      const a = analyzeVpkPaths(listVpkPaths(buf));
      heroes = a.heroes.length; info = describeAnalysis(a); fp = fingerprintVpk(buf);
    } catch { /* summary is best-effort */ }
    return {
      id: memberId, name: rec.name, categoryId: rec.categoryId, styleLabel: rec.styleLabel || null,
      preview: rec.preview || null, enabled: rec.enabled !== false, heroes, info, fp,
    };
  }

  // Remove a pack's currently deployed files (index + every data volume, in any state:
  // active, .off or .moff) from the language folder, so it can be rebuilt cleanly.
  removePackDeployed(pack) {
    const lang = this.langFolder();
    if (!fs.existsSync(lang)) return;
    const base = this.packBase(pack);
    if (!base) return;
    const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_dir|_\\d{3})\\.vpk(\\.off|\\.moff)?$`, 'i');
    for (const f of fs.readdirSync(lang)) if (re.test(f)) fs.rmSync(path.join(lang, f), { force: true });
  }

  // The pak slot base ("pak10") a pack deploys to — reused across rebuilds so the slot
  // stays stable. Taken from the pack's recorded files, else null (allocate on deploy).
  packBase(pack) {
    const dir = (pack.files || []).find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
    return dir ? dir.relPath.replace(/_dir\.vpk$/i, '') : null;
  }

  // (Re)build a pack's single deployed VPK from its enabled members. Removes the old
  // deployment first, then combines enabled member sources into the pack's slot. Returns
  // { files, conflicts } — caller stores files on the record and re-applies enabled/master
  // state. With no enabled members nothing is written (files: []).
  deployPack(pack) {
    const lang = this.langFolder();
    this.ensureLangFolder();
    this.removePackDeployed(pack);
    const enabled = (pack.members || []).filter((m) => m.enabled);
    if (!enabled.length) return { files: [], conflicts: [] };
    let base = this.packBase(pack);
    if (!base) base = this.allocatePak(this.usedPakNames(), false).replace(/_dir\.vpk$/i, '');
    const members = enabled.map((m) => ({ key: m.id, buf: fs.readFileSync(this.packMemberFile(pack.id, m.id)) }));
    const { dir, parts, conflicts } = combineVpksToFiles(members, lang, base);
    const files = [{ root: 'lang', relPath: dir }, ...parts.map((p) => ({ root: 'lang', relPath: p }))];
    return { files, conflicts };
  }

  // Fully delete a pack: its deployed VPK and every stored member source.
  removePackFully(pack) {
    this.removePackDeployed(pack);
    try { fs.rmSync(this.packFolder(pack.id), { recursive: true, force: true }); } catch { /* noop */ }
  }

  // Turn a stored pack member back into a standalone deployed mod in a fresh pak slot.
  // Returns { files } for a new library record; caller deletes the member from the pack.
  deployMemberAsMod(pack, member) {
    const lang = this.langFolder();
    this.ensureLangFolder();
    const buf = fs.readFileSync(this.packMemberFile(pack.id, member.id));
    const pakName = this.allocatePak(this.usedPakNames(), false);
    this.writeInto(buf, path.join(lang, pakName));
    return { files: [{ root: 'lang', relPath: pakName }] };
  }

  // Does a record's primary VPK still exist on disk (active/.off/.moff)? Used to sync the
  // library with the folder — a mod deleted from the folder should drop out of the library.
  langPrimaryPresent(rec) {
    let lang;
    try { lang = this.langFolder(); } catch { return true; } // no game path — can't tell, keep it
    if (!fs.existsSync(lang)) return true; // folder missing entirely — don't nuke the manifest
    const primary = (rec.files || []).find((f) => f.root === 'lang' && /\.vpk$/i.test(f.relPath));
    if (!primary) return true; // fonts/cursors/tools live elsewhere — not folder-synced
    return ['', '.off', '.moff'].some((suf) => fs.existsSync(path.join(lang, primary.relPath + suf)));
  }

  // Number of occupied pak slots (mod paks only, excluding the game's own pak01_*), used
  // to warn/suggest combining when the library approaches the 99-slot ceiling.
  usedModSlots() {
    const lang = this.langFolder();
    if (!fs.existsSync(lang)) return 0;
    const bases = new Set();
    for (const f of fs.readdirSync(lang)) {
      const m = f.toLowerCase().replace(/\.moff$/, '').replace(/\.off$/, '').match(/^(pak\d+)_dir\.vpk$/);
      if (m && !isOfficialLangFile(`${m[1]}_dir.vpk`)) bases.add(m[1]);
    }
    return bases.size;
  }

  // Older app versions wrote priority mods as "!pakNN_dir.vpk" — a name the game
  // never mounts, so those mods silently did nothing. Rename them to real low
  // pak slots and fix the matching manifest records.
  migrateLegacyPriorityPaks(library) {
    const lang = this.langFolder();
    if (!fs.existsSync(lang)) return;
    const legacy = fs.readdirSync(lang).filter((f) => /^!pak\d+_dir\.vpk(\.off)?$/i.test(f));
    if (!legacy.length) return;
    const used = this.usedPakNames();
    let changed = false;
    for (const f of legacy) {
      const disabled = /\.off$/i.test(f);
      const oldBase = f.replace(/\.off$/i, '');
      const newBase = this.allocatePak(used, true);
      fs.renameSync(path.join(lang, f), path.join(lang, newBase + (disabled ? '.off' : '')));
      for (const rec of library.list()) {
        for (const fr of rec.files) {
          if (fr.root === 'lang' && fr.relPath.toLowerCase() === oldBase.toLowerCase()) {
            fr.relPath = newBase;
            changed = true;
          }
        }
      }
    }
    if (changed) library.save();
  }

  // Imports made before multi-volume sets were folded on the way in still sit in the
  // folder as pakNN_dir.vpk + pakNN_000.vpk. Fold them now so every managed mod is one
  // file. Combined packs are left alone — their volumes are how deployPack writes them.
  mergeMultiPartRecords(library) {
    const lang = this.langFolder();
    if (!fs.existsSync(lang)) return;
    const onDisk = (relPath) => ['', '.off', MASTER_OFF]
      .map((suf) => path.join(lang, relPath) + suf).find((p) => fs.existsSync(p));

    // No `changed` flag and no save at the end: library.update() below persists each record
    // as it is folded, which is what the sibling above needs a flag for and this does not.
    for (const rec of library.list()) {
      if (rec.kind === 'pack') continue;
      const dirRec = (rec.files || []).find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
      const parts = (rec.files || []).filter((f) => f.root === 'lang' && /_\d{3}\.vpk$/i.test(f.relPath));
      if (!dirRec || !parts.length) continue;
      const dirAbs = onDisk(dirRec.relPath);
      if (!dirAbs) continue;
      try {
        const base = dirRec.relPath.replace(/_dir\.vpk$/i, '');
        const total = parts.reduce((s, f) => { const p = onDisk(f.relPath); return s + (p ? fs.statSync(p).size : 0); }, 0);
        if (total > MERGE_SIZE_CAP) continue;
        const merged = mergeVpkToSingle(dirAbs, (idx) => onDisk(`${base}_${String(idx).padStart(3, '0')}.vpk`));
        // write beside the original and swap, so a failed write can't leave a mod truncated
        fs.writeFileSync(dirAbs + '.merging', merged);
        fs.renameSync(dirAbs + '.merging', dirAbs); // keeps whatever .off/.moff state it had
        for (const f of parts) {
          for (const suf of ['', '.off', MASTER_OFF]) fs.rmSync(path.join(lang, f.relPath) + suf, { force: true });
        }
        library.update(rec.id, { files: rec.files.filter((f) => !parts.includes(f)) });
      } catch { /* missing or unreadable volume — leave the set as it is */ }
    }
  }

  /**
   * Build a foreign VPK item: read enough of the file to name it, illustrate it and
   * recognise it. A file dropped into the folder by hand is the same kind of thing as an
   * import, and the library shows it that way — a bare "pak90_dir.vpk" told the user
   * nothing about what was in it, which is exactly why it looked broken.
   */
  vpkItem(abs, relPath, displayName, primary) {
    const base = relPath.replace(/\.off$/i, '');
    const item = {
      kind: 'vpk', key: relPath, name: displayName, fileName: base, primary,
      size: fs.statSync(abs).size, enabled: !abs.toLowerCase().endsWith('.off'),
      files: [{ root: 'lang', relPath: base }],
    };
    // data volumes that belong to this index — they travel with it on adopt and delete
    for (const part of this.siblingParts(base)) item.files.push({ root: 'lang', relPath: part });
    try {
      const buf = readVpkIndexFile(abs);
      const paths = listVpkPaths(buf);
      const a = analyzeVpkPaths(paths);
      const told = this.describePaths(paths, a);
      item.info = told.info;
      item.heroes = a.heroes.length;
      item.subjects = subjectHeroes(a).filter((h) => h.models > 0).length;
      item.items = told.items;
      item.heroNames = told.heroNames;
      item.kindTag = a.kind;
      item.fp = fingerprintVpk(buf);
      // a content name ("Juggernaut", "Ландшафт") instead of the slot the file happens
      // to sit in; the file name stays on the row as the sub-label
      item.name = nameFromAnalysis(a) || displayName;
    } catch { /* data part / unreadable — leave untagged, keep the file name */ }
    return item;
  }

  // "<base>_NNN.vpk" volumes sitting next to a "<base>_dir.vpk" in the lang folder
  siblingParts(dirRelPath) {
    if (!/_dir\.vpk$/i.test(dirRelPath)) return [];
    const lang = this.langFolder();
    const dir = path.dirname(path.join(lang, dirRelPath));
    const prefix = path.basename(dirRelPath).replace(/_dir\.vpk$/i, '');
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d{3}\\.vpk$`, 'i');
    const sub = path.dirname(dirRelPath);
    try {
      return fs.readdirSync(dir)
        .filter((f) => re.test(f.replace(/\.off$/i, '')))
        .map((f) => (sub === '.' ? f : `${sub}/${f}`).replace(/\.off$/i, ''));
    } catch { return []; }
  }

  // Foreign content — files not installed through the app — across every place a mod
  // can live: the language folder root (skins, imported), language\maps (terrains), and
  // resource\cursor (a cursor set, treated as one item). Each carries a fingerprint so
  // the caller can recognise it as a specific catalog mod. `primary` items (lang root)
  // are always listed; maps/cursor items are only worth showing when they match, so the
  // caller passes scanExtras=false to skip that scan when it has nothing to match against.
  externalFiles(knownFiles, { scanExtras = true } = {}) {
    const game = this.getGamePath();
    if (!game) return [];
    const knownLang = new Set(knownFiles.filter((f) => f.root === 'lang').map((f) => f.relPath.toLowerCase()));
    const knownCursor = knownFiles.some((f) => f.root === 'cursor');
    const out = [];

    const lang = this.langFolder();
    if (fs.existsSync(lang)) {
      const names = fs.readdirSync(lang);
      // a "<base>_NNN.vpk" volume is part of its "<base>_dir.vpk", not a mod of its own:
      // listing it separately gave the user rows they could neither name nor act on
      const indexed = new Set();
      for (const f of names) {
        const b = f.toLowerCase().replace(/\.off$/, '');
        const m = b.match(/^(.*)_dir\.vpk$/);
        if (m) indexed.add(m[1]);
      }
      for (const f of names) {
        const full = path.join(lang, f);
        if (!fs.statSync(full).isFile()) continue;
        if (f.toLowerCase().endsWith(MASTER_OFF)) continue; // master-off files: handled by the toggle, not foreign
        if (STAGED_RE.test(f)) continue; // a file a transaction parked; sweepStaged deals with those
        const base = f.toLowerCase().replace(/\.off$/, '');
        if (isOfficialLangFile(base) || knownLang.has(base)) continue;
        if (base === OWNERSHIP_FILE) continue; // our own note about which files are ours
        // Minify's output, in a folder both apps share: listing it here would offer the user
        // buttons to adopt, disable and delete another program's files. By slot for the three
        // it reserves, and by the marker it packs into everything it builds, which covers a
        // version that ever uses a different number.
        if (isMinifyFile(base) || isMinifyPak(full)) continue;
        const part = base.match(/^(.*)_\d{3}\.vpk$/);
        if (part && indexed.has(part[1])) continue;
        out.push(this.vpkItem(full, f, f, true));
      }
      // terrains ship as language\maps\dota.vpk (not a *_dir.vpk in the root)
      const mapsDir = path.join(lang, 'maps');
      if (scanExtras && fs.existsSync(mapsDir)) {
        for (const f of fs.readdirSync(mapsDir)) {
          if (!/\.vpk$/i.test(f)) continue;
          const rel = `maps/${f}`;
          if (knownLang.has(rel.toLowerCase().replace(/\.off$/, ''))) continue;
          /* A terrain and a Minify map mod are the same file - maps/dota.vpk - so there is no
           * slot to reserve here and nothing to tell them apart except the marker Minify packs
           * into what it builds. A hand-installed terrain has no marker and stays listed: the
           * user should be able to see and remove that one. */
          if (isMinifyPak(path.join(mapsDir, f))) continue;
          out.push(this.vpkItem(path.join(mapsDir, f), rel, rel, false));
        }
      }
    }

    // a foreign cursor set (only when the app isn't already managing cursors)
    if (scanExtras && !knownCursor) {
      const cursorDir = path.join(game, ...CURSOR_SUBDIR);
      if (fs.existsSync(cursorDir)) {
        const files = [];
        const rels = [];
        const walk = (d, pre) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name);
            const rel = pre ? `${pre}/${e.name}` : e.name;
            if (e.isDirectory()) walk(full, rel);
            else if (e.isFile()) { files.push({ path: e.name.toLowerCase(), data: fs.readFileSync(full) }); rels.push(rel); }
          }
        };
        try { walk(cursorDir, ''); } catch { /* unreadable */ }
        if (files.length) {
          out.push({
            kind: 'cursor', key: '__cursor__', name: t('Курсор'), primary: false,
            size: files.reduce((s, x) => s + x.data.length, 0), enabled: true,
            files: rels.map((rp) => ({ root: 'cursor', relPath: rp })), fp: fingerprintFiles(files),
          });
        }
      }
    }
    return out;
  }

  /** The archive this mod was installed from, if it is still in the download cache. */
  cachedArchive(categoryId, fileRef) {
    if (!categoryId || !fileRef) return null;
    try {
      const name = decodeURIComponent(fileUrl(categoryId, fileRef).split('/').pop());
      const p = path.join(this.downloadsDir, categoryId, name);
      return fs.existsSync(p) && fs.statSync(p).size > 0 ? p : null;
    } catch {
      return null;
    }
  }

  downloadCacheSize() {
    let total = 0;
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else total += st.size;
      }
    };
    walk(this.downloadsDir);
    return total;
  }

  clearDownloadCache() {
    fs.rmSync(this.downloadsDir, { recursive: true, force: true });
    fs.mkdirSync(this.downloadsDir, { recursive: true });
  }
}

// MERGE_SIZE_CAP is shared with src/import.js, which folds a multi-volume import into one
// file the same way harvestSchema and mergeMultiPartRecords repack one that is already here.
module.exports = { Installer, PRIORITY_CATEGORIES, MERGE_SIZE_CAP };
