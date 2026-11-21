/* The community presets' rules, out of the screen: which cards a search leaves, the order each sort
 * puts them in, and what a vote does to the counts before the index catches up with it.
 *
 * The rating is the lower bound of the Wilson interval on the share of likes, not the share
 * itself: one like and no dislikes is 100%, and would sit above a preset two hundred people liked
 * and three did not. The bound says how good a preset is at least, given how many have voted. */

export type CommunitySort = 'top' | 'new' | 'liked';
/** all presets, only those that need no item table, only those that do */
export type TableFilter = 'all' | 'files' | 'table';

/** What the rules need of a card. */
export interface Rankable {
  id: string;
  up: number;
  down: number;
  created: string;
  /** everything a search may match, already lower case: the name, the author, the mods */
  haystack: string;
  /** puts on looks only the game's item table (items_game) can */
  table: boolean;
}

/** Whether a look needs items_game: a hero's item goes in by files, every other look by the table. */
export const needsTable = (slots: string[]) => slots.some((s) => !s.startsWith('item:'));

/** The share of likes it has at least, at 95% confidence; 0 with no votes. */
export function rating(up: number, down: number): number {
  const n = up + down;
  if (n <= 0) return 0;
  const z = 1.96;
  const p = up / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
}

/** Lower case, with ё as е and runs of anything that is not a letter or a digit as one space. */
export function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Every word of the query somewhere in the card: "pudge arcana" finds the preset with both. */
export function matches(card: Rankable, query: string): boolean {
  const words = fold(query).split(' ').filter(Boolean);
  return words.every((w) => card.haystack.includes(w));
}

const byNew = (a: Rankable, b: Rankable) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0);

/** The cards a search leaves, in the sort's order. Ties fall back to the newest first. */
export function rank<T extends Rankable>(cards: T[], query: string, sort: CommunitySort, table: TableFilter = 'all'): T[] {
  const left = cards.filter((c) => matches(c, query) && (table === 'all' || c.table === (table === 'table')));
  const order = {
    new: byNew,
    liked: (a: T, b: T) => b.up - a.up || byNew(a, b),
    top: (a: T, b: T) => rating(b.up, b.down) - rating(a.up, a.down) || b.up - a.up || byNew(a, b),
  }[sort];
  return [...left].sort(order);
}

/** The counts after your vote moved from `was` to `now` (each 1, -1 or 0), before the index has it. */
export function revote(c: { up: number; down: number }, was: number, now: number): { up: number; down: number } {
  let { up, down } = c;
  if (was === 1) up--;
  if (was === -1) down--;
  if (now === 1) up++;
  if (now === -1) down++;
  return { up: Math.max(0, up), down: Math.max(0, down) };
}

/** Pressing a thumb: the same one again takes the vote back. */
export const nextVote = (current: number, pressed: 1 | -1): number => (current === pressed ? 0 : pressed);
