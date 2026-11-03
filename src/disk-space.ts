// Room on the disk, checked before a mod is written (issue #426). A disk that fills up halfway
// through a pak leaves the transaction to roll back and the user with an error about a file
// they never heard of; asking first costs one statfs and says what is wrong in megabytes.
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.ts';

/** Kept free on top of what the write needs: the journal's copies and the OS's own work. */
export const SPACE_MARGIN = 64 * 1024 * 1024;

type StatFs = (p: string) => { bavail: number | bigint; bsize: number | bigint };

/**
 * Free bytes on the drive that holds dir, or null when the system will not say.
 * dir may not exist yet (a language folder made on first install), so the nearest folder
 * above it that does is asked instead.
 */
export function freeBytes(dir: string, statfs: StatFs = fs.statfsSync): number | null {
  let at = path.resolve(dir);
  for (;;) {
    try {
      const st = statfs(at);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      const up = path.dirname(at);
      if (up === at) return null;
      at = up;
    }
  }
}

/**
 * Throw before writing when dir's drive has less than need bytes plus the margin.
 * A drive that cannot be asked is let through: refusing every install on a system without
 * statfs would be worse than the error this is here to prevent.
 */
export function ensureSpace(dir: string, need: number, statfs: StatFs = fs.statfsSync): void {
  const free = freeBytes(dir, statfs);
  if (free === null) return;
  const short = need + SPACE_MARGIN - free;
  if (short > 0) {
    const mb = Math.max(1, Math.ceil(short / (1024 * 1024)));
    throw new Error(t('Не хватает места на диске: освободи ещё {0} МБ', mb));
  }
}
