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
 * Moved out of src/installer.ts on 2026-09-17; test/installer.test.ts and test/cursors.test.ts
 * cover it through the installer.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openZip, safeJoin } from './safe-zip.ts';
import { copyInto, writeInto, type Writer } from './file-tx.ts';
import { t } from './i18n.ts';
import * as cursor from './overlays-cursor.ts';
import type { HasFiles, LibFile, LibRecord } from './types.ts';

/** The two game folders loose files go into. */
type Root = 'fonts' | 'cursor';

/** What a function over the overlays takes, without the overlays: the method's parameters. */
type Rest<F> = F extends (o: Overlays, ...rest: infer R) => unknown ? R : never;

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
  cachedArchive: (categoryId: string | null, fileRef: string | null | undefined) => string | null;

  /**
   * @param opts.backupsDir   the game's own copies, under fonts\ and cursor\
   * @param opts.cursorsDir   one copy of each installed cursor set, by record id
   */
  constructor({ getGamePath, backupsDir, cursorsDir, cachedArchive }: {
    getGamePath: () => string | null; backupsDir: string; cursorsDir: string;
    cachedArchive: (categoryId: string | null, fileRef: string | null | undefined) => string | null;
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

  // ---------- cursor sets: src/overlays-cursor.ts ----------

  cursorStoreDir(...a: Rest<typeof cursor.cursorStoreDir>) { return cursor.cursorStoreDir(this, ...a); }
  cursorFiles(files: LibFile[] | null | undefined) { return cursor.cursorFiles(files); }
  ensureCursorStore(...a: Rest<typeof cursor.ensureCursorStore>) { return cursor.ensureCursorStore(this, ...a); }
  deployCursor(...a: Rest<typeof cursor.deployCursor>) { return cursor.deployCursor(this, ...a); }
  undeployCursor(...a: Rest<typeof cursor.undeployCursor>) { return cursor.undeployCursor(this, ...a); }
  cursorZip(...a: Rest<typeof cursor.cursorZip>) { return cursor.cursorZip(this, ...a); }
  dropCursorStore(...a: Rest<typeof cursor.dropCursorStore>) { return cursor.dropCursorStore(this, ...a); }

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
  lostToVerify<R extends HasFiles>(records: R[] | null | undefined): R[] {
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
  restoreDeployed(rec: HasFiles & Pick<LibRecord, 'id' | 'name'>): 'store' | 'cache' | null {
    const isCursor = (rec.files || []).some((f) => f.root === 'cursor');
    if (isCursor && this.cursorFiles(rec.files).length && fs.existsSync(this.cursorStoreDir(rec.id))) {
      this.deployCursor(rec.id, rec.files);
      return 'store';
    }
    const local = this.cachedArchive(rec.categoryId ?? null, rec.fileRef);
    if (!local) return null;
    if (isCursor) this.installCursor(local, rec.name);
    else this.installFonts(local, rec.name);
    return 'cache';
  }
}

