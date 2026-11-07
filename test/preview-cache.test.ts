// A blocked GitHub hangs rather than fails, and on 2026-11-07 that left 33 category pictures undrawn
// a minute after a catalog that had loaded in seconds. What keeps that from coming back: the disk
// answers first, a silent host loses its turn in moments, and what is not a picture is not kept.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createPreviewStore, hostsFor, pictureOf, picturesIn, pictureType, redirectFor, FRESH_MS,
} from '../src/preview-cache.ts';
import { applyMirrors } from '../src/net-mirrors.ts';
import { firstSrc, mirrorOf, spareSrc } from '../renderer/ui/media.ts';

const RAW = 'https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main/';
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);
const REL = 'assets/previews/heroes/Some%20Mod.webp';
const FILE_COUNT = (dir: string) => fs.readdirSync(dir).length;

function tempDir(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pictures-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const picture = (body: Uint8Array = WEBP) => new Response(body as BodyInit, { status: 200 });
const silence = (init: RequestInit) => new Promise<Response>((_, no) => {
  init.signal?.addEventListener('abort', () => no(new Error('aborted')));
});

test('only pictures under the catalog folder are caught', () => {
  assert.equal(pictureOf(RAW + REL), REL);
  assert.equal(pictureOf(`mm-preview://catalog/${REL}`), REL);
  assert.equal(pictureOf(`${RAW}assets/previews/heroes/clip.mp4`), null, 'a clip streams from the mirror instead');
  assert.equal(pictureOf(`${RAW}assets/files/heroes/mod.zip`), null);
  assert.equal(pictureOf('https://example.com/assets/previews/a.webp'), null);
  assert.equal(pictureOf(`${RAW}assets/previews/../files/a.webp`), null);
  assert.equal(pictureOf(`${RAW}assets/previews/%2e%2e/a.webp`), null);
  assert.equal(pictureOf(`${RAW}assets/previews/%zz.webp`), null);
});

test('the window is sent to the scheme, and only from the address it really asked for', () => {
  assert.equal(redirectFor(RAW + REL), `mm-preview://catalog/${REL}`);
  assert.equal(redirectFor(`mm-preview://catalog/${REL}`), null, 'a redirect must not catch itself');
});

test('the bytes say what a file is, whatever its name says', () => {
  assert.equal(pictureType(WEBP), 'image/webp');
  assert.equal(pictureType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1])), 'image/png');
  assert.equal(pictureType(Buffer.from('GIF89a')), 'image/gif');
  assert.equal(pictureType(Buffer.from('<html>blocked</html>')), null);
  assert.equal(pictureType(Buffer.alloc(0)), null);
});

test('the mirror comes first, then the hosts that hold the catalog itself', (t) => {
  t.after(() => applyMirrors([]));
  applyMirrors([{ host: 'huggingface.co', base: 'https://huggingface.co/datasets/x/resolve/main/assets/files/' }]);
  const hosts = hostsFor(REL);
  assert.ok(hosts[0].startsWith('https://cdn.dota2modmanager.com/'));
  assert.equal(hosts[1], RAW + REL);
  assert.equal(hosts.at(-1), 'https://huggingface.co/datasets/x/resolve/main/assets/previews/heroes/Some%20Mod.webp');
  assert.ok(!hosts.some((h) => /ghproxy|gh-proxy|ghfast/.test(h)), 'a picture has no digest, so no open proxy');
});

test('the list to fetch holds styles and covers and leaves out clips and outside links', () => {
  const mods = { modsData: {
    heroes: [{ name: 'A', preview: 'A one.webp', styles: [{ label: 's', preview: 'A two.webp' }] }, { name: 'B', preview: 'b.mp4' }],
    creeps: { groups: [{ id: 'g', mods: [{ name: 'C', preview: 'assets/previews/creeps/c.webp' }] }] },
    other: [{ name: 'D', preview: 'https://example.com/d.webp' }],
  } };
  assert.deepEqual(picturesIn(mods, { categories: [{ preview: 'cover.webp' }, {}] }), [
    'assets/previews/categories/cover.webp',
    'assets/previews/heroes/A%20one.webp',
    'assets/previews/heroes/A%20two.webp',
    'assets/previews/creeps/c.webp',
  ]);
  assert.deepEqual(picturesIn(null, null), []);
});

test('a picture on disk is answered from disk', async (t) => {
  let asked = 0;
  const store = createPreviewStore({ dir: tempDir(t), fetchFn: async () => { asked++; return picture(); } });
  assert.equal((await store.get(REL))?.type, 'image/webp');
  assert.equal((await store.get(REL))?.type, 'image/webp');
  assert.equal(asked, 1);
});

test('two requests for one picture make one download', async (t) => {
  let asked = 0;
  const store = createPreviewStore({ dir: tempDir(t), fetchFn: async () => { asked++; return picture(); } });
  await Promise.all([store.get(REL), store.get(REL)]);
  assert.equal(asked, 1);
});

test('a host that says nothing loses its turn without a timeout', async (t) => {
  const asked: string[] = [];
  const store = createPreviewStore({
    dir: tempDir(t), stagger: 5,
    fetchFn: (url, init) => {
      asked.push(url);
      return url.includes('cdn.jsdelivr') ? Promise.resolve(picture()) : silence(init);
    },
  });
  const at = Date.now();
  assert.ok(await store.get(REL));
  assert.ok(Date.now() - at < 1000, 'the stagger, not the 15 second timeout');
  assert.equal(asked.length, 3);
});

test('a 404 passes the turn at once', async (t) => {
  const asked: string[] = [];
  const store = createPreviewStore({
    dir: tempDir(t), stagger: 60000,
    fetchFn: async (url) => { asked.push(url); return url.startsWith(RAW) ? picture() : new Response(null, { status: 404 }); },
  });
  assert.ok(await store.get(REL));
  assert.equal(asked.length, 2);
});

test('an error page is not a picture and is not kept', async (t) => {
  const dir = tempDir(t);
  const store = createPreviewStore({ dir, stagger: 1, fetchFn: async () => picture(Buffer.from('<html>blocked</html>')) });
  assert.equal(await store.get(REL), null);
  assert.ok(!fs.existsSync(dir) || FILE_COUNT(dir) === 0);
});

/** The question about an old picture runs behind the answer, so a test waits for what it did. */
async function settled(done: () => boolean | Promise<boolean>) {
  const until = Date.now() + 5000;
  while (!(await done())) {
    assert.ok(Date.now() < until, 'it never happened');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('an old picture is asked about, and only a changed one is replaced', async (t) => {
  const dir = tempDir(t);
  const seen: (string | null)[] = [];
  let answer: Response | null = picture();
  const store = createPreviewStore({
    dir,
    fetchFn: async (_, init) => { seen.push(new Headers(init.headers).get('if-modified-since')); return answer!; },
  });
  await store.get(REL);
  const file = path.join(dir, fs.readdirSync(dir)[0]);
  const old = new Date(Date.now() - FRESH_MS - 1000);
  fs.utimesSync(file, old, old);

  answer = new Response(null, { status: 304 });
  await store.get(REL);
  await settled(() => Date.now() - fs.statSync(file).mtimeMs < 5000);
  assert.equal(seen[1], old.toUTCString());

  fs.utimesSync(file, old, old);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  answer = picture(png);
  await store.get(REL);
  await settled(async () => (await store.get(REL))?.type === 'image/png');
});

test('warming fetches what is missing and stops when the network is gone', async (t) => {
  const dir = tempDir(t);
  const rels = Array.from({ length: 5 }, (_, i) => `assets/previews/x/${i}.webp`);
  const store = createPreviewStore({ dir, fetchFn: async () => picture() });
  await store.get(rels[0]);
  assert.equal(await store.warm(rels), 4);
  assert.equal(FILE_COUNT(dir), 5);

  let asked = 0;
  const down = createPreviewStore({
    dir: tempDir(t), stagger: 1,
    fetchFn: async () => { asked++; throw new Error('offline'); },
  });
  const many = Array.from({ length: 500 }, (_, i) => `assets/previews/x/${i}.webp`);
  assert.equal(await down.warm(many), 0);
  assert.ok(asked < 60, `gave up early, after ${asked} requests`);
});

test('a clip starts from the mirror, a picture from its own address', () => {
  const clip = `${RAW}assets/previews/heroes/a.mp4`;
  const still = `${RAW}assets/previews/heroes/a.webp`;
  assert.equal(firstSrc(clip), mirrorOf(clip));
  assert.equal(firstSrc(still), still);
  assert.equal(firstSrc(null), null);

  assert.equal(spareSrc(mirrorOf(clip)!, clip), clip, 'a clip the mirror has not got yet comes from GitHub');
  assert.equal(spareSrc(clip, clip), null);
  assert.equal(spareSrc(still, still), mirrorOf(still));
  assert.equal(spareSrc(mirrorOf(still)!, still), null);
  assert.equal(spareSrc('https://example.com/a.mp4', 'https://example.com/a.mp4'), null);
});
