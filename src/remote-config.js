// The one thing the app can be told after it has shipped.
//
// A Dota patch can break a whole category of mods in an afternoon, and the app in front of
// the user was built weeks ago. Waiting for a release to say "don't install cosmetics today,
// the game crashes" is too slow, and answering it forty times in Discord is not a plan. So
// there is one small file on the same repository the catalog comes from, fetched through the
// same mirrors, that can do two things: turn a feature off with a reason, and put a dated
// notice in front of people.
//
// Everything about it is default-safe. No file, no network, malformed JSON, a field of the
// wrong type: the app behaves exactly as it does today, with everything on and nothing to
// say. A remote switch that fails open is a feature; one that fails closed is an outage.
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
const fs = require('fs');
const path = require('path');
const { fetchText } = require('./net.ts');
const { verify } = require('./catalog-signature.ts');

const CONFIG_URL = 'https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/main/config/app.json';
/** The signature, always the config's own address with .sig on the end. */
const CONFIG_SIG_URL = `${CONFIG_URL}.sig`;

/* This file is signed, and by us rather than by the catalog's author.
 *
 * It travels the same public proxies as everything else (see net.js), and it is the file that
 * can switch a feature off after a release and put a notice in front of people. A proxy
 * operator rewriting it means taking a feature away from somebody, or saying something in this
 * project's name. Both halves of this key are ours, so unlike the catalog there was nobody to
 * wait for.
 *
 * A failed check is treated as no file at all, which is what the rest of this module already
 * does with every other kind of failure. That is not a weaker choice than refusing to start:
 * the worst an attacker gets from breaking the signature is that the notices stop arriving,
 * and they could already do that by dropping the request. What they no longer get is to put
 * words on the screen.
 *
 * Signed with tools/sign-catalog.js. The private half is not in this repository and never will
 * be; test/remote-config-signature.test.js fails the build if the committed file and its
 * signature ever stop agreeing.
 */
const CONFIG_PUBLIC_KEY = 'MCowBQYDK2VwAyEA8M9IOVLfxK6V1n2fHAHlE9zzCsXFoUAJki8RdqLPBdA=';
// What the app is willing to be told to switch off. A name that is not on this list is
// ignored: a typo in the config must not disable something at random, and this list is the
// contract between the file and the code that honours it.
const SWITCHABLE = ['install', 'cosmetics', 'voice'];
/* The first version that reads `blocks`. Everything before it ignores the key entirely, which is
 * what makes adding it safe, and also what makes a block aimed at those versions do nothing, so
 * tools/rollback.mjs refuses one. 2.6.12 is the last release without it; whichever version
 * ships next is at least this one. */
const BLOCKS_SINCE = '2.6.13';
const MAX_NOTICES = 20;
// A beta is a handful of people the maintainer picked, not a rollout: a list longer than this is
// a sign the file was edited by something other than a person.
const MAX_TESTERS = 100;
/* Somewhere else the archives can be fetched from. A handful at most: the chain is walked in
   order on every download, and a host that is not really there costs a request each time. */
const MAX_MIRRORS = 4;
// the catalog's own host: a list entry claiming to be it would be claiming to be the origin
const RAW_MIRROR_HOST = 'raw.githubusercontent.com';
const MAX_TEXT = 500;

const str = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '');

// "2.0.1" -> [2, 0, 1]; anything odd sorts as 0 so a broken bound never hides a notice
const parts = (v) => String(v || '').split('.').map((n) => parseInt(n, 10) || 0);
function cmpVersion(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  }
  return 0;
}

/** Does an entry with optional version bounds and a last day hold for this build today? */
function applies(entry, version, today) {
  return (!entry.minVersion || cmpVersion(version, entry.minVersion) >= 0)
    && (!entry.maxVersion || cmpVersion(version, entry.maxVersion) <= 0)
    && (!entry.until || today <= entry.until);
}

// the last day something applies, in UTC, or null for anything that is not a real date
const validDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);

function normalize(raw) {
  const out = {
    features: {}, notices: [], blocks: [], beta: null, mirrors: [],
  };
  if (!raw || typeof raw !== 'object') return out;

  const features = raw.features && typeof raw.features === 'object' ? raw.features : {};
  for (const name of SWITCHABLE) {
    const f = features[name];
    if (!f || typeof f !== 'object' || f.off !== true) continue;
    out.features[name] = { off: true, ru: str(f.ru), en: str(f.en) };
  }

  const notices = Array.isArray(raw.notices) ? raw.notices.slice(0, MAX_NOTICES) : [];
  for (const n of notices) {
    if (!n || typeof n !== 'object') continue;
    const id = str(n.id, 80);
    if (!id) continue;
    out.notices.push({
      id,
      date: str(n.date, 20),
      level: n.level === 'warn' ? 'warn' : 'info',
      ru: str(n.ru),
      en: str(n.en),
      url: /^https:\/\//i.test(n.url || '') ? str(n.url, 300) : null,
      minVersion: str(n.minVersion, 20) || null,
      maxVersion: str(n.maxVersion, 20) || null,
      // anything but a real date means no end, so a typo never hides a notice
      until: validDay(n.until),
    });
  }

  const blocks = Array.isArray(raw.blocks) ? raw.blocks.slice(0, MAX_NOTICES) : [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    const id = str(b.id, 80);
    const until = validDay(b.until);
    /* A block with a damaged last day is dropped rather than held forever. For a notice a typo
     * errs towards showing it; for a switch the same typo would err towards an outage nobody can
     * end from the user's side, and this module fails open. */
    if (!id || !SWITCHABLE.includes(b.feature) || !until) continue;
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
  const beta = raw.beta && typeof raw.beta === 'object' ? raw.beta : null;
  if (beta) {
    const ids = (Array.isArray(beta.ids) ? beta.ids : [])
      .filter((id) => typeof id === 'string' && /^[0-9a-f]{64}$/i.test(id.trim()))
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
    if (!m || typeof m !== 'object') continue;
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

/**
 * @param {object} deps
 * @param {string} deps.userDataDir
 * @param {() => string} deps.appVersion   so a notice can be aimed at the builds it is about
 * @param {(msg: string) => void} [deps.log]
 */
/**
 * @param {object} opts
 * @param {string} opts.userDataDir  where the last good copy is kept between starts
 * @param {() => string} opts.appVersion  used to decide which notices apply
 * @param {(msg: string) => void} [opts.log]
 * @param {string} [opts.publicKey]  whose signature to accept; the pinned one unless a test
 *   wants to sign its own fixture, which it cannot do with a private key that is not here
 * @param {() => number} [opts.now]  the clock a notice's until date is read against
 */
function createRemoteConfig({ userDataDir, appVersion, log = () => {}, publicKey = CONFIG_PUBLIC_KEY, now = () => Date.now() }) {
  const file = path.join(userDataDir, 'remote-config.json');
  let cache = null;

  function read() {
    if (cache) return cache;
    try { cache = normalize(JSON.parse(fs.readFileSync(file, 'utf-8'))); } catch { cache = normalize(null); }
    return cache;
  }

  /** Fetch and cache. Never throws: being offline is the normal case, not an error. */
  async function refresh() {
    try {
      const text = await fetchText(CONFIG_URL);
      const sig = await fetchText(CONFIG_SIG_URL);
      if (!verify(text, sig, publicKey)) throw new Error('signature does not match');
      const parsed = normalize(JSON.parse(text));
      fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
      cache = parsed;
      log(`remote config: ${Object.keys(parsed.features).length} switch(es) off, ${parsed.notices.length} notice(s)`);
    } catch (err) {
      log(`remote config not fetched: ${err.message || err}`);
      read();
    }
    return cache;
  }

  /**
   * Is this feature off right now, and what should the user be told?
   * @returns {{ off: boolean, note: string }}
   */
  function feature(name, lang = 'en') {
    const cfg = read();
    const say = (e) => (lang === 'ru' ? e.ru : e.en) || e.en || e.ru || '';
    // off everywhere wins: it is the answer to something outside the app, like a Dota patch
    if (cfg.features[name]) return { off: true, note: say(cfg.features[name]) };
    const block = cfg.blocks.find((b) => b.feature === name && applies(b, appVersion(), today()));
    return block ? { off: true, note: say(block) } : { off: false, note: '' };
  }

  const today = () => new Date(now()).toISOString().slice(0, 10);

  /** Notices meant for this build, newest first, with the text already in one language. */
  function notices(lang = 'en') {
    const version = appVersion();
    const day = today();
    return read().notices
      .filter((n) => applies(n, version, day))
      .map((n) => ({ id: n.id, date: n.date, level: n.level, url: n.url, text: (lang === 'ru' ? n.ru : n.en) || n.en || n.ru || '' }))
      .filter((n) => n.text)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  /** The beta list as the signed file gives it, or null when it says nothing about one. */
  const beta = () => read().beta;

  /** Extra hosts the archives can be fetched from, for src/net.ts to put in the chain. */
  const mirrors = () => read().mirrors;

  return { refresh, feature, notices, beta, mirrors, url: CONFIG_URL, SWITCHABLE };
}

module.exports = {
  createRemoteConfig, normalize, cmpVersion, applies, SWITCHABLE, BLOCKS_SINCE, MAX_TESTERS,
  MAX_MIRRORS,
  CONFIG_URL, CONFIG_SIG_URL, CONFIG_PUBLIC_KEY,
};
