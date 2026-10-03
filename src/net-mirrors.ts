// The mirror chain (src/net.ts explains it): which hosts carry a copy of a GitHub file and how a
// URL is written for each, which of them a file may come from, and how each host has been doing.
// A host that keeps failing is stood down for a while; that state lives here and nowhere else.
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

export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export function stoodDown(host: string): boolean {
  const h = health.get(host);
  return !!(h && h.until > Date.now());
}

export function noteFailure(host: string, why: string): void {
  const h = health.get(host) || { fails: 0, until: 0 };
  h.fails++;
  if (h.fails >= FAIL_THRESHOLD) { h.until = Date.now() + COOLDOWN_MS; h.fails = 0; }
  h.why = why;
  health.set(host, h);
}

export function noteSuccess(host: string): void {
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
export function liveOrder(entries: Entry[]): Entry[] {
  const ready = entries.filter((e) => !stoodDown(e.host));
  // everything is standing down: rather than fail outright, try them anyway, best first
  return ready.length ? ready : entries;
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
