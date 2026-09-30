/* Fonts and cursors: loose files written over the game's own.
 *
 * A mod in the language folder is a file Valve does not ship, so taking it out means deleting
 * it. A font or a cursor set is different. It replaces files in dota\panorama\fonts and
 * dota\resource\cursor that the game needs, so the first write keeps the game's copy under
 * backups\, and removing the mod puts that copy back. Steam's "Verify integrity of game files"
 * puts those copies back too, without telling anyone, so this module also works out which
 * installed mods a verify undid, and redeploys them.
 *
 * That check used to compare the file on disk with the kept original. Some mods ship a few of
 * Valve's files unchanged: Nothing Font does, byte for byte, and one real install's cursor set
 * matched its backup in 66 of 110 files. Such a mod looked undone the moment it went in, and the
 * app wrote it out again at every start: 29 times between 2 and 21 August on that install. The
 * same repair then found the mod's own extra files on disk, kept them as the game's originals,
 * and a later removal put them back. So every write here is recorded by hash in
 * backups\written.json, and a file that holds what this app wrote is this app's file, whatever
 * else it happens to match.
 *
 * Moved out of src/installer.js on 2026-09-17; test/installer.test.js and test/cursors.test.ts
 * cover it through the installer.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { openZip, safeJoin } from './safe-zip.ts';
import { copyInto, writeInto, type Writer } from './file-tx.ts';
import { t } from './i18n.ts';
import type { LibFile, LibRecord } from './types.ts';

/** The two game folders loose files go into. */
type Root = 'fonts' | 'cursor';

/** Where font mods go, under the game folder. */
export const FONTS_SUBDIR: readonly string[] = ['dota', 'panorama', 'fonts'];
/** Where cursor sets go, under the game folder. */
export const CURSOR_SUBDIR: readonly string[] = ['dota', 'resource', 'cursor'];
const WRITTEN = 'written.json';

const sha1 = (buf: Buffer) => crypto.createHash('sha1').update(buf).digest('hex');
// Windows compares names without case, and a font mod names Radiance-Light.otf what Valve ships
// as radiance-light.otf
const writtenKey = (root: string, relPath: string) => `${root}/${String(relPath).replace(/\\/g, '/').toLowerCase()}`;

/** The font and cursor files of one install: writing them, keeping the originals, putting them back. */
export class Overlays {
  getGamePath: () => string | null;
  backupsDir: string;
  cursorsDir: string;
  cachedArchive: (categoryId: string, fileRef: string | null | undefined) => string | null;

  /**
   * @param opts.backupsDir   the game's own copies, under fonts\ and cursor\
   * @param opts.cursorsDir   one copy of each installed cursor set, by record id
   */
  constructor({ getGamePath, backupsDir, cursorsDir, cachedArchive }: {
    getGamePath: () => string | null; backupsDir: string; cursorsDir: string;
    cachedArchive: (categoryId: string, fileRef: string | null | undefined) => string | null;
  }) {
    this.getGamePath = getGamePath;
    this.backupsDir = backupsDir;
    this.cursorsDir = cursorsDir;
    this.cachedArchive = cachedArchive;
  }

  liveDir(root: Root): string {
    const game = this.getGamePath();
    if (!game) throw new Error(t('Путь к Dota 2 не задан'));
    return path.join(game, ...(root === 'fonts' ? FONTS_SUBDIR : CURSOR_SUBDIR));
  }

  // ---------- what this app wrote ----------

  /** sha1 of the last write, by "root/relpath" */
  written(): Record<string, string> {
    try { return JSON.parse(fs.readFileSync(path.join(this.backupsDir, WRITTEN), 'utf-8')); } catch { return {}; }
  }

  /**
   * @param entries  relPath and the sha1 written there; null forgets it
   */
  noteWritten(root: string, entries: [string, string | null][]): void {
    if (!entries.length) return;
    const map = this.written();
    for (const [relPath, hash] of entries) {
      if (hash) map[writtenKey(root, relPath)] = hash;
      else delete map[writtenKey(root, relPath)];
    }
    try {
      fs.mkdirSync(this.backupsDir, { recursive: true });
      fs.writeFileSync(path.join(this.backupsDir, WRITTEN), JSON.stringify(map, null, 1));
    } catch { /* without the record the verify check falls back to comparing with the backup */ }
  }

  /** Forget the writes behind these file records, once their files are gone or Valve's again. */
  forgetWritten(files: LibFile[] | null | undefined): void {
    for (const root of ['fonts', 'cursor']) {
      this.noteWritten(root, (files || []).filter((f) => f.root === root).map((f): [string, null] => [f.relPath, null]));
    }
  }

  /**
   * Keep the game's copy of a file before the first write over it. A file that holds what this
   * app wrote there earlier is not the game's: a reinstall, and the repair after a verify, meet
   * their own write and used to keep it as the original.
   */
  keepOriginal(destAbs: string, backupAbs: string, mine: string | undefined): void {
    if (!fs.existsSync(destAbs) || fs.existsSync(backupAbs)) return;
    if (mine && sha1(fs.readFileSync(destAbs)) === mine) return;
    copyInto(destAbs, backupAbs);
  }

  // ---------- installing ----------

  /**
   * The files of one archive that match `pattern`, written over the game's folder for `root`.
   */
  installLoose(root: Root, localZip: string | Buffer, modName: string, pattern: RegExp, tx: Writer): LibFile[] {
    const target = this.liveDir(root);
    fs.mkdirSync(target, { recursive: true });
    const archive = openZip(localZip, { label: modName });
    const backupRoot = path.join(this.backupsDir, root);
    const before = this.written();
    const records: LibFile[] = [];
    const hashes: [string, string][] = [];
    for (const file of archive.files) {
      const m = file.path.match(pattern);
      if (!m) continue;
      const relPath = m[1];
      const destAbs = safeJoin(target, relPath);
      const data = file.read();
      this.keepOriginal(destAbs, safeJoin(backupRoot, relPath), before[writtenKey(root, relPath)]);
      writeInto(data, destAbs, tx);
      records.push({ root, relPath });
      hashes.push([relPath, sha1(data)]);
    }
    this.noteWritten(root, hashes);
    return records;
  }

  // A font archive has <Name>/assets/custom (the mod) and <Name>/assets/default (Valve's files).
  // The custom files go to game\dota\panorama\fonts.
  installFonts(localZip: string | Buffer, modName: string, tx: Writer = null): LibFile[] {
    const records = this.installLoose('fonts', localZip, modName, /assets\/custom\/(.+)$/i, tx);
    if (!records.length) throw new Error(t('{0}: в архиве не найдено assets/custom', modName));
    return records;
  }

  // A cursor archive has <Name>/cursor/*, which goes to game\dota\resource\cursor.
  installCursor(localZip: string | Buffer, modName: string, tx: Writer = null): LibFile[] {
    const records = this.installLoose('cursor', localZip, modName, /(?:^|\/)cursor\/(.+)$/i, tx);
    if (!records.length) throw new Error(t('{0}: в архиве не найдена папка cursor', modName));
    return records;
  }

  // ---------- cursor sets ----------

  /*
   * A cursor set is not a pak: it is loose files written straight over Valve's own in
   * game\dota\resource\cursor, and every set overwrites the same names. So it cannot be
   * switched off by renaming (nothing would be left to draw the cursor) and two sets
   * cannot be on at once. Instead each installed set keeps its own copy here, and
   * on/off means: write those files over the vanilla ones, or put the vanilla ones back.
   */

  cursorStoreDir(recId: string): string {
    return path.join(this.cursorsDir, String(recId).replace(/[^A-Za-z0-9_-]/g, ''));
  }

  cursorFiles(files: LibFile[] | null | undefined): LibFile[] {
    return (files || []).filter((f) => f.root === 'cursor');
  }

  // Keep a copy of the set that is live right now. Only ever call this for the record that
  // actually owns what is on disk (the one being installed, adopted, or switched off) -
  // otherwise the copy would be some other mod's cursor.
  ensureCursorStore(recId: string | null | undefined, files: LibFile[] | null | undefined): boolean {
    const own = this.cursorFiles(files);
    if (!recId || !own.length) return false;
    const store = this.cursorStoreDir(recId);
    try {
      if (fs.existsSync(store) && fs.readdirSync(store).length) return true; // already stashed
    } catch { /* unreadable - restash */ }
    const live = this.liveDir('cursor');
    let n = 0;
    for (const f of own) {
      const src = path.join(live, f.relPath);
      if (!fs.existsSync(src)) continue;
      copyInto(src, path.join(store, f.relPath));
      n++;
    }
    return n > 0;
  }

  // write the set over the game's cursor folder (vanilla files backed up once)
  deployCursor(recId: string, files: LibFile[] | null | undefined): number {
    const store = this.cursorStoreDir(recId);
    const live = this.liveDir('cursor');
    const backupRoot = path.join(this.backupsDir, 'cursor');
    const hashes: [string, string][] = [];
    for (const f of this.cursorFiles(files)) {
      const src = path.join(store, f.relPath);
      if (!fs.existsSync(src)) continue;
      const bytes = fs.readFileSync(src);
      hashes.push([f.relPath, sha1(bytes)]);
      const dest = path.join(live, f.relPath);
      // already ours (a re-deploy after a restart): backing it up now would record the mod
      // itself as the vanilla file and there would be nothing left to switch back to
      if (fs.existsSync(dest) && fs.readFileSync(dest).equals(bytes)) continue;
      const backup = path.join(backupRoot, f.relPath);
      if (fs.existsSync(dest) && !fs.existsSync(backup)) copyInto(dest, backup);
      copyInto(src, dest);
    }
    if (!hashes.length) throw new Error(t('Файлы курсора не сохранены — переустанови мод'));
    this.noteWritten('cursor', hashes);
    return hashes.length;
  }

  // put the vanilla cursor back (or drop the file, if the set added one Valve has no copy of)
  undeployCursor(recId: string, files: LibFile[] | null | undefined): void {
    this.ensureCursorStore(recId, files);
    const live = this.liveDir('cursor');
    const backupRoot = path.join(this.backupsDir, 'cursor');
    for (const f of this.cursorFiles(files)) {
      const dest = path.join(live, f.relPath);
      const backup = path.join(backupRoot, f.relPath);
      if (fs.existsSync(backup)) copyInto(backup, dest);
      else if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
    }
    this.forgetWritten(files);
  }

  // Pack the set back into the layout the catalog ships cursors in (<Name>/cursor/<file>),
  // so it can be handed to someone else or kept as a backup.
  cursorZip(rec: Pick<LibRecord, 'id' | 'name' | 'files'>): Buffer {
    const store = this.cursorStoreDir(rec.id);
    const live = this.liveDir('cursor');
    const folder = (rec.name || 'cursor').replace(/[<>:"/\\|?*]/g, '_');
    const zip = new AdmZip();
    let n = 0;
    for (const f of this.cursorFiles(rec.files)) {
      const src = [path.join(store, f.relPath), path.join(live, f.relPath)].find((p) => fs.existsSync(p));
      if (!src) continue;
      zip.addFile(`${folder}/cursor/${f.relPath}`, fs.readFileSync(src));
      n++;
    }
    if (!n) throw new Error(t('Файлы курсора не сохранены — переустанови мод'));
    return zip.toBuffer();
  }

  dropCursorStore(recId: string | null | undefined): void {
    if (!recId) return;
    try { fs.rmSync(this.cursorStoreDir(recId), { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // basename -> sha1 of every file currently in panorama\fonts, for font subset matching
  fontFolderHashes(): Record<string, string> | null {
    const game = this.getGamePath();
    if (!game) return null;
    const dir = this.liveDir('fonts');
    if (!fs.existsSync(dir)) return null;
    const out: Record<string, string> = {};
    // the entry's type comes with the listing, so nothing is looked at twice (CodeQL
    // js/file-system-race flagged a stat followed by a read of the same path)
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) out[e.name.toLowerCase()] = sha1(fs.readFileSync(full));
      }
    };
    walk(dir);
    return out;
  }

  // ---------- after Steam's file check ----------

  /**
   * Did the game take this file back? A file that is gone did. A file with no kept original is
   * one Valve does not ship, and a verify leaves those alone. Otherwise the game's copy is back
   * when the file matches the kept original, and is not what this app last wrote there.
   */
  vanillaIsBack(f: LibFile, written: Record<string, string> = this.written()): boolean {
    if (f.root !== 'fonts' && f.root !== 'cursor') return false;
    const deployed = path.join(this.liveDir(f.root), f.relPath);
    if (!fs.existsSync(deployed)) return true;
    const backup = path.join(this.backupsDir, f.root, f.relPath);
    if (!fs.existsSync(backup)) return false;
    try {
      const now = fs.readFileSync(deployed);
      const mine = written[writtenKey(f.root, f.relPath)];
      if (mine && sha1(now) === mine) return false;
      return now.equals(fs.readFileSync(backup));
    } catch {
      return false;
    }
  }

  /** Installed records whose files the game has taken back. */
  lostToVerify(records: LibRecord[] | null | undefined): LibRecord[] {
    if (!this.getGamePath()) return [];
    const written = this.written();
    return (records || []).filter((rec) => rec.enabled !== false
      && (rec.files || []).some((f) => this.vanillaIsBack(f, written)));
  }

  /**
   * Put one back without asking. A cursor set is kept in userData, so it goes straight back;
   * a font has to come from the archive it arrived in, and if the download cache has been
   * cleared there is nothing here to restore from - that one needs the network, which is
   * not something to start behind the user's back at launch.
   * @returns where it came from, or null if it could not be done
   */
  restoreDeployed(rec: LibRecord): 'store' | 'cache' | null {
    const isCursor = (rec.files || []).some((f) => f.root === 'cursor');
    if (isCursor && this.cursorFiles(rec.files).length && fs.existsSync(this.cursorStoreDir(rec.id))) {
      this.deployCursor(rec.id, rec.files);
      return 'store';
    }
    const local = this.cachedArchive(rec.categoryId, rec.fileRef);
    if (!local) return null;
    if (isCursor) this.installCursor(local, rec.name);
    else this.installFonts(local, rec.name);
    return 'cache';
  }
}

