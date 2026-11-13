// A request across the mirror chain (src/net.ts explains it): each mirror of a URL in turn, a
// failure noted against its host, and the first good answer returned.
import { stoodDown, noteFailure, noteStall, noteSuccess, entriesFor, liveOrder, type Entry } from './net-mirrors.ts';
import { downloadProxyFetchInit } from './download-proxy.ts';

const ATTEMPTS_PER_MIRROR = 2;

// A stalled connection has to give up eventually or the install sits there forever. The
// budget covers the wait for the answer's headers. The body has its own: it is cut only when
// nothing arrives for a while, since a 300 MB mod on a slow line is not a stall. Until
// 2026-11-13 one 10 second signal covered both, and any download that took longer than that
// failed half way through.
const timing = { headMs: 10000, idleMs: 30000 };

/** Shorter budgets for a test; null puts the real ones back. */
export function setNetTiming(next: { headMs: number; idleMs: number } | null): void {
  Object.assign(timing, next ?? { headMs: 10000, idleMs: 30000 });
}

const timeoutError = (what: string): Error => Object.assign(new Error(`${what} timed out`), { name: 'TimeoutError' });

/** A fetch whose wait for headers is bounded by `headMs` and whose body is cut after `idleMs` of silence. */
async function fetchWatched(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  let timer = setTimeout(() => ctl.abort(timeoutError('the answer')), timing.headMs);
  timer.unref?.();
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctl.signal });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
  clearTimeout(timer);
  if (!res.body) return res;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctl.abort(timeoutError('the download')), timing.idleMs);
    timer.unref?.();
  };
  arm();
  const body = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, out) { arm(); out.enqueue(chunk); },
    flush() { clearTimeout(timer); },
  }));
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** How a fetch walks the mirrors (see fetchMirrored). */
export interface FetchOptions {
  small?: boolean;
  trustedOnly?: boolean;
  headers?: Record<string, string>;
  exclude?: string[];
  onMirror?: (m: { host: string; origin: boolean }) => void;
  log?: (msg: string) => void;
}

/**
 * Fetch, walking the mirrors. Returns the Response of the first mirror that answers.
 * @param url               the canonical (raw.githubusercontent.com) URL
 * @param opts.small        allow size-capped mirrors
 * @param opts.trustedOnly  the canonical host and nothing else, for a file that is only ever
 *   trusted from where it was published
 * @param opts.exclude      hosts already tried for this file and found wanting; a mirror that
 *   answered with the wrong bytes must not be offered again on the retry
 * @param opts.onMirror     which mirror is answering, called just before the response is handed back
 */
export async function fetchMirrored(url: string, {
  small = false, trustedOnly = false, headers = {}, exclude = [], onMirror = () => {}, log = () => {},
}: FetchOptions = {}): Promise<Response> {
  // filtered before liveOrder, so the "everything is standing down, try them anyway" path
  // cannot hand back a host this file has already been refused by
  const usable = entriesFor(url, { small, trustedOnly }).filter((e) => !exclude.includes(e.host));
  const candidates = liveOrder(usable);
  let last: unknown = null;
  let missing: { res: Response; from: Entry } | null = null;
  const lacking = new Set<string>();
  for (let pass = 0; pass < ATTEMPTS_PER_MIRROR; pass++) {
    for (const candidate of candidates) {
      const host = candidate.host;
      if (stoodDown(host) || lacking.has(host)) continue;
      try {
        const res = await fetchWatched(candidate.url, {
          headers,
          ...downloadProxyFetchInit(),
        } as RequestInit & { dispatcher?: unknown });
        if (!res.ok && res.status !== 206) {
          /* A 404 from the origin is the file: it is not in the catalog's repository. From anything
           * else it only says that host has no copy. A mirror is filled on its own schedule and within a
           * budget, so a new mod is missing there, and stopping at that 404 left everybody who
           * cannot reach GitHub without the catalog's newest mods, with three working proxies
           * never asked. Not a failure of the host, so no mark against it. */
          if (res.status === 404) {
            if (candidate.origin) { onMirror(candidate); return res; }
            lacking.add(host);
            missing = { res, from: candidate };
            log(`mirror ${host} has no copy`);
            continue;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        noteSuccess(host);
        onMirror(candidate);
        return res;
      } catch (err) {
        last = err;
        const why = err instanceof Error ? err.message : String(err);
        if ((err as Error)?.name === 'TimeoutError') noteStall(host, why); else noteFailure(host, why);
        log(`mirror ${host} failed: ${why}`);
      }
    }
  }
  // nobody had it, and those who answered said so: the same answer the origin would have given
  if (missing) { onMirror(missing.from); return missing.res; }
  /* Say which kind of failure this was, so the interface can say something a player
   * understands. "fetch failed" is what Node calls being unable to open a socket, and it is
   * what the catalog screen printed at somebody who had simply turned their wifi off.
   *
   * Every mirror having failed to connect is one thing (no network, or all of them blocked
   * at once, which for this userbase is the same afternoon). A mirror answering with an HTTP
   * status is another, and the app should not tell that person to check their connection.
   */
  const err: Error & { offline?: boolean } = last instanceof Error ? last : new Error(last ? String(last) : 'no mirror answered');
  err.offline = !/HTTP \d/.test(String(err.message || ''));
  throw err;
}

/** Text from the first mirror that answers (catalog JSON, fingerprint map). */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await fetchMirrored(url, { small: true, ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
