/* What My mods is drawn from: the records main lists (mods:list, crates/mm-core/src/owner/owner_library.rs), the files
 * found in the mods folder that no record owns, and what the app did about the last Dota patch. */

export interface LibFile {
  root: string;
  relPath: string;
}

/** A fingerprint match: which catalog mod a file is (crates/mm-core/src/catalog/fingerprints.rs), best first. */
export type Match = { categoryId: string; name: string; styleLabel?: string | null }[];

/** Two mods can carry the same file, and the one loaded first wins it. */
export interface Cover {
  /** the winner's record id or foreign-file key (crates/mm-core/src/install/installer_slots.rs coverage) */
  key?: string;
  name: string;
  files: number;
  /** which files it takes, sorted, at most COVER_PATHS of them */
  paths?: string[];
}

export interface Member {
  id: string;
  name: string;
  enabled: boolean;
  categoryId: string;
  styleLabel?: string | null;
  info?: string;
  preview?: string;
  files?: LibFile[];
  [key: string]: unknown;
}

export interface LibRecord {
  id: string;
  name: string;
  /** 'pack' for a pack of several mods in one pak */
  kind?: string;
  enabled: boolean;
  categoryId: string;
  /** a cosmetic pick's slot in the item schema */
  slot?: string;
  /** the item a cosmetic pick dresses the slot in, and its effects, comma separated (crates/mm-core/src/item_builder/mod.rs) */
  itemId?: string;
  effectId?: string;
  targetItemId?: string;
  styleLabel?: string | null;
  /** what the analysis says the file is, for an import */
  info?: string;
  match?: Match | null;
  files: LibFile[];
  members?: Member[];
  /** a mod inside a pack, as the installed index lists it: the pack that holds it */
  packId?: string;
  packName?: string;
  /** the shared pack the app folds mods into when the pak slots run out */
  auto?: boolean;
  /** the part of the load order a mod keeps to (crates/mm-core/src/install/slot_zones.rs) */
  zone?: unknown;
  /** how many heroes an import skins: two or more can be split */
  subjects?: number;
  /** its item pictures were taken out (crates/mm-core/src/install/installer_repack.rs dropItemIcons) */
  noItemIcons?: boolean;
  schemaCount?: number;
  schemaLive?: boolean;
  coveredBy?: Cover[];
  staleMap?: boolean;
  /** a Dota update changed files this mod replaces since it was installed (crates/mm-core/src/game/update_impact.rs) */
  /** the paths are the first hundred of each kind, for the window the pill opens (views/library/pre-patch.ts) */
  prePatch?: { since: string | null; changed: number; removed: number; changedPaths?: string[]; removedPaths?: string[] };
  /** the catalog has a newer version of this mod than the one installed (crates/mm-core/src/install/mod_update.rs) */
  updateAvailable?: boolean;
  /** the user's own mod (crates/mm-core/src/tools/own_work.rs): "ok" to send to the catalog, or what it lacks */
  publish?: string;
  /** a copy of the pumpkin's mod this install did not earn, kept off (crates/mm-core/src/game/scream_guard.rs) */
  cheat?: boolean;
  fileRef?: string;
  preview?: string;
  [key: string]: unknown;
}

/** A file in the mods folder that no record owns. */
export interface ExternalFile {
  key: string;
  name: string;
  kind?: string;
  enabled: boolean;
  /** the installed mod this is a byte-for-byte copy of */
  duplicateOf?: string;
  match?: Match | null;
  info?: string;
  fileName?: string;
  size: number;
  subjects?: number;
  heroNames?: string[];
  coveredBy?: Cover[];
  files?: LibFile[];
  [key: string]: unknown;
}

/** What the app did about the last Dota patch (crates/mm-core/src/game/game_repair.rs). */
export interface RepairState {
  state: 'idle' | 'waiting' | 'failed' | 'done' | string;
  error?: string;
  healed?: unknown[];
  /** the mods whose files the patch changed, by name; `off`, those switched off because their old
   * interface files would stop Dota from starting (src game_repair.rs switch_off_crashing) */
  touched?: { build: string | null; mods: string[]; off?: string[] };
  /** the patch landed while the app was closed, and the game was put back only at start */
  whileClosed?: true;
  /** waiting on Steam's file check or an update rather than on Dota */
  steam?: 'validating' | 'updating';
  /** what started it: 'manual' is a button the user pressed, which answers for itself */
  reason?: unknown;
}
