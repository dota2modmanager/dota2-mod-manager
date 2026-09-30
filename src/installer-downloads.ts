// Getting a catalog mod onto this machine: where its archive lives, what it is called on disk,
// and the cache of what was downloaded and what each file hashed to. Behind src/installer.ts.
import fs from 'node:fs';
import path from 'node:path';
import { RAW_BASE } from './catalog.ts';
import { downloadFile } from './net.ts';
import { t } from './i18n.ts';
import { folderSize } from './folder-size.ts';
import type { Installer } from './installer.ts';

/** What a downloaded archive was when it arrived: its size and hash, and when. */
export type DownloadEntry = { size: number; sha256: string; at: number };

/** Where a catalog file is fetched from: its own URL, or the catalog's files folder. */
export function fileUrl(categoryId: string, fileRef: string): string {
  if (/^https?:\/\//i.test(fileRef)) return fileRef;
  return `${RAW_BASE}/assets/files/${categoryId}/${encodeURIComponent(fileRef)}`;
}

/* A name from the catalog is a name, never a path.
 *
 * What a mod is called on disk used to be decodeURIComponent(last segment of the URL), and
 * a catalog entry pointing at ".../..%2F..%2F..%2Fsomething" decoded straight back into
 * "../../../something" - a file the app then wrote wherever that landed. Slashes cannot
 * survive this, so nothing here can climb out of the folder it was given.
 *
 * Spaces, brackets and Cyrillic are left alone on purpose: real catalog files are called
 * things like "Red Abaddon (v2).zip", they are the keys of the download cache, and
 * scrubbing them would re-download every mod on disk to no benefit.
 */
export function safeFileName(raw: unknown, fallback: string): string {
  const flat = String(raw || '').replace(/\\/g, '/');
  const last = flat.slice(flat.lastIndexOf('/') + 1);
  const cleaned = [...last]
    .filter((ch) => ch >= ' ' && !'<>:"|?*'.includes(ch)) // what Windows refuses in a name
    .join('')
    .slice(0, 150);
  return /^\.*$/.test(cleaned) ? fallback : cleaned; // "", "." and ".." are not names
}

// What each downloaded archive hashed to, so a cached copy can be trusted and a mirror
// cannot hand over a different file under the same name.
export function downloadIndex(inst: Installer): Record<string, DownloadEntry> {
  try { return JSON.parse(fs.readFileSync(path.join(inst.downloadsDir, 'index.json'), 'utf-8')); } catch { return {}; }
}

export function rememberDownload(inst: Installer, key: string, entry: DownloadEntry): void {
  const index = inst.downloadIndex();
  index[key] = entry;
  try { fs.writeFileSync(path.join(inst.downloadsDir, 'index.json'), JSON.stringify(index, null, 2)); } catch { /* the cache still works without it */ }
}

/** The archive of a catalog mod on disk: from the cache when it is still what arrived, downloaded otherwise. */
export async function download(inst: Installer, categoryId: string, fileRef: string, label?: string | null): Promise<string> {
  const url = fileUrl(categoryId, fileRef);
  // the last URL segment without its query, decoded, and then made into a plain name
  const tail = url.split(/[?#]/)[0].split('/').pop() ?? '';
  let decoded = tail;
  try { decoded = decodeURIComponent(tail); } catch { /* a stray % is not an escape */ }
  const safeName = safeFileName(decoded, 'mod');
  const destDir = path.join(inst.downloadsDir, safeFileName(categoryId, 'other'));
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, safeName);
  const key = `${categoryId}/${safeName}`;
  const known = inst.downloadIndex()[key] || null;
  // The catalog's own answer, keyed by the name upstream uses rather than the one this
  // machine is allowed to write: safeFileName can rewrite a character that a filesystem
  // dislikes, and the published list knows nothing about that.
  const published = inst.publishedHash(categoryId, decoded);

  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    // A cached file is reused on its name alone, so a copy that was cut short by a crash
    // or a full disk would be installed forever after. Its size is checked against what
    // was recorded when it arrived; hashing 300 MB on every install is not worth it, and
    // a truncated file is what actually happens.
    // A cached copy that the catalog now disagrees with is not a cached copy worth having.
    // This costs no hashing: what it arrived as was written down when it arrived.
    const disowned = published && known && known.sha256 && known.sha256 !== published;
    if (!disowned && (!known || known.size === fs.statSync(dest).size)) return dest;
    inst.onProgress({ type: 'stage', label: label || safeName, stage: t('перекачиваю повреждённый файл') });
    fs.rmSync(dest, { force: true });
  }

  try {
    const res = await downloadFile(url, dest, {
      // the catalog's published hash when it has one, and otherwise what this file was the
      // first time it arrived here
      expectSha256: published || (known ? known.sha256 : null),
      /* Neither of those is a hash this project pinned. One is a list somebody else's bot
         rebuilds, the other is a note about a file this machine saw weeks ago, and both go
         out of date the moment a mod's author replaces the archive. So they outrank every
         proxy and nothing else: see downloadFile. */
      fromPublishedList: true,
      onProgress: (loaded, total) => inst.onProgress({ type: 'download', label: label || safeName, loaded, total }),
    });
    inst.rememberDownload(key, { size: res.bytes, sha256: res.sha256, at: Date.now() });
    return dest;
  } catch (err) {
    /* "checksum mismatch for Earthshaker Arcana.zip" is a sentence for whoever wrote the
       downloader. What it means to the player is that every copy of this mod he can reach
       is not the mod the catalog describes, and that this is not something he did or can
       fix from here. Said in his own language, with the technical half kept for the
       diagnostics report. */
    if ((err as { checksum?: boolean }).checksum) throw new Error(t('{0}: скачанный файл не совпадает с тем, что опубликовал автор мода. Попробуй позже', safeName));
    throw new Error(t('Не удалось скачать {0}: {1}', safeName, String((err as Error)?.message || err)));
  }
}

/** The archive this mod was installed from, if it is still in the download cache. */
export function cachedArchive(inst: Installer, categoryId: string | null, fileRef: string | null | undefined): string | null {
  if (!categoryId || !fileRef) return null;
  try {
    const name = decodeURIComponent(fileUrl(categoryId, fileRef).split('/').pop() ?? '');
    const p = path.join(inst.downloadsDir, categoryId, name);
    return fs.existsSync(p) && fs.statSync(p).size > 0 ? p : null;
  } catch {
    return null;
  }
}

/** Bytes the download cache holds. */
export function downloadCacheSize(inst: Installer): number {
  return folderSize(inst.downloadsDir);
}

/** Empty the download cache, keeping the folder. */
export function clearDownloadCache(inst: Installer): void {
  fs.rmSync(inst.downloadsDir, { recursive: true, force: true });
  fs.mkdirSync(inst.downloadsDir, { recursive: true });
}
