/* How many stars the project has on GitHub, for the Home screen (renderer/home/).
 *
 * Asked of api.github.com at most every six hours and kept in a small file under userData, so
 * the number is there at once on the next start and stays there when the network is not.
 * GitHub lets an unsigned caller sixty requests an hour; one in six hours is nowhere near it.
 * It never throws and never waits long: a count that cannot be had is null, and Home shows
 * the link without a number. */
import fs from 'node:fs';
import { downloadProxyFetchInit } from './download-proxy.ts';

/** Where the count is read: the repository's own record, which carries stargazers_count. */
export const STARS_API = 'https://api.github.com/repos/dota2modmanager/dota2-mod-manager';
const FRESH_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

interface Cached { stars: number; at: number }

/** Where the count is kept, and the clock and network a test hands in instead. */
export interface RepoStarsOptions {
  cacheFile: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

function readCache(file: string): Cached | null {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<Cached>;
    return Number.isInteger(c.stars) && Number.isFinite(c.at) ? { stars: c.stars as number, at: c.at as number } : null;
  } catch {
    return null;
  }
}

/** The star count for Home, cached on disk and asked for again after six hours. */
export function createRepoStars({ cacheFile, fetch = globalThis.fetch, now = Date.now }: RepoStarsOptions) {
  let cached = readCache(cacheFile);
  let asking: Promise<number | null> | null = null;

  async function ask(): Promise<number | null> {
    try {
      const res = await fetch(STARS_API, {
        headers: { accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...downloadProxyFetchInit(),
      } as RequestInit);
      if (!res.ok) return cached?.stars ?? null;
      const n = (await res.json() as { stargazers_count?: unknown }).stargazers_count;
      if (!Number.isInteger(n)) return cached?.stars ?? null;
      cached = { stars: n as number, at: now() };
      try { fs.writeFileSync(cacheFile, JSON.stringify(cached)); } catch { /* the next start asks again */ }
      return cached.stars;
    } catch {
      return cached?.stars ?? null;
    }
  }

  return {
    /** The count: the cached one while it is fresh, otherwise asked for (once at a time). */
    get(): Promise<number | null> {
      if (cached && now() - cached.at < FRESH_MS) return Promise.resolve(cached.stars);
      asking ||= ask().finally(() => { asking = null; });
      return asking;
    },
  };
}
