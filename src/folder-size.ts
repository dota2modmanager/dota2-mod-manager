/* Bytes under a folder: the number Settings shows beside each cache, and the one the removal
 * window shows beside the app's data.
 *
 * Four modules walked a folder for this, each its own way, until 2026-10-01. One of them crashed on
 * a file that disappeared between the listing and the stat, which a cache being cleared at the
 * same moment makes likely. This one counts what it can read and skips what it cannot.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Bytes under a folder, however deep. A folder that is not there holds nothing. */
export function folderSize(dir: string): number {
  let bytes = 0;
  const walk = (at: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(at, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(at, e.name);
      if (e.isDirectory()) walk(full);
      else { try { bytes += fs.statSync(full).size; } catch { /* gone between the listing and the look */ } }
    }
  };
  walk(dir);
  return bytes;
}
