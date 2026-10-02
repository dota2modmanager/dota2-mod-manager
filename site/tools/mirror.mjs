/**
 * A second place to get the files the app cannot start without.
 *
 * Everything the app reads at startup - the catalog, its constants, its guides, the
 * fingerprint map - lives in a GitHub repository, and every mirror the app knows is a proxy
 * standing in front of that same repository. On 2026-08-17 GitHub was down for three hours
 * and all of them went with it: the window opened, the catalog was empty, and there was
 * nothing anybody could do about it.
 *
 * This copies those files into the site's own deploy, so the app has one source that does not
 * share GitHub's fate. The site rebuilds daily and after every release, which makes the copy
 * at most a day behind, and a day-old list of mods beats an empty window by a distance.
 *
 * Nothing here is committed: the files are written into dist/ after the build and go out with
 * the deploy. A failure prints and returns success on purpose - a mirror that could not be
 * refreshed is a worse site, not a broken one, and blocking the deploy over it would take the
 * whole site down for a problem that only matters while GitHub is unreachable.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'dist', 'mirror');
const SIG = '.sig';

const CATALOG = 'https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main/assets/data/';
const SIGNATURES = 'https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main/assets/signatures/';

/* The signatures travel with the files they sign.
 *
 * Once the catalog's key is pinned in the client, a file without its signature is a file the
 * app refuses. Mirroring the data and not the .sig would leave this copy useless on exactly
 * the day it is needed: the outage this whole file exists for is one where GitHub is
 * unreachable, every proxy is GitHub wearing another hostname, and this site is the only
 * source left. The data would arrive and the signature would have nowhere to come from.
 */
const SOURCES = [
  ['mods.json', `${CATALOG}mods.json`],
  ['constants.json', `${CATALOG}constants.json`],
  ['guides.json', `${CATALOG}guides.json`],
  ['mods.json.sig', `${SIGNATURES}mods.json.sig`],
  ['constants.json.sig', `${SIGNATURES}constants.json.sig`],
  ['guides.json.sig', `${SIGNATURES}guides.json.sig`],
  ['mod-hashes.json', `${CATALOG}mod-hashes.json`],
  ['mod-hashes.json.sig', `${SIGNATURES}mod-hashes.json.sig`],
  ['fingerprints.json', 'https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/catalog-data/fingerprints.json'],
  ['app.json', 'https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/main/config/app.json'],
  ['app.json.sig', 'https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/main/config/app.json.sig'],
];

async function one(name, url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'dota2modmanager-site-mirror' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // A truncated download must not be published as if it were the real thing. For the data
  // that means it has to parse; for a signature it means the exact shape ed25519 produces,
  // 88 base64 characters, because a 404 page served with a 200 is also 'text' and would sail
  // through anything looser.
  if (name.endsWith(SIG)) {
    if (!/^[A-Za-z0-9+/]{86}==$|^[A-Za-z0-9+/]{87}=$|^[A-Za-z0-9+/]{88}$/.test(text.trim())) {
      throw new Error('not an ed25519 signature');
    }
  } else {
    JSON.parse(text);
  }
  fs.writeFileSync(path.join(OUT, name), text);
  return text.length;
}

fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
for (const [name, url] of SOURCES) {
  try {
    const bytes = await one(name, url);
    console.log(`mirror: ${name.padEnd(18)} ${(bytes / 1024).toFixed(0)} KB`);
  } catch (e) {
    failed++;
    console.log(`mirror: ${name.padEnd(18)} skipped (${e.message})`);
  }
}
console.log(failed ? `${SOURCES.length - failed} of ${SOURCES.length} mirrored` : 'all mirrored');
