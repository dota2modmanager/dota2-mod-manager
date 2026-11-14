/* The Rust owner (crates/mm-core/src/owner.rs) against the TypeScript main process, channel by
 * channel: both run over twin copies of one state (test/helpers/owner-twins.ts), are handed the
 * same calls and the same answers from the shell, and must answer, ask and write the same.
 *
 * Skips where mm-cli is not built or the sandbox is not seeded (npm run sandbox:seed), as on CI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { openVpkIndex } from '../src/vpk.ts';
import { decodePng } from '../src/png-strip.ts';

import { CLI, SANDBOX_GAME, SANDBOX_MODS, baseState, blind, readJson, startRs, startTs, tmpRoot, tree, twins, type Proc, type Reply, type Twin } from './helpers/owner-twins.ts';

const skip = (!fs.existsSync(CLI) && 'mm-cli is not built (cargo build -p mm-cli)') || (!fs.existsSync(SANDBOX_GAME) && 'no sandbox (npm run sandbox:seed)');

/** `unsized`: the answer's size is its compressor's, not the state's (a zip deflated by another library). */
type Step = { call: [string, ...unknown[]]; reply?: Reply; note?: string; unsized?: boolean };

/** The settings a process wrote that are its own clock or its own build, not the state compared. */
const VOLATILE = ['lastSeenVersion', 'gameStamp', 'windowBounds'];
const settingsOf = (t: Twin) => {
  const s = (readJson(path.join(t.ud, 'settings.json')) ?? {}) as Record<string, unknown>;
  for (const k of VOLATILE) delete s[k];
  return blind(s, t);
};

/** The ids of a state's records and presets, in the order its manifest holds them. */
const recordIds = (t: Twin): string[] => {
  type Rec = { id: string; members?: { id: string }[] };
  const m = (readJson(path.join(t.ud, 'manifest.json')) ?? {}) as { installed?: Rec[]; presets?: Rec[] };
  // a pack's members have ids of their own, made as randomly
  return [...(m.installed ?? []), ...(m.presets ?? [])].flatMap((r) => [r.id, ...(r.members ?? []).map((x) => x.id)]);
};

/** A pak of pictures by what it shows: each file's bytes, but a PNG inside one by its pixels, since
 * two PNG encoders write the same picture differently. */
function pictures(pak: string): Record<string, string> {
  const ix = openVpkIndex(pak);
  const out: Record<string, string> = {};
  for (const p of ix.paths()) {
    const b = ix.read(p) ?? Buffer.alloc(0);
    const at = b.indexOf(PNG);
    const png = at >= 0 ? decodePng(b.subarray(at)) : null;
    const hash = (x: Buffer) => crypto.createHash('sha1').update(x).digest('hex');
    out[p] = png ? `${hash(b.subarray(0, at))} ${png.width}x${png.height} ${hash(png.rgba)}` : hash(b);
  }
  return out;
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Run one script on both sides; compare each answer, what each asked, and the files after.
 * `picturePaks` (game-relative) are compared by [`pictures`]. */
async function compare(name: string, base: Twin, steps: Step[], picturePaks: string[] = []): Promise<void> {
  const [a, b] = twins(base, tmpRoot(name));
  const procs: [Proc, Proc] = [startTs(a), startRs(b)];
  try {
    const [tsChannels, rsChannels] = await Promise.all(procs.map((p) => p.ready));
    for (const s of steps) assert.ok(rsChannels.includes(s.call[0]), `${s.call[0]} is not the owner's`);
    assert.ok(steps.every((s) => tsChannels.includes(s.call[0])), 'every channel is the host\'s too');
    // a record made during the run has a random id on each side: <ID n> by the order it appeared in
    const made = [new Map<string, string>(), new Map<string, string>()];
    const known = new Set(recordIds(base));
    const noteIds = (side: number, t: Twin) => {
      for (const id of recordIds(t)) if (!known.has(id) && !made[side].has(id)) made[side].set(id, `<ID ${made[side].size}>`);
    };
    const named = (v: unknown, side: number) => {
      let text = JSON.stringify(v ?? null);
      for (const [id, tag] of made[side]) text = text.split(id).join(tag);
      return JSON.parse(text);
    };
    for (const [k, s] of steps.entries()) {
      const label = `${name} ${k} ${s.note ?? s.call[0]}`;
      const got = [];
      for (const [side, [p, t]] of ([[procs[0], a], [procs[1], b]] as const).entries()) {
        p.asked = [];
        // <ROOT> in a call or in the shell's answer is this copy's folder; <ID n> the record made n-th
        const here = (v: unknown) => {
          let text = JSON.stringify(v ?? null).split('<ROOT>').join(JSON.stringify(t.root).slice(1, -1));
          for (const [id, tag] of made[side]) text = text.split(tag).join(id);
          return JSON.parse(text);
        };
        p.reply = (m, x) => here((s.reply ?? (() => null))(m, x));
        const r = await p.invoke(s.call[0], here(s.call.slice(1)) as unknown[]) as { value?: { size?: unknown } };
        if (s.unsized && r?.value && typeof r.value.size === 'number') r.value.size = '<SIZE>';
        noteIds(side, t);
        got.push(named(blind({ answer: r, asked: p.asked }, t), side));
      }
      if (process.env.OWNER_SHOW) console.log(label, JSON.stringify(got[0]).slice(0, 240));
      assert.deepEqual(got[1], got[0], label);
    }
    assert.deepEqual(named(settingsOf(b), 1), named(settingsOf(a), 0), `${name}: settings.json`);
    const manifest = (t: Twin, side: number) => named(blind(readJson(path.join(t.ud, 'manifest.json')), t), side);
    assert.deepEqual(manifest(b, 1), manifest(a, 0), `${name}: the library`);
    const [ta, tb] = [tree(a.game), tree(b.game)];
    for (const p of picturePaks) {
      delete ta[p]; delete tb[p];
      assert.deepEqual(pictures(path.join(b.game, p)), pictures(path.join(a.game, p)), `${name}: ${p}`);
    }
    assert.deepEqual(tb, ta, `${name}: the game folder`);
  } finally {
    await Promise.all(procs.map((p) => p.stop()));
  }
}

const open = (filePaths: string[] | null) => (m: string) => (m === 'dialog.open' ? (filePaths ? { canceled: false, filePaths } : { canceled: true, filePaths: [] }) : null);

test('settings, the beta switch, the support prompt and the account answer as the TypeScript does', { skip }, async () => {
  const base = baseState(path.join(tmpRoot('settings-base'), 'b'), { uiLang: 'ru' });
  await compare('settings', base, [
    { call: ['settings:get'] },
    { call: ['settings:get'], note: 'the migrations are told once' },
    { call: ['settings:set', 'uiLang', 'en'] },
    { call: ['settings:set', 'downloadProxy', 'socks://x'] },
    { call: ['settings:set', 'downloadProxy', ' http://127.0.0.1:8080 '] },
    { call: ['settings:set', 'downloadProxy', ''] },
    { call: ['settings:set', 'countDownloads', false] },
    { call: ['support:state'] },
    { call: ['support:state'], note: 'counted once a run' },
    { call: ['support:choose', 'later'] },
    { call: ['support:state'] },
    { call: ['beta:state'] },
    { call: ['beta:set', true] },
    { call: ['beta:set', 'yes'] },
    { call: ['presence:view', 'library'] },
    { call: ['account:signOut'] },
    { call: ['settings:moveLangFiles', 'english'] },
    { call: ['settings:browseDota'], reply: open(null), note: 'cancelled' },
    { call: ['settings:browseDota'], reply: open(['<ROOT>/ud']), note: 'not a game' },
    { call: ['settings:browseDota'], reply: open(['<ROOT>']), note: 'the folder above game' },
    { call: ['settings:set', 'langFolderLock', 'russian'] },
    { call: ['settings:get'] },
  ]);
});

/** A state with mods installed the TypeScript way: heroes, shaders (they load first), a terrain, trees. */
async function withMods(dir: string, settings: Record<string, unknown> = {}): Promise<Twin> {
  const b = baseState(dir, { langFolderLock: 'russian', ...settings });
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const inst = new Installer({ userDataDir: b.ud, getGamePath: () => b.game, getLangSuffix: () => 'russian' });
  const lib = new Library(b.ud);
  const mods: [string, string, string][] = [
    ['heroes', 'IO Purple', 'heroes__IO Purple.zip'], ['heroes', 'Bare Brewmaster', 'heroes__Bare Brewmaster.zip'],
    ['shaders', 'Aghanim Labyrinth', 'shaders__pak07_dir.vpk'], ['shaders', 'Aghanim Purple', 'shaders__pak13_dir.vpk'],
    ['terrains', 'Terrain', 'terrains__pak10_dir.vpk'], ['trees', 'Trees', 'trees__pak10_dir.vpk'],
    ['versus-screens', 'Versus', 'versus-screens__pak10_dir.vpk'],
  ];
  for (const [cat, name, file] of mods) {
    const files = FileTx.run((tx) => inst.installInto(tx, { categoryId: cat, modName: name, local: path.join(SANDBOX_MODS, file) }));
    // the name the catalog gives the file, as an install from it leaves on the record
    lib.add({ name, categoryId: cat, styleLabel: null, fileRef: file.slice(cat.length + 2), files } as never);
  }
  return b;
}

const idsOf = (b: Twin) => ((readJson(path.join(b.ud, 'manifest.json')) as { installed: { id: string; name: string }[] }).installed)
  .reduce<Record<string, string>>((m, r) => ({ ...m, [r.name]: r.id }), {});

test('the master switch, a mod\'s switch, the load order and removal answer as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('library-base'), 'b'));
  const id = idsOf(base);
  await compare('library', base, [
    { call: ['mods:masterState'] },
    { call: ['mods:mapsOwner'] },
    { call: ['mods:setEnabled', id['IO Purple'], false] },
    { call: ['mods:setEnabled', id['IO Purple'], false], note: 'off again' },
    { call: ['mods:setEnabled', 'nope', true], note: 'no such mod' },
    { call: ['mods:setEnabledMany', [id['Trees'], id['Terrain'], 'nope'], false] },
    { call: ['mods:setEnabledMany', [id['Trees'], id['IO Purple']], true] },
    { call: ['mods:move', id['Bare Brewmaster'], -1] },
    { call: ['mods:move', id['Bare Brewmaster'], -1], note: 'again' },
    { call: ['mods:move', id['Aghanim Labyrinth'], 1], note: 'shaders stay among shaders' },
    { call: ['mods:move', 'nope', 1] },
    { call: ['mods:reorder', id['Versus'], 0] },
    { call: ['mods:reorder', id['Aghanim Purple'], 99] },
    { call: ['mods:reorder', id['IO Purple'], 'x'], note: 'not a number' },
    { call: ['mods:setMaster', false] },
    { call: ['mods:masterState'] },
    { call: ['mods:setMaster', true] },
    { call: ['mods:dropItemIcons', id['Bare Brewmaster']] },
    { call: ['mods:remove', id['Terrain']] },
    { call: ['mods:mapsOwner'] },
    { call: ['mods:removeMany', [id['Trees'], 'nope', id['IO Purple']]] },
  ]);
});

test('removing everything the app put into the game answers as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('everything-base'), 'b'));
  await compare('everything', base, [{ call: ['mods:removeEverything'] }, { call: ['mods:masterState'] }]);
});

/** The catalog's archives in the download cache, so an install needs no network. */
function cacheDownloads(b: Twin, files: [string, string][]): void {
  for (const [cat, file] of files) {
    fs.mkdirSync(path.join(b.ud, 'downloads', cat), { recursive: true });
    fs.copyFileSync(path.join(SANDBOX_MODS, `${cat}__${file}`), path.join(b.ud, 'downloads', cat, file));
  }
}

/** Nothing reaches the network: every fetch goes through a proxy nobody listens on. */
const OFFLINE = { downloadProxy: 'http://127.0.0.1:9', countDownloads: false };

test('installing, exporting, importing and listing mods answer as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('mods-base'), 'b'), OFFLINE);
  cacheDownloads(base, [['terrains', 'pak11_dir.vpk'], ['trees', 'pak11_dir.vpk'], ['emblems', 'pak28_dir.vpk'], ['ti-bp-effects', 'pak22_dir.vpk'], ['heroes', 'IO Purple.zip']]);
  const id = idsOf(base);
  const mod = (categoryId: string, name: string, fileRef: string) => ({ categoryId, name, styleLabel: null, fileRef, preview: null });
  const save = (filePath: string | null) => (m: string) => (m === 'dialog.save' ? (filePath ? { canceled: false, filePath } : { canceled: true }) : null);
  await compare('mods', base, [
    { call: ['mods:list'] },
    { call: ['mods:install', mod('terrains', 'Terrain Two', 'pak11_dir.vpk')] },
    { call: ['mods:install', mod('terrains', 'Terrain Two', 'pak11_dir.vpk')], note: 'already there' },
    { call: ['mods:install', mod('trees', 'Trees Two', 'pak11_dir.vpk')] },
    { call: ['mods:install', mod('emblems', 'Emblem', 'pak28_dir.vpk')] },
    { call: ['mods:install', mod('ti-bp-effects', 'Seasonal', 'pak22_dir.vpk')] },
    { call: ['mods:list'] },
    { call: ['mods:exportSingle', id['Bare Brewmaster']], reply: save(null), note: 'cancelled' },
    { call: ['mods:exportSingle', id['Bare Brewmaster']], reply: save('<ROOT>/out.vpk') },
    { call: ['mods:exportSingle', 'nope'] },
    { call: ['mods:unpackToFolder', id['Aghanim Purple']], reply: open(['<ROOT>/unpacked']) },
    { call: ['mods:unpackToFolder', id['Aghanim Purple']], reply: open(null), note: 'cancelled' },
    { call: ['mods:remove', id['Bare Brewmaster']] },
    { call: ['mods:importPaths', ['<ROOT>/out.vpk']] },
    { call: ['mods:importDialog'], reply: open(null), note: 'cancelled' },
    { call: ['mods:importBuffers', []] },
    { call: ['mods:switchOffStaleTerrains'] },
    { call: ['mods:clearPrePatch', id['IO Purple']] },
    { call: ['mods:clearPrePatch', 'nope'] },
    { call: ['mods:update', id['IO Purple']], note: 'from the download cache' },
    { call: ['mods:update', 'nope'] },
    { call: ['mods:list'] },
  ]);
});

test('files put in the folder by hand answer as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('foreign-base'), 'b'), OFFLINE);
  const lang = path.join(base.game, 'dota_russian');
  for (const [from, to] of [['terrains__pak11_dir.vpk', 'pak40_dir.vpk'], ['trees__pak11_dir.vpk', 'pak41_dir.vpk.off'],
    ['versus-screens__pak11_dir.vpk', 'pak42_dir.vpk'], ['emblems__pak29_dir.vpk', 'pak43_dir.vpk']]) fs.copyFileSync(path.join(SANDBOX_MODS, from), path.join(lang, to));
  const id = idsOf(base);
  await compare('foreign', base, [
    { call: ['mods:list'] },
    { call: ['mods:externalSetEnabled', 'pak40_dir.vpk', false] },
    { call: ['mods:externalSetEnabled', 'pak40_dir.vpk.off', true] },
    { call: ['mods:adoptExternal', 'pak41_dir.vpk.off', null], note: 'arrived switched off' },
    { call: ['mods:adoptExternal', 'pak40_dir.vpk', 'x.png'] },
    { call: ['mods:adoptExternal', 'pak99_dir.vpk', null], note: 'not there' },
    { call: ['mods:externalRemove', 'pak42_dir.vpk'] },
    { call: ['mods:splitMod', id['IO Purple']] },
    { call: ['mods:splitMod', 'nope'] },
    { call: ['mods:splitExternal', 'pak43_dir.vpk'] },
    { call: ['mods:adoptMod', id['IO Purple'], null] },
    { call: ['mods:adoptMod', 'nope', null] },
    { call: ['mods:adoptFont', 'Some Font', null] },
    { call: ['mods:adoptCursor', null] },
    { call: ['mods:list'] },
  ]);
});

test('combined packs answer as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('packs-base'), 'b'), OFFLINE);
  const id = idsOf(base);
  await compare('packs', base, [
    { call: ['packs:combine', { modIds: [id['IO Purple']] }], note: 'one is not enough' },
    { call: ['packs:combine', { modIds: [id['IO Purple'], id['Bare Brewmaster'], id['Trees']], name: '  My pack ' }] },
    { call: ['packs:combine', { modIds: [id['Terrain'], id['Versus']] }], note: 'a second pack' },
    { call: ['mods:list'] },
    { call: ['packs:addMembers', 'nope', [id['Aghanim Purple']]] },
    { call: ['packs:setMemberEnabled', '<ID 0>', 'nope', false] },
    { call: ['packs:setMemberEnabled', '<ID 0>', '<ID 1>', false] },
    { call: ['packs:combine', { modIds: ['<ID 0>', '<ID 4>'] }], note: 'two packs into one' },
    { call: ['packs:extractMembers', '<ID 0>', ['<ID 1>']] },
    { call: ['packs:removeMember', '<ID 0>', '<ID 2>'] },
    { call: ['mods:list'] },
    { call: ['packs:disband', '<ID 0>'] },
    { call: ['packs:disband', 'nope'] },
    { call: ['mods:list'] },
  ]);
});

test('presets answer as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('presets-base'), 'b'), OFFLINE);
  const id = idsOf(base);
  const save = (filePath: string | null) => (m: string) => (m === 'dialog.save' ? (filePath ? { canceled: false, filePath } : { canceled: true }) : null);
  await compare('presets', base, [
    { call: ['presets:list'] },
    { call: ['presets:save', 'Everything'] },
    { call: ['mods:setEnabled', id['Trees'], false] },
    { call: ['presets:save', 'No trees'] },
    { call: ['presets:list'] },
    { call: ['presets:update', '<ID 0>'] },
    { call: ['presets:update', 'nope'] },
    { call: ['presets:rename', '<ID 1>', '  Renamed  '] },
    { call: ['presets:rename', '<ID 1>', '   '] },
    { call: ['presets:rename', 'nope', 'x'] },
    { call: ['presets:apply', '<ID 1>'] },
    { call: ['presets:list'] },
    { call: ['presets:exportPlan', '<ID 1>'] },
    { call: ['presets:exportPlan', 'nope'] },
    { call: ['presets:export', '<ID 1>', {}], reply: save(null), note: 'cancelled' },
    { call: ['presets:export', '<ID 1>', { note: 'for you', author: 'me', skip: ['1'] }], reply: save('<ROOT>/build.d2mm'), unsized: true },
    { call: ['presets:shareLink', '<ID 1>'] },
    { call: ['presets:shareLink', 'nope'] },
    { call: ['presets:importFile', '<ROOT>/build.d2mm'] },
    { call: ['presets:importFile', '<ROOT>/nothing.d2mm'] },
    { call: ['presets:importDialog'], reply: open(null), note: 'cancelled' },
    { call: ['presets:list'] },
    { call: ['mods:remove', id['IO Purple']] },
    { call: ['presets:apply', '<ID 0>'], note: 'a member gone, and no catalog to fetch it from' },
    { call: ['presets:resolve', '<ID 2>'] },
    { call: ['presets:resolve', '<ID 0>'], note: 'not a received one' },
    { call: ['presets:list'] },
    { call: ['presets:ready'] },
    { call: ['presets:takeReady', 'nope'] },
    { call: ['presets:delete', '<ID 1>'] },
    { call: ['presets:apply', 'nope'] },
    { call: ['mods:list'] },
  ]);
});

test('the HUD, map decor, menu background, pumpkin, hero grids and saved looks answer as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('studios-base'), 'b'), OFFLINE);
  await compare('studios', base, [
    { call: ['hud:state'] },
    { call: ['hud:install', [{ id: 'lower_hud', scale: 87 }, { id: 'topbar', x: 10.6, y: -50, opacity: 33, tint: '#ABCDEF', hidden: true }, { id: 'nope' }]] },
    { call: ['hud:state'] },
    { call: ['decor:state'] },
    { call: ['decor:install', []], note: 'nothing chosen' },
    { call: ['decor:install', ['plants']] },
    { call: ['background:state'] },
    { call: ['background:install', null, 'video', 0.5, 4], note: 'no movie yet' },
    { call: ['background:install', { $b64: Buffer.from('not a movie').toString('base64') }, 'video', 0.5, 4], note: 'not a webm' },
    { call: ['pumpkin:hasPrize'] },
    { call: ['pumpkin:redeem', '   '] },
    { call: ['pumpkin:redeem', 42] },
    { call: ['pumpkin:prizeAgain'] },
    { call: ['grid:state'] },
    { call: ['cosmetics:wearLook', 'not a hero', []] },
    { call: ['cosmetics:wearLook', 'item:npc_dota_hero_axe:', []] },
    { call: ['mods:list'] },
  ]);
});

test('the sounds, icons, effects, rank, paint and compiler studios answer as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('tools-base'), 'b'), OFFLINE);
  const wav = { $b64: Buffer.from('RIFF....WAVEnope').toString('base64') };
  await compare('tools', base, [
    { call: ['compiler:state'] },
    { call: ['compiler:browse'], reply: open(null), note: 'cancelled' },
    { call: ['compiler:browse'], reply: open(['<ROOT>/not-a-compiler.exe']) },
    { call: ['compiler:forget'] },
    { call: ['compiler:removeKept'] },
    { call: ['compiler:prepare'] },
    { call: ['sounds:heroes'] },
    { call: ['sounds:hero', 'npc_dota_hero_axe'] },
    { call: ['sounds:add', 'npc_dota_hero_axe', 'Hero_Axe.Berserkers_Call', 'replace', 0.8, wav, 'mine'] },
    { call: ['sounds:remove', 'npc_dota_hero_axe', 'Hero_Axe.Berserkers_Call'] },
    { call: ['icons:heroes'] },
    { call: ['icons:hero', 'npc_dota_hero_axe'] },
    { call: ['icons:hero', 'terrorblade'] },
    { call: ['icons:pictures', ['axe_berserkers_call', '../up']] },
    { call: ['icons:set', 'npc_dota_hero_axe', 'axe_berserkers_call', null] },
    { call: ['icons:clear', 'npc_dota_hero_axe'] },
    { call: ['fx:search', 'call'] },
    { call: ['fx:heroes'] },
    { call: ['fx:hero', 'npc_dota_hero_axe'] },
    { call: ['fx:load', 'particles/nope.vpcf'] },
    { call: ['fx:preview', 'particles/nope.vpcf', {}] },
    { call: ['fx:install', 'particles/nope.vpcf', {}, false] },
    { call: ['rank:state'] },
    { call: ['rank:pictures'] },
    { call: ['rank:install', {}] },
    { call: ['paint:state', 'axe', []] },
    { call: ['paint:icons', ['axe_culling_blade']] },
    { call: ['paint:install', 'axe', {}, 'red', []] },
    { call: ['paint:install', 'axe', { portrait: '#ff0000' }, 'red', []], note: 'no compiler here' },
    { call: ['mods:list'] },
  ], [path.join('dota_russian', 'pak05_dir.vpk')]);
});
