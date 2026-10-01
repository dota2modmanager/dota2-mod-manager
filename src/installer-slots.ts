// The load order: which pak slot a mod sits in, moving and swapping slots, and which mods are
// covered by which. Behind src/installer.ts.
//
// The game mounts pakNN_dir.vpk in numeric order and the FIRST copy of a file wins, so a
// mod's pak number is its priority: a smaller number sits on top. That is what makes
// "put these arms over that hero set" a real thing rather than a conflict - both mods
// load, and the one on top supplies the files they share.
import fs from 'node:fs';
import path from 'node:path';
import { listVpkPathCrcs, readVpkIndexFile } from './vpk.ts';
import { RESERVED_PAKS } from './minify.ts';
import * as zones from './slot-zones.ts';
import { t } from './i18n.ts';
import { MASTER_OFF, isOfficialLangFile } from './installer-files.ts';
import { FileTx, type Writer } from './file-tx.ts';
import type { Installer } from './installer.ts';
import type { Library } from './library.ts';
import type { LibFile, LibRecord, HasFiles } from './types.ts';

/** A switched-on mod as coverage reads it: keyed, because two copies of one mod share a name. */
export type CoverageMod = { key: string; name: string; files: LibFile[] };

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

/** Every slot name the folder holds, whatever state its file is in. */
export function usedPakNames(inst: Installer): Set<string> {
  const lang = inst.langFolder();
  const used = new Set<string>();
  if (fs.existsSync(lang)) {
    for (const f of fs.readdirSync(lang)) {
      // disabled (.off) and master-off (.moff) files still occupy their base slot
      used.add(f.toLowerCase().replace(/\.moff$/, '').replace(/\.off$/, ''));
    }
  }
  return used;
}

/** The next free slot for a mod, in the part of the order it belongs in; taken from `used`. */
export function allocatePak(inst: Installer, used: Set<string>, priority: boolean): string {
  // A priority mod past the 28 slots of its own still goes in, in the first free slot after
  // them: ahead of nothing, but installed. The rest never take a priority slot.
  const name = (priority && zones.freeSlotIn('priority', used)) || zones.freeSlotIn('normal', used);
  if (!name) throw new Error(t('Свободных слотов pakNN не осталось (30-99 заняты)'));
  used.add(name);
  return name;
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
export function planPakNames(inst: Installer, relPaths: string[], used: Set<string>, priority: boolean): Map<string, string> {
  const groups = new Map<string, { rel: string; part: string | null }[]>(); // "<folder>|<base>" -> [{ rel, part }]
  for (const rel of relPaths) {
    const name = rel.split('/').pop() ?? '';
    const folder = rel.slice(0, rel.length - name.length).toLowerCase();
    const mDir = name.match(/^(.*)_dir\.vpk$/i);
    const mPart = name.match(/^(.*)_(\d{3})\.vpk$/i);
    const base = (mDir && mDir[1]) || (mPart && mPart[1]) || name.replace(/\.vpk$/i, '');
    const key = `${folder}|${base.toLowerCase()}`;
    const group = groups.get(key) || [];
    group.push({ rel, part: mDir ? null : (mPart && mPart[2]) || null });
    groups.set(key, group);
  }
  const plan = new Map<string, string>();
  for (const items of groups.values()) {
    const slot = inst.allocatePak(used, priority).replace(/_dir\.vpk$/i, '');
    for (const it of items) plan.set(it.rel, it.part ? `${slot}_${it.part}.vpk` : `${slot}_dir.vpk`);
  }
  return plan;
}

// The slot a record occupies ("pak07"), or null for mods that live outside a numbered
// pak (terrain maps, fonts, cursors).
export function slotBase(inst: Installer, rec: HasFiles): string | null {
  const dir = (rec.files || []).find((f) => f.root === 'lang' && /^pak\d+_dir\.vpk$/i.test(f.relPath));
  return dir ? dir.relPath.replace(/_dir\.vpk$/i, '').toLowerCase() : null;
}

/** A record's slot as a number, or null for a mod that lives outside a numbered pak. */
export function slotNumber(inst: Installer, rec: HasFiles): number | null {
  const base = inst.slotBase(rec);
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
export function coverage(inst: Installer, mods: CoverageMod[]): Map<string, { name: string; files: number }[]> {
  const owners = new Map<string, { key: string; name: string; slot: number; crc: number }[]>(); // inner path -> [{ key, name, slot, crc }]
  for (const mod of mods) {
    const dir = (mod.files || []).find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
    if (!dir) continue;
    const slot = inst.slotNumber(mod);
    if (slot === null) continue;
    let crcs: Map<string, number>;
    try { crcs = listVpkPathCrcs(readVpkIndexFile(inst.langFileOnDisk(dir.relPath))); } catch { continue; }
    for (const [p, crc] of crcs) {
      if (STOCK_ASSET.test(p)) continue;
      const list = owners.get(p) || [];
      list.push({ key: mod.key, name: mod.name, slot, crc });
      owners.set(p, list);
    }
  }

  const covered = new Map<string, Map<string, number>>(); // loser key -> Map(winner name -> file count)
  for (const [, list] of owners) {
    if (list.length < 2) continue;
    const top = list.reduce((a, b) => (b.slot < a.slot ? b : a));
    for (const other of list) {
      // same bytes is not a fight: whichever the game picks, the file is identical
      if (other.key === top.key || other.crc === top.crc) continue;
      const by = covered.get(other.key) || new Map<string, number>();
      covered.set(other.key, by);
      by.set(top.name, (by.get(top.name) || 0) + 1);
    }
  }

  const out = new Map<string, { name: string; files: number }[]>();
  for (const [loser, by] of covered) {
    out.set(loser, [...by].map(([name, files]) => ({ name, files })).sort((a, b) => b.files - a.files));
  }
  return out;
}

// highest free slot strictly below `n`, so climbing over one mod does not eat the whole
// low range that the priority categories want
/** The highest free slot strictly below `n`, as "pakNN". */
export function freeSlotBelow(inst: Installer, n: number, used: Set<string>): string | null {
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
 *
 * All of a mod's files move, or none do. A pak and its volumes only load under one name, and a
 * running game can refuse the rename of any one of them: until 2026-10-01 these renames were made
 * one by one outside a transaction, and a refusal on the second file left a mod the game could not
 * load and the library could not find. They go through a FileTx now, the caller's when it hands
 * one in so a move of several mods undoes as one, otherwise one of their own.
 * @returns {Array<object>} the record's new files array (caller stores it)
 */
export function moveToSlot(inst: Installer, rec: HasFiles, newBase: string, oldBase: string | null = inst.slotBase(rec), tx: Writer = null): LibFile[] {
  const lang = inst.langFolder();
  if (!oldBase) throw new Error(t('У мода нет слота pakNN'));
  const mine = new RegExp(`^${oldBase}(_dir|_\\d{3})\\.vpk$`, 'i');
  const move = (into: FileTx) => (rec.files || []).map((f) => {
    if (f.root !== 'lang' || !mine.test(f.relPath)) return f;
    const next = newBase + f.relPath.slice(oldBase.length);
    for (const suf of ['', '.off', MASTER_OFF]) {
      const from = path.join(lang, f.relPath + suf);
      if (fs.existsSync(from)) into.move(from, path.join(lang, next + suf));
    }
    return { ...f, relPath: next };
  });
  return tx ? move(tx) : FileTx.run(move);
}

/**
 * Trade two records' slots, which is how a mod moves up or down the load order.
 * pak00 is the parking spot for the swap - the game never mounts it, so a crash
 * mid-swap leaves a file that is merely inactive, not one fighting for a name in use.
 * @returns {Array<{ id: string, files: Array<object> }>} records to save
 */
export function swapSlots(inst: Installer, a: LibRecord, b: LibRecord): { id: string; files: LibFile[] }[] {
  const aBase = inst.slotBase(a);
  const bBase = inst.slotBase(b);
  if (!aBase || !bBase) throw new Error(t('У мода нет слота pakNN'));
  /* The three moves are one transaction, undone in the reverse order they were made. Until
     2026-10-01 each was its own, and a refusal on the last step put a back into its slot while b
     still sat there; on Windows a rename replaces the file it lands on, and b was gone. */
  return FileTx.run((tx) => {
    const parked = inst.moveToSlot(a, 'pak00', aBase, tx);
    const movedB = inst.moveToSlot(b, aBase, bBase, tx);
    const movedA = inst.moveToSlot({ ...a, files: parked }, bBase, 'pak00', tx);
    return [{ id: a.id, files: movedA }, { id: b.id, files: movedB }];
  });
}

// Number of occupied pak slots (mod paks only, excluding the game's own pak01_*), used
// to warn/suggest combining when the library approaches the 99-slot ceiling.
export function usedModSlots(inst: Installer): number {
  const lang = inst.langFolder();
  if (!fs.existsSync(lang)) return 0;
  const bases = new Set<string>();
  for (const f of fs.readdirSync(lang)) {
    const m = f.toLowerCase().replace(/\.moff$/, '').replace(/\.off$/, '').match(/^(pak\d+)_dir\.vpk$/);
    if (m && !isOfficialLangFile(`${m[1]}_dir.vpk`)) bases.add(m[1]);
  }
  return bases.size;
}

// Older app versions wrote priority mods as "!pakNN_dir.vpk" — a name the game
// never mounts, so those mods silently did nothing. Rename them to real low
// pak slots and fix the matching manifest records.
export function migrateLegacyPriorityPaks(inst: Installer, library: Pick<Library, 'list' | 'save'>): void {
  const lang = inst.langFolder();
  if (!fs.existsSync(lang)) return;
  const legacy = fs.readdirSync(lang).filter((f) => /^!pak\d+_dir\.vpk(\.off)?$/i.test(f));
  if (!legacy.length) return;
  const used = inst.usedPakNames();
  let changed = false;
  for (const f of legacy) {
    const disabled = /\.off$/i.test(f);
    const oldBase = f.replace(/\.off$/i, '');
    const newBase = inst.allocatePak(used, true);
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
