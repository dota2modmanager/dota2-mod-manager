// A request across the mirror chain (src/net.ts explains it): each mirror of a URL in turn, a
// failure noted against its host, and the first good answer returned.
import { stoodDown, noteFailure, noteSuccess, entriesFor, liveOrder } from './net-mirrors.ts';

const ATTEMPTS_PER_MIRROR = 2;

// A stalled connection has to give up eventually or the install sits there forever. The
// body has its own, longer budget: a 300 MB mod on a slow line is not a stall.
const HEAD_TIMEOUT_MS = 20000;

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
  for (let pass = 0; pass < ATTEMPTS_PER_MIRROR; pass++) {
    for (const candidate of candidates) {
      const host = candidate.host;
      if (stoodDown(host)) continue;
      try {
        const res = await fetch(candidate.url, { headers, signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
        if (!res.ok && res.status !== 206) {
          // 404 is the file, not the mirror: another mirror of the same repo will not have it
          if (res.status === 404) { onMirror(candidate); return res; }
          throw new Error(`HTTP ${res.status}`);
        }
        noteSuccess(host);
        onMirror(candidate);
        return res;
      } catch (err) {
        last = err;
        const why = err instanceof Error ? err.message : String(err);
        noteFailure(host, why);
        log(`mirror ${host} failed: ${why}`);
      }
    }
  }
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
