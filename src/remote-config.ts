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
// The format and its checks are src/remote-config-format.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fetchText } from './net.ts';
import { verify } from './catalog-signature.ts';
import { SWITCHABLE, applies, normalize, type RemoteConfig } from './remote-config-format.ts';

/** The config every copy of the app reads, on main in this repository. */
export const CONFIG_URL = 'https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/main/config/app.json';
/** The signature, always the config's own address with .sig on the end. */
export const CONFIG_SIG_URL = `${CONFIG_URL}.sig`;

/* This file is signed, and by us rather than by the catalog's author.
 *
 * It travels the same public proxies as everything else (see src/net.ts), and it is the file that
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
 * be; test/remote-config-signature.test.ts fails the build if the committed file and its
 * signature ever stop agreeing.
 */
export const CONFIG_PUBLIC_KEY = 'MCowBQYDK2VwAyEA8M9IOVLfxK6V1n2fHAHlE9zzCsXFoUAJki8RdqLPBdA=';

/**
 * @param opts.userDataDir  where the last good copy is kept between starts
 * @param opts.appVersion   used to decide which notices apply
 * @param opts.publicKey    whose signature to accept; the pinned one unless a test
 *   wants to sign its own fixture, which it cannot do with a private key that is not here
 * @param opts.now          the clock a notice's until date is read against
 */
export function createRemoteConfig({ userDataDir, appVersion, log = () => {}, publicKey = CONFIG_PUBLIC_KEY, now = () => Date.now() }: {
  userDataDir: string; appVersion: () => string; log?: (msg: string) => void; publicKey?: string; now?: () => number;
}) {
  const file = path.join(userDataDir, 'remote-config.json');
  let cache: RemoteConfig | null = null;

  function read(): RemoteConfig {
    if (cache) return cache;
    try { cache = normalize(JSON.parse(fs.readFileSync(file, 'utf-8'))); } catch { cache = normalize(null); }
    return cache;
  }

  /** Fetch and cache. Never throws: being offline is the normal case, not an error. */
  async function refresh(): Promise<RemoteConfig | null> {
    try {
      const text = await fetchText(CONFIG_URL);
      const sig = await fetchText(CONFIG_SIG_URL);
      if (!verify(text, sig, publicKey)) throw new Error('signature does not match');
      const parsed = normalize(JSON.parse(text));
      fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
      cache = parsed;
      log(`remote config: ${Object.keys(parsed.features).length} switch(es) off, ${parsed.notices.length} notice(s)`);
    } catch (err) {
      log(`remote config not fetched: ${err instanceof Error ? err.message : err}`);
      read();
    }
    return cache;
  }

  /**
   * Is this feature off right now, and what should the user be told?
   */
  function feature(name: string, lang = 'en'): { off: boolean; note: string } {
    const cfg = read();
    const say = (e: { ru: string; en: string }) => (lang === 'ru' ? e.ru : e.en) || e.en || e.ru || '';
    // off everywhere wins: it is the answer to something outside the app, like a Dota patch
    const off = cfg.features[name];
    if (off) return { off: true, note: say(off) };
    const block = cfg.blocks.find((b) => b.feature === name && applies(b, appVersion(), today()));
    return block ? { off: true, note: say(block) } : { off: false, note: '' };
  }

  const today = () => new Date(now()).toISOString().slice(0, 10);

  /** Notices meant for this build, newest first, with the text already in one language. */
  function notices(lang = 'en'): { id: string; date: string; level: string; url: string | null; text: string }[] {
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

export { SWITCHABLE, BLOCKS_SINCE, MAX_TESTERS, MAX_MIRRORS, cmpVersion, applies, normalize } from './remote-config-format.ts';
export type { Off, RemoteNotice, RemoteBlock, RemoteMirror, RemoteConfig } from './remote-config-format.ts';
