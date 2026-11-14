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
import os from 'node:os';
import crypto from 'node:crypto';

import AdmZip from 'adm-zip';

import { openVpkIndex } from '../src/vpk.ts';
import { decodePng } from '../src/png-strip.ts';

import { CLI, SANDBOX_GAME, SANDBOX_MODS, baseState, blind, readJson, startRs, startTs, tmpRoot, tree, twins, type Proc, type Reply, type Twin } from './helpers/owner-twins.ts';

const skip = (!fs.existsSync(CLI) && 'mm-cli is not built (cargo build -p mm-cli)') || (!fs.existsSync(SANDBOX_GAME) && 'no sandbox (npm run sandbox:seed)');

/** `unsized`: the answer's size is its compressor's, not the state's (a zip deflated by another library).
 * `pixels`: a PNG data URI in the answer is compared by its pixels (two encoders write one picture differently).
 * `send`: the window sends it and waits for no answer (ipcRenderer.send).
 * `netError`: the answer's error is a failed connection, worded by each stack's own network code
 * ("fetch failed" against the system's words); what the window acts on (offline) is still compared.
 * `blank`: fields of the answer that are each process's own (the bytes its own log holds). */
type Step = { call: [string, ...unknown[]]; reply?: Reply; note?: string; unsized?: boolean; pixels?: boolean; send?: boolean; netError?: boolean; blank?: string[] };

/** Every PNG data URI inside `v` as its size and a hash of its decoded pixels. */
function byPixels(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v ?? null), (_k, x) => {
    if (typeof x !== 'string' || !x.startsWith('data:image/png;base64,')) return x;
    const png = decodePng(Buffer.from(x.slice(22), 'base64'));
    return png ? `<PNG ${png.width}x${png.height} ${crypto.createHash('sha1').update(png.rgba).digest('hex')}>` : x;
  });
}

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
  // and the author's drafts, a folder each
  const drafts = path.join(t.ud, 'creator');
  const draftIds = fs.existsSync(drafts) ? fs.readdirSync(drafts).filter((n) => /^[0-9a-f-]{36}$/.test(n)).sort() : [];
  return [...(m.installed ?? []), ...(m.presets ?? [])].flatMap((r) => [r.id, ...(r.members ?? []).map((x) => x.id)]).concat(draftIds);
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
async function compare(name: string, base: Twin, steps: Step[], picturePaks: string[] = [], args: string[] = []): Promise<[Twin, Twin]> {
  const [a, b] = twins(base, tmpRoot(name));
  const procs: [Proc, Proc] = [startTs(a, args), startRs(b, args)];
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
      // a file a draft took in is named with a random tail
      text = text.replace(/(vpk|picture)-(\d+)-[0-9a-f]{6}/g, '$1-$2-<HEX>');
      // a sign-in carries a random state for the browser to hand back
      text = text.replace(/state=[0-9a-f]{32}/g, 'state=<STATE>');
      // a support report is named by the second it was asked for
      text = text.replace(/diag-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d/g, 'diag-<STAMP>');
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
        const r = s.send
          ? (p.send(s.call[0], here(s.call.slice(1)) as unknown[]), null)
          : await p.invoke(s.call[0], here(s.call.slice(1)) as unknown[]) as { value?: { size?: unknown } };
        if (s.unsized && r?.value && typeof r.value.size === 'number') r.value.size = '<SIZE>';
        const v = r?.value as { error?: unknown } | undefined;
        if (s.netError && v && typeof v.error === 'string') v.error = '<NET>';
        for (const k of s.blank ?? []) if (v && k in v) (v as Record<string, unknown>)[k] = '<OWN>';
        noteIds(side, t);
        const seen = named(blind({ answer: r, asked: p.asked }, t), side);
        got.push(s.pixels ? byPixels(seen) : seen);
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
    return [a, b];
  } finally {
    await Promise.all(procs.map((p) => p.stop()));
  }
}

/** The texture decoder, when this machine has one installed, copied into a base state: what it
 * makes is compared too. Without one both sides answer as having none. */
function withVrf(base: Twin): void {
  const vrf = path.join(process.env.APPDATA || '', 'Dota 2 Mod Manager', 'toolchain');
  if (process.env.APPDATA && fs.existsSync(path.join(vrf, 'installed.json'))) fs.cpSync(vrf, path.join(base.ud, 'toolchain'), { recursive: true });
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

test('folders, the download cache, launching Dota, the version, its notes and the scale answer as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('app-base'), 'b'), OFFLINE);
  cacheDownloads(base, [['terrains', 'pak11_dir.vpk'], ['heroes', 'IO Purple.zip']]);
  await compare('app', base, [
    { call: ['misc:openLangFolder'] },
    { call: ['misc:openToolsFolder'] },
    { call: ['misc:openToolsFolder', '../..'], note: 'not a tool of ours' },
    { call: ['misc:openExternal', 'https://dota2modmanager.com/'] },
    { call: ['misc:openExternal', 'file:///C:/Windows/notepad.exe'], note: 'not the web' },
    { call: ['misc:openExternal', 'nonsense'] },
    { call: ['misc:cacheSize'] },
    { call: ['misc:cacheList'] },
    { call: ['misc:cacheRemove', 'terrains/pak11_dir.vpk'] },
    { call: ['misc:cacheRemove', '../settings.json'] },
    { call: ['misc:cacheList'] },
    { call: ['misc:openCacheFolder'] },
    { call: ['misc:clearCache'] },
    { call: ['misc:cacheSize'] },
    { call: ['misc:runTool', 'nope'] },
    { call: ['game:launch'] },
    { call: ['update:fetchPortable'] },
    { call: ['update:revealPortable', '<ROOT>/x.exe'] },
    { call: ['app:version'] },
    { call: ['app:notes', 'en'] },
    { call: ['app:notes', 'ru'] },
    { call: ['app:notesSeen'] },
    { call: ['app:notes', 'en'] },
    { call: ['app:stars'] },
    { call: ['ui:setZoom', 1.25] },
    { call: ['ui:setZoom', 'nonsense'] },
  ]);
});

test('the remote config, the game patch and its repair, the item table, cosmetics, tools, arcanas and map looks answer as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('game-base'), 'b'), OFFLINE);
  await compare('game', base, [
    { call: ['game:steamDownloads'] },
    { call: ['game:steamProperties'] },
    { call: ['config:state'] },
    { call: ['config:noticeSeen', 'first'] },
    { call: ['config:noticeSeen', 42] },
    { call: ['config:noticeSeen', 'first'] },
    { call: ['config:state'] },
    { call: ['patch:state'] },
    { call: ['patch:repairState'] },
    { call: ['patch:repairSeen'] },
    { call: ['schema:cancel'], note: 'nothing building' },
    { call: ['patch:setEnabled', true] },
    { call: ['patch:state'] },
    { call: ['cosmetics:slots'] },
    { call: ['cosmetics:pickSet', 'no such set', 0] },
    { call: ['cosmetics:pick', 'weather', '11549', 'Weather Ash', null] },
    { call: ['cosmetics:pick', 'weather', '11549', 'Weather Ash', null], note: 'already this' },
    { call: ['patch:state'] },
    { call: ['schema:cancel'], note: 'the build is over' },
    { call: ['schema:refresh'] },
    { call: ['patch:repairNow'] },
    { call: ['patch:repairSeen'] },
    { call: ['patch:repairState'] },
    { call: ['patch:repairApp'] },
    { call: ['tools:state'] },
    { call: ['tools:install', 'nope'] },
    { call: ['tools:remove', 'vrf'] },
    { call: ['arcana:state'] },
    { call: ['arcana:install', 'nope', '#ff0000', 'mod'] },
    { call: ['map:state'] },
    { call: ['map:install', 'towers', null, null] },
    { call: ['map:install', 'castles', null, null] },
    { call: ['map:install', 'towers', '12936', null] },
    { call: ['arcana:install', 'terrorblade-arcana', [255, 0, 0], 'recolor'] },
    { call: ['arcana:state'] },
    { call: ['patch:setEnabled', false] },
    { call: ['patch:state'] },
    { call: ['mods:list'] },
  ]);
});

test('heroes\' portraits, the tiles\' pictures and the mods\' clips answer as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('pictures-base'), 'b'), OFFLINE);
  const mods = (readJson(path.join(base.ud, 'manifest.json')) as { installed: { files?: { relPath: string }[] }[] }).installed;
  const paks = mods.flatMap((r) => (r.files || []).map((f) => f.relPath)).filter((p) => p.endsWith('_dir.vpk'));
  withVrf(base);
  await compare('pictures', base, [
    { call: ['cosmetics:heroPortraits', ['axe', 'crystal_maiden', '../up', 7], false] },
    { call: ['cosmetics:heroPortraits', ['axe', 'nobody_at_all'], true] },
    { call: ['cosmetics:heroPortraitsByName', ['Axe', 'Crystal Maiden', 'Nobody At All']] },
    { call: ['cosmetics:icons', ['Weather Ash', 'Nonexistent Thing', 'hero:Io|generic:pack', ...paks.flatMap((p) => [`modart:${p}|hero:Io`, `modvid:${p}`, `modtex:${p}`])]], pixels: true },
    { call: ['cosmetics:icons', paks.map((p) => `modart:${p}`)], note: 'again, from the cache', pixels: true },
    ...paks.map((p) => ({ call: ['preview:video', `modvid:${p}`] as [string, ...unknown[]] })),
    { call: ['preview:video', 'nonsense'] },
    { call: ['preview:frame', 'nonsense', { $b64: Buffer.from('not a png').toString('base64') }] },
  ]);
});

test('the 3D preview answers as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('p3d-base'), 'b'), OFFLINE);
  withVrf(base);
  const slots = [{ slot: 'npc_dota_hero_axe:weapon', stock: '0' }];
  await compare('p3d', base, [
    { call: ['preview3d:slice', 1, 0] },
    { call: ['preview3d:models', 'npc_dota_hero_axe', []] },
    { call: ['preview3d:models', 'npc_dota_hero_axe', slots] },
    { call: ['preview3d:warm', 'npc_dota_hero_axe', slots] },
    { call: ['preview3d:prefetch', 'npc_dota_hero_axe', slots, 'npc_dota_hero_axe:weapon', ['1', '2']] },
    { call: ['preview3d:motions', 'models/heroes/axe/axe.vmdl'] },
    { call: ['preview3d:effect', 'nope'] },
    { call: ['preview3d:effect', 'unusual-1'] },
    { call: ['preview3d:model', 'models/heroes/axe/axe.vmdl'], note: 'not a prop' },
    { call: ['preview3d:model', 'models/props_tree/tree_oak_00.vmdl'] },
  ]);
});

test('the author\'s drafts answer as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('creator-base'), 'b'), OFFLINE);
  const save = (filePath: string | null) => (m: string) => (m === 'dialog.save' ? (filePath ? { canceled: false, filePath } : { canceled: true }) : null);
  const vpk = path.join(SANDBOX_GAME, 'dota_russian', 'pak01_dir.vpk');
  const pic = path.join(tmpRoot('creator-pic'), 'shot.png');
  fs.mkdirSync(path.dirname(pic), { recursive: true });
  fs.writeFileSync(pic, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a3b5d8a90000000049454e44ae426082', 'hex'));
  const webp = { $b64: Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(12)]).toString('base64') };
  await compare('creator', base, [
    { call: ['creator:list'] },
    { call: ['creator:save', null, { name: 'Purple Io', category: 'heroes', hero: 'axe', description: 'mine', author: 'me', styles: [{ label: 'Purple' }] }] },
    { call: ['creator:list'] },
    { call: ['creator:attach', '<ID 0>', 0, 'vpk'], reply: open(null), note: 'cancelled' },
    { call: ['creator:attach', '<ID 0>', 0, 'vpk'], reply: open([vpk]) },
    { call: ['creator:attach', '<ID 0>', 0, 'picture'], reply: open([pic]) },
    { call: ['creator:attach', '<ID 0>', 5, 'picture'], reply: open([pic]), note: 'no such style' },
    { call: ['creator:attach', 'nobody', 0, 'vpk'], reply: open([vpk]) },
    { call: ['creator:save', '<ID 0>', { name: 'Purple Io!', styles: [{ label: 'Purple' }, { label: 'Pink' }] }] },
    { call: ['creator:export', '<ID 0>', []], note: 'not ready' },
    { call: ['creator:save', '<ID 0>', { name: 'Axe Purple', styles: [{ label: 'Purple' }] }] },
    { call: ['creator:export', '<ID 0>', [webp]], reply: save(null), note: 'cancelled' },
    { call: ['creator:export', '<ID 0>', [webp]], reply: save('<ROOT>/io.zip'), unsized: true },
    { call: ['creator:export', 'nobody', []], reply: save('<ROOT>/x.zip') },
    { call: ['creator:remove', '<ID 0>'] },
    { call: ['creator:remove', 'nobody'] },
    { call: ['creator:list'] },
  ]);
});

test('the support report, the window\'s errors, the catalog and the proxy test answer as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('support-base'), 'b'), OFFLINE);
  const save = (filePath: string | null) => (m: string) => (m === 'dialog.save' ? (filePath ? { canceled: false, filePath } : { canceled: true }) : null);
  const [a, b] = await compare('support', base, [
    { call: ['settings:testProxy', null] },
    { call: ['settings:testProxy', 'nope'] },
    { call: ['settings:testProxy', 'ftp://x:1'] },
    { call: ['settings:testProxy', 'http://127.0.0.1:9'] },
    { call: ['catalog:load', false], netError: true },
    // account:signIn is not run here: the TypeScript keeps its port until the sign-in times out
    // after the browser failed to open, so the second side could not have it (the sign-in itself
    // is compared through discord-auth's own script)
    { call: ['diag:rendererError', 'TypeError: boom at x'], send: true },
    { call: ['diag:rendererError', null], send: true },
    { call: ['diag:export'], reply: save(null), note: 'cancelled' },
    { call: ['diag:export'], reply: save('<ROOT>/diag.zip') },
  ]);
  // the archive: the same files, and the same report but for what is the process's own
  // (its clock, its runtime, the window as each shell fakes it, the drive's free bytes)
  const own = ['generatedAt', 'app', 'disk', 'windows', 'displays', 'gpu'];
  const read = (t: Twin) => {
    const z = new AdmZip(path.join(t.root, 'diag.zip'));
    const report = JSON.parse(z.readAsText('report.json')) as Record<string, unknown>;
    for (const k of own) delete report[k];
    const errors = report.rendererErrors as { at?: string }[] | null;
    for (const e of errors ?? []) e.at = '<AT>';
    // why a mirror stands down is each stack's own wording of the failed connection
    for (const m of (report.mirrors as { why?: string }[] | null) ?? []) if (m.why) m.why = '<NET>';
    // the report takes the home folder out of its paths, so the copy's folder is written that way too
    const home = os.homedir();
    const root = t.root.toLowerCase().startsWith(home.toLowerCase()) ? `%USERPROFILE%${t.root.slice(home.length)}` : t.root;
    const text = JSON.stringify({ names: z.getEntries().map((e) => e.entryName).sort(), report }).split(JSON.stringify(root).slice(1, -1)).join('<ROOT>');
    return blind(JSON.parse(text), t);
  };
  assert.deepEqual(read(b), read(a), 'support: the archive');
});

test('the uninstaller\'s window answers as the TypeScript does', { skip }, async () => {
  const base = await withMods(path.join(tmpRoot('uninstall-base'), 'b'), OFFLINE);
  const own = ['dataBytes'];
  await compare('uninstall', base, [
    { call: ['uninstall:plan'], blank: own },
    { call: ['uninstall:run', { revert: true, mods: true }] },
    { call: ['uninstall:plan'], blank: own },
    { call: ['uninstall:done', true] },
  ], [], ['--uninstall']);
});
