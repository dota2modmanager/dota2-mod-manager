/* What the upload history shows, worked out without the DOM (test/creator-history.test.ts):
 * each submission's state as the catalog's worker names it, how many are in each, and how long ago
 * one was sent. HistoryPanel.tsx draws it. */
import type { CreatorHistoryItem } from '../api/creator.ts';

export type HistoryState = 'moderation' | 'accepted' | 'rejected';
export type HistoryFilter = 'all' | HistoryState;

/** The worker's word for a submission; anything it does not say yet is still on moderation. */
export function stateOf(item: CreatorHistoryItem): HistoryState {
  const s = String(item.status || '').toLowerCase();
  return s === 'accepted' || s === 'rejected' ? s : 'moderation';
}

export function countStates(items: CreatorHistoryItem[]): Record<HistoryFilter, number> {
  const out: Record<HistoryFilter, number> = { all: items.length, moderation: 0, accepted: 0, rejected: 0 };
  for (const it of items) out[stateOf(it)] += 1;
  return out;
}

export function filterItems(items: CreatorHistoryItem[], filter: HistoryFilter): CreatorHistoryItem[] {
  return filter === 'all' ? items : items.filter((it) => stateOf(it) === filter);
}

/** Newest first; a submission with no date goes last, in the order the worker gave it. */
export function newestFirst(items: CreatorHistoryItem[]): CreatorHistoryItem[] {
  const t = (it: CreatorHistoryItem) => { const n = Date.parse(it.createdAt || ''); return Number.isFinite(n) ? n : -Infinity; };
  return items.map((it, i) => ({ it, i })).sort((a, b) => t(b.it) - t(a.it) || a.i - b.i).map((x) => x.it);
}

/** How long ago, in the largest whole unit: { n, unit }, or null for a date that does not read. */
export function ago(iso: string | undefined, now: number): { n: number; unit: 'now' | 'min' | 'hour' | 'day' | 'month' } | null {
  const at = Date.parse(iso || '');
  if (!Number.isFinite(at)) return null;
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  if (min < 1) return { n: 0, unit: 'now' };
  if (min < 60) return { n: min, unit: 'min' };
  if (min < 60 * 24) return { n: Math.floor(min / 60), unit: 'hour' };
  if (min < 60 * 24 * 30) return { n: Math.floor(min / (60 * 24)), unit: 'day' };
  return { n: Math.floor(min / (60 * 24 * 30)), unit: 'month' };
}
