// modkit (tools/modkit.mjs): the decisions behind the commands an AI assistant runs to make a mod.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// modkit is ES modules, like the other tools/*.mjs; a test loads them the way radar.test.js does.
let findPaths, heroId, heroParticlePaths, heroesWithParticles, isSharedTexture, isUnchanged, listOf, locate, parseArgs, parseColor, twoPass;
before(async () => {
  ({ findPaths, heroId, heroParticlePaths, heroesWithParticles, isSharedTexture, isUnchanged, listOf, locate, parseArgs, parseColor, twoPass } = await import('../tools/modkit/lib.mjs'));
});

test('flags take the next word, bare flags stand alone, a repeated flag collects', () => {
  const a = parseArgs(['necrolyte', '190,6,6', '--out', 'w', '--one-pass', '--include', 'a/', '--include', 'b/'], ['one-pass']);
  assert.deepEqual(a._, ['necrolyte', '190,6,6']);
  assert.equal(a.out, 'w');
  assert.equal(a['one-pass'], true);
  assert.deepEqual(listOf(a.include), ['a/', 'b/']);
  assert.deepEqual(listOf(undefined), []);
  assert.equal(parseArgs(['--json']).json, true);
});

test('colours from rgb or hex', () => {
  assert.deepEqual(parseColor('190,6,6'), [190, 6, 6]);
  assert.deepEqual(parseColor('#be0606'), [190, 6, 6]);
  assert.equal(parseColor('300,0,0'), null);
  assert.equal(parseColor('red'), null);
});

test('the two passes of a red recolour are the ones the Necrophos set used', () => {
  // pure red first, then from a half-saturated red: [255,0,0] and [255,128,128]
  const { first, from } = twoPass([190, 6, 6]);
  assert.deepEqual(first, [255, 0, 0]);
  assert.deepEqual(from, [255, 128, 128]);
  const blue = twoPass([20, 60, 200]);
  assert.equal(blue.first[2], 255);
  assert.ok(blue.first[0] < 50);
});

test('a hero by its game name, its display name, or as people type it', () => {
  const names = { necrolyte: 'Necrophos', queenofpain: 'Queen of Pain' };
  assert.equal(heroId('Necrophos', names), 'necrolyte');
  assert.equal(heroId('queen of pain', names), 'queenofpain');
  assert.equal(heroId('npc_dota_hero_axe', names), 'axe');
  assert.equal(heroId('drow ranger', names), 'drow_ranger');
});

const PAK = [
  'particles/units/heroes/hero_necrolyte/necrolyte_pulse.vpcf_c',
  'particles/units/heroes/hero_necrolyte/necrolyte_pulse.vpcf_c.txt',
  'particles/units/heroes/hero_necrolyte_old/x.vpcf_c',
  'particles/status_fx/status_effect_necrolyte_spirit.vpcf_c',
  'particles/status_fx/status_effect_necrolytesomething.vpcf_c',
  'particles/econ/items/necrolyte/sullen/ult.vpcf_c',
  'particles/units/heroes/hero_axe/axe_counter.vpcf_c',
  'materials/models/heroes/necrolyte/necro.vmat_c',
];

test("a hero's particles are its folder and its status effects, and the folders asked for", () => {
  assert.deepEqual(heroParticlePaths(PAK, 'necrolyte'), [
    'particles/status_fx/status_effect_necrolyte_spirit.vpcf_c',
    'particles/units/heroes/hero_necrolyte/necrolyte_pulse.vpcf_c',
  ]);
  assert.ok(heroParticlePaths(PAK, 'necrolyte', ['particles/econ/items/necrolyte/']).includes('particles/econ/items/necrolyte/sullen/ult.vpcf_c'));
  assert.deepEqual(heroesWithParticles(PAK), ['axe', 'necrolyte', 'necrolyte_old']);
});

test('find wants every word, and stops at the limit', () => {
  assert.deepEqual(findPaths(PAK, ['NECROLYTE', 'pulse'], { ext: 'vpcf_c' }), ['particles/units/heroes/hero_necrolyte/necrolyte_pulse.vpcf_c']);
  assert.equal(findPaths(PAK, ['necrolyte'], { limit: 2 }).length, 2);
});

test('pack leaves out what the game already has', () => {
  const game = new Map([['a.vtex_c', Buffer.from('same')], ['m.vmat_c', Buffer.from('old')]]);
  const read = (p) => game.get(p) ?? null;
  assert.equal(isUnchanged('a.vtex_c', Buffer.from('same'), read), true);
  assert.equal(isUnchanged('m.vmat_c', Buffer.from('new'), read), false);
  assert.equal(isUnchanged('n.vmat_c', Buffer.from('new'), read), false);
  const index = { has: (p) => game.has(p) };
  assert.equal(isSharedTexture('a.vtex_c', index), true, 'a recompiled shared texture');
  assert.equal(isSharedTexture('a.vtex_c', index, new Set(['a.vtex_c'])), false, 'kept on purpose');
  assert.equal(isSharedTexture('m.vmat_c', index), false, 'a material is the mod itself');
});

test('a tool is found by its variable, on PATH, then in a version folder', () => {
  const have = new Set([path.join('/env', 'b.exe'), path.join('/bin', 'blender'), path.join('/pf', '5.2', 'blender')]);
  const exists = (p) => have.has(p);
  const readdir = () => ['4.2', '5.2'];
  const c = { env: null, names: ['blender'], globDirs: ['/pf'], files: [] };
  assert.equal(locate({ ...c, env: path.join('/env', 'b.exe') }, { exists, readdir, pathEnv: '' }), path.join('/env', 'b.exe'));
  assert.equal(locate(c, { exists, readdir, pathEnv: '/bin' }), path.join('/bin', 'blender'));
  assert.equal(locate(c, { exists, readdir, pathEnv: '' }), path.join('/pf', '5.2', 'blender'));
  assert.equal(locate({ ...c, globDirs: [] }, { exists, readdir, pathEnv: '' }), null);
});

test("a clip the decompile renamed gets Valve's name back, and every reference keeps its target", async () => {
  const { restoreNames } = await import('../tools/modkit/clips.mjs');
  const num = (v) => ({ kind: 'number', v });
  const numberOf = (_, n) => (n.raw ? n.raw.readInt32LE(0) : n.v);
  const str = (value) => ({ kind: 'string', value });
  const desc = (name, fetch, layers = []) => ({ members: new Map([
    ['m_sName', str(name)],
    ['m_fetch', { members: new Map([['m_localReferenceArray', { kind: 'array', items: fetch.map(num) }]]) }],
    ['m_autoLayerArray', { items: layers.map((l) => ({ members: new Map([['m_nLocalReference', num(l)]]) })) }],
  ]) });
  // necrolyte: cast_ghost_shroud plays the clip @@cast_ghost_shroud; the decompile gave both one name
  const valve = ['idle', 'cast_ghost_shroud', '@@cast_ghost_shroud', 'run'];
  const ours = ['idle', 'cast_ghost_shroud', 'run'];
  const aseq = { root: { members: new Map([
    ['m_localSequenceNameArray', { items: ours.map(str) }],
    ['m_localS1SeqDescArray', { items: [desc('idle', [0]), desc('cast_ghost_shroud', [1]), desc('run', [2], [1])] }],
  ]) } };
  const anim = { root: { members: new Map([['m_animArray', { items: ['idle', 'cast_ghost_shroud', 'run'].map((n) => ({ members: new Map([['m_name', str(n)]]) })) }]]) } };
  const renamed = restoreNames(aseq, anim, valve, ours, new Set(['idle', '@@cast_ghost_shroud', 'run']), numberOf);
  assert.deepEqual(renamed, ['@@cast_ghost_shroud']);
  const names = aseq.root.members.get('m_localSequenceNameArray').items.map((s) => s.value);
  assert.deepEqual(names, valve);
  const [, shroud, run] = aseq.root.members.get('m_localS1SeqDescArray').items;
  const refs = (d) => d.members.get('m_fetch').members.get('m_localReferenceArray').items.map((r) => names[numberOf(null, r)]);
  assert.deepEqual(refs(shroud), ['@@cast_ghost_shroud'], 'the sequence plays the renamed clip');
  assert.deepEqual(refs(run), ['run'], 'a later sequence moved up a number and still plays itself');
  assert.equal(names[numberOf(null, run.members.get('m_autoLayerArray').items[0].members.get('m_nLocalReference'))], 'cast_ghost_shroud', 'a layer still plays the sequence');
  assert.deepEqual(restoreNames(aseq, anim, valve, names, new Set(valve), numberOf), [], 'nothing to do the second time');
});

test('sound events: a layer on top, a replacement, a wav the compiler takes', async () => {
  const { eventFor, filesOf, kvText, soundSpec, wavInfo, withLayer } = await import('../tools/modkit/sounds.mjs');
  assert.deepEqual(soundSpec('Hero_X.Cast=work/a b.wav@0.9'), { event: 'Hero_X.Cast', file: 'work/a b.wav', volume: 0.9 });
  assert.throws(() => soundSpec('work/a.wav'));
  const s = (value) => ({ kind: 'string', value });
  const cast = { kind: 'object', members: new Map([['type', s('dota_update_default')], ['vsnd_files', { kind: 'array', items: [s('sounds/a.vsnd')] }],
    ['vsnd_duration', { kind: 'literal', text: '2.5' }], ['soundevent_layer2', s('Hero_X.Cast.ti7')], ['soundevent_layer2_on', { kind: 'literal', text: '1' }]]) };
  const mine = eventFor(cast, 'sounds/mods/m/scream.vsnd', 0.9);
  assert.deepEqual(filesOf(mine), ['sounds/mods/m/scream.vsnd']);
  assert.ok(!mine.members.has('vsnd_duration') && !mine.members.has('soundevent_layer2'), 'the compiler measures it again; no layers of the template');
  assert.equal(mine.members.get('volume').text, '0.90');
  assert.deepEqual(filesOf(cast), ['sounds/a.vsnd'], 'the template stays as it was');
  const layered = withLayer(cast, 'Hero_X.Cast.mod_scream');
  assert.equal(layered.members.get('soundevent_layer3').value, 'Hero_X.Cast.mod_scream', 'the first free layer');
  const vo = { kind: 'object', members: new Map([['vsnd_files', s('sounds/vo/x.vsnd')]]) };
  assert.equal(eventFor(vo, 'sounds/mods/m/ring.vsnd').members.get('vsnd_files').value, 'sounds/mods/m/ring.vsnd', 'a voice line names one file');
  assert.equal(kvText(mine, () => 0), '{\n\ttype = "dota_update_default"\n\tvsnd_files = [\n\t\t"sounds/mods/m/scream.vsnd",\n\t]\n\tvolume = 0.90\n}');
  const wav = (rate, bits, channels) => {
    const b = Buffer.alloc(44);
    b.write('RIFF', 0); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(rate, 24); b.writeUInt16LE(bits, 34);
    return b;
  };
  assert.deepEqual(wavInfo(wav(44100, 16, 1)), { ok: true, why: null, channels: 1, rate: 44100, bits: 16 });
  assert.equal(wavInfo(wav(44100, 24, 1)).ok, false);
  assert.equal(wavInfo(wav(96000, 16, 2)).ok, false);
  assert.equal(wavInfo(Buffer.from('ID3 not a wav at all')).ok, false);
});

test("a hero's interface pictures, its minimap cell, and the sheet that makes the compiler build them", async () => {
  const { heroPictures, minimapCell, namingSheet } = await import('../tools/modkit/pictures.mjs');
  const found = heroPictures([
    'panorama/images/spellicons/necrolyte_death_pulse_png.vtex_c',
    'panorama/images/spellicons/necrolyte/sullen_hollow/necrophos_death_pulse_png.vtex_c',
    'panorama/images/heroes/npc_dota_hero_necrolyte_png.vtex_c',
    'panorama/images/heroes/selection/npc_dota_hero_necrolyte_png.vtex_c',
    'panorama/images/heroes/npc_dota_hero_nevermore_png.vtex_c',
  ], 'necrolyte');
  assert.deepEqual([...found.values()], [
    'panorama/images/spellicons/necrolyte_death_pulse.png',
    'panorama/images/heroes/npc_dota_hero_necrolyte.png',
    'panorama/images/heroes/selection/npc_dota_hero_necrolyte.png',
  ], "the hero's own, not an item's");
  const text = '"minimap_heroicon_npc_dota_hero_necrolyte"\n{\n "file" "materials/vgui/hud/minimap_hero_sheet.vmat"\n "x" "0"\n "y" "64"\n "width" "32"\n "height" "32"\n}';
  assert.deepEqual(minimapCell(text, 'necrolyte'), { x: 0, y: 64, width: 32, height: 32 });
  assert.equal(minimapCell(text, 'axe'), null);
  assert.equal(namingSheet(['panorama/images/spellicons/a.png']), '.mm0 { background-image: url("file://{images}/spellicons/a.png"); }\n');
});

test('a hero name is matched as text, never as a pattern', async () => {
  const { heroPictures } = await import('../tools/modkit/pictures.mjs');
  const paths = ['particles/status_fx/status_effect_aXb_shroud.vpcf_c', 'particles/status_fx/status_effect_a.b_shroud.vpcf_c'];
  assert.deepEqual(heroParticlePaths(paths, 'a.b'), ['particles/status_fx/status_effect_a.b_shroud.vpcf_c']);
  assert.equal(heroPictures(['panorama/images/spellicons/aXb_q_png.vtex_c'], 'a.b').size, 0);
  assert.equal(heroPictures(['panorama/images/spellicons/a.b_q_png.vtex_c'], 'a.b').size, 1);
});
