/* The shapes the main process hands between its modules: a record of the library and the files it
 * owns. src/library.ts writes them to manifest.json; the window reads the same records over IPC and
 * keeps its own copy of the shape (renderer/library/types.ts). */

/** A file a record owns, under one of the folders the app writes into. */
export interface LibFile {
  /** lang: the mods folder the game mounts; fonts and cursor: over the game's own; tools: the app's */
  root: 'lang' | 'fonts' | 'cursor' | 'tools' | string;
  relPath: string;
}

/** One entry of the library: a mod, a pack of them, or a cosmetic pick. */
export interface LibRecord {
  id: string;
  name: string;
  categoryId: string;
  /** false when switched off; an old record may not say, and then it is on */
  enabled?: boolean;
  /** 'pack' for several mods in one pak */
  kind?: string;
  styleLabel?: string | null;
  fileRef?: string | null;
  preview?: string | null;
  files: LibFile[];
  installedAt?: number;
  /** a cosmetic pick's slot in the item schema, the item it picks and its effects */
  slot?: string;
  itemId?: string;
  effectId?: string;
  /** what the files are, when fingerprinted: two installs of the same mod share it */
  fp?: string | null;
  /** a pack's members */
  members?: PackMember[];
  /** the item blocks this mod changed, lifted out of the table it shipped (src/schema-service.ts) */
  schema?: { id: string; name: string; block: string }[];
  /** looked at once for a whole-game table, so a clean mod is not scanned at every start */
  schemaChecked?: boolean;
  /** the fingerprint before a shipped table was stripped out, so the catalog still knows it */
  fpOriginal?: string | null;
  [key: string]: unknown;
}

/** One mod inside a pack: its identity, whether it is on, and where its own copy is kept. */
export interface PackMember {
  id: string;
  name: string;
  categoryId: string;
  styleLabel?: string | null;
  enabled?: boolean;
  fp?: string | null;
  info?: string;
  [key: string]: unknown;
}

/** One line of a preset that travels: what a .d2mm or a link says about one mod (src/preset-share.ts). */
export type PresetEntry =
  | { kind: 'catalog'; categoryId: string; name: string; styleLabel: string | null; fp: string | null }
  | { kind: 'embedded'; name: string; file: string; categoryId: string; size: number; fp: string | null; info: string }
  | { kind: 'cosmetic'; name: string; slot: string; itemId: string; effectId: string }
  | { kind: 'pack'; name: string; members: PresetEntry[] }
  | { kind: 'missing'; name: string; reason: string };

/** A mod as a preset remembers it: what it is, not which installation of it (src/preset-share.ts). */
export interface ModIdentity {
  categoryId: string;
  name: string;
  styleLabel: string | null;
  fp: string | null;
}

/** A saved build, or one received as a .d2mm and not installed yet (`wanted`). */
export interface Preset {
  id: string;
  name: string;
  mods?: ModIdentity[];
  /** how presets were written before they held identities: ids of installed records */
  modIds?: string[];
  updatedAt: number;
  /** a received preset's lines, until it is installed */
  wanted?: PresetEntry[];
  source?: { note: string; author: string; file: string | null; importedAt: number };
  [key: string]: unknown;
}
