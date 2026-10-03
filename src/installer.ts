// The installer: everything that writes a mod into the game folder or takes it out again. The
// class is the one door the rest of the app uses; the work behind it is in files of its own:
//   src/installer-downloads.ts  getting a catalog archive onto this machine
//   src/installer-write.ts      writing that archive into the folder, switching it, removing it
//   src/installer-slots.ts      the load order: pak slots, moving and swapping, who covers whom
//   src/installer-packs.ts      several mods in one pak slot
//   src/installer-repack.ts     what is installed, read, merged, unpacked, stripped and split
//   src/installer-folder.ts     the folder as a whole: master switch, ownership note, foreign files
//   src/installer-files.ts      the names and limits those share
// Fonts and cursors, the files written over the game's own, are src/overlays.ts.
import fs from 'node:fs';
import path from 'node:path';
import { ensureLangFolder } from './gamelang.ts';
import { validateGamePath } from './steam.ts';
import { FileTx, copyInto, writeInto, type Writer } from './file-tx.ts';
import { Overlays, FONTS_SUBDIR, CURSOR_SUBDIR } from './overlays.ts';
import { t } from './i18n.ts';
import * as zones from './slot-zones.ts';
import { MASTER_OFF } from './installer-files.ts';
import * as downloads from './installer-downloads.ts';
import * as slots from './installer-slots.ts';
import * as packs from './installer-packs.ts';
import * as repack from './installer-repack.ts';
import * as folder from './installer-folder.ts';
import * as write from './installer-write.ts';
import type { Library } from './library.ts';
import type { HasFiles, LibFile, LibRecord } from './types.ts';
import type { ModIdentityGuess } from './mod-id.ts';

// src/import.ts takes these from here, as it always has
export { MERGE_SIZE_CAP } from './installer-files.ts';
export { PRIORITY_CATEGORIES } from './slot-zones.ts';

/** How an install is going, for the bar at the bottom of the window. */
export type InstallProgress =
  | { type: 'stage'; label: string; stage: string }
  | { type: 'download'; label: string; loaded: number; total: number };

/** The parameters of a function over the installer, without the installer: what its method takes. */
type Rest<F> = F extends (inst: Installer, ...rest: infer R) => unknown ? R : never;

export class Installer {
  downloadsDir: string;
  toolsDir: string;
  backupsDir: string;
  /** per-member source VPKs of combined packs */
  packsDir: string;
  /** per-record copy of each cursor set */
  cursorsDir: string;
  getGamePath: () => string | null;
  getLangSuffix: () => string;
  /** fonts and cursors, the files written over the game's own: src/overlays.ts */
  overlays: Overlays;
  onProgress: (evt: InstallProgress) => void;
  /** asks the game which of its own items a path list replaces (src/mod-id.ts); optional,
   *  because without a game path there is nothing to ask and the path guess still answers */
  identify: (paths: string[]) => ModIdentityGuess | null;
  /** what the catalog says an archive should hash to (src/catalog.ts); optional and often
   *  null, which means the download is checked the way it always was */
  publishedHash: (categoryId: string, file: string) => string | null;
  /** told what a failed change could not put back, usually a pak Dota holds open (src/file-tx.ts) */
  log: (msg: string) => void;

  /**
   * @param opts.getGamePath    e.g. ...\dota 2 beta\game
   * @param opts.getLangSuffix  e.g. "russian"
   * @param opts.identify       catalog mods these files are
   * @param opts.publishedHash  an archive's sha256 as the catalog published it
   * @param opts.log            the diagnostics log, told when a change could not be undone
   */
  constructor({ userDataDir, getGamePath, getLangSuffix, onProgress, identify = null, publishedHash = null, log = () => {} }: {
    userDataDir: string; getGamePath: () => string | null; getLangSuffix: () => string;
    onProgress?: ((evt: InstallProgress) => void) | null;
    identify?: ((paths: string[]) => ModIdentityGuess | null) | null;
    publishedHash?: ((categoryId: string, file: string) => string | null) | null;
    log?: (msg: string) => void;
  }) {
    this.downloadsDir = path.join(userDataDir, 'downloads');
    this.toolsDir = path.join(userDataDir, 'tools');
    this.backupsDir = path.join(userDataDir, 'backups');
    this.packsDir = path.join(userDataDir, 'packs');
    this.cursorsDir = path.join(userDataDir, 'cursors');
    for (const dir of [this.downloadsDir, this.toolsDir, this.backupsDir, this.packsDir, this.cursorsDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.getGamePath = getGamePath;
    this.overlays = new Overlays({
      getGamePath, backupsDir: this.backupsDir, cursorsDir: this.cursorsDir,
      cachedArchive: (categoryId, fileRef) => this.cachedArchive(categoryId, fileRef),
    });
    this.getLangSuffix = getLangSuffix;
    this.onProgress = onProgress || (() => {});
    this.identify = identify || (() => null);
    this.publishedHash = publishedHash || (() => null);
    this.log = log;
  }

  // ---------- where things go ----------

  /** The language folder mods are installed into. */
  langFolder(): string {
    const game = this.getGamePath();
    if (!game) throw new Error(t('Путь к Dota 2 не задан'));
    return path.join(game, `dota_${this.getLangSuffix()}`);
  }

  /**
   * Where a mod's file actually is right now. Switching a mod off renames it to ".off" and
   * the master switch renames everything to ".moff", so anything that reads a mod's own
   * bytes has to look for those too - reading the plain name only meant a disabled mod
   * became unreadable, and with it nameless and pictureless in the library.
   * Falls back to the plain path so callers still get a sensible error.
   */
  langFileOnDisk(relPath: string): string {
    const base = path.join(this.langFolder(), relPath);
    return ['', '.off', MASTER_OFF].map((s) => base + s).find((p) => fs.existsSync(p)) || base;
  }

  /**
   * There is a game to install into, or there is nothing to do.
   *
   * mkdir is recursive, so a wrong path never failed on its own: it built the whole tree and
   * filled it. That is how a user ended up with 43 mods in the leftovers of a library he had
   * moved to another drive, reported as installed and visible to nobody.
   */
  requireGameFolder(): string {
    const game = this.getGamePath();
    if (!game) throw new Error(t('Путь к Dota 2 не задан'));
    if (!validateGamePath(game)) {
      throw new Error(t('По сохранённому пути нет файлов Dota 2 — укажи папку игры заново в настройках'));
    }
    return game;
  }

  /** Called before writing into the folder. English is the one language Valve ships no folder
   *  for, so there the layer definition it would have had is laid down too (src/gamelang.ts). */
  ensureLangFolder(): string {
    return ensureLangFolder(this.requireGameFolder(), this.getLangSuffix());
  }

  /** The folder a record's files are relative to. */
  rootAbs(root: string): string {
    const game = this.getGamePath();
    switch (root) {
      case 'lang': return this.langFolder();
      case 'fonts': return path.join(game as string, ...FONTS_SUBDIR);
      case 'cursor': return path.join(game as string, ...CURSOR_SUBDIR);
      case 'tools': return this.toolsDir;
      default: throw new Error(t('Неизвестный root: {0}', root));
    }
  }

  // Both take an optional transaction: the operations that touch several files at once run
  // inside one (see FileTx), the odd single write does not need it.
  copyInto(src: string, destAbs: string, tx: Writer = null): void {
    copyInto(src, destAbs, tx);
  }

  writeInto(buf: string | NodeJS.ArrayBufferView, destAbs: string, tx: Writer = null): void {
    writeInto(buf, destAbs, tx);
  }

  // ---------- install ----------

  /** Install a catalog mod, and answer with the files it now owns. */
  async install({ categoryId, modName, fileRef }: { categoryId: string; modName: string; fileRef: string }): Promise<LibFile[]> {
    // Before the download, not after it. The folder check used to happen at the write, so a
    // mod with nowhere to go still cost the user a 300 MB download first and only then said
    // no. Tools are the exception: they live in the app's own folder and need no game.
    if (categoryId !== 'tools') this.requireGameFolder();
    const local = await this.download(categoryId, fileRef, modName);
    this.onProgress({ type: 'stage', label: modName, stage: t('установка') });
    // A mod is rarely one file, and everything below writes into somebody else's game
    // folder. One transaction around the lot: a failure on the fourth file takes the first
    // three with it, instead of leaving paks nothing in the library points at.
    return FileTx.run((tx) => this.installInto(tx, { categoryId, modName, local }), this.log);
  }

  // the writing: src/installer-write.ts
  installInto(...a: Rest<typeof write.installInto>) { return write.installInto(this, ...a); }
  installTool(...a: Rest<typeof write.installTool>) { return write.installTool(this, ...a); }

  // ---------- on, off, gone: src/installer-write.ts ----------

  setEnabled(...a: Rest<typeof write.setEnabled>) { return write.setEnabled(this, ...a); }
  remove(...a: Rest<typeof write.remove>) { return write.remove(this, ...a); }

  // ---------- fonts and cursors: src/overlays.ts ----------

  cursorStoreDir(recId: string) { return this.overlays.cursorStoreDir(recId); }
  ensureCursorStore(recId: string, files: LibFile[]) { return this.overlays.ensureCursorStore(recId, files); }
  deployCursor(recId: string, files: LibFile[]) { return this.overlays.deployCursor(recId, files); }
  undeployCursor(recId: string, files: LibFile[]) { return this.overlays.undeployCursor(recId, files); }
  cursorZip(rec: Pick<LibRecord, 'id' | 'name' | 'files'>) { return this.overlays.cursorZip(rec); }
  fontFolderHashes() { return this.overlays.fontFolderHashes(); }
  lostToVerify<R extends HasFiles>(records: R[]) { return this.overlays.lostToVerify(records); }
  restoreDeployed(rec: HasFiles & Pick<LibRecord, 'id' | 'name'>) { return this.overlays.restoreDeployed(rec); }

  // ---------- downloads: src/installer-downloads.ts ----------

  downloadIndex(...a: Rest<typeof downloads.downloadIndex>) { return downloads.downloadIndex(this, ...a); }
  rememberDownload(...a: Rest<typeof downloads.rememberDownload>) { return downloads.rememberDownload(this, ...a); }
  download(...a: Rest<typeof downloads.download>) { return downloads.download(this, ...a); }
  cachedArchive(...a: Rest<typeof downloads.cachedArchive>) { return downloads.cachedArchive(this, ...a); }
  downloadCacheSize(...a: Rest<typeof downloads.downloadCacheSize>) { return downloads.downloadCacheSize(this, ...a); }
  clearDownloadCache(...a: Rest<typeof downloads.clearDownloadCache>) { return downloads.clearDownloadCache(this, ...a); }

  // ---------- the load order: src/installer-slots.ts and src/slot-zones.ts ----------

  usedPakNames(...a: Rest<typeof slots.usedPakNames>) { return slots.usedPakNames(this, ...a); }
  allocatePak(...a: Rest<typeof slots.allocatePak>) { return slots.allocatePak(this, ...a); }
  planPakNames(...a: Rest<typeof slots.planPakNames>) { return slots.planPakNames(this, ...a); }
  slotBase(...a: Rest<typeof slots.slotBase>) { return slots.slotBase(this, ...a); }
  slotNumber(...a: Rest<typeof slots.slotNumber>) { return slots.slotNumber(this, ...a); }
  coverage(...a: Rest<typeof slots.coverage>) { return slots.coverage(this, ...a); }
  freeSlotBelow(...a: Rest<typeof slots.freeSlotBelow>) { return slots.freeSlotBelow(this, ...a); }
  moveToSlot(...a: Rest<typeof slots.moveToSlot>) { return slots.moveToSlot(this, ...a); }
  swapSlots(...a: Rest<typeof slots.swapSlots>) { return slots.swapSlots(this, ...a); }
  usedModSlots(...a: Rest<typeof slots.usedModSlots>) { return slots.usedModSlots(this, ...a); }
  migrateLegacyPriorityPaks(...a: Rest<typeof slots.migrateLegacyPriorityPaks>) { return slots.migrateLegacyPriorityPaks(this, ...a); }
  /** Which part of the load order a category's mods belong in. */
  zoneFor(categoryId: string) { return zones.zoneFor(categoryId); }
  /** Into the part of the load order its category belongs in. */
  moveToZone(rec: LibRecord) { return zones.moveToZone(this, rec); }
  /** The one-time layout of an order from before the two parts. */
  migrateSlotZones(library: Pick<Library, 'list' | 'update'>) { return zones.migrateSlotZones(this, library); }

  // ---------- combined packs: src/installer-packs.ts ----------

  packFolder(...a: Rest<typeof packs.packFolder>) { return packs.packFolder(this, ...a); }
  packMemberFile(...a: Rest<typeof packs.packMemberFile>) { return packs.packMemberFile(this, ...a); }
  addPackMemberFromRecord(...a: Rest<typeof packs.addPackMemberFromRecord>) { return packs.addPackMemberFromRecord(this, ...a); }
  removePackDeployed(...a: Rest<typeof packs.removePackDeployed>) { return packs.removePackDeployed(this, ...a); }
  packBase(...a: Rest<typeof packs.packBase>) { return packs.packBase(this, ...a); }
  deployPack(...a: Rest<typeof packs.deployPack>) { return packs.deployPack(this, ...a); }
  removePackFully(...a: Rest<typeof packs.removePackFully>) { return packs.removePackFully(this, ...a); }
  deployMemberAsMod(...a: Rest<typeof packs.deployMemberAsMod>) { return packs.deployMemberAsMod(this, ...a); }

  // ---------- what is installed: src/installer-repack.ts ----------

  describePaths(...a: Rest<typeof repack.describePaths>) { return repack.describePaths(this, ...a); }
  mergeToSingleVpk(...a: Rest<typeof repack.mergeToSingleVpk>) { return repack.mergeToSingleVpk(this, ...a); }
  unpackToFolder(...a: Rest<typeof repack.unpackToFolder>) { return repack.unpackToFolder(this, ...a); }
  displayNameForFile(...a: Rest<typeof repack.displayNameForFile>) { return repack.displayNameForFile(this, ...a); }
  harvestSchema(...a: Rest<typeof repack.harvestSchema>) { return repack.harvestSchema(this, ...a); }
  installedSize(...a: Rest<typeof repack.installedSize>) { return repack.installedSize(this, ...a); }
  analyzeRecord(...a: Rest<typeof repack.analyzeRecord>) { return repack.analyzeRecord(this, ...a); }
  splitVpkFile(...a: Rest<typeof repack.splitVpkFile>) { return repack.splitVpkFile(this, ...a); }
  mergeMultiPartRecords(...a: Rest<typeof repack.mergeMultiPartRecords>) { return repack.mergeMultiPartRecords(this, ...a); }

  // ---------- the folder as a whole: src/installer-folder.ts ----------

  isTogglableModFile(...a: Rest<typeof folder.isTogglableModFile>) { return folder.isTogglableModFile(this, ...a); }
  masterIsOff(...a: Rest<typeof folder.masterIsOff>) { return folder.masterIsOff(this, ...a); }
  setMasterEnabled(...a: Rest<typeof folder.setMasterEnabled>) { return folder.setMasterEnabled(this, ...a); }
  writeOwnership(...a: Rest<typeof folder.writeOwnership>) { return folder.writeOwnership(this, ...a); }
  ownsFile(...a: Rest<typeof folder.ownsFile>) { return folder.ownsFile(this, ...a); }
  sweepStaged(...a: Rest<typeof folder.sweepStaged>) { return folder.sweepStaged(this, ...a); }
  langPrimaryPresent(...a: Rest<typeof folder.langPrimaryPresent>) { return folder.langPrimaryPresent(this, ...a); }
  vpkItem(...a: Rest<typeof folder.vpkItem>) { return folder.vpkItem(this, ...a); }
  siblingParts(...a: Rest<typeof folder.siblingParts>) { return folder.siblingParts(this, ...a); }
  externalFiles(...a: Rest<typeof folder.externalFiles>) { return folder.externalFiles(this, ...a); }
}
