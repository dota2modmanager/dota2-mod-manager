/* Cursor sets (src/overlays.ts is the door for fonts and cursors).
 *
 * A cursor set is not a pak: it is loose files written straight over Valve's own in
 * game\dota\resource\cursor, and every set overwrites the same names. So it cannot be
 * switched off by renaming (nothing would be left to draw the cursor) and two sets
 * cannot be on at once. Instead each installed set keeps its own copy here, and
 * on/off means: write those files over the vanilla ones, or put the vanilla ones back.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { copyInto } from './file-tx.ts';
import { t } from './i18n.ts';
import type { Overlays } from './overlays.ts';
import type { LibFile, LibRecord } from './types.ts';

// the same hash src/overlays.ts records every write by
const sha1 = (buf: Buffer) => crypto.createHash('sha1').update(buf).digest('hex');

/** Where a cursor set keeps its own copy, by record id. */
export function cursorStoreDir(o: Overlays, recId: string): string {
  return path.join(o.cursorsDir, String(recId).replace(/[^A-Za-z0-9_-]/g, ''));
}

/** The cursor files among a record's files. */
export function cursorFiles(files: LibFile[] | null | undefined): LibFile[] {
  return (files || []).filter((f) => f.root === 'cursor');
}

// Keep a copy of the set that is live right now. Only ever call this for the record that
// actually owns what is on disk (the one being installed, adopted, or switched off) -
// otherwise the copy would be some other mod's cursor.
export function ensureCursorStore(o: Overlays, recId: string | null | undefined, files: LibFile[] | null | undefined): boolean {
  const own = o.cursorFiles(files);
  if (!recId || !own.length) return false;
  const store = o.cursorStoreDir(recId);
  try {
    if (fs.existsSync(store) && fs.readdirSync(store).length) return true; // already stashed
  } catch { /* unreadable - restash */ }
  const live = o.liveDir('cursor');
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
export function deployCursor(o: Overlays, recId: string, files: LibFile[] | null | undefined): number {
  const store = o.cursorStoreDir(recId);
  const live = o.liveDir('cursor');
  const backupRoot = path.join(o.backupsDir, 'cursor');
  const hashes: [string, string][] = [];
  for (const f of o.cursorFiles(files)) {
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
  o.noteWritten('cursor', hashes);
  return hashes.length;
}

// put the vanilla cursor back (or drop the file, if the set added one Valve has no copy of)
export function undeployCursor(o: Overlays, recId: string, files: LibFile[] | null | undefined): void {
  o.ensureCursorStore(recId, files);
  const live = o.liveDir('cursor');
  const backupRoot = path.join(o.backupsDir, 'cursor');
  for (const f of o.cursorFiles(files)) {
    const dest = path.join(live, f.relPath);
    const backup = path.join(backupRoot, f.relPath);
    if (fs.existsSync(backup)) copyInto(backup, dest);
    else if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  }
  o.forgetWritten(files);
}

// Pack the set back into the layout the catalog ships cursors in (<Name>/cursor/<file>),
// so it can be handed to someone else or kept as a backup.
export function cursorZip(o: Overlays, rec: Pick<LibRecord, 'id' | 'name' | 'files'>): Buffer {
  const store = o.cursorStoreDir(rec.id);
  const live = o.liveDir('cursor');
  const folder = (rec.name || 'cursor').replace(/[<>:"/\\|?*]/g, '_');
  const zip = new AdmZip();
  let n = 0;
  for (const f of o.cursorFiles(rec.files)) {
    const src = [path.join(store, f.relPath), path.join(live, f.relPath)].find((p) => fs.existsSync(p));
    if (!src) continue;
    zip.addFile(`${folder}/cursor/${f.relPath}`, fs.readFileSync(src));
    n++;
  }
  if (!n) throw new Error(t('Файлы курсора не сохранены — переустанови мод'));
  return zip.toBuffer();
}

export function dropCursorStore(o: Overlays, recId: string | null | undefined): void {
  if (!recId) return;
  try { fs.rmSync(o.cursorStoreDir(recId), { recursive: true, force: true }); } catch { /* ignore */ }
}
