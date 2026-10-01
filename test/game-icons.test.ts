// Pictures out of the game are an upgrade, never a requirement: without the toolchain, or
// without a game to read, this has to step aside quietly so the wiki still answers. That is
// what these pin - the extraction itself is proven against the real game (see the ticket),
// not here, because a fixture for it would mean shipping fifty megabytes of somebody else's
// program and a copy of Dota.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { createGameIcons } from '../src/game-icons.ts';
import { buildVpk, crc32 } from '../src/vpk.ts';

function userDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-gi-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const noTool = { pathOf: () => null, ensure: async () => { throw new Error('not here'); } };
const withTool = (exe: string) => ({ pathOf: () => exe, ensure: async () => exe });

test('without the toolchain there are no pictures and no complaints', async (t) => {
  const icons = createGameIcons({ userDataDir: userDir(t), toolchain: noTool, getGamePath: () => 'C:/nowhere' });
  assert.equal(icons.ready(), false);
  assert.deepEqual(await icons.getMany(['Weather Ash']), {});
});

test('without a game path there is nothing to read', async (t) => {
  const icons = createGameIcons({ userDataDir: userDir(t), toolchain: withTool('C:/tool.exe'), getGamePath: () => null });
  assert.equal(icons.ready(), false);
  assert.deepEqual(await icons.getMany(['Weather Ash']), {});
});

test('a game folder with no pak is not a game folder', async (t) => {
  const dir = userDir(t);
  fs.mkdirSync(path.join(dir, 'game', 'dota'), { recursive: true });
  const icons = createGameIcons({ userDataDir: dir, toolchain: withTool('C:/tool.exe'), getGamePath: () => path.join(dir, 'game') });
  assert.equal(icons.ready(), false);
});

test('the cache is keyed by the picture path, so a second run finds what the first left', (t) => {
  const dir = userDir(t);
  const icons = createGameIcons({ userDataDir: dir, toolchain: noTool, getGamePath: () => null });
  // the name a cached file gets is a pure function of the path the item table gave
  const imagePath = 'econ/items/abaddon/abaddon_endless_night_head';
  const expected = `${crypto.createHash('sha1').update(imagePath).digest('hex').slice(0, 16)}.png`;
  fs.mkdirSync(icons.root, { recursive: true });
  fs.writeFileSync(path.join(icons.root, expected), Buffer.from('pretend png'));
  assert.equal(icons.size(), 11, 'the cache reports what it holds');
  icons.clear();
  assert.equal(icons.size(), 0);
  assert.equal(fs.existsSync(icons.root), false);
});

test('hero portraits come out of pak01 by hero id: the landscape one, else the one from hero selection', async (t) => {
  // The item builder's hub shows them; they used to ship inside the app as Valve's pictures.
  const dir = userDir(t);
  const game = path.join(dir, 'game');
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngOf = (w: number, h: number) => {
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0);
    ihdr.write('IHDR', 4);
    ihdr.writeUInt32BE(w, 8);
    ihdr.writeUInt32BE(h, 12);
    return Buffer.concat([sig, ihdr, Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
  };
  const vtexOf = (body: Buffer) => { const head = Buffer.alloc(64); head.writeUInt32LE(64, 0); return Buffer.concat([head, body]); };
  const file = (folder: string, id: string, body: Buffer) => {
    const data = vtexOf(body);
    return { ext: 'vtex_c', folder: `panorama/images/${folder}`, name: `npc_dota_hero_${id}_png`, data, preload: Buffer.alloc(0), crc: crc32(data) };
  };
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([
    file('heroes', 'axe', pngOf(128, 72)),
    // stored block-compressed, as most landscape portraits are: not a PNG to copy out
    file('heroes', 'abaddon', Buffer.from('DXT5 blocks, not a picture')),
    file('heroes/selection', 'abaddon', pngOf(142, 188)),
    file('heroes', 'marci', Buffer.from('compressed')),
    file('heroes/selection', 'marci', Buffer.from('compressed too')),
  ]));
  const icons = createGameIcons({ userDataDir: dir, toolchain: noTool, getGamePath: () => game });

  const got = await icons.heroPortraits(['axe', 'abaddon', 'marci', 'lina', '../../dota/axe', 'AXE']);
  assert.deepEqual(Object.keys(got).sort(), ['abaddon', 'axe'], 'a picture where the game has one, and nothing asked by a path');
  const size = (uri: string) => { const b = Buffer.from(uri.split(',')[1], 'base64'); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };
  assert.equal(size(got.axe), '128x72', 'the landscape portrait where it is a PNG');
  assert.equal(size(got.abaddon), '142x188', 'the hero selection portrait where the landscape one is compressed');
  assert.deepEqual(await icons.heroPortraits(['axe']), { axe: got.axe }, 'a second ask reads the cache');

  const none = createGameIcons({ userDataDir: userDir(t), toolchain: noTool, getGamePath: () => null });
  assert.deepEqual(await none.heroPortraits(['axe']), {}, 'no game, no portraits, no error');
});
