// Combined packs: several mods in one pak slot, each kept as its own file in userData and rebuilt
// into the slot from the ones that are on. Behind src/installer.ts.
import fs from 'node:fs';
import path from 'node:path';
import { listVpkPaths, analyzeVpkPaths, describeAnalysis, fingerprintVpk, combineVpksToFiles } from './vpk.ts';
import type { Installer } from './installer.ts';
import type { LibFile, LibRecord, PackMember, HasFiles } from './types.ts';

/** Where a pack keeps its members' own files. */
export function packFolder(inst: Installer, packId: string): string { return path.join(inst.packsDir, packId); }

/** One member's own file. */
export function packMemberFile(inst: Installer, packId: string, memberId: string): string { return path.join(inst.packFolder(packId), `${memberId}.vpk`); }

// Flatten a library record into one self-contained VPK and store it as a pack member.
// Returns the member descriptor (identity + a content summary for the UI) to record in
// the pack manifest. The record's own deployed files are left for the caller to remove.
export function addPackMemberFromRecord(inst: Installer, packId: string, rec: LibRecord, memberId: string): PackMember {
  const buf = inst.mergeToSingleVpk(rec);
  fs.mkdirSync(inst.packFolder(packId), { recursive: true });
  fs.writeFileSync(inst.packMemberFile(packId, memberId), buf);
  let heroes = 0, info = '', fp: string | null = null;
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
export function removePackDeployed(inst: Installer, pack: HasFiles): void {
  const lang = inst.langFolder();
  if (!fs.existsSync(lang)) return;
  const base = inst.packBase(pack);
  if (!base) return;
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_dir|_\\d{3})\\.vpk(\\.off|\\.moff)?$`, 'i');
  for (const f of fs.readdirSync(lang)) if (re.test(f)) fs.rmSync(path.join(lang, f), { force: true });
}

// The pak slot base ("pak10") a pack deploys to — reused across rebuilds so the slot
// stays stable. Taken from the pack's recorded files, else null (allocate on deploy).
export function packBase(inst: Installer, pack: HasFiles): string | null {
  const dir = (pack.files || []).find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
  return dir ? dir.relPath.replace(/_dir\.vpk$/i, '') : null;
}

// (Re)build a pack's single deployed VPK from its enabled members. Removes the old
// deployment first, then combines enabled member sources into the pack's slot. Returns
// { files, conflicts } — caller stores files on the record and re-applies enabled/master
// state. With no enabled members nothing is written (files: []).
export function deployPack(inst: Installer, pack: Pick<LibRecord, 'id' | 'files' | 'members'>): { files: LibFile[]; conflicts: { key: string; path: string }[] } {
  const lang = inst.langFolder();
  inst.ensureLangFolder();
  inst.removePackDeployed(pack);
  const enabled = (pack.members || []).filter((m) => m.enabled);
  if (!enabled.length) return { files: [], conflicts: [] };
  let base = inst.packBase(pack);
  if (!base) base = inst.allocatePak(inst.usedPakNames(), false).replace(/_dir\.vpk$/i, '');
  const members = enabled.map((m) => ({ key: m.id, buf: fs.readFileSync(inst.packMemberFile(pack.id, m.id)) }));
  const { dir, parts, conflicts } = combineVpksToFiles(members, lang, base);
  const files = [{ root: 'lang', relPath: dir }, ...parts.map((p) => ({ root: 'lang', relPath: p }))];
  return { files, conflicts };
}

// Fully delete a pack: its deployed VPK and every stored member source.
export function removePackFully(inst: Installer, pack: Pick<LibRecord, 'id' | 'files'>): void {
  inst.removePackDeployed(pack);
  try { fs.rmSync(inst.packFolder(pack.id), { recursive: true, force: true }); } catch { /* noop */ }
}

// Turn a stored pack member back into a standalone deployed mod in a fresh pak slot.
// Returns { files } for a new library record; caller deletes the member from the pack.
export function deployMemberAsMod(inst: Installer, pack: Pick<LibRecord, 'id'>, member: Pick<PackMember, 'id'>): { files: LibFile[] } {
  const lang = inst.langFolder();
  inst.ensureLangFolder();
  const buf = fs.readFileSync(inst.packMemberFile(pack.id, member.id));
  const pakName = inst.allocatePak(inst.usedPakNames(), false);
  inst.writeInto(buf, path.join(lang, pakName));
  return { files: [{ root: 'lang', relPath: pakName }] };
}
