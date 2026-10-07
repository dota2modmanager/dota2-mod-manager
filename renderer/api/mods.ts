/* The mods channels (src/ipc-mods.ts, ipc-library.ts, ipc-foreign.ts, ipc-packs.ts): what is
 * installed, putting mods in and out of the game, the load order, the files found in the mods
 * folder, and packs. */
import type { ExternalFile, LibRecord } from '../library/types.ts';
import type { Dialog, ImportReply, Reply } from './reply.ts';

interface InstallRequest {
  categoryId: string;
  name: string;
  styleLabel: string | null | undefined;
  fileRef: string | undefined;
  preview: string | undefined;
}

interface ModsList {
  installed: LibRecord[];
  external: ExternalFile[];
  /** paks taken, out of the ceiling the game loads */
  slots: number;
  slotCeil: number;
  /** fonts and cursors Steam put back, with no archive left to reinstall from */
  verifyStuck: { id: string; name: string }[];
}

/** A mod split by hero, a pack taken apart: what it became. */
type Parts = Reply<{ count: number; names: string[] }>;
type Adopted = Reply<{ name: string; matched?: boolean }>;

export interface ModsApi {
  install: (payload: InstallRequest) => Promise<Reply<{ record: LibRecord; replaced?: string[]; already?: boolean }>>;
  list: () => Promise<ModsList>;
  switchOffStaleTerrains: () => Promise<Reply<{ names: string[] }>>;
  setEnabled: (id: string, enabled: boolean) => Promise<Reply<{ replaced?: string[] }>>;
  remove: (id: string) => Promise<Reply>;
  /** a selection at once: one rebuild of the item schema for the batch, not one per mod */
  removeMany: (ids: string[]) => Promise<Reply<{ removed: number; errors: string[] }>>;
  /** who owns the map archive a terrain is about to replace (maps/dota.vpk is one file) */
  mapsOwner: () => Promise<{ present: boolean; owner?: string; file?: string }>;
  setEnabledMany: (ids: string[], enabled: boolean) => Promise<Reply<{ changed: number; errors: string[] }>>;
  move: (id: string, dir: number) => Promise<Reply<{ moved: number; with?: string }>>;
  reorder: (id: string, toIndex: number) => Promise<Reply<{ moved: number }>>;
  externalSetEnabled: (fileName: string, enabled: boolean) => Promise<Reply>;
  externalRemove: (fileName: string) => Promise<Reply>;
  exportSingle: (id: string) => Promise<Dialog<{ path: string; size: number }>>;
  unpackToFolder: (id: string) => Promise<Dialog<{ path: string; files: number; bytes: number }>>;
  /** the pre-patch mark off one mod, once its owner checked it in the game */
  clearPrePatch: (id: string) => Promise<Reply>;
  importDialog: () => Promise<ImportReply>;
  importFolderDialog: () => Promise<ImportReply>;
  importPaths: (paths: string[]) => Promise<ImportReply>;
  importBuffers: (items: { name: string; data: ArrayBuffer | Uint8Array }[]) => Promise<ImportReply>;
  masterState: () => Promise<{ off: boolean }>;
  setMaster: (enabled: boolean) => Promise<Reply>;
  splitMod: (id: string) => Promise<Parts>;
  splitExternal: (fileName: string) => Promise<Parts>;
  adoptMod: (id: string, preview: string | null) => Promise<Adopted>;
  adoptExternal: (fileName: string, preview: string | null) => Promise<Adopted>;
  adoptCursor: (preview: string | null) => Promise<Adopted>;
  adoptFont: (name: string, preview: string | null) => Promise<Adopted>;
  pathForFile: (file: File) => string;
}

export interface PacksApi {
  combine: (name: string, modIds: string[]) => Promise<Reply<{ pack: LibRecord; conflicts?: unknown[] }>>;
  addMembers: (packId: string, modIds: string[]) => Promise<Reply<{ pack: LibRecord; added: number; conflicts?: unknown[] }>>;
  setMemberEnabled: (packId: string, memberId: string, enabled: boolean) => Promise<Reply<{ conflicts?: unknown[] }>>;
  removeMember: (packId: string, memberId: string) => Promise<Reply<{ removedPack?: boolean }>>;
  extractMembers: (packId: string, memberIds: string[]) => Promise<Reply<{ count: number; names: string[]; removedPack?: boolean }>>;
  disband: (packId: string) => Promise<Parts>;
}
