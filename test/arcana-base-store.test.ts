/* The arcana bases brought down and kept (src/arcana-base-store.ts), against a repository served
 * from memory: what the store asks for, what it keeps, and what a build gets back.
 *
 * What matters: a build never gets half a base or bytes the repository does not name; a base that
 * is here keeps working with no network; a new version replaces the old one only once it is whole;
 * and a build that runs on every pick does not turn into a request on every pick. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { blobSha, createBaseStore, signedListing, safeListing, BASES_REPO, BASES_PUBLIC_KEY, type Listing } from '../src/arcana-base-store.ts';
import { entryPath } from '../src/vpk.ts';

const RAW = `https://raw.githubusercontent.com/${BASES_REPO}/main/`;
/** A key of the tests' own: the pinned one's private half is not in the repository. */
const pair = crypto.generateKeyPairSync('ed25519');
const KEY = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const sign = (text: string, key = pair.privateKey) => crypto.sign(null, Buffer.from(text), key).toString('base64');

/** What tools/arcana-bases-manifest.mjs writes for these files: each base under src/<id>/, its VPK left out. */
function manifestOf(files: Record<string, string>): string {
  const bases: Listing = {};
  for (const [p, body] of Object.entries(files)) {
    const m = /^src\/([^/]+)\/(.+)$/.exec(p);
    if (!m || (!m[2].includes('/') && m[2].endsWith('.vpk'))) continue;
    (bases[m[1]] ||= {})[m[2]] = blobSha(Buffer.from(body));
  }
  return `${JSON.stringify({ bases }, null, 1)}\n`;
}

/** A repository: files by path, its signed manifest, served as GitHub would, and every URL asked for. */
function repo(files: Record<string, string>) {
  const state = { files: { ...files }, offline: false, manifest: null as string | null, sig: null as string | null };
  const asked: string[] = [];
  /** the manifest and signature as the tool would write them for the files as they are now */
  const publish = () => { state.manifest = manifestOf(state.files); state.sig = sign(state.manifest); };
  publish();
  const fetchUrl = async (url: string) => {
    asked.push(url);
    if (state.offline) throw new Error('fetch failed');
    const rel = decodeURIComponent(url.slice(RAW.length));
    if (rel === 'manifest.json') return state.manifest === null ? new Response('', { status: 404 }) : new Response(state.manifest);
    if (rel === 'manifest.json.sig') return state.sig === null ? new Response('', { status: 404 }) : new Response(`${state.sig}\n`);
    const body = state.files[rel];
    return body === undefined ? new Response('', { status: 404 }) : new Response(body);
  };
  return { state, asked, fetchUrl, publish };
}

function store(t: TestContext, r: ReturnType<typeof repo>, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-basestore-'))) {
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ready: string[] = [];
  const said: string[] = [];
  const s = createBaseStore({ dir, key: KEY, fetchUrl: r.fetchUrl, onReady: (id) => ready.push(id), log: (m) => said.push(m) });
  return { s, dir, ready, said };
}

const JUGG = {
  'src/bladeform_legacy/models/heroes/juggernaut/juggernaut.vmdl_c': 'body',
  'src/bladeform_legacy/particles/econ/items/juggernaut/Blade Fury.vpcf_c': 'fury',
  'src/bladeform_legacy/pak29_dir.vpk': 'the same files packed',
  'README.md': 'not a base',
};

test("a signed manifest lists each base's files with their hash; any other signature, or none, lists nothing", () => {
  const r = repo(JUGG);
  const listing = signedListing(r.state.manifest!, r.state.sig!, KEY)!;
  assert.deepEqual(Object.keys(listing), ['bladeform_legacy']);
  assert.deepEqual(Object.keys(listing.bladeform_legacy).sort(), ['models/heroes/juggernaut/juggernaut.vmdl_c', 'particles/econ/items/juggernaut/Blade Fury.vpcf_c']);
  assert.equal(listing.bladeform_legacy['models/heroes/juggernaut/juggernaut.vmdl_c'], blobSha(Buffer.from('body')));
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.equal(signedListing(r.state.manifest!, sign(r.state.manifest!, other), KEY), null, "another key's signature");
  assert.equal(signedListing(r.state.manifest!.replace('"body"', '"x"').replace(/"[0-9a-f]{40}"/, `"${blobSha(Buffer.from('x'))}"`), r.state.sig!, KEY), null, 'a manifest changed after it was signed');
  assert.equal(signedListing(r.state.manifest!, '', KEY), null, 'no signature');
  assert.equal(signedListing('not json', sign('not json'), KEY), null, 'signed, but not a manifest');
  // the pinned key is a real ed25519 key: a typo in it would refuse every list, quietly, for everybody
  assert.equal(crypto.createPublicKey({ key: Buffer.from(BASES_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType, 'ed25519');
  assert.equal(signedListing(r.state.manifest!, r.state.sig!), null, 'and it is not the tests\' key');
});

test('a base asked for comes down whole, is said to be ready once, and a build gets its files', async (t) => {
  const r = repo(JUGG);
  const { s, ready } = store(t, r);
  assert.equal(s.entries('bladeform_legacy'), null, 'not here yet');
  assert.equal(await s.want('bladeform_legacy'), true);
  assert.deepEqual(ready, ['bladeform_legacy']);
  const entries = s.entries('bladeform_legacy')!;
  assert.deepEqual(entries.map(entryPath).sort(), ['models/heroes/juggernaut/juggernaut.vmdl_c', 'particles/econ/items/juggernaut/blade fury.vpcf_c']);
  assert.equal(entries.find((e) => e.name === 'juggernaut')!.data.toString(), 'body');
  assert.ok(r.asked.some((u) => u.endsWith('/Blade%20Fury.vpcf_c')), 'a name with a space is asked for as a URL');
  assert.ok(!r.asked.some((u) => u.endsWith('.vpk')), 'the VPK is never brought down');
  const before = r.asked.length;
  assert.equal(await s.want('bladeform_legacy'), true, 'asked again in the same run: the same answer');
  assert.equal(r.asked.length, before, 'nothing asked of the network');
});

test('a file that is not what the repository names is refused, and the base is not ready', async (t) => {
  const r = repo(JUGG);
  // a mirror, or a push halfway through, hands over other bytes than the manifest names
  const fetchUrl: typeof r.fetchUrl = async (url) => {
    if (url.endsWith('juggernaut.vmdl_c')) return new Response('something a mirror made up');
    return r.fetchUrl(url);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-basestore-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ready: string[] = [];
  const said: string[] = [];
  const s = createBaseStore({ dir, key: KEY, fetchUrl, onReady: (id) => ready.push(id), log: (m) => said.push(m) });
  assert.equal(await s.want('bladeform_legacy'), false);
  assert.equal(s.entries('bladeform_legacy'), null, 'no half a base');
  assert.deepEqual(ready, []);
  assert.ok(said.some((m) => /not the file the repository names/.test(m)), said.join(' | '));
});

test('with no network a base that is here keeps working, and one that is not waits before it is asked again', async (t) => {
  const r = repo(JUGG);
  const { s, dir } = store(t, r);
  await s.want('bladeform_legacy');
  r.state.offline = true;
  const again = createBaseStore({ dir, key: KEY, fetchUrl: r.fetchUrl });
  assert.equal(await again.want('bladeform_legacy'), false, 'the last list, and every file is here');
  assert.ok(again.entries('bladeform_legacy'), 'still built with');
  const said: string[] = [];
  const empty = createBaseStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-basestore-')), key: KEY, fetchUrl: r.fetchUrl, log: (m) => said.push(m) });
  assert.equal(await empty.want('bladeform_legacy'), false);
  assert.ok(said.some((m) => /could not be brought down/.test(m)), 'said in the log, not thrown');
  const asked = r.asked.length;
  assert.equal(await empty.want('bladeform_legacy'), false);
  assert.equal(r.asked.length, asked, 'the next build does not ask again at once');
});

test('a manifest the key did not sign is refused: nothing new comes down, and the list from last time stays', async (t) => {
  const r = repo(JUGG);
  const { s, dir } = store(t, r);
  assert.equal(await s.want('bladeform_legacy'), true);
  // somebody who can push, but has not the key: a new body, the manifest written to match, the old signature
  r.state.files['src/bladeform_legacy/models/heroes/juggernaut/juggernaut.vmdl_c'] = 'a body nobody signed';
  const sig = r.state.sig;
  r.publish();
  r.state.sig = sig;
  const said: string[] = [];
  const next = createBaseStore({ dir, key: KEY, fetchUrl: r.fetchUrl, log: (m) => said.push(m) });
  assert.equal(await next.want('bladeform_legacy'), false);
  assert.ok(said.some((m) => /not signed by the bases' key/.test(m)), said.join(' | '));
  assert.equal(next.entries('bladeform_legacy')!.find((e) => e.name === 'juggernaut')!.data.toString(), 'body', 'the signed version is still built with');
  assert.ok(!r.asked.some((u) => u.endsWith('juggernaut.vmdl_c') && r.asked.indexOf(u) !== r.asked.lastIndexOf(u)), 'the unsigned body is never asked for');
  // and with no signature at all, the same
  r.state.sig = null;
  const third = createBaseStore({ dir, key: KEY, fetchUrl: r.fetchUrl });
  assert.equal(await third.want('bladeform_legacy'), false);
  assert.ok(third.entries('bladeform_legacy'));
});

test('a list kept from before the signing, or changed on disk, is not taken', async (t) => {
  const r = repo(JUGG);
  const { s, dir } = store(t, r);
  await s.want('bladeform_legacy');
  r.state.offline = true;
  const listingFile = path.join(dir, 'listing.json');
  const kept = JSON.parse(fs.readFileSync(listingFile, 'utf8'));
  fs.writeFileSync(listingFile, JSON.stringify({ etag: '"old"', bases: signedListing(kept.manifest, kept.sig, KEY) }));
  fs.rmSync(path.join(dir, 'ready.json'));
  const said: string[] = [];
  const old = createBaseStore({ dir, key: KEY, fetchUrl: r.fetchUrl, log: (m) => said.push(m) });
  assert.equal(await old.want('bladeform_legacy'), false, 'the tree-era list on disk is no list');
  assert.ok(said.some((m) => /could not be brought down/.test(m)));
  fs.writeFileSync(listingFile, JSON.stringify({ manifest: kept.manifest.replace('bladeform_legacy', 'bladeform_legacx'), sig: kept.sig }));
  const changed = createBaseStore({ dir, key: KEY, fetchUrl: r.fetchUrl });
  assert.equal(await changed.want('bladeform_legacx'), false, 'nor one edited after it was signed');
});

test('a new signed version replaces the old once whole, the old files go, and an unchanged one brings nothing', async (t) => {
  const r = repo(JUGG);
  const { s, dir } = store(t, r);
  await s.want('bladeform_legacy');
  const blobs = () => fs.readdirSync(path.join(dir, 'blobs')).sort();
  const old = blobs();
  r.state.files['src/bladeform_legacy/models/heroes/juggernaut/juggernaut.vmdl_c'] = 'body, fixed again';
  r.publish();
  const ready: string[] = [];
  const next = createBaseStore({ dir, key: KEY, fetchUrl: r.fetchUrl, onReady: (id) => ready.push(id) });
  assert.equal(await next.want('bladeform_legacy'), true);
  assert.deepEqual(ready, ['bladeform_legacy']);
  assert.equal(next.entries('bladeform_legacy')!.find((e) => e.name === 'juggernaut')!.data.toString(), 'body, fixed again');
  assert.equal(blobs().length, old.length, 'the old body is swept, the particle shared');
  assert.ok(!blobs().includes(blobSha(Buffer.from('body'))));
  const third = createBaseStore({ dir, key: KEY, fetchUrl: r.fetchUrl });
  assert.equal(await third.want('bladeform_legacy'), false, 'the same manifest: nothing to do');
  assert.equal(r.asked.filter((u) => u.includes('juggernaut.vmdl_c')).length, 2, 'each body asked for once');
});

test('a file deleted by hand makes the base not ready, and the next want brings it back', async (t) => {
  const r = repo(JUGG);
  const { s, dir } = store(t, r);
  await s.want('bladeform_legacy');
  fs.rmSync(path.join(dir, 'blobs', blobSha(Buffer.from('body'))));
  assert.equal(s.entries('bladeform_legacy'), null);
  const next = createBaseStore({ dir, key: KEY, fetchUrl: r.fetchUrl });
  assert.equal(await next.want('bladeform_legacy'), true);
  assert.ok(next.entries('bladeform_legacy'));
});

test("two bases coming down at once keep each other's files: the first one whole does not sweep the second's", async (t) => {
  /* Anti-Mage's and Invoker's bases came down together on 2026-10-27, and Anti-Mage's sweep took a
     file Invoker's had already brought: his base was ready with a file missing, every build that
     run made him from the game's files, and his plain dress showed under the persona. */
  const r = repo({
    ...JUGG,
    'src/acolyte/models/heroes/invoker/invoker.vmdl_c': 'kid',
    'src/acolyte/models/heroes/invoker/invoker/invoker_kid_vmorf.vtex_c': 'morph',
    'src/acolyte/models/heroes/invoker/invoker_dress.vmdl_c': 'empty',
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const fetchUrl: typeof r.fetchUrl = async (url) => {
    if (url.endsWith('invoker_dress.vmdl_c')) await held;
    return r.fetchUrl(url);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-basestore-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = createBaseStore({ dir, key: KEY, fetchUrl });
  const invoker = s.want('acolyte');
  // the kid's body and morph are on the disk, his dress still coming, when Juggernaut's is whole
  while (!fs.existsSync(path.join(dir, 'blobs', blobSha(Buffer.from('morph'))))) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(await s.want('bladeform_legacy'), true);
  release();
  assert.equal(await invoker, true);
  assert.deepEqual(s.entries('acolyte')?.map(entryPath).sort(), [
    'models/heroes/invoker/invoker.vmdl_c', 'models/heroes/invoker/invoker/invoker_kid_vmorf.vtex_c', 'models/heroes/invoker/invoker_dress.vmdl_c',
  ]);
  assert.ok(s.entries('bladeform_legacy'));
});

test('a base missing a file is brought down again by the next want of the same run', async (t) => {
  const r = repo(JUGG);
  const { s, dir, ready } = store(t, r);
  await s.want('bladeform_legacy');
  fs.rmSync(path.join(dir, 'blobs', blobSha(Buffer.from('body'))));
  assert.equal(s.entries('bladeform_legacy'), null);
  assert.equal(await s.want('bladeform_legacy'), true, 'not the answer from before the file went');
  assert.ok(s.entries('bladeform_legacy'));
  assert.deepEqual(ready, ['bladeform_legacy', 'bladeform_legacy'], 'and the build is asked to run again');
});

test('a base the repository does not have is said so, and nothing is kept', async (t) => {
  const r = repo(JUGG);
  const { s, said } = store(t, r);
  assert.equal(await s.want('feast_of_abscession'), false);
  assert.ok(said.some((m) => /has no base feast_of_abscession/.test(m)));
});

test("a list can only name a base's models, materials and particles, each by a git hash", async (t) => {
  const sha = blobSha(Buffer.from('x'));
  assert.deepEqual(safeListing({
    planetfall: {
      'models/heroes/earthshaker/earthshaker.vmdl_c': sha,
      'scripts/npc/npc_heroes.txt': sha,
      'particles/../scripts/vscripts/addon_game_mode.vjs_c': sha,
      'materials/x.vmat_c': '../../../ready.json',
      'particles/fine.vpcf_c': 'ABC',
    },
    '../escape': { 'models/a.vmdl_c': sha },
  }), { planetfall: { 'models/heroes/earthshaker/earthshaker.vmdl_c': sha } });
  // a manifest naming a script, with the bytes to match its own hash: the script never comes, not
  // even signed, since the key is one more lock and not a reason to take a path off the list
  const script = 'local x = 1';
  const manifest = JSON.stringify({ bases: { planetfall: { 'scripts/vscripts/evil.lua': blobSha(Buffer.from(script)) } } });
  const fetchUrl = async (url: string) => {
    if (url.endsWith('manifest.json')) return new Response(manifest);
    if (url.endsWith('manifest.json.sig')) return new Response(sign(manifest));
    return new Response(script);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-basestore-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = createBaseStore({ dir, key: KEY, fetchUrl });
  assert.equal(await s.want('planetfall'), false);
  assert.equal(s.entries('planetfall'), null);
});
