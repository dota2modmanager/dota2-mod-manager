/* Which installed mods a Dota update reached (src/update-impact.ts), on a game folder built here.
 *
 * The note is taken while the game is unchanged and read after the next update, so every test is a
 * small story: a game, some mods, a check, then Valve's pak01 rewritten the way a patch would, and
 * a second check. Build 6946 changed HUD layouts a HUD mod in daily use replaced; that is the
 * shape here, plus a file Valve removed and one Valve left alone.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';

import { buildVpk } from '../src/vpk.ts';
import { createUpdateImpact, impactMods, type ImpactMod } from '../src/update-impact.ts';

function entry(rel: string, text: string) {
  const data = Buffer.from(text);
  const ext = path.extname(rel).slice(1);
  return { ext, folder: path.dirname(rel), name: path.basename(rel, `.${ext}`), data, preload: Buffer.alloc(0), crc: crc32(data) >>> 0 };
}

const HUD = 'panorama/layout/hud/dota_hud.vxml_c';
const TIMER = 'panorama/styles/dota_hud_roshan_timer.vcss_c';
const OLD = 'models/heroes/pudge/pudge/pudge_model_vmorf.vtex_c';
const SAME = 'particles/units/heroes/hero_axe/axe_attack.vpcf_c';

function world(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-impact-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'game');
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.mkdirSync(path.join(game, 'dota_russian'), { recursive: true });
  let build = '6944';
  /** Valve's pak01 as a build ships it. The mtime moves, the way Steam's write moves it. */
  const valve = (files: Record<string, string>, next?: string) => {
    if (next) build = next;
    const file = path.join(game, 'dota', 'pak01_dir.vpk');
    fs.writeFileSync(file, buildVpk(Object.entries(files).map(([rel, text]) => entry(rel, text))));
    const at = new Date(Date.now() + Number(build) * 1000);
    fs.utimesSync(file, at, at);
  };
  const mods: ImpactMod[] = [];
  const mod = (id: string, name: string, files: string[], text = 'mod copy') => {
    const dir = path.join(game, 'dota_russian', `pak${30 + mods.length}_dir.vpk`);
    fs.writeFileSync(dir, buildVpk(files.map((rel) => entry(rel, text))));
    mods.push({ id, name, dir });
    return dir;
  };
  const impact = createUpdateImpact({
    file: path.join(root, 'userdata', 'update-impact.json'),
    gamePath: () => game,
    mods: () => mods,
    build: () => build,
  });
  return { game, valve, mod, mods, impact };
}

const V6944 = { [HUD]: 'hud 6944', [TIMER]: 'timer 6944', [OLD]: 'morph', [SAME]: 'axe', 'scripts/items/items_game.txt': 'items' };
const V6946 = { [HUD]: 'hud 6946', [TIMER]: 'timer 6946', [SAME]: 'axe', 'scripts/items/items_game.txt': 'items 2' };

test('the first look only takes the note: nothing is reached before there is a build to compare with', (t) => {
  const w = world(t);
  w.valve(V6944);
  w.mod('hud', 'Golden HUD', [HUD, TIMER, OLD]);
  assert.equal(w.impact.check(), null);
  assert.equal(w.impact.marked().size, 0);
});

test('a patch that changes and removes files a mod replaces marks it, and says so once', (t) => {
  const w = world(t);
  w.valve(V6944);
  w.mod('hud', 'Golden HUD', [HUD, TIMER, OLD]);
  w.mod('axe', 'Axe effects', [SAME]);
  w.impact.check();

  w.valve(V6946, '6946');
  assert.deepEqual(w.impact.check(), { from: '6944', to: '6946', ids: ['hud'] }, 'Axe is untouched: Valve did not change its file');
  const hud = w.impact.marked().get('hud');
  assert.deepEqual(hud && { since: hud.since, changed: hud.changed, removed: hud.removed },
    { since: '6946', changed: [HUD, TIMER].sort(), removed: [OLD] });
  assert.equal(w.impact.marked().has('axe'), false);

  assert.equal(w.impact.check(), null, 'the same build twice is nothing new');
  assert.equal(w.impact.marked().has('hud'), true, 'and the mark stays');
});

test('a mod rebuilt for the new patch loses its mark at once', (t) => {
  const w = world(t);
  w.valve(V6944);
  const dir = w.mod('hud', 'Golden HUD', [HUD, TIMER]);
  w.impact.check();
  w.valve(V6946, '6946');
  w.impact.check();
  assert.equal(w.impact.marked().has('hud'), true);

  fs.writeFileSync(dir, buildVpk([entry(HUD, 'rebuilt for 6946'), entry(TIMER, 'rebuilt')]));
  assert.equal(w.impact.marked().has('hud'), false, 'without waiting for the next check');
});

test('a mod installed after the note is added to it, and a later patch reaches it too', (t) => {
  const w = world(t);
  w.valve(V6944);
  w.impact.check();
  w.mod('hud', 'Golden HUD', [HUD]);
  assert.equal(w.impact.check(), null, 'same build: the new mod\'s files are noted, nothing is reported');

  w.valve(V6946, '6946');
  assert.deepEqual(w.impact.check()?.ids, ['hud']);
});

test('a file Valve ships for the first time under a mod\'s path counts as changed', (t) => {
  const w = world(t);
  const NEW = 'panorama/layout/hud/dota_hud_tormentor.vxml_c';
  w.valve(V6944);
  w.mod('hud', 'Golden HUD', [NEW]);
  w.impact.check();
  w.valve({ ...V6944, [NEW]: 'valve now ships it' }, '6946');
  assert.deepEqual(w.impact.marked().size, 0);
  w.impact.check();
  assert.deepEqual(w.impact.marked().get('hud')?.changed, [NEW]);
});

test('a second patch keeps the build that first reached the mod', (t) => {
  const w = world(t);
  w.valve(V6944);
  w.mod('hud', 'Golden HUD', [HUD, TIMER]);
  w.impact.check();
  w.valve(V6946, '6946');
  w.impact.check();
  w.valve({ ...V6946, [TIMER]: 'timer 6952' }, '6952');
  assert.deepEqual(w.impact.check(), { from: '6946', to: '6952', ids: ['hud'] });
  assert.equal(w.impact.marked().get('hud')?.since, '6946');
});

test('a mark taken off by hand stays off until a later patch reaches the mod again', (t) => {
  const w = world(t);
  w.valve(V6944);
  w.mod('hud', 'Golden HUD', [HUD, TIMER]);
  w.impact.check();
  w.valve(V6946, '6946');
  w.impact.check();

  assert.equal(w.impact.clear('hud'), true);
  assert.equal(w.impact.marked().has('hud'), false);
  assert.equal(w.impact.check(), null, 'the same build does not bring it back');
  assert.equal(w.impact.marked().has('hud'), false);
  assert.equal(w.impact.clear('hud'), false, 'nothing left to take off');

  w.valve({ ...V6946, [HUD]: 'hud 6952' }, '6952');
  w.impact.check();
  assert.equal(w.impact.marked().get('hud')?.since, '6952', 'the next patch that reaches it marks it again, from that patch');
});

test('no game, no answer, and nothing written', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-impact-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'update-impact.json');
  const impact = createUpdateImpact({ file, gamePath: () => null, mods: () => [], build: () => null });
  assert.equal(impact.check(), null);
  assert.equal(fs.existsSync(file), false);
});

test('the library\'s mods are the records with a pak of their own in the language folder', () => {
  const recs = [
    { id: 'a', name: 'A', files: [{ root: 'lang', relPath: 'pak30_dir.vpk' }] },
    { id: 'b', name: 'B', files: [{ root: 'lang', relPath: 'maps/dota.vpk' }] },
    { id: 'c', name: 'C pick', files: [] },
  ];
  assert.deepEqual(impactMods(recs as never, (rel) => `/lang/${rel}`), [{ id: 'a', name: 'A', dir: '/lang/pak30_dir.vpk' }]);
});
