/* How many times each catalog mod was downloaded (src/download-stats.ts counts them), for the
 * number on a card and the "most popular first" sort.
 *
 * Asked once when a card first wants a number, and again after an install so the user's own
 * shows. Until the answer comes, and whenever the counter cannot be reached, every mod has no
 * number and the card shows none: a missing count is never a zero on screen. Cards follow the
 * answer through onDownloadCounts (catalog/card/hooks.ts), the way they follow the terrain mark,
 * so it lands in place instead of redrawing the grid.
 */
import type { Mod } from '../catalog/types.ts';

let counts: Record<string, number> | null = null;
/* per mod, its looks added up: the catalog's site counts a mod with looks under
   category/group/name/Look, and the plain key holds only this app's hits, sent per look as well */
const looks = new WeakMap<Record<string, number>, Map<string, number>>();
let asking = false;
const listeners = new Set<() => void>();

/** A card follows the counts through here. */
export function onDownloadCounts(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function ask(): void {
  if (asking) return;
  asking = true;
  window.api.catalog.downloadCounts()
    .then((r) => { if (r && typeof r === 'object') counts = r; })
    .catch(() => {})
    .finally(() => {
      asking = false;
      for (const fn of listeners) fn();
    });
}

/** Ask again, after an install: main adds this run's installs to what the counter said. */
export function refreshDownloadCounts(): void {
  ask();
}

/** The counter's key for a mod, as the catalog site writes it: category/group/name. */
export const countKey = (categoryId: string, m: Pick<Mod, 'name' | '_groupId'>): string =>
  [categoryId, m._groupId, m.name].filter(Boolean).join('/');

/** A key's count, its looks together where they are more: the plain key alone said 12 for a
 *  Tidehunter Arcana whose look had 778. */
export function totalOf(all: Record<string, number>, key: string): number {
  let sums = looks.get(all);
  if (!sums) {
    sums = new Map();
    for (const [k, n] of Object.entries(all)) {
      const at = k.lastIndexOf('/');
      if (at > 0 && typeof n === 'number') sums.set(k.slice(0, at), (sums.get(k.slice(0, at)) ?? 0) + n);
    }
    looks.set(all, sums);
  }
  return Math.max(Number(all[key]) || 0, sums.get(key) ?? 0);
}

/** Downloads of this mod, all its looks together; 0 when nobody can say (asked here, once). */
export function downloadsOf(categoryId: string, m: Pick<Mod, 'name' | '_groupId'> | null | undefined): number {
  if (!m || !m.name || !categoryId) return 0;
  if (!counts) { ask(); return 0; }
  return totalOf(counts, countKey(categoryId, m));
}

/** 950 → "950", 1234 → "1.2k", 15600 → "15k", 2 500 000 → "2.5M": the site's way of writing it. */
export function formatCount(n: number): string {
  if (n < 1e3) return String(n);
  if (n < 1e4) return `${Math.floor(n / 100) / 10}k`;
  if (n < 1e6) return `${Math.floor(n / 1e3)}k`;
  if (n < 1e7) return `${Math.floor(n / 1e5) / 10}M`;
  return `${Math.floor(n / 1e6)}M`;
}
