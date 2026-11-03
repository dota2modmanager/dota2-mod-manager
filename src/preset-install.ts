/* Putting a preset on: an own one whose mods may have gone, or a received one that is still a
 * wish list. The Presets screen (src/ipc-presets.ts) and the command line (src/cli.ts) both go
 * through here, so `--apply` from a script does exactly what the button does: the same catalog
 * downloads, the same one-cursor rule, the same table built once at the end.
 */
import fs from 'node:fs';

import { Library } from './library.ts';
import { readPresetFile } from './preset-share.ts';
import { installVpkBuffer } from './import.ts';
import { t } from './i18n.ts';
import { errorText } from './error-text.ts';
import { isWindowRecord } from './arcana-base-color.ts';
import type { AppContext } from './app-context.ts';
import type { CatalogIndex } from './presets-service.ts';
import type { LibRecord, ModIdentity, Preset, PresetEntry } from './types.ts';

/** Does changing this record mean the item table has to be rebuilt? */
export function touchesSchema(rec: LibRecord): boolean {
  // the arcana window's record sets the colour the builder puts Terrorblade's base on in
  return rec.categoryId === 'cosmetic' || (Array.isArray(rec.schema) && rec.schema.length > 0) || isWindowRecord(rec);
}

/** What the preset flows need from the app. */
export type PresetInstallDeps = Pick<AppContext, 'installer' | 'library' | 'schemaService' | 'presets'
  | 'adoptImportedFiles' | 'afterDeployMaster' | 'disableOtherCursors' | 'sendProgress' | 'blocked'>;

/** How applying went: the counts, and what was left out and why. */
export type PresetApplied = { ok: true; installed: number; missing?: string[]; errors: string[] } | { error: string };

/** The two ways a preset goes on, over the app's services. */
export function createPresetInstall({
  installer, library, schemaService, presets, adoptImportedFiles, afterDeployMaster, disableOtherCursors, sendProgress, blocked,
}: PresetInstallDeps) {
  /* One mod out of the catalog, by the name a preset remembers it under, into the library.
   * Answers the record, or null with the reason pushed onto `errors`.
   *
   * A received preset being installed and an own preset whose mods have gone both need this.
   * Two copies of "install from the catalog" is how one of them ends up without the rule that
   * only one cursor set is live. */
  async function installFromCatalog(
    { categoryId, name, styleLabel }: Pick<ModIdentity, 'categoryId' | 'name' | 'styleLabel'>,
    cat: CatalogIndex,
    errors: string[],
  ): Promise<LibRecord | null> {
    const have = library.findByKey(categoryId, name, styleLabel);
    if (have) return have;
    const hit = cat.lookup(categoryId, name, styleLabel);
    // an entry with no file to fetch is as good as absent, and saying so beats a download of "undefined"
    if (!hit?.fileRef) { errors.push(`${name}: ${t('нет в каталоге')}`); return null; }
    if (hit.categoryId === 'cursors') disableOtherCursors(null); // one cursor at a time
    const files = await installer.install({ categoryId: hit.categoryId, modName: hit.name, fileRef: hit.fileRef });
    const rec = library.add({
      categoryId: hit.categoryId, name: hit.name, styleLabel: hit.styleLabel,
      fileRef: hit.fileRef, preview: hit.preview, files,
    });
    if (hit.categoryId === 'cursors') { try { installer.ensureCursorStore(rec.id, files); } catch { /* noop */ } }
    return rec;
  }

  /* A build remembers its mods by name, so some of them may not be installed any more: deleted
   * since, or saved on another machine. Applying used to switch every other mod off, switch on
   * only the members that happened to be here, and answer "Preset applied" - so pressing it on
   * a build whose mods had gone left somebody with fewer mods than before, nothing installed,
   * and a message saying it had worked.
   *
   * Now whatever the catalog still has is installed first. A mod of the user's own cannot be
   * fetched back from anywhere, so it is left out and named, rather than silently. */
  async function applyOwn(preset: Preset): Promise<PresetApplied> {
    const absent = library.presetMembers(preset).filter((m) => !m.rec).map((m) => m.identity);
    const missing: string[] = [];
    const errors: string[] = [];
    let installed = 0;
    if (absent.length) {
      const cat = await presets.catalogIndex();
      for (const identity of absent) {
        if (identity.categoryId === 'imported') { missing.push(identity.name); continue; }
        try {
          sendProgress({ type: 'stage', label: identity.name, stage: t('установка') });
          if (await installFromCatalog(identity, cat, errors)) installed++;
        } catch (err) {
          errors.push(`${identity.name}: ${errorText(err)}`);
        }
      }
    }
    const off = preset.picks?.length ? blocked('cosmetics') : null; // looks switched off remotely: the mods alone, and why
    if (off) errors.push(off.error);
    const toggleErrors = await presets.applyPreset(preset, { picks: !off });
    if (installed) {
      afterDeployMaster();
      sendProgress({ type: 'done', label: preset.name });
    }
    // A mod that could not be switched is the preset failing, exactly as before. A member that
    // could not be fetched is the preset applying without it, and is said as a warning.
    if (toggleErrors.length) return { error: [...errors, ...toggleErrors].join('\n') };
    return { ok: true, installed, missing, errors };
  }

  /* A received preset, from a .d2mm or a link: each entry fetched, unpacked or picked, then put
   * on as an ordinary preset. */
  async function resolve(preset: Preset & { wanted: PresetEntry[] }): Promise<PresetApplied> {
    const stash = preset.source && preset.source.file;
    let bundle = null;
    if (stash && fs.existsSync(stash)) {
      try { bundle = readPresetFile(stash); } catch (err) { return { error: errorText(err) }; }
    }
    const cat = await presets.catalogIndex();
    const fpIndex = presets.installedFpIndex();
    const errors: string[] = [];
    let schemaTouched = false;

    // -> ids of the library records that now provide this mod (a multi-hero bundle splits
    // into several), or an empty list when it could not be resolved at all
    const resolveEntry = async (entry: PresetEntry): Promise<string[]> => {
      try {
        if (entry.kind === 'catalog') {
          const rec = await installFromCatalog(entry, cat, errors);
          return rec ? [rec.id] : [];
        }
        if (entry.kind === 'embedded') {
          const onDisk = entry.fp && fpIndex.get(entry.fp);
          if (onDisk) return [onDisk]; // already on disk
          if (!bundle) { errors.push(`${entry.name}: ${t('файл пресета недоступен')}`); return []; }
          sendProgress({ type: 'stage', label: entry.name, stage: t('установка') });
          const files = installVpkBuffer(installer, bundle.readMod(entry.file));
          // exactly the treatment a dragged-in file gets: the sender's item blocks lifted
          // out, a multi-hero bundle split, a name from the content when theirs is a slot
          const { records, schema } = adoptImportedFiles({ files, name: entry.name, fileRef: null });
          if (schema) schemaTouched = true;
          if (entry.fp && records.length === 1) fpIndex.set(entry.fp, records[0].id);
          return records.map((r) => r.id);
        }
        if (entry.kind === 'cosmetic') {
          if (blocked('cosmetics')) return [];
          // the table is built once for the whole preset, at the end
          const rec = schemaService.pickCosmetic(entry.slot, entry.itemId, entry.name, entry.effectId, { write: false });
          schemaTouched = true;
          return rec ? [rec.id] : [];
        }
        const why = entry.kind === 'missing' ? entry.reason : '';
        errors.push(`${entry.name}: ${why || t('нет в файле')}`);
        return [];
      } catch (err) {
        errors.push(`${entry.name}: ${errorText(err)}`);
        return [];
      }
    };

    const ids: string[] = [];
    for (const entry of preset.wanted) {
      if (entry.kind === 'pack') {
        const memberIds: string[] = [];
        for (const m of entry.members) memberIds.push(...await resolveEntry(m));
        const built = presets.packFromRecords(entry.name, memberIds);
        if (built) ids.push(built.id); else ids.push(...memberIds);
      } else {
        ids.push(...await resolveEntry(entry));
      }
    }

    // from here this is an ordinary preset: its mods, and the looks the sender's file asked for
    const made = [...new Set(ids)].map((id) => library.find(id));
    const landed = made.filter((r): r is LibRecord => Library.inPreset(r));
    preset.mods = landed.map(Library.identityOf);
    preset.picks = made.filter(Library.isPick).map(Library.pickOf);
    delete preset.modIds;
    delete (preset as Preset).wanted;           // resolved: it's an ordinary preset now
    if (preset.source) preset.source.file = null;
    library.save();
    if (stash) { try { fs.rmSync(stash, { force: true }); } catch { /* noop */ } }

    errors.push(...await presets.applyPreset(preset, { picks: !blocked('cosmetics') }));
    // a mod that arrived already enabled never passes through applyPreset's own switch, so
    // its freshly lifted blocks would sit in the library without ever reaching the build
    if (schemaTouched) await schemaService.refreshInBackground();
    afterDeployMaster();
    sendProgress({ type: 'done', label: preset.name });
    return { ok: true, installed: preset.mods.length, errors };
  }

  return { installFromCatalog, applyOwn, resolve };
}
