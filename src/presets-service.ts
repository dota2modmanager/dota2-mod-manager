/* Presets, and the two ways one travels to somebody else.
 *
 * A preset is a named set of "these mods on, everything else off", and the same for the looks
 * (Library.picksOn). Sharing is what makes this
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
import type { Settings } from './settings.ts';
import { createPresetPlan } from './preset-plan.ts';
import { isWindowRecord } from './arcana-base-color.ts';
import type { LibFile, LibRecord, PackMember, Preset, PresetEntry, PresetPick } from './types.ts';

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
  // the arcana window's record sets the colour the builder puts Terrorblade's base on in
  return rec.categoryId === 'cosmetic' || (Array.isArray(rec.schema) && rec.schema.length > 0) || isWindowRecord(rec);
}

/**
 * Whether what is on is exactly this preset, so the Presets screen can say which one you are in:
 * its installed mods and no other, and for a preset that kept its looks, those and no other. A
 * member not installed cannot be on, and is not asked about; a preset saved before it kept looks
 * says nothing about them, and they are not asked about either.
 */
export function presetIsOn(library: Library, preset: Preset): boolean {
  const wanted = new Set(library.presetModIds(preset));
  if (library.list().some((r) => Library.inPreset(r) && (r.enabled !== false) !== wanted.has(r.id))) return false;
  if (!Array.isArray(preset.picks)) return true;
  const key = (p: PresetPick) => `${p.slot}|${p.itemId}|${p.effectId || ''}`;
  const on = new Set(library.picksOn().map(key));
  const named = new Set(preset.picks.map(key));
  return on.size === named.size && [...on].every((k) => named.has(k));
}

/**
 * Everything about presets that needs the running app's services.
 *
 * @param deps.catalog        the catalog store, for turning a mod into an identity
 * @param deps.installer      reads and writes what is in the game folder
 * @param deps.library        the manifest of installed mods and saved presets
 * @param deps.schemaService  puts a preset's looks on, and rebuilds the item table when a preset changes it
 * @param deps.deployAndApply  rebuilds one pack's VPK
 * @param deps.settings       where the preset applied last is kept (presetState)
 */
export function presetsService({ catalog, installer, library, schemaService, deployAndApply, settings }: {
  catalog: Pick<Catalog, 'load'>; installer: PresetInstaller; library: Library;
  settings?: Pick<Settings, 'get' | 'set'>;
  schemaService: {
    refreshInBackground(): Promise<unknown>;
    pickCosmetic(slot: string, itemId: string, name: string, effectId: string, opts: { write: boolean }): unknown;
  };
  deployAndApply: (pack: LibRecord) => unknown;
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

  /**
   * Enable exactly the preset's mods, disable everything else, and the same for its looks: each
   * of them on in its slot, and every other look off, kept in My mods to be put on again. A preset
   * saved before it kept looks (no `picks`) has nothing to say about them and leaves them be.
   * @param opts.picks  false: the looks are switched off for now (the remote config), mods only
   */
  async function applyPreset(preset: Preset, { picks = true } = {}): Promise<string[]> {
    const wanted = new Set(library.presetModIds(preset));
    const errors: string[] = [];
    // Free cosmetics are not among the mods (see Library.inPreset): they are the preset's looks,
    // switched further down, and only by a preset that kept them.
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
    if (picks && Array.isArray(preset.picks)) {
      // A preset of 20 left the looks of a build of 100 on in every slot it did not name, so going
      // from one to the other was adding to it (J0nathan550, 2026-10-29): the preset is the state
      const named = new Set(preset.picks.map((p) => `${p.slot}|${p.itemId}`));
      for (const rec of library.list()) {
        if (rec.enabled === false || !Library.isPick(rec) || named.has(`${rec.slot}|${rec.itemId}`)) continue;
        library.setEnabled(rec.id, false);
        schemaTouched = true;
      }
      for (const p of preset.picks) {
        try {
          schemaService.pickCosmetic(p.slot, p.itemId, p.name, p.effectId, { write: false });
          schemaTouched = true;
        } catch (err) {
          errors.push(`${p.name}: ${(err as Error).message}`);
        }
      }
    }
    if (schemaTouched) await schemaService.refreshInBackground();
    settings?.set('lastPreset', preset.id);
    return errors;
  }

  /**
   * Which preset you are in, for its card: this one exactly, or the one applied last and changed
   * since. One with members not installed is yours only if you applied it: of three mods since
   * deleted, none is on whatever the state, and every such preset said it was the one.
   */
  function presetState(preset: Preset): 'active' | 'changed' | null {
    const last = settings?.get('lastPreset') === preset.id;
    const whole = library.presetMembers(preset).every((m) => m.rec);
    if ((whole || last) && presetIsOn(library, preset)) return 'active';
    return last ? 'changed' : null;
  }

  return {
    sharedPresetFile,
    dropSharedPresetFile,
    ...plan,
    packFromRecords,
    importPresetFile,
    importPresetLink,
    applyPreset,
    presetState,
  };
}

export { categoryModList } from './preset-plan.ts';
export type { CatalogIndex, ShareEntry } from './preset-plan.ts';
