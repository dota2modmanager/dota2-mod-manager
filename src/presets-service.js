/* Presets, and the two ways one travels to somebody else.
 *
 * A preset is a named set of "these mods on, everything else off". Sharing is what makes this
 * more than a list: a preset that only names catalog mods is a few hundred bytes and installs
 * from the catalog on the other end, while one that has to carry a mod's own bytes can run to
 * hundreds of megabytes. Which of the two a given preset is depends on where its mods came
 * from, so everything here is built around answering that before anything is written.
 *
 * Lifted out of main.js unchanged. It was 268 lines in the middle of the file that starts the
 * window, reachable only through the process that owns that window, and testable only by
 * launching the app. The bodies below are the same bodies; what changed is that the services
 * they use arrive as arguments instead of as variables that happen to be in scope.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const { Library } = require('./library.ts');
const { readPresetFile } = require('./preset-share.ts');
const { decodePresetLink } = require('./preset-link.ts');
const { t } = require('./i18n.ts');

// The mods of one catalog category. Most categories are a flat array, but some (creeps,
// towers, hero-items, item-effects, creep-deny) group theirs under `groups` - the same two
// shapes the catalog view walks (see categoryMods in renderer/app.js). Reading only the
// flat ones meant every mod in a grouped category looked like it was not in the catalog:
// the share dialog called them the user's own and packed them into the file as bytes, and
// a preset link dropped them entirely.
function categoryModList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.groups)) return data.groups.flatMap((g) => g.mods || []);
  return [];
}

/** Can this record go into a pack? Packs, fonts and cursors cannot; a lang-folder VPK can. */
function packableRecord(rec) {
  return rec && rec.kind !== 'pack'
    && rec.categoryId !== 'fonts' && rec.categoryId !== 'cursors'
    && (rec.files || []).some((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
}

/** Does changing this record mean the item table has to be rebuilt? */
function touchesSchema(rec) {
  return rec.categoryId === 'cosmetic' || (Array.isArray(rec.schema) && rec.schema.length > 0);
}

/**
 * Everything about presets that needs the running app's services.
 *
 * @param {object} deps
 * @param {object} deps.catalog        the catalog store, for turning a mod into an identity
 * @param {object} deps.installer      reads and writes what is in the game folder
 * @param {object} deps.library        the manifest of installed mods and saved presets
 * @param {object} deps.schemaService  rebuilds the item table when a preset changes it
 * @param {(pack: object) => Array} deps.deployAndApply  rebuilds one pack's VPK
 */
function presetsService({ catalog, installer, library, schemaService, deployAndApply }) {

  // where an imported .d2mm waits until the user installs it
  function sharedPresetFile(presetId) {
    return path.join(app.getPath('userData'), 'shared-presets', `${presetId}.d2mm`);
  }

  function dropSharedPresetFile(preset) {
    const f = preset && preset.source && preset.source.file;
    if (f) { try { fs.rmSync(f, { force: true }); } catch { /* noop */ } }
  }


  /* "<categoryId>|<name>|<styleLabel>" -> what mods:install needs to fetch it.
   *
   * lookup() goes on the map before anything can fail. It used to be attached at the end, so the
   * early return for a catalog that could not be loaded (offline, nothing cached) handed back a
   * map without it, and every caller asking cat.lookup() threw: a first start without a network
   * could not list, share or apply a preset. Empty now means "nothing in the catalog", which is
   * the truth, and a preset's own embedded mods still travel. */
  /** @returns {Promise<Map<string, object> & { lookup: (c: string, n: string, s?: string|null) => object|null }>} */
  async function catalogIndex() {
    const key = (c, n, s) => `${c}|${n}|${s || ''}`;
    const map = Object.assign(new Map(), {
      lookup: (c, n, s) => map.get(key(c, n, s)) || null,
    });
    let data;
    try { data = await catalog.load(); } catch { return map; } // offline with no cache
    for (const [categoryId, list] of Object.entries((data.mods && data.mods.modsData) || {})) {
      for (const m of categoryModList(list)) {
        if (!m || !m.name) continue;
        if (Array.isArray(m.styles)) {
          for (const s of m.styles) {
            map.set(key(categoryId, m.name, s.label), { categoryId, name: m.name, styleLabel: s.label, fileRef: s.file, preview: s.preview });
          }
        } else {
          map.set(key(categoryId, m.name, null), { categoryId, name: m.name, styleLabel: null, fileRef: m.file, preview: m.preview });
        }
      }
    }
    return map;
  }

  // How one library record travels: as a catalog identity when the catalog can hand it to
  // the receiver, otherwise as its own bytes. `loadData` is deferred so building the plan
  // (which only needs sizes) doesn't merge tens of MB per mod.
  function shareEntryFor(rec, cat) {
    const hit = rec.categoryId !== 'imported' && cat.lookup(rec.categoryId, rec.name, rec.styleLabel);
    if (hit) {
      return {
        kind: 'catalog', categoryId: rec.categoryId, name: rec.name,
        styleLabel: rec.styleLabel || null, fp: (installer.analyzeRecord(rec) || {}).fp || null, size: 0,
      };
    }
    const hasVpk = (rec.files || []).some((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
    if (!hasVpk) {
      return { kind: 'missing', name: rec.name, reason: t('нет в каталоге и нечего вложить') };
    }
    let size = 0;
    try {
      const lang = installer.langFolder();
      for (const f of (rec.files || []).filter((x) => x.root === 'lang')) {
        const p = ['', '.off', '.moff'].map((s) => path.join(lang, f.relPath) + s).find((x) => fs.existsSync(x));
        if (p) size += fs.statSync(p).size;
      }
    } catch { /* size stays an estimate of 0 */ }
    const a = installer.analyzeRecord(rec) || {};
    return {
      kind: 'embedded', name: rec.name, categoryId: rec.categoryId, info: a.info || '', fp: a.fp || null,
      size, loadData: () => installer.mergeToSingleVpk(rec, rec.schema),
    };
  }

  // A pack travels as its members: each one keeps its own identity, and the receiver's app
  // rebuilds the pack from them. Member VPKs are already sitting flattened in packsDir.
  function packShareEntry(rec, cat) {
    const members = (rec.members || []).map((m) => {
      const hit = m.categoryId !== 'imported' && cat.lookup(m.categoryId, m.name, m.styleLabel);
      if (hit) {
        return { kind: 'catalog', categoryId: m.categoryId, name: m.name, styleLabel: m.styleLabel || null, fp: m.fp || null, size: 0 };
      }
      const src = installer.packMemberFile(rec.id, m.id);
      if (!fs.existsSync(src)) return { kind: 'missing', name: m.name, reason: t('файл участника пака не найден') };
      return {
        kind: 'embedded', name: m.name, categoryId: m.categoryId, info: m.info || '', fp: m.fp || null,
        size: fs.statSync(src).size, loadData: () => fs.readFileSync(src),
      };
    });
    return { kind: 'pack', name: rec.name, members };
  }

  // Every mod of a preset, described the way it would be shared.
  async function presetShareEntries(preset) {
    const cat = await catalogIndex();
    const out = [];
    for (const id of library.presetModIds(preset)) {
      const rec = library.find(id);
      if (!rec) continue;
      out.push(rec.kind === 'pack' ? packShareEntry(rec, cat) : shareEntryFor(rec, cat));
    }
    return out;
  }

  // strips the deferred loaders so the plan can cross the IPC boundary; `key` is what the
  // renderer sends back to leave an oversized mod out of the file
  function planShape(entries) {
    const plain = (e, key) => ({
      key, kind: e.kind, name: e.name, size: e.size || 0, info: e.info || '', reason: e.reason || '',
      ...(e.kind === 'cosmetic' ? { slot: e.slot } : {}),
    });
    return entries.map((e, i) => (e.kind === 'pack'
      ? { ...plain(e, String(i)), members: e.members.map((m, j) => plain(m, `${i}.${j}`)) }
      : plain(e, String(i))));
  }

  // fingerprint -> installed record id, so a shared mod already on disk isn't written twice
  function installedFpIndex() {
    const map = new Map();
    for (const rec of library.list()) {
      if (rec.kind === 'pack') continue;
      const a = installer.analyzeRecord(rec);
      if (a && a.fp) map.set(a.fp, rec.id);
    }
    return map;
  }

  // The mods of a preset flattened for a link, plus the names of the ones that cannot ride
  // along. A link carries identities only, so a mod the receiver has no way to fetch — a
  // user's own import — has to be left out; the rest of the build still travels, and the
  // sender is told exactly what was dropped. Refusing to make a link at all over one import
  // is what made "share by link" look broken in a library that is mostly imports.
  //
  // A pack flattens to its members: packing is a local storage choice, not part of the build.
  // A cosmetic pick travels too — slot + item id is a few bytes, and needs no catalog lookup
  // at all (both players' games carry the same Valve schema).
  function presetLinkMods(preset, cat) {
    const mods = [];
    const skipped = [];
    for (const id of library.presetModIds(preset)) {
      const rec = library.find(id);
      if (!rec) continue;
      for (const it of (rec.kind === 'pack' ? rec.members || [] : [rec])) {
        if (it.categoryId === 'imported' || !cat.lookup(it.categoryId, it.name, it.styleLabel)) {
          skipped.push(it.name);
          continue;
        }
        mods.push({ kind: 'catalog', categoryId: it.categoryId, name: it.name, styleLabel: it.styleLabel || null });
      }
    }
    return { mods, skipped };
  }

  // What installing a received preset would actually do, for the card in the Presets tab.
  async function sharedPresetStatus(preset, cat) {
    const fpIndex = installedFpIndex();
    const out = { installed: 0, download: 0, embedded: 0, free: 0, unavailable: [] };
    const visit = (e) => {
      if (e.kind === 'catalog') {
        if (library.findByKey(e.categoryId, e.name, e.styleLabel)) out.installed++;
        else if (cat.lookup(e.categoryId, e.name, e.styleLabel)) out.download++;
        else out.unavailable.push(e.name);
      } else if (e.kind === 'embedded') {
        if (e.fp && fpIndex.has(e.fp)) out.installed++;
        else out.embedded++;
      } else if (e.kind === 'cosmetic') {
        // free either way — nothing to fetch, just an instant pick from the local game schema
        const have = library.list().find((r) => r.categoryId === 'cosmetic'
          && r.slot === e.slot && r.itemId === e.itemId && String(r.effectId || '') === String(e.effectId || ''));
        if (have && have.enabled !== false) out.installed++;
        else out.free++;
      } else {
        out.unavailable.push(e.name);
      }
    };
    for (const e of preset.wanted || []) {
      if (e.kind === 'pack') e.members.forEach(visit);
      else visit(e);
    }
    return out;
  }

  // Build a fresh pack out of standalone records (the subset of packs:combine a received
  // preset needs — it never absorbs packs the user already has).
  function packFromRecords(name, recIds) {
    const recs = recIds.map((id) => library.find(id)).filter(packableRecord);
    if (recs.length < 2) return null; // nothing to save by packing — leave them standalone
    const target = library.add({
      name, categoryId: 'combined', styleLabel: null, fileRef: null, preview: null,
      files: [], kind: 'pack', members: [],
    });
    fs.mkdirSync(installer.packFolder(target.id), { recursive: true });
    for (const r of recs) {
      target.members.push(installer.addPackMemberFromRecord(target.id, r, crypto.randomUUID()));
      try { installer.remove(r.files); } catch { /* noop */ }
      library.removeRecord(r.id);
    }
    deployAndApply(target);
    return target;
  }

  // Validate a received .d2mm and park it in the Presets tab as a not-yet-installed preset.
  // Nothing is written into the game folder here — the user sees the contents first.
  function importPresetFile(filePath) {
    try {
      const { manifest } = readPresetFile(filePath);
      if (!manifest.mods.length) return { error: t('В пресете нет модов') };
      const preset = library.addSharedPreset({
        name: manifest.name, note: manifest.note, author: manifest.author, wanted: manifest.mods,
      });
      // the archive has to survive until "Install": its embedded VPKs live nowhere else
      const embeds = (e) => e.kind === 'embedded' || (e.kind === 'pack' && e.members.some((m) => m.kind === 'embedded'));
      if (manifest.mods.some(embeds)) {
        const dest = sharedPresetFile(preset.id);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(filePath, dest);
        preset.source.file = dest;
        library.save();
      }
      return { ok: true, preset };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  }

  // A pasted d2mm://preset/... link. Same landing as a file: it parks in the Presets tab as
  // a wish list and installs nothing until asked. No stash — a link has no payload to keep.
  function importPresetLink(text) {
    try {
      const decoded = decodePresetLink(text);
      if (!decoded.mods.length) return { error: t('В пресете нет модов') };
      const preset = library.addSharedPreset({
        name: decoded.name, note: '', author: decoded.author, wanted: decoded.mods,
      });
      return { ok: true, preset };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  }

  // enable exactly the preset's mods, disable everything else
  function applyPreset(preset) {
    const wanted = new Set(library.presetModIds(preset));
    const errors = [];
    // Free cosmetics are not part of a build (see Library.inPreset): a preset that does not
    // name somebody's courier is not asking for it to be taken off.
    const recs = library.list().filter((r) => Library.inPreset(r));
    let schemaTouched = false;
    // off first, then on: two cursor sets cannot be live at once, so the outgoing one has to
    // put the vanilla files back before the incoming one writes over them
    for (const pass of [false, true]) {
      for (const rec of recs) {
        const shouldEnable = wanted.has(rec.id);
        if (shouldEnable !== pass || rec.enabled === shouldEnable) continue;
        try {
          installer.setEnabled(rec.files, shouldEnable, rec.id);
          library.setEnabled(rec.id, shouldEnable);
          if (touchesSchema(rec)) schemaTouched = true;
        } catch (err) {
          errors.push(`${rec.name}: ${err.message}`);
        }
      }
    }
    if (schemaTouched) schemaService.refresh();
    return errors;
  }

  return {
    sharedPresetFile,
    dropSharedPresetFile,
    catalogIndex,
    shareEntryFor,
    packShareEntry,
    presetShareEntries,
    installedFpIndex,
    presetLinkMods,
    sharedPresetStatus,
    packFromRecords,
    importPresetFile,
    importPresetLink,
    applyPreset,
    planShape,
  };
}

module.exports = { presetsService, categoryModList, packableRecord, touchesSchema };
