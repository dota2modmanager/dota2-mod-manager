/* What Home shows, worked out without the DOM, so a test can hold the rules (test/home.test.ts).
 *
 * Home answers one question at a glance: what is new, and where to go next. Its parts are the
 * ways into the sections with what is in each now, what arrived in the catalog, what this
 * version changed, the news the signed config carries, and anything about the game that needs
 * the user (views/home.ts gathers them). */
import type { Mod } from '../catalog/types.ts';
import type { Notice } from '../api/content.ts';

export interface HomeDest {
  view: string;
  icon: string;
  title: string;
  /** what is in it now, in a few words */
  line: string;
  /** the section has something not seen yet (the Workshop's new tools) */
  fresh?: boolean;
}

export interface HomeStatus {
  id: string;
  icon: string;
  text: string;
  tone: 'ok' | 'warn';
  action?: { label: string; run: () => unknown };
}

export interface HomeModel {
  version: string;
  stars: number | null;
  dests: HomeDest[];
  recent: Mod[];
  /** what this version changed, one line each */
  notes: string[];
  news: Notice[];
  status: HomeStatus[];
}

/** How many of a version's changes Home lists before "All changes". */
export const NOTES_SHOWN = 5;
/** How many news items Home lists. */
export const NEWS_SHOWN = 3;
/** How many of the catalog's newest mods Home shows. */
export const RECENT_SHOWN = 6;

const plain = (s: string): string => s
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // a link keeps its words
  .replace(/[*_`]/g, '')
  .trim();

/**
 * A version's changelog section as one line per change: its `###` headings, which is how the
 * changelog names each change; a section written as a plain list gives its items instead. A heading
 * two versions share ("Fixed" in 3.0.2 and 3.0.1) is listed once: the list is keyed by its text,
 * and two rows with one key left a Russian row on screen after switching to English.
 */
export function notePoints(section: string | null | undefined, max = NOTES_SHOWN): string[] {
  const lines = String(section || '').split(/\r?\n/);
  const heads = lines.filter((l) => /^###\s+/.test(l)).map((l) => plain(l.replace(/^###\s+/, '')));
  const items = heads.length ? heads : lines.filter((l) => /^[-*]\s+/.test(l)).map((l) => plain(l.replace(/^[-*]\s+/, '')));
  return [...new Set(items.filter(Boolean))].slice(0, max);
}

/** The newest news first, the ones without a date after those with one. */
export function latestNews(notices: Notice[] | null | undefined, max = NEWS_SHOWN): Notice[] {
  return [...(notices || [])]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, max);
}

/** A count as people read it: 1 234, and 12.3k past ten thousand. */
export function shortCount(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return n.toLocaleString('ru-RU').replace(/ /g, ' ');
}
