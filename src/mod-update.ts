/**
 * A catalog mod brought to the version the catalog has now, in the place it already had.
 *
 * Authors fix and rebuild their mods, and the catalog replaces the archive under the same name.
 * Until issue #171 the way to the new version was to delete the mod and install it again, which
 * also cost its place in the load order and its switch, and nothing said a new version existed.
 *
 * Knowing needs nothing new on disk. Every installed pak has a content fingerprint (src/vpk.ts),
 * and the catalog's index lists the fingerprints each of its mods has today (src/fingerprints.ts).
 * A catalog mod whose installed fingerprint is not among its own was replaced upstream. Checked
 * against a real library of four catalog mods on 2026-10-08: all four matched, none was flagged.
 */
import { FileTx } from './file-tx.ts';
import { t } from './i18n.ts';
import type { CatalogIdentity } from './fingerprints.ts';
import type { Installer } from './installer.ts';
import type { Library } from './library.ts';
import type { LibFile, LibRecord } from './types.ts';

/** Categories whose files are not a pak the catalog can be asked about. */
const NOT_PAKS = new Set(['imported', 'cosmetic', 'fonts', 'cursors', 'tools']);

/**
 * The kind of mod this can update: a pak installed from the catalog. Fonts and cursors are loose
 * files the catalog matches another way, and a pack, a pick or an import has no catalog file.
 */
export function updatable(rec: Pick<LibRecord, 'fileRef' | 'kind' | 'categoryId'>): boolean {
  return Boolean(rec.fileRef) && rec.kind !== 'pack' && !NOT_PAKS.has(rec.categoryId);
}

/**
 * Whether the catalog has another version of this mod than the one installed.
 * @param installedFp the fingerprint of the pak on disk (installer.analyzeRecord)
 * @param printsOf    the catalog's fingerprints for one of its mods, or null when it has none
 */
export function behindCatalog(
  rec: Pick<LibRecord, 'fileRef' | 'kind' | 'categoryId' | 'name' | 'styleLabel' | 'fpOriginal'>,
  installedFp: string | null | undefined,
  printsOf: (id: CatalogIdentity) => Set<string> | null,
): boolean {
  if (!updatable(rec)) return false;
  // a pak the app repacked to drop a whole-game table it shipped is matched on what it was
  const mine = (rec.fpOriginal as string | null | undefined) || installedFp;
  if (!mine) return false;
  const prints = printsOf({ categoryId: rec.categoryId, name: rec.name, styleLabel: rec.styleLabel ?? null });
  return Boolean(prints && prints.size && !prints.has(mine));
}

const isPak = (f: LibFile) => f.root === 'lang' && /^pak\d+_(dir|\d{3})\.vpk$/i.test(f.relPath);

/**
 * Replace an installed mod with the catalog's current version: same record, same slot, same switch.
 *
 * The new archive is fetched before anything is touched, so a download that fails leaves the
 * installed version as it was. Paks go in beside the old ones and then take the old slot; only a
 * file with a fixed path (a terrain's maps/dota.vpk) has to make room first.
 * @returns the record, updated
 */
export async function updateMod({ installer, library, rec, log = () => {} }: {
  installer: Pick<Installer, 'download' | 'remove' | 'installInto' | 'slotBase' | 'moveToSlot' | 'setEnabled'>;
  library: Pick<Library, 'update'>;
  rec: LibRecord;
  log?: (msg: string) => void;
}): Promise<LibRecord> {
  if (!updatable(rec)) throw new Error(t('Этот мод нельзя обновить из каталога'));
  const oldBase = installer.slotBase(rec);
  const wasOff = rec.enabled === false;
  const local = await installer.download(rec.categoryId, rec.fileRef as string, rec.name);

  const inPlace = rec.files.every(isPak);
  if (!inPlace) installer.remove(rec.files, { recId: rec.id });
  let files = FileTx.run((tx) => installer.installInto(tx, { categoryId: rec.categoryId, modName: rec.name, local }), log);
  if (inPlace) installer.remove(rec.files, { recId: rec.id });

  const newBase = installer.slotBase({ files });
  if (oldBase && newBase && newBase !== oldBase) files = installer.moveToSlot({ files }, oldBase, newBase);
  if (wasOff) installer.setEnabled(files, false, rec.id);
  log(`updated from the catalog: ${rec.name}${oldBase ? ` (${oldBase})` : ''}`);
  // the lifted item blocks and the repacked fingerprint belonged to the old file
  return library.update(rec.id, { files, fpOriginal: null, schema: undefined, schemaChecked: false, updatedAt: Date.now() }) as LibRecord;
}
