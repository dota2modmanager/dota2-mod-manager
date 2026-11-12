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

/** `ulps`: numbers may differ by that many units in the last place (sines and cosines, which V8
 * takes from glibc and Rust from fdlibm); every other answer must be the same. */
type Case = { name: string; ts: (...a: never[]) => unknown; inputs: unknown[][]; ulps?: number };

/** `a` with each number that is within `ulps` of the same place in `b` replaced by b's. */
function near(a: unknown, b: unknown, ulps: number): unknown {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= ulps * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE) ? b : a;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => near(x, b[i], ulps));
  if (a && b && typeof a === 'object' && typeof b === 'object') return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, near(v, (b as Record<string, unknown>)[k], ulps)]));
  return a;
}

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
        else assert.deepEqual(c.ulps ? near(got, want, c.ulps) : got, want, `${c.name}(${shown})`);
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

test('item skins, voices and sound files in Rust answer as the TypeScript ones do', { skip }, async (t) => {
  if (!fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no sandbox (npm run sandbox:seed)'); return; }
  const { createHash } = await import('node:crypto');
  const { firstStyleSkin, wornSkin } = await import('../src/item-skin.ts');
  const { itemVisuals } = await import('../src/item-visuals.ts');
  const { file, blocks, styled } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const some = [...styled, ...blocks];
  const skinned = [...text.matchAll(/"asset_modifier\d*"\s*\{[^{}]*"model_skin"[^{}]*\}/gi)].slice(0, 60).map((m) => `"visuals" { ${m[0]} }`);
  const models = some.slice(0, 60).map((b) => itemVisuals(text, b.id)?.model ?? null);
  const cases: Case[] = [
    { name: 'item-skin.firstStyleSkin', ts: firstStyleSkin as never, inputs: [...some, ...skinned.map((v) => ({ visuals: v }))].map((b) => [b.visuals]) },
    { name: 'item-skin.wornSkin', ts: wornSkin as never, inputs: [
      ['', 3], ...some.flatMap((b) => [[b.visuals], [b.visuals, 2]]),
      ...skinned.flatMap((v, k) => [[v], [v, 1, 'models/heroes/x/x.vmdl'], [v, 0, models[k % models.length] ?? undefined]]),
    ] },
  ];
  if (fs.existsSync(GAME_PAK01)) {
    const { openVpkIndex, entryPath } = await import('../src/vpk.ts');
    const { voiceSwaps, soundEntries } = await import('../src/item-sounds.ts');
    const { dataBlock } = await import('../src/resource.ts');
    const { readKv3 } = await import('../src/kv3.ts');
    const index = openVpkIndex(GAME_PAK01);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-rules-'));
    const voices: unknown[][] = [];
    for (const p of [...index.paths()].filter((p) => /^scripts\/talker\/response_rules_.*\.vrr_c$/.test(p))) {
      const data = index.read(p)!;
      const at = path.join(tmp, `${voices.length}.vrr_c`);
      fs.writeFileSync(at, data);
      let criteria: { key: string; value: string }[] = [];
      try {
        const root = readKv3(dataBlock(data).data).root;
        const req = root.kind === 'object' ? root.members.get('m_Requirements') : undefined;
        const str = (n: unknown, k: string) => { const v = (n as { members?: Map<string, { kind: string; value: string }> }).members?.get(k); return v?.kind === 'string' ? v.value : ''; };
        criteria = (req?.kind === 'array' ? req.items : []).map((c) => ({ key: str(c, 'm_matchKey'), value: str(c, 'm_matchExpr') }))
          .filter((c) => /customresponse|persona/i.test(c.key) && !c.value.startsWith('!='));
      } catch { /* a file TypeScript cannot read: Rust must fail on it too */ }
      const seen = new Set<string>();
      for (const c of criteria) {
        if (seen.has(c.value) || seen.size >= 3) continue;
        seen.add(c.value);
        voices.push([{ $file: at }, { ...c, hero: '' }], [{ $file: at }, { key: c.key.toUpperCase(), value: c.value, hero: '', whole: true }]);
      }
      if (!criteria.length && voices.length < 400) voices.push([{ $file: at }, { key: 'customresponse', value: 'none', hero: '' }]);
    }
    cases.push({ name: 'item-sounds.voiceSwaps', ts: ((f: string, cue: { key: string; value: string; whole?: boolean }) => voiceSwaps(readKv3(dataBlock(Buffer.from(f, 'latin1')).data).root, cue)) as never, inputs: voices });
    const swaps = [...text.matchAll(/"asset_modifier\d*"\s*\{([^{}]*"type"\s+"sound"[^{}]*)\}/gi)].map((m) => ({
      sound: /"asset"\s+"([^"]+)"/i.exec(m[1])?.[1] ?? '', as: /"modifier"\s+"([^"]+)"/i.exec(m[1])?.[1] ?? '',
    })).filter((s) => s.sound && s.as).slice(0, 40);
    const game = path.dirname(path.dirname(GAME_PAK01));
    const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');
    cases.push({ name: 'item-sounds.soundEntries', ts: ((g: string, sw: never[], cues: never[]) => soundEntries(g, sw, cues).map((e) => [entryPath(e), sha(e.data)])) as never, inputs: [
      [game, [], []], [game, swaps, []],
      [game, swaps.slice(0, 5), [{ hero: 'npc_dota_hero_earthshaker', key: 'customresponse', value: 'eartharc_cosmos' }, { hero: 'npc_dota_hero_drow_ranger', key: 'customresponse', value: 'x' }]],
    ] });
    assert.ok(swaps.length > 10 && voices.length > 100);
  }
  assert.ok(compare(cases) > 300);
});

test('material expressions in Rust read and rewrite as the TypeScript ones do, on the game materials', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01)) { t.skip('no game on this machine'); return; }
  const { createHash } = await import('node:crypto');
  const { openVpkIndex } = await import('../src/vpk.ts');
  const m = await import('../src/material.ts');
  const index = openVpkIndex(GAME_PAK01);
  const all = [...index.paths()].filter((p) => p.endsWith('.vmat_c'));
  const spread = <T,>(a: T[], n: number) => a.filter((_, k) => k % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-vmat-'));
  const buf = (s: string) => Buffer.from(s, 'latin1');
  const hex = (b: Buffer | null) => (b ? b.toString('hex') : null);
  const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');
  // the materials that have expressions, those that read the gem first, and a spread of the rest
  const gem = m.attributeToken('$GemColor').toString(16).padStart(8, '0').match(/../g)!.reverse().join('');
  const gems: string[] = [];
  const plain: string[] = [];
  for (const p of spread(all, 6000)) {
    let codes: string[] = [];
    try { codes = m.materialExpressions(index.read(p)!).map((e) => e.code.toString('hex')); } catch { /* compared as it is below */ }
    if (codes.some((c) => c.includes(`19${gem}`))) gems.push(p);
    else if (codes.length) plain.push(p);
  }
  const files = [...spread(gems, 200), ...spread(plain, 60), ...spread(all, 60)].map((p, k) => {
    const at = path.join(tmp, `${k}.vmat_c`);
    fs.writeFileSync(at, index.read(p)!);
    return { $file: at };
  });
  const codes = files.flatMap((f) => { try { return m.materialExpressions(fs.readFileSync(f.$file)).map((e) => e.code.toString('hex')); } catch { return []; } }).slice(0, 400);
  const colours = [[1, 0, 0], [0.35, 0.74, 1], [0.1, 0.2, 0.3, 0.4], [1e-7, 123.456, -2]];
  const cases: Case[] = [
    { name: 'material.attributeToken', ts: m.attributeToken as never, inputs: ['$GemColor', '$gemcolor', '', 'a', 'ab', 'abc', 'abcd', 'abcde', '$Time', 'Привет', 'ÉCLAT'].map((n) => [n]) },
    { name: 'material.constantExpression', ts: ((v: number[]) => hex(m.constantExpression(v))) as never, inputs: colours.map((c) => [c]) },
    { name: 'material.constantOf', ts: ((c: string) => m.constantOf(Buffer.from(c, 'hex'))) as never, inputs: [...colours.map((c) => [m.constantExpression(c).toString('hex')]), ...codes.map((c) => [c]), ['']] },
    { name: 'material.withConstant', ts: ((c: string, tok: number, v: number[]) => hex(m.withConstant(Buffer.from(c, 'hex'), tok, v))) as never, inputs: codes.flatMap((c, k) => [[c, m.attributeToken('$GemColor'), colours[k % 4]], [c, m.attributeToken('$Time'), colours[1]]]) },
    { name: 'material.materialExpressions', ts: ((f: string) => m.materialExpressions(buf(f)).map((e) => ({ name: e.name, code: e.code.toString('hex') }))) as never, inputs: files.map((f) => [f]) },
    { name: 'material.rewriteWithConstant', ts: ((f: string, a: string, v: number[]) => {
      const { file, changed } = m.rewriteExpressions(buf(f), (e) => m.withConstant(e.code, m.attributeToken(a), v));
      return [sha(file), changed];
    }) as never, inputs: files.flatMap((f, k) => [[f, '$GemColor', colours[k % 4]], [f, '$Time', colours[0]]]) },
  ];
  assert.ok(gems.length > 5 && codes.length > 100, `${gems.length} gems, ${codes.length} expressions`);
  assert.ok(compare(cases) > 500);
});

test('recolouring in Rust makes the files the TypeScript makes, on the game particles', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01)) { t.skip('no game on this machine'); return; }
  const { createHash } = await import('node:crypto');
  const { openVpkIndex } = await import('../src/vpk.ts');
  const r = await import('../src/recolor.ts');
  const index = openVpkIndex(GAME_PAK01);
  const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');
  const buf = (s: string) => Buffer.from(s, 'latin1');
  const spread = <T,>(a: T[], n: number) => a.filter((_, k) => k % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const sets = Object.values(r.RECOLOR_SETS);
  const under = (p: string, f: string[]) => f.some((x) => p.startsWith(x));
  const all = [...index.paths()];
  const particles = spread(all.filter((p) => p.endsWith('.vpcf_c') && sets.some((s) => under(p, [...s.own, ...s.shared]))), 300)
    .concat(spread(all.filter((p) => p.endsWith('.vpcf_c')), 100));
  const materials = all.filter((p) => p.endsWith('.vmat_c') && sets.some((s) => under(p, s.materials)));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-recolor-'));
  const file = (p: string, k: number) => { const at = path.join(tmp, `${k}`); fs.writeFileSync(at, index.read(p)!); return { $file: at }; };
  const pf = particles.map(file);
  const mf = materials.map((p, k) => file(p, 10000 + k));
  const colours: [number, number, number][] = [[255, 0, 0], [0, 128, 255], [30, 200, 90], [255, 255, 255], [8, 8, 8], [255, 60, 40]];
  const grid = [0, 3, 64, 128, 200, 255].flatMap((a) => [0, 90, 255].flatMap((b) => [0, 170].map((c) => [a, b, c])));
  const cases: Case[] = [
    { name: 'recolor.shade', ts: r.shade as never, inputs: grid.flatMap((g, k) => [[g, colours[k % 6]], [g, colours[k % 6], colours[(k + 1) % 6]], [g, colours[k % 6], [0, 0, 0]]]) },
    { name: 'recolor.recolorResource', ts: ((f: string, c: [number, number, number], o: object) => { const x = r.recolorResource(buf(f), c, o); return [sha(x.file), x.changed, x.skipped]; }) as never, inputs: pf.flatMap((f, k) => [
      [f, colours[k % 6], {}], [f, colours[(k + 1) % 6], { gem: [255, 60, 40] }], [f, colours[(k + 2) % 6], { bake: true }],
      [f, colours[(k + 3) % 6], { gem: [255, 175, 0], own: false }], [f, colours[k % 6], { bake: true, own: false, from: [64, 192, 255] }],
    ]) },
    { name: 'recolor.recolorMaterial', ts: ((f: string, c: [number, number, number], o: object) => { const x = r.recolorMaterial(buf(f), c, o); return [sha(x.file), x.changed]; }) as never, inputs: mf.flatMap((f, k) => [[f, colours[k % 6], {}], [f, colours[k % 6], { bake: true }]]) },
    { name: 'recolor.liftForMod2x', ts: ((f: string, share?: number) => { const x = r.liftForMod2x(buf(f), share); return [sha(x.file), x.changed]; }) as never, inputs: pf.flatMap((f) => [[f], [f, 0.6]]) },
    { name: 'recolor.buildRecolor', ts: ((pak01: string, set: string, target: [number, number, number]) => {
      const x = r.buildRecolor({ pak01, set, target });
      return [sha(x.vpk), x.files, x.changed, x.skipped, x.failed.map((f) => f.path)];
    }) as never, inputs: Object.keys(r.RECOLOR_SETS).flatMap((s, k) => [[GAME_PAK01, s, colours[k % 6]], [GAME_PAK01, s, [255, 255, 255]]]).concat([[GAME_PAK01, 'no-such-set', [1, 2, 3]]]) },
  ];
  assert.ok(compare(cases) > 1500);
});

test('particle trees, snapshots and attachment points in Rust answer as the TypeScript ones do', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01) || !fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no game or no sandbox'); return; }
  const { openVpkIndex } = await import('../src/vpk.ts');
  const ps = await import('../src/particle-spec.ts');
  const { snapshotPoints } = await import('../src/particle-snapshot.ts');
  const { unusualEffects } = await import('../src/unusual-effects.ts');
  const { file, blocks, effects } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const index = openVpkIndex(GAME_PAK01);
  const read = (p: string) => index.read(p);
  const all = [...index.paths()];
  const spread = <T,>(a: T[], n: number) => a.filter((_, k) => k % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-fx-'));
  const save = (p: string, k: string) => { const at = path.join(tmp, k); fs.writeFileSync(at, index.read(p)!); return { $file: at }; };
  const fromItems = [...new Set([...effects, ...blocks].flatMap((b) => ps.itemParticles(b.block)))];
  const systems = [...spread(fromItems, 120), ...spread(all.filter((p) => p.endsWith('.vpcf_c')), 60).map((p) => p.replace(/_c$/, ''))];
  const snaps = spread(all.filter((p) => p.endsWith('.vsnap_c')), 40);
  const scripts = all.filter((p) => /^scripts\/npc\/heroes\/npc_dota_hero_\w+\.txt$/.test(p));
  const models = spread(all.filter((p) => p.endsWith('.vmdl_c')), 120);
  const unusual = unusualEffects(text).slice(0, 30);
  const def = (pak: string, s: string) => ps.particleDef(read, s);
  const cases: Case[] = [
    { name: 'particle-spec.itemParticles', ts: ps.itemParticles as never, inputs: [...effects, ...blocks].map((b) => [b.block]) },
    { name: 'particle-spec.particleDef', ts: def as never, inputs: systems.map((s) => [GAME_PAK01, s]).concat([[GAME_PAK01, 'particles/none.vpcf']]) },
    { name: 'particle-spec.particleTextures', ts: ((pak: string, s: string) => { const d = def(pak, s); return d ? ps.particleTextures(d) : null; }) as never, inputs: systems.map((s) => [GAME_PAK01, s]) },
    { name: 'particle-spec.bindItemParticle', ts: ((pak: string, s: string, e: never, c: string) => { const d = def(pak, s); return d ? ps.bindItemParticle(d, e ?? undefined, c) : null; }) as never, inputs: systems.slice(0, 60).flatMap((s, k) => [
      [GAME_PAK01, s, unusual[k % unusual.length], ''], [GAME_PAK01, s, null, 'preview'], [GAME_PAK01, s, unusual[(k + 7) % unusual.length], 'loadout'], [GAME_PAK01, s, null, ''],
    ]) },
    { name: 'particle-spec.heroLoadoutParticles', ts: ps.heroLoadoutParticles as never, inputs: scripts.map((p, k) => [save(p, `h${k}.txt`)]) },
    { name: 'particle-spec.modelAttachments', ts: ((m: string | null) => ps.modelAttachments(m === null ? null : Buffer.from(m, 'latin1'))) as never, inputs: [[null], ...models.map((p, k) => [save(p, `m${k}`)])] },
    { name: 'particle-spec.dataTree', ts: ((m: string | null) => ps.dataTree(m === null ? null : Buffer.from(m, 'latin1'))) as never, inputs: [[null], ...snaps.map((p, k) => [save(p, `s${k}`)]), ...models.slice(0, 20).map((p, k) => [save(p, `d${k}`)])] },
    { name: 'particle-snapshot.snapshotPoints', ts: ((m: string) => { const f = Buffer.from(m, 'latin1'); const d = ps.dataTree(f); if (!d) throw new Error('no tree'); return snapshotPoints(f, d); }) as never, inputs: snaps.map((p, k) => [save(p, `p${k}`)]) },
  ];
  assert.ok(fromItems.length > 50 && snaps.length > 10 && scripts.length > 100);
  assert.ok(compare(cases) > 800);
});

test('surface hitboxes and the effects that spread over them in Rust make what the TypeScript makes', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01) || !fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no game or no sandbox'); return; }
  const { createHash } = await import('node:crypto');
  const { openVpkIndex, entryPath } = await import('../src/vpk.ts');
  const h = await import('../src/model-hitboxes.ts');
  const { surfaceSystem } = await import('../src/particle-surface.ts');
  const { unusualEffects } = await import('../src/unusual-effects.ts');
  const { modelScaleReady } = await import('../src/model-scale.ts');
  await modelScaleReady();
  const { file } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const index = openVpkIndex(GAME_PAK01);
  const sha = (b: Buffer | null) => (b ? createHash('sha1').update(b).digest('hex') : null);
  const buf = (s: string) => Buffer.from(s, 'latin1');
  const all = [...index.paths()];
  const spread = <T,>(a: T[], n: number) => a.filter((_, k) => k % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-boxes-'));
  const models = spread(all.filter((p) => p.startsWith('models/items/') && p.endsWith('.vmdl_c')), 60).map((p, k) => {
    const at = path.join(tmp, `${k}`); fs.writeFileSync(at, index.read(p)!); return { $file: at };
  });
  const systems = [...new Set(unusualEffects(text).map((e) => e.system))].slice(0, 80);
  const cases: Case[] = [
    { name: 'model-hitboxes.nameHash', ts: h.nameHash as never, inputs: ['mm_surface', 'Bip01_Head', '', 'a', 'abcde'].map((n) => [n]) },
    { name: 'model-hitboxes.surfaceBoxes', ts: ((m: string) => h.surfaceBoxes(buf(m))) as never, inputs: models.map((m) => [m]) },
    { name: 'model-hitboxes.withSurfaceHitboxes', ts: ((m: string, names?: string[]) => sha(h.withSurfaceHitboxes(buf(m), names))) as never, inputs: models.flatMap((m) => [[m], [m, ['mm_surface', 'Default', 'second']]]) },
    { name: 'particle-surface.surfaceSystem', ts: ((pak: string, s: string) => {
      const r = surfaceSystem((p) => index.read(p), s);
      return r ? [r.root, r.entries.map((e) => [entryPath(e), sha(e.data)])] : null;
    }) as never, inputs: systems.map((s) => [GAME_PAK01, s]) },
  ];
  assert.ok(systems.length > 20);
  assert.ok(compare(cases) > 250);
});

test('hand-made effect changes in Rust make the files the TypeScript makes, on the game particles', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01) || !fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no game or no sandbox'); return; }
  const { createHash } = await import('node:crypto');
  const { openVpkIndex, entryPath } = await import('../src/vpk.ts');
  const fx = await import('../src/effect-edit.ts');
  const { unusualEffects } = await import('../src/unusual-effects.ts');
  const { file } = await realItems();
  const index = openVpkIndex(GAME_PAK01);
  const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');
  const read = (p: string) => index.read(p);
  const all = [...index.paths()].filter((p) => p.endsWith('.vpcf_c'));
  const spread = <T,>(a: T[], n: number) => a.filter((_, k) => k % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const systems = [...new Set(unusualEffects(fs.readFileSync(file).toString('latin1')).map((e) => e.system))].slice(0, 40)
    .concat(spread(all, 80).map((p) => p.replace(/_c$/, '')));
  const raws: unknown[] = [null, 5, [], {}, { '*': { size: 150 } }, { '*': { size: 100, count: '120', life: null, tint: '#FF8800' } },
    { 'Particles\Units\X.vpcf_c': { speed: 1000, tint: 'red' }, bad: { size: 50 }, '*': [1], 'particles/a.vpcf': { size: Number.NaN, count: 7, life: 302 } },
    { '*': { tint: '#00ff00', size: 'x' }, 'particles/b/c.vpcf': null, 'particles/.vpcf': { size: 50 } }];
  const editsFor = (s: string, k: number): Record<string, unknown> => [
    { '*': { size: 150, count: 50 } },
    { '*': { life: 200, speed: 30 }, [s]: { size: 80, tint: '#3366ff' } },
    { [s]: { count: 300, tint: '#ff0000' } },
    { '*': { tint: '#ffffff', speed: 250 } },
  ][k % 4];
  const cases: Case[] = [
    { name: 'effect-edit.cleanEdits', ts: fx.cleanEdits as never, inputs: raws.map((r) => [r]) },
    { name: 'effect-edit.systemsOf', ts: ((pak: string, s: string) => fx.systemsOf(read, s)) as never, inputs: systems.map((s) => [GAME_PAK01, s]) },
    { name: 'effect-edit.editedEntries', ts: ((pak: string, s: string, e: never) => fx.editedEntries(read, s, e).map((x) => [entryPath(x), sha(x.data)])) as never,
      inputs: systems.flatMap((s, k) => [[GAME_PAK01, s, fx.cleanEdits(editsFor(s, k))], [GAME_PAK01, s, fx.cleanEdits(editsFor(s, k + 1))]]) },
  ];
  assert.ok(systems.length > 60);
  assert.ok(compare(cases) > 250);
});

test('hero sound events in Rust read and write back as the TypeScript ones do', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01)) { t.skip('no game'); return; }
  const as = await import('../src/ability-sounds.ts');
  const { openVpkIndex } = await import('../src/vpk.ts');
  const { readKv3 } = await import('../src/kv3.ts');
  const { resourceBlock } = await import('../src/resource.ts');
  const index = openVpkIndex(GAME_PAK01);
  const heroes = as.heroesWithSounds(index);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-snd-'));
  const kvOf = (m: string) => readKv3(resourceBlock(Buffer.from(m, 'latin1'), 'DATA').data);
  const files = heroes.map((h, k) => { const at = path.join(tmp, `${k}`); fs.writeFileSync(at, index.read(as.eventsFile(h))!); return { hero: h, file: { $file: at } }; });
  const editsOf = (h: string) => {
    const ev = as.heroEvents(readKv3(resourceBlock(index.read(as.eventsFile(h))!, 'DATA').data)).map((e) => e.name);
    const sound = 'ab12cd34ef56ab78cd90ef12ab34cd56ef7890ab';
    return [
      { event: ev[0], mode: 'replace', volume: 0.8, sound, name: 'a' },
      { event: ev[1] ?? 'x', mode: 'layer', volume: 1.234, sound, name: 'b' },
      { event: ev[1] ?? 'x', mode: 'layer', volume: 0.005, sound: sound.replace('a', 'f'), name: 'c' },
      { event: 'nope.event', mode: 'replace', volume: 1, sound, name: 'd' },
      { event: ev[2] ?? 'y', mode: 'layer', volume: 0.125, sound, name: 'e' },
      { event: ev[0], mode: 'layer', volume: 2, sound, name: 'f' },
    ];
  };
  const wav = (fmt: number, rate: number, bits: number, junk = 0) => {
    const b = Buffer.alloc(12 + junk + 8 + 24);
    b.write('RIFF', 0); b.write('WAVE', 8);
    if (junk) { b.write('LIST', 12); b.writeUInt32LE(junk - 8, 16); }
    const at = 12 + junk; b.write('fmt ', at); b.writeUInt32LE(16, at + 4); b.writeUInt16LE(fmt, at + 8); b.writeUInt32LE(rate, at + 12); b.writeUInt16LE(bits, at + 22);
    const p = path.join(tmp, `w${fmt}-${rate}-${bits}-${junk}`); fs.writeFileSync(p, b); return { $file: p };
  };
  const odd = path.join(tmp, 'odd'); fs.writeFileSync(odd, Buffer.from('RIFF\0\0\0\0WAVEdata\x05\0\0\0abcde'));
  const cases: Case[] = [
    { name: 'ability-sounds.eventsFile', ts: as.eventsFile as never, inputs: heroes.map((h) => [h]) },
    { name: 'ability-sounds.soundPath', ts: as.soundPath as never, inputs: [['axe', 'ab12cd34ef56ab78cd90'], ['pudge', 'short'], ['x', '']] },
    { name: 'ability-sounds.soundHero', ts: as.soundHero as never, inputs: [...heroes, 'nope', ''].map((h) => [h]) },
    { name: 'ability-sounds.heroesWithSounds', ts: ((p: string) => as.heroesWithSounds(openVpkIndex(p))) as never, inputs: [[GAME_PAK01]] },
    { name: 'ability-sounds.heroEvents', ts: ((m: string) => as.heroEvents(kvOf(m))) as never, inputs: files.map((f) => [f.file]) },
    { name: 'ability-sounds.editedEvents', ts: ((m: string, h: string, e: never) => as.editedEvents(kvOf(m), h, e)) as never, inputs: files.map((f) => [f.file, f.hero, editsOf(f.hero)]) },
    { name: 'ability-sounds.wavProblem', ts: ((m: string) => as.wavProblem(Buffer.from(m, 'latin1'))) as never, inputs: [
      [wav(1, 44100, 16)], [wav(1, 48000, 16, 20)], [wav(3, 44100, 32)], [wav(1, 44100, 24)], [wav(1, 32000, 16)], [{ $file: odd }], [{ $file: files[0].file.$file }],
    ] },
    { name: 'js.toFixed', ts: ((x: number, d: number) => x.toFixed(d)) as never, inputs: [
      [1 / 128, 6], [0.5, 0], [1.5, 0], [2.5, 0], [-2.5, 0], [-0.0001, 2], [1.005, 2], [0.125, 2], [123.456, 1], [1e20, 2], [1e21, 2], [-0, 2], [0.000001, 6], [99.995, 2], [9.9999999, 6], [0.8, 2],
    ] },
  ];
  assert.ok(heroes.length > 100);
  assert.ok(compare(cases) > 400);
});

test('hero stages in Rust are the ones the TypeScript reads out of the game', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01)) { t.skip('no game'); return; }
  const hs = await import('../src/hero-showcase.ts');
  const { openVpkIndex } = await import('../src/vpk.ts');
  const index = openVpkIndex(GAME_PAK01);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-stage-'));
  const save = (p: string, b: Buffer) => { const at = path.join(tmp, p); fs.writeFileSync(at, b); return { $file: at }; };
  const showcaseBuf = index.read('scripts/npc/portraits_showcase.txt');
  if (!showcaseBuf) { t.skip('no portraits_showcase.txt'); return; }
  const showcase = save('showcase', showcaseBuf);
  const text = showcaseBuf.toString('latin1');
  const entries = [...text.matchAll(/^\t"([^"]+)"\s*$/gm)].map((m) => m[1]);
  const scripts = [...index.paths()].filter((p) => /^scripts\/npc\/heroes\/npc_dota_hero_\w+\.txt$/.test(p));
  const inputs: unknown[][] = scripts.map((p, k) => {
    const hero = /npc_dota_hero_(\w+)\.txt$/.exec(p)![1];
    return [showcase, save(`h${k}`, index.read(p)!), [entries[k % entries.length].toUpperCase().replace(/\//g, '\\'), `npc_dota_hero_${hero}`, hero]];
  });
  inputs.push([null, null, ['x']], [save('bad', Buffer.from('"a" { "b" { ')), null, ['b']], [save('odd', Buffer.from('"x" { "k" { "PortraitLightPosition" "1 2" "PortraitBackgroundColor1" "  10\t20 30 40 " "PortraitBackgroundModel" "Models/Foo/Bar.VMDL" } }')), save('sc', Buffer.from('"LoadoutScale"  "0.5.1"  "loadoutscale" "0.7"')), ['K']]);
  const buf = (m: string | null) => (m === null ? null : Buffer.from(m, 'latin1').toString('latin1'));
  const cases: Case[] = [
    { name: 'hero-showcase.heroStage', ts: ((s: string | null, sc: string | null, keys: string[]) => hs.heroStage(buf(s), buf(sc), keys)) as never, inputs , ulps: 4 },
    { name: 'hero-showcase.showcaseEntry', ts: ((s: string, keys: string[]) => { const m = hs.showcaseEntry(s, keys); return m ? Object.fromEntries(m) : null; }) as never,
      inputs: entries.slice(0, 40).map((e) => [showcase, ['nope', e]]) },
    { name: 'hero-showcase.forward', ts: ((a: number, b: number, c: number) => hs.forward([a, b, c])) as never,
      inputs: Array.from({ length: 200 }, (_, k) => [((k * 37) % 360) - 180 + k / 7, (k * 113) % 720 - 360 + k / 3, 0]) , ulps: 4 },
  ];
  assert.ok(entries.length > 50 && scripts.length > 100);
  assert.ok(compare(cases) > 300);
});

test('packing a folder in Rust finds the root and makes the VPK the TypeScript makes', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01)) { t.skip('no game'); return; }
  const { createHash } = await import('node:crypto');
  const vp = await import('../src/vpk-pack.ts');
  const { openVpkIndex } = await import('../src/vpk.ts');
  const index = openVpkIndex(GAME_PAK01);
  const all = [...index.paths()];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-pack-'));
  const put = (at: string, b: Buffer | string) => { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.writeFileSync(at, b); };
  const trees: string[] = [];
  for (let k = 0; k < 6; k++) {
    const top = path.join(tmp, `t${k}`);
    const base = [top, path.join(top, 'Wrapper'), path.join(top, 'game', 'dota_russian'), path.join(top, 'a', 'b')][k % 4];
    for (const p of all.filter((_, i) => i % (997 + k * 13) === k).slice(0, 25)) put(path.join(base, k === 3 ? p.replace(/^(\w)/, (c) => c.toUpperCase()) : p), index.read(p)!);
    put(path.join(base, 'readme.txt'), 'hello');
    put(path.join(base, 'Thumbs.db'), 'x');
    put(path.join(base, 'author_stuff', 'note.txt'), 'n');
    if (k === 4) put(path.join(top, '__MACOSX', 'models', 'x.txt'), 'junk');
    trees.push(top);
  }
  fs.mkdirSync(path.join(tmp, 'empty', 'models'), { recursive: true });
  put(path.join(tmp, 'flat', 'x.txt'), 'x');
  const cases: Case[] = [
    { name: 'vpk-pack.findContentRoot', ts: ((d: string) => vp.findContentRoot(d)) as never, inputs: [...trees, path.join(tmp, 'empty'), path.join(tmp, 'flat'), path.join(tmp, 'nope')].map((d) => [d]) },
    { name: 'vpk-pack.packFolder', ts: ((d: string) => createHash('sha1').update(vp.packFolder(d)).digest('hex')) as never,
      inputs: [...trees.map((d) => [vp.findContentRoot(d)]), [path.join(tmp, 'empty')]] },
  ];
  assert.ok(compare(cases) > 10);
});

test('arcana notes and the item builder details in Rust answer as the TypeScript ones do', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01) || !fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no game or no sandbox'); return; }
  const notes = await import('../src/arcana-notes.ts');
  const bases = await import('../src/arcana-bases.ts');
  const det = await import('../src/item-builder-details.ts');
  const { drain } = await import('../src/steps.ts');
  const { gameTokens } = await import('../src/cosmetic-names.ts');
  const { readGameSchema, listItems } = await import('../src/schema-items.ts');
  const { openVpkIndex } = await import('../src/vpk.ts');
  const { text } = readGameSchema(sandboxGame);
  const items = listItems(text);
  const heroesOf = (block: string) => [...block.matchAll(/"npc_dota_hero_(\w+)"\s+"1"/gi)].map((m) => m[1].toLowerCase());
  const arcanas = items.filter((i) => /"item_rarity"\s+"arcana"/i.test(text.slice(i.start, i.end)));
  const spread = <T,>(a: T[], n: number) => a.filter((_, k) => k % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const some = [...arcanas, ...spread(items, 300)];
  const game = path.dirname(path.dirname(GAME_PAK01));
  const tokens = gameTokens(game, 'russian');
  const tokenPairs = [...tokens];
  const marked = tokenPairs.filter(([, v]) => /[<&]/.test(v)).map(([, v]) => v);
  const events = [...new Set([...text.matchAll(/"(EVENT_ID_\w+)"/g)].map((m) => m[1]))];
  const heroIds = [...new Set(items.flatMap((i) => heroesOf(text.slice(i.start, i.end))))];
  const plain = (s: string) => det.setDetails([{ nameToken: '', name: '', rarity: '', event: '', descToken: 'd', pieces: [], styles: 1 } as never], () => s, () => undefined)[0].description;
  const cases: Case[] = [
    { name: 'arcana-notes.itemNote', ts: notes.itemNote as never, inputs: some.flatMap((i) => { const b = text.slice(i.start, i.end); return [[heroesOf(b), b, i.id], [heroesOf(b), b]]; }).concat([[[], '"item_rarity" "ARCANA"'], [['razor', 'pudge'], '"item_rarity"\t"arcana"'], [['nobody'], '"item_rarity" "arcana"']]) },
    { name: 'arcana-notes.isArcanaBlock', ts: notes.isArcanaBlock as never, inputs: some.slice(0, 60).map((i) => [text.slice(i.start, i.end)]) },
    { name: 'arcana-bases.hasBase', ts: bases.hasBase as never, inputs: [...arcanas.map((i) => [i.id]), ['1'], ['']] },
    { name: 'item-builder-details.itemFacts', ts: det.itemFacts as never, inputs: some.map((i) => [text.slice(i.start, i.end)]).concat([['\n"item_rarity" "Mythical"\n"creation_date" "2021-09-01 10:00"'], ['"item_rarity" "x"']]) },
    { name: 'item-builder-details.heroAttributes', ts: ((p: string, ids: string[]) => drain(det.heroAttributesSteps(openVpkIndex(p), ids))) as never, inputs: [[GAME_PAK01, [...heroIds, 'Bad Id', 'nobody', heroIds[0]]]] },
    { name: 'item-builder-details.eventNames', ts: ((pairs: [string, string][]) => Object.fromEntries(det.eventNames(new Map(pairs)))) as never, inputs: [[tokenPairs], [[['dota_eventname_x_y', 'A'], ['dota_eventnameshort_xy', 'B'], ['dota_eventname_xy', 'C'], ['dota_eventname_z', '#tok'], ['dota_eventname_', 'n']]]] },
    { name: 'item-builder-details.eventName', ts: ((id: string, pairs: [string, string][]) => det.eventName(id, det.eventNames(new Map(pairs)))) as never,
      inputs: [...events, 'EVENT_ID_NONE', 'EVENT_ID_', '5', '', 'EVENT_ID_10TH_ANNIVERSARY', 'EVENT_ID_FALL_2025', 'EVENT_ID_THE_INTERNATIONAL_PLUS_TEAM__X'].flatMap((e) => [[e, tokenPairs], [e, []]]) },
    { name: 'item-builder-details.plainText', ts: plain as never, inputs: [...spread(marked, 300), 'a<br>b<BR/>c<br />d', '<<b>font>x</font>', '&amp;&lt;&#65;&#x42;&#X43;&#0;&#99999999;&bogus;&NBSP;', 'a \t\r\nb\r\r\n\n\n\nc  ', '  \u00a0 x \ufeff'].map((s) => [s]) },
  ];
  assert.ok(arcanas.length > 20 && events.length > 10 && marked.length > 50);
  assert.ok(compare(cases) > 800);
});

test('ability effects slots in Rust read and cut visuals as the TypeScript does', { skip }, async (t) => {
  if (!fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no sandbox (npm run sandbox:seed)'); return; }
  const fx = await import('../src/item-builder-ability-fx.ts');
  const { readGameSchema, listItems } = await import('../src/schema-items.ts');
  const { file } = await realItems();
  const { text } = readGameSchema(sandboxGame);
  const items = listItems(text);
  const fits = items.filter((i) => text.slice(i.start, i.end).includes('can_equip_as_ability_effects'));
  const visualsOf = (block: string) => { let v: string | null = null; eachChild(block, blockBounds(block, 0), (c) => { if (!v && c.isBlock && c.key.toLowerCase() === 'visuals') v = block.slice(c.start, c.end); }); return v as string | null; };
  const cases: Case[] = [
    { name: 'item-builder-ability-fx.fxSlotOf', ts: fx.fxSlotOf as never, inputs: ['ability_effects_2', 'item:earthshaker:ability_effects_12', 'ABILITY_EFFECTS_3', 'ability_effects_', 'ability_effects_1_persona_1', 'weapon', '', 'a:b:ability_effects_007'].map((s) => [s]) },
    { name: 'item-builder-ability-fx.fxSlotsOf', ts: fx.fxSlotsOf as never, inputs: [...fits.map((i) => [text.slice(i.start, i.end)]), ['"can_equip_as_ability_effects" { "value" "3" } "can_equip_as_ability_effects" "1" "CAN_EQUIP_AS_ABILITY_EFFECTS""0"']] },
    { name: 'item-builder-ability-fx.fxVisuals', ts: fx.fxVisuals as never, inputs: fits.flatMap((i) => { const v = visualsOf(text.slice(i.start, i.end)); return v ? [1, 2, 3, 4, 5].map((n) => [v, n]) : []; }) },
    { name: 'item-builder-ability-fx.hasModifiers', ts: fx.hasModifiers as never, inputs: [['"visuals"{}'], ['"ASSET_MODIFIER3"'], ...fits.slice(0, 20).map((i) => [text.slice(i.start, i.end)])] },
    { name: 'item-builder-ability-fx.fxTarget', ts: ((tx: string, n: number) => fx.fxTarget(listItems(tx), n)?.id ?? null) as never, inputs: [0, 1, 2, 5, 9, 10].map((n) => [{ $file: file }, n]) },
  ];
  assert.ok(fits.length > 20);
  assert.ok(compare(cases) > 150);
});

test('the item builder offer in Rust is the one the TypeScript lists, slot for slot', { skip }, async (t) => {
  if (!fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no sandbox (npm run sandbox:seed)'); return; }
  const sl = await import('../src/item-builder-slots.ts');
  const { readGameSchema, listItems } = await import('../src/schema-items.ts');
  const { file } = await realItems();
  const { text } = readGameSchema(sandboxGame);
  const items = listItems(text);
  const names = items.map((i) => i.name).filter(Boolean);
  const spread = <T,>(a: T[], n: number) => a.filter((_, k) => k % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const words = [...spread(names, 400), 'Б', 'a', 'A', '-x', '_z', ' y', 'é', 'e', '1', 'Ä', 'ä', "Nature's Prophet", 'Anti-Mage', 'Pudge · Оружие', 'Pudge · Голова', 'Io', 'IO', 'ǅ', ''];
  const slotNames = ['weapon', 'offhand_weapon', 'ability_effects_3', 'item:x:ability_effects_2', 'persona_selector', 'some_new_slot', 'WEAPON', 'ß_slot'];
  const lang = (l: string, f: () => unknown) => { setLang(l); return f(); };
  const heroes = [...new Set(items.flatMap((i) => sl.itemHeroes(text, i)))];
  const cases: Case[] = [
    { name: 'js.localeCompare', ts: ((a: string, b: string) => Math.sign(a.localeCompare(b))) as never, inputs: words.flatMap((a, k) => [[a, words[(k * 7 + 3) % words.length]], [a, words[(k + 1) % words.length]], [a, a.toUpperCase()]]) },
    { name: 'item-builder-slots.canonicalHeroId', ts: sl.canonicalHeroId as never, inputs: [...heroes, 'NPC_DOTA_HERO_IO', 'io', ''].map((h) => [h]) },
    { name: 'item-builder-slots.matchItemSlot', ts: sl.matchItemSlot as never, inputs: slotNames.map((s) => [s]) },
    { name: 'item-builder-slots.slotDisplayLabel', ts: ((l: string, s: string) => lang(l, () => sl.slotDisplayLabel(s))) as never, inputs: ['ru', 'en', 'zh-CN'].flatMap((l) => slotNames.map((s) => [l, s])) },
    { name: 'item-builder-slots.itemSlotIcon', ts: sl.itemSlotIcon as never, inputs: slotNames.map((s) => [s]) },
    { name: 'item-builder-slots.stockModels', ts: ((tx: string, h: string[]) => sl.stockModels(tx, h)) as never, inputs: [[{ $file: file }, heroes.slice(0, 40)], [{ $file: file }, ['npc_dota_hero_nobody']]] },
    { name: 'item-builder-slots.itemSlots', ts: ((l: string, tx: string) => lang(l, () => sl.itemSlots(tx))) as never, inputs: [['ru', { $file: file }], ['en', { $file: file }]] },
  ];
  assert.ok(heroes.length > 100);
  assert.ok(compare(cases) > 1000);
});
