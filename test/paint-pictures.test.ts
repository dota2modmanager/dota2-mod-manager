/* The pictures of the window that recolours a hero: a set the game shows with the empty slot's
 * picture shows its first piece's instead (src/game-icons.ts), the abilities' icons come out of the
 * game by name, and a picture is shaded in the window by the rule the build uses (src/recolor.ts). */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGameIcons } from '../src/game-icons.ts';
import { buildVpk, entryAt } from '../src/vpk.ts';
import { shade } from '../src/recolor.ts';
import { shadePixel } from '../renderer/catalog/paint/shade.ts';

const png = (w: number) => {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(w, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
};
const vtex = (body: Buffer) => { const head = Buffer.alloc(64); head.writeUInt32LE(64, 0); return Buffer.concat([head, body]); };
const picture = (image: string, w: number) => entryAt(`panorama/images/${image}_png.vtex_c`, vtex(png(w)));
const width = (uri: string) => Buffer.from(uri.split(',')[1], 'base64').readUInt32BE(16);

function game(t: TestContext, entries: ReturnType<typeof entryAt>[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-paintpic-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'game', 'dota'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'game', 'dota', 'pak01_dir.vpk'), buildVpk(entries));
  return createGameIcons({ userDataDir: dir, toolchain: { pathOf: () => null }, getGamePath: () => path.join(dir, 'game') });
}

const TABLE = `"items_game"
{
\t"items"
\t{
\t\t"18384"
\t\t{
\t\t\t"name"\t\t"Witch Rylai Arms"
\t\t\t"image_inventory"\t\t"econ/items/crystal_maiden/witch_rylai_arms/witch_rylai_arms"
\t\t}
\t\t"21799"
\t\t{
\t\t\t"name"\t\t"Witch Rylai"
\t\t\t"prefab"\t\t"bundle"
\t\t\t"bundle"
\t\t\t{
\t\t\t\t"Witch Rylai Arms"\t\t"1"
\t\t\t}
\t\t\t"image_inventory"\t\t"econ/testitem_slot_empty"
\t\t}
\t}
}
`;

test("a set the game shows with the empty slot's picture shows its first piece's", async (t) => {
  const icons = game(t, [
    entryAt('scripts/items/items_game.txt', Buffer.from(TABLE, 'latin1')),
    picture('econ/items/crystal_maiden/witch_rylai_arms/witch_rylai_arms', 64),
    picture('econ/testitem_slot_empty', 8),
  ]);
  const got = await icons.getMany(['Witch Rylai', 'Witch Rylai Arms']);
  assert.equal(width(got['Witch Rylai']), 64);
  assert.equal(got['Witch Rylai'], got['Witch Rylai Arms']);
});

test("abilities' icons come out of the game by name, and nothing is asked by a path", async (t) => {
  const icons = game(t, [picture('spellicons/crystal_maiden_crystal_nova', 128)]);
  const got = await icons.abilityIcons(['crystal_maiden_crystal_nova', 'crystal_maiden_frostbite', '../../x', 'CM', 7]);
  assert.deepEqual(Object.keys(got), ['crystal_maiden_crystal_nova']);
  assert.equal(width(got.crystal_maiden_crystal_nova), 128);
});

test('the window shades a pixel exactly as the build does', () => {
  const targets: [number, number, number][] = [[0, 150, 220], [127, 90, 240], [255, 40, 40], [160, 255, 80]];
  const pixels: [number, number, number][] = [[200, 30, 30], [40, 120, 200], [128, 128, 128], [250, 250, 240], [10, 60, 20], [255, 200, 0]];
  for (const to of targets) {
    for (const from of pixels) {
      const built = shade(from, to);
      const shown = shadePixel(from, to) ?? from;
      assert.ok(shown.every((n, i) => Math.abs(n - built[i]) <= 1), `${from} in ${to}: window ${shown}, build ${built}`);
    }
  }
});
