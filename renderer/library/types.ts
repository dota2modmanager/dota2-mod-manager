/* What My mods is drawn from: the records main lists (mods:list, src/ipc-library.ts), the files
 * found in the mods folder that no record owns, and what the app did about the last Dota patch. */

export interface LibFile {
  root: string;
  relPath: string;
}

/** A fingerprint match: which catalog mod a file is (src/fingerprints.ts), best first. */
export type Match = { categoryId: string; name: string; styleLabel?: string | null }[];

/** Two mods can carry the same file, and the one loaded first wins it. */
export interface Cover {
  name: string;
  files: number;
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
  /** the item a cosmetic pick dresses the slot in, and its effects, comma separated (src/item-builder.ts) */
  itemId?: string;
  effectId?: string;
  styleLabel?: string | null;
  /** what the analysis says the file is, for an import */
  info?: string;
  match?: Match | null;
  files: LibFile[];
  members?: Member[];
  /** the part of the load order a mod keeps to (src/slot-zones.ts) */
  zone?: unknown;
  /** how many heroes an import skins: two or more can be split */
  subjects?: number;
  schemaCount?: number;
  schemaLive?: boolean;
  coveredBy?: Cover[];
  staleMap?: boolean;
  /** a Dota update changed files this mod replaces since it was installed (src/update-impact.ts) */
  prePatch?: { since: string | null; changed: number; removed: number };
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

/** What the app did about the last Dota patch (src/patch-repair.js). */
export interface RepairState {
  state: 'idle' | 'waiting' | 'failed' | 'done' | string;
  error?: string;
  healed?: unknown[];
  /** the mods whose files the patch changed, by name */
  touched?: { build: string | null; mods: string[] };
}
