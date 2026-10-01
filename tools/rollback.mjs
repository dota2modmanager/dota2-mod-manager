#!/usr/bin/env node
/**
 * Switch a feature off for the releases that are broken, without shipping another one.
 *
 * On 2026-09-10 installing broke for everyone, and the answer was five releases in a row.
 * config/app.json could already switch a feature off, but only in every version at once, which
 * also switches off the release that fixes it; and the file had to be edited by hand, in JSON, in
 * the middle of an incident, then signed with the right key or every copy of the app would
 * quietly ignore it. This does all of that as one command and refuses the mistakes.
 *
 *   node tools/rollback.mjs list
 *   node tools/rollback.mjs block install --versions 2.7.0 --until 2026-09-27 --en "…" --ru "…"
 *   node tools/rollback.mjs block install --versions 2.7.0-2.7.2 --until … --en … --ru … --url https://…
 *   node tools/rollback.mjs lift 2026-09-16-install-2.7.0
 *   node tools/rollback.mjs everywhere install --en "…" --ru "…"     every version, old ones too
 *   node tools/rollback.mjs restore install
 *   node tools/rollback.mjs prune                                     drop what is past its day
 *   node tools/rollback.mjs invite 123456789012345678               offer this account the beta
 *   node tools/rollback.mjs uninvite 123456789012345678             take it back off the list
 *   node tools/rollback.mjs mirror https://host/path/              another copy of the archives
 *   node tools/rollback.mjs unmirror gitlab.com                    stop sending anybody there
 *   node tools/rollback.mjs sign                                      sign the file as it stands
 *
 * A block goes under `blocks`, which copies before BLOCKS_SINCE never read (see
 * src/remote-config.js), and comes with a notice for the same versions and days, so the people
 * it affects are told why. The beta list goes under `beta` and holds hashes rather than ids,
 * because this file is public and a list of a dozen people's Discord accounts is not ours to
 * publish. Anything that writes the file signs it when CATALOG_KEY points at the private key,
 * and refuses a key the app does not pin.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  normalize, cmpVersion, SWITCHABLE, BLOCKS_SINCE, MAX_TESTERS, MAX_MIRRORS, CONFIG_PUBLIC_KEY,
} = require('../src/remote-config.js');
const { idHash } = require('../src/beta.ts');
const { verify } = require('../src/catalog-signature.ts');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG = path.join(root, 'config', 'app.json');

const README = 'What the app reads after it has shipped: src/remote-config.js. Everything here is '
  + 'optional; an empty file means the app behaves exactly as built. Switch names the app honours: '
  + `${SWITCHABLE.join(', ')}. "features" switches one off in every version. "blocks" switch one off `
  + `for a range of versions until a day, and only copies from ${BLOCKS_SINCE} read them. A notice needs `
  + 'an id, text in at least one language and an until date (YYYY-MM-DD, the last day it shows); url '
  + 'must be https; minVersion and maxVersion bound the versions it is meant for. Copies older than '
  + 'the until field ignore it, so take a notice out once its date has passed. Write this file with '
  + 'tools/rollback.mjs, which signs it. "beta" is who is offered the unreleased build, as hashes; '
  + '"mirrors" name other places the archives can be fetched from, tried after the ones built '
  + 'into the app.';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function requireSwitch(feature) {
  if (!SWITCHABLE.includes(feature)) {
    throw new Error(`"${feature}" is not a switch the app honours; it knows ${SWITCHABLE.join(', ')}`);
  }
}

function requireText(en, ru) {
  if (!String(en || '').trim() || !String(ru || '').trim()) {
    throw new Error('both --en and --ru are needed: whoever is affected is told why, in their language');
  }
}

/** "2.7.0" or "2.7.0-2.7.2" into bounds, refusing anything else. */
export function parseVersions(text) {
  const m = String(text || '').trim().match(/^(\d+\.\d+\.\d+)(?:\s*-\s*(\d+\.\d+\.\d+))?$/);
  if (!m) throw new Error(`--versions must look like 2.7.0 or 2.7.0-2.7.2, not "${text}"`);
  const minVersion = m[1];
  const maxVersion = m[2] || m[1];
  if (cmpVersion(minVersion, maxVersion) > 0) throw new Error(`${minVersion} comes after ${maxVersion}`);
  return { minVersion, maxVersion };
}

/**
 * The config with a feature switched off for a range of versions until a day, and a notice that
 * says so to exactly those versions.
 * @returns {{ config: object, id: string }}
 */
export function addBlock(config, { feature, versions, until, en, ru, url = null }, today) {
  requireSwitch(feature);
  const { minVersion, maxVersion } = parseVersions(versions);
  if (cmpVersion(minVersion, BLOCKS_SINCE) < 0) {
    throw new Error(`copies before ${BLOCKS_SINCE} do not read blocks, so a block reaching down to `
      + `${minVersion} would do nothing there. For those, switch the feature off everywhere `
      + '(tools/rollback.mjs everywhere …) until the fix is out, and take it out again after.');
  }
  if (!DAY.test(until || '') || Number.isNaN(Date.parse(`${until}T00:00:00Z`))) {
    throw new Error(`--until must be a day like 2026-09-27, not "${until}"`);
  }
  if (until < today) throw new Error(`--until ${until} is already past, and a block past its day does nothing`);
  requireText(en, ru);
  if (url != null && !/^https:\/\//i.test(url)) throw new Error('--url must be https');

  const range = minVersion === maxVersion ? minVersion : `${minVersion}-${maxVersion}`;
  const id = `${today}-${feature}-${range}`;
  const next = structuredClone(config);
  next.blocks = (next.blocks || []).filter((b) => b.id !== id);
  next.notices = (next.notices || []).filter((n) => n.id !== id);
  next.blocks.push({ id, feature, minVersion, maxVersion, until, en, ru });
  next.notices.push({ id, date: today, until, level: 'warn', minVersion, maxVersion, en, ru, ...(url ? { url } : {}) });

  // the app has to agree it is a block, or this wrote a file that does nothing
  if (!normalize(next).blocks.some((b) => b.id === id)) throw new Error(`the app would not honour block ${id}`);
  return { config: next, id };
}

/** Take a block and the notice that came with it back out. */
export function liftBlock(config, id) {
  const next = structuredClone(config);
  const before = (next.blocks || []).length + (next.notices || []).length;
  next.blocks = (next.blocks || []).filter((b) => b.id !== id);
  next.notices = (next.notices || []).filter((n) => n.id !== id);
  if (before === next.blocks.length + next.notices.length) {
    throw new Error(`nothing has the id ${id}; see: node tools/rollback.mjs list`);
  }
  if (!next.blocks.length) delete next.blocks;
  return next;
}

/** Switch a feature off in every version, the old ones included. */
export function switchOff(config, { feature, en, ru }) {
  requireSwitch(feature);
  requireText(en, ru);
  const next = structuredClone(config);
  next.features = { ...(next.features || {}), [feature]: { off: true, en, ru } };
  return next;
}

export function switchOn(config, feature) {
  if (!(config.features || {})[feature]) {
    throw new Error(`${feature} is not switched off everywhere; see: node tools/rollback.mjs list`);
  }
  const next = structuredClone(config);
  delete next.features[feature];
  return next;
}

/** Drop the blocks and notices whose last day has gone. */
export function pruneExpired(config, today) {
  const next = structuredClone(config);
  const gone = new Set();
  const keep = (e) => {
    if (e.until && e.until < today) { gone.add(e.id); return false; }
    return true;
  };
  next.blocks = (next.blocks || []).filter(keep);
  next.notices = (next.notices || []).filter(keep);
  if (!next.blocks.length) delete next.blocks;
  return { config: next, gone: [...gone] };
}

/* ---------- who is offered the beta ---------- */

/** A Discord account id is a snowflake: 17-20 digits. Anything else is a typo, not an account. */
const SNOWFLAKE = /^\d{17,20}$/;

function requireAccount(discordId) {
  const id = String(discordId || '').trim();
  if (!SNOWFLAKE.test(id)) {
    throw new Error(`"${id}" is not a Discord account id. It is 17-20 digits, from Discord's own `
      + 'Developer Mode: right-click the person, Copy User ID.');
  }
  return id;
}

/**
 * Put an account on the beta list.
 *
 * The file is public, so it holds sha256(salt:id) and never the id. The salt is made once and kept:
 * it does not hide an id from somebody who already has that id in mind, and it does stop the file
 * being a ready-made list to look up. Adding somebody twice is not an error - the same id hashes to
 * the same line, and the answer to "is this person on the list" is yes either way.
 */
export function invite(config, discordId) {
  const id = requireAccount(discordId);
  const next = structuredClone(config);
  const beta = next.beta && typeof next.beta === 'object' ? { ...next.beta } : {};
  beta.salt = String(beta.salt || '') || crypto.randomBytes(16).toString('hex');
  const ids = Array.isArray(beta.ids) ? [...beta.ids] : [];
  const hash = idHash(id, beta.salt);
  const already = ids.includes(hash);
  if (!already) ids.push(hash);
  if (ids.length > MAX_TESTERS) {
    throw new Error(`the app reads the first ${MAX_TESTERS} on the list and ignores the rest; `
      + 'take somebody off before adding another');
  }
  next.beta = { ...beta, ids };
  return { config: next, already };
}

/**
 * Take an account back off. The hash is worked out the same way, so an id is enough; a list that
 * empties loses the block entirely, because no list and an empty one mean the same thing to the app.
 */
export function uninvite(config, discordId) {
  const id = requireAccount(discordId);
  const salt = config.beta && config.beta.salt;
  if (!salt) throw new Error('nobody is on the list yet');
  const next = structuredClone(config);
  const hash = idHash(id, salt);
  const ids = (next.beta.ids || []).filter((x) => x !== hash);
  const found = ids.length !== (next.beta.ids || []).length;
  if (ids.length) next.beta = { ...next.beta, ids };
  else delete next.beta;
  return { config: next, found };
}

/* ---------- where else the archives can be fetched from ---------- */

/**
 * Name another copy of the catalog's archives.
 *
 * The rules are the app's, not this tool's: normalize() decides what a copy of the app would
 * actually take, and anything it drops is refused here rather than written and ignored. The base
 * is the part before what the catalog calls assets/files/, so the mod's own path is appended to
 * it unchanged.
 */
export function addMirror(config, base, { id = '' } = {}) {
  const next = structuredClone(config);
  const list = Array.isArray(next.mirrors) ? [...next.mirrors] : [];
  if (list.length >= MAX_MIRRORS) {
    throw new Error(`the app reads the first ${MAX_MIRRORS} mirrors and ignores the rest; take one out first`);
  }
  // one more than the file already had: the same base twice is one entry to the app, not two
  const before = normalize({ mirrors: list }).mirrors.length;
  const kept = normalize({ mirrors: [...list, id ? { id, base } : { base }] }).mirrors;
  const mine = kept.length === before + 1 ? kept[kept.length - 1] : null;
  if (!mine) {
    throw new Error(`the app would not take "${base}". It has to be https, with no query and no `
      + 'credentials, a path ending in /, not raw.githubusercontent.com, and not one already here.');
  }
  next.mirrors = [...list, { id: mine.id, base }];
  return { config: next, id: mine.id };
}

/** Stop sending anybody there, by the id it was given or by its host. */
export function dropMirror(config, which) {
  const name = String(which || '').trim();
  const list = Array.isArray(config.mirrors) ? config.mirrors : [];
  const hostOf = (base) => { try { return new URL(base).host; } catch { return ''; } };
  const rest = list.filter((m) => m.id !== name && hostOf(m.base) !== name);
  if (rest.length === list.length) throw new Error(`no mirror here is called "${name}"`);
  const next = structuredClone(config);
  if (rest.length) next.mirrors = rest;
  else delete next.mirrors;
  return next;
}

/** What the file is doing today, one line each. */
export function describe(config, today) {
  const lines = [];
  for (const [name, f] of Object.entries(config.features || {})) {
    if (f && f.off === true) lines.push(`OFF EVERYWHERE  ${name}: ${f.en || f.ru || ''}`);
  }
  const blockIds = new Set();
  for (const b of config.blocks || []) {
    blockIds.add(b.id);
    const range = b.minVersion === b.maxVersion ? b.minVersion : `${b.minVersion}-${b.maxVersion}`;
    lines.push(`${b.until < today ? 'expired ' : 'blocked '}        ${b.feature} in ${range} until ${b.until}  (${b.id})`);
  }
  for (const n of config.notices || []) {
    if (blockIds.has(n.id)) continue;
    lines.push(`${n.until && n.until < today ? 'expired ' : 'notice  '}        ${n.id} until ${n.until || 'no end'}`);
  }
  for (const m of config.mirrors || []) lines.push(`mirror          ${m.id}: ${m.base}`);
  const testers = ((config.beta || {}).ids || []).length;
  if (testers) lines.push(`beta            ${testers} account(s) offered the unreleased build`);
  return lines.length ? lines : ['nothing is switched off and nobody is told anything'];
}

/** The bytes to commit: LF only, because the signature is over what git publishes. */
export function serialize(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Sign, and refuse a key the app does not pin. A file signed with any other key is one every copy
 * of the app ignores without a word, which is the worst way for a switch to fail in an emergency.
 */
export function signFor(bytes, privatePem, pinned = CONFIG_PUBLIC_KEY) {
  const sig = crypto.sign(null, bytes, crypto.createPrivateKey(privatePem)).toString('base64');
  if (!verify(bytes, sig, pinned)) {
    throw new Error('this key is not the one the app pins (CONFIG_PUBLIC_KEY in src/remote-config.js): '
      + 'every copy would ignore what it signed');
  }
  return `${sig}\n`;
}

/* ---------- the command ---------- */

function parseArgs(argv) {
  const [command, subject, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const key = rest[i].slice(2);
    flags[key] = rest[i + 1] !== undefined && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  }
  return { command, subject, flags };
}

/** Write the file, signed when the key is here; sign first, so a wrong key writes nothing. */
function write(next, today) {
  const { _readme: _dropped, ...rest } = next;
  const bytes = Buffer.from(serialize({ _readme: README, ...rest }), 'utf8');
  const keyFile = process.env.CATALOG_KEY;
  const sig = keyFile && fs.existsSync(keyFile) ? signFor(bytes, fs.readFileSync(keyFile, 'utf8')) : null;
  fs.writeFileSync(CONFIG, bytes);
  if (sig) {
    fs.writeFileSync(`${CONFIG}.sig`, sig);
    console.log('written and signed with the key the app pins');
  } else {
    console.log('WRITTEN BUT NOT SIGNED. Every copy of the app ignores the file until it is:');
    console.log('  CATALOG_KEY=/path/to/config-key.pem node tools/rollback.mjs sign');
  }
  for (const line of describe(next, today)) console.log(`  ${line}`);
  console.log('\nThen config/app.json and config/app.json.sig go in one pull request, merged through the checks.');
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { command = 'list', subject, flags } = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    if (command === 'list') {
      for (const line of describe(config, today)) console.log(line);
    } else if (command === 'sign') {
      const keyFile = process.env.CATALOG_KEY;
      if (!keyFile || !fs.existsSync(keyFile)) throw new Error('CATALOG_KEY has to point at the private key');
      fs.writeFileSync(`${CONFIG}.sig`, signFor(fs.readFileSync(CONFIG), fs.readFileSync(keyFile, 'utf8')));
      console.log('config/app.json.sig written with the key the app pins');
    } else if (command === 'block') {
      const { config: next, id } = addBlock(config, {
        feature: subject, versions: flags.versions, until: flags.until, en: flags.en, ru: flags.ru, url: flags.url,
      }, today);
      console.log(`block ${id}`);
      write(next, today);
    } else if (command === 'lift') {
      write(liftBlock(config, subject), today);
    } else if (command === 'everywhere') {
      write(switchOff(config, { feature: subject, en: flags.en, ru: flags.ru }), today);
    } else if (command === 'restore') {
      write(switchOn(config, subject), today);
    } else if (command === 'invite') {
      const { config: next, already } = invite(config, subject);
      console.log(already ? 'already on the list; the file is unchanged in what it says' : 'on the list');
      write(next, today);
    } else if (command === 'uninvite') {
      const { config: next, found } = uninvite(config, subject);
      if (!found) console.log('that account was not on the list; writing the file anyway, so it is signed as it stands');
      write(next, today);
    } else if (command === 'mirror') {
      const { config: next, id } = addMirror(config, subject, { id: flags.id === true ? '' : flags.id });
      console.log(`mirror ${id}`);
      write(next, today);
    } else if (command === 'unmirror') {
      write(dropMirror(config, subject), today);
    } else if (command === 'prune') {
      const { config: next, gone } = pruneExpired(config, today);
      if (!gone.length) console.log('nothing is past its day');
      else { console.log(`past their day, taken out: ${gone.join(', ')}`); write(next, today); }
    } else {
      throw new Error(`no command "${command}"; the list is at the top of tools/rollback.mjs`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
