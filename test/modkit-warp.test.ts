/* modkit warp (tools/modkit/commands.mjs): a status effect pointed at another of the game's colour
 * warps in the compiled file, with the new lookup named in RERL, and refused when either is not
 * in the game. The game here is a pak01 built for the test. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVpk, entryAt } from '../src/vpk.ts';
import { readKv3, type Kv3Node } from '../src/kv3.ts';
import { dataBlock, references } from '../src/resource.ts';
import { encodeKv3, resource, rerl } from './helpers/kv3-build.ts';
import { warp } from '../tools/modkit/commands.mjs';

const OLD = 'materials/models/heroes/statuseffects/colorwarp_morphling1.vtex';
const RED = 'materials/models/heroes/statuseffects/colorwarp_rupture.vtex';
const EFFECT = 'particles/status_fx/status_effect_test.vpcf_c';

function game(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-warp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const effect = resource([['RERL', rerl([OLD])], ['DATA', encodeKv3({ obj: [['m_pTextureColorWarp', { str: OLD }], ['m_flWidth', { int: 3 }]] })]]);
  fs.mkdirSync(path.join(dir, 'game', 'dota'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'game', 'dota', 'pak01_dir.vpk'), buildVpk([entryAt(EFFECT, effect), entryAt(`${RED}_c`, Buffer.from('lut'))]));
  return { game: path.join(dir, 'game'), out: path.join(dir, 'out') };
}

test('the status effect names the new colour warp, in its data and in RERL', async (t) => {
  const g = game(t);
  await warp({ _: [EFFECT.replace('.vpcf_c', '.vpcf'), `${RED}_c`], out: g.out, game: g.game });
  const file = fs.readFileSync(path.join(g.out, EFFECT));
  const root = readKv3(dataBlock(file).data).root as Extract<Kv3Node, { kind: 'object' }>;
  assert.deepEqual(root.members.get('m_pTextureColorWarp'), { ...root.members.get('m_pTextureColorWarp'), kind: 'string', value: RED });
  assert.ok(references(file).includes(RED), 'named as the compiler names it, with no _c');
});

test('a warp or an effect the game does not have is refused before anything is written', async (t) => {
  const g = game(t);
  await assert.rejects(warp({ _: [EFFECT, 'materials/nowhere/colorwarp_x.vtex'], out: g.out, game: g.game }), /no materials\/nowhere/);
  await assert.rejects(warp({ _: ['particles/status_fx/missing.vpcf_c', RED], out: g.out, game: g.game }), /no particles\/status_fx\/missing/);
  assert.equal(fs.existsSync(g.out), false);
});
