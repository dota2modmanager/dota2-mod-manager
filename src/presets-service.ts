/* Presets, and the two ways one travels to somebody else.
 *
 * A preset is a named set of "these mods on, everything else off". Sharing is what makes this
 * more than a list: a preset that only names catalog mods is a few hundred bytes and installs
 * from the catalog on the other end, while one that has to carry a mod's own bytes can run to
 * hundreds of megabytes. Which of the two a given preset is depends on where its mods came
 * from, so everything here is built around answering that before anything is written.
 *
 * How a preset travels (the share plan, the link, what a received one would do) is
 * src/preset-plan.ts; this file applies, packs and receives them.
 *
 * Lifted out of main.js unchanged. It was 268 lines in the middle of the file that starts the
 * window, reachable only through the process that owns that window, and testable only by
 * launching the app. The bodies below are the same bodies; what changed is that the services
 * they use arrive as arguments instead of as variables that happen to be in scope.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { Library } from './library.ts';
import { readPresetFile } from './preset-share.ts';
import { decodePresetLink } from './preset-link.ts';
import { t } from './i18n.ts';
import { electron } from './electron.ts';
import type { Catalog } from './catalog.ts';
import { createPresetPlan } from './preset-plan.ts';
import type { LibFile, LibRecord, PackMember, Preset, PresetEntry } from './types.ts';

/** What of the installer presets ask: what a record is, where its files are, and packing. */
export interface PresetInstaller {
  analyzeRecord(rec: LibRecord): { fp?: string | null; info?: string } | null;
  langFolder(): string;
  mergeToSingleVpk(rec: LibRecord, deltas: unknown): Buffer;
  packMemberFile(packId: string, memberId: string): string;
  packFolder(packId: string): string;
  addPackMemberFromRecord(packId: string, rec: LibRecord, memberId: string): PackMember;
  remove(files: LibFile[]): unknown;
  setEnabled(files: LibFile[], on: boolean, recId: string): unknown;
}

/** Can this record go into a pack? Packs, fonts and cursors cannot; a lang-folder VPK can. */
export function packableRecord(rec: LibRecord | null | undefined): rec is LibRecord {
  return !!rec && rec.kind !== 'pack'
    && rec.categoryId !== 'fonts' && rec.categoryId !== 'cursors'
    && (rec.files || []).some((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
}

/** Does changing this record mean the item table has to be rebuilt? */
export function touchesSchema(rec: LibRecord): boolean {
  return rec.categoryId === 'cosmetic' || (Array.isArray(rec.schema) && rec.schema.length > 0);
}

/**
 * Everything about presets that needs the running app's services.
 *
 * @param deps.catalog        the catalog store, for turning a mod into an identity
 * @param deps.installer      reads and writes what is in the game folder
 * @param deps.library        the manifest of installed mods and saved presets
 * @param deps.schemaService  rebuilds the item table when a preset changes it
 * @param deps.deployAndApply  rebuilds one pack's VPK
 */
export function presetsService({ catalog, installer, library, schemaService, deployAndApply }: {
  catalog: Pick<Catalog, 'load'>; installer: PresetInstaller; library: Library;
  schemaService: { refresh(): unknown }; deployAndApply: (pack: LibRecord) => unknown;
}) {
  const plan = createPresetPlan({ catalog, installer, library });

  // where an imported .d2mm waits until the user installs it
  function sharedPresetFile(presetId: string): string {
    return path.join(electron().app.getPath('userData'), 'shared-presets', `${presetId}.d2mm`);
  }

  function dropSharedPresetFile(preset: Preset | null | undefined): void {
    const f = preset && preset.source && preset.source.file;
    if (f) { try { fs.rmSync(f, { force: true }); } catch { /* noop */ } }
  }

  // Build a fresh pack out of standalone records (the subset of packs:combine a received
  // preset needs — it never absorbs packs the user already has).
  function packFromRecords(name: string, recIds: string[]): LibRecord | null {
    const recs = recIds.map((id) => library.find(id)).filter(packableRecord);
    if (recs.length < 2) return null; // nothing to save by packing — leave them standalone
    const target = library.add({
      name, categoryId: 'combined', styleLabel: null, fileRef: null, preview: null,
      files: [], kind: 'pack', members: [],
    });
    fs.mkdirSync(installer.packFolder(target.id), { recursive: true });
    for (const r of recs) {
      (target.members ??= []).push(installer.addPackMemberFromRecord(target.id, r, crypto.randomUUID()));
      try { installer.remove(r.files); } catch { /* noop */ }
      library.removeRecord(r.id);
    }
    deployAndApply(target);
    return target;
  }

  // Validate a received .d2mm and park it in the Presets tab as a not-yet-installed preset.
  // Nothing is written into the game folder here — the user sees the contents first.
  function importPresetFile(filePath: string): { ok: true; preset: Preset } | { error: string } {
    try {
      const { manifest } = readPresetFile(filePath);
      if (!manifest.mods.length) return { error: t('В пресете нет модов') };
      const preset = library.addSharedPreset({
        name: manifest.name, note: manifest.note, author: manifest.author, wanted: manifest.mods,
      });
      // the archive has to survive until "Install": its embedded VPKs live nowhere else
      const embeds = (e: PresetEntry): boolean => e.kind === 'embedded' || (e.kind === 'pack' && e.members.some((m) => m.kind === 'embedded'));
      if (manifest.mods.some(embeds)) {
        const dest = sharedPresetFile(preset.id);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(filePath, dest);
        if (preset.source) preset.source.file = dest;
        library.save();
      }
      return { ok: true, preset };
    } catch (err) {
      return { error: String((err as Error)?.message || err) };
    }
  }

  // A pasted d2mm://preset/... link. Same landing as a file: it parks in the Presets tab as
  // a wish list and installs nothing until asked. No stash — a link has no payload to keep.
  function importPresetLink(text: string): { ok: true; preset: Preset } | { error: string } {
    try {
      const decoded = decodePresetLink(text);
      if (!decoded.mods.length) return { error: t('В пресете нет модов') };
      const preset = library.addSharedPreset({
        name: decoded.name, note: '', author: decoded.author, wanted: decoded.mods,
      });
      return { ok: true, preset };
    } catch (err) {
      return { error: String((err as Error)?.message || err) };
    }
  }

  // enable exactly the preset's mods, disable everything else
  function applyPreset(preset: Preset): string[] {
    const wanted = new Set(library.presetModIds(preset));
    const errors: string[] = [];
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
          errors.push(`${rec.name}: ${(err as Error).message}`);
        }
      }
    }
    if (schemaTouched) schemaService.refresh();
    return errors;
  }

  return {
    sharedPresetFile,
    dropSharedPresetFile,
    ...plan,
    packFromRecords,
    importPresetFile,
    importPresetLink,
    applyPreset,
  };
}

export { categoryModList } from './preset-plan.ts';
export type { CatalogIndex, ShareEntry } from './preset-plan.ts';
