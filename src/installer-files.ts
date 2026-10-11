// The language folder's own vocabulary, shared by the installer and the modules behind it: the
// name a file switched off by the master switch carries, the note that says which files are ours,
// what an unfinished transaction leaves behind, and how much a repack may hold in memory.
import { isAppPak } from './slot-zones.ts';

// Merging a multi-volume import into one file holds the whole mod in memory once. Well
// above any real skin pack (a Skinchanger export is ~70 MB), but a multi-GB set is left
// in its original volumes rather than risking the allocation.
export const MERGE_SIZE_CAP = 1200 * 1024 * 1024;

// Master "mods off" switch: every active mod pak is renamed <file>.moff so the game
// ignores it (it only mounts pakNN_dir.vpk). Distinct from the per-mod ".off" state so
// the two never clobber each other. Official localization (pak01_*) / gameinfo.gi are
// never touched — turning mods off must not strip the game's own language files.
export const MASTER_OFF = '.moff';

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
export const OWNERSHIP_FILE = 'dota2modmanager.json';
/** The game's own files in the language folder, and our notice pak: never a mod to touch. */
export function isOfficialLangFile(baseLower: string): boolean {
  return /^pak01_/.test(baseLower) || baseLower === 'gameinfo.gi' || isAppPak(baseLower);
}

// What a FileTx parks next to a file it is about to replace or delete (see src/file-tx.ts).
// Nothing should outlive its transaction; one that does means the app died mid-write, and
// sweepStaged() cleans up after that on the next start. The name is the transaction's id and,
// since 2026-10-10, a dash and a count, so one file parked twice in one change gets two names.
export const STAGED_RE = /\.[a-z0-9]+(?:-[a-z0-9]+)?\.mmtx$/i;
