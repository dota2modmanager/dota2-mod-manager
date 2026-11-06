/* The in-game HUD made smaller or larger (issue #420): the rule added to the HUD's stylesheet
 * (src/hud-scale.ts), and the record in My mods that keeps it (src/hud-scale-service.ts). The two
 * tools are functions here: ValveResourceFormat hands back CSS, the compiler hands back what it was
 * given, so the test reads exactly what would have gone to Valve's compiler. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { buildVpk, entryAt, openVpkIndex } from '../src/vpk.ts';
import { clampScale, cleanParts, PARTS, partsOfScale, SOURCE, STYLE, withLayout } from '../src/hud-scale.ts';
import { SHAPES, boxOf, layoutKey, shapeOf, withPatch } from '../renderer/catalog/hud/parts.ts';
import { createHudScale } from '../src/hud-scale-service.ts';
import type { CompileJob } from '../src/resource-compiler.ts';

const GAME_CSS = '/* Prettified by Source 2 Viewer 20.1.0.0 - https://valveresourceformat.github.io */\n\nDOTAHud\n{\n\twidth: 100%;\n}\n';

test('the layout goes at the end of the style, once, with a rule per panel changed', () => {
  const once = withLayout(GAME_CSS, [{ id: 'lower_hud', scale: 80 }, { id: 'shop_launcher_block', hidden: true }]);
  assert.doesNotMatch(once, /Source 2 Viewer/, 'the tool’s banner is not part of the style');
  assert.match(once, /^DOTAHud\n\{\n\twidth: 100%;\n\}\n\n\/\* d2mm: HUD scale \*\/\n#lower_hud\n\{\n\tui-scale: 80%;\n\}\n\n#shop_launcher_block\n\{\n\tvisibility: collapse;\n\}\n$/);
  // a style that already has it (ours, read back) gets the new values in place of the old
  const twice = withLayout(once, [{ id: 'lower_hud', scale: 115 }]);
  assert.equal(twice.match(/ui-scale/g)?.length, 1);
  assert.match(twice, /ui-scale: 115%;/);
  assert.doesNotMatch(twice, /collapse/);
});

test('every change to a panel is said in what Panorama reads', () => {
  const css = withLayout('', [{ id: 'inventory', scale: 90, x: 12, y: -30, opacity: 60, tint: '#AA00ff' }]);
  for (const line of ['ui-scale: 90%;', 'transform: translateX(12px) translateY(-30px);', 'opacity: 0.6;', 'wash-color: #aa00ff;']) assert.ok(css.includes(line), line);
});

test('what the window sends is kept to known panels, in range, with defaults dropped', () => {
  assert.deepEqual(cleanParts([
    { id: 'lower_hud', scale: 100, x: 0, opacity: 100 },
    { id: '#evil { }', scale: 80 },
    { id: 'shop_launcher_block', tint: 'red;}', x: 99999, opacity: 1 },
    null,
  ]), [{ id: 'shop_launcher_block', x: 1920, opacity: 10 }]);
  assert.deepEqual(cleanParts('nonsense'), []);
});

test('a record from before the editor meant the bottom bar and the minimap', () => {
  assert.deepEqual(partsOfScale(85), [{ id: 'lower_hud', scale: 85 }, { id: 'minimap_container', scale: 85 }]);
});

test('the editor draws the same panels this builds', () => {
  assert.deepEqual(SHAPES.map((s) => s.id).sort(), [...PARTS].sort());
});

test('the plan: a panel keeps its corner as it scales, and what is inside the bar goes with the bar', () => {
  const map = shapeOf('minimap_container');
  const small = boxOf(map, [{ id: map.id, scale: 50 }]);
  assert.equal(small.x + 0, map.x);
  assert.equal(small.y + small.h, map.y + map.h);
  const items = shapeOf('inventory');
  const moved = boxOf(items, [{ id: 'lower_hud', y: -100 }]);
  assert.equal(moved.y, items.y - 100);
});

test('a flipped HUD keeps a move, mirrored, and only the panels it mirrors need that', () => {
  const css = withLayout('', [{ id: 'minimap_container', x: 40, y: -60 }, { id: 'topbar', y: 30 }]);
  assert.match(css, /\.HUDFlipped #minimap_container\s*\{\s*transform: translateX\(-40px\) translateY\(-60px\) scaleX\(-1\);/);
  assert.doesNotMatch(css, /\.HUDFlipped #topbar/);
});

test('larger abilities widen the bar both ways and push what is beside them', () => {
  const parts = [{ id: 'abilities', scale: 120 }];
  assert.equal(boxOf(shapeOf('PortraitGroup'), parts).x, shapeOf('PortraitGroup').x - 25);
  assert.equal(boxOf(shapeOf('inventory'), parts).x, shapeOf('inventory').x + 25);
  assert.equal(boxOf(shapeOf('health_mana'), parts).w, shapeOf('health_mana').w + 50);
  assert.equal(boxOf(shapeOf('lower_hud'), parts).x, shapeOf('lower_hud').x - 25);
});

test('a panel with nothing left on it leaves the list, and order does not make a new layout', () => {
  const one = withPatch([], 'shop_launcher_block', { hidden: true });
  assert.deepEqual(one, [{ id: 'shop_launcher_block', hidden: true }]);
  assert.deepEqual(withPatch(one, 'shop_launcher_block', { hidden: undefined }), []);
  const a = [{ id: 'a', scale: 90 }, { id: 'b', x: 1 }];
  assert.equal(layoutKey(a), layoutKey([...a].reverse()));
});

test('a scale from the window is a step of 5 between 60 and 130', () => {
  assert.deepEqual([82, 59, 200, -1, 100, 112.4].map(clampScale), [80, 60, 130, 60, 100, 110]);
  assert.equal(clampScale('nonsense'), 100);
  assert.equal(clampScale(undefined), 100);
});

/** A layout with the bottom bar at this percent. */
const bar = (scale: number) => [{ id: 'lower_hud', scale }];

function world(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-hud-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  fs.mkdirSync(path.join(game, 'dota_russian'), { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([entryAt(STYLE, Buffer.from('game style'))]));
  const userdata = path.join(dir, 'userdata');
  const installer = new Installer({ userDataDir: userdata, getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(userdata);
  const jobs: CompileJob[] = [];
  const rebuilt: string[] = [];
  let tool: string | null = 'vrf.exe';
  const service = createHudScale({
    gamePath: () => game, installer, library, vrf: () => tool,
    // the "decompiled" CSS says which compiled style it came from
    decompile: async (exe, style) => `${GAME_CSS}/* from ${style.toString()} */\n`,
    compile: async (job) => { jobs.push(job); return [entryAt(STYLE, job.files[0].data)]; },
    onRebuilt: (id) => rebuilt.push(id),
  });
  const built = (rec: { files: { relPath: string }[] }) => openVpkIndex(path.join(installer.langFolder(), rec.files[0].relPath)).read(STYLE)!.toString();
  const hudMod = (name: string) => {
    installer.ensureLangFolder();
    const pak = installer.allocatePak(installer.usedPakNames(), false);
    fs.writeFileSync(path.join(installer.langFolder(), pak), buildVpk([entryAt(STYLE, Buffer.from(`${name} style`))]));
    return library.add({ name, categoryId: 'huds', styleLabel: null, fileRef: null, preview: null, files: [{ root: 'lang', relPath: pak }] });
  };
  return { service, library, installer, jobs, rebuilt, built, hudMod, game, noTool: () => { tool = null; } };
}

test('on the game’s own HUD: one record, compiled from the game’s style with the scale at its end', async (t) => {
  const w = world(t);
  assert.deepEqual(w.service.state(), { installed: null, hudMod: null, vrf: true });
  const rec = await w.service.install(bar(83));
  assert.equal(rec.categoryId, 'huds');
  assert.deepEqual(w.jobs.map((j) => j.compile), [[SOURCE]]);
  assert.match(w.built(rec), /from game style[\s\S]*ui-scale: 85%;/);
  const again = await w.service.install(bar(70));
  assert.equal(again.id, rec.id);
  assert.equal(w.library.list().length, 1);
  assert.match(w.built(again), /ui-scale: 70%;/);
  assert.deepEqual(w.service.state().installed, { id: rec.id, parts: [{ id: 'lower_hud', scale: 70 }], base: 'game', enabled: true });
});

test('with a HUD mod on, the scale goes on the HUD mod’s style and the pak comes before it', async (t) => {
  const w = world(t);
  const mod = w.hudMod('Immortal HUD');
  assert.equal(w.service.state().hudMod, 'Immortal HUD');
  const rec = await w.service.install(bar(90));
  assert.match(w.built(rec), /from Immortal HUD style/);
  const num = (r: { files: { relPath: string }[] }) => Number(/pak(\d+)_/.exec(r.files[0].relPath)![1]);
  assert.ok(num(rec) < num(mod), 'first in the load order wins, as in the game');
  // our own record is not taken for the style in force when it is built again
  const again = await w.service.install(bar(95));
  assert.match(w.built(again), /from Immortal HUD style/);
  w.library.update(mod.id, { enabled: false });
  assert.equal(w.service.state().hudMod, null);
});

test('without ValveResourceFormat nothing is built, and it says what to get', async (t) => {
  const w = world(t);
  w.noTool();
  assert.equal(w.service.state().vrf, false);
  await assert.rejects(w.service.install(bar(80)), /ValveResourceFormat/);
  assert.equal(w.library.list().length, 0);
});

test('a Dota update builds the record again after answering, from the new style, and says when it is done', async (t) => {
  const w = world(t);
  const rec = await w.service.install(bar(80));
  fs.writeFileSync(path.join(w.game, 'dota', 'pak01_dir.vpk'), buildVpk([entryAt(STYLE, Buffer.from('patched style'))]));
  assert.deepEqual(w.service.rebuild(['someone-else']), []);
  assert.deepEqual(w.service.rebuild([rec.id]), [], 'not built yet when it answers');
  for (let i = 0; i < 50 && !w.rebuilt.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(w.rebuilt, [rec.id]);
  assert.match(w.built(w.library.list()[0]), /from patched style[\s\S]*ui-scale: 80%;/);
});
