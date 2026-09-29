/* Taking in a mod the user already has: a .vpk, a .zip, a folder, or bytes off a drop.
 *
 * This is the widest door in the app and the least fussy about what comes through it. A
 * Skinchanger pack unzips to a whole game tree with the archive several folders down. A
 * Dota2Changer mod arrives as an index plus data volumes, and the rest of the app assumes one
 * file per mod, so a half-folded set is exactly how a mod ends up half-loaded. An author's
 * working folder holds no archive at all, and is packed on the way in.
 *
 * Lifted out of src/installer.js unchanged. It was 270 lines of a 1,783-line file, reachable
 * only through the class that also downloads, allocates slots, patches the schema and manages
 * cursors. The bodies below are the same bodies; what changed is that the installer arrives as
 * an argument instead of as `this`. Its tests (test/import.test.js) and the mutants that check
 * those tests bite (.github/mutants.json) were written first, in #48, so this move had
 * something to prove itself against.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const { listVpkPaths, mergeVpkToSingle, findContentRoot, packFolder } = require('./vpk');
const { openZip, safeJoin } = require('./safe-zip');
const { FileTx } = require('./file-tx');
const { MERGE_SIZE_CAP } = require('./installer');
const { t } = require('./i18n');

// Every .vpk under a dropped folder. Skinchanger packs unzip to a whole game tree
// (<pack>\game\Dota2SkinChanger\pak01_*.vpk), so the file we want sits a few levels in.
function scanVpkTree(root, depth = 0) {
  const out = [];
  if (depth > 6) return out;
  let names = [];
  try { names = fs.readdirSync(root); } catch { return out; }
  for (const f of names) {
    const full = path.join(root, f);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...scanVpkTree(full, depth + 1));
    else if (/\.vpk$/i.test(f)) out.push(full);
  }
  return out;
}

/**
 * Pack an author's working folder into a VPK and park it where the normal importer will
 * find it. Staged rather than installed directly, so a folder goes through exactly the
 * same path a dropped .vpk does - slot allocation, the schema a mod carries, the
 * transaction, the naming.
 * @returns {string|null} path of the staged archive, or null if the folder holds no game files
 */
function stageFolderAsVpk(dir, staged) {
  const root = findContentRoot(dir);
  if (!root) return null;
  const buf = packFolder(root);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-folder-'));
  staged.push(tmp);
  // the folder's own name becomes the mod's name, minus anything a file name cannot hold
  const base = (path.basename(dir).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'mod').slice(0, 60);
  const dest = path.join(tmp, `${base}_dir.vpk`);
  fs.writeFileSync(dest, buf);
  return dest;
}

/**
 * Turn whatever the user dropped or picked into a flat list of .vpk paths: a folder is
 * walked, a .zip is unpacked to a temp dir (keeping its layout so multi-part sets stay
 * side by side), a plain file passes through. Temp dirs are appended to `staged` for the
 * caller to delete once the import has read them.
 * @returns {{ files: string[], errors: Array<{source:string, error:string}> }}
 */
function expandImportInputs(paths, staged) {
  const files = [];
  const errors = [];
  for (const src of paths) {
    const label = path.basename(src);
    let st = null;
    try { st = fs.statSync(src); } catch { /* gone or unreadable */ }

    if (st && st.isDirectory()) {
      const found = scanVpkTree(src);
      if (found.length) { files.push(...found); continue; }
      // No archive in there, so this may be the other thing a folder can be: a mod that
      // has not been packed yet. Authors work in loose files and had nothing to point the
      // app at; now the folder is packed on the way in and imported like any other mod.
      try {
        const built = stageFolderAsVpk(src, staged);
        if (built) { files.push(built); continue; }
      } catch (err) {
        errors.push({ source: label, error: String(err.message || err) });
        continue;
      }
      errors.push({ source: label, error: t('в папке нет ни .vpk, ни файлов игры') });
      continue;
    }
    if (/\.zip$/i.test(src)) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-zip-'));
      staged.push(tmp);
      let found = 0;
      try {
        for (const file of openZip(src, { label }).files) {
          if (!/\.vpk$/i.test(file.path)) continue;
          const dest = safeJoin(tmp, file.path);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, file.read());
          files.push(dest);
          found++;
        }
      } catch (err) {
        errors.push({ source: label, error: String(err.message || err) });
        continue;
      }
      if (!found) errors.push({ source: label, error: t('в архиве нет .vpk файлов') });
      continue;
    }
    files.push(src);
  }
  return { files, errors };
}

// A VPK mod is either one self-contained "<base>_dir.vpk", or a multi-volume set:
// "<base>_dir.vpk" (index) + "<base>_000.vpk", "<base>_001.vpk"... (data). Skinchanger
// and Dota2Changer packs ship as the latter, so the volumes are grouped with their index
// and folded into a single file per mod on the way in.
/**
 * @param {object} installer the installer engine: the game folder, the slots and the writes
 * @param {string[]} paths .vpk files to take in
 * @param {(done:number,total:number)=>void} [onStep] called after each mod lands
 */
async function importVpkFiles(installer, paths, onStep) {
  const lang = installer.langFolder();
  installer.ensureLangFolder();
  const used = installer.usedPakNames();
  const results = [];

  // group selected files into sets keyed by source dir + base name
  const sets = new Map(); // key -> { srcDir, base, dirFile, sourceLabel }
  for (const src of paths) {
    const fileName = path.basename(src);
    if (!/\.vpk$/i.test(fileName)) {
      results.push({ source: fileName, error: t('не .vpk файл') });
      continue;
    }
    const srcDir = path.dirname(src);
    const mDir = fileName.match(/^(.*)_dir\.vpk$/i);
    const mPart = fileName.match(/^(.*)_\d{3}\.vpk$/i);
    const base = (mDir && mDir[1]) || (mPart && mPart[1]) || fileName.replace(/\.vpk$/i, '');
    const key = srcDir.toLowerCase() + '|' + base.toLowerCase();
    const set = sets.get(key) || { srcDir, base, dirFile: null, sourceLabel: fileName };
    if (mDir) { set.dirFile = src; set.sourceLabel = fileName; }
    else if (!mPart) { set.dirFile = src; set.single = true; set.sourceLabel = fileName; }
    // bare data parts (_NNN) need no explicit entry: discovered from disk below
    sets.set(key, set);
  }

  // One set is one mod, so each gets its own transaction: a multi-volume import that dies
  // on its third file rolls that mod back and the rest of the batch carries on.
  //
  // A whole pack of these used to run without ever giving the event loop a turn, and the
  // main process is what pumps the window's messages - so Windows put "not responding"
  // on the title bar for the several minutes a Skinchanger pack takes, and the app looked
  // dead while it was working. Each mod now hands the loop back before the next one.
  let done = 0;
  const total = sets.size;
  for (const set of sets.values()) {
    try {
      FileTx.run((tx) => {
        // self-contained non-_dir vpk: copy as a fresh dir slot
        if (set.single) {
          const pakName = installer.allocatePak(used, false);
          installer.copyInto(set.dirFile, path.join(lang, pakName), tx);
          results.push({ source: set.sourceLabel, name: set.base, files: [{ root: 'lang', relPath: pakName }] });
          return;
        }
        // find the _dir.vpk (selected, or sitting next to selected data parts)
        let dirSrc = set.dirFile;
        if (!dirSrc) {
          const guess = path.join(set.srcDir, `${set.base}_dir.vpk`);
          if (fs.existsSync(guess)) dirSrc = guess;
        }
        if (!dirSrc) {
          results.push({ source: set.sourceLabel, error: t('нет {0}_dir.vpk рядом с data-частями', set.base) });
          return;
        }
        const pakDir = installer.allocatePak(used, false);     // pakXX_dir.vpk
        const newBase = pakDir.replace(/_dir\.vpk$/i, '');     // pakXX
        // sibling data archives <base>_NNN.vpk that belong to this index
        const partRe = new RegExp(`^${set.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d{3})\\.vpk$`, 'i');
        const partFiles = fs.readdirSync(set.srcDir)
          .map((f) => ({ f, m: f.match(partRe) }))
          .filter((x) => x.m)
          .sort((x, y) => x.m[1].localeCompare(y.m[1]));

        // Multi-volume set (a Skinchanger pack is pak01_dir.vpk + pak01_000.vpk): fold the
        // index and its volumes into ONE self-contained pakXX_dir.vpk. One file per mod is
        // what the rest of the app assumes — enable/disable, export, packing and the folder
        // sync all key off a single name, and a stray half-set left in the folder is exactly
        // how a mod ends up half-loaded. Byte-for-byte copy stays the fallback.
        const partsBytes = partFiles.reduce((s, x) => s + fs.statSync(path.join(set.srcDir, x.f)).size, 0);
        if (partFiles.length && partsBytes <= MERGE_SIZE_CAP) {
          let merged = false;
          try {
            const archiveFor = (idx) => path.join(set.srcDir, `${set.base}_${String(idx).padStart(3, '0')}.vpk`);
            installer.writeInto(mergeVpkToSingle(dirSrc, archiveFor), path.join(lang, pakDir), tx);
            merged = true;
          } catch { /* unreadable index or missing volume — copy the set as it is */ }
          if (merged) {
            results.push({
              source: `${set.base}_dir.vpk`, name: set.base, merged: partFiles.length + 1,
              files: [{ root: 'lang', relPath: pakDir }],
            });
            return;
          }
        }

        installer.copyInto(dirSrc, path.join(lang, pakDir), tx);
        const files = [{ root: 'lang', relPath: pakDir }];
        for (const { f, m } of partFiles) {
          const partName = `${newBase}_${m[1]}.vpk`;
          installer.copyInto(path.join(set.srcDir, f), path.join(lang, partName), tx);
          files.push({ root: 'lang', relPath: partName });
        }
        results.push({ source: `${set.base}_dir.vpk`, name: set.base, files });
      }, installer.log);
    } catch (err) {
      results.push({ source: set.sourceLabel, error: String(err.message || err) });
    }
    done++;
    if (onStep) onStep(done, total);
    await new Promise((r) => setImmediate(r));
  }
  return results;
}

// Import whatever the user pointed at: .vpk files, a .zip, or a folder to walk.
// Returns one result per mod: { source, name, files[], merged? } or { source, error }.
async function importVpks(installer, paths, onStep) {
  const staged = [];
  try {
    const { files, errors } = expandImportInputs(paths || [], staged);
    return [...errors, ...await importVpkFiles(installer, files, onStep)];
  } finally {
    for (const dir of staged) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } }
  }
}

// Import dropped .vpk/.zip files given as raw bytes (used when the drop can't resolve a
// real on-disk path). Bytes are staged in a temp folder so the normal path-based importer
// handles grouping of multi-part sets, then the temp folder is removed.
async function importVpkBuffers(installer, items, onStep) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-import-'));
  try {
    const paths = [];
    for (const it of items || []) {
      if (!it || !/\.(vpk|zip)$/i.test(it.name || '')) continue;
      const p = path.join(tmp, path.basename(it.name));
      fs.writeFileSync(p, Buffer.from(it.data));
      paths.push(p);
    }
    return await importVpks(installer, paths, onStep);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

// Install a VPK handed over as bytes (a mod embedded in a shared preset). The index is
// parsed first: whatever a stranger put in that archive, only something that really is a
// VPK ever reaches the game folder, and the slot name is ours, never theirs.
function installVpkBuffer(installer, buf) {
  if (!listVpkPaths(buf).length) throw new Error(t('Пустой VPK'));
  const lang = installer.langFolder();
  installer.ensureLangFolder();
  const pakName = installer.allocatePak(installer.usedPakNames(), false);
  installer.writeInto(buf, path.join(lang, pakName));
  return [{ root: 'lang', relPath: pakName }];
}

module.exports = {
  importVpks, importVpkFiles, importVpkBuffers, installVpkBuffer,
  expandImportInputs, scanVpkTree, stageFolderAsVpk,
};
