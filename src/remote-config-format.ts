// The remote config's format (src/remote-config.ts fetches it and answers from it): what the
// file may say, and the checks that cut whatever was fetched down to that. Anything malformed,
// too long or aimed at something that cannot be switched is dropped rather than trusted.
//
// Shape:
//   {
//     "version": 1,
//     "features": { "install": { "off": true, "ru": "…", "en": "…" } },
//     "notices": [ { "id": "2026-08-dota-patch", "date": "2026-08-07", "level": "warn",
//                    "ru": "…", "en": "…", "url": "https://…",
//                    "minVersion": "2.0.0", "maxVersion": "2.1.0", "until": "2026-08-14" } ],
//     "blocks":  [ { "id": "2026-09-16-install-2.7.0", "feature": "install",
//                    "minVersion": "2.7.0", "maxVersion": "2.7.0", "until": "2026-09-27",
//                    "ru": "…", "en": "…" } ],
//     "beta":    { "salt": "d2mm-beta-1", "ids": ["<sha256 of salt:discordId>", …] }
//   }
//
// `features` switches something off in every version. That is right when the cause is outside
// the app, a Dota patch, and wrong when one release is broken: the fixed release would be switched
// off along with it. `blocks` are for that second case, a switch that holds for a range of
// versions until a day. They have a key of their own because copies released before BLOCKS_SINCE
// read only `features` and `notices`: a range written into `features` would switch the feature
// off for every one of them, while a key they have never heard of is one they leave alone.
// tools/rollback.mjs writes both, signs the file and refuses the mistakes.
//
// `beta` is the list of Discord accounts the beta channel is offered to, as hashes: the file is
// public and a list of a dozen people's accounts is not ours to publish. src/beta.ts does the
// checking; this only reads the block and refuses anything that is not shaped like one.

// What the app is willing to be told to switch off. A name that is not on this list is
// ignored: a typo in the config must not disable something at random, and this list is the
// contract between the file and the code that honours it.
export const SWITCHABLE: readonly string[] = ['install', 'cosmetics', 'voice'];
/* The first version that reads `blocks`. Everything before it ignores the key entirely, which is
 * what makes adding it safe, and also what makes a block aimed at those versions do nothing, so
 * tools/rollback.mjs refuses one. 2.6.12 is the last release without it; whichever version
 * ships next is at least this one. */
export const BLOCKS_SINCE = '2.6.13';
const MAX_NOTICES = 20;
// A beta is a handful of people the maintainer picked, not a rollout: a list longer than this is
// a sign the file was edited by something other than a person.
export const MAX_TESTERS = 100;
/* Somewhere else the archives can be fetched from. A handful at most: the chain is walked in
   order on every download, and a host that is not really there costs a request each time. */
export const MAX_MIRRORS = 4;
// the catalog's own host: a list entry claiming to be it would be claiming to be the origin
const RAW_MIRROR_HOST = 'raw.githubusercontent.com';
const MAX_TEXT = 500;

/** A feature switched off everywhere, with what to tell the user. */
export interface Off { off: true; ru: string; en: string }

/** Something a build or a range of them is told, until a day or for good. */
export interface RemoteNotice {
  id: string; date: string; level: 'warn' | 'info'; ru: string; en: string; url: string | null;
  minVersion: string | null; maxVersion: string | null; until: string | null;
}

/** A feature switched off for a range of builds until a day. */
export interface RemoteBlock {
  id: string; feature: string; ru: string; en: string;
  minVersion: string | null; maxVersion: string | null; until: string;
}

/** Another host the archives can be fetched from. */
export interface RemoteMirror { id: string; base: string; host: string }

/** The signed config, as far as it passed the checks below. */
export interface RemoteConfig {
  features: Record<string, Off | undefined>;
  notices: RemoteNotice[];
  blocks: RemoteBlock[];
  beta: { salt: string; ids: string[] } | null;
  mirrors: RemoteMirror[];
}

/** Anything the raw JSON could hold in a place an object is expected. */
type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object';

const str = (v: unknown, max = MAX_TEXT): string => (typeof v === 'string' ? v.slice(0, max) : '');

// "2.0.1" -> [2, 0, 1]; anything odd sorts as 0 so a broken bound never hides a notice
const parts = (v: unknown): number[] => String(v || '').split('.').map((n) => parseInt(n, 10) || 0);

/** Two versions compared part by part as numbers, so 10.0.0 comes after 2.0.0. */
export function cmpVersion(a: unknown, b: unknown): -1 | 0 | 1 {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  }
  return 0;
}

/** Does an entry with optional version bounds and a last day hold for this build today? */
export function applies(entry: { minVersion?: string | null; maxVersion?: string | null; until?: string | null }, version: string, today: string): boolean {
  return (!entry.minVersion || cmpVersion(version, entry.minVersion) >= 0)
    && (!entry.maxVersion || cmpVersion(version, entry.maxVersion) <= 0)
    && (!entry.until || today <= entry.until);
}

// the last day something applies, in UTC, or null for anything that is not a real date
const validDay = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);

/** The fetched JSON cut down to what this build can act on: anything malformed, too long or aimed
 * at a feature that cannot be switched is dropped rather than trusted. */
export function normalize(raw: unknown): RemoteConfig {
  const out: RemoteConfig = {
    features: {}, notices: [], blocks: [], beta: null, mirrors: [],
  };
  if (!isObject(raw)) return out;

  const features: Loose = isObject(raw.features) ? raw.features : {};
  for (const name of SWITCHABLE) {
    const f = features[name];
    if (!isObject(f) || f.off !== true) continue;
    out.features[name] = { off: true, ru: str(f.ru), en: str(f.en) };
  }

  const notices = Array.isArray(raw.notices) ? raw.notices.slice(0, MAX_NOTICES) : [];
  for (const n of notices) {
    if (!isObject(n)) continue;
    const id = str(n.id, 80);
    if (!id) continue;
    out.notices.push({
      id,
      date: str(n.date, 20),
      level: n.level === 'warn' ? 'warn' : 'info',
      ru: str(n.ru),
      en: str(n.en),
      url: /^https:\/\//i.test(str(n.url, 300)) ? str(n.url, 300) : null,
      minVersion: str(n.minVersion, 20) || null,
      maxVersion: str(n.maxVersion, 20) || null,
      // anything but a real date means no end, so a typo never hides a notice
      until: validDay(n.until),
    });
  }

  const blocks = Array.isArray(raw.blocks) ? raw.blocks.slice(0, MAX_NOTICES) : [];
  for (const b of blocks) {
    if (!isObject(b)) continue;
    const id = str(b.id, 80);
    const until = validDay(b.until);
    /* A block with a damaged last day is dropped rather than held forever. For a notice a typo
     * errs towards showing it; for a switch the same typo would err towards an outage nobody can
     * end from the user's side, and this module fails open. */
    if (!id || typeof b.feature !== 'string' || !SWITCHABLE.includes(b.feature) || !until) continue;
    out.blocks.push({
      id,
      feature: b.feature,
      ru: str(b.ru),
      en: str(b.en),
      minVersion: str(b.minVersion, 20) || null,
      maxVersion: str(b.maxVersion, 20) || null,
      until,
    });
  }
  /* The beta list. A block with no usable entry is left as null rather than as an empty list,
     so "nobody is on the list" and "the file says nothing about a beta" read the same way here:
     both mean the switch is not offered. */
  const beta = isObject(raw.beta) ? raw.beta : null;
  if (beta) {
    const ids = (Array.isArray(beta.ids) ? beta.ids : [])
      .filter((id): id is string => typeof id === 'string' && /^[0-9a-f]{64}$/i.test(id.trim()))
      .slice(0, MAX_TESTERS)
      .map((id) => id.trim().toLowerCase());
    if (ids.length) out.beta = { salt: str(beta.salt, 80), ids };
  }

  /* Another copy of the archives, named after the app shipped.
   *
   * The built-in chain (src/net.ts) is compiled in, so every new host used to need a release.
   * What a mirror can do is limited by what a mirror is asked for: the bytes are checked against
   * the hash the catalog publishes, and only the origin is believed when nothing matches, so a
   * host named here can serve a download or fail it and nothing else. https, no credentials and
   * no query, and never the host the catalog itself is published from, which would be claiming
   * to be the origin. */
  const mirrors = Array.isArray(raw.mirrors) ? raw.mirrors.slice(0, MAX_MIRRORS) : [];
  for (const m of mirrors) {
    if (!isObject(m)) continue;
    const base = str(m.base, 300);
    let host = '';
    try {
      const u = new URL(base);
      if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) continue;
      if (!u.pathname.endsWith('/')) continue;
      host = u.host;
    } catch { continue; }
    if (host === RAW_MIRROR_HOST) continue;
    const id = str(m.id, 40) || host;
    if (out.mirrors.some((x) => x.id === id || x.base === base)) continue;
    out.mirrors.push({ id, base, host });
  }

  return out;
}
