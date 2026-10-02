// Getting bytes from the internet, on a connection that may not want to cooperate.
//
// Everything the app downloads - the catalog JSON, the fingerprint map, every mod archive -
// sits in a GitHub repository, and raw.githubusercontent.com is exactly the host that is
// slow, throttled or plainly unreachable for a good part of the userbase. So each URL has
// mirrors of the same bytes, tried in order, and a host that keeps failing is stood down for
// a while instead of being asked again on every single file.
//
// Which mirrors, measured rather than copied from another project (2026-08-07, from here):
//   raw.githubusercontent.com   210 ms, Range supported            - first choice
//   ghproxy.net                 300 ms, Range supported
//   gh-proxy.com                230 ms, Range supported
//   ghfast.top                 1100 ms, Range supported            - last, it is the slowest
//   cdn.jsdelivr.net            300 ms, Range supported, but 403 on a 64 MB file
// jsDelivr caps file size on /gh/, so it serves the small JSON and never the archives. That
// is the whole reason the chain depends on what is being fetched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RAW_HOST = 'https://raw.githubusercontent.com/';
// Release assets (the Source 2 toolchain) live on github.com rather than the raw host, and
// the same proxies serve them - measured 2026-08-07, all three answer with Range support.
// jsDelivr does not do releases at all, which is why the two lists are not the same.
const RELEASE_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\//;
// After this many failures a host is stood down, and for this long. A mirror that is down
// tends to be down for minutes, and asking it once per mod turns a 40-mod install into 40
// timeouts before the first byte arrives.
export const FAIL_THRESHOLD = 3;
export const COOLDOWN_MS = 120000;
const ATTEMPTS_PER_MIRROR = 2;
// A stalled connection has to give up eventually or the install sits there forever. The
// body has its own, longer budget: a 300 MB mod on a slow line is not a stall.
const HEAD_TIMEOUT_MS = 20000;

/** A host that fetches GitHub for us, and how a URL is written for it; `origin` is the catalog's own. */
export interface Mirror {
  host: string;
  map: (url: string) => string | null;
  origin?: boolean;
  /** caps file size, so it serves the small JSON and never an archive */
  smallOnly?: boolean;
}

/** One URL worth trying for a file, and the mirror it came from. */
export interface Entry { url: string; host: string; origin: boolean }

/** How a fetch walks the mirrors (see fetchMirrored). */
export interface FetchOptions {
  small?: boolean;
  trustedOnly?: boolean;
  headers?: Record<string, string>;
  exclude?: string[];
  onMirror?: (m: { host: string; origin: boolean }) => void;
  log?: (msg: string) => void;
}

/** A file on disk, and how it got there. */
export interface Download {
  path: string;
  bytes: number;
  sha256: string;
  resumedFrom: number;
  /** nothing matched the published hash, and the catalog's own host's copy was taken */
  unverified?: boolean;
}

const proxy = (host: string) => (url: string) => `https://${host}/${url}`;
const jsdelivr = (url: string): string | null => {
  const m = url.slice(RAW_HOST.length).match(/^([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  return m ? `https://cdn.jsdelivr.net/gh/${m[1]}/${m[2]}@${m[3]}/${m[4]}` : null;
};

/* Our own copy of the four files the app cannot start without.
 *
 * Every other mirror on this list is a proxy standing in front of GitHub, so when GitHub
 * itself goes down they go with it - three hours of exactly that on 2026-08-17, with the
 * catalog empty for anybody whose cache had expired. The site is built and deployed
 * elsewhere, which makes this the one entry here that does not share GitHub's fate. It
 * carries nothing else: mod archives are gigabytes and belong where they are.
 */
const MIRRORED: Record<string, string | undefined> = {
  'h6rd/Dota2PornFxWeb/main/assets/data/mods.json': 'mods.json',
  'h6rd/Dota2PornFxWeb/main/assets/data/constants.json': 'constants.json',
  'h6rd/Dota2PornFxWeb/main/assets/data/guides.json': 'guides.json',
  'dota2modmanager/dota2-mod-manager/catalog-data/fingerprints.json': 'fingerprints.json',
  // where copies before 2.8.0 still ask for it
  'dota2modmanager/dota2-mod-manager/main/fingerprints.json': 'fingerprints.json',
  // the switches and notices, which matter most on the day GitHub is the thing that is down
  'dota2modmanager/dota2-mod-manager/main/config/app.json': 'app.json',
  'dota2modmanager/dota2-mod-manager/main/config/app.json.sig': 'app.json.sig',
  // and the signatures, or this mirror stops being one the day the catalog's key is pinned:
  // a data file whose signature cannot be fetched is a data file the app refuses.
  'h6rd/Dota2PornFxWeb/main/assets/signatures/mods.json.sig': 'mods.json.sig',
  'h6rd/Dota2PornFxWeb/main/assets/signatures/constants.json.sig': 'constants.json.sig',
  'h6rd/Dota2PornFxWeb/main/assets/signatures/guides.json.sig': 'guides.json.sig',
  'h6rd/Dota2PornFxWeb/main/assets/data/mod-hashes.json': 'mod-hashes.json',
  'h6rd/Dota2PornFxWeb/main/assets/signatures/mod-hashes.json.sig': 'mod-hashes.json.sig',
};
const ourSite = (url: string): string | null => {
  const name = url.startsWith(RAW_HOST) && MIRRORED[url.slice(RAW_HOST.length)];
  return name ? `https://dota2modmanager.com/mirror/${name}` : null;
};

/* And the archives themselves, in a bucket rather than in front of GitHub.
 *
 * Every proxy above is GitHub wearing a different hostname, so during the outage on
 * 2026-08-17 a mod could not be installed at all. tools/r2-sync.mjs keeps a copy of the whole
 * catalog here and refreshes it nightly. It sits after the origin on purpose: GitHub is asked
 * first, and a mod added to the catalog since last night costs one 404 here before the proxies
 * get their turn, which is a fair price for the day GitHub is down.
 */
const CATALOG_FILES = `${RAW_HOST}h6rd/Dota2PornFxWeb/main/assets/files/`;
const bucket = (url: string): string | null => (url.startsWith(CATALOG_FILES)
  ? `https://cdn.dota2modmanager.com/assets/files/${url.slice(CATALOG_FILES.length)}`
  : null);

export const DEFAULT_MIRRORS: readonly Mirror[] = [
  /* `origin: true` marks the host the catalog's own URLs name, and exactly one entry may carry
     it. It is not a preference - the order already says that - it is who gets believed when a
     published hash matches nothing: see downloadFile. Marked rather than recognised by its
     hostname, so a test can stand a server in its place and so a second GitHub host later
     cannot quietly inherit the privilege. */
  { host: 'raw.githubusercontent.com', map: (url) => url, origin: true },
  { host: 'dota2modmanager.com', map: ourSite, smallOnly: true },
  { host: 'cdn.dota2modmanager.com', map: bucket },
  { host: 'cdn.jsdelivr.net', map: jsdelivr, smallOnly: true },
  { host: 'ghproxy.net', map: proxy('ghproxy.net') },
  { host: 'gh-proxy.com', map: proxy('gh-proxy.com') },
  { host: 'ghfast.top', map: proxy('ghfast.top') },
];
let MIRRORS: readonly Mirror[] = DEFAULT_MIRRORS;

/** How a host has been doing: failures in a row, and when a stood-down one may be asked again. */
const health = new Map<string, { fails: number; until: number; why?: string }>();

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

function stoodDown(host: string): boolean {
  const h = health.get(host);
  return !!(h && h.until > Date.now());
}

function noteFailure(host: string, why: string): void {
  const h = health.get(host) || { fails: 0, until: 0 };
  h.fails++;
  if (h.fails >= FAIL_THRESHOLD) { h.until = Date.now() + COOLDOWN_MS; h.fails = 0; }
  h.why = why;
  health.set(host, h);
}

function noteSuccess(host: string): void {
  health.delete(host);
}

/**
 * Every URL worth trying for this one, best first. A URL that is not on GitHub raw (a mod
 * whose catalog entry points somewhere else entirely) has no mirrors - it is itself.
 * @param opts.small the file is JSON-sized, so size-capped mirrors may be used
 */
export function mirrorsFor(url: string, opts: { small?: boolean; trustedOnly?: boolean } = {}): string[] {
  return entriesFor(url, opts).map((e) => e.url);
}

/** The same list, each entry still knowing which mirror it came from. */
export function entriesFor(url: string, { small = false, trustedOnly = false }: { small?: boolean; trustedOnly?: boolean } = {}): Entry[] {
  const isRaw = url.startsWith(RAW_HOST);
  const isRelease = RELEASE_RE.test(url);
  // A mirror is a stranger who hands over bytes claiming they are GitHub's. That is a fair
  // trade for a mod archive - it is checked against a digest, and a wrong one costs a broken
  // hero model. It is not a fair trade for a file that decides which binary this app
  // downloads and runs, so that one asks GitHub itself or does without.
  /* Not the origin, either of them. `origin` means the host the catalog itself is published
     from - the one place that also holds mod-hashes.json, and so the one host the list cannot
     prove anything about. A mod the catalog keeps on Hugging Face is somewhere else entirely,
     and there the published hash is the only thing tying those bytes to the catalog at all: it
     has to be the last word, not the first draft. A test caught this being waived. */
  if (trustedOnly) return [{ url, host: hostOf(url), origin: false }];
  if (!isRaw && !isRelease) return [{ url, host: hostOf(url), origin: false }];
  const out: Entry[] = [];
  for (const m of MIRRORS) {
    if (m.smallOnly && !small) continue;
    // a release asset is only reachable through the plain proxies, and github.com itself
    if (isRelease && m.smallOnly) continue;
    const mapped = isRelease && m.host === 'raw.githubusercontent.com' ? url : m.map(url);
    if (mapped) out.push({ url: mapped, host: m.host, origin: !!m.origin });
  }
  return out;
}

/** The mirrors in the order they should actually be tried right now: rested hosts first. */
function liveOrder(entries: Entry[]): Entry[] {
  const ready = entries.filter((e) => !stoodDown(e.host));
  // everything is standing down: rather than fail outright, try them anyway, best first
  return ready.length ? ready : entries;
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

export const sha256 = (file: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  fs.createReadStream(file)
    .on('data', (chunk) => hash.update(chunk))
    .on('error', reject)
    .on('end', () => resolve(hash.digest('hex')));
});

/**
 * Download to a file, resuming where an interrupted attempt stopped.
 *
 * The half-finished file is kept as <dest>.part and picked up with a Range request. Every
 * mirror measured supports it, and a mod archive is up to 300 MB: starting a 60 MB download
 * over because a train went into a tunnel is the difference between a mod and a shrug.
 *
 * @param opts.expectSha256 what this file should hash to; a mirror handing over
 *   something else is dropped and the next one is asked
 * @param opts.fromPublishedList the expectation above came from a list somebody
 *   else maintains (the catalog's `mod-hashes.json`, or what this machine saw last time),
 *   rather than from a hash pinned in this project. Such a list can simply be wrong, and when
 *   it is, the file it names outranks it. Never pass this for the app's own update or for the
 *   toolchain: those hashes are pinned here and a mismatch there is the thing being guarded.
 */
export async function downloadFile(url: string, dest: string, {
  onProgress = () => {}, expectSha256 = null, fromPublishedList = false, log = () => {},
}: {
  onProgress?: (loaded: number, total: number) => void;
  expectSha256?: string | null;
  fromPublishedList?: boolean;
  log?: (msg: string) => void;
} = {}): Promise<Download> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  /* A mirror that answers with bytes we cannot use has failed, exactly like one that does not
   * answer at all - and until 2026-09-10 only the second kind was treated that way. The whole
   * download was abandoned on the first wrong checksum, so a single stale copy on one mirror
   * took the mod away from everybody who reaches that mirror first.
   *
   * That is not hypothetical: the bucket skipped an archive it already had under the same
   * name, so 24 mods that upstream had replaced still sat there in their old versions. Anybody
   * who cannot reach GitHub got those bytes, the checksum said no, and the install stopped -
   * while three proxies that had the current file were never asked.
   *
   * So a wrong checksum costs that mirror its turn, not the mod.
   */
  const refused: string[] = [];
  const mirrorCount = Math.max(1, mirrorsFor(url).length);

  /* And the other half of it: the list can be wrong about the file.
   *
   * `mod-hashes.json` is rebuilt by a bot in the catalog's repository, beside the archives it
   * describes. On 2026-09-10 it named a hash for heroes/Axe Kratos.zip that no copy of that
   * file has ever had - not GitHub's, not the API's, not any proxy's - so the mod was refused
   * for everybody, including people whose GitHub works perfectly.
   *
   * A published hash is worth having because a proxy is a stranger and the hash proves the
   * bytes are the ones the catalog's author signed for. It cannot prove anything about GitHub
   * itself: the list lives in the same repository as the archives, so whoever could rewrite
   * one could rewrite the other. When every mirror disagrees with the list and the catalog's
   * own host is among them, the list is the thing that is out of date.
   *
   * So the origin's copy is kept aside rather than deleted, and used if nothing verifies. The
   * guarantee that survives: no proxy can get bytes installed that GitHub did not serve.
   */
  const kept = `${dest}.origin`;
  let haveOriginCopy = false;
  const dropKept = () => { if (haveOriginCopy) fs.rmSync(kept, { force: true }); haveOriginCopy = false; };

  for (let attempt = 0; ; attempt++) {
    let have = 0;
    try { have = fs.statSync(part).size; } catch { /* nothing to resume */ }

    const headers: Record<string, string> = have > 0 ? { Range: `bytes=${have}-` } : {};
    let answered: { host: string; origin: boolean } = { host: hostOf(url), origin: false };
    const res = await fetchMirrored(url, {
      headers, exclude: refused, log, onMirror: (m) => { answered = m; },
    });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
    const host = answered.host;

    // A mirror that ignores Range (or a file that changed upstream) answers 200 with the whole
    // thing: start over rather than glue two halves of different files together.
    const resuming = res.status === 206 && have > 0;
    if (!resuming && have > 0) {
      log(`resume refused by ${host}, starting over`);
      have = 0;
    }
    const totalHeader = Number(res.headers.get('content-length')) || 0;
    const total = totalHeader ? totalHeader + (resuming ? have : 0) : 0;

    const out = fs.createWriteStream(part, { flags: resuming ? 'a' : 'w' });
    let loaded = have;
    if (!res.body) throw new Error(`HTTP ${res.status} with no body`);
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.length;
        onProgress(loaded, total);
        await new Promise<void>((resolve, reject) => {
          out.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
        });
      }
    } finally {
      await new Promise<void>((resolve) => { out.end(() => resolve()); });
    }

    const digest = await sha256(part);
    if (expectSha256 && digest !== expectSha256) {
      // half a file resumed from a mirror that turned out to be wrong is worth nothing, and
      // leaving it behind would poison the Range request of whichever mirror answers next
      if (fromPublishedList && answered.origin) {
        dropKept();
        fs.renameSync(part, kept);
        haveOriginCopy = true;
      } else {
        fs.rmSync(part, { force: true });
      }
      noteFailure(host, 'checksum mismatch');
      refused.push(host);
      log(`mirror ${host} served ${path.basename(dest)} with the wrong checksum`);
      if (attempt + 1 < mirrorCount) continue;

      // Nothing verified. If the catalog's own host handed over a copy, it is the file and the
      // list is stale; anything else here is a mod nobody can vouch for.
      if (haveOriginCopy) {
        const kind = await sha256(kept);
        fs.rmSync(dest, { force: true });
        fs.renameSync(kept, dest);
        haveOriginCopy = false;
        log(`${path.basename(dest)}: no copy matches the published hash; taking the one from the host the catalog names, which is where the list is built`);
        return { path: dest, bytes: fs.statSync(dest).size, sha256: kind, resumedFrom: 0, unverified: true };
      }
      // flagged rather than matched on its wording: the caller turns this into a sentence in
      // the user's language, and it should not have to recognise it by its English
      const bad: Error & { checksum?: boolean } = new Error(`checksum mismatch for ${path.basename(dest)}`);
      bad.checksum = true;
      throw bad;
    }
    dropKept();
    fs.rmSync(dest, { force: true });
    fs.renameSync(part, dest);
    return { path: dest, bytes: fs.statSync(dest).size, sha256: digest, resumedFrom: resuming ? have : 0 };
  }
}

/** For the diagnostics report: which mirrors are currently standing down, and why. */
export function mirrorHealth(): { host: string; fails: number; standingDownFor: number; why?: string }[] {
  const out: { host: string; fails: number; standingDownFor: number; why?: string }[] = [];
  for (const [host, h] of health) out.push({ host, fails: h.fails, standingDownFor: Math.max(0, h.until - Date.now()), why: h.why });
  return out;
}

/** Tests reach in here; nothing in the app should need it. */
export function resetHealth(): void {
  health.clear();
}

/** Point the chain at local servers for a test. Pass nothing to put the real list back. */
export function setMirrors(list: readonly Mirror[] | null | undefined): void {
  MIRRORS = list || DEFAULT_MIRRORS;
  health.clear();
}

/**
 * Put the hosts the signed config names into the chain, or take them out again.
 *
 * The built-in list is compiled in, so arranging a second copy of the catalog somewhere used to
 * mean a release and then waiting for people to take it. These sit after our own bucket and
 * before the proxies, because a proxy is GitHub wearing a different hostname and one of these is
 * a real second copy. None of them is ever the origin: the bytes are checked against the hash
 * the catalog publishes, and when nothing matches it is the origin's copy that is believed, so
 * what a host named here can do is serve a download or fail it.
 *
 * A host that answers with nothing useful stands itself down after a few failures like any
 * other, which is also what happens to one that is named here after it stops existing.
 *
 * @param list  from src/remote-config.ts
 */
export function applyMirrors(list: unknown): number {
  const extra: Mirror[] = (Array.isArray(list) ? list : [])
    .filter((m): m is { base: string; host: string } => Boolean(m) && typeof m.base === 'string' && typeof m.host === 'string'
      && Boolean(m.base) && Boolean(m.host) && m.host !== 'raw.githubusercontent.com')
    .map((m) => ({
      host: m.host,
      map: (url: string) => (url.startsWith(CATALOG_FILES) ? m.base + url.slice(CATALOG_FILES.length) : null),
    }));
  if (!extra.length) { setMirrors(null); return DEFAULT_MIRRORS.length; }

  const at = DEFAULT_MIRRORS.findIndex((m) => m.host === 'cdn.dota2modmanager.com');
  const next = [...DEFAULT_MIRRORS];
  next.splice(at + 1, 0, ...extra);
  setMirrors(next);
  return next.length;
}

