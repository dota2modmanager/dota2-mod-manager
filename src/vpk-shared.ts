/* One VPK index opened once for a burst of reads: the game's pak01, which the item builder reads
 * for every pick and for its sounds and portraits. src/vpk-read.ts is what opens it. */
import fs from 'node:fs';
import { openVpkIndex, type VpkIndex } from './vpk-read.ts';

/** how long a shared index outlives its last use: a burst of picks in the item builder reuses it */
const SHARED_IDLE_MS = 30_000;
let shared: { key: string; index: VpkIndex; timer: ReturnType<typeof setTimeout> | null } | null = null;

/**
 * openVpkIndex, opened once for everything that reads the same file in a row.
 *
 * Every pick of the item builder reads its models out of the game's pak01, and so do its sounds
 * and portraits: four opens of a 388 000-entry index per pick, 270 ms each, and a table of thirty
 * picks spent four of its twelve seconds on them. The index is ~130 MB in memory, too much to keep
 * for good, so it goes 30 seconds after it was last asked for. A changed file (size, time or
 * file id) is opened anew.
 */
export function sharedVpkIndex(dirPath: string): VpkIndex {
  const st = fs.statSync(dirPath);
  const key = `${dirPath}|${st.size}|${st.mtimeMs}|${st.ino}`;
  if (shared?.key !== key) {
    if (shared?.timer) clearTimeout(shared.timer);
    shared = { key, index: openVpkIndex(dirPath), timer: null };
  }
  const held = shared;
  if (held.timer) clearTimeout(held.timer);
  held.timer = setTimeout(() => { if (shared === held) shared = null; }, SHARED_IDLE_MS);
  held.timer.unref?.();
  return held.index;
}
