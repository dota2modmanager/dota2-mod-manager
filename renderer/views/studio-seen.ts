/* Which Workshop tiles still say "New" (views/studio.ts).
 *
 * Every tool the Workshop gathers arrived after 2.21.0, the last release before 3.0, so on the first
 * start of 3.0 all of them are news to the person in front of it. A tile stops saying so once it
 * has been opened, and the tab stops showing its dot once none is left. Kept per machine, in the
 * window's own storage: a lost list only means the badges come back once. */
const KEY = 'studioSeen';
/** The tiles that are not news: what the app could do before the Workshop existed. */
const OLD = new Set(['builder', 'import']);

const storage = (): Storage | null => { try { return localStorage; } catch { return null; } };

function seen(): Set<string> {
  try { return new Set(JSON.parse(storage()?.getItem(KEY) || '[]') as string[]); } catch { return new Set(); }
}

/** The ids every tile carries, so the tab knows how many are left without drawing the screen. */
const ALL = ['paint', 'sounds', 'towers', 'trees', 'decor', 'background', 'hud', 'rank', 'grids', 'creator', 'ai'];

export const isNew = (id: string): boolean => !OLD.has(id) && !id.startsWith('arcana:') && !seen().has(id);

export function markSeen(id: string): void {
  const s = seen();
  if (s.has(id)) return;
  s.add(id);
  try { storage()?.setItem(KEY, JSON.stringify([...s])); } catch { /* the badge comes back, nothing else */ }
}

/** How many Workshop tools have not been opened yet on this machine (Home says so). */
export const newCount = (): number => ALL.filter(isNew).length;

/** The dot on the Workshop tab, while any tile is still new. */
export function paintStudioDot(): void {
  const dot = document.getElementById('studioNew');
  if (dot) dot.hidden = ALL.every((id) => !isNew(id));
}
