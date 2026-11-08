/* A hero recoloured part by part into one record of My mods (src/hero-paint-service.ts, issue #422):
 * what the window is told, the pak built with only the layers that have a colour, the record built
 * again in its place, and again after a Dota update with the colours and the switch it had. On a
 * game folder made here, with a pak01 of one ability's particle, its icon and the hero's script. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { buildVpk, entryAt, openVpkIndex } from '../src/vpk.ts';
import { readKv3, readCell } from '../src/kv3.ts';
import { dataBlock } from '../src/resource.ts';
import { createHeroPaint } from '../src/hero-paint-service.ts';
import { encodeKv3, particle, rerl, resource } from './helpers/kv3-build.ts';
import type { LibRecord } from '../src/types.ts';

const FURY = 'particles/units/heroes/hero_juggernaut/juggernaut_blade_fury.vpcf_c';
const ICON = 'panorama/images/spellicons/juggernaut_blade_fury_png.vtex_c';
const PORTRAIT = 'panorama/images/heroes/icons/npc_dota_hero_juggernaut_png.vtex_c';
const TORSO = 'materials/models/heroes/juggernaut/juggernaut_torso_color_psd_4087f5cf.vtex_c';
const SCRIPT = '"DOTAHeroes"\n{\n\t"npc_dota_hero_juggernaut"\n\t{\n\t\t"Model"\t\t"models/heroes/juggernaut/juggernaut.vmdl"\n\t\t"Ability1"\t\t"juggernaut_blade_fury"\n\t}\n}\n';
const NAMES = '"lang"\n{\n\t"Language"\t\t"English"\n\t"Tokens"\n\t{\n\t\t"DOTA_Tooltip_ability_juggernaut_blade_fury"\t\t"Blade Fury"\n\t}\n}\n';

function picture(): Buffer {
  const head = Buffer.alloc(16);
  head.writeUInt32LE(16, 0);
  return Buffer.concat([head, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pixelsIEND'), Buffer.alloc(4)]);
}

type Extra = { entries?: ReturnType<typeof entryAt>[]; vanilla?: string; repaint?: Parameters<typeof createHeroPaint>[0]['repaint'] };
function world(t: TestContext, tools: Pick<Parameters<typeof createHeroPaint>[0], 'vrf' | 'compile' | 'decode'> = {}, extra: Extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-hero-paint-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([
    entryAt('scripts/npc/heroes/npc_dota_hero_juggernaut.txt', Buffer.from(SCRIPT)),
    entryAt('resource/localization/abilities_english.txt', Buffer.from(NAMES)),
    entryAt(FURY, particle(encodeKv3({ obj: [['m_ConstantColor', { i32s: [255, 40, 40, 255] }]] }))),
    entryAt(ICON, picture()),
    // block-compressed, as nearly all of a hero's pictures are: no PNG inside
    entryAt(PORTRAIT, Buffer.alloc(64, 7)),
    entryAt(TORSO, Buffer.alloc(64, 9)),
    ...(extra.entries ?? []),
  ]));
  const installer = new Installer({ userDataDir: path.join(dir, 'userdata'), getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(path.join(dir, 'userdata'));
  const rebuilt: string[] = [];
  const paint = createHeroPaint({ gamePath: () => game, installer, library, vanilla: () => extra.vanilla ?? '', repaint: extra.repaint ?? (() => Buffer.from('repainted')), ...tools, onRebuilt: (id) => rebuilt.push(id) });
  return { lang, library, paint, rebuilt };
}

const pakOf = (lang: string, rec: LibRecord) => openVpkIndex(path.join(lang, rec.files[0].relPath + (rec.enabled === false ? '.off' : '')));
const furyColor = (lang: string, rec: LibRecord) => {
  const kv = readKv3(dataBlock(pakOf(lang, rec).read(FURY) as Buffer).data);
  return kv.arrays.find((a) => a.key === 'm_ConstantColor')!.cells.slice(0, 3).map((c) => readCell(kv, c!));
};

test("the window is told the hero's layers by the game's names, and nothing is on yet", (t) => {
  const w = world(t);
  const s = w.paint.state('juggernaut');
  assert.deepEqual(s.layers.map((l) => [l.id, l.name, l.files]), [['ability:juggernaut_blade_fury', 'Blade Fury', 1], ['abilityIcon:juggernaut_blade_fury', 'Blade Fury', 1], ['portrait', null, 1], ['body', null, 1]]);
  assert.equal(s.installed, null);
  assert.throws(() => w.paint.state('../etc'), /etc/);
});

test('only the layers with a colour go in the pak, as one record', async (t) => {
  const w = world(t);
  const rec = await w.paint.install('juggernaut', { 'ability:juggernaut_blade_fury': '#00ff00', 'abilityIcon:juggernaut_blade_fury': 'green' }, 'Juggernaut');
  assert.equal(rec.name, 'Recolor: Juggernaut');
  assert.deepEqual(furyColor(w.lang, rec), [40, 255, 40]);
  assert.equal(pakOf(w.lang, rec).read(ICON), null, 'a colour that is not #rrggbb leaves its layer out');
  const both = await w.paint.install('juggernaut', { 'ability:juggernaut_blade_fury': '#00ff00', 'abilityIcon:juggernaut_blade_fury': '#0000ff' }, 'Juggernaut');
  assert.equal(both.id, rec.id, 'built again in its place');
  assert.equal(w.library.list().length, 1);
  assert.equal((pakOf(w.lang, both).read(ICON) as Buffer).subarray(16).toString(), 'repainted', "the picture behind the texture's own header");
  assert.deepEqual(w.paint.state('juggernaut').installed?.layers, { 'ability:juggernaut_blade_fury': '#00ff00', 'abilityIcon:juggernaut_blade_fury': '#0000ff' });
  await assert.rejects(w.paint.install('juggernaut', {}), /at least one layer/);
});

test('after a Dota update the record is built again with its colours, and stays off when it was', async (t) => {
  const w = world(t);
  const rec = await w.paint.install('juggernaut', { 'ability:juggernaut_blade_fury': '#00ff00' }, 'Juggernaut');
  w.library.update(rec.id, { enabled: false });
  assert.deepEqual(w.paint.rebuild(['other']), []);
  assert.deepEqual(w.paint.rebuild([rec.id]), [], 'nothing is answered as built yet');
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(w.rebuilt, [rec.id]);
  const after = w.library.list()[0];
  assert.equal(after.enabled, false);
  assert.deepEqual(furyColor(w.lang, after), [40, 255, 40]);
});

test("a compressed picture is read out by ValveResourceFormat and compiled again as the child of a style, the body's texture as a material's", async (t) => {
  const plain = world(t);
  const left = await plain.paint.install('juggernaut', { 'ability:juggernaut_blade_fury': '#00ff00', portrait: '#0000ff' }, 'Juggernaut');
  assert.equal(pakOf(plain.lang, left).read(PORTRAIT), null, 'without the tool it stays as the game has it');
  assert.equal(plain.paint.state('juggernaut').vrf, false);

  const jobs: { files: { path: string; data: Buffer }[]; compile: string[] }[] = [];
  const w = world(t, {
    vrf: () => 'vrf.exe',
    decode: async () => Buffer.from('decoded'),
    compile: async (job) => { jobs.push(job); return [entryAt(PORTRAIT, Buffer.from('compiled')), entryAt('panorama/styles/d2mm_hero_paint.vcss_c', Buffer.from('style')),
      entryAt('materials/d2mm_paint/t0_png_90369be2.vtex_c', Buffer.from('texture')), entryAt('materials/d2mm_paint/t0.vmat_c', Buffer.from('material'))]; },
  });
  const rec = await w.paint.install('juggernaut', { portrait: '#0000ff', body: '#00ff00' }, 'Juggernaut');
  assert.equal(jobs.length, 1);
  const vmat = jobs[0].files.find((f) => f.path === 'materials/d2mm_paint/t0.vmat')!.data.toString();
  assert.ok(vmat.includes('shader "hero.vfx"') && vmat.includes('TextureColor "materials/d2mm_paint/t0.png"'), vmat);
  assert.ok(jobs[0].compile.includes('materials/d2mm_paint/t0.vmat'));
  assert.equal(pakOf(w.lang, rec).read(TORSO)?.toString(), 'texture', "the compiler's texture under the game's own name");
  assert.equal(pakOf(w.lang, rec).read('materials/d2mm_paint/t0.vmat_c'), null);
  const png = jobs[0].files.find((f) => f.path === 'panorama/images/heroes/icons/npc_dota_hero_juggernaut.png');
  assert.equal(png?.data.toString(), 'repainted', 'the PNG read out, in the colour');
  const css = jobs[0].files.find((f) => f.path === jobs[0].compile.find((p) => p.endsWith('.css')))!.data.toString();
  assert.ok(css.includes('url("file://{images}/heroes/icons/npc_dota_hero_juggernaut.png")'), css);
  assert.equal(pakOf(w.lang, rec).read(PORTRAIT)?.toString(), 'compiled');
  assert.equal(pakOf(w.lang, rec).read('panorama/styles/d2mm_hero_paint.vcss_c'), null, "the style that named it is not the game's to load");

  const broken = world(t, { vrf: () => 'vrf.exe', decode: async () => Buffer.from('decoded'), compile: async () => { throw new Error('no compiler'); } });
  const still = await broken.paint.install('juggernaut', { 'ability:juggernaut_blade_fury': '#00ff00', portrait: '#0000ff' }, 'Juggernaut');
  assert.deepEqual(furyColor(broken.lang, still), [40, 255, 40], 'a compiler that fails leaves the pictures out, not the particles');
  assert.equal(pakOf(broken.lang, still).read(PORTRAIT), null);
});

const HELM = 'models/items/juggernaut/helm/helm.vmdl';
const HELM_MAT = 'materials/models/items/juggernaut/helm/helm.vmat';
const HELM_COLOR = 'materials/models/items/juggernaut/helm/helm_color_psd_12ab34cd.vtex';
const ITEMS = `"items_game"
{
	"items"
	{
		"4242"
		{
			"name"		"Bladeform Helm"
			"model_player"		"${HELM}"
		}
	}
}
`;

test("a worn item's own colour is its model's colour texture, painted in the mode the window chose, and kept for the rebuild", async (t) => {
  const painted: [string, string][] = [];
  const material = resource([['RERL', rerl([HELM_COLOR])], ['DATA', encodeKv3({ obj: [
    ['m_shaderName', { str: 'hero.vfx' }],
    ['m_textureParams', { objs: [[['m_name', { str: 'g_tColor' }], ['m_pValue', { str: HELM_COLOR }]]] }],
  ] })]]);
  const w = world(t, {}, {
    vanilla: ITEMS,
    entries: [entryAt(`${HELM}_c`, resource([['RERL', rerl([HELM_MAT])]])), entryAt(`${HELM_MAT}_c`, material), entryAt(`${HELM_COLOR}_c`, picture())],
    repaint: (png, color, mode) => { painted.push([color.join(','), mode]); return Buffer.from('repainted'); },
  });
  assert.ok(!w.paint.state('juggernaut').layers.some((l) => l.kind === 'itemModel'), 'an item nobody wears is no layer');
  const s = w.paint.state('juggernaut', ['4242', 'nonsense']);
  const layer = s.layers.find((l) => l.id === 'itemModel:4242');
  assert.deepEqual(layer && [layer.kind, layer.name, layer.files], ['itemModel', 'Bladeform Helm', 1]);
  const rec = await w.paint.install('juggernaut', { 'itemModel:4242': '#00ff00:keep', body: '#ff0000:bogus' }, 'Juggernaut', ['4242']);
  assert.deepEqual(painted, [['0,255,0', 'keep']]);
  assert.equal((pakOf(w.lang, rec).read(`${HELM_COLOR}_c`) as Buffer).subarray(16).toString(), 'repainted');
  assert.deepEqual(w.paint.state('juggernaut').installed?.layers, { 'itemModel:4242': '#00ff00:keep' }, 'a mode it does not know leaves the layer out');
  assert.ok(w.paint.state('juggernaut').layers.some((l) => l.id === 'itemModel:4242'), 'the record remembers what he wore');
  w.paint.rebuild([rec.id]);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(painted.at(-1), ['0,255,0', 'keep'], 'the rebuild after an update paints the item again');
});
