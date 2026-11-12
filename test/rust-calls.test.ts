// Pure functions moved to Rust (crates/mm-core/src/calls.rs) answer what the TypeScript function
// of the same name answers, input for input. Each case names the function as calls.rs does
// (module.export), the TypeScript one, and the inputs; one mm-cli run answers them all. Skipped
// where mm-cli is not built, like test/rust-parity.test.ts. The tables both sides read are checked
// in test/rust-data.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import EN from '../src/i18n-en.ts';
import { t, setLang } from '../src/i18n.ts';
import { HERO_ALIAS, HERO_DISPLAY, heroDisplayName, heroIdFromName, heroKey } from '../src/hero-names.ts';
import { styleTokens, styleOf, withStyle, inEveryStyle, blockInEveryStyle } from '../src/item-builder-styles.ts';
import { donorOf, hasOwnEffect, donorAdditions, withModifiers, withDonorEffects } from '../src/item-builder-donor.ts';
import { blockBounds, eachChild } from '../src/schema-kv.ts';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'target', 'debug', process.platform === 'win32' ? 'mm-cli.exe' : 'mm-cli');
const skip = !fs.existsSync(cli) && 'mm-cli is not built (cargo build -p mm-cli)';

type Case = { name: string; ts: (...a: never[]) => unknown; inputs: unknown[][] };

const heroIds = [...Object.keys(HERO_DISPLAY), ...Object.keys(HERO_ALIAS), ...Object.values(HERO_ALIAS)];
const heroish = [...heroIds, ...Object.values(HERO_DISPLAY), 'pudge', 'crystalmaiden', 'CrystalMaiden', 'Queen of Pain', '  Nature\'s  Prophet ',
  '__x__', 'a--b', '', 'ÉLÉ', 'hero_42', 'tiny_04', 'anti-mage', 'ANTIMAGE', 'x_y_z', '3d', 'шторм'];

const ruKeys = Object.keys(EN);
const withValues = ruKeys.filter((k) => /\{\d+\}/.test(k));
const lt = (lang: string, ru: string, ...values: unknown[]) => { setLang(lang); return t(ru, ...values); };

const CASES: Case[] = [
  { name: 'i18n.t', ts: lt as never, inputs: [
    ...['en', 'ru', 'zh-CN', 'de'].flatMap((l) => ruKeys.map((k) => [l, k])),
    ...['en', 'ru', 'zh-CN'].flatMap((l) => withValues.map((k) => [l, k, 'one', 2, null, 3.5, true, -0.1, 1e21])),
    ['en', 'не в таблице {0} {1} {x} {} {01}', 'a'], ['en', '{0}{0}{1}', 'x', 12345678901234567890],
  ] },
  { name: 'hero-names.heroDisplayName', ts: heroDisplayName as never, inputs: heroish.map((h) => [h]) },
  { name: 'hero-names.heroIdFromName', ts: heroIdFromName as never, inputs: heroish.map((h) => [h]) },
  { name: 'hero-names.heroKey', ts: heroKey as never, inputs: heroish.map((h) => [h]) },
];

/** Every case run on both sides; an argument {$file} is that file's latin1 text to TypeScript. */
function compare(cases: Case[]) {
  const list = cases.flatMap((c) => c.inputs.map((args) => [c.name, ...args]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-calls-'));
  fs.writeFileSync(path.join(tmp, 'calls.json'), JSON.stringify(list));
  const rs = JSON.parse(execFileSync(cli, ['call', path.join(tmp, 'calls.json')], { encoding: 'utf8', maxBuffer: 1 << 30 }));
  const files = new Map<string, string>();
  const text = (a: unknown) => {
    if (!a || typeof a !== 'object' || !('$file' in a)) return a;
    const f = (a as { $file: string }).$file;
    if (!files.has(f)) files.set(f, fs.readFileSync(f).toString('latin1'));
    return files.get(f);
  };
  let k = 0;
  try {
    for (const c of cases) {
      for (const args of c.inputs) {
        const got = rs[k++];
        const shown = JSON.stringify(args).slice(0, 200);
        let want: unknown;
        try { want = { ok: JSON.parse(JSON.stringify(c.ts(...(args.map(text) as never[])) ?? null)) }; } catch (e) { want = { error: (e as Error).message }; }
        if ('error' in (want as object)) assert.ok(got.error, `${c.name}(${shown}): TypeScript throws, Rust answers ${JSON.stringify(got.ok)?.slice(0, 200)}`);
        else assert.deepEqual(got, want, `${c.name}(${shown})`);
      }
    }
  } finally { setLang('en'); }
  assert.equal(k, rs.length);
  return k;
}

test('pure functions in Rust answer as the TypeScript ones do', { skip }, () => {
  compare(CASES);
});

const GAME_PAK01 = 'c:/program files (x86)/steam/steamapps/common/dota 2 beta/game/dota/pak01_dir.vpk';
const sandboxGame = path.join(root, 'sandbox', 'steamapps', 'common', 'dota 2 beta', 'game');

/** Visuals blocks out of the sandbox's real items_game, and the table itself as a file. */
async function realItems() {
  const { readGameSchema, listItems } = await import('../src/schema-items.ts');
  const { text } = readGameSchema(sandboxGame);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-items-')), 'items_game.txt');
  fs.writeFileSync(file, Buffer.from(text, 'latin1'));
  const items = listItems(text).filter((i) => i.hasVisuals);
  const visualsOf = (block: string) => {
    let v: string | null = null;
    eachChild(block, blockBounds(block, 0), (c) => { if (!v && c.isBlock && c.key.toLowerCase() === 'visuals') v = block.slice(c.start, c.end); });
    return v as string | null;
  };
  const blocks = items.map((i) => ({ id: i.id, block: text.slice(i.start, i.end) }))
    .map((b) => ({ ...b, visuals: visualsOf(b.block) })).filter((b) => b.visuals);
  const styled = blocks.filter((b) => /"styles"/i.test(b.visuals!));
  const effects = blocks.filter((b) => /"particle(_create)?"/i.test(b.block));
  const spread = <T,>(a: T[], n: number) => a.filter((_, k) => k % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  return { file, blocks: spread(blocks, 150), styled: spread(styled, 150), effects: spread(effects, 80) };
}

test('item builder styles and donors in Rust answer as the TypeScript ones do, on the real table', { skip }, async (t) => {
  if (!fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no sandbox (npm run sandbox:seed)'); return; }
  const { file, blocks, styled, effects } = await realItems();
  const base = { $file: file };
  const some = [...styled, ...blocks];
  const keys = ['', 'style-2', 'a,style-3,b', 'xstyle-1', 'style-', 'from-123', ' from-77 ,style-1', 'from-x', 'from-1,from-2', 'style-12,from-5'];
  const cases: Case[] = [
    { name: 'item-builder-styles.styleTokens', ts: styleTokens as never, inputs: [[null], ['"visuals" { }'], ...some.map((b) => [b.visuals])] },
    { name: 'item-builder-styles.styleOf', ts: styleOf as never, inputs: keys.map((k) => [k]) },
    { name: 'item-builder-styles.withStyle', ts: withStyle as never, inputs: styled.flatMap((b) => [0, 1, 2, 5].map((n) => [b.visuals, n])) },
    { name: 'item-builder-styles.inEveryStyle', ts: inEveryStyle as never, inputs: some.flatMap((b) => [0, 1, 3].map((n) => [b.visuals, n])) },
    { name: 'item-builder-styles.blockInEveryStyle', ts: blockInEveryStyle as never, inputs: styled.map((b, k) => [b.block, some[(k * 7) % some.length].block]) },
    { name: 'item-builder-donor.donorOf', ts: donorOf as never, inputs: keys.map((k) => [k]) },
    { name: 'item-builder-donor.hasOwnEffect', ts: ((block: string, v: string | null) => hasOwnEffect(block, () => v)) as never, inputs: [...effects, ...blocks].map((b) => [b.block, b.visuals]) },
    { name: 'item-builder-donor.donorAdditions', ts: donorAdditions as never, inputs: effects.flatMap((d, k) => [[base, some[k % some.length].visuals, d.id], [base, d.visuals, d.id]]).concat([[base, '"visuals"{}', '99999999'], [base, '"visuals"{}', blocks[0].id]]) },
    { name: 'item-builder-donor.withModifiers', ts: withModifiers as never, inputs: [['"visuals"\r\n{\r\n}', ['"a"{}', '"b"{}']], ['no braces', ['x']], ['"v"{ }', []], ...some.slice(0, 20).map((b) => [b.visuals, ['"asset_modifier" { "type" "particle" }']])] },
    { name: 'item-builder-donor.withDonorEffects', ts: withDonorEffects as never, inputs: effects.map((d, k) => [base, some[(k * 3) % some.length].visuals, d.id]) },
  ];
  assert.ok(compare(cases) > 1000);
});

test('item effects, unusual effects, item visuals and localization in Rust answer as the TypeScript ones do', { skip }, async (t) => {
  if (!fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no sandbox (npm run sandbox:seed)'); return; }
  const { itemEffects, appendItemEffect, ITEM_EFFECTS } = await import('../src/item-builder-effects.ts');
  const { effectNames, unusualEffects } = await import('../src/unusual-effects.ts');
  const { offeredUnusual, unusualItemEffect } = await import('../src/item-builder-unusual.ts');
  const { localizationTokens, cosmeticNameTable } = await import('../src/cosmetic-names.ts');
  const { itemVisuals, findItems, defaultItem, buildPlan } = await import('../src/item-visuals.ts');
  const { listItems } = await import('../src/schema-items.ts');
  const { file, blocks, styled, effects } = await realItems();
  const base = { $file: file };
  const text = fs.readFileSync(file).toString('latin1');
  const some = [...styled, ...blocks, ...effects];
  const all = unusualEffects(text);
  const ids = all.map((e) => e.id);
  const sorted = (m: Map<number, string>) => [...m].sort((a, b) => a[0] - b[0]);
  const english = '"lang" { "Tokens" { "Attrib_Particle4" "Ethereal Flame"\n"Attrib_Particle6"\t"Sunfire" "Attrib_Particle7" "x\n"y" "Attrib_Particle4" "Again" } }';
  const items = listItems(text);
  const heroes = [...new Set(blocks.flatMap((b) => itemVisuals(text, b.id)?.heroes ?? []))].slice(0, 6);
  const slots = [...new Set(items.filter((i) => i.baseitem).map((i) => i.slot))].slice(0, 6);
  const cases: Case[] = [
    { name: 'item-builder-effects.itemEffects', ts: itemEffects as never, inputs: [[]] },
    { name: 'item-builder-effects.appendItemEffect', ts: appendItemEffect as never, inputs: some.flatMap((b, k) => [[b.visuals, ITEM_EFFECTS[k % ITEM_EFFECTS.length]]]).concat([['no braces', ITEM_EFFECTS[0]], ['"v" { }', ITEM_EFFECTS[1]]]) },
    { name: 'unusual-effects.effectNames', ts: ((s: string) => sorted(effectNames(s))) as never, inputs: [[english], [''], ['"Attrib_Particle12"   "Twelve"']] },
    { name: 'unusual-effects.unusualEffects', ts: unusualEffects as never, inputs: [[base, english], [base, ''], ['"x" { }', '']] },
    { name: 'item-builder-unusual.offeredUnusual', ts: ((s: string, named: number[]) => offeredUnusual(s, (id) => named.includes(id))) as never, inputs: [[base, ids], [base, ids.filter((_, k) => k % 3 === 0)], [base, []]] },
    { name: 'item-builder-unusual.unusualItemEffect', ts: unusualItemEffect as never, inputs: [...ids.slice(0, 40).map((id) => [base, `unusual-${id}`]), [base, 'unusual-999999'], [base, 'unusual-x'], [base, 'fire']] },
    { name: 'item-visuals.itemVisuals', ts: itemVisuals as never, inputs: [...some.map((b) => [base, b.id]), [base, '99999999']] },
    { name: 'item-visuals.findItems', ts: findItems as never, inputs: [[base, 'crown'], [base, 'ARCANA'], [base, blocks[3].id], [base, '99999999'], [base, 'é']] },
    { name: 'item-visuals.defaultItem', ts: defaultItem as never, inputs: heroes.flatMap((h) => slots.map((s) => [base, h, s])) },
    { name: 'item-visuals.buildPlan', ts: ((s: string, id: string) => { const v = itemVisuals(s, id); return v ? buildPlan(s, v) : null; }) as never, inputs: [...styled.slice(0, 40), ...effects.slice(0, 40)].map((b) => [base, b.id]) },
    { name: 'cosmetic-names.cosmeticNameTable', ts: ((list: { name: string; itemName: string }[], tokens: [string, string][]) => cosmeticNameTable(list, new Map(tokens))) as never, inputs: [[
      items.slice(0, 400).map((i) => ({ name: i.name, itemName: i.itemName })),
      items.slice(0, 400).flatMap((i, k) => (k % 5 ? [[i.itemName.replace(/^#/, '').toLowerCase(), k % 7 ? `перевод ${k}` : '#Token']] : [])),
    ], [[{ name: 'Same', itemName: '#a' }, { name: 'Same', itemName: '#b' }, { name: 'Same', itemName: '#c' }], [['a', 'one'], ['b', 'two'], ['c', 'one']]]] },
  ];
  // the game's own localization, read only, when it is on this machine
  if (fs.existsSync(GAME_PAK01)) {
    const { openVpkIndex } = await import('../src/vpk.ts');
    const index = openVpkIndex(GAME_PAK01);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-loc-'));
    const files = ['dota_english', 'items_russian', 'dota_schinese'].flatMap((n) => {
      const data = index.read(`resource/localization/${n}.txt`);
      if (!data) return [];
      const at = path.join(tmp, `${n}.txt`);
      fs.writeFileSync(at, data);
      return [{ $file: at }];
    });
    cases.push({ name: 'cosmetic-names.localizationTokens', ts: ((s: string) => [...localizationTokens(Buffer.from(s, 'latin1'))]) as never, inputs: files.map((f) => [f]) });
  }
  assert.ok(compare(cases) > 300);
});

test('model rewrites in Rust make the bytes the TypeScript ones make, on the game models', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01)) { t.skip('no game on this machine'); return; }
  const { createHash } = await import('node:crypto');
  const { openVpkIndex } = await import('../src/vpk.ts');
  const { modelSkinMaterials, withSkin } = await import('../src/model-skin.ts');
  const { withoutCloth, hasCloth, dragsCloth } = await import('../src/model-cloth.ts');
  const { attachmentNames, attachedAs } = await import('../src/model-attachments.ts');
  const { numberedAs } = await import('../src/model-sequences.ts');
  const index = openVpkIndex(GAME_PAK01);
  const models = [...index.paths()].filter((p) => p.endsWith('.vmdl_c'));
  const spread = <T,>(a: T[], n: number) => a.filter((_, k) => k % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-models-'));
  const saved = new Map<string, { $file: string }>();
  const file = (p: string) => {
    if (!saved.has(p)) {
      const at = path.join(tmp, `${saved.size}.vmdl_c`);
      fs.writeFileSync(at, index.read(p) ?? Buffer.alloc(0));
      saved.set(p, { $file: at });
    }
    return saved.get(p)!;
  };
  const buf = (s: string) => Buffer.from(s, 'latin1');
  const sha = (b: Buffer | null) => (b ? createHash('sha1').update(b).digest('hex') : null);
  const bodies = models.filter((p) => /^models\/heroes\/([^/]+)\/\1\.vmdl_c$/.test(p));
  const items = spread(models.filter((p) => p.startsWith('models/items/')), 160);
  const couriers = spread(models.filter((p) => p.startsWith('models/courier/')), 60);
  const spirits = models.filter((p) => /forge_spirit/.test(p));
  const plainCouriers = ['donkey', 'donkey_wings', 'donkey_dire', 'donkey_dire_wings'].map((n) => `models/props_gameplay/${n}.vmdl_c`);
  const bodyOf = (p: string) => bodies.find((b) => p.startsWith(`models/items/${b.split('/')[2]}/`)) ?? bodies[0];
  const some = [...items, ...couriers, ...spread(bodies, 40)];
  const cases: Case[] = [
    { name: 'model-skin.modelSkinMaterials', ts: ((m: string | null, s: number) => [...modelSkinMaterials(m === null ? null : buf(m), s)]) as never, inputs: [[null, 1], ...some.flatMap((p) => [0, 1, 2].map((s) => [file(p), s]))] },
    { name: 'model-skin.withSkin', ts: ((m: string, s: number) => sha(withSkin(buf(m), s))) as never, inputs: some.flatMap((p) => [0, 1, 3].map((s) => [file(p), s])) },
    { name: 'model-cloth.withoutCloth', ts: ((m: string) => sha(withoutCloth(buf(m)))) as never, inputs: some.map((p) => [file(p)]) },
    { name: 'model-cloth.hasCloth', ts: ((m: string) => hasCloth(buf(m))) as never, inputs: some.map((p) => [file(p)]) },
    { name: 'model-cloth.dragsCloth', ts: ((m: string | null) => dragsCloth(m === null ? null : buf(m))) as never, inputs: [[null], ...bodies.map((p) => [file(p)])] },
    { name: 'model-attachments.attachmentNames', ts: ((m: string) => attachmentNames(buf(m))) as never, inputs: some.map((p) => [file(p)]) },
    { name: 'model-attachments.attachedAs', ts: ((m: string, p: string) => sha(attachedAs(buf(m), buf(p)))) as never, inputs: items.map((p) => [file(p), file(bodyOf(p))]) },
    { name: 'model-sequences.numberedAs', ts: ((m: string, p: string) => sha(numberedAs(buf(m), buf(p)))) as never, inputs: [
      ...couriers.flatMap((p) => plainCouriers.map((c) => [file(p), file(c)])),
      ...spirits.map((p) => [file(p), file('models/heroes/invoker/forge_spirit.vmdl_c')]),
      ...items.slice(0, 40).map((p) => [file(p), file(bodyOf(p))]),
    ] },
  ];
  assert.ok(compare(cases) > 1000);
});
