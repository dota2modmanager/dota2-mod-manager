/* GLB files of the game's models for the 3D preview (src/model-glb.ts), with the toolchain
 * replaced by a stand-in that writes what the real one writes: the archive's layout, .glb for .vmdl_c. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createModelGlb, exportArgs, glbAt, modelFile } from '../src/model-glb.ts';

test('a model path in any spelling the table uses, and nothing that is not one', () => {
  assert.equal(modelFile('models/heroes/techies/techies.vmdl'), 'models/heroes/techies/techies.vmdl_c');
  assert.equal(modelFile('Models\\Items\\Techies\\Bigshot\\bigshot.vmdl_c'), 'models/items/techies/bigshot/bigshot.vmdl_c');
  assert.equal(modelFile('particles/x.vpcf'), null);
  assert.equal(modelFile('models/../../secret.vmdl'), null);
  assert.equal(modelFile(''), null);
});

test('one call for every model, its bones always, its clips only when some are asked for', () => {
  // without the animations switch the toolchain drops a wearable's skin, and it stands in its bind
  // pose while the body plays its idle
  assert.deepEqual(exportArgs('p.vpk', 'o', ['a.vmdl_c', 'b.vmdl_c'], []),
    ['-i', 'p.vpk', '-o', 'o', '-d', '-f', 'a.vmdl_c,b.vmdl_c', '--gltf_export_format', 'glb', '--gltf_export_materials',
      '--gltf_export_animations', '--gltf_animation_list', 'mm-no-clip']);
  assert.deepEqual(exportArgs('p.vpk', 'o', ['a.vmdl_c'], ['idle']).slice(-3), ['--gltf_export_animations', '--gltf_animation_list', 'idle']);
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-glb-'));
  const game = path.join(dir, 'game');
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), 'pak');
  const calls: string[][] = [];
  // writes a GLB for every model it is given, except the one the game lacks; for one model alone,
  // where -o says, as the real one does (it named the file after the folder, 2026-11-03)
  const run = async (_exe: string, args: string[]) => {
    calls.push(args);
    const out = args[args.indexOf('-o') + 1];
    const files = args[args.indexOf('-f') + 1].split(',');
    for (const f of files) {
      if (f.includes('missing')) continue;
      const at = files.length === 1 ? out : glbAt(out, f);
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(at, 'glb');
    }
  };
  return { dir, game, calls, run };
}

test('the models are exported once, in one call, and the second ask comes from the cache', async () => {
  const { dir, game, calls, run } = setup();
  try {
    const glb = createModelGlb({ userDataDir: dir, toolchain: { pathOf: () => 'vrf.exe' }, getGamePath: () => game, run });
    const want = ['models/heroes/techies/techies.vmdl', 'models/items/techies/missing.vmdl', 'particles/x.vpcf'];
    const first = await glb.glbs(want, ['idle']);
    assert.equal(calls.length, 1);
    assert.ok(first['models/heroes/techies/techies.vmdl']?.endsWith(path.join('models', 'heroes', 'techies', 'techies.glb')));
    assert.equal(first['models/items/techies/missing.vmdl'], null);
    assert.equal(first['particles/x.vpcf'], null);
    const again = await glb.glbs(want.slice(0, 1), ['idle']);
    assert.equal(calls.length, 1);
    assert.equal(again['models/heroes/techies/techies.vmdl'], first['models/heroes/techies/techies.vmdl']);
    // without the clips it is another file
    await glb.glbs(want.slice(0, 1));
    assert.equal(calls.length, 2);
    glb.clear();
    assert.equal(fs.existsSync(path.join(dir, 'models3d')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('without the toolchain or the game, or when the export fails, every model is null', async () => {
  const { dir, game, calls, run } = setup();
  try {
    const none = createModelGlb({ userDataDir: dir, toolchain: { pathOf: () => null }, getGamePath: () => game, run });
    assert.deepEqual(await none.glbs(['models/a.vmdl']), { 'models/a.vmdl': null });
    const noGame = createModelGlb({ userDataDir: dir, toolchain: { pathOf: () => 'vrf.exe' }, getGamePath: () => null, run });
    assert.deepEqual(await noGame.glbs(['models/a.vmdl']), { 'models/a.vmdl': null });
    assert.equal(calls.length, 0);
    const logs: string[] = [];
    const failing = createModelGlb({
      userDataDir: dir, toolchain: { pathOf: () => 'vrf.exe' }, getGamePath: () => game,
      run: async () => { throw new Error('boom'); }, log: (m) => logs.push(m),
    });
    assert.deepEqual(await failing.glbs(['models/a.vmdl']), { 'models/a.vmdl': null });
    assert.match(logs.join('\n'), /export failed \(boom\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a new game build empties the cache', async () => {
  const { dir, game, calls, run } = setup();
  try {
    const glb = createModelGlb({ userDataDir: dir, toolchain: { pathOf: () => 'vrf.exe' }, getGamePath: () => game, run });
    await glb.glbs(['models/a.vmdl']);
    // the build stamp is the size and time of the game's paks: a new pak01 is a new build
    fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), 'a newer pak');
    fs.utimesSync(path.join(game, 'dota', 'pak01_dir.vpk'), new Date(), new Date(Date.now() + 60000));
    await glb.glbs(['models/a.vmdl']);
    assert.equal(calls.length, 2);
    assert.equal(fs.readdirSync(path.join(dir, 'models3d')).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a body exported with its physics is found inside the folder -o became', async () => {
  const { dir, game, calls } = setup();
  try {
    // what the real toolchain did with Abaddon on 2026-11-04: two files, so -o was a folder
    const run = async (_exe: string, args: string[]) => {
      calls.push(args);
      const out = args[args.indexOf('-o') + 1];
      for (const f of ['models/heroes/abaddon/abaddon.vmdl_c', 'models/heroes/abaddon/abaddon_physics.vmdl_c']) {
        fs.mkdirSync(path.dirname(glbAt(out, f)), { recursive: true });
        fs.writeFileSync(glbAt(out, f), 'glb');
      }
    };
    const glb = createModelGlb({ userDataDir: dir, toolchain: { pathOf: () => 'vrf.exe' }, getGamePath: () => game, run });
    const body = 'models/heroes/abaddon/abaddon.vmdl';
    const first = (await glb.glbs([body], ['idle']))[body];
    assert.ok(first && fs.statSync(first).isFile(), `${first} is not a file`);
    assert.equal(path.basename(first), 'abaddon.glb');
    // the second ask finds it too, without exporting again
    assert.equal((await glb.glbs([body], ['idle']))[body], first);
    assert.equal(calls.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
