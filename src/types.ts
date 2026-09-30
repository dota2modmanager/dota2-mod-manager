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
  members?: Record<string, unknown>[];
  [key: string]: unknown;
}

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
  wanted?: Record<string, unknown>[];
  source?: { note: string; author: string; file: string | null; importedAt: number };
  [key: string]: unknown;
}
