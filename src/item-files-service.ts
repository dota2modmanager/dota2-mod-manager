/**
 * The picks' pak: the item builder's looks in the language folder, for the game to read with nothing
 * of its own changed (src/item-files.ts says what goes in). One record in My mods, marked `generated`,
 * so its slot, its switch and the master switch work as for any mod; built again in its slot when a
 * pick changes, and taken away with the last pick.
 */
import { buildVpk, entryPath, type VpkEntry } from './vpk.ts';
import { swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';
import { itemFilesSteps, type LeftBehind, type PickPatch } from './item-files.ts';
import type { PAUSE } from './steps.ts';

/** What the pak's record was built from. */
export interface ItemFilesGenerated { itemFiles: true; picks: number; left: LeftBehind[] }

/** A record of this pak, for the code that goes through every record. */
export const isItemFilesRecord = (rec: object) => ((rec as { generated?: ItemFilesGenerated }).generated)?.itemFiles === true;

/** The pak's one record over the installer and the library. */
export function createItemFilesPak({ installer, library, log = () => {} }: {
  installer: PakInstaller & { remove(files: LibRecord['files'], opts: { recId: string }): void };
  library: Pick<Library, 'list' | 'add' | 'update' | 'removeRecord'>;
  log?: (msg: string) => void;
}) {
  const mine = () => library.list().find(isItemFilesRecord) ?? null;
  let built: (() => void) | null = null;

  return {
    /** What was left behind by the last build. */
    left: (): LeftBehind[] => ((mine()?.generated as ItemFilesGenerated | undefined)?.left ?? []),

    /** The picks' files, ready for `commit`: the paths they fill, lowercased. */
    * buildSteps({ list, beneath, filesShared }: { list: PickPatch[]; beneath: VpkEntry[]; filesShared?: { paths: string[]; entries: VpkEntry[] } }, game: string, picks: number): Generator<typeof PAUSE, Set<string>> {
      const { entries, left } = yield* itemFilesSteps(list, beneath, game, filesShared);
      built = () => this.write(entries, picks, left);
      return new Set(entries.map((e) => entryPath(e).toLowerCase()));
    },

    /** What the last build made, written. */
    commit(): void {
      built?.();
      built = null;
    },

    /** The pak of these files in its slot. */
    write(entries: VpkEntry[], picks: number, left: LeftBehind[]): void {
      const vpk = buildVpk(entries);
      const generated: ItemFilesGenerated = { itemFiles: true, picks, left };
      const name = t('Предметы героев: {0}', picks);
      const rec = mine();
      if (rec) {
        library.update(rec.id, { name, files: swapPak(installer, rec, vpk, rec.enabled === false), generated, updatedAt: Date.now() });
      } else {
        const made = library.add({ name, categoryId: 'imported', styleLabel: null, fileRef: null, preview: null, files: writePak(installer, vpk) });
        library.update(made.id, { generated });
      }
      for (const { source, what } of left) log(`item files: ${source} without the table has not got ${what.join(', ')}`);
    },

    /** The pak and its record gone: no pick left, or the table took over. */
    clear(): void {
      const rec = mine();
      if (!rec) return;
      installer.remove(rec.files, { recId: rec.id });
      library.removeRecord(rec.id);
    },
  };
}
