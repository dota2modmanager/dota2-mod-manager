/* How many times each catalog mod was downloaded, counted by the catalog's own counter (a
 * Cloudflare Worker its author runs, the same one the catalog site counts its downloads with).
 *
 * Two directions, and neither may ever cost the user anything:
 *
 *  - The numbers come down as one public file, downloads.json, a map of "category/group/mod" (and
 *    "category/group/mod/style" for a mod with several looks) to a count. It is fetched at most
 *    once every few minutes and kept on disk, so a window opened offline, or while the Worker is
 *    down, shows yesterday's numbers instead of none.
 *  - An install of a catalog mod goes up as a hit on that mod's key. Hits wait a moment and leave
 *    together, so a preset of fifty mods is one request, and a key counts at most a few times per
 *    request. A hit that cannot be sent is dropped, not retried: the counter is somebody else's
 *    free-tier Worker, and a thousand windows retrying at it the moment it comes back is exactly
 *    the load that took it down.
 *
 * A hit carries the mod's key and nothing else: no id, no machine, no settings. It goes out only
 * when the build carries the counter's token (written into the release build by CI from a
 * repository secret, never committed: tools/stats-token.mjs) and the user has not switched
 * counting off in Settings. Every request has a short timeout and every failure is swallowed:
 * an install never waits for the counter and never fails because of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { downloadProxyFetchInit } from './download-proxy.ts';

/** The counter's Worker: GET /downloads.json for the numbers, POST /hit to add to them. */
export const STATS_API = 'https://d2pfx-counter.hrdqfck.workers.dev';
/** The build's copy of the counter's token, beside this file; absent in a source checkout. */
export const TOKEN_FILE = path.join(import.meta.dirname, 'download-stats.token');

const COUNTS_TTL_MS = 5 * 60 * 1000;
const FLUSH_DELAY_MS = 2000;
const TIMEOUT_MS = 8000;
/** what a request may say about one key, whatever happened on this machine */
const MAX_PER_KEY = 5;
/** keys one request may carry: a pending list that only grows is a bug, not a preset */
const MAX_KEYS = 500;
/** what downloads.json may hold before it is taken for something else */
const MAX_COUNT_KEYS = 50000;

/** Downloads by key (statKey). */
export type Counts = Record<string, number>;

/** A mod's key, the way the counter and the catalog site write it: categoryId/groupId/modName[/style]. */
export const statKey = (categoryId: string, groupId: string | null | undefined, modName: string, styleName?: string | null): string =>
  [categoryId, groupId, modName, styleName].filter(Boolean).join('/');

/** A look's name as the counter keys it: its label without "Style ", or "Default" when that leaves nothing. */
export const statStyleName = (label: unknown): string =>
  String(label ?? '').replace('Style ', '').trim() || 'Default';

type StatMod = { name?: unknown; styles?: unknown[] };
type StatCategory = StatMod[] | { groups?: { id?: unknown; mods?: StatMod[] }[]; mods?: StatMod[] } | null | undefined;

/**
 * The keys one install counts under, read off mods.json: the mod's own key, and for a mod with
 * more than one look the look's key too, so the mod's total stays right and each look has its
 * own number. Nothing for a mod the catalog does not list, since the counter would drop it anyway.
 */
export function statKeysFor(modsData: Record<string, StatCategory> | null | undefined, categoryId: string, name: string, styleLabel?: string | null): string[] {
  const category = modsData?.[categoryId];
  if (!category) return [];
  const lists: [string | null, StatMod[]][] = Array.isArray(category)
    ? [[null, category]]
    : Array.isArray(category.groups)
      ? category.groups.map((g) => [typeof g.id === 'string' ? g.id : null, Array.isArray(g.mods) ? g.mods : []])
      : [[null, Array.isArray(category.mods) ? category.mods : []]];
  for (const [group, mods] of lists) {
    const mod = mods.find((m) => m && m.name === name);
    if (!mod) continue;
    const base = statKey(categoryId, group, name);
    const looks = Array.isArray(mod.styles) ? mod.styles.length : 0;
    return looks > 1 && styleLabel ? [statKey(categoryId, group, name, statStyleName(styleLabel)), base] : [base];
  }
  return [];
}

/** Only a map of names to whole, non-negative numbers is taken as counts. */
function cleanCounts(data: unknown): Counts | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const out: Counts = {};
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (++n > MAX_COUNT_KEYS) break;
    if (k.length <= 400 && typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
  }
  return out;
}

/** What the counter is made over; everything past the first two stands in for a test. */
export interface DownloadStatsOptions {
  /** where the last good counts are kept between runs */
  cacheFile: string;
  /** whether the user lets installs be counted (Settings) */
  enabled: () => boolean;
  /** the counter's token, or null when this build has none */
  token?: () => string | null;
  api?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

/** The token this build was given, or null. Read once: it cannot change while the app runs. */
export function buildToken(file = TOKEN_FILE): string | null {
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    return /^[\x21-\x7e]{16,512}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** The counter for this app: get() the numbers to show, track() an install, flush() what waits. */
export function createDownloadStats({
  cacheFile, enabled, token = buildToken, api = STATS_API, fetch = globalThis.fetch, now = Date.now, log = () => {},
}: DownloadStatsOptions) {
  let counts: Counts = {};
  let countsAt = -Infinity;
  let loading: Promise<void> | null = null;
  /** installs made in this run, shown at once rather than after the next fetch */
  const session: Counts = {};
  let pending: Counts = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tokenRead: string | null | undefined;
  const theToken = () => (tokenRead === undefined ? (tokenRead = token()) : tokenRead);

  try {
    const saved = cleanCounts(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
    if (saved) counts = saved;
  } catch { /* first run, or a cache that is no use: the network fills it */ }

  const request = (url: string, init: RequestInit = {}) =>
    fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), ...downloadProxyFetchInit() } as RequestInit);

  async function load(): Promise<void> {
    try {
      const res = await request(`${api}/downloads.json`);
      if (!res.ok) { log(`download counts: HTTP ${res.status}`); return; }
      const fresh = cleanCounts(await res.json());
      if (!fresh) return;
      counts = fresh;
      // once every hit has gone out, this run's installs are in the server's numbers
      if (!timer && !Object.keys(pending).length) for (const k of Object.keys(session)) delete session[k];
      try { fs.writeFileSync(cacheFile, JSON.stringify(counts)); } catch { /* shown anyway, just not kept */ }
    } catch (err) {
      log(`download counts: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The counts to show: the last ones fetched, plus this run's installs. Never throws, never waits long. */
  async function get(): Promise<Counts> {
    if (now() - countsAt >= COUNTS_TTL_MS && !loading) {
      countsAt = now(); // a failure waits its turn like a success does, so a dead Worker is not asked every call
      loading = load().finally(() => { loading = null; });
    }
    if (loading) await loading;
    const out = { ...counts };
    for (const [k, v] of Object.entries(session)) out[k] = (out[k] || 0) + v;
    return out;
  }

  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    const hits = pending;
    pending = {};
    const t = theToken();
    if (!t || !Object.keys(hits).length) return;
    try {
      const res = await request(`${api}/hit`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'X-Source': 'app', 'X-App-Token': t },
        body: JSON.stringify({ hits }),
      });
      if (!res.ok) log(`download hit: HTTP ${res.status}`);
    } catch (err) {
      log(`download hit: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Count one install under these keys (statKeysFor). Does nothing without a token or with counting off. */
  function track(keys: string[]): void {
    if (!theToken() || !enabled()) return;
    for (const k of keys) {
      if (typeof k !== 'string' || !k) continue;
      if (!(k in pending) && Object.keys(pending).length >= MAX_KEYS) continue;
      pending[k] = Math.min((pending[k] || 0) + 1, MAX_PER_KEY);
      session[k] = (session[k] || 0) + 1;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, FLUSH_DELAY_MS);
    timer.unref?.();
  }

  return { get, track, flush, active: () => Boolean(theToken()) };
}

/** mods.json's modsData off the catalog's cache file, parsed again only when the file changes. */
export function catalogModsReader(file: string): () => Record<string, StatCategory> | null {
  let at = -1;
  let data: Record<string, StatCategory> | null = null;
  return () => {
    // one open file for both questions, so what was dated is what is read
    let fd: number | null = null;
    try {
      fd = fs.openSync(file, 'r');
      const m = fs.fstatSync(fd).mtimeMs;
      if (m !== at) { data = JSON.parse(fs.readFileSync(fd, 'utf8'))?.modsData ?? null; at = m; }
    } catch {
      data = null; at = -1;
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
    return data;
  };
}

/** One app's counter (createDownloadStats). */
export type DownloadStats = ReturnType<typeof createDownloadStats>;
