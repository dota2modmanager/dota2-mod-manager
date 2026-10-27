/* The arcana bases brought down and kept (src/arcana-base-store.ts), against a repository served
 * from memory: what the store asks for, what it keeps, and what a build gets back.
 *
 * What matters: a build never gets half a base or bytes the repository does not name; a base that
 * is here keeps working with no network; a new version replaces the old one only once it is whole;
 * and a build that runs on every pick does not turn into a request on every pick. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { blobSha, createBaseStore, listingFromTree, safeListing, BASES_REPO } from '../src/arcana-base-store.ts';
import { entryPath } from '../src/vpk.ts';

const RAW = `https://raw.githubusercontent.com/${BASES_REPO}/main/`;
/** A request for the repository's git tree: by its host, as the store tells them apart. */
const isTreeUrl = (url: string) => new URL(url).host === 'api.github.com';

/** A repository: files by path, served as GitHub would, and every URL asked for. */
function repo(files: Record<string, string>) {
  const state = { files: { ...files }, offline: false, manifest: null as string | null, etag: '"one"' };
  const asked: string[] = [];
  const tree = () => ({ tree: Object.entries(state.files).map(([p, s]) => ({ path: p, type: 'blob', sha: blobSha(Buffer.from(s)) })) });
  const fetchUrl = async (url: string, opts: { headers?: Record<string, string> }) => {
    asked.push(url);
    if (state.offline) throw new Error('fetch failed');
    if (isTreeUrl(url)) {
      if (opts.headers?.['If-None-Match'] === state.etag) return new Response(null, { status: 304 });
      return new Response(JSON.stringify(tree()), { headers: { etag: state.etag } });
    }
    const rel = decodeURIComponent(url.slice(RAW.length));
    if (rel === 'manifest.json' && state.manifest) return new Response(state.manifest);
    const body = state.files[rel];
    return body === undefined ? new Response('', { status: 404 }) : new Response(body);
  };
  return { state, asked, fetchUrl, tree };
}

function store(t: TestContext, r: ReturnType<typeof repo>, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-basestore-'))) {
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ready: string[] = [];
  const said: string[] = [];
  const s = createBaseStore({ dir, fetchUrl: r.fetchUrl, onReady: (id) => ready.push(id), log: (m) => said.push(m) });
  return { s, dir, ready, said };
}

const JUGG = {
  'src/bladeform_legacy/models/heroes/juggernaut/juggernaut.vmdl_c': 'body',
  'src/bladeform_legacy/particles/econ/items/juggernaut/Blade Fury.vpcf_c': 'fury',
  'src/bladeform_legacy/pak29_dir.vpk': 'the same files packed',
  'README.md': 'not a base',
};

test("the tree lists each base's files with their hash, and not the VPK of them", () => {
  const r = repo(JUGG);
  const listing = listingFromTree(r.tree());
  assert.deepEqual(Object.keys(listing), ['bladeform_legacy']);
  assert.deepEqual(Object.keys(listing.bladeform_legacy).sort(), ['models/heroes/juggernaut/juggernaut.vmdl_c', 'particles/econ/items/juggernaut/Blade Fury.vpcf_c']);
  assert.equal(listing.bladeform_legacy['models/heroes/juggernaut/juggernaut.vmdl_c'], blobSha(Buffer.from('body')));
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
  const tree = JSON.stringify(r.tree());
  // a mirror, or a push halfway through, hands over other bytes than the tree names
  const fetchUrl: typeof r.fetchUrl = async (url, opts) => {
    if (isTreeUrl(url)) return new Response(tree);
    if (url.endsWith('juggernaut.vmdl_c')) return new Response('something a mirror made up');
    return r.fetchUrl(url, opts);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-basestore-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ready: string[] = [];
  const said: string[] = [];
  const s = createBaseStore({ dir, fetchUrl, onReady: (id) => ready.push(id), log: (m) => said.push(m) });
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
  const again = createBaseStore({ dir, fetchUrl: r.fetchUrl });
  assert.equal(await again.want('bladeform_legacy'), false, 'the last list, and every file is here');
  assert.ok(again.entries('bladeform_legacy'), 'still built with');
  const said: string[] = [];
  const empty = createBaseStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-basestore-')), fetchUrl: r.fetchUrl, log: (m) => said.push(m) });
  assert.equal(await empty.want('bladeform_legacy'), false);
  assert.ok(said.some((m) => /could not be brought down/.test(m)), 'said in the log, not thrown');
  const asked = r.asked.length;
  assert.equal(await empty.want('bladeform_legacy'), false);
  assert.equal(r.asked.length, asked, 'the next build does not ask again at once');
});

test('where the tree cannot be read, the manifest in the repository is the list', async (t) => {
  const r = repo(JUGG);
  const listing = listingFromTree(r.tree());
  r.state.manifest = JSON.stringify({ bases: listing });
  const fetchUrl: typeof r.fetchUrl = async (url, opts) => {
    if (isTreeUrl(url)) throw new Error('api.github.com unreachable');
    return r.fetchUrl(url, opts);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-basestore-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = createBaseStore({ dir, fetchUrl });
  assert.equal(await s.want('bladeform_legacy'), true);
  assert.ok(s.entries('bladeform_legacy'));
});

test('an unchanged tree is asked about and not read again; a new version replaces the old once whole, and the old files go', async (t) => {
  const r = repo(JUGG);
  const { s, dir } = store(t, r);
  await s.want('bladeform_legacy');
  const blobs = () => fs.readdirSync(path.join(dir, 'blobs')).sort();
  const old = blobs();
  r.state.files['src/bladeform_legacy/models/heroes/juggernaut/juggernaut.vmdl_c'] = 'body, fixed again';
  r.state.etag = '"two"';
  const ready: string[] = [];
  const next = createBaseStore({ dir, fetchUrl: r.fetchUrl, onReady: (id) => ready.push(id) });
  assert.equal(await next.want('bladeform_legacy'), true);
  assert.deepEqual(ready, ['bladeform_legacy']);
  assert.equal(next.entries('bladeform_legacy')!.find((e) => e.name === 'juggernaut')!.data.toString(), 'body, fixed again');
  assert.equal(blobs().length, old.length, 'the old body is swept, the particle shared');
  assert.ok(!blobs().includes(blobSha(Buffer.from('body'))));
  const third = createBaseStore({ dir, fetchUrl: r.fetchUrl });
  assert.equal(await third.want('bladeform_legacy'), false, 'the same tree: 304, nothing to do');
  assert.equal(r.asked.filter((u) => u.includes('juggernaut.vmdl_c')).length, 2, 'each body asked for once');
});

test('a file deleted by hand makes the base not ready, and the next want brings it back', async (t) => {
  const r = repo(JUGG);
  const { s, dir } = store(t, r);
  await s.want('bladeform_legacy');
  fs.rmSync(path.join(dir, 'blobs', blobSha(Buffer.from('body'))));
  assert.equal(s.entries('bladeform_legacy'), null);
  const next = createBaseStore({ dir, fetchUrl: r.fetchUrl });
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
  const fetchUrl: typeof r.fetchUrl = async (url, opts) => {
    if (url.endsWith('invoker_dress.vmdl_c')) await held;
    return r.fetchUrl(url, opts);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-basestore-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = createBaseStore({ dir, fetchUrl });
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
  // a mirror's manifest naming a script, with the bytes to match its own hash: the script never comes
  const script = 'local x = 1';
  const fetchUrl = async (url: string) => {
    if (isTreeUrl(url)) throw new Error('unreachable');
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify({ bases: { planetfall: { 'scripts/vscripts/evil.lua': blobSha(Buffer.from(script)) } } }));
    return new Response(script);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-basestore-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = createBaseStore({ dir, fetchUrl });
  assert.equal(await s.want('planetfall'), false);
  assert.equal(s.entries('planetfall'), null);
});
