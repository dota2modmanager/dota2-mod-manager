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

test('what an item builder pick takes out of the game files in Rust is what the TypeScript takes', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01) || !fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no game or no sandbox'); return; }
  const { createHash } = await import('node:crypto');
  const { openVpkIndex, entryPath } = await import('../src/vpk.ts');
  const as = await import('../src/item-builder-assets.ts');
  const sl = await import('../src/item-builder-slots.ts');
  const { listItems } = await import('../src/schema-items.ts');
  const { file } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const index = openVpkIndex(GAME_PAK01);
  const game = path.dirname(path.dirname(GAME_PAK01));
  const sha = (b: Buffer | null) => (b ? createHash('sha1').update(b).digest('hex') : null);
  const spread = <T,>(a: T[], n: number) => a.filter((_, k) => k % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const visualsOf = (block: string) => { let v: string | null = null; eachChild(block, blockBounds(block, 0), (c) => { if (!v && c.isBlock && c.key.toLowerCase() === 'visuals') v = block.slice(c.start, c.end); }); return v as string | null; };
  const picks = listItems(text).filter((i) => i.hasVisuals).map((i) => ({ visuals: visualsOf(text.slice(i.start, i.end)), heroes: sl.itemHeroes(text, i) }))
    .filter((p): p is { visuals: string; heroes: string[] } => !!p.visuals && p.heroes.length > 0);
  const entity = picks.filter((p) => /"entity_model"|"persona"|"hero_model_change"/i.test(p.visuals));
  const chosen = [...entity, ...spread(picks.filter((p) => !entity.includes(p)), 200)];
  const summon = as.summonModels(index);
  const assets = (pak: string, tx: string, v: string, h: string[]) => as.itemAssets(tx, v, h, summon);
  const copied = chosen.map((p) => assets(GAME_PAK01, text, p.visuals, p.heroes).assetCopies).filter((c) => c.length);
  const heroes = [...new Set(picks.flatMap((p) => p.heroes))];
  const cases: Case[] = [
    { name: 'item-builder-assets.itemAssets', ts: assets as never, inputs: chosen.map((p) => [GAME_PAK01, { $file: file }, p.visuals, p.heroes]) },
    { name: 'item-builder-assets.heroModelPath', ts: ((pak: string, h: string) => as.heroModelPath(index, h)) as never, inputs: [...heroes, 'npc_dota_hero_nobody'].map((h) => [GAME_PAK01, h]) },
    { name: 'item-builder-assets.gameAssetEntries', ts: ((pak: string, copies: never[]) => as.gameAssetEntries(game, copies).map((e) => [entryPath(e), sha(e.data)])) as never, inputs: [
      ...[...copied.filter((c) => c.some((x) => 'hero' in x || 'unit' in x || 'form' in x)), ...spread(copied, 40)].map((c) => [GAME_PAK01, c]),
      [GAME_PAK01, [{ from: '', hero: 'npc_dota_hero_juggernaut', activities: [] }]],
      [GAME_PAK01, [{ from: 'models/nowhere.vmdl', to: 'models/x.vmdl', optional: true }]],
      [GAME_PAK01, [{ from: 'models/nowhere.vmdl', to: 'models/x.vmdl' }]],
    ] },
  ];
  assert.ok(entity.length > 20);
  assert.ok(compare(cases) > 300);
});

test('a pick the item builder writes in Rust is the block the TypeScript writes', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01) || !fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no game or no sandbox'); return; }
  const { openVpkIndex } = await import('../src/vpk.ts');
  const ib = await import('../src/item-builder.ts');
  const kin = await import('../src/item-builder-kinetic.ts');
  const sl = await import('../src/item-builder-slots.ts');
  const { ITEM_EFFECTS } = await import('../src/item-builder-effects.ts');
  const { listItems } = await import('../src/schema-items.ts');
  const { file } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const summon = ib.summonModels(openVpkIndex(GAME_PAK01));
  const spread = <T,>(a: T[], n: number) => a.filter((_, k) => k % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const items = listItems(text);
  const worn = items.filter((i) => i.hasVisuals && (i.prefab === 'wearable' || i.prefab === 'default_item') && sl.itemHeroes(text, i).length);
  const special = worn.filter((i) => /"entity_model"|"persona"|"hero_model_change"|"styles"|"response_criteria"/i.test(text.slice(i.start, i.end)));
  const picks = [...spread(special, 120), ...spread(worn.filter((i) => !special.includes(i)), 120)];
  const lite = (i: { id: string; start: number }) => ({ id: i.id, start: i.start });
  const gems = [...kin.kineticGems(text).keys()];
  const own = ITEM_EFFECTS.map((e) => e.id);
  const keys: unknown[] = [null, '', 'style-2', [own[0], 'style-1', own[1]], `${own[1]},${own[0]},${own[0]}`, 'unusual-12,unusual-3,FIRE ,zzz,aaa,from-123', ['a,b', ' X '], `kinetic-${gems[0]},${own[2]}`, 'style-0', 'from-1,from-2'];
  const effectsFor = (k: number) => [[], [own[k % own.length]], [`kinetic-${gems[k % gems.length]}`], ['style-1'], [`from-${picks[(k + 7) % picks.length].id}`], ['unusual-9999999'], ['nope']][k % 7];
  const patch = (pak: string, tx: string, id: string, effects: unknown, target?: string, refit?: string) => ib.itemEffectPatch(tx, id, effects as string[], target, summon, refit);
  const heroes = [...new Set(worn.flatMap((i) => sl.itemHeroes(text, i)))];
  const cases: Case[] = [
    { name: 'item-builder.effectKey', ts: ib.effectKey as never, inputs: keys.map((k) => [k]) },
    { name: 'item-builder.itemVisuals', ts: ((tx: string, i: { start: number }) => ib.itemVisuals(tx, i)) as never, inputs: spread(items, 80).map((i) => [{ $file: file }, lite(i)]) },
    { name: 'item-builder.itemVoices', ts: ((tx: string, i: { start: number }) => ib.itemVoices(tx, i)) as never, inputs: picks.slice(0, 120).map((i) => [{ $file: file }, lite(i)]) },
    { name: 'item-builder.defaultItemForWearable', ts: ((tx: string, id: string) => ib.defaultItemForWearable(tx, id)?.id ?? null) as never, inputs: [...picks.map((i) => [{ $file: file }, i.id]), [{ $file: file }, '999999999']] },
    { name: 'item-builder.asItem', ts: ((bl: string, tx: string, i: { id: string; start: number }, m: string | null) => ib.asItem(bl, tx, i, m)) as never, inputs: picks.slice(0, 60).map((i, k) => [text.slice(i.start, i.end), { $file: file }, lite(picks[(k + 3) % picks.length]), k % 2 ? null : 'models/x/y.vmdl']) },
    { name: 'item-builder.setVisualsBlock', ts: ib.setVisualsBlock as never, inputs: [...picks.slice(0, 40).map((i) => [text.slice(i.start, i.end), '  "visuals"\r\n{\r\n}\r\n ']), ['"1"\r\n{\r\n\t"name"\t"x"\r\n}', '"visuals" {}'], ['no block', 'x']] },
    { name: 'item-builder.withoutFileSwaps', ts: ((v: string, u: string[], st: string[]) => ib.withoutFileSwaps(v, new Set(u), new Set(st))) as never, inputs: special.slice(0, 80).flatMap((i) => {
      const v = ib.itemVisuals(text, i)!;
      let a: { assetCopies: object[] } = { assetCopies: [] };
      try { a = ib.itemEffectPatch(text, i.id, [], undefined, summon); } catch { /* no stock item */ }
      return [[v, [], []], [v, a.assetCopies.flatMap((c) => ('hero' in c ? [(c as { hero: string }).hero] : 'unit' in c ? [(c as { unit: string }).unit] : [])), a.assetCopies.flatMap((c) => ('to' in c ? [String((c as { to: string }).to).toLowerCase()] : []))], [v, heroes, []]];
    }) },
    { name: 'item-builder.itemEffectPatch', ts: patch as never, inputs: [
      ...picks.map((i, k) => [GAME_PAK01, { $file: file }, i.id, effectsFor(k), null, null]),
      ...picks.slice(0, 20).map((i, k) => [GAME_PAK01, { $file: file }, i.id, [], picks[(k + 1) % picks.length].id, k % 2 ? 'models/heroes/x/refit.vmdl' : null]),
      [GAME_PAK01, { $file: file }, '999999999', [], null, null],
    ] },
    { name: 'item-builder-kinetic.kineticGems', ts: ((tx: string) => [...kin.kineticGems(tx)]) as never, inputs: [[{ $file: file }], ['no table']] },
    { name: 'item-builder-kinetic.offeredKinetic', ts: kin.offeredKinetic as never, inputs: [[{ $file: file }, heroes], ...heroes.slice(0, 60).map((h) => [{ $file: file }, [h]])] },
    { name: 'item-builder-kinetic.picksGems', ts: kin.picksGems as never, inputs: [[{ $file: file }, gems.map((g) => `kinetic-${g}`).join(',')], [{ $file: file }, 'kinetic-nope'], [{ $file: file }, 'fire,style-2']] },
    { name: 'item-builder-kinetic.withKinetics', ts: ((v: string, tx: string, k: string) => kin.withKinetics(v, kin.picksGems(tx, k))) as never, inputs: picks.slice(0, 20).map((i, k) => [ib.itemVisuals(text, i)!, { $file: file }, `kinetic-${gems[k % gems.length]},kinetic-${gems[(k + 5) % gems.length]}`]) },
  ];
  assert.ok(special.length > 50 && gems.length > 20);
  assert.ok(compare(cases) > 900);
});

test('ability effects picks and refits in Rust are the ones the TypeScript makes', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01) || !fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no game or no sandbox'); return; }
  const { openVpkIndex, entryAt, entryPath } = await import('../src/vpk.ts');
  const ib = await import('../src/item-builder.ts');
  const fxp = await import('../src/item-builder-fx-patch.ts');
  const rf = await import('../src/item-builder-refits.ts');
  const { listItems } = await import('../src/schema-items.ts');
  const { file } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const summon = ib.summonModels(openVpkIndex(GAME_PAK01));
  const spread = <T,>(a: T[], n: number) => a.filter((_, k) => k % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const items = listItems(text);
  const fits = items.filter((i) => text.slice(i.start, i.end).includes('can_equip_as_ability_effects'));
  const swapping = items.filter((i) => /"type"\s+"model"/i.test(text.slice(i.start, i.end)));
  const wearable = spread(items.filter((i) => i.hasVisuals), 150);
  const models = [...swapping, ...wearable].map((i, k) => [i.id, rf.pickModels(text, i.id, k % 3 ? [] : ['style-1'])] as const).filter(([, p]) => p);
  const asList = models.map(([id, p]) => [id, p!.model, [...p!.swaps]]);
  const cases: Case[] = [
    { name: 'item-builder-fx-patch.abilityFxPatch', ts: ((pak: string, tx: string, id: string, fx: string[], n: number) => fxp.abilityFxPatch(tx, id, fx, n, summon)) as never, inputs: [
      ...spread(fits, 120).flatMap((i, k) => [1, 2, 3].map((n) => [GAME_PAK01, { $file: file }, i.id, k % 2 ? [] : ['style-1'], n])),
      [GAME_PAK01, { $file: file }, '999999999', [], 1], [GAME_PAK01, { $file: file }, wearable[0].id, [], 1], [GAME_PAK01, { $file: file }, fits[0]?.id, [], 0],
    ] },
    { name: 'item-builder-refits.pickModels', ts: ((tx: string, id: string, fx: string[]) => { const p = rf.pickModels(tx, id, fx); return p && [p.model, [...p.swaps]]; }) as never, inputs: [...swapping, ...wearable].flatMap((i) => [[{ $file: file }, i.id, []], [{ $file: file }, i.id, ['style-1']], [{ $file: file }, i.id, ['style-2']]]).concat([[{ $file: file }, '999999999', []]]) },
    { name: 'item-builder-refits.refitsOf', ts: ((list: [string, string, [string, string][]][]) => [...rf.refitsOf(new Map(list.map(([k, m, s]) => [k, { model: m, swaps: new Map(s) }])))]) as never, inputs: [[asList], [asList.slice(0, 30)], [[['a', 'x', [['y', 'r1']]], ['b', 'y', [['x', 'r2']]], ['c', '', [['', 'r3']]], ['d', 'x', []]]]] },
    { name: 'item-builder-refits.ownModelsWin', ts: ((list: [string[] | null, string | null][]) => {
      const picks = list.map(([a, own]) => ({ patch: { assets: a?.map((p) => entryAt(p, Buffer.alloc(0))) }, own }));
      rf.ownModelsWin(picks);
      return picks.map((p) => p.patch.assets?.map((e) => entryPath(e)) ?? null);
    }) as never, inputs: [
      [[[['models/a.vmdl_c', 'models/b.vmdl_c'], 'models/a.vmdl_c'], [['models/A.vmdl_c', 'models/c.vmdl_c'], null], [null, 'models/b.vmdl_c']]],
      [[[['x'], null], [['y'], '']]],
    ] },
  ];
  assert.ok(fits.length > 20 && swapping.length > 10);
  assert.ok(compare(cases) > 400);
});

test('the item builder sets in Rust are the ones the TypeScript lists', { skip }, async (t) => {
  if (!fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no sandbox (npm run sandbox:seed)'); return; }
  const { itemSets } = await import('../src/item-builder-sets.ts');
  const { file } = await realItems();
  const lang = (l: string, f: () => unknown) => { setLang(l); return f(); };
  const cases: Case[] = [
    { name: 'item-builder-sets.itemSets', ts: ((l: string, tx: string) => lang(l, () => itemSets(tx))) as never, inputs: [['ru', { $file: file }], ['en', { $file: file }]] },
  ];
  assert.equal(compare(cases), 2);
});

test('everybody wears the user\'s look in Rust as the TypeScript dresses them', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01) || !fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no game or no sandbox'); return; }
  const { createHash } = await import('node:crypto');
  const { openVpkIndex, entryAt, entryPath } = await import('../src/vpk.ts');
  const ib = await import('../src/item-builder.ts');
  const ew = await import('../src/item-builder-everyone.ts');
  const as = await import('../src/item-builder-assets.ts');
  const { file } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const index = openVpkIndex(GAME_PAK01);
  const summon = ib.summonModels(index);
  const sha = (b: Buffer | null) => (b ? createHash('sha1').update(b).digest('hex') : null);
  type In = { id: string; block: string; assets: [string, string][] };
  const slots = ib.itemSlots(text).filter((s) => !s.persona && !s.abilityFx && s.heroIds.length === 1);
  const heroes = ['juggernaut', 'earthshaker', 'faceless_void', 'drow_ranger', 'pudge', 'terrorblade'];
  const picksOf = (hero: string, k: number): In[] => slots.filter((s) => s.heroIds[0] === hero).flatMap((s, j) => {
    const o = s.options[(k + j) % Math.max(1, s.options.length)];
    if (!o) return [];
    try {
      const p = ib.itemEffectPatch(text, o.id, [], undefined, summon);
      return [{ id: p.id, block: p.block, assets: p.own ? [[p.own, `pick ${o.id}`] as [string, string]] : [] }];
    } catch { return []; }
  }).map((p, j) => (j === 0 ? { ...p, assets: [...p.assets, ...stockFiles(hero, k)] } : p));
  const { listItems } = await import('../src/schema-items.ts');
  const { itemHeroes } = await import('../src/item-builder-slots.ts');
  const stocks = listItems(text).filter((i) => i.prefab === 'default_item' && i.model);
  // the build's files sit at the stock items' paths: that is how everyoneWears finds the heroes it dresses
  const stockFiles = (hero: string, k: number): [string, string][] => stocks
    .filter((i) => itemHeroes(text, i).includes(`npc_dota_hero_${hero}`)).filter((_, j) => (j + k) % 2 === 0)
    .map((i) => [`${as.normalizeAssetPath(i.model)}_c`, `stock ${i.id}`]);
  const body = (hero: string): [string, string][] => [[`${as.normalizeAssetPath(as.heroModelPath(index, `npc_dota_hero_${hero}`))}_c`, `base of ${hero}`], ...stockFiles(hero, 1)];
  const wears = (pak: string, tx: string, list: In[], beneath: [string, string][], only: string[] | null) =>
    ew.everyoneWears(tx, list.map((p) => ({ id: p.id, block: p.block, assets: p.assets.map(([a, d]) => entryAt(a, Buffer.from(d, 'latin1'))) })),
      beneath.map(([a, d]) => entryAt(a, Buffer.from(d, 'latin1'))), (p) => index.read(p), only ?? undefined)
      .map((p) => [String(p.id), p.block, (p.assets ?? []).map((e) => [entryPath(e), sha(e.data)]), p.source]);
  const inputs = heroes.flatMap((h, k) => [
    [GAME_PAK01, { $file: file }, picksOf(h, k), [], [h]],
    [GAME_PAK01, { $file: file }, picksOf(h, k + 1).slice(0, 1), [], null],
    [GAME_PAK01, { $file: file }, picksOf(h, k + 2), body(h), [h, 'axe']],
  ]);
  const cases: Case[] = [
    { name: 'item-builder-everyone.everyoneWears', ts: wears as never, inputs: [...inputs, [GAME_PAK01, { $file: file }, [], [], null], [GAME_PAK01, { $file: file }, heroes.flatMap((h) => picksOf(h, 3)), [], null]] },
  ];
  const dressed = wears(GAME_PAK01, text, picksOf('juggernaut', 0), [], ['juggernaut']);
  assert.ok(dressed.length > 50);
  assert.equal(compare(cases), inputs.length + 2);
});

test('a persona on sorts the build records in Rust as the TypeScript sorts them', { skip }, async (t) => {
  if (!fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no sandbox (npm run sandbox:seed)'); return; }
  const ps = await import('../src/item-builder-personas.ts');
  const ib = await import('../src/item-builder.ts');
  const { entryAt, entryPath } = await import('../src/vpk.ts');
  const { readyBase } = await import('../src/arcana-bases.ts');
  const { file } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const own = ps.personaSlots(text);
  const plain = ib.itemSlots(text).filter((s) => !s.persona);
  const rec = (slot: string, itemId: string, k: number, extra: object = {}) => ({ id: `r${k}`, name: `n${k}`, categoryId: 'cosmetic', files: [], slot, itemId, ...extra });
  const records = ps.PERSONA_BASES.flatMap((b, k) => {
    const mine = own.filter((s) => s.slot.includes(`:${b.hero}:`) || s.slot.includes(`npc_dota_hero_${b.hero}:`) || s.heroIds.includes(`npc_dota_hero_${b.hero}`));
    const selector = mine.find((s) => ps.isSelectorSlot(s.slot));
    const parts = mine.filter((s) => !ps.isSelectorSlot(s.slot));
    const theirs = plain.filter((s) => s.heroIds.includes(`npc_dota_hero_${b.hero}`)).slice(0, 3);
    return [
      ...(selector && k % 3 !== 2 ? [rec(selector.slot, b.item, k * 100, k % 4 === 1 ? { enabled: false } : {})] : []),
      ...parts.slice(0, k % 2 ? 2 : 0).map((s, j) => rec(s.slot, s.options[0]?.id ?? '1', k * 100 + 1 + j)),
      ...theirs.map((s, j) => rec(s.slot, s.options[0]?.id ?? '1', k * 100 + 10 + j, j === 1 ? { enabled: false } : {})),
    ];
  });
  records.push({ id: 'x', name: 'x', categoryId: 'model', files: [], slot: 'item:a:persona_selector', itemId: '1' } as never);
  records.push(rec('item:axe:head_persona_9', '1', 9999), rec('nonsense', '1', 9998), rec('item::', '1', 9997));
  const on = [...ps.personasOn(records as never)];
  const built = ps.personaRecords(records as never, text);
  const bases = ps.PERSONA_BASES.map((b) => ({ base: b, entries: [[`models/heroes/${b.hero}/${b.hero}.vmdl_c`, 'x'], [`models/items/${b.hero}/big.vmdl_c`, 'y'.repeat(9000)], [`particles/${b.hero}/p.vpcf_c`, 'z']] as [string, string][] }));
  const assetsOf = (r: { persona?: { host: string | null } }) => [[r.persona?.host ?? 'models/none.vmdl_c', 'a'], ['models/items/axe/big.vmdl_c', 'b'], ['particles/axe/p.vpcf_c', 'c'], ['models/free.vmdl_c', 'd']] as [string, string][];
  const assets = (r: object, a: [string, string][], ready: { base: never; entries: [string, string][] }[]) =>
    ps.personaAssets(r as never, a.map(([p, d]) => entryAt(p, Buffer.from(d, 'latin1'))), ready.map((x) => readyBase(x.base, x.entries.map(([p, d]) => entryAt(p, Buffer.from(d, 'latin1')))))).map((e) => entryPath(e));
  const cases: Case[] = [
    { name: 'item-builder-personas.personasOn', ts: ((r: never) => [...ps.personasOn(r)]) as never, inputs: [[records], [records.filter((_, k) => k % 2)], [[]]] },
    { name: 'item-builder-personas.leftOut', ts: ((r: never, o: [string, string][]) => ps.leftOut(r, new Map(o))) as never, inputs: records.flatMap((r) => [[r, on], [r, []]]) },
    { name: 'item-builder-personas.displaced', ts: ps.displaced as never, inputs: [[records], [[]]] },
    { name: 'item-builder-personas.isSelectorSlot', ts: ps.isSelectorSlot as never, inputs: [...records.map((r) => [r.slot]), [''], [':persona_selector'], ['persona_selector']] },
    { name: 'item-builder-personas.personaRecords', ts: ps.personaRecords as never, inputs: [[records, { $file: file }], [records.slice(0, 5), { $file: file }]] },
    { name: 'item-builder-personas.personaAssets', ts: assets as never, inputs: [...built.records, ...records].flatMap((r) => [[r, assetsOf(r as never), bases], [r, assetsOf(r as never), []]]) },
  ];
  assert.ok(on.length > 3 && built.records.some((r) => r.persona?.given));
  assert.ok(compare(cases) > 100);
});

test('ability effects slots are named and their picks joined in Rust as the TypeScript does', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01) || !fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no game or no sandbox'); return; }
  const { openVpkIndex, entryAt, entryPath } = await import('../src/vpk.ts');
  const fx = await import('../src/item-builder-ability-fx.ts');
  const fxp = await import('../src/item-builder-fx-patch.ts');
  const ib = await import('../src/item-builder.ts');
  const { listItems } = await import('../src/schema-items.ts');
  const { file } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const index = openVpkIndex(GAME_PAK01);
  const lang = (l: string, f: () => unknown) => { setLang(l); return f(); };
  const fits = listItems(text).filter((i) => text.slice(i.start, i.end).includes('can_equip_as_ability_effects'));
  const patches = fits.flatMap((i) => fx.fxSlotsOf(text.slice(i.start, i.end)).map((n) => { try { return fxp.abilityFxPatch(text, i.id, [], n); } catch { return null; } }))
    .filter((p) => p).map((p, k) => ({ id: p!.id, block: p!.block, assets: p!.assetCopies.map((c, j) => [`${'to' in c ? c.to : 'x'}_${j}`, `${k}`]), source: k % 3 ? `fx ${k}` : `plain ${k}` }));
  const merge = (list: typeof patches) => fx.mergeFxPatches(list.map((p) => ({ ...p, assets: p.assets.map(([a, d]) => entryAt(a, Buffer.from(d, 'latin1'))) })), (p) => String(p.source).startsWith('fx '))
    .map((p) => [String(p.id), p.block, (p.assets ?? []).map((e) => entryPath(e)), p.source]);
  const cases: Case[] = [
    { name: 'item-builder-ability-fx.namedFxSlots', ts: ((l: string, pak: string, tx: string) => lang(l, () => fx.namedFxSlots(ib.itemSlots(tx), (p) => index.read(p), l))) as never, inputs: ['ru', 'en', 'zh-CN'].map((l) => [l, GAME_PAK01, { $file: file }]) },
    { name: 'item-builder-ability-fx.mergeFxPatches', ts: merge as never, inputs: [[patches], [patches.slice(0, 40)], [[]]] },
  ];
  assert.ok(patches.length > 50);
  assert.equal(compare(cases), 6);
});

test('an arcana built in Rust is the one the TypeScript builds, file for file', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01)) { t.skip('no game'); return; }
  const a = await import('../src/arcana.ts');
  const { openVpkIndex } = await import('../src/vpk.ts');
  const { createHash } = await import('node:crypto');
  const sha = (f: Buffer | null | undefined) => (f ? createHash('sha1').update(f).digest('hex') : null);
  const shas = (m: Map<string, Buffer>) => [...m].map(([p, f]) => [p, sha(f)]);
  const buf = (s: string) => Buffer.from(s, 'latin1');
  const index = openVpkIndex(GAME_PAK01);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-arcana-'));
  let n = 0;
  const put = (p: string) => {
    const data = index.read(p);
    if (!data) return null;
    const f = path.join(tmp, `${n++}.bin`);
    fs.writeFileSync(f, data);
    return { $file: f };
  };
  const sets = Object.keys(a.ARCANA_SETS);
  const hosts: unknown[][] = [];
  const at: unknown[][] = [];
  for (const name of sets) {
    const def = a.ARCANA_SETS[name];
    const from = put(def.host.from);
    const plain = put(def.host.at);
    for (const f of [from, plain]) {
      if (!f) continue;
      hosts.push([f, def.host.children], [f, def.host.children.slice(0, 1)], [f, def.host.children.map((c) => ({ path: c.path }))], [f, []]);
      for (const c of def.host.children) at.push([f, c.path, c.attachment || ''], [f, c.path, 'attach_hitloc']);
    }
    for (const fm of def.forms || []) {
      const f = put(fm.at);
      if (f) at.push([f, fm.child, fm.attachment]);
    }
  }
  // particles that are no hosts: the errors must match too
  const others = [...index.paths()].filter((p) => p.endsWith('.vpcf_c')).filter((_, k) => k % 997 === 0).slice(0, 60);
  for (const p of others) {
    const f = put(p);
    if (!f) continue;
    hosts.push([f, [{ path: 'particles/x.vpcf' }]], [f, [{ path: 'particles/x.vpcf', attachment: 'attach_hitloc' }]]);
    at.push([f, 'particles/x.vpcf', 'attach_hitloc']);
  }
  const colours: [number, number, number][] = [[255, 40, 40], [20, 200, 255], [255, 255, 255]];
  const formItems = sets.map((s) => (a.ARCANA_SETS[s].forms || []).map((f) => f.item));
  const cases: Case[] = [
    { name: 'arcana.withChildren', ts: ((f: string, c: never) => sha(a.withChildren(buf(f), c))) as never, inputs: hosts },
    { name: 'arcana.withChildAt', ts: ((f: string, c: string, x: string) => sha(a.withChildAt(buf(f), c, x))) as never, inputs: at },
    { name: 'arcana.arcanaPictures', ts: ((p: string, s: string) => shas(a.arcanaPictures(p, s))) as never,
      inputs: [...sets.map((s) => [GAME_PAK01, s]), [GAME_PAK01, 'no-such-set']] },
    { name: 'arcana.arcanaSwaps', ts: ((p: string, s: string, c: never) => shas(a.arcanaSwaps(p, s, c))) as never,
      inputs: [...sets.flatMap((s) => colours.map((c) => [GAME_PAK01, s, c])), [GAME_PAK01, 'no-such-set', [1, 2, 3]]] },
    { name: 'arcana.arcanaForms', ts: ((p: string, s: string, c: never, items: string[]) => {
      const files = new Map<string, Buffer>();
      const log: string[] = [];
      a.arcanaForms(p, s, c, items, files, (m) => log.push(m));
      return [shas(files), log];
    }) as never, inputs: sets.flatMap((s, k) => [[GAME_PAK01, s, colours[0], formItems[k]], [GAME_PAK01, s, colours[1], []], [GAME_PAK01, s, colours[2], formItems[k].slice(0, 1)]]) },
    { name: 'arcana.buildArcana', ts: ((pak01: string, set: string, target: never, forms: string[]) => {
      const x = a.buildArcana({ pak01, set, target, forms });
      return [sha(x.vpk), x.files, x.changed, x.failed.map((f) => f.path)];
    }) as never, inputs: [...sets.flatMap((s, k) => [[GAME_PAK01, s, colours[0], formItems[k]], [GAME_PAK01, s, colours[2], []]]), [GAME_PAK01, 'no-such-set', [1, 2, 3], []]] },
  ];
  try {
    assert.ok(compare(cases) > 100);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('what a mod changes, read in Rust from its paths, is what the TypeScript reads', { skip }, async () => {
  const va = await import('../src/vpk-analyze.ts');
  const { listVpkPathsFile } = await import('../src/vpk-read.ts');
  const { gameSchemaStamp } = await import('../src/pak-stamp.ts');
  const lists: string[][] = [];
  const mods = path.join(root, 'sandbox', 'mods');
  if (fs.existsSync(mods)) {
    for (const f of fs.readdirSync(mods, { recursive: true }) as string[]) {
      if (!f.toLowerCase().endsWith('.vpk')) continue;
      try { lists.push(listVpkPathsFile(path.join(mods, f)).map((p) => p.toLowerCase())); } catch { /* not a vpk */ }
    }
  }
  if (fs.existsSync(GAME_PAK01)) {
    const all = listVpkPathsFile(GAME_PAK01).map((p) => p.toLowerCase());
    const heroes = [...new Set(all.map((p) => /^models\/(?:heroes|items)\/([a-z0-9_]+)\//.exec(p)?.[1]).filter(Boolean))] as string[];
    for (const [k, h] of heroes.entries()) {
      if (k % 3) continue;
      lists.push(all.filter((p) => p.includes(`/${h}/`)).slice(0, 400));
      lists.push(all.filter((p) => p.includes(`/${h}/`) || p.includes(`/${heroes[(k + 7) % heroes.length]}/`)).filter((_, i) => i % 5 === 0));
    }
    for (const prefix of ['particles/econ/courier', 'panorama/', 'sounds/', 'maps/', 'models/props_gameplay/', 'materials/models/items/', '8213/']) {
      lists.push(all.filter((p) => p.startsWith(prefix)).slice(0, 200));
    }
  }
  lists.push([], ['models/heroes/crystalmaiden/crystalmaiden.vmdl_c', 'models/heroes/crystal_maiden/crystal_maiden_weapon.vmdl_c'],
    ['8213/heroes/pudge/pudge_hook.vmdl_c', '8213/particles/pudge/x.vpcf_c', 'models/heroes/nyx/1.vmdl_c'],
    ['models/items/misc/x.vmdl_c', 'models/items/axe/set/axe_transmuted_armaments_back.vmdl_c', 'models/heroes/axe/axe_lod1.vmdl_c'],
    ['models/props_gameplay/my_ward.vmdl_c'], ['ward/x.txt'], ['ui/courier/a.png']);
  const hits = lists.flatMap((l) => va.analyzeVpkPaths(l).heroes);
  const slots = ['head', 'weapon', 'misc', 'base', 'nothing', 'legs'];
  const cases: Case[] = [{ name: 'vpk-analyze.analyzeVpkPaths', ts: va.analyzeVpkPaths as never, inputs: lists.map((l) => [l]) }];
  for (const lang of ['ru', 'en', 'zh-CN']) {
    cases.push(
      { name: 'vpk-analyze.slotDisplayName', ts: ((l: string, s: string) => { lt(l, ''); return va.slotDisplayName(s); }) as never, inputs: slots.map((s) => [lang, s]) },
      { name: 'vpk-analyze.describeHero', ts: ((l: string, h: never) => { lt(l, ''); return va.describeHero(h); }) as never, inputs: hits.map((h) => [lang, h]) },
      { name: 'vpk-analyze.subjectHeroes', ts: ((l: string, p: string[]) => { lt(l, ''); return va.subjectHeroes(va.analyzeVpkPaths(p)); }) as never, inputs: lists.map((p) => [lang, p]) },
      { name: 'vpk-analyze.describeAnalysis', ts: ((l: string, p: string[]) => { lt(l, ''); return va.describeAnalysis(va.analyzeVpkPaths(p)); }) as never, inputs: lists.map((p) => [lang, p]) },
      { name: 'vpk-analyze.nameFromAnalysis', ts: ((l: string, p: string[]) => { lt(l, ''); return va.nameFromAnalysis(va.analyzeVpkPaths(p)); }) as never, inputs: lists.map((p) => [lang, p]) },
    );
  }
  const games = [sandboxGame, path.dirname(path.dirname(GAME_PAK01)), path.join(root, 'no-such-game')].filter((g, k) => k === 2 || fs.existsSync(g));
  cases.push({ name: 'pak-stamp.gameSchemaStamp', ts: gameSchemaStamp as never, inputs: games.map((g) => [g]) });
  assert.ok(compare(cases) > (lists.length > 30 ? 200 : 20));
});

test('the game\'s own text in Rust is the one the TypeScript reads: tokens, style names, Chinese names', { skip }, async (t) => {
  if (!fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no sandbox'); return; }
  const cn = await import('../src/cosmetic-names.ts');
  const { file } = await realItems();
  const games = [sandboxGame, path.dirname(path.dirname(GAME_PAK01)), path.join(root, 'no-such-game')].filter((g, k) => k === 2 || fs.existsSync(g));
  const langs = ['ru', 'en', 'zh-CN', 'xx'];
  const styles: [string, number][] = [];
  for (const g of games) {
    const keys = [...cn.gameTokens(g, 'en').keys()].filter((k) => k.startsWith('dota_style_'));
    keys.filter((_, k) => k % 50 === 0).forEach((k, i) => styles.push([`#${k.toUpperCase()}`, i], [k, i]));
  }
  styles.push(['#nothing_like_it', 3], ['', 0]);
  const cases: Case[] = [
    { name: 'cosmetic-names.gameTokens', ts: ((g: string, l: string) => [...cn.gameTokens(g, l)]) as never, inputs: games.flatMap((g) => langs.map((l) => [g, l])) },
    { name: 'cosmetic-names.styleNamer', ts: ((g: string, l: string, asked: [string, number][]) => {
      const name = cn.styleNamer(g, l, (i) => `style ${i}`);
      return asked.map(([tk, i]) => name(tk, i));
    }) as never, inputs: games.flatMap((g) => langs.map((l) => [g, l, styles])) },
    { name: 'cosmetic-names.chineseCosmeticNames', ts: ((g: string, tx: string) => cn.chineseCosmeticNames(g, tx)) as never, inputs: games.map((g) => [g, { $file: file }]) },
  ];
  assert.ok(compare(cases) > 10);
});

test('models made bigger in Rust are byte for byte the ones the TypeScript makes, meshopt included', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01) || !fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no game or no sandbox'); return; }
  const ms = await import('../src/model-scale.ts');
  await ms.modelScaleReady();
  const ps = await import('../src/item-builder-personas.ts');
  const as = await import('../src/item-builder-assets.ts');
  const { openVpkIndex, entryAt, entryPath } = await import('../src/vpk.ts');
  const { createHash } = await import('node:crypto');
  const sha = (f: Buffer | null | undefined) => (f ? createHash('sha1').update(f).digest('hex') : null);
  const index = openVpkIndex(GAME_PAK01);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-scale-'));
  let n = 0;
  const put = (data: Buffer) => { const f = path.join(tmp, `${n++}.bin`); fs.writeFileSync(f, data); return { $file: f }; };
  const buf = (s: string) => Buffer.from(s, 'latin1');
  const heroes = ps.PERSONA_BASES.map((b) => b.hero);
  const all = [...index.paths()].filter((p) => p.endsWith('.vmdl_c'));
  const items = heroes.flatMap((h) => all.filter((p) => p.startsWith(`models/items/${h}/`)).slice(0, 14));
  const others = all.filter((p) => p.startsWith('models/items/')).filter((_, k) => k % 701 === 0).slice(0, 30);
  const bodies = heroes.map((h) => `${as.normalizeAssetPath(as.heroModelPath(index, `npc_dota_hero_${h}`))}_c`);
  const models = [...items, ...others, ...bodies].map((p) => ({ p, f: put(index.read(p) as Buffer) }));
  const scales = [1.35, 0.74, 1, 2.5];
  // the encoder alone: zeros, noise, lanes that tie between widths, whole-byte runs, blocks cut short
  const { MeshoptEncoder } = await import('meshoptimizer');
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed >>> 24; };
  const raws = ([[1, 4, 0], [16, 8, 1], [17, 12, 2], [300, 32, 1], [1000, 48, 2], [5, 64, 0], [700, 16, 3], [256, 20, 1], [2000, 36, 2], [33, 256, 1]] as const).map(([count, size, mode]) => {
    const raw = Buffer.alloc(count * size);
    for (let i = 0; i < raw.length; i++) raw[i] = mode === 0 ? 0 : mode === 1 ? rnd() : mode === 2 ? (i % size) * 3 + (rnd() & 3) : (rnd() & 1 ? 255 : 0);
    return [raw.toString('hex'), count, size];
  });
  const cases: Case[] = [
    { name: 'meshopt.encodeVertexBuffer', ts: ((h: string, count: number, size: number) => Buffer.from(MeshoptEncoder.encodeVertexBufferLevel(Buffer.from(h, 'hex'), count, size, 2, 0)).toString('hex')) as never, inputs: raws },
    { name: 'model-scale.scaleModel', ts: ((f: string, s: number) => sha(ms.scaleModel(buf(f), s))) as never, inputs: models.flatMap((m, k) => [[m.f, scales[k % 4]], ...(k % 5 ? [] : [[m.f, 1.35]])]) },
    { name: 'model-scale.modelScaleAgainst', ts: ((a: string, b: string) => ms.modelScaleAgainst(buf(a), buf(b))) as never,
      inputs: models.slice(0, 40).map((m, k) => [m.f, models[(k * 7) % models.length].f]) },
    { name: 'model-scale.scaledModels', ts: ((e: [string, string | { $file: string }][], s: number | null) => {
      const skipped: string[] = [];
      const out = ms.scaledModels(e.map(([p, d]) => entryAt(p, typeof d === 'string' ? buf(d) : fs.readFileSync(d.$file))), s ?? undefined, (p) => skipped.push(p)); // the paths: why is Node's error text or ours
      return [out.map((x) => [entryPath(x), sha(x.data)]), skipped];
    }) as never, inputs: [[models.slice(0, 6).map((m) => [m.p, m.f]).concat([['particles/x.vpcf_c', 'abc'], ['models/broken.vmdl_c', 'not a model']]), 1.35],
      [models.slice(6, 9).map((m) => [m.p, m.f]), null], [[['models/broken.vmdl_c', 'x']], 0]] },
  ];
  // a persona's body compiled bigger, as the bases' repository does: its items follow
  const own = ps.personaSlots(fs.readFileSync((await realItems()).file).toString('latin1'));
  const records = ps.PERSONA_BASES.flatMap((b, k) => {
    const selector = own.find((s) => ps.isSelectorSlot(s.slot) && s.heroIds.some((h) => h.includes(b.hero)));
    const part = own.find((s) => !ps.isSelectorSlot(s.slot) && s.heroIds.some((h) => h.includes(b.hero)));
    return [
      ...(selector ? [{ id: `s${k}`, name: 's', categoryId: 'cosmetic', files: [], slot: selector.slot, itemId: b.item }] : []),
      ...(part ? [{ id: `p${k}`, name: 'p', categoryId: 'cosmetic', files: [], slot: part.slot, itemId: part.options[0]?.id ?? '1', persona: { target: '1', host: null, given: false } }] : []),
    ];
  });
  const ready = ps.PERSONA_BASES.map((b, k) => ({ base: b, entries: [[bodies[k], put(ms.scaleModel(index.read(bodies[k]) as Buffer, [1.35, 1, 1.004, 0.8][k % 4]))]] }));
  const { readyBase } = await import('../src/arcana-bases.ts');
  const scalesOf = (pak: string, r: never, rd: { base: never; entries: [string, { $file: string }][] }[]) => {
    const ix = openVpkIndex(pak);
    return [...ps.personaScales(ps.personasOn(r), rd.map((x) => readyBase(x.base, x.entries.map(([p, f]) => entryAt(p, fs.readFileSync(f.$file))))), (p) => ix.read(p))];
  };
  const measured = scalesOf(GAME_PAK01, records as never, ready as never);
  cases.push(
    { name: 'item-builder-personas.personaScales', ts: scalesOf as never, inputs: [[GAME_PAK01, records, ready], [GAME_PAK01, records, []], [GAME_PAK01, [], ready]] },
    { name: 'item-builder-personas.personaScaleOf', ts: ((r: never, s: [string, number][]) => ps.personaScaleOf(r, new Map(s)) ?? null) as never,
      inputs: records.flatMap((r) => [[r, measured], [r, []]]) },
  );
  try {
    assert.ok(measured.length > 0, 'no persona body measured bigger');
    assert.ok(compare(cases) > 150);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the gameinfo patch and the signature list in Rust are the TypeScript ones, byte for byte', { skip }, async (t) => {
  const gi = await import('../src/patcher-gameinfo.ts');
  const sg = await import('../src/patcher-signatures.ts');
  const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'latin1') : null);
  const games = [sandboxGame, path.dirname(path.dirname(GAME_PAK01))];
  const infos = games.map((g) => read(path.join(g, 'dota', 'gameinfo.gi'))).filter(Boolean) as string[];
  const branches = games.map((g) => read(path.join(g, 'dota', 'gameinfo_branchspecific.gi'))).filter(Boolean) as string[];
  const sigs = games.map((g) => read(path.join(g, 'bin', 'win64', 'dota.signatures')) ?? read(path.join(g, 'dota', 'bin', 'win64', 'dota.signatures'))).filter(Boolean) as string[];
  if (!infos.length || !branches.length) { t.skip('no gameinfo files (npm run sandbox:seed)'); return; }
  const folders = ['dota_mods', 'dota_russian', 'my folder'];
  const tryOr = <T,>(f: () => T, or: T) => { try { return f(); } catch { return or; } };
  const blocks = infos.flatMap((i) => folders.map((f) => tryOr(() => gi.withModFolder(gi.searchPathsBlock(i), f), '')));
  const patched = branches.flatMap((b) => blocks.map((bl) => tryOr(() => gi.patchedBranch(b, bl), b)));
  const twice = patched.map((p, k) => tryOr(() => gi.patchedBranch(p, blocks[k % blocks.length]), p));
  const variants = (s: string) => [s, s.replace(/\r\n/g, '\n'), s.replace(/\t}/g, '}'), s.replace(/}\s*$/, ''), s.slice(0, s.length >> 1), s.replace(/SearchPaths/g, 'Search'),
    s.replace(/FileSystem/, 'Files'), s.replace(/Game\s+dota/, 'Game dota2'), (s.includes('{') ? s.slice(0, s.indexOf('{')) + s.slice(s.indexOf('{') + 1) : s), `}\n${s}`, s + '\r\n\t\t', `x // ${gi.MARKER}`];
  const texts = [...infos, ...branches, ...patched, ...twice].flatMap(variants).concat(['', '{', '}', 'SearchPaths', 'SearchPaths }{', `SearchPaths { a // ${gi.MARKER} }`]);
  const hashes = sigs.map((s) => sg.vanillaBranchHashes(s));
  const wants = [...hashes, ...branches.map((b) => sg.fileHashes(Buffer.from(b, 'latin1'))), null, { sha1: '0'.repeat(40), crc: '00000000' }];
  const sigTexts = sigs.flatMap((s) => {
    const line = sg.signatureLine(Buffer.from(patched[0] ?? '', 'latin1'));
    const ours = s.replace(/\s+$/, '') + '\r\n' + line + '\r\n';
    return [s, ours, ours + ours.split('\r\n').slice(-2).join('\r\n'), s.replace(/DIGEST:/, 'DIG:'), s.replace(/\r\n/g, '\n'), ours + '\r\n\r\n  \r\n'];
  }).concat(['', 'DIGEST:x', `DIGEST:\r\n...\..\..\dota\gameinfo_branchspecific.gi~SHA1:${'A'.repeat(40)};CRC:12345678`, `x gameinfo_branchspecific.gi~SHA1:${'b'.repeat(40)};CRC:abcdef01  \r\nDIGEST:1`]);
  const bufs = [...texts.slice(0, 30), ...sigTexts].map((x) => [x]);
  const cases: Case[] = [
    { name: 'patcher-gameinfo.searchPathsBlock', ts: gi.searchPathsBlock as never, inputs: texts.map((x) => [x]) },
    { name: 'patcher-gameinfo.withModFolder', ts: gi.withModFolder as never, inputs: [...blocks, ...texts].flatMap((x) => folders.slice(0, 2).map((f) => [x, f])) },
    { name: 'patcher-gameinfo.searchPathLines', ts: gi.searchPathLines as never, inputs: [...blocks, ...texts].map((x) => [x]) },
    { name: 'patcher-gameinfo.patchIsCurrent', ts: gi.patchIsCurrent as never, inputs: [...patched, ...twice, ...texts.slice(0, 40)].flatMap((p) => infos.flatMap((i) => [[p, i, 'dota_mods'], [p, i, 'other']])) },
    { name: 'patcher-gameinfo.patchedBranch', ts: gi.patchedBranch as never, inputs: texts.flatMap((x, k) => [[x, blocks[k % blocks.length]], [x, 'SearchPaths\n{\n  Game dota\n\n}']]) },
    { name: 'patcher-gameinfo.stripPatch', ts: gi.stripPatch as never, inputs: texts.map((x) => [x]) },
    { name: 'patcher-gameinfo.restoreBranch', ts: gi.restoreBranch as never, inputs: texts.flatMap((x) => wants.map((w) => [x, w])) },
    { name: 'patcher-signatures.crc32', ts: ((x: string) => sg.crc32(Buffer.from(x, 'latin1'))) as never, inputs: bufs },
    { name: 'patcher-signatures.fileHashes', ts: ((x: string) => sg.fileHashes(Buffer.from(x, 'latin1'))) as never, inputs: bufs },
    { name: 'patcher-signatures.signatureLine', ts: ((x: string) => sg.signatureLine(Buffer.from(x, 'latin1'))) as never, inputs: bufs },
    { name: 'patcher-signatures.vanillaBranchHashes', ts: sg.vanillaBranchHashes as never, inputs: sigTexts.map((x) => [x]) },
    { name: 'patcher-signatures.matchesVanilla', ts: sg.matchesVanilla as never, inputs: [...branches, ...patched.slice(0, 4), ...texts.slice(0, 20)].flatMap((x) => wants.map((w) => [x, w])) },
    { name: 'patcher-signatures.hasSignaturePatch', ts: sg.hasSignaturePatch as never, inputs: sigTexts.map((x) => [x]) },
    { name: 'patcher-signatures.stripSignatures', ts: sg.stripSignatures as never, inputs: sigTexts.map((x) => [x]) },
  ];
  assert.ok(compare(cases) > 2000);
});

test('the game language and Minify in Rust read and move what the TypeScript does', { skip }, async () => {
  const gl = await import('../src/gamelang.ts');
  const st = await import('../src/gamelang-steam.ts');
  const lf = await import('../src/gamelang-folders.ts');
  const mf = await import('../src/minify.ts');
  const { buildVpk, entryAt } = await import('../src/vpk-write.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-lang-'));
  const put = (p: string, text: string | Buffer) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  const T = '\t';
  const user = (opts: string | null) => ['"UserLocalConfigStore"', '{', `${T}"Software"`, `${T}{`, `${T}${T}"570"`, `${T}${T}{`,
    ...(opts === null ? [] : [`${T}${T}${T}"LaunchOptions"${T}${T}"${opts}"`]), `${T}${T}}`, `${T}}`, '}', ''].join('\n');
  const login = (users: [string, string | null, number][]) => ['"users"', '{', ...users.flatMap(([id, mr, ts]) => [`${T}"${id}"`, `${T}{`,
    `${T}${T}"AccountName"${T}${T}"a"`, ...(mr === null ? [] : [`${T}${T}"MostRecent"${T}${T}"${mr}"`]), `${T}${T}"Timestamp"${T}${T}"${ts}"`, `${T}}`]), '}', ''].join('\n');
  const sid = (n: number) => String(76561197960265728n + BigInt(n));
  const boot = (pairs: [string, string][]) => ['"boot"', '{', ...pairs.map(([k, v]) => `${T}"${k}"${T}${T}"${v}"`), '}', ''].join('\n');
  const acf = (blocks: [string, string][]) => ['"AppState"', '{', ...blocks.flatMap(([b, l]) => [`${T}"${b}"`, `${T}{`, `${T}${T}"language"${T}${T}"${l}"`, `${T}}`]), '}', ''].join('\n');
  // a Minify pak: a VPK with one of its marker files inside
  const minifyPak = buildVpk([entryAt('minify_version.txt', Buffer.from('1.14'))]);
  const plainPak = buildVpk([entryAt('scripts/x.txt', Buffer.from('x'))]);
  const minifyHook = 'cmd /c \\"C:\\\\Minify\\\\Dota2-Minify.exe\\" prelaunch && %command% -language english';
  type Tree = { boot?: string; acf?: string; login?: string; users?: Record<string, string>; played?: string[]; folders?: Record<string, Record<string, string | Buffer>> };
  const folders: Tree['folders'] = {
    dota_russian: { 'pak01_dir.vpk': plainPak, 'pak02_dir.vpk': plainPak, 'pak03_dir.vpk.off': plainPak, 'gameinfo.gi': 'gi', 'pak65_dir.vpk': plainPak, 'pak70_dir.vpk': minifyPak, 'readme.txt': 'r' },
    dota_dutch: { 'pak66_dir.vpk': plainPak, 'pak05_dir.vpk.moff': plainPak },
    dota_minify: {}, dota_mods: { 'pak02_dir.vpk': plainPak }, DOTA_Koreana: { 'PAK01_000.vpk': plainPak, 'pak02_dir.vpk': plainPak, 'pak04_dir.vpk': plainPak },
    dota_english: { 'pak02_dir.vpk': plainPak, 'gameinfo.gi': 'theirs' }, notdota: {},
  };
  const trees: Tree[] = [
    {},
    { boot: boot([['UILanguage', 'English'], ['AudioLanguage', 'Russian']]) },
    { boot: boot([['UILanguage', 'schinese']]), acf: acf([['UserConfig', 'koreana'], ['MountedConfig', 'Russian']]) },
    { acf: acf([['UserConfig', 'english']]), login: login([[sid(11), '1', 5], [sid(22), '0', 9]]),
      users: { 11: user('-novid -language dutch'), 22: user('-language koreana') }, played: ['22'] },
    { boot: boot([['AudioLanguage', 'dutch']]), login: login([[sid(11), null, 5], [sid(22), null, 9]]),
      users: { 11: user('-language russian'), 22: user(minifyHook) } },
    { users: { 11: user('-language russian'), 22: user('-language russian'), 0: user('') }, played: ['11'] },
    { users: { 11: user('-language russian'), 22: user('-language german') }, played: ['11', '22'] },
    { login: 'garbage', users: { 33: user(null), 44: user('-console') } },
    { boot: '"boot" { "AudioLanguage" "" "UILanguage" "" }', folders },
  ];
  const games = trees.map((tr, i) => {
    const r = path.join(tmp, `t${i}`);
    const game = path.join(r, 'steamapps', 'common', 'dota 2 beta', 'game');
    fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
    if (tr.boot) put(path.join(game, 'dota', 'cfg', 'boot.vcfg'), tr.boot);
    if (tr.acf) put(path.join(r, 'steamapps', 'appmanifest_570.acf'), tr.acf);
    if (tr.login) put(path.join(r, 'config', 'loginusers.vdf'), tr.login);
    for (const [id, text] of Object.entries(tr.users ?? {})) put(path.join(r, 'userdata', id, 'config', 'localconfig.vdf'), text);
    for (const id of tr.played ?? []) fs.mkdirSync(path.join(r, 'userdata', id, '570'), { recursive: true });
    for (const [dir, files] of Object.entries(tr.folders ?? {})) {
      fs.mkdirSync(path.join(game, dir), { recursive: true });
      for (const [f, data] of Object.entries(files)) put(path.join(game, dir, f), data);
    }
    return game;
  });
  const paths = [...games, null, '', path.join(tmp, 'nowhere', 'a', 'b', 'c', 'game')];
  const langs = [null, '', 'russian', 'Russian', 'english', 'dutch', 'koreana', 'schinese', 'minify', 'german', 'x'];
  const configs = [
    JSON.stringify({ output_path: 'C:\\Steam\\game\\dota_dutch\\', output_locale: 'English' }), JSON.stringify({ output_locale: 'MINIFY' }),
    JSON.stringify({ output_path: '', output_locale: '' }), JSON.stringify({ output_path: 'D:/g/Dota_Russian' }), JSON.stringify({ output_path: 'x/dota_' }),
    'not json', '[]', JSON.stringify({ output_path: 5 }),
  ].map((text, i) => { const f = path.join(tmp, `cfg${i}.json`); fs.writeFileSync(f, text); return f; }).concat([path.join(tmp, 'none.json')]);
  const launches = [null, '', '-novid', 'cmd /c "C:\\Minify\\Dota2-Minify.exe" prelaunch && %command%', 'bash -c "minify prelaunch" && %command%',
    'prelaunchX minify &&', 'minify prelaunch', '"PRELAUNCH" MiniFy&&', 'minify\u00a0prelaunch\u2003&&'];
  const folderSets = [[], [{ suffix: 'russian', modFiles: 3 }], [{ suffix: 'dutch', modFiles: 0 }], [{ suffix: 'dutch', modFiles: 2 }, { suffix: 'russian', modFiles: 1 }], [{ suffix: 'minify', modFiles: 4 }]];
  const cfgObjs = [null, { folder: 'dutch', outputPath: null, locale: 'english' }, { folder: null, outputPath: 'C:\\g\\dota_russian', locale: null }, { folder: '', outputPath: '', locale: 'minify' }];
  const minifyInputs = folderSets.flatMap((fs_) => cfgObjs.flatMap((config) => [null, 'russian', 'Dutch', 'minify'].flatMap((audio) => [0, 2].flatMap((ourMods) =>
    ['russian', 'dutch'].map((ourFolder) => ({ folders: fs_, config, audio, ourMods, ourFolder, gameLanguages: gl.DOTA_LANGUAGES, launchOptions: launches[(ourMods + fs_.length) % launches.length] }))))));
  const counted = minifyInputs.slice(0, 60).map((m) => ({ ...m, counts: { dutch: 1, russian: 0, minify: 5 } }));
  const pakDir = path.join(games[8], 'dota_russian');
  const cases: Case[] = [
    { name: 'gamelang.modFolderFor', ts: gl.modFolderFor as never, inputs: langs.flatMap((a) => langs.flatMap((b) => [[a, b], [a, b, 'koreana'], [a, b, 'german']])) },
    { name: 'gamelang.folderFor', ts: gl.folderFor as never, inputs: langs.map((l) => [l]) },
    { name: 'gamelang.readKey', ts: st.readKey as never, inputs: [['"AudioLanguage"  "Russian "', 'AudioLanguage'], [`"audiolanguage"${T}"X"`, 'AudioLanguage'], ['"A" ""', 'A'], ['nothing', 'A']] },
    ...(['bootLanguages', 'langFolders', 'detectLangSuffix'] as const).map((n) => ({ name: `gamelang.${n}`, ts: gl[n] as never, inputs: paths.map((p) => [p]) })),
    ...(['launchLanguage', 'launchOptions', 'steamLanguage', 'steamAccountDir'] as const).map((n) => ({ name: `gamelang.${n}`, ts: st[n] as never, inputs: paths.map((p) => [p]) })),
    { name: 'gamelang.voiceInstalled', ts: lf.voiceInstalled as never, inputs: games.flatMap((g) => ['russian', 'koreana', 'dutch', 'english'].map((l) => [g, l])) },
    { name: 'minify.isMinifyFile', ts: mf.isMinifyFile as never, inputs: ['pak65_dir.vpk', 'pak66_000.vpk', 'pak67_dir.vpk.off', 'pak99_dir.vpk.moff', 'pak64_dir.vpk', 'pak65_dir.vpkx', 'pak065_dir.vpk', 'pak99_12.vpk', ''].map((f) => [f]) },
    { name: 'minify.isMinifyPak', ts: mf.isMinifyPak as never, inputs: [...fs.readdirSync(pakDir).map((f) => [path.join(pakDir, f)]), [path.join(tmp, 'none.vpk')]] },
    { name: 'minify.readConfig', ts: mf.readConfig as never, inputs: configs.map((c) => [c]) },
    { name: 'minify.prelaunchHook', ts: mf.prelaunchHook as never, inputs: launches.map((l) => [l]) },
    { name: 'minify.readMinify', ts: ((o: { counts?: Record<string, number> }) => mf.readMinify({ ...(o as unknown as Parameters<typeof mf.readMinify>[0]), countMods: o.counts ? (f: string) => o.counts![f] || 0 : null })) as never,
      inputs: [...minifyInputs, ...counted].map((o) => [o]) },
  ];
  assert.ok(compare(cases) > 500);

  // the ones that write: the same tree twice, one for each side, and what is left on disk compared
  const twin = (tag: string) => {
    const g = path.join(tmp, tag, 'game');
    for (const [dir, files] of Object.entries(folders)) {
      fs.mkdirSync(path.join(g, dir), { recursive: true });
      for (const [f, data] of Object.entries(files)) put(path.join(g, dir, f), data);
    }
    put(path.join(g, 'dota', 'cfg', 'boot.vcfg'), boot([['UILanguage', 'english']]));
    put(path.join(g, 'other', 'dota', 'cfg', 'boot.vcfg'), 'not a boot file');
    return g;
  };
  const [a, b] = [twin('a'), twin('b')];
  const steps = (g: string): [string, ...unknown[]][] => [
    ['gamelang.writeBootLanguages', g, null, 'russian'], ['gamelang.writeBootLanguages', g, 'english', 'koreana'],
    ['gamelang.writeBootLanguages', path.join(g, 'other'), 'schinese', null], ['gamelang.writeBootLanguages', path.join(g, 'fresh'), 'schinese', null],
    ['gamelang.writeBootLanguages', path.join(g, 'fresh2'), null, null],
    ['gamelang.ensureLangFolder', g, 'english'], ['gamelang.ensureLangFolder', g, 'english'], ['gamelang.ensureLangFolder', g, 'koreana'], ['gamelang.ensureLangFolder', g, 'polish'],
    ['gamelang.moveLangFolder', g, 'russian', 'polish'], ['gamelang.moveLangFolder', g, 'dutch', 'russian'], ['gamelang.moveLangFolder', g, 'koreana', 'koreana'],
    ['gamelang.moveLangFolder', g, 'mods', 'english'], ['gamelang.moveLangFolder', g, 'missing', 'english'], ['gamelang.moveLangFolder', null, 'a', 'b'],
  ];
  const tsOf: Record<string, (...x: never[]) => unknown> = {
    'gamelang.writeBootLanguages': ((g: string, ui: string | null, audio: string | null) => { gl.writeBootLanguages(g, { ui, audio }); return null; }) as never,
    'gamelang.ensureLangFolder': lf.ensureLangFolder as never, 'gamelang.moveLangFolder': lf.moveLangFolder as never,
  };
  const list = path.join(tmp, 'writes.json');
  fs.writeFileSync(list, JSON.stringify(steps(b)));
  const rs = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' }));
  const swap = (v: unknown) => (typeof v === 'string' ? v.split(b).join(a) : v);
  steps(a).forEach(([name, ...args], i) => {
    const want = (tsOf[name] as (...x: unknown[]) => unknown)(...args) ?? null;
    assert.deepEqual({ ok: swap((rs[i] as { ok: unknown }).ok) }, { ok: want }, `${name} ${JSON.stringify(args)} ${JSON.stringify(rs[i])}`);
  });
  const tree = (g: string): string[] => (fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .map((d) => { const p = path.join(d.parentPath, d.name); return path.relative(g, p) + (d.isFile() ? ` ${fs.readFileSync(p).toString('base64')}` : '/'); }).sort();
  assert.deepEqual(tree(b), tree(a));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('settings.json in Rust reads and writes what the TypeScript does', { skip }, async () => {
  const { Settings } = await import('../src/settings.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-settings-'));
  const files: (string | null)[] = [
    null, '', '{}', '\ufeff{"theme":"axe","uiScale":1.25}', '{"theme":"storm","zz":1,"dotaGamePath":"C:\\\\Games\\\\dota 2 beta\\\\game"}',
    '{"modLabels":{"rec:2":"b","rec:1":"a","10":"x","2":"y"},"favorites":["a|b","\u00e9\u4e2d\ud83d\ude00"],"5":true}',
    '{"uiScale":1e21,"x":1e-7,"y":-0,"z":0.1,"big":12345678901234567890,"neg":-3.5e-9}', '[1,2]', '"ab"', 'null', '5', 'not json', '{"a":1,"a":2}',
    '{"panels":{"rail":{"w":240,"folded":false},"bar":[]},"account":{"id":"1","username":"u\\n\\t\\u0001\\"q\\\\"}}',
    '{"itemLooks":[{"id":"x","hero":"pudge","name":"n","picks":[{"slot":"weapon","itemId":"7","name":"w"}],"at":1700000000000}]}',
  ];
  const dirs = files.map((text, i) => {
    const d = path.join(tmp, `d${i}`);
    fs.mkdirSync(d, { recursive: true });
    if (text !== null) fs.writeFileSync(path.join(d, 'settings.json'), text);
    return d;
  });
  const sets: [string, unknown][][] = [
    [], [['theme', 'meepo']], [['newKey', { b: 1, a: [1, { '3': 0, '1': 0 }] }], ['theme', 'bh']], [['uiScale', 0.7], ['favorites', []], ['5', 'five']],
  ];
  const writes: [string, [string, unknown][]][] = [];
  dirs.forEach((_, i) => sets.forEach((list, k) => writes.push([`${i}-${k}`, list])));
  const cases: Case[] = [
    { name: 'settings.load', ts: ((d: string) => new Settings(d).all()) as never, inputs: dirs.map((d) => [d]) },
  ];
  assert.ok(compare(cases) >= files.length);
  // the writes: each set list on a fresh copy of each file, the file left behind compared as text
  const list = path.join(tmp, 'writes.json');
  const fresh = (root: string, tag: string, i: number) => { const c = path.join(tmp, root, tag); fs.cpSync(dirs[i], c, { recursive: true }); return c; };
  const rsCalls = writes.map(([tag, l]) => ['settings.set', fresh('rsw', tag, Number(tag.split('-')[0])), l]);
  fs.writeFileSync(list, JSON.stringify(rsCalls));
  const rs = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' }));
  writes.forEach(([tag, l], n) => {
    const d = fresh('tsw', tag, Number(tag.split('-')[0]));
    const st = new Settings(d);
    for (const [k, v] of l) st.set(k as never, v as never);
    const want = fs.existsSync(st.file) ? fs.readFileSync(st.file, 'utf8') : null;
    assert.deepEqual(rs[n], { ok: want }, `settings.set ${tag}`);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a change to the folder in Rust commits, rolls back and recovers as the TypeScript one does', { skip }, async () => {
  const { FileTx } = await import('../src/file-tx.ts');
  const jr = await import('../src/file-tx-journal.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-tx-'));
  type Op = [string, ...unknown[]];
  const seed = (root: string) => {
    for (const [p, text] of [['a.txt', 'A'], ['b.txt', 'B'], ['d/c.txt', 'C'], ['d/e/f.txt', 'F']]) {
      fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
      fs.writeFileSync(path.join(root, p), text);
    }
  };
  const tsOps = (tx: InstanceType<typeof FileTx>, root: string, ops: Op[]): void => {
    for (const op of ops) {
      const at = (v: unknown) => path.join(root, String(v));
      if (op[0] === 'write') tx.write(at(op[1]), String(op[2]));
      else if (op[0] === 'copy') tx.copy(at(op[1]), at(op[2]));
      else if (op[0] === 'move') tx.move(at(op[1]), at(op[2]));
      else if (op[0] === 'remove') tx.remove(at(op[1]));
      else if (op[0] === 'fail') throw new Error('fail');
      else if (op[0] === 'savepoint') {
        try { FileTx.run((inner) => tsOps(inner, root, op[1] as Op[])); } catch (e) { if (op[2] !== 'catch') throw e; }
      }
    }
  };
  const scripts: Op[][] = [
    [['write', 'a.txt', 'A2'], ['write', 'new/deep/x.txt', 'X'], ['copy', 'b.txt', 'd/b2.txt'], ['move', 'd/c.txt', 'moved/c.txt'], ['remove', 'd/e']],
    [['write', 'a.txt', 'A2'], ['write', 'a.txt', 'A3'], ['remove', 'b.txt'], ['write', 'b.txt', 'B2'], ['fail']],
    [['write', 'n1/n2/n3.txt', '3'], ['move', 'a.txt', 'b.txt'], ['copy', 'd/c.txt', 'a.txt'], ['fail']],
    [['write', 'x.txt', 'x'], ['savepoint', [['write', 'a.txt', 'in'], ['remove', 'd'], ['fail']], 'catch'], ['write', 'y.txt', 'y']],
    [['write', 'x.txt', 'x'], ['savepoint', [['write', 'a.txt', 'in'], ['fail']], 'pass'], ['write', 'y.txt', 'y']],
    [['move', 'missing.txt', 'z.txt']], [['remove', 'missing.txt'], ['copy', 'missing.txt', 'q.txt']], [['write', 'a.txt', 'A2'], ['move', 'b.txt', 'a.txt'], ['remove', 'a.txt']],
  ];
  const tree = (g: string): string[] => (fs.existsSync(g) ? (fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[]) : [])
    .map((d) => {
      const p = path.join(d.parentPath, d.name);
      const name = path.relative(g, p).replace(/\.[0-9a-z]+-[0-9a-z]+\.mmtx$/, '.mmtx').replace(/[0-9a-z]+\.txlog$/, 'J.txlog');
      return name + (d.isFile() ? ` ${name.endsWith('.txlog') ? '' : fs.readFileSync(p, 'latin1')}` : '/');
    }).sort();
  const calls: unknown[][] = [];
  const runs: (() => unknown)[] = [];
  scripts.forEach((ops, i) => {
    for (const mode of ['run', 'crash']) {
      for (const journal of [false, true]) {
        if (mode === 'crash' && (!journal || ops.some((o) => o[0] === 'savepoint'))) continue; // a bare FileTx has no block for a savepoint to join
        const [a, b] = ['ts', 'rs'].map((side) => { const r = path.join(tmp, `${i}-${mode}-${journal}`, side); seed(path.join(r, 'game')); return r; });
        const jd = (r: string) => (journal ? path.join(r, 'journal') : null);
        calls.push(['file-tx.script', path.join(b, 'game'), jd(b), ops, mode]);
        runs.push(() => {
          FileTx.journalDir = jd(a);
          try {
            if (mode === 'crash') { const tx = new FileTx(); try { tsOps(tx, path.join(a, 'game'), ops); return true; } catch { return false; } }
            try { FileTx.run((tx) => tsOps(tx, path.join(a, 'game'), ops)); return true; } catch { return false; }
          } finally { FileTx.journalDir = null; }
        });
        // then what the next start makes of the journals left behind
        runs.push(() => (journal ? jr.recoverJournals(jd(a)) : jr.recoverJournals(null)));
        calls.push(['file-tx.recoverJournals', jd(b)]);
        runs.push(() => [a, b]);
        calls.push(['file-tx.readJournal', path.join(tmp, 'nowhere.txlog')]);
      }
    }
  });
  // run both sides step by step: the Rust calls one at a time, so a crash leaves its journal for the recovery that follows
  for (let k = 0; k < calls.length; k++) {
    const list = path.join(tmp, `call${k}.json`);
    fs.writeFileSync(list, JSON.stringify([calls[k]]));
    const [rs] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' }));
    const want = runs[k]();
    if (calls[k][0] === 'file-tx.readJournal') {
      const [a, b] = want as string[];
      assert.ok(rs.error, 'a journal that is not there is an error');
      assert.deepEqual(tree(b), tree(a), `the folder after ${JSON.stringify(calls[k - 2]).slice(0, 300)}`);
    } else assert.deepEqual(rs, { ok: want }, JSON.stringify(calls[k]).slice(0, 300));
  }
  // journals written by one side read back by the other
  const jfile = path.join(tmp, 'j', `x${jr.JOURNAL_EXT}`);
  const j = new jr.Journal(jfile);
  for (const e of [{ what: 'unwrite', dest: 'C:\\g\\a', parked: null }, { what: 'unmove', from: 'a', to: 'b', parked: 'b.p' }, { what: 'unremove', target: 't', parked: 'p' }, { what: 'rmdir', dir: 'd' }, { commit: true }]) j.add(e as never);
  const text = fs.readFileSync(jfile, 'utf8');
  const variants = [text, text.replace('{"commit":true}\n', ''), text + '{"what":"unwrite","dest":"","parked":null}\n{"what":"rmdir","dir":"x"}\n', text.slice(0, -5), '\n\n  \n' + text,
    '{"what":"unremove","target":"t","parked":null}\n', '{"what":"unmove","from":"a","to":"b"}\n', '{"commit":1}\n{"what":"rmdir","dir":"y"}\n', 'null\n', '[]'];
  const vfiles = variants.map((v, i) => { const f = path.join(tmp, 'j', `v${i}.txlog`); fs.writeFileSync(f, v); return f; });
  assert.ok(compare([{ name: 'file-tx.readJournal', ts: jr.readJournal as never, inputs: vfiles.map((f) => [f]) }]) === variants.length);
  j.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('manifest.json in Rust keeps mods and presets as the TypeScript does', { skip }, async () => {
  const { Library } = await import('../src/library.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-library-'));
  type Op = [string, ...unknown[]];
  const tsStep = (lib: InstanceType<typeof Library>, op: Op): unknown => {
    const rec = (i: unknown) => (typeof i === 'number' ? lib.list()[i]?.id : undefined) ?? 'nope';
    const pre = (i: unknown) => (typeof i === 'number' ? lib.listPresets()[i]?.id : undefined) ?? 'nope';
    const a = op as unknown[];
    switch (op[0]) {
      case 'add': return lib.add(a[1] as never);
      case 'update': return lib.update(rec(a[1]), a[2] as never);
      case 'setEnabled': return lib.setEnabled(rec(a[1]), a[2] as boolean);
      case 'remove': return lib.removeRecord(rec(a[1]));
      case 'savePreset': return lib.savePreset(a[1] as string);
      case 'updatePresetMods': return lib.updatePresetMods(pre(a[1]));
      case 'addShared': return lib.addSharedPreset(a[1] as never);
      case 'updatePreset': return lib.updatePreset(pre(a[1]), a[2] as never);
      case 'deletePreset': return lib.deletePreset(pre(a[1]));
      case 'find': return lib.find(rec(a[1]));
      case 'findByKey': return a.length > 3 ? lib.findByKey(a[1] as string, a[2] as string, a[3] as string) : lib.findByKey(a[1] as string, a[2] as string);
      case 'list': return lib.list();
      case 'knownLang': return lib.knownLangRelPaths();
      case 'knownFiles': return lib.knownFiles();
      case 'picksOn': return lib.picksOn();
      case 'members': return lib.presetMembers(lib.getPreset(pre(a[1])));
      case 'membersOf': return lib.presetMembers(a[1] as never);
      case 'modIds': return lib.presetModIds(lib.getPreset(pre(a[1])));
      case 'file': return fs.existsSync(lib.file) ? fs.readFileSync(lib.file, 'utf8') : null;
    }
    throw new Error(`no step ${op[0]}`);
  };
  // fresh ids and times differ between the sides: each id becomes its first place of appearance, each time T
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
  const norm = (v: unknown): unknown => {
    const ids = new Map<string, string>();
    const text = JSON.stringify(v).replace(uuid, (m) => { if (!ids.has(m)) ids.set(m, `ID${ids.size}`); return ids.get(m)!; })
      .replace(/(\\?"(?:updatedAt|installedAt|importedAt)\\?":\s*)\d{13}/g, (_, at: string) => `${at}0`);
    return JSON.parse(text);
  };
  const files = (extra: object) => [{ root: 'lang', relPath: 'pak02_dir.vpk' }, { root: 'fonts', relPath: 'f.ttf' }, { relPath: 'x' }, ...Object.values(extra)];
  const seeds: (string | null)[] = [
    null, '', 'not json', '﻿{"installed":[]}', '[1]', 'null',
    JSON.stringify({ zz: 1, presets: [{ id: 'p-old', name: 'Old', modIds: ['r1', 'r2', 'r9', 'r1'], updatedAt: 1 }], installed: [
      { id: 'r1', name: 'Ward', categoryId: 'wards', styleLabel: '', files: files({}), enabled: true, fp: 'F1', custom: { keep: [1, 2] } },
      { id: 'r2', name: 'Look', categoryId: 'cosmetic', slot: 'weapon', itemId: 7, effectId: 0, files: [], enabled: true },
      { id: 'r3', name: 'Off look', categoryId: 'cosmetic', slot: 'head', itemId: '8', files: [], enabled: false },
      { id: 'r4', name: 'Imported', files: [{ root: 'lang', relPath: 'pak05_dir.vpk' }] },
      { id: 'r5', name: 'Ward', categoryId: 'wards', styleLabel: 'Gold', files: [], enabled: true, fp: null },
      { id: 'r6', name: 'No slot', categoryId: 'cosmetic', itemId: '9', files: [], enabled: true },
    ] }),
    JSON.stringify({ installed: [{ id: 'q', name: 'n', categoryId: 'c' }], presets: [] }),
  ];
  const script: Op[] = [
    ['list'], ['knownLang'], ['knownFiles'], ['picksOn'], ['find', 0], ['find', 99], ['findByKey', 'wards', 'Ward'], ['findByKey', 'wards', 'Ward', 'Gold'], ['findByKey', 'wards', 'Ward', ''],
    ['members', 0], ['modIds', 0], ['membersOf', null], ['membersOf', { mods: [{ categoryId: 'wards', name: 'Ward', styleLabel: null, fp: 'F1' }, { categoryId: 'cosmetic', name: 'x' },
      { categoryId: 'wards', name: 'Ward', styleLabel: 'Gold', fp: null }, { categoryId: 'imported', name: 'Imported' }, { categoryId: 'wards', name: 'Ward', fp: 'F2' }] }],
    ['membersOf', { mods: [], modIds: ['r1'] }], ['membersOf', { modIds: ['r2', 'r3', 'r4', 'nope'] }],
    ['add', { name: 'New', categoryId: 'heroes', files: [{ root: 'lang', relPath: 'pak09_dir.vpk' }] }],
    ['add', { name: 'Pack', categoryId: 'packs', styleLabel: 'S', fileRef: null, preview: '', files: [], kind: 'pack', members: [{ id: 'm', name: 'M' }] }],
    ['add', { categoryId: 'x', kind: '', members: [] }],
    ['update', 0, { name: 'Renamed', extra: { a: 1 } }], ['update', 99, { name: 'x' }], ['setEnabled', 1, false], ['setEnabled', 0, true],
    ['savePreset', 'Mine'], ['savePreset', 'Mine'], ['addShared', { name: 'Shared', note: 'hi', wanted: [{ name: 'a' }] }], ['addShared', { name: 'Mine' }],
    ['savePreset', 'Shared'], ['updatePresetMods', 0], ['updatePresetMods', 1], ['updatePresetMods', 2], ['updatePresetMods', 9],
    ['updatePreset', 0, { name: 'Again', modIds: ['r1'] }], ['members', 1], ['modIds', 1], ['remove', 0], ['remove', 99], ['picksOn'],
    ['deletePreset', 0], ['deletePreset', 9], ['list'], ['file'],
  ];
  const dirs = seeds.map((text, i) => {
    const d = path.join(tmp, `d${i}`);
    fs.mkdirSync(d, { recursive: true });
    if (text !== null) fs.writeFileSync(path.join(d, 'manifest.json'), text);
    return d;
  });
  const copies = (side: string) => dirs.map((d, i) => { const c = path.join(tmp, side, String(i)); fs.cpSync(d, c, { recursive: true }); return c; });
  const [mine, theirs] = [copies('ts'), copies('rs')];
  const list = path.join(tmp, 'calls.json');
  fs.writeFileSync(list, JSON.stringify(theirs.map((d) => ['library.script', d, script])));
  const rs = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  mine.forEach((d, i) => {
    const lib = new Library(d);
    const want = script.map((op) => { try { return { ok: JSON.parse(JSON.stringify(tsStep(lib, op) ?? null)) }; } catch { return { error: true }; } });
    const got = (rs[i].ok as { ok?: unknown; error?: unknown }[]).map((r) => ('error' in r ? { error: true } : r));
    assert.deepEqual(norm(got), norm(want), `library script on seed ${i}`);
    for (const name of ['manifest.json', 'manifest.json.bak']) {
      const read = (dd: string) => (fs.existsSync(path.join(dd, name)) ? fs.readFileSync(path.join(dd, name), 'utf8') : null);
      assert.deepEqual(norm(read(theirs[i])), norm(read(d)), `${name} of seed ${i}`);
    }
  });
  const recs = [null, {}, { categoryId: 'cosmetic', slot: 's', itemId: 1 }, { categoryId: 'cosmetic', slot: '', itemId: 1 }, { categoryId: 'wards', name: 'W', styleLabel: '', fp: 'F' },
    { name: 'I', fp: 'F' }, { categoryId: '', name: 'I', styleLabel: 'S' }, { categoryId: 'cosmetic', slot: 2, itemId: 'x', name: 'N', effectId: 'e' }];
  compare([
    { name: 'library.identityOf', ts: Library.identityOf as never, inputs: recs.slice(1).map((r) => [r]) },
    { name: 'library.sameMod', ts: Library.sameMod as never, inputs: recs.flatMap((a) => recs.map((b) => [a, b])) },
    { name: 'library.inPreset', ts: Library.inPreset as never, inputs: recs.map((r) => [r]) },
    { name: 'library.isPick', ts: Library.isPick as never, inputs: recs.map((r) => [r]) },
    { name: 'library.pickOf', ts: Library.pickOf as never, inputs: recs.slice(1).map((r) => [r]) },
  ]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the load order in Rust hands out, moves and swaps slots as the TypeScript does', { skip }, async () => {
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const zones = await import('../src/slot-zones.ts');
  const { buildVpk, entryAt } = await import('../src/vpk-write.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-slots-'));
  const pak = (files: Record<string, string>) => buildVpk(Object.entries(files).map(([p, d]) => entryAt(p, Buffer.from(d))));
  const lang: Record<string, Buffer | string> = {
    'pak01_dir.vpk': pak({ 'x.txt': 'valve' }), 'gameinfo.gi': 'gi',
    'pak02_dir.vpk': pak({ 'models/heroes/a.vmdl_c': '1', 'shared.txt': 'x', 'materials/default/white.vtex_c': 'a', 'particles/basic_smoke/s.vpcf_c': 'a', 'z.txt': 'z1' }),
    'pak05_dir.vpk.off': pak({ 'shared.txt': 'q', 'models/heroes/a.vmdl_c': '2' }),
    'pak30_dir.vpk': pak({ 'shared.txt': 'y', 'models/heroes/a.vmdl_c': '1', 'only_b.txt': 'b', 'materials/default/white.vtex_c': 'b', 'z.txt': 'z2', 'a.txt': 'a2' }),
    'pak31_dir.vpk': pak({ 'shared.txt': 'w', 'z.txt': 'z3', 'a.txt': 'a3' }), 'pak31_000.vpk': 'volume', 'pak31_001.vpk.off': 'volume1',
    'pak40_dir.vpk.moff': pak({ 'shared.txt': 'm' }), 'pak64_dir.vpk': pak({ 'notice.txt': 'n' }), 'pak65_dir.vpk': pak({ 'minify.txt': 'm' }),
    '!pak07_dir.vpk': pak({ 'legacy.txt': 'l' }), '!PAK08_dir.vpk.OFF': pak({ 'legacy2.txt': 'l' }), 'readme.txt': 'r',
  };
  const recs = [
    { id: 'a', name: 'Trees', categoryId: 'trees', files: [{ root: 'lang', relPath: 'pak30_dir.vpk' }], enabled: true },
    { id: 'b', name: 'Arms', categoryId: 'hero-items', files: [{ root: 'lang', relPath: 'pak02_dir.vpk' }], enabled: true },
    { id: 'c', name: 'Off', categoryId: 'wards', files: [{ root: 'lang', relPath: 'pak05_dir.vpk' }], enabled: false },
    { id: 'd', name: 'Volumes', categoryId: 'heroes', files: [{ root: 'lang', relPath: 'pak31_dir.vpk' }, { root: 'lang', relPath: 'pak31_000.vpk' }, { root: 'lang', relPath: 'pak31_001.vpk' }, { root: 'fonts', relPath: 'f.ttf' }] },
    { id: 'e', name: 'Master off', categoryId: 'shaders', files: [{ root: 'lang', relPath: 'pak40_dir.vpk' }] },
    { id: 'f', name: 'On the notice', categoryId: 'heroes', files: [{ root: 'lang', relPath: 'pak64_dir.vpk' }] },
    { id: 'g', name: 'Legacy', categoryId: 'river', files: [{ root: 'lang', relPath: '!pak07_dir.vpk' }] },
    { id: 'h', name: 'Legacy off', categoryId: 'river', files: [{ root: 'lang', relPath: '!pak08_dir.vpk' }] },
    { id: 'i', name: 'Font', categoryId: 'fonts', files: [{ root: 'fonts', relPath: 'x.ttf' }] },
  ];
  const twin = (side: string) => {
    const root = path.join(tmp, side);
    const game = path.join(root, 'game');
    for (const [f, data] of Object.entries(lang)) { fs.mkdirSync(path.join(game, 'dota_russian'), { recursive: true }); fs.writeFileSync(path.join(game, 'dota_russian', f), data); }
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib', 'manifest.json'), JSON.stringify({ installed: recs, presets: [] }, null, 2));
    return { root, game, lib: path.join(root, 'lib'), journal: path.join(root, 'journal') };
  };
  const coverMods = (lib: { list(): { id: string; name: string; files: unknown[]; enabled?: boolean }[] }) =>
    lib.list().filter((r) => r.enabled !== false).map((r) => ({ key: r.id, name: r.name, files: r.files }));
  const used = ['pak02_dir.vpk', 'pak03_dir.vpk', 'pak30_dir.vpk', 'pak31_dir.vpk', 'pak64_dir.vpk'];
  const full = Array.from({ length: 98 }, (_, i) => `pak${String(i + 2).padStart(2, '0')}_dir.vpk`);
  const ops: unknown[][] = [
    ['usedPakNames'], ['usedModSlots'], ['allocate', used, true], ['allocate', used, false], ['allocate', full.slice(0, 28), true], ['allocate', full, true],
    ['plan', ['a/pak01_dir.vpk', 'a/pak01_000.vpk', 'a/pak01_001.vpk', 'B/Pak01_DIR.vpk', 'b/x.vpk', '!pak51_000.vpk', '!pak51_dir.vpk', '_dir.vpk', '_000.vpk', 'c/d/e_123.vpk', 'a/pak01_dir.vpk'], used, true],
    ['plan', ['m.vpk', 'n_dir.vpk'], full.slice(0, 60), false], ['plan', ['m.vpk'], full, false],
    ['slotBase', recs[3]], ['slotBase', { files: [{ root: 'lang', relPath: 'PAK07_DIR.VPK' }] }], ['slotBase', {}], ['slotNumber', recs[1]], ['slotNumber', recs[8]],
    ['freeBelow', 30, used], ['freeBelow', 3, used], ['freeBelow', 68, ['pak63_dir.vpk', 'pak67_dir.vpk']], ['freeBelow', 2, []],
    ['coverage', 'mods'],
    ['legacy'], ['list'], ['usedPakNames'],
    ['moveToSlot', 3, 'pak33'], ['moveToSlot', 8, 'pak09'], ['moveToSlot', 2, 'pak06', 'pak05'], ['moveToSlot', 1, 'pak31'],
    ['swap', 0, 1], ['swap', 0, 8], ['list'], ['coverage', 'mods'],
    ['moveToZone', 0], ['moveToZone', 1], ['moveToZone', 4], ['vacate'], ['vacate'], ['migrateZones'], ['migrateZones'], ['list'], ['usedPakNames'], ['usedModSlots'],
  ];
  const a = twin('ts');
  const b = twin('rs');
  // coverage needs the live library on the Rust side: run the script in pieces split at each coverage step
  const answers: unknown[] = [];
  let piece: unknown[][] = [];
  const flush = () => {
    if (!piece.length) return;
    const list = path.join(tmp, `slots${answers.length}.json`);
    fs.writeFileSync(list, JSON.stringify([['installer-slots.script', b.game, 'russian', b.journal, b.lib, piece]]));
    const [rs] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' }));
    answers.push(...(rs.ok as unknown[]));
    piece = [];
  };
  for (const op of ops) {
    if (op[0] === 'coverage') {
      flush();
      piece.push(['coverage', coverMods(new Library(b.lib))]);
      flush();
    } else piece.push(op);
  }
  flush();
  FileTx.journalDir = a.journal;
  try {
    const ud = path.join(a.root, 'userdata');
    const inst = new Installer({ userDataDir: ud, getGamePath: () => a.game, getLangSuffix: () => 'russian' });
    const lib = new Library(a.lib);
    const rec = (i: unknown) => lib.list()[i as number] ?? ({} as never);
    const store = (id: string, files: unknown) => lib.update(id, { files } as never);
    const sorted = (s: Set<string>) => [...s].sort();
    ops.forEach((op, k) => {
      let want: unknown;
      try {
        const v = ((): unknown => {
          switch (op[0]) {
            case 'usedPakNames': return sorted(inst.usedPakNames());
            case 'usedModSlots': return inst.usedModSlots();
            case 'allocate': { const u = new Set(op[1] as string[]); const n = inst.allocatePak(u, op[2] as boolean); return [n, sorted(u)]; }
            case 'plan': { const u = new Set(op[2] as string[]); const p = inst.planPakNames(op[1] as string[], u, op[3] as boolean); return [[...p], sorted(u)]; }
            case 'slotBase': return inst.slotBase(op[1] as never);
            case 'slotNumber': return inst.slotNumber(op[1] as never);
            case 'freeBelow': return inst.freeSlotBelow(op[1] as number, new Set(op[2] as string[]));
            case 'coverage': return [...inst.coverage(coverMods(lib as never) as never)];
            case 'legacy': return inst.migrateLegacyPriorityPaks(lib);
            case 'list': return lib.list();
            case 'moveToSlot': { const r = rec(op[1]); const f = op.length > 3 ? inst.moveToSlot(r, op[2] as string, op[3] as string) : inst.moveToSlot(r, op[2] as string); store(r.id, f); return f; }
            case 'swap': { const out = inst.swapSlots(rec(op[1]), rec(op[2])); for (const o of out) store(o.id, o.files); return out; }
            case 'moveToZone': { const r = rec(op[1]); const f = inst.moveToZone(r); if (f) store(r.id, f); return f; }
            case 'migrateZones': return inst.migrateSlotZones(lib);
            case 'vacate': return zones.vacateAppPak(inst, lib);
          }
          throw new Error(`no step ${op[0]}`);
        })();
        want = { ok: JSON.parse(JSON.stringify(v ?? null)) };
      } catch { want = { error: true }; }
      const got = answers[k] as { ok?: unknown; error?: unknown };
      assert.deepEqual('error' in got ? { error: true } : got, want, `${JSON.stringify(op).slice(0, 200)}`);
    });
  } finally { FileTx.journalDir = null; }
  const tree = (g: string): string[] => (fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .filter((d) => !d.parentPath.includes('userdata') && d.name !== 'userdata')
    .map((d) => { const p = path.join(d.parentPath, d.name); return path.relative(g, p) + (d.isFile() ? ` ${fs.readFileSync(p).toString('base64')}` : '/'); }).sort();
  assert.deepEqual(tree(b.root), tree(a.root));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the master switch, the ownership note and foreign files in Rust match the TypeScript', { skip }, async () => {
  const { Installer } = await import('../src/installer.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const { buildVpk, entryAt } = await import('../src/vpk-write.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-folder-'));
  const pak = (files: string[]) => buildVpk(files.map((p) => entryAt(p, Buffer.from(p))));
  const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const lang: Record<string, Buffer | string> = {
    'pak01_dir.vpk': pak(['x.txt']), 'gameinfo.gi': 'gi', 'dota2modmanager.json': '{"files":["pak30_dir.vpk"]}',
    'pak30_dir.vpk': pak(['models/heroes/juggernaut/juggernaut.vmdl_c', 'materials/models/heroes/juggernaut/j.vmat_c']),
    'pak31_dir.vpk': pak(['particles/units/heroes/hero_axe/axe_counter.vpcf_c', 'sounds/weapons/hero/axe/a.vsnd_c']),
    'pak31_000.vpk': 'volume', 'pak31_001.vpk.off': 'volume1', 'pak31_7.vpk': 'not a volume',
    'pak40_dir.vpk.off': pak(['materials/terrain/t.vmat_c']), 'pak41_dir.vpk.moff': pak(['a.txt']),
    'pak66_dir.vpk': pak(['minify.txt']), 'readme.txt': 'r', 'broken_dir.vpk': 'not a vpk',
    'pak50_dir.vpk.abc123-k2.mmtx': 'parked old', 'pak51_dir.vpk.def-9.mmtx': 'parked lost',
    'maps/dota.vpk': pak(['maps/dota.vmap_c']), 'maps/other.vpk.off': pak(['maps/x.txt']), 'maps/notes.txt': 'n',
  };
  const twin = (side: string) => {
    const root = path.join(tmp, side);
    const game = path.join(root, 'game');
    for (const [f, data] of Object.entries(lang)) {
      const p = path.join(game, 'dota_russian', f);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data);
    }
    fs.writeFileSync(path.join(game, 'dota_russian', 'pak50_dir.vpk'), 'new');
    for (const f of ['pak50_dir.vpk.abc123-k2.mmtx']) fs.utimesSync(path.join(game, 'dota_russian', f), old, old);
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib', 'manifest.json'), JSON.stringify({ installed: [], presets: [] }));
    return { root, game, lib: path.join(root, 'lib'), journal: path.join(root, 'journal'), tools: path.join(root, 'userdata', 'tools') };
  };
  const known = [{ root: 'lang', relPath: 'pak30_dir.vpk' }, { root: 'fonts', relPath: 'f.ttf' }];
  const rec = (rel: string) => ({ files: [{ root: 'lang', relPath: rel }] });
  const ops = (t: string): unknown[][] => [
    ['togglable', 'pak30_dir.vpk'], ['togglable', 'pak01_dir.vpk'], ['togglable', 'pak66_dir.vpk'], ['togglable', 'dota2modmanager.json'],
    ['masterIsOff'], ['ownsFile', 'pak30_dir.vpk'], ['ownsFile', 'PAK30_DIR.VPK'], ['ownsFile', 'pak31_dir.vpk'],
    ['primaryPresent', rec('pak30_dir.vpk')], ['primaryPresent', rec('pak40_dir.vpk')], ['primaryPresent', rec('pak41_dir.vpk')], ['primaryPresent', rec('pak99_dir.vpk')], ['primaryPresent', { files: [{ root: 'fonts', relPath: 'f.ttf' }] }],
    ['siblingParts', 'pak31_dir.vpk'], ['siblingParts', 'pak30_dir.vpk'], ['siblingParts', 'pak31.vpk'], ['siblingParts', 'maps/dota_dir.vpk'],
    ['external', known, true], ['external', known, false], ['external', [], true],
    ['sweep', t, 7 * 24 * 3600 * 1000],
    ['setMaster', false], ['masterIsOff'], ['external', known, true], ['setMaster', false], ['setMaster', true], ['masterIsOff'],
    ['writeOwnership', ['pak31_dir.vpk', 'maps\dota.vpk', 'pak30_dir.vpk', 'pak31_dir.vpk'], '2026-01-01T00:00:00.000Z'], ['ownsFile', 'maps/dota.vpk'], ['ownsFile', 'pak30_dir.vpk'],
  ];
  const a = twin('ts');
  const b = twin('rs');
  const list = path.join(tmp, 'folder.json');
  fs.writeFileSync(list, JSON.stringify([['installer-slots.script', b.game, 'russian', b.journal, b.lib, ops(b.tools)]]));
  const [rs] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' }));
  const answers = rs.ok as { ok?: unknown; error?: unknown }[];
  const ext = answers[17].ok as { name: string; info?: string }[];
  assert.ok(ext.length >= 5 && ext.some((e) => e.info), JSON.stringify(answers[17]).slice(0, 300));
  assert.deepEqual(answers[20], { ok: { restored: 1, dropped: 1 } });
  FileTx.journalDir = a.journal;
  try {
    const inst = new Installer({ userDataDir: path.join(a.root, 'userdata'), getGamePath: () => a.game, getLangSuffix: () => 'russian' });
    const RealDate = Date;
    ops(a.tools).forEach((op, k) => {
      let want: unknown;
      try {
        const v = ((): unknown => {
          switch (op[0]) {
            case 'togglable': return inst.isTogglableModFile(op[1] as string);
            case 'masterIsOff': return inst.masterIsOff();
            case 'setMaster': return inst.setMasterEnabled(op[1] as boolean);
            case 'ownsFile': return inst.ownsFile(op[1] as string);
            case 'primaryPresent': return inst.langPrimaryPresent(op[1] as never);
            case 'siblingParts': return inst.siblingParts(op[1] as string);
            case 'external': return inst.externalFiles(op[1] as never, { scanExtras: op[2] as boolean });
            case 'sweep': return inst.sweepStaged(op[2] as number);
            case 'writeOwnership': {
              const at = op[2] as string;
              (globalThis as { Date: unknown }).Date = class extends RealDate { constructor(...x: unknown[]) { super(...((x.length ? x : [at]) as [string])); } };
              try { inst.writeOwnership(op[1] as string[]); } finally { (globalThis as { Date: unknown }).Date = RealDate; }
              return null;
            }
          }
          throw new Error(`no step ${op[0]}`);
        })();
        want = { ok: JSON.parse(JSON.stringify(v ?? null)) };
      } catch { want = { error: true }; }
      const got = answers[k];
      assert.deepEqual('error' in got ? { error: true } : got, want, `${JSON.stringify(op).slice(0, 200)}`);
    });
  } finally { FileTx.journalDir = null; }
  const tree = (g: string): string[] => (fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .filter((d) => !d.parentPath.includes('userdata') && d.name !== 'userdata')
    .map((d) => { const p = path.join(d.parentPath, d.name); return path.relative(g, p) + (d.isFile() ? ` ${fs.readFileSync(p).toString('base64')}` : '/'); }).sort();
  assert.deepEqual(tree(b.root), tree(a.root));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('installing, switching, removing, fonts, cursors, packs and the download cache in Rust match the TypeScript', { skip }, async () => {
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const { openZip, safeJoin, isUnsafeName } = await import('../src/safe-zip.ts');
  const { ensureSpace } = await import('../src/disk-space.ts');
  const { fileUrl } = await import('../src/installer-downloads.ts');
  const imp = await import('../src/import.ts');
  const { Fingerprints } = await import('../src/fingerprints.ts');
  const mu = await import('../src/mod-update.ts');
  const ring = await import('../src/emblem-ring.ts');
  const { buildVpk, entryAt } = await import('../src/vpk-write.ts');
  const AdmZip = (await import('adm-zip')).default;
  const crypto = await import('node:crypto');
  const sha1 = (b: Buffer) => crypto.createHash('sha1').update(b).digest('hex');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-write-'));
  const pak = (files: Record<string, string | Buffer>) => buildVpk(Object.entries(files).map(([p, d]) => entryAt(p, Buffer.from(d))));
  const zip = (files: Record<string, string | Buffer>) => {
    const z = new AdmZip();
    for (const [n, d] of Object.entries(files)) z.addFile(n, Buffer.from(d));
    return z.toBuffer();
  };
  const evil = (() => {
    const z = new AdmZip();
    z.addFile('ok.txt', Buffer.from('ok'));
    z.addFile('CON', Buffer.from('c'));
    z.addFile('a/dots./x.txt', Buffer.from('d'));
    z.addFile('dir/', Buffer.alloc(0));
    // a name adm-zip will not write for us, patched into both headers after the fact
    return Buffer.from(z.toBuffer().toString('latin1').replaceAll('a/dots./x.txt', '../../evx.txt'), 'latin1');
  })();
  const heroes = {
    'models/heroes/juggernaut/juggernaut.vmdl_c': 'j', 'materials/models/heroes/juggernaut/j.vmat_c': 'jm',
    'models/heroes/axe/axe.vmdl_c': 'a', 'particles/units/heroes/hero_axe/x.vpcf_c': 'p',
    'panorama/images/heroes/axe_png.vtex_c': 'i', 'materials/shared/s.vmat_c': 's',
  };
  const items = ['"items_game"', '{', '\t"items"', '\t{', '\t\t"4100"', '\t\t{', '\t\t\t"name"\t"Blade"', '\t\t\t"prefab"\t"wearable"',
    '\t\t\t"model_player"\t"models/heroes/juggernaut/juggernaut.vmdl"', '\t\t}', '\t}', '}', ''].join('\n');
  const modded = items.replace('"Blade"', '"Blade of the mod"');
  const inputs: Record<string, string | Buffer> = {
    'in/mod.zip': zip({
      'Mod/pak01_dir.vpk': pak(heroes), 'Mod/pak01_000.vpk': 'vol', 'Mod/readme.txt': 'r', 'Mod/maps/dota.vpk': pak({ 'maps/dota.vmap_c': 'm' }),
      'Mod/extra/x.txt': 'x', '!guide/a.txt': 'g', 'Mod/install.bat': 'b', 'top.txt': 't',
    }),
    'in/single.vpk': pak(heroes), 'in/note.txt': 'note',
    'imp/set/pak01_dir.vpk': (() => { const v = pak({ 'models/heroes/axe/axe.vmdl_c': 'a' }); return v; })(), 'imp/set/pak01_000.vpk': 'notreal',
    'imp/set/pak01_001.vpk': 'x', 'imp/set/loose.vpk': pak({ 'a.txt': 'a' }), 'imp/set/readme.txt': 'r', 'imp/orphan/foo_000.vpk': 'v',
    'imp/tree/game/Dota2SkinChanger/pak01_dir.vpk': pak({ 'models/heroes/juggernaut/juggernaut.vmdl_c': 'j' }),
    'imp/author/My  Mod!/materials/x.vmat_c': 'm', 'imp/author/My  Mod!/readme.md': 'r', 'imp/empty/notes.txt': 'n',
    'imp/pack.zip': zip({ 'P/pak01_dir.vpk': pak({ 'models/heroes/axe/axe.vmdl_c': 'a' }), 'P/x.txt': 'x' }), 'imp/novpk.zip': zip({ 'x.txt': 'x' }),
    'in/icons.zip': zip({ 'I/pak01_dir.vpk': pak({ 'panorama/images/items/blink_png.vtex_c': 'b', 'models/heroes/axe/axe.vmdl_c': 'a' }), 'I/pak01_000.vpk': 'vol' }),
    'in/schema.vpk': pak({
      'models/heroes/juggernaut/juggernaut.vmdl_c': 'j', 'scripts/items/items_game.txt': modded,
      'resource/localization/dota_english.txt': 'x'.repeat(300 * 1024), 'resource/localization/mine.txt': 'small', 'panorama/images/ds_logo.vtex_c': 'l',
    }),
    'in/font.zip': zip({ 'F/assets/custom/radiance.otf': 'mine', 'F/assets/custom/new.otf': 'new', 'F/assets/default/radiance.otf': 'valve' }),
    'in/nofont.zip': zip({ 'F/x.otf': 'x' }),
    'in/cursor.zip': zip({ 'C/cursor/arrow.cur': 'mycur', 'C/cursor/hand.cur': 'hand' }),
    'in/tool.zip': zip({ 't/a.exe': 'exe', 't/sub/b.dll': 'dll' }),
    'in/evil.zip': evil, 'in/damaged.zip': 'PK\x03\x04 not really a zip at all',
    'in/bomb.zip': zip({ 'zeros.bin': Buffer.alloc(3 * 1024 * 1024) }),
    'in/vanilla.txt': items,
    'game/dota/pak01_dir.vpk': pak({ 'x.txt': 'valve' }), 'game/dota_russian/gameinfo.gi': 'gi',
    'game/dota_russian/pak01_dir.vpk': pak({ 'sounds/v.vsnd_c': 'v' }),
    'game/dota_russian/pak20_dir.vpk': pak({ 'models/heroes/axe/axe.vmdl_c': 'a' }), 'game/dota_russian/pak20_000.vpk.off': 'v0',
    'game/dota/panorama/fonts/radiance.otf': 'valve', 'game/dota/resource/cursor/arrow.cur': 'valvecur',
    'ud/downloads/mods/Red Abaddon (v2).zip': 'cached',
    'lib/manifest.json': JSON.stringify({ installed: [
      { id: 'multi', name: 'Old import', categoryId: 'heroes', fileRef: 'old.zip', enabled: false, schema: [{ id: '1' }], files: [{ root: 'lang', relPath: 'pak20_dir.vpk' }, { root: 'lang', relPath: 'pak20_000.vpk' }] },
    ], presets: [] }),
  };
  const twin = (side: string) => {
    const r = path.join(tmp, side);
    for (const [f, d] of Object.entries(inputs)) {
      fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
      fs.writeFileSync(path.join(r, f), d);
    }
    fs.mkdirSync(path.join(r, 'ud/downloads/fonts'), { recursive: true });
    fs.copyFileSync(path.join(r, 'in/font.zip'), path.join(r, 'ud/downloads/fonts/font.zip'));
    return r;
  };
  const a = twin('ts');
  const b = twin('rs');
  const at = (p: unknown) => (String(p).startsWith('@/') ? path.join(a, ...String(p).slice(2).split('/')) : String(p));
  const rel = (p: string) => (p.startsWith(a) ? `@/${path.relative(a, p).replace(/\\/g, '/')}` : p);
  const describe = (z: ReturnType<typeof openZip>) => z.files.map((f) => ({ path: f.path, size: f.size, sha1: sha1(f.read()) }));
  FileTx.journalDir = path.join(a, 'journal');
  const inst = new Installer({ userDataDir: path.join(a, 'ud'), getGamePath: () => path.join(a, 'game'), getLangSuffix: () => 'russian' });
  const lib = new Library(path.join(a, 'lib'));
  const ov = inst.overlays;
  const run = (op: unknown[]): unknown => {
    switch (op[0]) {
      case 'unsafe': return isUnsafeName(op[1] as string);
      case 'safeJoin': return rel(safeJoin(at(op[1]), op[2] as string));
      case 'zip': { const z = openZip(at(op[1]), op[2] ? { limits: op[2] as never } : {}); return { label: z.label, files: describe(z) }; }
      case 'space':
        ensureSpace(at(op[1]), op[2] as number, () => { if (op[3] === null) throw new Error('no'); return { bavail: op[3] as number, bsize: 1 }; });
        return null;
      case 'fileUrl': return fileUrl(op[1] as string, op[2] as string);
      case 'cachedArchive': { const p = inst.cachedArchive(op[1] as string, op[2] as string); return p && rel(p); }
      case 'remember': inst.rememberDownload(op[1] as string, op[2] as never); return null;
      case 'index': return inst.downloadIndex();
      case 'listCache': return inst.listDownloadCache().map(({ at: _at, ...d }) => d);
      case 'removeCached': return inst.removeCachedDownload(op[1] as string);
      case 'cacheSize': return inst.downloadCacheSize();
      case 'clearCache': inst.clearDownloadCache(); return null;
      case 'installFonts': return ov.installFonts(at(op[1]), op[2] as string);
      case 'installCursor': return ov.installCursor(at(op[1]), op[2] as string);
      case 'written': return ov.written();
      case 'fontHashes': return ov.fontFolderHashes();
      case 'lost': { const recs = op[1] as never[]; return ov.lostToVerify(recs).map((r) => recs.indexOf(r)); }
      case 'ensureStore': return inst.ensureCursorStore(op[1] as string, op[2] as never);
      case 'deployCursor': return inst.deployCursor(op[1] as string, op[2] as never);
      case 'undeployCursor': inst.undeployCursor(op[1] as string, op[2] as never); return null;
      case 'cursorZip': return describe(openZip(inst.cursorZip({ id: op[1], name: op[2], files: op[3] } as never)));
      case 'dropStore': ov.dropCursorStore(op[1] as string); return null;
      case 'restore': return inst.restoreDeployed(op[1] as never);
      case 'install': return FileTx.run((tx) => inst.installInto(tx, { categoryId: op[1] as string, modName: op[2] as string, local: at(op[3]) }));
      case 'installTool': return inst.installTool(at(op[1]), op[2] as string);
      case 'setEnabled': inst.setEnabled(op[1] as never, op[2] as boolean, op[3] as string | null); return null;
      case 'remove': inst.remove(op[1] as never, { recId: op[2] as string | null, deployed: op[3] as boolean }); return null;
      case 'merge': return sha1(inst.mergeToSingleVpk({ files: op[1] } as never, op[2] as never));
      case 'unpack': return inst.unpackToFolder({ files: op[1] } as never, at(op[2]));
      case 'displayName': return inst.displayNameForFile(op[1] as string);
      case 'harvest': {
        const records = op[1] as never[];
        const r = inst.harvestSchema(records, op[2] ? fs.readFileSync(at(op[2]), 'latin1') : null);
        return { ...r, records };
      }
      case 'installedSize': return inst.installedSize({ files: op[1] } as never);
      case 'dropIcons': { const records = op[1] as never[]; const n = inst.dropItemIcons(records); return { n, records }; }
      case 'analyze': return inst.analyzeRecord({ files: op[1] } as never);
      case 'split': return inst.splitVpkFile(op[1] as string);
      case 'mergeMulti': inst.mergeMultiPartRecords(lib); return lib.list();
      case 'addMember': return inst.addPackMemberFromRecord(op[1] as string, lib.list()[op[2] as number], op[3] as string);
      case 'deployPack': return inst.deployPack(op[1] as never);
      case 'removePackFully': inst.removePackFully(op[1] as never); return null;
      case 'deployMember': return inst.deployMemberAsMod({ id: op[1] } as never, { id: op[2] } as never).files;
      case 'libList': return lib.list();
      case 'fpStore': { const f = new Fingerprints(path.join(a, 'ud')); f.apply(JSON.parse(op[1] as string)); fs.writeFileSync(f.file, op[1] as string); return null; }
      case 'fpMatch': return new Fingerprints(path.join(a, 'ud')).match(op[1] as string);
      case 'fpHas': return new Fingerprints(path.join(a, 'ud')).hasData();
      case 'fpPrints': { const p = new Fingerprints(path.join(a, 'ud')).printsOf({ categoryId: op[1], name: op[2], styleLabel: op[3] } as never); return p && [...p].sort(); }
      case 'fpFonts': return new Fingerprints(path.join(a, 'ud')).matchFonts(ov.fontFolderHashes() || {}).map((m) => m.name);
      case 'updatable': return mu.updatable(op[1] as never);
      case 'behind': { const f = new Fingerprints(path.join(a, 'ud')); return mu.behindCatalog(op[1] as never, op[2] as string, (id) => f.printsOf(id)); }
      case 'updateMod': {
        const rec = lib.list()[op[1] as number];
        const local = at(op[2]);
        const proxy = Object.assign(Object.create(inst), { download: async () => local });
        return mu.updateMod({ installer: proxy, library: lib, rec }).then((r) => { delete (r as { updatedAt?: number }).updatedAt; lib.save(); return r.files; });
      }
      case 'ring': return ring.withRing(op[1] as string, op[2] as boolean);
      case 'keepRing': return ring.keepRing(path.join(a, 'game'), op[1] as boolean);
      case 'importPaths': { const steps: number[][] = []; return imp.importVpks(inst, (op[1] as string[]).map(at), (d, n) => steps.push([d, n])).then((results) => ({ results, steps })); }
      case 'importBuffers': return imp.importVpkBuffers(inst, (op[1] as string[][]).map(([name, p]) => ({ name, data: fs.readFileSync(at(p)) })));
      case 'installBuffer': return imp.installVpkBuffer(inst, fs.readFileSync(at(op[1])));
    }
    throw new Error(`no step ${op[0]}`);
  };
  // a step may be built from the answers before it, which is why the TypeScript runs first
  type Step = unknown[] | ((ans: unknown[]) => unknown[]);
  const lang = (r: string) => ({ root: 'lang', relPath: r });
  const named: Record<string, number> = {};
  const as = (name: string, s: Step): Step => (ans) => { named[name] = ans.length; return typeof s === 'function' ? s(ans) : s; };
  const got = (ans: unknown[], name: string) => ans[named[name]];
  const first = (ans: unknown[], name: string) => (got(ans, name) as { relPath: string }[])[0].relPath;
  const steps: Step[] = [
    ['unsafe', 'a/b.txt'], ['unsafe', '../x'], ['unsafe', '/abs'], ['unsafe', 'C:x'], ['unsafe', 'a/CON.txt'], ['unsafe', 'a/b./c'], ['unsafe', './a'], ['unsafe', 'lpt¹'], ['unsafe', ''],
    ['safeJoin', '@/out', 'a/b'], ['safeJoin', '@/out', '../c'], ['safeJoin', '@/out', 'a/../../c'], ['safeJoin', '@/out', ''],
    ['zip', '@/in/mod.zip'], ['zip', '@/in/evil.zip'], ['zip', '@/in/bomb.zip'], ['zip', '@/in/bomb.zip', { ratio: 100000 }], ['zip', '@/in/damaged.zip'],
    ['zip', '@/in/mod.zip', { entries: 2 }], ['zip', '@/in/mod.zip', { totalBytes: 10 }], ['zip', '@/in/mod.zip', { archiveBytes: 10 }],
    ['space', '@/game/nowhere/deeper', 100, 1e12], ['space', '@/game', 100, 10], ['space', '@/game', 100, null],
    ['fileUrl', 'mods', 'Red Abaddon (v2).zip'], ['fileUrl', 'mods', 'https://x.example/a.zip'], ['fileUrl', 'mods', 'HTTP://x/y'], ['fileUrl', 'a b', 'ж/ё?#.zip'],
    ['remember', 'mods/Red Abaddon (v2).zip', { size: 6, sha256: 'ab', at: 1 }], ['remember', 'mods/x.zip', { size: 1, sha256: 'cd', at: 2 }], ['index'], ['listCache'], ['cacheSize'],
    ['cachedArchive', 'mods', 'Red Abaddon (v2).zip'], ['cachedArchive', 'mods', 'missing.zip'], ['cachedArchive', null, 'x'], ['cachedArchive', 'fonts', 'font.zip'],
    as('mod', ['install', 'heroes', 'Juggernaut', '@/in/mod.zip']), as('single', ['install', 'trees', 'Priority', '@/in/single.vpk']), ['install', 'heroes', 'Note', '@/in/note.txt'],
    ['install', 'heroes', 'Bad', '@/in/damaged.zip'], ['install', 'heroes', 'Evil', '@/in/evil.zip'],
    as('font', ['install', 'fonts', 'Font', '@/in/font.zip']), ['written'], ['installFonts', '@/in/font.zip', 'Font'], ['installFonts', '@/in/nofont.zip', 'No font'], ['fontHashes'],
    as('cursor', ['install', 'cursors', 'Cur', '@/in/cursor.zip']), ['installCursor', '@/in/nofont.zip', 'No cursor'],
    (ans) => ['ensureStore', 'c1', got(ans, 'cursor')],
    (ans) => ['undeployCursor', 'c1', got(ans, 'cursor')],
    (ans) => ['lost', [{ files: got(ans, 'cursor') }, { files: got(ans, 'cursor'), enabled: false }, { files: [lang('pak01_dir.vpk')] }, { files: got(ans, 'font') }]],
    (ans) => ['deployCursor', 'c1', got(ans, 'cursor')],
    (ans) => ['cursorZip', 'c1', 'My/Cur', got(ans, 'cursor')],
    ['written'],
    as('tool', ['install', 'tools', 'My:Tool', '@/in/tool.zip']), ['installTool', '@/in/single.vpk', 'Loose'],
    as('schema', ['install', 'heroes', 'Schema', '@/in/schema.vpk']),
    (ans) => ['harvest', got(ans, 'schema'), '@/in/vanilla.txt'],
    as('schema2', ['install', 'heroes', 'Schema again', '@/in/schema.vpk']),
    (ans) => ['harvest', got(ans, 'schema2'), null],
    (ans) => ['setEnabled', got(ans, 'mod'), false, null], (ans) => ['setEnabled', got(ans, 'mod'), true, null], (ans) => ['setEnabled', got(ans, 'mod'), false, null],
    (ans) => ['analyze', got(ans, 'mod')], (ans) => ['installedSize', got(ans, 'mod')], (ans) => ['merge', got(ans, 'mod'), null],
    (ans) => ['merge', got(ans, 'mod'), [{ block: '"4100"\n{\n\t"name"\t"xé"\n}' }]], (ans) => ['unpack', got(ans, 'mod'), '@/out/unpacked'],
    (ans) => ['displayName', first(ans, 'mod')], ['displayName', 'nope_dir.vpk'],
    (ans) => ['split', first(ans, 'single')], ['split', 'pak01_dir.vpk'],
    ['analyze', [lang('pak20_dir.vpk')]], ['mergeMulti'], ['mergeMulti'],
    ['addMember', 'p1', 0, 'm1'],
    as('pack', ['deployPack', { id: 'p1', files: [], members: [{ id: 'm1', enabled: true }, { id: 'm9', enabled: false }] }]),
    (ans) => ['deployPack', { id: 'p1', files: (got(ans, 'pack') as { files: unknown }).files, members: [{ id: 'm1', enabled: true }] }],
    ['deployPack', { id: 'p1', files: [lang('pak90_dir.vpk')], members: [] }],
    ['deployMember', 'p1', 'm1'], ['deployMember', 'p1', 'nope'],
    (ans) => ['removePackFully', { id: 'p1', files: (got(ans, 'pack') as { files: unknown }).files }],
    as('icons', ['install', 'heroes', 'Icons', '@/in/icons.zip']), (ans) => ['dropIcons', got(ans, 'icons')], (ans) => ['dropIcons', got(ans, 'icons')],
    (ans) => ['remove', got(ans, 'font'), null, true],
    (ans) => ['restore', { id: 'f', name: 'Font', categoryId: 'fonts', fileRef: 'font.zip', files: got(ans, 'font') }],
    (ans) => ['remove', got(ans, 'cursor'), 'c1', false], (ans) => ['remove', got(ans, 'cursor'), 'c1', true],
    (ans) => ['remove', got(ans, 'tool'), null, true], (ans) => ['remove', got(ans, 'mod'), null, true],
    ['importPaths', ['@/imp/set/pak01_dir.vpk', '@/imp/set/pak01_000.vpk', '@/imp/set/loose.vpk', '@/imp/set/readme.txt', '@/imp/orphan/foo_000.vpk', '@/imp/tree', '@/imp/author/My  Mod!', '@/imp/empty', '@/imp/pack.zip', '@/imp/novpk.zip', '@/in/damaged.zip']],
    ['importBuffers', [['a.vpk', '@/imp/set/loose.vpk'], ['b.txt', '@/imp/set/readme.txt'], ['c.zip', '@/imp/pack.zip']]],
    ['installBuffer', '@/imp/set/loose.vpk'], ['installBuffer', '@/imp/set/readme.txt'],
    ['fpHas'], ['fpMatch', 'aa'], ['fpStore', JSON.stringify({ mods: { aa: { name: 'Old import', categoryId: 'heroes' }, bb: [{ name: 'Jugg', categoryId: 'heroes', styleLabel: 'Red' }, { name: 'Jugg RU', categoryId: 'heroes' }], cc: { name: 'Jugg', categoryId: 'heroes', styleLabel: 'Red' } }, fonts: [{ name: 'My font', categoryId: 'fonts', files: { 'radiance.otf': '8034c43d15bb7ef42e2cc24255217acfc5f4b2f4' } }, { name: 'Other', categoryId: 'fonts', files: { 'x.otf': 'zz' } }] })], ['fpHas'], ['fpMatch', 'aa'], ['fpMatch', 'bb'], ['fpMatch', null], ['fpMatch', 'zz'],
    ['fpPrints', 'heroes', 'Jugg', 'Red'], ['fpPrints', 'heroes', 'Jugg', null], ['fpPrints', 'heroes', 'Old import', ''], ['fpFonts'], ['fpStore', 'not json'],
    ['updatable', { fileRef: 'a.zip', categoryId: 'heroes' }], ['updatable', { fileRef: 'a.zip', categoryId: 'fonts' }], ['updatable', { fileRef: '', categoryId: 'heroes' }], ['updatable', { fileRef: 'a', kind: 'pack', categoryId: 'x' }],
    ['behind', { fileRef: 'a.zip', categoryId: 'heroes', name: 'Jugg', styleLabel: 'Red' }, 'bb'], ['behind', { fileRef: 'a.zip', categoryId: 'heroes', name: 'Jugg', styleLabel: 'Red' }, 'xx'],
    ['behind', { fileRef: 'a.zip', categoryId: 'heroes', name: 'Jugg', styleLabel: 'Red', fpOriginal: 'cc' }, 'xx'], ['behind', { fileRef: 'a.zip', categoryId: 'heroes', name: 'Nobody' }, 'xx'], ['behind', { fileRef: 'a.zip', categoryId: 'heroes', name: 'Jugg' }, null],
    ['updateMod', 0, '@/in/single.vpk'], ['libList'],
    ['ring', '', true], ['ring', 'bind x y\r\n', true], ['ring', 'a\n// Dota 2 Mod Manager: emblems show on the selection ring\nr_draw_selected_ring 1\n\n', false], ['ring', 'r_draw_selected_ring "1" // mine\n', true], ['ring', '', false],
    ['keepRing', false], ['keepRing', true], ['keepRing', true], ['keepRing', false],
    ['removeCached', 'mods/Red Abaddon (v2).zip'], ['removeCached', '../lib/manifest.json'], ['index'], ['clearCache'], ['listCache'], ['libList'],
  ];
  const ops: unknown[][] = [];
  const want: unknown[] = [];
  try {
    for (const s of steps) {
      const op = typeof s === 'function' ? s(want.map((w) => (w as { ok?: unknown }).ok)) : s;
      ops.push(op);
      // a step edits what it is handed in place, as harvestSchema does: it gets its own copy
      try { want.push({ ok: JSON.parse(JSON.stringify((await run(structuredClone(op))) ?? null)) }); } catch { want.push({ error: true }); }
    }
  } finally { FileTx.journalDir = null; }
  const list = path.join(tmp, 'write.json');
  fs.writeFileSync(list, JSON.stringify([['installer.script', b, path.join(b, 'game'), 'russian', path.join(b, 'journal'), path.join(b, 'ud'), path.join(b, 'lib'), ops]]));
  const [rs] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  (rs.ok as { ok?: unknown; error?: unknown }[]).forEach((g, k) => {
    assert.deepEqual('error' in g ? { error: true } : g, want[k], `${k} ${JSON.stringify(ops[k]).slice(0, 200)}`);
  });
  const tree = (g: string): string[] => (fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .map((d) => { const p = path.join(d.parentPath, d.name); return path.relative(g, p) + (d.isFile() ? ` ${sha1(fs.readFileSync(p))}` : '/'); }).sort();
  assert.deepEqual(tree(b).filter((l) => !l.startsWith('write.json')), tree(a));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the patch in Rust goes in, signs, comes out and backs up as the TypeScript one does', { skip }, async (t) => {
  const patcher = await import('../src/patcher.ts');
  const sg = await import('../src/patcher-signatures.ts');
  const src = [sandboxGame, path.dirname(path.dirname(GAME_PAK01))].find((g) => fs.existsSync(path.join(g, 'dota', 'gameinfo.gi')) && fs.existsSync(path.join(g, 'dota', 'gameinfo_branchspecific.gi')));
  if (!src) { t.skip('no gameinfo files (npm run sandbox:seed)'); return; }
  const gameinfo = fs.readFileSync(path.join(src, 'dota', 'gameinfo.gi'));
  const branch = fs.readFileSync(path.join(src, 'dota', 'gameinfo_branchspecific.gi'));
  const bin = process.platform === 'linux' ? ['bin', 'linuxsteamrt64'] : ['bin', 'win64'];
  // a list shaped like Valve's: their entry for the file before DIGEST, nothing after it
  const sigs = `...\\..\\..\\bin\\win64\\dota2.exe~SHA1:${'A'.repeat(40)};CRC:01234567\r\n${sg.signatureLine(branch)}\r\nDIGEST:ABCDEF\r\n`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-patch-'));
  const twin = (side: string) => {
    const g = path.join(tmp, side, 'game');
    fs.mkdirSync(path.join(g, 'dota'), { recursive: true });
    fs.mkdirSync(path.join(g, ...bin), { recursive: true });
    fs.writeFileSync(path.join(g, 'dota', 'gameinfo.gi'), gameinfo);
    fs.writeFileSync(path.join(g, 'dota', 'gameinfo_branchspecific.gi'), branch);
    fs.writeFileSync(path.join(g, ...bin, 'dota.signatures'), sigs);
    return { game: g, backups: path.join(tmp, side, 'backups') };
  };
  const a = twin('ts');
  const b = twin('rs');
  // steps between the script's pieces: what Steam, an update or another patcher does to the files
  const touch: Record<number, (g: string) => void> = {
    3: (g) => fs.appendFileSync(path.join(g, 'dota', 'gameinfo_branchspecific.gi'), '\n\t\t\tGame\tDota2SkinChanger\n'),
    6: (g) => fs.writeFileSync(path.join(g, 'dota', 'gameinfo_branchspecific.gi'), branch),
    8: (g) => fs.writeFileSync(path.join(g, 'dota_mods', 'x.txt'), 'x'),
    11: (g) => fs.rmSync(path.join(g, ...bin, 'dota.signatures')),
    15: (g) => fs.rmSync(path.join(g, 'dota', 'gameinfo.gi')),
  };
  const ops: unknown[][] = [
    ['state', null], ['apply', 'dota_mods'], ['state', 'dota_mods'], ['apply', 'dota_mods'], ['state', 'dota_mods'], ['revert', 'dota_mods'],
    ['state', null], ['apply', 'dota_mods'], ['revert', 'dota_mods'], ['state', 'dota_mods'], ['apply', 'my mods'], ['state', 'my mods'],
    ['apply', 'my mods'], ['revert', 'my mods'], ['state', null], ['apply', 'dota_mods'], ['revert', null],
  ];
  const tsRun = (op: unknown[]) => {
    const folder = op[1] as string | null;
    if (op[0] === 'state') return patcher.state(a.game, folder);
    if (op[0] === 'apply') return patcher.apply({ gamePath: a.game, folder: folder as string, backupDir: a.backups });
    return patcher.revert({ gamePath: a.game, folder, backupDir: a.backups });
  };
  const tree = (r: string): string[] => (fs.readdirSync(r, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .map((d) => { const p = path.join(d.parentPath, d.name); return path.relative(r, p) + (d.isFile() ? ` ${fs.readFileSync(p).toString('base64')}` : '/'); }).sort();
  ops.forEach((op, k) => {
    for (const side of [a, b]) touch[k]?.(side.game);
    let want: unknown;
    try { want = { ok: JSON.parse(JSON.stringify(tsRun(op))) }; } catch { want = { error: true }; }
    const list = path.join(tmp, 'patch.json');
    fs.writeFileSync(list, JSON.stringify([['patcher.script', b.game, b.backups, [op]]]));
    const [rs] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' }));
    fs.rmSync(list);
    const got = (rs.ok as { ok?: unknown; error?: unknown }[])[0];
    assert.deepEqual('error' in got ? { error: true } : got, want, `${k} ${JSON.stringify(op)}`);
    assert.deepEqual(tree(path.join(tmp, 'rs')), tree(path.join(tmp, 'ts')), `${k} ${JSON.stringify(op)}: the files`);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the listing in Rust, and the terrain ages, update impact, notice text and scream guard behind it, match the TypeScript', { skip }, async () => {
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const { Fingerprints } = await import('../src/fingerprints.ts');
  const ta = await import('../src/terrain-age.ts');
  const ui = await import('../src/update-impact.ts');
  const nt = await import('../src/notice-text.ts');
  const { createScreamGuard } = await import('../src/scream-guard.ts');
  const { createModsListing } = await import('../src/mods-listing.ts');
  const { listVpkPathsFile } = await import('../src/vpk-read.ts');
  const { buildVpk, entryAt } = await import('../src/vpk-write.ts');
  const { fingerprintVpk } = await import('../src/vpk-fingerprint.ts');
  const AdmZip = (await import('adm-zip')).default;
  const crypto = await import('node:crypto');
  const sha1 = (b: Buffer) => crypto.createHash('sha1').update(b).digest('hex');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-svc-'));
  const pak = (files: Record<string, string | Buffer>) => buildVpk(Object.entries(files).map(([p, d]) => entryAt(p, Buffer.from(d))));
  // a zip whose entries carry the dates given, as a packer's clock wrote them
  const zip = (files: Record<string, [string | Buffer, Date]>) => {
    const z = new AdmZip();
    for (const [n, [d, when]] of Object.entries(files)) { z.addFile(n, Buffer.from(d)); z.getEntries().at(-1)!.header.time = when; }
    return z.toBuffer();
  };
  const chat = ['"lang"', '{', '\t"Language"\t"russian"', '\t"Tokens"', '\t{', '\t\t"chat_hi"\t"Привет { }"', '\t\t"DOTA_VAC_Verification_Header"\t"old"', '\t}', '}', ''].join('\r\n');
  const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);
  const valve = { 'resource/localization/chat_russian.txt': chat, 'models/a.vmdl_c': 'v1', 'models/b.vmdl_c': 'v1', 'models/gone.vmdl_c': 'g' };
  const modA = { 'models/a.vmdl_c': 'mine', 'models/b.vmdl_c': 'mine', 'models/gone.vmdl_c': 'mine', 'models/new.vmdl_c': 'mine' };
  const rec = (id: string, name: string, categoryId: string, relPaths: string[], extra: Record<string, unknown> = {}) =>
    ({ id, name, categoryId, enabled: true, files: relPaths.map((relPath) => ({ root: 'lang', relPath })), ...extra });
  const inputs: Record<string, string | Buffer> = {
    'game/dota/pak01_dir.vpk': pak(valve), 'game/dota/maps/dota.vpk': 'valve map',
    // build 6946: one of the mod's files changed, one gone, one shipped new
    'in/pak01_6946.vpk': pak({ ...Object.fromEntries(Object.entries(valve).filter(([k]) => k !== 'models/gone.vmdl_c')), 'models/a.vmdl_c': 'v2', 'models/new.vmdl_c': 'n' }),
    'in/pak01_6950.vpk': pak({ ...valve, 'models/b.vmdl_c': 'v3' }),
    'game/dota/cfg/boot.vcfg': '"config"\n{\n\t"UILanguage"\t\t"russian"\n}\n',
    'game/dota_russian/gameinfo.gi': 'gi',
    'game/dota_russian/pak02_dir.vpk': pak(modA),
    'game/dota_russian/maps/dota.vpk': 'old map',
    'game/dota_russian/pak04_dir.vpk': pak({ 'materials/scream_fx/a.vmat_c': 's' }),
    'game/dota_russian/pak05_dir.vpk': pak({ 'models/heroes/juggernaut/juggernaut.vmdl_c': 'j', 'materials/models/heroes/juggernaut/j.vmat_c': 'jm' }),
    'game/dota_russian/pak06_dir.vpk': pak({ 'models/foreign.vmdl_c': 'f' }),
    'game/dota_russian/pak07_dir.vpk': pak(modA),
    'game/dota_russian/pak08_dir.vpk': pak({ 'materials/emblem/e.vmat_c': 'e' }),
    'ud/downloads/terrains/old.zip': zip({ 'T/readme.txt': ['r', day(2026, 9, 1)], 'T/maps/dota.vpk': ['m', day(2026, 8, 19)] }),
    'in/new.zip': zip({ 'maps\\dota.vpk': ['m', day(2026, 9, 20)] }),
    'in/nomap.zip': zip({ 'x.txt': ['x', day(2026, 9, 20)] }),
    'in/notzip.bin': 'not a zip',
    'lib/manifest.json': JSON.stringify({ installed: [
      rec('ma', 'Mod A', 'heroes', ['pak02_dir.vpk'], { fileRef: 'a.zip' }),
      { ...rec('tr', 'Dota+ Autumn', 'terrains', ['maps/dota.vpk'], { fileRef: 'old.zip' }) },
      rec('sc', 'Scream', 'heroes', ['pak04_dir.vpk']),
      rec('im', 'pak05', 'imported', ['pak05_dir.vpk'], { schema: [{ id: '1' }, { id: '2' }] }),
      rec('em', 'Emblem', 'emblems', ['pak08_dir.vpk']),
      rec('gone', 'Deleted by hand', 'heroes', ['pak30_dir.vpk']),
    ], presets: [] }),
  };
  const twin = (side: string) => {
    const r = path.join(tmp, side);
    for (const [f, d] of Object.entries(inputs)) {
      fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
      fs.writeFileSync(path.join(r, f), d);
    }
    return r;
  };
  const a = twin('ts');
  const b = twin('rs');
  const at = (p: unknown) => (String(p).startsWith('@/') ? path.join(a, ...String(p).slice(2).split('/')) : String(p));
  FileTx.journalDir = path.join(a, 'journal');
  const game = path.join(a, 'game');
  const inst = new Installer({ userDataDir: path.join(a, 'ud'), getGamePath: () => game, getLangSuffix: () => 'russian' });
  const lib = new Library(path.join(a, 'lib'));
  const fp = new Fingerprints(path.join(a, 'ud'));
  let tails: Record<string, string | null> = {};
  const terrain = ta.createTerrainAges({
    downloadsDir: inst.downloadsDir, gamePath: () => game, storeFile: path.join(a, 'ud', 'terrain-ages.json'),
    fetchTail: async (_c, f) => { const t = tails[f]; if (typeof t !== 'string') throw new Error('offline'); return fs.readFileSync(at(t)); },
  });
  let build: string | null = null;
  const mods = () => ui.impactMods(lib.list(), (r) => inst.langFileOnDisk(r));
  const impact = ui.createUpdateImpact({ file: path.join(a, 'ud', 'update-impact.json'), gamePath: () => game, mods, build: () => build });
  const notice = nt.createNoticeText({ gamePath: () => game, langDir: () => inst.langFolder(), diag: () => {} });
  const guardFor = (key: unknown) => createScreamGuard({
    library: lib, settings: { get: () => key },
    pathsOf: (r) => {
      const dir = (r.files || []).find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
      if (!dir) return [];
      try { return listVpkPathsFile(inst.langFileOnDisk(dir.relPath)); } catch { return null; }
    },
    switchOff: (r) => { inst.setEnabled(r.files, false, r.id); lib.setEnabled(r.id, false); },
  });
  const run = async (op: unknown[]): Promise<unknown> => {
    switch (op[0]) {
      case 'copy': fs.copyFileSync(at(op[1]), at(op[2])); return null;
      case 'setMtime': { const when = new Date(op[2] as number); fs.utimesSync(at(op[1]), when, when); return null; }
      case 'zipTime': return ta.mapTimeInArchive(at(op[1]));
      case 'zipTimeBytes': return ta.mapTimeInZip(fs.readFileSync(at(op[1])));
      case 'stale': return ta.isStale(op[1], op[2]);
      case 'ages': return Object.fromEntries(terrain.forRecords(lib.list()));
      case 'terrainOff': { const off: string[] = []; const names = terrain.switchOffStale(lib.list(), (r) => off.push(r.id)); return { names, off }; }
      case 'terrainCatalog': {
        const hashes = op[2] as Record<string, string>;
        tails = op[3] as Record<string, string | null>;
        return terrain.forCatalog(op[1] as never, (f) => hashes[f] || null);
      }
      case 'scream': return guardFor(op[1])();
      case 'impactCheck': build = op[1] as string; return impact.check();
      case 'impactMarked': return Object.fromEntries(impact.marked());
      case 'impactClear': return impact.clear(op[1] as string);
      case 'uiLang': return nt.uiLanguage(game);
      case 'declared': return nt.declaredLanguage(op[1] as string);
      case 'withTokens': return nt.withTokens(op[1] as string, op[2] as Record<string, string>);
      case 'noticePlan': {
        const p = nt.plan({ gamePath: game, langDir: inst.langFolder() });
        return p.action === 'write' ? { action: p.action, sha1: sha1(p.bytes), language: p.language } : p;
      }
      case 'noticeApply': return nt.applyNotice({ gamePath: game, langDir: inst.langFolder() });
      case 'noticeRefresh': return notice.refresh();
      case 'noticeOwned': return notice.ownedFiles();
      case 'fpStore': { fp.apply(JSON.parse(op[1] as string)); fs.writeFileSync(fp.file, op[1] as string); return null; }
      case 'libList': return lib.list();
      case 'listMods': {
        const listing = createModsListing({
          installer: inst, library: lib, fingerprints: fp, schemaService: { state: () => ({ enabled: false }) } as never,
          diag: () => {}, refreshPresence: () => {}, verifyStuck: () => false, updateImpact: impact, terrainAges: terrain,
          notice: { ownedFiles: () => notice.ownedFiles(), refresh: () => null } as never, guard: guardFor(op[1]),
        } as never);
        const out = listing();
        await new Promise((r) => setImmediate(r));
        return out;
      }
    }
    throw new Error(`no step ${op[0]}`);
  };
  // the map Valve shipped on 3 September, and the mods' own files on fixed dates
  const ms = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 10, 0, 0);
  const steps: unknown[][] = [
    ['setMtime', '@/game/dota/maps/dota.vpk', ms(2026, 9, 3)], ['setMtime', '@/game/dota/pak01_dir.vpk', ms(2026, 9, 3)],
    ...['02', '04', '05', '06', '07', '08'].map((n) => ['setMtime', `@/game/dota_russian/pak${n}_dir.vpk`, ms(2026, 9, 1)]),
    ['zipTime', '@/ud/downloads/terrains/old.zip'], ['zipTime', '@/in/new.zip'], ['zipTime', '@/in/nomap.zip'], ['zipTime', '@/in/notzip.bin'], ['zipTime', '@/in/missing.zip'],
    ['zipTimeBytes', '@/ud/downloads/terrains/old.zip'],
    ['stale', ms(2026, 8, 19), ms(2026, 9, 3)], ['stale', ms(2026, 9, 3), ms(2026, 9, 3)], ['stale', ms(2026, 9, 2) + 1, ms(2026, 9, 3)], ['stale', null, ms(2026, 9, 3)], ['stale', 5, 'x'],
    ['ages'], ['terrainOff'], ['terrainOff'], ['libList'],
    ['terrainCatalog', [{ file: 'old.zip' }, { file: 'new.zip' }, { file: 'nomap.zip' }, { file: 'x.txt' }, null, {}], { 'old.zip': 'h1' }, { 'old.zip': '@/ud/downloads/terrains/old.zip', 'new.zip': '@/in/new.zip', 'nomap.zip': '@/in/nomap.zip' }],
    ['terrainCatalog', [{ file: 'old.zip' }, { file: 'new.zip' }], { 'old.zip': 'h1' }, {}],
    ['terrainCatalog', [{ file: 'old.zip' }], { 'old.zip': 'h2' }, {}],
    ['impactMarked'], ['impactCheck', '6900'], ['impactCheck', '6900'], ['impactMarked'],
    ['copy', '@/in/pak01_6946.vpk', '@/game/dota/pak01_dir.vpk'], ['setMtime', '@/game/dota/pak01_dir.vpk', ms(2026, 10, 7)], ['impactCheck', '6946'], ['impactMarked'], ['impactCheck', '6946'],
    ['impactClear', 'ma'], ['impactClear', 'ma'], ['impactMarked'], ['setMtime', '@/game/dota_russian/pak02_dir.vpk', ms(2026, 10, 8)], ['impactMarked'],
    ['copy', '@/in/pak01_6950.vpk', '@/game/dota/pak01_dir.vpk'], ['setMtime', '@/game/dota/pak01_dir.vpk', ms(2026, 10, 9)], ['impactCheck', '6950'], ['impactMarked'],
    ['uiLang'], ['declared', '"lang"\n{\n\t"Language"\t"Dutch"\n'], ['declared', 'no header'], ['declared', `${' '.repeat(600)}"Language" "x"`],
    ['withTokens', chat, { DOTA_VAC_Verification_Header: 'new', K2: 'two' }], ['withTokens', '"lang" { "Tokens" { "a" "}" // }\n } }', { K: 'v' }],
    ['withTokens', 'no block', { K: 'v' }], ['withTokens', '"lang"\n{\n"Tokens"\n{\n"a"\t"b"}\n}\n', { K: 'v' }],
    ['noticePlan'], ['noticeApply'], ['noticeApply'], ['noticeOwned'], ['noticeRefresh'], ['noticeRefresh'],
    ['scream', ''], ['libList'], ['scream', 'key'], ['libList'],
    // the foreign pak is a catalog mod, and the imported one is too
    ['fpStore', JSON.stringify({ mods: {
      [fingerprintVpk(inputs['game/dota_russian/pak06_dir.vpk'] as Buffer)]: [{ name: 'Foreign HUD', categoryId: 'hud' }],
      [fingerprintVpk(inputs['game/dota_russian/pak02_dir.vpk'] as Buffer)]: { name: 'Mod A', categoryId: 'heroes' },
      other: { name: 'Mod A', categoryId: 'heroes' },
    } })],
    ['listMods', ''], ['libList'],
  ];
  const ops: unknown[][] = [];
  const want: unknown[] = [];
  try {
    for (const op of steps) {
      ops.push(op);
      try { want.push({ ok: JSON.parse(JSON.stringify((await run(structuredClone(op))) ?? null)) }); } catch { want.push({ error: true }); }
    }
  } finally { FileTx.journalDir = null; }
  const list = path.join(tmp, 'svc.json');
  fs.writeFileSync(list, JSON.stringify([['services.script', b, path.join(b, 'game'), 'russian', path.join(b, 'journal'), path.join(b, 'ud'), path.join(b, 'lib'), ops]]));
  const [rs] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  // the side's own folder appears in a few answers
  const same = (v: unknown) => JSON.parse(JSON.stringify(v).replaceAll(JSON.stringify(b).slice(1, -1), JSON.stringify(a).slice(1, -1)));
  (rs.ok as { ok?: unknown; error?: unknown }[]).forEach((g, k) => {
    assert.deepEqual('error' in g ? { error: true } : same(g), want[k], `${k} ${JSON.stringify(ops[k]).slice(0, 200)}`);
  });
  // the ownership note carries the time it was written
  const tree = (g: string): string[] => (fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .map((d) => {
      const p = path.join(d.parentPath, d.name);
      if (!d.isFile()) return `${path.relative(g, p)}/`;
      let body = fs.readFileSync(p);
      if (d.name === 'dota2modmanager.json') { const j = JSON.parse(body.toString()); delete j.updated; body = Buffer.from(JSON.stringify(j)); }
      return `${path.relative(g, p)} ${sha1(body)}`;
    }).sort();
  assert.deepEqual(tree(b).filter((l) => !l.startsWith('svc.json')), tree(a));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the item table built in Rust is the one the TypeScript builds: picks, bases, personas, shared files', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01) || !fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no game or no sandbox'); return; }
  const { createTableBuild } = await import('../src/schema-build.ts');
  const { MeshoptDecoder } = await import('meshoptimizer');
  // the app decodes long after the import; here the decoder is waited for, or the TypeScript reads no vertices
  await MeshoptDecoder.ready;
  const { itemFilesSteps } = await import('../src/item-files.ts');
  const { drain } = await import('../src/steps.ts');
  const { openVpkIndex, entryAt, entryPath } = await import('../src/vpk.ts');
  const sl = await import('../src/item-builder-slots.ts');
  const ps = await import('../src/item-builder-personas.ts');
  const kin = await import('../src/item-builder-kinetic.ts');
  const { ITEM_EFFECTS } = await import('../src/item-builder-effects.ts');
  const { ARCANA_BASES, TERRORBLADE_BASE } = await import('../src/arcana-bases.ts');
  const { cosmeticOptions } = await import('../src/schema-items.ts');
  const { createHash } = await import('node:crypto');
  const sha = (f: Buffer) => createHash('sha1').update(f).digest('hex');
  const { file } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const game = path.dirname(path.dirname(GAME_PAK01));
  const index = openVpkIndex(GAME_PAK01);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-table-'));
  const spread = <T,>(a: T[], k: number) => a.filter((_, j) => j % Math.max(1, Math.floor(a.length / k)) === 0).slice(0, k);
  const slots = sl.itemSlots(text);
  const own = ITEM_EFFECTS.map((e) => e.id);
  const gems = [...kin.kineticGems(text).keys()];
  let n = 0;
  const rec = (slot: string, itemId: string, extra: object = {}) => ({ id: `r${n}`, name: `pick ${n++}`, categoryId: 'cosmetic', files: [], slot, itemId, ...extra });
  const plain = slots.filter((s) => !s.persona && !s.abilityFx && s.options.length);
  const effectsOf = (k: number) => [[], [own[k % own.length]], ['style-1'], [`kinetic-${gems[k % gems.length]}`], `${own[(k + 1) % own.length]},style-2`][k % 5];
  const picks = spread(plain, 24).map((s, k) => rec(s.slot, s.options[k % s.options.length].id, { effectId: effectsOf(k) }));
  const fx = slots.filter((s) => s.abilityFx && s.options.length);
  const fxName = fx[0]?.slot.split(':').pop();
  const fxPicks = fx.filter((s) => s.slot.endsWith(`:${fxName}`)).slice(0, 3).map((s, k) => rec(s.slot, s.options[k % s.options.length].id));
  const persona = ps.PERSONA_BASES[0];
  const mine = ps.personaSlots(text).filter((s) => s.slot.startsWith(`item:${persona.hero}:`) || s.heroIds.includes(`npc_dota_hero_${persona.hero}`));
  const selector = mine.find((s) => ps.isSelectorSlot(s.slot));
  const personaPicks = selector ? [rec(selector.slot, persona.item), ...mine.filter((s) => !ps.isSelectorSlot(s.slot)).slice(0, 2).map((s) => rec(s.slot, s.options[0]?.id ?? '1'))] : [];
  const theirs = plain.filter((s) => s.heroIds.includes(`npc_dota_hero_${persona.hero}`)).slice(0, 1).map((s) => rec(s.slot, s.options[0].id));
  const looks = ['courier', 'ward', 'multikill_banner', 'weather'].flatMap((slot) => cosmeticOptions(text, slot).slice(1, 2).map((o) => rec(slot, o.id)));
  // the arcana bases' picks: some held, some not here yet
  const bases = ARCANA_BASES.filter((b, k) => k % 2 === 0 || b.id === TERRORBLADE_BASE);
  const basePicks = bases.map((b) => rec(`item:${b.hero}:base`, b.item, b.styles ? { effectId: [`style-${b.styles[0]}`] } : {}));
  const put = (p: string) => {
    const data = index.read(p);
    if (!data) return null;
    const f = path.join(tmp, `${n++}.bin`);
    fs.writeFileSync(f, data);
    return [p, { $file: f }] as [string, { $file: string }];
  };
  const store: Record<string, [string, { $file: string }][] | null> = {};
  for (const [k, b] of bases.entries()) {
    if (k % 3 === 2) { store[b.id] = null; continue; }
    const theirFiles = [...index.paths()].filter((p) => p.startsWith(`particles/econ/items/${b.hero}/`) || p.startsWith(`materials/models/heroes/${b.hero}/`)).filter((_, j) => j % 41 === 0).slice(0, 4);
    store[b.id] = [`models/heroes/${b.hero}/${b.hero}.vmdl_c`, ...theirFiles].map(put).filter((e) => e !== null);
  }
  const mod = { id: 'mod', name: 'a mod', categoryId: 'model', files: [], schema: [{ id: picks[0].itemId, block: '"x"\r\n{\r\n}' }, { id: '999999', block: '"y" {}' }] };
  const off = { ...rec(plain[1].slot, plain[1].options[0].id), enabled: false };
  const arcanaWindow = { id: 'tb', name: 'arcana window', categoryId: 'model', files: [], generated: { set: 'terrorblade-arcana', color: [255, 40, 40] } };
  const everything = [...picks, ...fxPicks, ...personaPicks, ...theirs, ...looks, ...basePicks, mod, off, arcanaWindow];
  const steps = [
    { records: everything, bases: store, files: true },
    { records: everything, bases: store },
    { records: [...picks.slice(3), ...looks, ...basePicks, { ...arcanaWindow, generated: { set: 'terrorblade-arcana', color: [20, 200, 255] } }], bases: store, files: true },
    { records: everything, bases: {}, forget: true },
    { records: [...personaPicks, ...theirs], bases: store },
  ];
  // one build for every step, as the app keeps one: the store and the library read the step's
  let cur: object[] = [];
  let held: Record<string, ReturnType<typeof entryAt>[] | null> = {};
  let log: string[] = [];
  let wanted: string[] = [];
  const tb = createTableBuild({
    library: { list: () => cur as never },
    bases: { entries: (id: string) => held[id] ?? null, want: async (id: string) => { wanted.push(id); return true; } },
    log: (m) => log.push(m),
  });
  const files = (es: ReturnType<typeof entryAt>[]) => es.map((e) => [entryPath(e), sha(e.data)]);
  const ts = steps.map((st) => {
    cur = st.records; log = []; wanted = [];
    held = Object.fromEntries(Object.entries(st.bases).map(([id, es]) => [id, es && es.map(([p, f]) => entryAt(p, fs.readFileSync(f.$file)))]));
    if (st.forget) tb.forget();
    const progress: number[][] = [];
    try {
      const g = tb.buildSteps(text, game);
      let r = g.next();
      while (!r.done) {
        const v = r.value as { done?: number; total?: number };
        if (v && typeof v === 'object' && 'done' in v) progress.push([v.done!, v.total!]);
        r = g.next();
      }
      const b = r.value;
      let itemFiles: unknown = null;
      if ((st as { files?: boolean }).files) {
        try {
          const f = drain(itemFilesSteps(b.list, b.beneath, game, b.filesShared));
          itemFiles = { entries: files(f.entries), left: f.left };
        } catch (e) { itemFiles = { error: (e as Error).message }; }
      }
      return JSON.parse(JSON.stringify({
        itemFiles,
        list: b.list.map((p) => ({ id: p.id, block: p.block, source: p.source, own: p.own ?? null, added: p.added ?? null, unplaced: p.unplaced ?? null, item: p.item ?? null, assets: p.assets ? files(p.assets) : null })),
        beneath: files(b.beneath), shared: { paths: b.filesShared.paths, entries: files(b.filesShared.entries) }, progress, log, wanted,
      }));
    } catch (e) { return { error: (e as Error).message, progress, log, wanted }; }
  });
  fs.writeFileSync(path.join(tmp, 'list.json'), JSON.stringify([['schema-build.script', game, { $file: file }, steps]]));
  const [rs] = JSON.parse(execFileSync(cli, ['call', path.join(tmp, 'list.json')], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  try {
    assert.ok(rs.ok, rs.error);
    for (const [k, want] of ts.entries()) {
      const got = rs.ok[k];
      if ('error' in want) { assert.ok(got.error, `step ${k}: TypeScript throws ${want.error}`); continue; }
      assert.deepEqual(got.log, want.log, `step ${k} log`);
      assert.deepEqual(got.progress, want.progress, `step ${k} progress`);
      assert.deepEqual(got.wanted, want.wanted, `step ${k} wanted`);
      const ids = (l: { id: string; source: string }[]) => l.map((p) => `${p.id} ${p.source}`);
      assert.deepEqual(ids(got.list), ids(want.list), `step ${k} patches`);
      for (const [j, p] of want.list.entries()) assert.deepEqual(got.list[j], p, `step ${k} patch ${j} (${p.source})`);
      assert.deepEqual(got.beneath, want.beneath, `step ${k} beneath`);
      assert.deepEqual(got.shared, want.shared, `step ${k} shared files`);
      if (want.itemFiles?.error) assert.ok(got.itemFiles?.error, `step ${k}: item files throw ${want.itemFiles.error}`);
      else {
        assert.deepEqual(got.itemFiles?.left, want.itemFiles?.left, `step ${k} item files left`);
        assert.deepEqual(got.itemFiles?.entries, want.itemFiles?.entries, `step ${k} item files`);
      }
    }
    // the build did something worth comparing: picks with files, a second build from what was kept
    // (only the picks the builder refused are tried again), bases
    assert.ok(ts[0].list.filter((p: { assets: unknown[] | null }) => p.assets?.length).length > 10);
    assert.ok(ts[1].progress.length < ts[0].progress.length / 3, `${ts[1].progress.length} of ${ts[0].progress.length} built again`);
    assert.ok(ts[0].log.some((m: string) => m.includes('not here yet')) && ts[0].wanted.length);
    assert.ok(ts[0].itemFiles?.entries?.length > 100, `${ts[0].itemFiles?.entries?.length} item files`);
    assert.ok(fxPicks.length > 1 && ts[0].list.some((p: { source: string }) => p.source.includes(', ')), 'ability effects picks joined');
    assert.ok(ts[0].beneath.length > 0 && ts[0].shared.entries.length > 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a look as files alone in Rust is the one the TypeScript makes: model particles, body groups, merged models', { skip }, async (t) => {
  if (!fs.existsSync(GAME_PAK01) || !fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no game or no sandbox'); return; }
  const mp = await import('../src/model-particles.ts');
  const mb = await import('../src/model-bodygroups.ts');
  const mm = await import('../src/model-merge.ts');
  const itf = await import('../src/item-files.ts');
  const { MeshoptDecoder } = await import('meshoptimizer');
  // the app decodes long after the import; here the decoder is waited for, or the TypeScript reads no vertices
  await MeshoptDecoder.ready;
  const { openVpkIndex } = await import('../src/vpk.ts');
  const { listItems } = await import('../src/schema-items.ts');
  const { createHash } = await import('node:crypto');
  const sha = (f: Buffer | null | undefined) => (f ? createHash('sha1').update(f).digest('hex') : null);
  const buf = (s: string) => Buffer.from(s, 'latin1');
  const { file } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const index = openVpkIndex(GAME_PAK01);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-files-'));
  let n = 0;
  const put = (p: string) => {
    const data = index.read(`${p.toLowerCase().replace(/_c$/, '')}_c`);
    if (!data) return null;
    const f = path.join(tmp, `${n++}.bin`);
    fs.writeFileSync(f, data);
    return { $file: f };
  };
  const spread = <T,>(a: T[], k: number) => a.filter((_, j) => j % Math.max(1, Math.floor(a.length / k)) === 0).slice(0, k);
  const items = listItems(text).filter((i) => i.hasVisuals);
  const blocks = items.map((i) => text.slice(i.start, i.end));
  const field = (b: string, key: string) => new RegExp(`"${key}"\\s+"([^"]+)"`, 'i').exec(b)?.[1];
  const modOf = (b: string, type: string) => [...b.matchAll(/"asset_modifier\d*"\s*\{([^{}]*)\}/gi)].map((m) => m[1]).filter((m) => new RegExp(`"type"\\s+"${type}"`, 'i').test(m));
  // pairs of an item's model and the second model it wears
  const pairs = spread(blocks.filter((b) => modOf(b, 'additional_wearable').length && field(b, 'model_player')), 60)
    .flatMap((b) => modOf(b, 'additional_wearable').slice(0, 1).map((m) => [put(field(b, 'model_player')!), put(field(m, 'asset') ?? '')]))
    .filter(([a, b2]) => a && b2);
  // models and the body groups items set on them
  const grouped = spread(blocks.filter((b) => modOf(b, 'bodygroup_visibility').length), 60).flatMap((b) => modOf(b, 'bodygroup_visibility').slice(0, 2).flatMap((m) => {
    const f = put(field(m, 'asset') ?? '');
    return f ? [[f, [[String(field(m, 'modifier')).toLowerCase(), Number(field(m, 'value')) || 0]]]] : [];
  }));
  const models = spread([...index.paths()].filter((p) => p.endsWith('.vmdl_c') && (p.startsWith('models/items/') || p.startsWith('models/heroes/'))), 80).map((p) => put(p)).filter(Boolean);
  const withCfg = spread([...index.paths()].filter((p) => p.endsWith('.vmdl_c') && /pedestal|lycan|props_gameplay/.test(p)), 60).map((p) => put(p)).filter(Boolean);
  const texts = ['', '{\n}\n', '<!-- kv3 -->\n{\n\tx = 1\n}\n', '{\n\tparticle_cfg_list = \n\t[\n\t\t{\n\t\t\tname = resource:"particles/a/b.vpcf"\n\t\t\tconfig = "preview"\n\t\t},\n\t]\n\ty = 2\n}\n',
    '{ a = 1, particle_cfg_list = [ { name = "particles/X/Y.vpcf" config = "" } ], }', '{particle_cfg_list=[{NAME = resource : "PARTICLES/z.vpcf"}]}'];
  const systems = [[], ['particles/econ/items/axe/a.vpcf'], ['particles/a.vpcf', 'particles/b/c.vpcf']];
  const own = items.filter((i) => /"particle_create"|"activity"|"bodygroup_visibility"|"additional_wearable"|"model_skin"|"entity_scale"/i.test(text.slice(i.start, i.end)));
  const parts = spread(own, 200).map((i) => text.slice(i.start, i.end));
  const fromFile = (f: string) => buf(f);
  const cases: Case[] = [
    { name: 'model-particles.keyValuesWithParticles', ts: mp.keyValuesWithParticles as never, inputs: texts.flatMap((x) => systems.map((s) => [x, s])) },
    { name: 'model-particles.keyValueParticles', ts: mp.keyValueParticles as never, inputs: texts.map((x) => [x]) },
    { name: 'model-particles.modelParticleEntries', ts: ((f: string | null) => mp.modelParticleEntries(f === null ? null : fromFile(f))) as never, inputs: [...withCfg, ...models.slice(0, 20)].map((f) => [f]).concat([[null]]) },
    { name: 'model-particles.withParticles', ts: ((f: string, s: string[]) => sha(mp.withParticles(fromFile(f), s))) as never, inputs: [...withCfg.slice(0, 20), ...models.slice(0, 30)].flatMap((f, k) => [[f, systems[k % 3]]]) },
    { name: 'model-bodygroups.withBodygroups', ts: ((f: string, g: [string, number][]) => sha(mb.withBodygroups(fromFile(f), new Map(g)))) as never, inputs: [...grouped, ...models.slice(0, 20).map((f) => [f, [['head', 1], ['nope', 0]]])] },
    { name: 'model-bodygroups.withoutMeshes', ts: ((f: string) => sha(mb.withoutMeshes(fromFile(f)))) as never, inputs: models.map((f) => [f]) },
    { name: 'model-bodygroups.hiddenMeshes', ts: ((f: string, g: [string, number][]) => mb.hiddenMeshes(fromFile(f), new Map(g))) as never, inputs: grouped },
    { name: 'model-merge.mergedModel', ts: ((a: string, b2: string) => sha(mm.mergedModel(fromFile(a), fromFile(b2)))) as never, inputs: [...pairs, ...models.slice(0, 10).map((f, k) => [f, models[(k + 1) % models.length]])] },
    { name: 'item-files.pickParts', ts: ((b: string, o: string | null, u: boolean) => itf.pickParts({ block: b, own: o, unplaced: u })) as never, inputs: parts.flatMap((b, k) => [[b, k % 3 ? 'models/x.vmdl' : null, k % 5 === 0]]) },
    { name: 'item-files.extraPlaces', ts: itf.extraPlaces as never, inputs: [[[], []], [['a'], ['a']], [['a', 'b'], ['c']], [['a', 'b'], ['b', 'c', 'd']], [[], ['x', 'y']], [['a'], []]] },
    { name: 'item-files.wornModel', ts: ((f: string, skin: number, s: string[]) => sha(itf.wornModel(fromFile(f), skin, s))) as never, inputs: models.slice(0, 30).flatMap((f, k) => [[f, k % 3, systems[k % 3]]]) },
  ];
  try {
    assert.ok(pairs.length > 10 && grouped.length > 10 && withCfg.length > 5, `${pairs.length} pairs, ${grouped.length} groups, ${withCfg.length} with a list`);
    assert.ok(compare(cases) > 400);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('Cancel on the item table bar in Rust puts back what the TypeScript puts back', { skip }, async () => {
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { Settings } = await import('../src/settings.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const { createBuildUndo } = await import('../src/build-undo.ts');
  const { buildVpk, entryAt } = await import('../src/vpk-write.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-undo-'));
  const pak = (p: string) => buildVpk([entryAt(p, Buffer.from(p))]);
  const lang = (f: string) => [{ root: 'lang', relPath: f }];
  const block = '"1"\n{\n\t"name"\t"x"\n}\n';
  const recs = [
    { id: 'p1', name: 'Pick one', categoryId: 'cosmetic', styleLabel: null, files: [], enabled: true, slot: 'weapon', item: 'a' },
    { id: 'p2', name: 'Pick two', categoryId: 'cosmetic', styleLabel: null, files: [], enabled: true, slot: 'head', item: 'b', effect: 'red' },
    { id: 'm1', name: 'Mod one', categoryId: 'imported', styleLabel: null, files: lang('pak30_dir.vpk'), enabled: true, schema: [{ id: '1', block }] },
    { id: 'm2', name: 'Mod two', categoryId: 'imported', styleLabel: null, files: lang('pak31_dir.vpk'), enabled: true, schema: [{ id: '2', block }] },
    { id: 'm4', name: 'Mod four', categoryId: 'imported', styleLabel: null, files: lang('pak34_dir.vpk'), enabled: false, schema: [{ id: '4', block }] },
    { id: 'plain', name: 'Plain mod', categoryId: 'imported', styleLabel: null, files: lang('pak32_dir.vpk'), enabled: true },
    { id: 'w', name: 'Window', categoryId: 'arcana', styleLabel: null, files: [], enabled: true, generated: { set: 'terrorblade-arcana', color: [1, 2, 3] } },
  ];
  const twin = (side: string) => {
    const root = path.join(tmp, side);
    const dir = path.join(root, 'game', 'dota_russian');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['pak30_dir.vpk', 'pak31_dir.vpk', 'pak32_dir.vpk', 'pak33_dir.vpk']) fs.writeFileSync(path.join(dir, f), pak(`${f}.txt`));
    fs.writeFileSync(path.join(dir, 'pak34_dir.vpk.off'), pak('pak34.txt'));
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(root, 'userdata'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib', 'manifest.json'), JSON.stringify({ installed: recs, presets: [] }, null, 2));
    return { root, game: path.join(root, 'game'), lib: path.join(root, 'lib'), ud: path.join(root, 'userdata'), journal: path.join(root, 'journal') };
  };
  const ops: unknown[][] = [
    ['marked'], ['cancel', true], ['mark'], ['marked'], ['cancel', false], ['state'],
    // a build that a preset started: picks on and off, a look changed, mods switched, the switches flipped
    ['add', { id: 'p3', name: 'Pick three', categoryId: 'cosmetic', styleLabel: null, files: [], enabled: true, slot: 'back', item: 'c' }],
    ['remove', 'p1'], ['update', 'p2', { effect: 'blue', style: 2 }], ['enable', 'm1', false], ['enable', 'm4', true],
    ['add', { id: 'm3', name: 'Mod three', categoryId: 'imported', styleLabel: null, files: lang('pak33_dir.vpk'), enabled: true, schema: [{ id: '3', block }] }],
    ['remove', 'm2'], ['update', 'plain', { note: 'kept' }], ['update', 'w', { generated: { set: 'terrorblade-arcana', color: [9, 9, 9] } }],
    ['setting', 'everyoneWearsMine', true], ['master', false], ['state'],
    ['cancel', true], ['state'], ['cancel', true], ['state'],
    // marked again: a cancel with nothing changed, then a pick only
    ['mark'], ['cancel', true], ['add', { id: 'p4', name: 'Pick four', categoryId: 'cosmetic', styleLabel: null, files: [], enabled: true }],
    ['setting', 'schemaPending', true], ['cancel', true], ['state'],
  ];
  const a = twin('ts');
  const b = twin('rs');
  const list = path.join(tmp, 'undo.json');
  fs.writeFileSync(list, JSON.stringify([['build-undo.script', b.game, 'russian', b.journal, b.lib, b.ud, ops]]));
  const [rs] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' }));
  const answers = rs.ok as { ok?: unknown; error?: unknown }[];
  FileTx.journalDir = a.journal;
  try {
    const inst = new Installer({ userDataDir: a.ud, getGamePath: () => a.game, getLangSuffix: () => 'russian' });
    const lib = new Library(a.lib);
    const st = new Settings(a.ud);
    let running = false;
    let logged: string[] = [];
    const undo = createBuildUndo({ library: lib, installer: inst, settings: st as never, schema: { cancel: () => running }, log: (m) => logged.push(m) });
    const find = (id: unknown) => lib.list().find((r) => r.id === id)!;
    const cancelLines = (l: string[]) => l.filter((m) => m.startsWith('schema:'));
    ops.forEach((op, k) => {
      let want: unknown;
      try {
        const v = ((): unknown => {
          switch (op[0]) {
            case 'mark': undo.mark(); return null;
            case 'marked': return undo.marked();
            case 'cancel': {
              running = !!op[1];
              logged = [];
              const r = undo.cancel();
              return { r, log: cancelLines(logged) };
            }
            case 'add': lib.list().push(structuredClone(op[1]) as never); lib.save(); return null;
            case 'remove': lib.removeRecord(op[1] as string); return null;
            case 'update': lib.update(op[1] as string, op[2] as never); return null;
            case 'enable': {
              const r = find(op[1]);
              if (r.files.length) inst.setEnabled(r.files, !!op[2], r.id);
              lib.setEnabled(r.id, !!op[2]);
              return null;
            }
            case 'setting': st.set(op[1] as never, op[2] as never); return null;
            case 'master': return inst.setMasterEnabled(!!op[1]);
            case 'state': return { list: lib.list(), everyone: st.get('everyoneWearsMine') ?? null, pending: st.get('schemaPending' as never) ?? null, off: inst.masterIsOff() };
          }
          throw new Error(`no step ${op[0]}`);
        })();
        want = { ok: JSON.parse(JSON.stringify(v ?? null)) };
      } catch { want = { error: true }; }
      const got = answers[k];
      const norm = (g: { ok?: unknown; error?: unknown }) => {
        if ('error' in g) return { error: true };
        // the file transaction logs to its own sink: only the cancel line is compared
        const o = g.ok as { log?: string[] } | null;
        if (o && Array.isArray(o.log)) return { ok: { ...o, log: cancelLines(o.log) } };
        return g;
      };
      assert.deepEqual(norm(got), want, `${k} ${JSON.stringify(op).slice(0, 200)}`);
    });
  } finally { FileTx.journalDir = null; }
  const final = answers.at(-1)!.ok as { list: { id: string }[] };
  assert.deepEqual(final.list.map((r) => r.id).sort(), ['m1', 'm3', 'm4', 'p1', 'p2', 'plain', 'w']);
  const tree = (g: string): string[] => (fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .filter((d) => d.isFile() && path.relative(g, d.parentPath).startsWith('game'))
    .map((d) => { const p = path.join(d.parentPath, d.name); return `${path.relative(g, p)} ${fs.readFileSync(p).toString('base64')}`; }).sort();
  assert.deepEqual(tree(b.root), tree(a.root));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a mod\'s own item blocks and the picks\' pak in Rust match the TypeScript: lifted, split, swept, written in a slot', { skip }, async () => {
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const { createHarvest } = await import('../src/schema-harvest.ts');
  const { createItemFilesPak } = await import('../src/item-files-service.ts');
  const { buildVpk, entryAt } = await import('../src/vpk-write.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-harvest-'));
  const pak = (files: Record<string, string>) => buildVpk(Object.entries(files).map(([p, d]) => entryAt(p, Buffer.from(d, 'latin1'))));
  const lang = (f: string) => [{ root: 'lang', relPath: f }];
  const item = (id: string, name: string, model: string) => [`\t\t"${id}"`, '\t\t{', `\t\t\t"name"\t"${name}"`, '\t\t\t"prefab"\t"wearable"', `\t\t\t"model_player"\t"${model}"`, '\t\t}'];
  const table = (rows: string[][]) => ['"items_game"', '{', '\t"items"', '\t{', ...rows.flat(), '\t}', '}', ''].join('\n');
  const jugg = 'models/heroes/juggernaut/juggernaut.vmdl';
  const axe = 'models/items/axe/axe_helm.vmdl';
  const vanilla = table([item('4100', 'Blade', jugg), item('4200', 'Helm', axe)]);
  const modded = table([item('4100', 'Blade of the mod', jugg), item('4200', 'Helm', axe)]);
  const both = table([item('4100', 'Blade of the pack', jugg), item('4200', 'Helm of the pack', axe)]);
  const heroes = {
    'models/heroes/juggernaut/juggernaut.vmdl_c': 'j', 'materials/models/heroes/juggernaut/j.vmat_c': 'jm',
    'models/items/axe/axe_helm.vmdl_c': 'a', 'particles/units/heroes/hero_axe/x.vpcf_c': 'p',
  };
  const recs = [
    { id: 'one', name: 'One hero', categoryId: 'heroes', styleLabel: null, fileRef: 'one.zip', enabled: true, files: lang('pak30_dir.vpk') },
    { id: 'pack', name: 'Two heroes', categoryId: 'imported', styleLabel: null, fileRef: null, enabled: true, files: lang('pak31_dir.vpk') },
    { id: 'clean', name: 'Clean', categoryId: 'heroes', styleLabel: null, fileRef: 'c.zip', enabled: true, files: lang('pak32_dir.vpk') },
    { id: 'seen', name: 'Seen', categoryId: 'heroes', styleLabel: null, fileRef: 's.zip', enabled: true, schemaChecked: true, files: lang('pak33_dir.vpk') },
    { id: 'loc', name: 'Old text', categoryId: 'heroes', styleLabel: null, fileRef: 'l.zip', enabled: true, files: lang('pak34_dir.vpk') },
    { id: 'folder', name: 'Not a pak', categoryId: 'fonts', styleLabel: null, fileRef: 'f.zip', enabled: true, files: [{ root: 'game', relPath: 'panorama/fonts/x.otf' }] },
  ];
  const twin = (side: string) => {
    const root = path.join(tmp, side);
    const dir = path.join(root, 'game', 'dota_russian');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(root, 'game', 'dota'), { recursive: true });
    fs.writeFileSync(path.join(root, 'game', 'dota', 'pak01_dir.vpk'), pak({ 'scripts/items/items_game.txt': vanilla }));
    fs.writeFileSync(path.join(dir, 'gameinfo.gi'), 'gi');
    fs.writeFileSync(path.join(dir, 'pak30_dir.vpk'), pak({ 'models/heroes/juggernaut/juggernaut.vmdl_c': 'j', 'scripts/items/items_game.txt': modded, 'resource/localization/dota_english.txt': 'x'.repeat(4000) }));
    fs.writeFileSync(path.join(dir, 'pak31_dir.vpk'), pak({ ...heroes, 'scripts/items/items_game.txt': both }));
    fs.writeFileSync(path.join(dir, 'pak32_dir.vpk'), pak({ 'models/heroes/juggernaut/juggernaut.vmdl_c': 'j2' }));
    fs.writeFileSync(path.join(dir, 'pak33_dir.vpk'), pak({ 'scripts/items/items_game.txt': modded }));
    fs.writeFileSync(path.join(dir, 'pak34_dir.vpk'), pak({ 'resource/localization/dota_english.txt': 'y'.repeat(3 * 1024 * 1024), 'models/heroes/axe/axe.vmdl_c': 'a' }));
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(root, 'userdata'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib', 'manifest.json'), JSON.stringify({ installed: recs, presets: [] }, null, 2));
    fs.writeFileSync(path.join(root, 'vanilla.txt'), vanilla, 'latin1');
    return { root, game: path.join(root, 'game'), lib: path.join(root, 'lib'), ud: path.join(root, 'userdata'), journal: path.join(root, 'journal'), vanilla: path.join(root, 'vanilla.txt') };
  };
  const entries = (k: number) => [['models/items/axe/axe_helm.vmdl_c', `helm ${k}`], ['particles/x.vpcf_c', `fx ${k}`], ['scripts/npc/portraits.txt', `p ${k}`]];
  const left = [{ source: 'Helm of Axe', what: ['its effect', 'a second model'] }];
  // the record ids that library.add makes are random: the steps name records by name instead
  const ops: unknown[][] = [
    ['pakLeft'], ['pakClear'], ['harvest', 'One hero'], ['harvest', 'Clean'], ['harvest', 'Not a pak'], ['harvest', 'Nobody'], ['list'],
    ['harvest', 'Two heroes'], ['split', 'Two heroes'], ['split', 'Clean'], ['split', 'Not a pak'], ['list'],
    ['migrate'], ['migrate'], ['list'],
    ['pakWrite', entries(1), 3, left], ['list'], ['pakLeft'], ['pakWrite', entries(2), 4, []], ['list'],
    ['enable', 'Предметы героев: 4', false], ['pakWrite', entries(3), 5, left], ['list'], ['pakClear'], ['list'], ['pakClear'],
  ];
  const a = twin('ts');
  const b = twin('rs');
  const list = path.join(tmp, 'harvest.json');
  fs.writeFileSync(list, JSON.stringify([['schema-harvest.script', b.game, 'russian', b.journal, b.lib, b.ud, { $file: b.vanilla }, ops]]));
  const [rs] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' }));
  const answers = rs.ok as { ok?: unknown; error?: unknown }[];
  const ids = new Map<string, string>();
  // the same record on both sides by its place in the library, the generated ids aside
  const plain = (v: unknown, idsOf: (id: string) => string): unknown => JSON.parse(JSON.stringify(v ?? null), (k, x) => {
    if (k === 'id' && typeof x === 'string') return idsOf(x);
    if (k === 'installedAt' || k === 'updatedAt') return typeof x;
    return x;
  });
  const idOf = (side: Map<string, string>) => (id: string) => {
    if (!side.has(id)) side.set(id, `#${side.size}`);
    return side.get(id)!;
  };
  const rsIds = new Map<string, string>();
  FileTx.journalDir = a.journal;
  try {
    const inst = new Installer({ userDataDir: a.ud, getGamePath: () => a.game, getLangSuffix: () => 'russian' });
    const lib = new Library(a.lib);
    const h = createHarvest({ library: lib, installer: inst as never, gamePath: () => a.game, vanilla: () => fs.readFileSync(a.vanilla, 'latin1') });
    const logs: string[] = [];
    const p = createItemFilesPak({ installer: inst as never, library: lib, log: (m) => logs.push(m) });
    const named = (n: unknown) => lib.list().find((r) => r.name === n);
    ops.forEach((op, k) => {
      let want: unknown;
      try {
        const v = ((): unknown => {
          switch (op[0]) {
            case 'harvest': return h.harvest(named(op[1]));
            case 'split': { const r = named(op[1]); return r ? h.split(r) : null; }
            case 'migrate': return h.migrate();
            case 'list': return lib.list();
            case 'pakLeft': return p.left();
            case 'pakClear': p.clear(); return null;
            case 'pakWrite': {
              logs.length = 0;
              p.write((op[1] as [string, string][]).map(([q, d]) => entryAt(q, Buffer.from(d))), op[2] as number, op[3] as never);
              return [...logs];
            }
            case 'enable': {
              const r = named(op[1])!;
              inst.setEnabled(r.files, !!op[2], r.id);
              lib.setEnabled(r.id, !!op[2]);
              return null;
            }
          }
          throw new Error(`no step ${op[0]}`);
        })();
        want = { ok: plain(v, idOf(ids)) };
      } catch { want = { error: true }; }
      const got = answers[k];
      assert.deepEqual('error' in got ? { error: true } : { ok: plain(got.ok, idOf(rsIds)) }, want, `${k} ${JSON.stringify(op).slice(0, 200)}`);
    });
  } finally { FileTx.journalDir = null; }
  const split = answers[8].ok as unknown[];
  assert.ok(Array.isArray(split) && split.length === 2, JSON.stringify(answers[8]).slice(0, 300));
  // each kind of step did something: blocks lifted, a sweep that found mods, the pak written and swapped, its log
  assert.deepEqual(answers[2].ok, { deltas: 1, stripped: 1 });
  const swept = answers[12].ok as { scanned: number; changed: number };
  assert.ok(swept.scanned >= 1 && swept.changed >= 1, JSON.stringify(swept));
  assert.deepEqual(answers[13].ok, { scanned: 0, changed: 0, deltas: 0, freedMB: 0 });
  assert.equal((answers[15].ok as string[]).length, 1);
  const pakOf = (k: number) => (answers[k].ok as { generated?: { itemFiles?: boolean }; files: unknown }[]).find((r) => r.generated?.itemFiles);
  assert.ok(pakOf(16) && pakOf(19) && pakOf(22) && !pakOf(24), 'the pak comes, is rebuilt in place, and goes');
  const tree = (g: string): string[] => (fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .filter((d) => d.isFile() && path.relative(g, d.parentPath).startsWith('game'))
    .map((d) => { const q = path.join(d.parentPath, d.name); return `${path.relative(g, q)} ${fs.readFileSync(q).toString('base64')}`; }).sort();
  assert.deepEqual(tree(b.root), tree(a.root));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the item table written into the game by Rust is the one the TypeScript writes: merged, checked, packed, swapped, swept', { skip }, async (t) => {
  const sandboxPak = path.join(sandboxGame, 'dota', 'pak01_dir.vpk');
  if (!fs.existsSync(sandboxPak)) { t.skip('no sandbox'); return; }
  const schema = await import('../src/schema.ts');
  const { entryAt } = await import('../src/vpk-write.ts');
  const { createHash } = await import('node:crypto');
  const sha = (f: string) => (fs.existsSync(f) ? createHash('sha1').update(fs.readFileSync(f)).digest('hex') : null);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-deploy-'));
  const { file } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const items = schema.listItems(text).filter((i) => i.hasVisuals);
  const pick = items.filter((_, k) => k % Math.floor(items.length / 8) === 0).slice(0, 8);
  const renamed = (i: (typeof items)[number], to: string) => text.slice(i.start, i.end).replace(/"name"(\s+)"[^"]*"/, `"name"$1"${to}"`);
  const patches = [
    ...pick.map((i, k) => ({ id: i.id, block: renamed(i, `Mine ${k}`), source: `mod ${k % 3}`, assets: [entryAt(`models/mine/${k}.vmdl_c`, Buffer.from(`model ${k}`))] })),
    { id: pick[0].id, block: renamed(pick[0], 'Mine again'), source: 'later mod', assets: [entryAt('models/mine/0.vmdl_c', Buffer.from('later'))] },
    { id: pick[1].id, block: renamed(pick[1], 'Mine 1'), source: 'same block', assets: [] },
    { id: '99999999', block: '"99999999"\n{\n\t"name"\t"Nowhere"\n}', source: 'missing', assets: [] },
  ];
  const beneath = [entryAt('models/mine/0.vmdl_c', Buffer.from('base')), entryAt('models/base/body.vmdl_c', Buffer.from('body'))];
  const twin = (side: string) => {
    const g = path.join(tmp, side, 'game');
    fs.mkdirSync(path.join(g, 'dota'), { recursive: true });
    fs.copyFileSync(sandboxPak, path.join(g, 'dota', 'pak01_dir.vpk'));
    const dir = path.join(g, 'dota_mods');
    fs.mkdirSync(path.join(dir, 'rpt', 'empty'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pak01_dir.vpk.111-1.mmtmp'), 'left by another run');
    fs.writeFileSync(path.join(dir, `pak01_dir.vpk.${process.pid}-9.mmtmp`), 'this run');
    return g;
  };
  const a = twin('ts');
  const b = twin('rs');
  const wire = (ps: typeof patches) => ps.map((p) => ({ id: p.id, block: p.block, source: p.source, assets: p.assets.map((e) => [`${e.folder}/${e.name}.${e.ext}`, e.data.toString('latin1')]) }));
  const ops = [
    ['isDeployed'], ['sweep', 111], ['deploy', wire(patches), wire([{ id: '', block: '', source: '', assets: beneath }])[0].assets, false],
    ['isDeployed'], ['sha'], ['deploy', wire(patches.slice(2, 5)), [], false], ['sha'], ['deploy', wire(patches), [], true], ['sha'],
    ['deploy', wire([{ id: pick[2].id, block: '"x" { "name" "broken"', source: 'bad', assets: [] }]), [], false], ['sha'],
    ['sweep', process.pid], ['sweep', 222], ['undeploy'], ['isDeployed'], ['undeploy'],
  ];
  const list = path.join(tmp, 'deploy.json');
  fs.writeFileSync(list, JSON.stringify([['schema-deploy.script', b, 'dota_mods', ops]]));
  const [rs] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  const answers = rs.ok as { ok?: unknown; error?: unknown }[];
  const base = schema.readGameSchema(a);
  const unwire = (ps: { id: string; block: string; source: string; assets: [string, string][] }[]) => ps.map((p) => ({ ...p, assets: p.assets.map(([q, d]) => entryAt(q, Buffer.from(d, 'latin1'))) }));
  ops.forEach((op, k) => {
    let want: unknown;
    try {
      const v = ((): unknown => {
        switch (op[0]) {
          case 'isDeployed': return schema.isDeployed(a, 'dota_mods');
          case 'sweep': return schema.sweepUnfinished(a, 'dota_mods', op[1] as number);
          case 'sha': return sha(path.join(a, 'dota_mods', 'pak01_dir.vpk'));
          case 'undeploy': schema.undeploy({ gamePath: a, folder: 'dota_mods' }); return null;
          case 'deploy': {
            if (op[3]) return null; // stopped before the write: the TypeScript's caller drops the generator there
            const r = schema.deploy({ gamePath: a, folder: 'dota_mods', patches: unwire(op[1] as never) as never, base, beneath: (op[2] as [string, string][]).map(([q, d]) => entryAt(q, Buffer.from(d, 'latin1'))) });
            const { text: _text, ...rest } = r;
            return rest;
          }
        }
        throw new Error(`no step ${op[0]}`);
      })();
      want = { ok: JSON.parse(JSON.stringify(v ?? null)) };
    } catch { want = { error: true }; }
    const got = answers[k];
    assert.deepEqual('error' in got ? { error: true } : got, want, `${k} ${JSON.stringify(op).slice(0, 160)}`);
  });
  assert.ok((answers[2].ok as { applied: unknown[] }).applied.length === 8, JSON.stringify(answers[2]).slice(0, 300));
  assert.equal(answers[1].ok, 1);
  assert.ok(answers[4].ok && answers[4].ok !== answers[6].ok && answers[6].ok === answers[8].ok && answers[8].ok === answers[10].ok);
  const tree = (g: string): string[] => (fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .map((d) => path.relative(g, path.join(d.parentPath, d.name)) + (d.isDirectory() ? '/' : '')).filter((p) => !p.startsWith(`dota${path.sep}`)).sort();
  assert.deepEqual(tree(b), tree(a));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the item table service in Rust keeps the game where the TypeScript keeps it: the patch, the table, the picks\' pak, heal', { skip }, async (t) => {
  if (!fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no sandbox'); return; }
  const { createSchemaService } = await import('../src/schema-service.ts');
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { Settings } = await import('../src/settings.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const { MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptDecoder.ready;
  const sl = await import('../src/item-builder-slots.ts');
  const schema = await import('../src/schema.ts');
  const { createHash } = await import('node:crypto');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-service-'));
  const { file } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const spread = <T,>(a: T[], k: number) => a.filter((_, j) => j % Math.max(1, Math.floor(a.length / k)) === 0).slice(0, k);
  const plain = sl.itemSlots(text).filter((s) => !s.persona && !s.abilityFx && s.options.length);
  const picks = spread(plain, 6).map((s, k) => ({ id: `p${k}`, name: `pick ${k}`, categoryId: 'cosmetic', styleLabel: null, files: [], enabled: true, slot: s.slot, itemId: s.options[k % s.options.length].id }));
  const items = schema.listItems(text).filter((i) => i.hasVisuals);
  const block = (i: (typeof items)[number], to: string) => text.slice(i.start, i.end).replace(/"name"(\s+)"[^"]*"/, `"name"$1"${to}"`);
  const [i1, i2] = [items[100], items[200]];
  const mods = [
    { id: 'm1', name: 'Mod one', categoryId: 'heroes', styleLabel: null, files: [], enabled: true, schema: [{ id: i1.id, name: 'a', block: block(i1, 'From one') }, { id: i2.id, name: 'b', block: block(i2, 'Same') }] },
    { id: 'm2', name: 'Mod two', categoryId: 'heroes', styleLabel: null, files: [], enabled: true, schema: [{ id: i1.id, name: 'a', block: block(i1, 'From two') }, { id: i2.id, name: 'b', block: block(i2, 'Same') }] },
  ];
  const twin = (side: string) => {
    const root = path.join(tmp, side);
    const game = path.join(root, 'game');
    fs.cpSync(sandboxGame, game, { recursive: true });
    for (const d of ['lib', 'userdata']) fs.mkdirSync(path.join(root, d), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib', 'manifest.json'), JSON.stringify({ installed: [...picks, ...mods], presets: [] }, null, 2));
    fs.writeFileSync(path.join(root, 'userdata', 'settings.json'), JSON.stringify({ dotaGamePath: game, schemaPatch: false }));
    return { root, game, lib: path.join(root, 'lib'), ud: path.join(root, 'userdata'), journal: path.join(root, 'journal') };
  };
  const ops: unknown[][] = [
    ['state'], ['refresh'], ['state'], ['settings'], ['list'], ['heal', false],
    ['setEnabled', true], ['state'], ['settings'], ['list'], ['heal', false],
    ['set', 'everyoneWearsMine', true], ['refresh'], ['set', 'schemaStamp', 'old'], ['heal', false], ['settings'],
    ['master', false], ['refresh'], ['state'], ['master', true], ['refresh'],
    ['setEnabled', false], ['state'], ['heal', false], ['settings'],
    ['remove', 'p0'], ['remove', 'p1'], ['remove', 'p2'], ['remove', 'p3'], ['remove', 'p4'], ['remove', 'p5'], ['refresh'], ['list'], ['state'],
  ];
  const a = twin('ts');
  const b = twin('rs');
  const list = path.join(tmp, 'service.json');
  fs.writeFileSync(list, JSON.stringify([['schema-service.script', b.game, 'russian', b.journal, b.lib, b.ud, ops]]));
  const [rs] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  const answers = rs.ok as { ok?: unknown; error?: unknown; filled?: string[] }[];
  // the builder's stamp is each side's own code; the generated pak's id is random
  const plainOf = (v: unknown, ids: Map<string, string>) => JSON.parse(JSON.stringify(v ?? null), (k, x) => {
    if ((k === 'schemaStamp' || k === 'stamp') && typeof x === 'string') return x.split('|')[0];
    if (k === 'id' && typeof x === 'string' && !/^[pm]\d$/.test(x)) { if (!ids.has(x)) ids.set(x, `#${ids.size}`); return ids.get(x); }
    if (k === 'installedAt' || k === 'updatedAt') return typeof x;
    if (typeof x === 'string') return x.split(a.root).join('<root>').split(b.root).join('<root>');
    return x;
  });
  const tsIds = new Map<string, string>();
  const rsIds = new Map<string, string>();
  FileTx.journalDir = a.journal;
  try {
    const inst = new Installer({ userDataDir: a.ud, getGamePath: () => a.game, getLangSuffix: () => 'russian' });
    const lib = new Library(a.lib);
    const st = new Settings(a.ud);
    let filled: string[] = [];
    const svc = createSchemaService({ settings: st as never, library: lib, installer: inst as never, userDataDir: a.ud, pak: inst as never,
      modsOff: () => inst.masterIsOff(), onDeployed: (s) => { filled = [...s].sort(); } });
    ops.forEach((op, k) => {
      let want: unknown;
      filled = [];
      try {
        const v = ((): unknown => {
          switch (op[0]) {
            case 'state': return svc.state();
            case 'refresh': return svc.refresh();
            case 'heal': return svc.heal({ background: !!op[1] });
            case 'setEnabled': return svc.setEnabled(!!op[1]);
            case 'settings': { const all = JSON.parse(fs.readFileSync(path.join(a.ud, 'settings.json'), 'utf8')); return { patch: all.schemaPatch ?? null, stamp: all.schemaStamp ?? null, pending: all.schemaPending ?? null, everyone: all.everyoneWearsMine ?? null }; }
            case 'list': return lib.list();
            case 'set': st.set(op[1] as never, op[2] as never); return null;
            case 'master': return inst.setMasterEnabled(!!op[1]);
            case 'remove': lib.removeRecord(op[1] as string); return null;
          }
          throw new Error(`no step ${op[0]}`);
        })();
        want = { ok: plainOf(v, tsIds), filled };
      } catch { want = { error: true }; }
      const got = answers[k];
      const norm = 'error' in got ? { error: true } : { ok: plainOf(got.ok, rsIds), filled: got.filled ?? [] };
      // a heal in the background leaves the build to the caller: the Rust says so, the TypeScript starts it
      if (op[0] === 'heal' && op[1]) { delete (norm as { ok?: { rebuild?: unknown } }).ok?.rebuild; }
      assert.deepEqual(norm, want, `${k} ${JSON.stringify(op)}`);
    });
    await svc.settled();
  } finally { FileTx.journalDir = null; }
  const deployed = answers[6].ok as { deployed?: boolean; patches?: number };
  assert.ok(deployed.deployed && (deployed.patches ?? 0) >= 3, JSON.stringify(deployed));
  assert.ok((answers[1].ok as { deployed?: boolean }).deployed, 'the picks went as a pak with the patch off');
  assert.ok(((answers[7].ok as { conflicts: unknown[] }).conflicts.length) === 1, 'two mods disagree on one block');
  const sha = (f: string) => createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  const tree = (g: string): string[] => (fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .filter((d) => d.isFile()).map((d) => { const q = path.join(d.parentPath, d.name); return `${path.relative(g, q)} ${sha(q)}`; }).sort();
  assert.deepEqual(tree(b.game), tree(a.game));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the free cosmetics and the item builder\'s picks in Rust answer as the TypeScript ones do: slots, picks, sets, looks, the old settings', { skip }, async (t) => {
  if (!fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no sandbox'); return; }
  const { createCosmetics } = await import('../src/schema-cosmetics.ts');
  const { Library } = await import('../src/library.ts');
  const { Settings } = await import('../src/settings.ts');
  const sl = await import('../src/item-builder-slots.ts');
  const ib = await import('../src/item-builder.ts');
  const { file } = await realItems();
  const text = fs.readFileSync(file).toString('latin1');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-cosmetics-'));
  const slots = sl.itemSlots(text);
  const plain = slots.filter((s) => !s.persona && !s.abilityFx && s.options.length > 1);
  const [a, b, c] = [plain[0], plain[Math.floor(plain.length / 2)], plain[plain.length - 1]];
  const sets = ib.itemSets(text, slots);
  const set = sets.find((s) => s.styles > 2 && s.pieces.every((p) => !p.fits || (p.styles ?? 1) > 2)) ?? sets.find((s) => s.styles > 2)!;
  const persona = slots.find((s) => s.persona && s.options.length);
  const hero = a.slot.slice(0, a.slot.lastIndexOf(':') + 1);
  const ops: unknown[][] = [
    ['settings', 'cosmetics', { [a.slot]: a.options[0].id, nope: 5 }], ['migrate'], ['list'], ['settings', 'cosmetics', {}], ['migrate'],
    ['pick', a.slot, a.options[0].id, 'A', null], ['pick', a.slot, a.options[0].id, 'A', ['fx-fire']], ['pick', a.slot, a.options[1].id, 'A1', 'style-1'],
    ['pick', a.slot, a.options[0].id, null, ''], ['pick', b.slot, b.options[1].id, 'B', []], ['pick', 'weather', '5', 'Rain', null], ['pick', 'weather', '6', 'Snow', 'x'],
    ['list'],
    ...(persona ? [['pick', persona.slot, persona.options[0].id, 'P', null], ['list']] : []),
    ['set', set.id, 2], ['list'], ['set', set.id, 1], ['list'], ['set', set.id, 0], ['set', 'no-such-set', 0],
    ['look', hero, [{ slot: a.slot, itemId: a.options[1].id, name: 'L', effectId: '' }, { slot: c.slot, itemId: c.options[0].id }, { slot: 'item:other:x', itemId: '1' }, { slot: `${hero}bad slot`, itemId: '2' }]],
    ['look', 'nope', []], ['list'],
    ['slots'],
  ];
  const twin = (side: string) => {
    const root = path.join(tmp, side);
    for (const d of ['lib', 'userdata']) fs.mkdirSync(path.join(root, d), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib', 'manifest.json'), JSON.stringify({ installed: [], presets: [] }, null, 2));
    return { lib: path.join(root, 'lib'), ud: path.join(root, 'userdata') };
  };
  const ts = twin('ts');
  const rs = twin('rs');
  const list = path.join(tmp, 'cosmetics.json');
  fs.writeFileSync(list, JSON.stringify([['schema-cosmetics.script', 'en', sandboxGame, rs.lib, rs.ud, file, ops]]));
  const [res] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  const answers = res.ok as { ok?: unknown; error?: unknown }[];
  // the records' ids are each side's own: compared by the order they first appear
  const plainOf = (v: unknown, ids: Map<string, string>) => JSON.parse(JSON.stringify(v ?? null), (k, x) => {
    if ((k === 'id' || k === 'recordId') && typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(x)) { if (!ids.has(x)) ids.set(x, `#${ids.size}`); return ids.get(x); }
    if (k === 'installedAt' || k === 'updatedAt') return typeof x;
    return x;
  });
  setLang('en');
  const lib = new Library(ts.lib);
  const st = new Settings(ts.ud);
  const cos = createCosmetics({ library: lib, settings: st as never, gamePath: () => sandboxGame, vanilla: () => text, refresh: () => {} });
  const tsIds = new Map<string, string>();
  const rsIds = new Map<string, string>();
  ops.forEach((op, k) => {
    let want: unknown;
    try {
      const v = ((): unknown => {
        switch (op[0]) {
          case 'slots': return cos.cosmeticSlots();
          case 'pick': return cos.pickCosmetic(op[1] as string, op[2] as string, op[3] as string, op[4] as string, { write: false });
          case 'set': return cos.pickSet(op[1] as string, { write: false, style: op[2] as number });
          case 'look': return cos.wearLook(op[1] as string, op[2] as never, { write: false });
          case 'settings': st.set(op[1] as never, op[2] as never); return null;
          case 'migrate': cos.migrateCosmeticSettings(); return null;
          case 'list': return lib.list();
        }
        throw new Error(`no step ${op[0]}`);
      })();
      want = { ok: plainOf(v, tsIds) };
    } catch { want = { error: true }; }
    const got = answers[k];
    const norm = 'error' in got ? { error: true } : { ok: op[0] === 'migrate' ? null : plainOf(got.ok, rsIds) };
    assert.deepEqual(norm, want, `${k} ${JSON.stringify(op).slice(0, 200)}`);
  });
  const picked = (answers.at(-2)!.ok as unknown[]).length;
  assert.ok(picked >= 4, `the picks became records: ${picked}`);
  const all = answers.at(-1)!.ok as { slots: unknown[]; sets: unknown[] };
  assert.ok(all.slots.length > 100 && all.sets.length > 50, 'the slots and sets of the real table');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('preset links, ready presets and .d2mm files in Rust read and write as the TypeScript ones do', { skip }, async () => {
  const link = await import('../src/preset-link.ts');
  const ready = await import('../src/ready-presets-format.ts');
  const share = await import('../src/preset-share.ts');
  const zlib = await import('node:zlib');
  const { createHash } = await import('node:crypto');
  const AdmZip = (await import('adm-zip')).default;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-presets-'));
  const raw = (o: unknown) => zlib.deflateRawSync(Buffer.from(JSON.stringify(o))).toString('base64url');
  const mods = [
    { categoryId: 'huds', name: 'Hud One', styleLabel: 'gray' },
    { categoryId: 'terrains', name: 'Тёмный ландшафт 🌑', styleLabel: null },
    { kind: 'cosmetic', slot: 'item:axe:head', itemId: 123, name: 'Helm', effectId: 'fx-fire' },
    { kind: 'cosmetic', slot: 'courier', itemId: '77', name: 'Pet' },
  ];
  const encodes: unknown[][] = [
    ['Build', 'me', mods], ['', null, []], [42, 'x'.repeat(100), mods.slice(0, 1)], ['Ё'.repeat(200), '', mods],
  ];
  const tsCodes = encodes.map(([n, a, m]) => link.encodePresetLink({ name: n as string, author: a as string, mods: m as never }));
  const decodes: unknown[] = [
    ...tsCodes.flatMap((c) => [c.code, c.web, ` <${c.direct}/> `, `\`D2MM://preset/${c.code}\``, `"${c.web}"`]),
    '', null, 'not a link!', 'd2mm://preset/', tsCodes[0].code.slice(0, 20), 'A'.repeat(70000), 'QUJD',
    raw({ v: 2, m: [] }), raw({ v: 1 }), raw([1]), raw({ v: 1, m: Array(501).fill(['a', 'b']) }),
    raw({ v: 1, n: 5, a: ['x'], m: [['$cos', 'slot', null, 4], ['$cos', '', '1'], ['$cos', 's', 99, 'N', 7], [1, 'b'], ['a'], 'x', ['c', 'n', 5], ['c'.repeat(80), 'n'.repeat(400), 's'.repeat(400)]] }),
    raw({ v: 1.0, n: '', m: [] }), tsCodes[0].code + 'A', tsCodes[0].code + 'AB',
  ];
  const readies: unknown[] = [
    null, [], { version: 2, presets: [] }, { version: 1, presets: {} },
    { version: 1, presets: [null, [], { id: 'Bad' }, { id: 'a', ru: '', en: '' }, { id: 'a', ru: 'A', mods: [] },
      { id: 'b', en: ' B ', about: { ru: ' про ', en: 5 }, mods: [{ category: 'huds', name: ' Hud ', style: ' ' }, { category: '', name: 'x' }, null, []] },
      { id: 'b', ru: 'again', mods: [{ category: 'c', name: 'n' }] },
      { id: 'c', ru: 'C', about: [], mods: Array(70).fill({ category: 'c', name: 'n', style: 's' }) },
      ...Array(40).fill(0).map((_, k) => ({ id: `p${k}`, ru: `P${k}`, mods: [{ category: 'c', name: 'n' }] }))] },
  ];
  const manifests: unknown[] = [
    null, 5, [], { format: 'x' }, { format: share.FORMAT }, { format: share.FORMAT, version: 2, mods: [] },
    { format: share.FORMAT, version: '1', mods: {} }, { format: share.FORMAT, version: null, mods: Array(501).fill({}) },
    { format: share.FORMAT, version: 1, name: 'N'.repeat(200), note: 7, author: { name: 'Me' }, createdAt: 1.5, app: '2.9.0', catalogFetchedAt: 'x',
      mods: [
        { kind: 'catalog', name: 'A', categoryId: 'huds', styleLabel: '', fp: 'f'.repeat(80) }, { kind: 'catalog', name: 'B' },
        { kind: 'embedded', name: 'E', file: 'mods/000.vpk', size: 12, fp: null, info: 'i' }, { kind: 'embedded', name: 'E2', file: '../x.vpk' },
        { kind: 'embedded', name: 'E3', file: 'mods/001.vpk', categoryId: '', size: '9' },
        { kind: 'cosmetic', name: 'C', slot: 'courier', itemId: '5', effectId: 3 }, { kind: 'cosmetic', name: 'C2', slot: 'courier', itemId: 5 },
        { kind: 'pack', name: 'P', members: [{ kind: 'catalog', name: 'M', categoryId: 'c' }, { kind: 'pack', name: 'inner', members: [] }, null] },
        { kind: 'pack', name: 'P2' }, { kind: 'missing', name: 'Gone', reason: 'gone' }, { kind: 'what', name: 'W' }, { name: '' }, 'line',
      ] },
    { format: share.FORMAT, version: [1], author: [], mods: [] },
  ];
  const vpk = (k: number) => { const f = path.join(tmp, `mod${k}.vpk`); fs.writeFileSync(f, Buffer.from(`vpk bytes ${k}`.repeat(50 * (k + 1)))); return f; };
  const files = [vpk(0), vpk(1), vpk(2)];
  const entries = (bytes: (f: string) => unknown) => [
    { kind: 'catalog', categoryId: 'huds', name: 'Hud', styleLabel: null, fp: 'abc' },
    { kind: 'embedded', name: 'Mine', categoryId: 'imported', fp: null, info: '', data: bytes(files[0]) },
    { kind: 'pack', name: 'Pack', members: [{ kind: 'embedded', name: 'In', categoryId: 'heroes', data: bytes(files[1]) }, { kind: 'catalog', categoryId: 'c', name: 'n' }] },
    { kind: 'embedded', name: 'Last', categoryId: 'imported', data: bytes(files[2]) },
    { kind: 'cosmetic', name: 'C', slot: 'courier', itemId: '5', effectId: '' },
  ];
  const head = { name: 'Shared', note: 'a note', author: { name: 'Me' }, app: '2.9.0', catalogFetchedAt: 1700000000000 };
  // a zip that lies: an embedded line with nothing behind it, a manifest too big, not a preset at all
  const lying = path.join(tmp, 'lying.d2mm');
  { const z = new AdmZip(); z.addFile('preset.json', Buffer.from(JSON.stringify({ format: share.FORMAT, version: 1, mods: [{ kind: 'embedded', name: 'X', file: 'mods/009.vpk' }, { kind: 'pack', name: 'P', members: [{ kind: 'embedded', name: 'Y', file: 'mods/008.vpk' }] }] }))); z.addFile('mods/008.vpk', Buffer.from('y')); z.writeZip(lying); }
  const big = path.join(tmp, 'big.d2mm');
  { const z = new AdmZip(); z.addFile('preset.json', Buffer.alloc((1 << 20) + 10, 32)); z.writeZip(big); }
  const plainZip = path.join(tmp, 'plain.d2mm');
  { const z = new AdmZip(); z.addFile('readme.txt', Buffer.from('hi')); z.writeZip(plainZip); }
  const badJson = path.join(tmp, 'bad.d2mm');
  { const z = new AdmZip(); z.addFile('preset.json', Buffer.from('{ nope')); z.writeZip(badJson); }
  const notZip = path.join(tmp, 'not.d2mm');
  fs.writeFileSync(notZip, 'not a zip at all');
  const wanted = ['mods/000.vpk', 'mods/001.vpk', 'mods/002.vpk', 'mods/003.vpk', '../x', 'preset.json'];
  const tsOut = path.join(tmp, 'ts.d2mm');
  const rsOut = path.join(tmp, 'rs.d2mm');
  const ops: unknown[][] = [
    ...encodes.map((e) => ['encode', ...e]),
    ...decodes.map((d) => ['decode', d]),
    ...readies.map((r) => ['ready', r]),
    ...manifests.map((m) => ['validate', m]),
    ['write', rsOut, head, entries((f) => ({ $file: f })), 1700000000000],
    ...[rsOut, tsOut, lying, big, plainZip, badJson, notZip, path.join(tmp, 'none.d2mm')].map((f) => ['read', f, wanted]),
  ];
  setLang('en');
  // the TypeScript writes its own file first, so the Rust can read it
  const tsWrite = share.writePresetFile(tsOut, head, entries((f) => fs.readFileSync(f)) as never);
  const list = path.join(tmp, 'presets.json');
  fs.writeFileSync(list, JSON.stringify([['presets.script', 'en', ops]]));
  const [res] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  const answers = res.ok as { ok?: unknown; error?: string }[];
  const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');
  const created = (v: unknown) => JSON.parse(JSON.stringify(v), (k, x) => (k === 'createdAt' && typeof x === 'number' && x > 1e12 ? 'now' : x));
  ops.forEach((op, k) => {
    let want: unknown;
    try {
      const v = ((): unknown => {
        switch (op[0]) {
          case 'encode': return link.encodePresetLink({ name: op[1] as string, author: op[2] as string, mods: op[3] as never });
          case 'decode': return link.decodePresetLink(op[1]);
          case 'ready': return ready.normalizeReady(op[1]);
          case 'validate': return share.validateManifest(op[1]);
          case 'write': return tsWrite;
          case 'read': {
            const f = share.readPresetFile(op[1] as string);
            return { manifest: f.manifest, files: (op[2] as string[]).map((n) => { try { return { sha1: sha(f.readMod(n)) }; } catch (err) { return { error: (err as Error).message }; } }) };
          }
        }
        throw new Error(`no step ${op[0]}`);
      })();
      want = { ok: created(v) };
    } catch (err) { want = { error: (err as Error).message }; }
    const got = answers[k];
    if (op[0] === 'encode') {
      // miniz and zlib pack the same text differently: each side reads the other's link
      const mine = (want as { ok: { code: string } }).ok;
      const theirs = (got.ok as { code: string; web: string; direct: string });
      assert.equal(theirs.web, `https://dota2modmanager.com/p/#${theirs.code}`);
      assert.equal(theirs.direct, `d2mm://preset/${theirs.code}`);
      assert.deepEqual(link.decodePresetLink(theirs.code), link.decodePresetLink(mine.code), `${k} ${JSON.stringify(op)}`);
      return;
    }
    if (op[0] === 'write') {
      const w = got.ok as { size: number; mods: unknown };
      assert.deepEqual(w.mods, (want as { ok: { mods: unknown } }).ok.mods, 'the lines as written');
      assert.ok(w.size > 0 && w.size === fs.statSync(rsOut).size);
      return;
    }
    assert.deepEqual(created(got), want, `${k} ${JSON.stringify(op).slice(0, 300)}`);
  });
  // the Rust's links read back the same in the TypeScript, and the TypeScript's in the Rust
  const rsDecoded = ops.flatMap((op, k) => (op[0] === 'decode' ? [answers[k]] : []));
  assert.ok(rsDecoded.filter((a) => a.ok).length >= 20, 'most pasted forms read');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the presets service in Rust plans, applies and receives presets as the TypeScript one does', { skip }, async () => {
  const { presetsService, packableRecord: packable, presetIsOn } = await import('../src/presets-service.ts');
  const { createCosmetics } = await import('../src/schema-cosmetics.ts');
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { Settings } = await import('../src/settings.ts');
  const { buildVpk, entryAt } = await import('../src/vpk-write.ts');
  const { encodePresetLink } = await import('../src/preset-link.ts');
  const share = await import('../src/preset-share.ts');
  const { withElectron } = await import('./helpers/fake-electron.ts');
  const { createHash } = await import('node:crypto');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-presets-svc-'));
  const pak = (files: Record<string, string>) => buildVpk(Object.entries(files).map(([p, d]) => entryAt(p, Buffer.from(d))));
  const lang: Record<string, Buffer | string> = {
    'pak01_dir.vpk': pak({ 'x.txt': 'valve' }), 'gameinfo.gi': 'gi',
    'pak02_dir.vpk': pak({ 'panorama/layout/hud.xml': 'hud' }),
    'pak03_dir.vpk': pak({ 'models/heroes/axe/axe.vmdl_c': 'own', 'scripts/x.txt': 'x' }),
    'pak04_dir.vpk.off': pak({ 'models/creeps/c.vmdl_c': 'creep' }),
    'pak05_dir.vpk': pak({ 'packed.txt': 'p' }),
    'pak06_dir.vpk': pak({ 'models/heroes/lina/lina.vmdl_c': 'lina' }), 'pak06_000.vpk': 'volume',
  };
  const catalog = { mods: { modsData: {
    huds: [{ name: 'Hud One', styles: [{ label: 'gray', file: 'h.zip', preview: 'h.png' }, { label: 'blue', file: 'hb.zip' }] }],
    creeps: { groups: [{ mods: [{ name: 'Creep A', file: 'c.zip' }] }, {}] },
    heroes: [null, { name: '' }, { name: 'Pack Member', file: 'pm.zip' }, { name: 'Lina Own', file: 'l.zip' }],
    terrains: 'broken',
  } } };
  const identity = (r: { categoryId: string; name: string; styleLabel?: string | null }) => ({ categoryId: r.categoryId, name: r.name, styleLabel: r.styleLabel ?? null, fp: null });
  const recs = [
    { id: 'a', name: 'Hud One', categoryId: 'huds', styleLabel: 'gray', files: [{ root: 'lang', relPath: 'pak02_dir.vpk' }], enabled: true },
    { id: 'b', name: 'My own', categoryId: 'imported', styleLabel: null, files: [{ root: 'lang', relPath: 'pak03_dir.vpk' }], enabled: true },
    { id: 'c', name: 'Creep A', categoryId: 'creeps', styleLabel: null, files: [{ root: 'lang', relPath: 'pak04_dir.vpk' }], enabled: false },
    { id: 'd', name: 'Font', categoryId: 'fonts', styleLabel: null, files: [{ root: 'fonts', relPath: 'x.ttf' }], enabled: true },
    { id: 'e', name: 'Pack', categoryId: 'combined', kind: 'pack', styleLabel: null, files: [{ root: 'lang', relPath: 'pak05_dir.vpk' }], enabled: true,
      members: [{ id: 'm1', name: 'Pack Member', categoryId: 'heroes', styleLabel: null, fp: 'fp1' }, { id: 'm2', name: 'Own member', categoryId: 'imported', info: 'i', fp: 'fp2' }, { id: 'm3', name: 'Gone member', categoryId: 'heroes' }] },
    { id: 'f', name: 'Own 2', categoryId: 'heroes', styleLabel: null, files: [{ root: 'lang', relPath: 'pak06_dir.vpk' }, { root: 'lang', relPath: 'pak06_000.vpk' }], enabled: true },
    { id: 'g', name: 'Helm', categoryId: 'cosmetic', styleLabel: null, files: [], enabled: true, slot: 'item:axe:head', itemId: '5', effectId: 'fx' },
    { id: 'h', name: 'Courier', categoryId: 'cosmetic', styleLabel: null, files: [], enabled: true, slot: 'courier', itemId: '9' },
  ];
  const twin = (side: string) => {
    const root = path.join(tmp, side);
    const game = path.join(root, 'game');
    fs.mkdirSync(path.join(game, 'dota_russian'), { recursive: true });
    for (const [f, data] of Object.entries(lang)) fs.writeFileSync(path.join(game, 'dota_russian', f), data);
    for (const d of ['lib', 'userdata/packs/e']) fs.mkdirSync(path.join(root, d), { recursive: true });
    fs.writeFileSync(path.join(root, 'userdata', 'packs', 'e', 'm2.vpk'), pak({ 'member.txt': 'm2' }));
    return { root, game, lib: path.join(root, 'lib'), ud: path.join(root, 'userdata') };
  };
  const a = twin('ts');
  const b = twin('rs');
  const ownFp = new Installer({ userDataDir: a.ud, getGamePath: () => a.game, getLangSuffix: () => 'russian' }).analyzeRecord(recs[1] as never)!.fp;
  const presets = [
    { id: 'P1', name: 'All', updatedAt: 1, mods: [recs[0], recs[1], recs[4], recs[5], recs[2]].map(identity),
      picks: [{ slot: 'item:axe:head', itemId: '5', name: 'Helm', effectId: 'fx' }, { slot: 'courier', itemId: '10', name: 'Other courier', effectId: '' }] },
    { id: 'P2', name: 'Hud only', updatedAt: 1, mods: [identity(recs[0]), { categoryId: 'heroes', name: 'Deleted', styleLabel: null, fp: null }] },
    { id: 'P3', name: 'Received', updatedAt: 1, modIds: [], wanted: [
      { kind: 'catalog', categoryId: 'huds', name: 'Hud One', styleLabel: 'gray', fp: null }, { kind: 'catalog', categoryId: 'creeps', name: 'Creep A', styleLabel: null, fp: null },
      { kind: 'catalog', categoryId: 'huds', name: 'Hud One', styleLabel: 'blue', fp: null }, { kind: 'catalog', categoryId: 'x', name: 'Unknown', styleLabel: null, fp: null },
      { kind: 'embedded', name: 'Mine', file: 'mods/000.vpk', categoryId: 'imported', fp: ownFp }, { kind: 'embedded', name: 'Theirs', file: 'mods/001.vpk', categoryId: 'imported', fp: 'nope' },
      { kind: 'cosmetic', name: 'Helm', slot: 'item:axe:head', itemId: '5', effectId: 'fx' }, { kind: 'cosmetic', name: 'Helm plain', slot: 'item:axe:head', itemId: '5', effectId: '' },
      { kind: 'missing', name: 'Left out', reason: 'r' },
      { kind: 'pack', name: 'P', members: [{ kind: 'catalog', categoryId: 'heroes', name: 'Pack Member', styleLabel: null, fp: null }, { kind: 'embedded', name: 'E', file: 'mods/002.vpk', fp: null }] },
    ], source: { note: '', author: '', file: null, importedAt: 1 } },
  ];
  for (const s of [a, b]) {
    fs.writeFileSync(path.join(s.lib, 'manifest.json'), JSON.stringify({ installed: recs, presets }, null, 2));
    fs.writeFileSync(path.join(s.ud, 'settings.json'), JSON.stringify({ dotaGamePath: s.game }));
  }
  // what arrives from outside: a link, files with and without bytes in them, and a file that is not one
  const files = path.join(tmp, 'in');
  fs.mkdirSync(files);
  const linkCode = encodePresetLink({ name: 'From a link', author: 'friend', mods: [{ categoryId: 'huds', name: 'Hud One', styleLabel: 'gray' }, { kind: 'cosmetic', slot: 'courier', itemId: '3', name: 'C' }] }).web;
  const emptyLink = encodePresetLink({ name: 'Nothing', mods: [] }).code;
  const withBytes = path.join(files, 'bytes.d2mm');
  share.writePresetFile(withBytes, { name: 'Bytes', note: 'n', author: { name: 'Me' } }, [{ kind: 'embedded', name: 'Own', categoryId: 'imported', data: Buffer.from('vpk') }, { kind: 'catalog', categoryId: 'huds', name: 'Hud One', styleLabel: 'gray' }]);
  const idsOnly = path.join(files, 'ids.d2mm');
  share.writePresetFile(idsOnly, { name: 'Ids' }, [{ kind: 'pack', name: 'P', members: [{ kind: 'catalog', categoryId: 'c', name: 'n' }] }]);
  const empty = path.join(files, 'empty.d2mm');
  share.writePresetFile(empty, { name: 'Empty' }, []);
  const notOne = path.join(files, 'not.d2mm');
  fs.writeFileSync(notOne, 'nope');
  const ops: unknown[][] = [
    ['fps'], ['catalogSize'], ['packable'], ['entries', 'P1'], ['entries', 'P2'], ['link', 'P1'], ['link', 'P2'], ['status', 'P3'], ['status', 'P1'],
    ['isOn', 'P1'], ['state', 'P1'], ['state', 'P2'], ['state', 'P3'],
    ['apply', 'P1', true], ['isOn', 'P1'], ['state', 'P1'], ['state', 'P2'], ['list'],
    ['apply', 'P2', false], ['state', 'P1'], ['state', 'P2'], ['isOn', 'P2'], ['list'],
    ['apply', 'P1', false], ['state', 'P1'], ['list'],
    ['importLink', linkCode], ['importLink', 'garbage'], ['importLink', emptyLink],
    ['importFile', withBytes], ['importFile', idsOnly], ['importFile', empty], ['importFile', notOne], ['importFile', path.join(files, 'none.d2mm')],
    ['presets'],
    ['pack', 'Packed', ['b', 'f', 'd', 'zz']], ['pack', 'One', ['a']], ['list'], ['packable'],
  ];
  const list = path.join(tmp, 'service.json');
  fs.writeFileSync(list, JSON.stringify([['presets-service.script', 'en', b.game, 'russian', b.lib, b.ud, catalog, ops]]));
  const [res] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  const answers = res.ok as { ok?: unknown; error?: string }[];
  const plainOf = (v: unknown, ids: Map<string, string>) => JSON.parse(JSON.stringify(v ?? null), (k, x) => {
    if (typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(x)) { if (!ids.has(x)) ids.set(x, `#${ids.size}`); return ids.get(x); }
    if ((k === 'updatedAt' || k === 'importedAt' || k === 'installedAt') && typeof x === 'number' && x > 1e12) return 'now';
    if (typeof x === 'string') return x.split(a.root).join('<root>').split(b.root).join('<root>').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>');
    return x;
  });
  setLang('en');
  const inst = new Installer({ userDataDir: a.ud, getGamePath: () => a.game, getLangSuffix: () => 'russian' });
  const lib = new Library(a.lib);
  const st = new Settings(a.ud);
  const cos = createCosmetics({ library: lib, settings: st as never, gamePath: () => a.game, vanilla: () => '', refresh: () => {} });
  const deployed: string[] = [];
  const svc = presetsService({
    catalog: { load: async () => catalog as never }, installer: inst as never, library: lib, settings: st as never,
    schemaService: { refreshInBackground: async () => null, pickCosmetic: (s, i, n, e, o) => cos.pickCosmetic(s, i, n, e, o) },
    deployAndApply: (p) => { deployed.push(p.id); },
  });
  const sha = (buf: Buffer) => createHash('sha1').update(buf).digest('hex');
  const tsIds = new Map<string, string>();
  const rsIds = new Map<string, string>();
  for (const [k, op] of ops.entries()) {
    let want: unknown;
    try {
      const preset = () => { const p = lib.getPreset(op[1] as string); if (!p) throw new Error('no preset'); return p; };
      const v = await (async (): Promise<unknown> => {
        switch (op[0]) {
          case 'fps': return [...svc.installedFpIndex()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
          case 'catalogSize': return (await svc.catalogIndex()).size;
          case 'packable': return lib.list().map((r) => packable(r));
          case 'entries': {
            const entries = await svc.presetShareEntries(preset());
            const data: unknown[] = [];
            const sum = (e: { loadData?: () => Buffer }) => { if (!e.loadData) { data.push(null); return; } try { data.push(sha(e.loadData())); } catch (err) { data.push({ error: (err as Error).message }); } };
            for (const e of entries) { sum(e as never); if (e.kind === 'pack') e.members.forEach((m) => sum(m as never)); }
            return { plan: svc.planShape(entries), lines: entries, data };
          }
          case 'link': return svc.presetLinkMods(preset(), await svc.catalogIndex());
          case 'status': return await svc.sharedPresetStatus(preset(), await svc.catalogIndex());
          case 'isOn': return presetIsOn(lib, preset());
          case 'state': return svc.presetState(preset());
          case 'apply': { deployed.length = 0; const errors = await svc.applyPreset(preset(), { picks: !!op[2] }); return { errors }; }
          case 'importLink': return svc.importPresetLink(op[1] as string);
          case 'importFile': return withElectron({ app: { getPath: () => a.ud } }, () => svc.importPresetFile(op[1] as string));
          case 'pack': { deployed.length = 0; const p = svc.packFromRecords(op[1] as string, op[2] as string[]); return { pack: p, deployed: [...deployed] }; }
          case 'list': return lib.list();
          case 'presets': return lib.listPresets();
        }
        throw new Error(`no step ${op[0]}`);
      })();
      want = { ok: plainOf(v, tsIds) };
    } catch (err) { want = { error: (err as Error).message }; }
    const got = answers[k];
    const norm = 'error' in got ? got : { ok: plainOf(got.ok, rsIds) };
    // whether the table needs a build is the caller's in Rust; the TypeScript started it itself
    if (op[0] === 'apply' && norm.ok) delete (norm.ok as { schemaTouched?: unknown }).schemaTouched;
    assert.deepEqual(norm, want, `${k} ${JSON.stringify(op).slice(0, 200)}`);
  }
  const at = (name: string, arg?: unknown) => answers[ops.findIndex((op) => op[0] === name && (arg === undefined || op[1] === arg))].ok as Record<string, unknown>;
  assert.deepEqual(at('status', 'P3'), { installed: 4, download: 2, embedded: 2, free: 1, unavailable: ['Unknown', 'Left out'] });
  const plan = at('entries', 'P1') as { plan: { kind: string }[]; data: unknown[] };
  assert.deepEqual(plan.plan.map((e) => e.kind), ['catalog', 'embedded', 'pack', 'embedded', 'catalog', 'cosmetic', 'cosmetic']);
  assert.equal(plan.data.filter((d) => typeof d === 'string').length, 3, 'two own mods merged and a pack member read');
  assert.deepEqual((at('link', 'P1') as { skipped: string[] }).skipped, ['My own', 'Own member', 'Gone member', 'Own 2']);
  assert.ok((at('importFile', withBytes) as { ok?: boolean }).ok && (at('importLink', linkCode) as { ok?: boolean }).ok);
  assert.ok((at('pack', 'Packed') as { pack: unknown }).pack && !(at('pack', 'One') as { pack: unknown }).pack);
  const touched = ops.flatMap((op, k) => (op[0] === 'apply' ? [(answers[k].ok as { schemaTouched: boolean }).schemaTouched] : []));
  assert.deepEqual(touched, [true, false, false], 'the looks touch the table; mods with no item blocks do not');
  const sideTree = (g: string) => (fs.readdirSync(g, { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(g, f)).isFile()).sort()
    .map((f) => `${f.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>')} ${sha(fs.readFileSync(path.join(g, f)))}`);
  assert.deepEqual(sideTree(b.game), sideTree(a.game));
  assert.deepEqual(sideTree(path.join(b.ud, 'shared-presets')).length, 1, 'the file with bytes in it is kept until Install');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('putting a preset on in Rust does what the TypeScript does: downloads, own mods, received files, cursors, imports', { skip }, async () => {
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { Settings } = await import('../src/settings.ts');
  const { createHarvest } = await import('../src/schema-harvest.ts');
  const { createAdopt } = await import('../src/adopt.ts');
  const { createCursors } = await import('../src/cursors.ts');
  const { createCosmetics } = await import('../src/schema-cosmetics.ts');
  const { presetsService } = await import('../src/presets-service.ts');
  const { createPresetInstall } = await import('../src/preset-install.ts');
  const { installVpkBuffer } = await import('../src/import.ts');
  const { buildVpk, entryAt } = await import('../src/vpk-write.ts');
  const share = await import('../src/preset-share.ts');
  const { createHash } = await import('node:crypto');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-preset-install-'));
  const pak = (files: Record<string, string>) => buildVpk(Object.entries(files).map(([p, d]) => entryAt(p, Buffer.from(d, 'latin1'))));
  const item = (id: string, name: string, model: string) => [`\t\t"${id}"`, '\t\t{', `\t\t\t"name"\t"${name}"`, '\t\t\t"prefab"\t"wearable"', `\t\t\t"model_player"\t"${model}"`, '\t\t}'];
  const table = (rows: string[][]) => ['"items_game"', '{', '\t"items"', '\t{', ...rows.flat(), '\t}', '}', ''].join('\n');
  const jugg = 'models/heroes/juggernaut/juggernaut.vmdl';
  const axe = 'models/items/axe/axe_helm.vmdl';
  const vanilla = table([item('4100', 'Blade', jugg), item('4200', 'Helm', axe)]);
  const both = table([item('4100', 'Blade of the pack', jugg), item('4200', 'Helm of the pack', axe)]);
  const twoHeroes = pak({ 'models/heroes/juggernaut/juggernaut.vmdl_c': 'j', 'materials/models/heroes/juggernaut/j.vmat_c': 'jm',
    'models/items/axe/axe_helm.vmdl_c': 'a', 'particles/units/heroes/hero_axe/x.vpcf_c': 'p', 'scripts/items/items_game.txt': both });
  const lang = (f: string) => [{ root: 'lang', relPath: f }];
  const catalog = { mods: { modsData: {
    huds: [{ name: 'Hud One', styles: [{ label: 'gray', file: 'hud-gray.zip', preview: 'h.png' }] }],
    heroes: [{ name: 'Lina Look', file: 'lina.zip' }, { name: 'No file' }],
    cursors: [{ name: 'Cursor B', file: 'cursor-b.zip' }],
  } } };
  const downloads: Record<string, string> = {};
  const dl = path.join(tmp, 'downloads');
  fs.mkdirSync(dl);
  for (const [ref, files] of Object.entries<Record<string, string>>({ 'hud-gray.zip': { 'panorama/hud.xml': 'hud' }, 'lina.zip': { 'models/heroes/lina/lina.vmdl_c': 'lina' }, 'cursor-b.zip': { 'cursor.txt': 'b' } })) {
    downloads[ref] = path.join(dl, ref.replace('.zip', '.vpk'));
    fs.writeFileSync(downloads[ref], pak(files));
  }
  const recs = [
    { id: 'own', name: 'My own', categoryId: 'imported', styleLabel: null, enabled: true, files: lang('pak30_dir.vpk'), installedAt: 3 },
    { id: 'curA', name: 'Cursor A', categoryId: 'cursors', styleLabel: null, enabled: true, files: [{ root: 'cursor', relPath: 'cursor_a.cur' }], installedAt: 5 },
    { id: 'curC', name: 'Cursor C', categoryId: 'cursors', styleLabel: null, enabled: true, files: [{ root: 'cursor', relPath: 'cursor_c.cur' }], installedAt: 2 },
    { id: 'w1', name: 'Rain', categoryId: 'cosmetic', styleLabel: null, enabled: true, files: [], slot: 'weather', itemId: '5' },
    { id: 'w2', name: 'Snow', categoryId: 'cosmetic', styleLabel: null, enabled: true, files: [], slot: 'weather', itemId: '6' },
  ];
  const presets = [
    { id: 'Own', name: 'Own', updatedAt: 1, mods: [
      { categoryId: 'huds', name: 'Hud One', styleLabel: 'gray', fp: null }, { categoryId: 'imported', name: 'Gone own', styleLabel: null, fp: null },
      { categoryId: 'heroes', name: 'No file', styleLabel: null, fp: null }, { categoryId: 'heroes', name: 'Nowhere', styleLabel: null, fp: null },
      { categoryId: 'imported', name: 'My own', styleLabel: null, fp: null }], picks: [{ slot: 'courier', itemId: '3', name: 'Pet', effectId: '' }] },
    { id: 'Link', name: 'From a link', updatedAt: 1, modIds: [], wanted: [
      { kind: 'catalog', categoryId: 'heroes', name: 'Lina Look', styleLabel: null, fp: null }, { kind: 'catalog', categoryId: 'cursors', name: 'Cursor B', styleLabel: null, fp: null },
      { kind: 'catalog', categoryId: 'x', name: 'Unknown', styleLabel: null, fp: null }, { kind: 'cosmetic', name: 'Helm', slot: 'item:axe:head', itemId: '4200', effectId: 'fx' },
      { kind: 'embedded', name: 'Not here', file: 'mods/000.vpk', fp: null }, { kind: 'missing', name: 'Left out', reason: 'too big' }, { kind: 'what', name: 'Odd' },
    ], source: { note: '', author: '', file: null, importedAt: 1 } },
  ];
  const twin = (side: string) => {
    const root = path.join(tmp, side);
    const dir = path.join(root, 'game', 'dota_russian');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(root, 'game', 'dota', 'resource', 'cursor'), { recursive: true });
    fs.writeFileSync(path.join(root, 'game', 'dota', 'pak01_dir.vpk'), pak({ 'scripts/items/items_game.txt': vanilla }));
    fs.writeFileSync(path.join(dir, 'gameinfo.gi'), 'gi');
    fs.writeFileSync(path.join(dir, 'pak30_dir.vpk'), pak({ 'models/heroes/axe/axe.vmdl_c': 'own' }));
    fs.writeFileSync(path.join(root, 'game', 'dota', 'resource', 'cursor', 'cursor_a.cur'), 'A');
    fs.writeFileSync(path.join(root, 'game', 'dota', 'resource', 'cursor', 'cursor_c.cur'), 'C');
    for (const d of ['lib', 'userdata', 'in']) fs.mkdirSync(path.join(root, d), { recursive: true });
    fs.writeFileSync(path.join(root, 'userdata', 'settings.json'), JSON.stringify({ dotaGamePath: path.join(root, 'game') }));
    fs.writeFileSync(path.join(root, 'vanilla.txt'), vanilla, 'latin1');
    // a received file with bytes in it, parked the way importPresetFile parks it
    const parked = path.join(root, 'userdata', 'shared-presets', 'Recv.d2mm');
    fs.mkdirSync(path.dirname(parked), { recursive: true });
    share.writePresetFile(parked, { name: 'Received' }, [
      { kind: 'embedded', name: 'pak77', categoryId: 'imported', data: twoHeroes }, { kind: 'embedded', name: 'Sender name', categoryId: 'imported', data: pak({ 'models/heroes/axe/axe.vmdl_c': 'own' }) },
      { kind: 'pack', name: 'Their pack', members: [{ kind: 'catalog', categoryId: 'huds', name: 'Hud One', styleLabel: 'gray' }, { kind: 'embedded', name: 'Lone', categoryId: 'imported', data: pak({ 'models/heroes/sven/sven.vmdl_c': 's' }) }] },
    ] as never);
    const recv = { ...share.readPresetFile(parked).manifest };
    const own = new Installer({ userDataDir: path.join(root, 'userdata'), getGamePath: () => path.join(root, 'game'), getLangSuffix: () => 'russian' }).analyzeRecord(recs[0] as never)!.fp;
    // the second embedded mod is one already on disk, by its fingerprint
    (recv.mods[1] as { fp: string | null }).fp = own;
    const all = [...presets, { id: 'Recv', name: 'Received', updatedAt: 1, modIds: [], wanted: recv.mods, source: { note: '', author: '', file: parked, importedAt: 1 } },
      { id: 'Gone', name: 'Gone file', updatedAt: 1, modIds: [], wanted: recv.mods, source: { note: '', author: '', file: path.join(root, 'nope.d2mm'), importedAt: 1 } }];
    fs.writeFileSync(path.join(root, 'lib', 'manifest.json'), JSON.stringify({ installed: recs, presets: all }, null, 2));
    return { root, game: path.join(root, 'game'), lib: path.join(root, 'lib'), ud: path.join(root, 'userdata'), vanilla: path.join(root, 'vanilla.txt') };
  };
  const a = twin('ts');
  const b = twin('rs');
  const results = (side: string) => [
    { source: 'two.zip', files: lang('pak40_dir.vpk'), name: 'pak40', merged: 2 }, { source: 'bad.zip', error: 'broken' },
    { source: 'one.zip', files: lang('pak41_dir.vpk'), name: 'Named one' }, { source: 'quiet.zip', error: '' }, side,
  ].filter((r) => typeof r !== 'string');
  for (const s of [a, b]) {
    fs.writeFileSync(path.join(s.game, 'dota_russian', 'pak40_dir.vpk'), twoHeroes);
    fs.writeFileSync(path.join(s.game, 'dota_russian', 'pak41_dir.vpk'), pak({ 'models/heroes/axe/axe.vmdl_c': 'imported' }));
  }
  const ops: unknown[][] = [
    ['reconcile'], ['list'], ['cursorsOff', 'curA'], ['list'], ['cosmeticsOff', 'w1'], ['masterCursors', false], ['masterCursors', true],
    ['fromCatalog', { categoryId: 'huds', name: 'Hud One', styleLabel: 'gray' }], ['fromCatalog', { categoryId: 'heroes', name: 'No file', styleLabel: null }],
    ['own', 'Own'], ['list'], ['presets'], ['own', 'Own'],
    ['resolve', 'Link'], ['list'], ['resolve', 'Gone'], ['resolve', 'Recv'], ['list'], ['presets'],
    ['register', results('x')], ['list'],
    ['adopt', lang('pak30_dir.vpk'), 'pak30', null], ['list'],
  ];
  const list = path.join(tmp, 'install.json');
  fs.writeFileSync(list, JSON.stringify([['preset-install.script', 'en', b.game, 'russian', b.lib, b.ud, catalog, downloads, b.vanilla, '', ops]]));
  const [res] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  const answers = res.ok as { ok?: unknown; error?: string; progress?: unknown[]; deployed?: unknown[] }[];
  const plainOf = (v: unknown, ids: Map<string, string>) => JSON.parse(JSON.stringify(v ?? null), (k, x) => {
    if (typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(x)) { if (!ids.has(x)) ids.set(x, `#${ids.size}`); return ids.get(x); }
    if ((k === 'updatedAt' || k === 'importedAt' || k === 'installedAt') && typeof x === 'number' && x > 1e12) return 'now';
    if (typeof x === 'string') return x.split(a.root).join('<root>').split(b.root).join('<root>');
    return x;
  });
  setLang('en');
  const inst = new Installer({ userDataDir: a.ud, getGamePath: () => a.game, getLangSuffix: () => 'russian' });
  (inst as unknown as { install: (o: { fileRef: string }) => Promise<unknown> }).install = async ({ fileRef }) => installVpkBuffer(inst, fs.readFileSync(downloads[fileRef]));
  const lib = new Library(a.lib);
  const st = new Settings(a.ud);
  const harvest = createHarvest({ library: lib, installer: inst as never, gamePath: () => a.game, vanilla: () => fs.readFileSync(a.vanilla, 'latin1') });
  const adopt = createAdopt({ installer: inst as never, library: lib, schemaService: { harvest: harvest.harvest, split: harvest.split, refresh: () => null } as never });
  const cursors = createCursors({ installer: inst as never, library: lib, settings: st as never });
  const cos = createCosmetics({ library: lib, settings: st as never, gamePath: () => a.game, vanilla: () => vanilla, refresh: () => {} });
  let deployed: string[] = [];
  let progress: unknown[] = [];
  let built = false;
  let master = false;
  const schemaService = { refreshInBackground: async () => { built = true; }, pickCosmetic: (s: string, i: string, n: string, e: string, o: { write: boolean }) => cos.pickCosmetic(s, i, n, e, o) };
  const presetsSvc = presetsService({ catalog: { load: async () => catalog as never }, installer: inst as never, library: lib, settings: st as never, schemaService, deployAndApply: (p) => { deployed.push(p.id); } });
  const install = createPresetInstall({ installer: inst as never, library: lib, schemaService: schemaService as never, presets: presetsSvc as never,
    adoptImportedFiles: adopt.adoptImportedFiles, afterDeployMaster: () => { master = true; }, disableOtherCursors: cursors.disableOtherCursors,
    sendProgress: (p: unknown) => { progress.push(p); }, blocked: () => null } as never);
  const sha = (buf: Buffer) => createHash('sha1').update(buf).digest('hex');
  const tsIds = new Map<string, string>();
  const rsIds = new Map<string, string>();
  for (const [k, op] of ops.entries()) {
    let want: unknown;
    deployed = []; progress = []; built = false; master = false;
    try {
      const preset = () => { const p = lib.getPreset(op[1] as string); if (!p) throw new Error('no preset'); return p; };
      const cat = await presetsSvc.catalogIndex();
      const v = await (async (): Promise<unknown> => {
        switch (op[0]) {
          case 'own': { const answer = await install.applyOwn(preset()); return { answer, schema: built, afterMaster: master }; }
          case 'resolve': { const answer = await install.resolve(preset() as never); return { answer, schema: built, afterMaster: master }; }
          case 'fromCatalog': { const errors: string[] = []; const rec = await install.installFromCatalog(op[1] as never, cat, errors); return { rec, errors }; }
          case 'adopt': return adopt.adoptImportedFiles({ files: op[1] as never, name: op[2] as string, fileRef: op[3] as string });
          case 'register': { const steps: unknown[] = []; const r = await adopt.registerImportResults(op[1] as never, (x, y) => steps.push([x, y])); return { ...r, steps }; }
          case 'cursorsOff': return cursors.disableOtherCursors(op[1] as string);
          case 'cosmeticsOff': return cursors.disableOtherCosmetics(lib.find(op[1] as string)!);
          case 'masterCursors': cursors.applyMasterToCursors(!!op[1]); return null;
          case 'reconcile': cursors.reconcileCursors(); return null;
          case 'list': return lib.list();
          case 'presets': return lib.listPresets();
        }
        throw new Error(`no step ${op[0]}`);
      })();
      want = { ok: plainOf(v, tsIds), progress: plainOf(progress, tsIds), deployed: plainOf(deployed, tsIds) };
    } catch (err) { want = { error: (err as Error).message }; }
    const got = answers[k];
    const norm = 'error' in got ? got : { ok: plainOf(got.ok, rsIds), progress: plainOf(got.progress, rsIds), deployed: plainOf(got.deployed, rsIds) };
    // the TypeScript builds the table and runs what follows the master switch itself; the Rust says it has to
    if ((op[0] === 'own' || op[0] === 'resolve') && norm.ok && want && (want as { ok?: unknown }).ok) {
      const [g, w] = [norm.ok as Record<string, unknown>, (want as { ok: Record<string, unknown> }).ok];
      assert.ok(g.schema || !w.schema, `${k} a build the TypeScript started is asked for`);
      delete g.schema; delete w.schema;
    }
    assert.deepEqual(norm, want, `${k} ${JSON.stringify(op).slice(0, 200)}`);
  }
  const tree = (g: string) => (fs.readdirSync(g, { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(g, f)).isFile()).sort()
    .map((f) => `${f.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>')} ${sha(fs.readFileSync(path.join(g, f)))}`).sort();
  assert.deepEqual(tree(b.game), tree(a.game));
  assert.deepEqual(tree(b.ud).filter((f) => !f.startsWith('settings.json')), tree(a.ud).filter((f) => !f.startsWith('settings.json')));
  const resolved = answers[ops.findIndex((op) => op[0] === 'resolve' && op[1] === 'Recv')].ok as { answer: { ok?: boolean; installed?: number } };
  assert.ok(resolved.answer.ok && (resolved.answer.installed ?? 0) >= 3, JSON.stringify(resolved));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the mirror chain, requests, downloads and the catalog signature in Rust answer as the TypeScript does', { skip }, async () => {
  const http = await import('node:http');
  const crypto = await import('node:crypto');
  const { spawn } = await import('node:child_process');
  const net = await import('../src/net.ts');
  const mirrors = await import('../src/net-mirrors.ts');
  const signature = await import('../src/catalog-signature.ts');
  type Handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void;

  const data = crypto.randomBytes(300000);
  const digest = crypto.createHash('sha256').update(data).digest('hex');
  const sha = (b: Buffer) => crypto.createHash('sha1').update(b).digest('hex');
  const ranged = (bytes: Buffer): Handler => (req, res) => {
    const m = /^bytes=(\d+)-/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { 'content-length': bytes.length }); res.end(bytes); return; }
    const from = Number(m[1]);
    res.writeHead(206, { 'content-length': bytes.length - from, 'content-range': `bytes ${from}-${bytes.length - 1}/${bytes.length}` });
    res.end(bytes.subarray(from));
  };
  const handlers: Record<string, Handler> = {
    good: ranged(data),
    whole: (req, res) => { res.writeHead(200, { 'content-length': data.length }); res.end(data); }, // ignores Range
    wrong: ranged(crypto.randomBytes(1000)),
    down: (req, res) => { res.writeHead(503); res.end('no'); },
    lacking: (req, res) => { res.writeHead(404); res.end('none here'); },
    json: (req, res) => { const t = JSON.stringify({ mods: [1, 2, 'ж'] }); res.writeHead(200, { 'content-length': Buffer.byteLength(t) }); res.end(t); },
    trickle: (req, res) => {
      res.writeHead(200, { 'content-length': 120 });
      let sent = 0;
      const tick = setInterval(() => { res.write('x'.repeat(10)); if (++sent === 12) { clearInterval(tick); res.end(); } }, 50);
      res.on('close', () => clearInterval(tick));
    },
    stuck: (req, res) => { res.writeHead(200, { 'content-length': 100 }); res.write('x'); },
  };
  const servers: import('node:http').Server[] = [];
  const port: Record<string, number> = {};
  for (const [name, h] of Object.entries(handlers)) {
    const s = http.createServer(h);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    port[name] = (s.address() as import('node:net').AddressInfo).port;
    servers.push(s);
  }
  // a port nothing listens on: one taken and given back
  const gone = http.createServer();
  await new Promise<void>((r) => gone.listen(0, '127.0.0.1', () => r()));
  port.gone = (gone.address() as import('node:net').AddressInfo).port;
  await new Promise((r) => gone.close(r));

  type At = { host: string; prefix: string; origin?: boolean; smallOnly?: boolean };
  const at = (name: string, extra: Partial<At> = {}): At => ({ host: `127.0.0.1:${port[name]}`, prefix: `http://127.0.0.1:${port[name]}/`, ...extra });
  const tsMirror = (m: At) => ({ host: m.host, map: (u: string) => u.replace(net.RAW_HOST, m.prefix), origin: m.origin, smallOnly: m.smallOnly });
  const RAW = `${net.RAW_HOST}h6rd/Dota2PornFxWeb/main/assets/files/heroes/Mod.zip`;
  const JSON_URL = `${net.RAW_HOST}h6rd/Dota2PornFxWeb/main/assets/data/mods.json`;
  const RELEASE = 'https://github.com/dota2modmanager/dota2-mod-manager/releases/download/v1/app.exe';
  const keys = crypto.generateKeyPairSync('ed25519');
  const spki = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const payload = Buffer.from('{"mods":[]}\n');
  const sig = crypto.sign(null, payload, keys.privateKey).toString('base64');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-net-'));
  const payloadFile = path.join(tmp, 'payload.json');
  fs.writeFileSync(payloadFile, payload);
  const pf = { $file: payloadFile };
  const twin = (side: string, f: string) => path.join(tmp, side, f);

  const urls = [RAW, JSON_URL, RELEASE, 'https://example.com/x.zip', `${net.RAW_HOST}dota2modmanager/dota2-mod-manager/main/config/app.json`, `${net.RAW_HOST}a/b`];
  const configured = [
    { base: 'https://gitlab.com/r/m/-/raw/main/assets/files/', host: 'gitlab.com' },
    { base: 'https://x.org:8443/a/', host: 'x.org:8443' }, { base: 'https://x.org:443/a/', host: 'x.org' },
    { base: 'http://x.org/a/', host: 'x.org' }, { base: 'https://u:p@x.org/a/', host: 'x.org' }, { base: 'https://x.org/a/?q', host: 'x.org' },
    { base: 'https://x.org/a/?', host: 'x.org' }, { base: 'https://x.org/a', host: 'x.org' }, { base: 'https://X.org/a/', host: 'X.ORG' },
    { base: 'https://raw.githubusercontent.com/a/', host: 'raw.githubusercontent.com' }, { base: 'https://y.org/a/', host: 'x.org' },
    { base: 'https://x.org/a/#h', host: 'x.org' }, { base: 5, host: 'x.org' }, null, 'x', { base: 'https://x.org/a/', host: 'x.org/' },
  ];
  const ops: unknown[][] = [
    ...urls.flatMap((u) => [['mirrorsFor', u, false, false], ['mirrorsFor', u, true, false], ['entriesFor', u, true, true]]),
    ...configured.map((m) => ['wellFormed', m]),
    ['apply', [configured[0], { base: 'https://bad', host: 'x' }, { base: 'https://h.co/c/', host: 'h.co' }]],
    ['mirrorsFor', RAW, true, false], ['pictures'], ['apply', []], ['mirrorsFor', RAW, false, false], ['pictures'],
    ['fail', 'ghproxy.net', 'HTTP 500'], ['fail', 'ghproxy.net', 'HTTP 502'], ['stoodDown', 'ghproxy.net'], ['health'],
    ['fail', 'ghproxy.net', 'HTTP 503'], ['stoodDown', 'ghproxy.net'], ['stall', 'cdn.jsdelivr.net', 'timed out'], ['health'],
    ['live', JSON_URL, true], ['success', 'ghproxy.net'], ['health'], ['reset'], ['health'],
    // the network itself
    ['setMirrors', [at('down', { origin: true }), at('json')]], ['text', JSON_URL, {}], ['health'],
    ['setMirrors', [at('lacking'), at('lacking', { host: 'second' }), at('json', { smallOnly: true })]], ['text', JSON_URL, {}],
    ['setMirrors', [at('lacking', { origin: true }), at('json')]], ['text', JSON_URL, {}],
    ['setMirrors', [at('lacking'), at('down')]], ['text', JSON_URL, {}], ['health'],
    ['setMirrors', [at('gone'), at('down')]], ['text', JSON_URL, {}],
    ['setMirrors', [at('gone')]], ['text', JSON_URL, {}],
    ['setMirrors', [at('json')]], ['text', JSON_URL, { exclude: [`127.0.0.1:${port.json}`] }], ['text', `http://127.0.0.1:${port.json}/direct`, { trustedOnly: true }], ['text', JSON_URL.replace(net.RAW_HOST, `http://127.0.0.1:${port.down}/`), {}],
    ['setMirrors', [at('good', { origin: true })]], ['download', RAW, 'a.zip', { expect: digest }],
    ['setMirrors', [at('wrong'), at('good')]], ['download', RAW, 'b.zip', { expect: digest, published: true }], ['health'],
    ['setMirrors', [at('wrong', { origin: true }), at('wrong', { host: 'other' })]], ['download', RAW, 'c.zip', { expect: digest, published: true }],
    ['setMirrors', [at('wrong'), at('wrong', { host: 'other' })]], ['download', RAW, 'd.zip', { expect: digest, published: true }],
    ['setMirrors', [at('good')]], ['download', RAW, 'resumed.zip', { expect: digest }],
    ['setMirrors', [at('whole')]], ['download', RAW, 'restarted.zip', {}],
    ['setMirrors', [at('down')]], ['download', RAW, 'e.zip', {}],
    // a catalog mod's archive into the download cache: fetched, reused, fetched again when cut short or disowned
    ['lang', 'en'],
    ...[5, null, '', '  ', 'http://127.0.0.1:8080', ' HTTPS://Proxy.Example:3128/ ', 'http:///x', 'http://h:0', 'http://h:65535', 'http://h:65536', 'socks5://h:1', 'ftp://h',
      'http://u:p@h:1', 'http://h:1/path', 'http://h:1/?', 'http://h:1/?q=1', 'http://h:1#x', 'http://h', 'https://h:443', 'http://[::1]:8080', 'http://h:12ab', 'http://', 'h:8080', 'http://h :1'].map((v) => ['proxy', v]),
    ['setMirrors', [at('good', { origin: true })]], ['fetchMod', 'heroes', 'Mod.zip', 'Mod', {}], ['fetchMod', 'heroes', 'Mod.zip', null, {}],
    ['cut', 'heroes/Mod.zip'], ['fetchMod', 'heroes', 'Mod.zip', 'Mod', {}],
    ['fetchMod', 'heroes', 'Mod.zip', 'Mod', { 'heroes/Mod.zip': 'f'.repeat(64) }],
    ['setMirrors', [at('wrong'), at('wrong', { host: 'other' })]], ['fetchMod', 'heroes', 'Other.zip', 'Other', { 'heroes/Other.zip': digest }],
    ['setMirrors', [at('down')]], ['fetchMod', 'sounds', 'a%2F..%2Fb<c>.zip', '', {}],
    ['fetchMod', 'skins', `http://127.0.0.1:${port.good}/direct/Thing%20(v2).zip?x=1`, 'Thing', {}],
    // the catalog signature
    ['sig', pf, sig, spki], ['sig', pf, sig.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')), spki],
    ['sig', pf, ` ${sig.slice(0, 40)}\n${sig.slice(40)} `, spki], ['sig', pf, '', spki],
    ['sig', pf, sig, ''], ['sig', pf, sig, 'garbage'], ['sig', pf, sig],
    ['sig', pf, 'AAAA', spki], ['sig', pf, sig.replace(/=+$/, ''), spki],
  ];
  // downloads cut short, to be resumed: the first third of the file already on disk
  for (const side of ['ts', 'rs']) {
    fs.mkdirSync(path.join(tmp, side), { recursive: true });
    fs.writeFileSync(twin(side, 'resumed.zip.part'), data.subarray(0, 100000));
    fs.writeFileSync(twin(side, 'restarted.zip.part'), data.subarray(0, 100000));
  }
  const local = (side: string, op: unknown[]) => {
    if (op[0] === 'download') return [op[0], op[1], twin(side, op[2] as string), op[3]];
    if (op[0] === 'fetchMod') return [op[0], twin(side, 'ud'), ...op.slice(1)];
    if (op[0] === 'cut') return [op[0], path.join(twin(side, 'ud'), 'downloads', op[1] as string)];
    return op;
  };

  const list = path.join(tmp, 'calls.json');
  fs.writeFileSync(list, JSON.stringify([['net.script', ops.map((op) => local('rs', op))],
    // the body's own budget, in Rust alone
    ['net.script', [['timing', 200, 300], ['setMirrors', [at('trickle')]], ['text', JSON_URL, {}],
      ['timing', 200, 100], ['setMirrors', [at('stuck')]], ['text', JSON_URL, {}]]]]));
  // not execFileSync: the servers above live in this process and have to answer it
  const rsRun = new Promise<string>((resolve, reject) => {
    const p = spawn(cli, ['call', list]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`mm-cli exited ${code}`))));
  });

  const plain = (e: unknown) => {
    const err = e as Error & { offline?: boolean; checksum?: boolean };
    return { error: err.message, offline: !!err.offline, timeout: err.name === 'TimeoutError', checksum: !!err.checksum };
  };
  const want: unknown[] = [];
  for (const op of ops.map((o) => local('ts', o))) {
    want.push(await (async () => {
      switch (op[0]) {
        case 'mirrorsFor': return mirrors.mirrorsFor(op[1] as string, { small: !!op[2], trustedOnly: !!op[3] });
        case 'entriesFor': return mirrors.entriesFor(op[1] as string, { small: !!op[2], trustedOnly: !!op[3] });
        case 'live': return mirrors.liveOrder(mirrors.entriesFor(op[1] as string, { small: !!op[2] }));
        case 'wellFormed': return mirrors.wellFormedMirror(op[1]);
        case 'apply': return mirrors.applyMirrors(op[1]);
        case 'pictures': return mirrors.pictureBases();
        case 'fail': mirrors.noteFailure(op[1] as string, op[2] as string); return null;
        case 'stall': mirrors.noteStall(op[1] as string, op[2] as string); return null;
        case 'success': mirrors.noteSuccess(op[1] as string); return null;
        case 'stoodDown': return mirrors.stoodDown(op[1] as string);
        case 'health': return mirrors.mirrorHealth();
        case 'reset': mirrors.resetHealth(); return null;
        case 'setMirrors': mirrors.setMirrors((op[1] as At[]).map(tsMirror)); return null;
        case 'text': try { return { text: await net.fetchText(op[1] as string, op[2] as never) }; } catch (e) { return plain(e); }
        case 'download': try {
          const o = op[3] as { expect?: string; published?: boolean };
          const d = await net.downloadFile(op[1] as string, op[2] as string, { expectSha256: o.expect ?? null, fromPublishedList: !!o.published });
          return { bytes: d.bytes, sha256: d.sha256, resumedFrom: d.resumedFrom, unverified: !!d.unverified };
        } catch (e) { return plain(e); }
        case 'lang': setLang(op[1] as string); return null;
        case 'proxy': return (await import('../src/download-proxy.ts')).validateDownloadProxy(op[1]);
        case 'cut': fs.truncateSync(op[1] as string, 5000); return null;
        case 'fetchMod': {
          const { Installer } = await import('../src/installer.ts');
          const events: Record<string, unknown>[] = [];
          const hashes = op[5] as Record<string, string>;
          const inst = new Installer({ userDataDir: op[1] as string, getGamePath: () => null, getLangSuffix: () => '', onProgress: (e: Record<string, unknown>) => events.push(e), publishedHash: (c, f) => hashes[`${c}/${f}`] ?? null });
          const a: Record<string, unknown> = {};
          try { a.path = await inst.download(op[2] as string, op[3] as string, op[4] as string | null); } catch (e) { a.error = (e as Error).message; }
          a.stages = events.filter((e) => e.type !== 'download');
          a.last = events.filter((e) => e.type === 'download').pop() ?? null;
          a.index = inst.downloadIndex();
          return a;
        }
        case 'sig': return signature.verify(fs.readFileSync(payloadFile), op[2], op.length > 3 ? op[3] as string : signature.CATALOG_PUBLIC_KEY);
      }
      throw new Error(`no step ${op[0]}`);
    })());
  }
  const answers = JSON.parse(await rsRun) as { ok?: unknown[]; error?: string }[];
  for (const s of servers) { s.closeAllConnections(); s.close(); }
  mirrors.setMirrors(null);
  assert.ok(answers[0].ok && answers[1].ok, JSON.stringify(answers).slice(0, 400));
  const [rs, timed] = [answers[0].ok!, answers[1].ok!];

  /* How a socket failed is worded by each side's own HTTP client ("fetch failed", "Connection
     refused"); what has to agree is the HTTP status, the checksum, and whether it reads as offline. */
  const worded = (s: unknown) => (typeof s === 'string' && /HTTP \d|checksum|no mirror|^timed out$/.test(s) ? s : '<socket>');
  const norm = (v: unknown, op: unknown[]): unknown => {
    if (op[0] === 'health') return (v as { why?: string; standingDownFor: number }[]).map((h) => ({ ...h, why: worded(h.why), standingDownFor: h.standingDownFor > 0 }));
    if (op[0] === 'fetchMod') return JSON.parse(JSON.stringify(v).split(JSON.stringify(path.join(tmp, 'rs')).slice(1, -1)).join('<side>').split(JSON.stringify(path.join(tmp, 'ts')).slice(1, -1)).join('<side>'), (k, x) => (k === 'at' ? 'now' : x));
    if (v && typeof v === 'object' && 'error' in v) return { ...v, error: worded((v as { error: string }).error) };
    return v;
  };
  ops.forEach((op, i) => assert.deepEqual(norm(rs[i], op), norm(want[i], op), `${i} ${JSON.stringify(op).slice(0, 160)}`));
  // the download index carries the time each archive arrived; its entries are in the answers above
  const tree = (side: string) => (fs.readdirSync(path.join(tmp, side), { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(tmp, side, f)).isFile() && !f.endsWith('index.json'))
    .sort().map((f) => `${f} ${sha(fs.readFileSync(path.join(tmp, side, f)))}`);
  assert.deepEqual(tree('rs'), tree('ts'));
  // a body that trickles in for longer than the wait for headers arrives; one that goes silent is cut
  assert.deepEqual(timed[2], { text: 'x'.repeat(120) });
  assert.equal((timed[5] as { timeout: boolean }).timeout, true, JSON.stringify(timed[5]));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the catalog, the remote config and the ready presets in Rust fetch, check and keep what the TypeScript does', { skip }, async () => {
  const http = await import('node:http');
  const crypto = await import('node:crypto');
  const { spawn } = await import('node:child_process');
  const net = await import('../src/net.ts');
  const mirrors = await import('../src/net-mirrors.ts');
  const { Catalog, normalizeCatalog, RAW_BASE } = await import('../src/catalog.ts');
  const remote = await import('../src/remote-config.ts');
  const { createReadyPresets, READY_URL } = await import('../src/ready-presets.ts');

  const catalogKey = crypto.generateKeyPairSync('ed25519');
  const configKey = crypto.generateKeyPairSync('ed25519');
  const spki = (k: { publicKey: import('node:crypto').KeyObject }) => k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const signWith = (k: { privateKey: import('node:crypto').KeyObject }, text: string) => crypto.sign(null, Buffer.from(text), k.privateKey).toString('base64');

  const mods = JSON.stringify({ modsData: {
    heroes: { groups: [{ mods: [{ name: 'A', linkType: 'preview', linkUrl: 'https://p/a.png', senderName: 'Me' }, { name: 'B', links: [{ type: 'preview', url: 'https://p/b.png' }], linkType: 'preview', linkUrl: 'https://p/b.png' }] }, { mods: [{ name: 'C', links: [{ type: 'x', url: 'y' }], linkType: 'preview', linkUrl: 'https://p/c.png' }] }] },
    sounds: [{ name: 'S', linkType: 'preview' }, null, 'x', { name: 'T', linkType: 'author', linkUrl: 'https://a', senderName: '' }],
    misc: { mods: [{ name: 'M', linkType: 'preview', linkUrl: 'https://m' }] },
    empty: null, n: 5,
  }, extra: 'ж' });
  const constants = JSON.stringify({ categories: [{ id: 'heroes' }], big: 1e21, frac: 2.5 });
  const guides = JSON.stringify([{ title: 'g' }]);
  const hashes = JSON.stringify({ 'heroes/A.zip': 'ABCDEF'.padEnd(64, '0'), 'heroes/B.zip': 'xyz', 'heroes/C.zip': 'a'.repeat(63) });
  const day = (offset: number) => new Date(Date.UTC(2026, 10, 13) + offset * 86400000).toISOString().slice(0, 10);
  const config = JSON.stringify({
    version: 1,
    features: { install: { off: false }, cosmetics: { off: true, ru: 'Выключено', en: 'Off for now' }, voice: { off: true, ru: 'Голос', en: '' }, other: { off: true } },
    notices: [
      { id: 'n1', date: '2026-11-01', level: 'warn', ru: 'Привет', en: 'Hello', url: 'HTTPS://example.com', until: day(3) },
      { id: 'n2', date: '2026-11-10', ru: 'Только ру', url: 'http://x' },
      { id: 'n3', date: '2026-10-01', en: 'Old', until: day(-1) },
      { id: 'n4', date: '2026-11-05', en: 'For 3', minVersion: '3.0.0' },
      { id: 'n5', date: '2026-11-06', en: 'Up to 2.10', maxVersion: '2.10.0', until: '2026-02-30' },
      { id: '', en: 'no id' }, 'x', { id: 'n6', date: '2026-11-07', en: 'bad until', until: '2026-13-01' },
    ],
    blocks: [
      { id: 'b1', feature: 'install', minVersion: '2.9.0', maxVersion: '2.9.9', until: day(5), ru: 'Блок', en: 'Blocked' },
      { id: 'b2', feature: 'nope', until: day(5) }, { id: 'b3', feature: 'voice', until: 'soon' },
    ],
    beta: { salt: 's', ids: [` ${'AB'.repeat(32)} `, 'short', 5, 'c'.repeat(64)] },
    mirrors: [
      { id: 'g', base: 'https://gitlab.com/r/m/-/raw/main/assets/files/' }, { base: 'https://h.co/c/?' }, { base: 'https://h.co/c/' },
      { base: 'http://plain/' }, { base: 'https://raw.githubusercontent.com/x/' }, { id: 'g', base: 'https://other/' },
    ],
    issues: [
      { cat: 'heroes', mod: 'A', ru: 'Ломает', en: 'Breaks', until: day(10), revoked: true },
      { cat: 'heroes', mod: 'B', en: 'Old', until: day(-2) }, { cat: 'heroes', mod: 'C' }, { cat: 'x', mod: 'Y', ru: 'Только', revoked: 'yes' },
    ],
  });
  const presets = fs.readFileSync(path.join(root, 'config', 'presets.json'), 'utf8');

  // each state of the world is a folder on one server: the raw paths, and the site's snapshot under /snap/
  type Files = Record<string, string | null>;
  const raw = (p: string) => p.replace(net.RAW_HOST, '/');
  const cat = (name: string) => raw(`${RAW_BASE}/assets/data/${name}`);
  const catSig = (name: string) => raw(`${RAW_BASE}/assets/signatures/${name}.sig`);
  const signedCatalog = (k = catalogKey): Files => Object.fromEntries([['mods.json', mods], ['constants.json', constants], ['guides.json', guides], ['mod-hashes.json', hashes]]
    .flatMap(([n, t]) => [[cat(n), t], [catSig(n), signWith(k, t)], [`/snap/${n}`, t], [`/snap/${n}.sig`, signWith(k, t)]]));
  const configFiles = (text = config, k = configKey): Files => ({ [raw(remote.CONFIG_URL)]: text, [raw(`${remote.CONFIG_URL}.sig`)]: signWith(k, text), [raw(READY_URL)]: presets, [raw(`${READY_URL}.sig`)]: signWith(k, presets) });
  const states: Record<string, Files> = {
    good: { ...signedCatalog(), ...configFiles() },
    // GitHub's cache handing over data and a signature from different moments: the snapshot is whole
    torn: { ...signedCatalog(), [catSig('mods.json')]: signWith(catalogKey, '{}'), [raw(`${remote.CONFIG_URL}.sig`)]: signWith(configKey, '{}') },
    forged: { ...signedCatalog(crypto.generateKeyPairSync('ed25519')), ...configFiles(config, crypto.generateKeyPairSync('ed25519')) },
    nohash: { ...signedCatalog(), [cat('mod-hashes.json')]: null, ...configFiles('not json') },
    badjson: { ...signedCatalog(), [cat('guides.json')]: '{bad', [catSig('guides.json')]: signWith(catalogKey, '{bad'), '/snap/guides.json': '{bad', '/snap/guides.json.sig': signWith(catalogKey, '{bad'), ...configFiles('[1,2]') },
    down: {},
  };
  const server = http.createServer((req, res) => {
    const [, state, ...rest] = (req.url || '').split('/');
    const body = states[state]?.[`/${rest.join('/')}`];
    if (state === 'down') { res.writeHead(503); res.end(); return; }
    if (body == null) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-length': Buffer.byteLength(body) }); res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-remote-'));
  const NOW = Date.UTC(2026, 10, 13, 12);

  const ops: unknown[][] = [
    ['cmp', '2.0.0', '10.0.0'], ['cmp', '2.10', '2.9.9'], ['cmp', ' 3.x.1', '3.0.1'], ['cmp', '-1.0', '0'], ['cmp', '', '0.0.0'], ['cmp', '1.2.3.4', '1.2.3'], ['cmp', '+2', '2'],
    ['normalize', null], ['normalize', [1]], ['normalize', JSON.parse(config)], ['normalize', { features: [], notices: {}, beta: [], mirrors: 'x' }],
    ['normalizeCatalog', JSON.parse(mods)],
    ['new', '2.9.5', NOW], ['state', 'down'], ['catalog.load', false], ['config.refresh'], ['ready.refresh'], ['ready.list'],
    ['state', 'good'], ['catalog.load', false], ['catalog.hash', 'heroes', 'A.zip'], ['catalog.hash', 'heroes', 'B.zip'], ['catalog.hash', 'heroes', 'C.zip'], ['catalog.hash', '', 'A.zip'],
    ['config.refresh'], ['ready.refresh'], ['ready.list'], ['ready.get', 'minimal'], ['ready.get', 'nope'],
    ...['ru', 'en', 'de'].flatMap((l) => [['feature', 'install', l], ['feature', 'cosmetics', l], ['feature', 'voice', l], ['feature', 'other', l], ['notices', l], ['issues', l]]),
    ['beta'], ['mirrors'],
    ['state', 'torn'], ['catalog.load', true], ['config.refresh'],
    ['state', 'forged'], ['catalog.load', true], ['config.refresh'], ['ready.refresh'],
    ['state', 'nohash'], ['catalog.load', true], ['catalog.hash', 'heroes', 'A.zip'], ['config.refresh'],
    ['state', 'badjson'], ['catalog.load', true], ['config.refresh'], ['notices', 'en'],
    ['state', 'down'], ['catalog.load', true],
    // a later build and a different day: the blocks and the dated notices move
    ['new', '3.0.0', NOW + 4 * 86400000], ['state', 'good'], ['config.refresh'], ['feature', 'install', 'en'], ['feature', 'cosmetics', 'en'], ['notices', 'en'], ['issues', 'en'], ['catalog.load', false],
  ];
  const ud = (side: string, gen: number) => path.join(tmp, side, String(gen));

  // the Rust side, in one run
  const list = path.join(tmp, 'calls.json');
  fs.writeFileSync(list, JSON.stringify([['remote.script', base, spki(catalogKey), spki(configKey), path.join(tmp, 'rs'), ops]]));
  const rsRun = new Promise<string>((resolve, reject) => {
    const p = spawn(cli, ['call', list]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`mm-cli exited ${code}`))));
  });

  // the TypeScript side, op for op
  let gen = 0;
  let cfgVersion = '';
  let clock = 0;
  let catalog: InstanceType<typeof Catalog> | null = null;
  let cfg: ReturnType<typeof remote.createRemoteConfig> | null = null;
  let ready: ReturnType<typeof createReadyPresets> | null = null;
  let logs: string[] = [];
  const want: unknown[] = [];
  for (const op of ops) {
    want.push(await (async () => {
      switch (op[0]) {
        case 'cmp': return remote.cmpVersion(op[1], op[2]);
        case 'normalize': return remote.normalize(op[1]);
        case 'normalizeCatalog': return normalizeCatalog(op[1] as never);
        case 'new': {
          const dir = ud('ts', gen++);
          fs.mkdirSync(dir, { recursive: true });
          cfgVersion = op[1] as string; clock = op[2] as number;
          catalog = new Catalog(dir, { snapshotBase: '', publicKey: spki(catalogKey) });
          cfg = remote.createRemoteConfig({ userDataDir: dir, appVersion: () => cfgVersion, publicKey: spki(configKey), now: () => clock, log: (m) => logs.push(m) });
          ready = createReadyPresets({ userDataDir: dir, publicKey: spki(configKey), log: (m) => logs.push(m) });
          return null;
        }
        case 'state': {
          const prefix = `${base}${op[1]}/`;
          mirrors.setMirrors([{ host: `state-${op[1]}`, map: (u: string) => u.replace(net.RAW_HOST, prefix), origin: true }]);
          catalog!.snapshotBase = `${prefix}snap/`;
          return null;
        }
        case 'catalog.load': try { return await catalog!.load({ forceRefresh: !!op[1] }); } catch (e) { return { error: (e as Error).message }; }
        case 'catalog.hash': return catalog!.publishedHash(op[1] as string, op[2] as string);
        case 'config.refresh': { logs = []; const v = await cfg!.refresh(); return { v, logs }; }
        case 'ready.refresh': { logs = []; const v = await ready!.refresh(); return { v, logs }; }
        case 'ready.list': return ready!.list();
        case 'ready.get': return ready!.get(op[1] as string);
        case 'feature': return cfg!.feature(op[1] as string, op[2] as string);
        case 'notices': return cfg!.notices(op[1] as string);
        case 'issues': return cfg!.issues(op[1] as string);
        case 'beta': return cfg!.beta();
        case 'mirrors': return cfg!.mirrors();
      }
      throw new Error(`no step ${op[0]}`);
    })());
  }
  const [answer] = JSON.parse(await rsRun) as { ok?: unknown[]; error?: string }[];
  server.closeAllConnections(); server.close();
  mirrors.setMirrors(null);
  assert.ok(answer.ok, JSON.stringify(answer).slice(0, 400));

  // the time a catalog was fetched is the clock's; a socket's failure is worded by each side's own client
  const why = (m: string) => (/signature|HTTP \d/.test(m) ? m : '<not JSON>');
  const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null), (k, x) => {
    if (k === 'fetchedAt' && typeof x === 'number') return 'now';
    if ((k === 'stale' || k === 'error') && typeof x === 'string') return why(x);
    if (typeof x === 'string') { const m = /^(remote config|ready presets) not fetched: ([^]*)$/.exec(x); if (m) return `${m[1]} not fetched: ${why(m[2])}`; }
    return x;
  });
  ops.forEach((op, i) => assert.deepEqual(norm(answer.ok![i]), norm(want[i]), `${i} ${JSON.stringify(op).slice(0, 120)}`));
  const tree = (side: string) => (fs.readdirSync(path.join(tmp, side), { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(tmp, side, f)).isFile())
    .filter((f) => !f.endsWith('meta.json')).sort().map((f) => `${f} ${crypto.createHash('sha1').update(fs.readFileSync(path.join(tmp, side, f))).digest('hex')}`);
  assert.deepEqual(tree('rs'), tree('ts'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('download counts and install hits in Rust send and keep what the TypeScript does', { skip }, async () => {
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  const stats = await import('../src/download-stats.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-stats-'));

  // the pure half, through the ordinary case list
  const modsData = {
    heroes: { groups: [{ id: 'pudge', mods: [{ name: 'A', styles: [{}, {}] }, { name: 'B', styles: [{}] }] }, { id: 7, mods: [{ name: 'C' }] }, { mods: 'x' }] },
    sounds: [{ name: 'S', styles: [1, 2, 3] }, null],
    misc: { mods: [{ name: 'M' }] }, empty: null, odd: 5,
  };
  const tokens = ['', 'short', 'a'.repeat(16), ` ${'b'.repeat(40)}\n`, 'has space inside but long enough', 'ж'.repeat(20), 'c'.repeat(513), 'd'.repeat(512)].map((t, i) => {
    const f = path.join(tmp, `token${i}`);
    fs.writeFileSync(f, t);
    return [f];
  });
  compare([
    { name: 'download-stats.statKeysFor', ts: stats.statKeysFor as never, inputs: [
      ...[['heroes', 'A', 'Style 2'], ['heroes', 'A', null], ['heroes', 'A', ''], ['heroes', 'A', 'Style '], ['heroes', 'B', 'Style 2'], ['heroes', 'C', 'x'], ['heroes', 'Z', null],
        ['sounds', 'S', ' Red Style  '], ['misc', 'M', 'y'], ['empty', 'A', null], ['odd', 'A', null], ['none', 'A', null]].map((a) => [modsData, ...a]),
      [null, 'heroes', 'A', null],
    ] },
    { name: 'download-stats.statStyleName', ts: stats.statStyleName as never, inputs: [['Style 2'], ['Style '], [''], [null], [5], ['  Golden Style Style  '], ['style 1'], [true]] },
    { name: 'download-stats.buildToken', ts: stats.buildToken as never, inputs: [...tokens, [path.join(tmp, 'missing')]] },
  ]);

  // the counter itself, against a server that answers each side's requests in the same order
  const counts = { 'heroes/pudge/A': 10, 'heroes/pudge/A/2': 4.7, bad: -1, str: '5', [`${'k'.repeat(401)}`]: 1, 12: 3 };
  const plan = [
    { status: 200, body: JSON.stringify(counts) }, { status: 204, body: '' }, { status: 503, body: '' }, { status: 200, body: '{nope' },
    { status: 200, body: JSON.stringify({ 'heroes/pudge/A': 20 }) }, { status: 500, body: '' }, { status: 200, body: '[1]' },
  ];
  type Seen = { method?: string; url?: string; headers: Record<string, unknown>; body: string };
  const seen: Record<string, Seen[]> = { ts: [], rs: [] };
  const server = http.createServer((req, res) => {
    const side = (req.url || '').split('/')[1];
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const got = seen[side];
      const { 'content-type': type, 'x-source': source, 'x-app-token': token } = req.headers;
      got.push({ method: req.method, url: (req.url || '').slice(side.length + 1), headers: { type, source, token }, body });
      const a = plan[got.length - 1] ?? { status: 404, body: '' };
      res.writeHead(a.status, { 'content-length': Buffer.byteLength(a.body) });
      res.end(a.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const TOKEN = 'T'.repeat(20);
  const ops: unknown[][] = [
    ['active'], ['now', 0], ['get'], ['now', 1000], ['get'], ['track', ['heroes/pudge/A/2', 'heroes/pudge/A', '']], ['get'], ['flush'],
    ['now', 400000], ['get'], ['now', 800000], ['get'], ['track', ['x']], ['now', 1200000], ['get'], ['flush'], ['now', 1600000], ['get'],
    ['track', Array(7).fill('heroes/pudge/A')], ['flush'], ['enabled', false], ['track', ['y']], ['flush'], ['enabled', true], ['flush'],
    ['now', 2000000], ['get'], ['now', 2400000], ['get'],
  ];
  const offline = [['active'], ['now', 0], ['get'], ['track', ['z']], ['flush'], ['get']];
  const file = (side: string) => path.join(tmp, side, 'counts.json');
  for (const side of ['ts', 'rs']) fs.mkdirSync(path.join(tmp, side));
  const gone = http.createServer();
  await new Promise<void>((r) => gone.listen(0, '127.0.0.1', () => r()));
  const goneApi = `http://127.0.0.1:${(gone.address() as import('node:net').AddressInfo).port}`;
  await new Promise((r) => gone.close(r));

  const list = path.join(tmp, 'calls.json');
  fs.writeFileSync(list, JSON.stringify([
    ['download-stats.script', `${base}/rs`, file('rs'), TOKEN, ops],
    ['download-stats.script', goneApi, file('rs'), null, offline],
  ]));
  // not execFileSync: the server above lives in this process and has to answer it
  const rsRun = new Promise<string>((resolve, reject) => {
    const p = spawn(cli, ['call', list]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`mm-cli exited ${code}`))));
  });
  const run = async (api: string, cacheFile: string, token: string | null, steps: unknown[][]) => {
    let clock = 0;
    let on = true;
    let logs: string[] = [];
    const s = stats.createDownloadStats({ cacheFile, enabled: () => on, token: () => token, api, now: () => clock, log: (m) => logs.push(m) });
    const out: unknown[] = [];
    for (const op of steps) {
      let v: unknown = null;
      if (op[0] === 'now') clock = op[1] as number;
      else if (op[0] === 'enabled') on = op[1] as boolean;
      else if (op[0] === 'get') v = await s.get();
      else if (op[0] === 'track') s.track(op[1] as string[]);
      else if (op[0] === 'flush') await s.flush();
      else if (op[0] === 'active') v = s.active();
      out.push({ v, logs });
      logs = [];
    }
    return out;
  };
  const want = [await run(`${base}/ts`, file('ts'), TOKEN, ops), await run(goneApi, file('ts'), null, offline)];
  const got = (JSON.parse(await rsRun) as { ok?: unknown[]; error?: string }[]).map((a) => { assert.ok(a.ok, a.error); return a.ok!; });
  server.closeAllConnections(); server.close();

  // how a body that is not JSON, or a refused socket, is worded is each side's own
  const norm = (v: unknown) => JSON.parse(JSON.stringify(v), (k, x) => (typeof x === 'string' && /^download (counts|hit): /.test(x) && !/HTTP \d/.test(x) ? x.replace(/: .*/s, ': <why>') : x));
  for (const [i, steps] of [ops, offline].entries()) steps.forEach((op, j) => assert.deepEqual(norm(got[i][j]), norm(want[i][j]), `${i}.${j} ${JSON.stringify(op)}`));
  assert.deepEqual(seen.rs, seen.ts);
  assert.ok(seen.ts.some((r) => r.method === 'POST' && r.body.includes('"heroes/pudge/A":5')), JSON.stringify(seen.ts));
  assert.equal(fs.readFileSync(file('rs'), 'utf8'), fs.readFileSync(file('ts'), 'utf8'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('catalog pictures in Rust are found, fetched, kept and rechecked as the TypeScript does', { skip }, async () => {
  const http = await import('node:http');
  const crypto = await import('node:crypto');
  const { spawn } = await import('node:child_process');
  const pc = await import('../src/preview-cache.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-previews-'));
  const RAW = 'https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main/';
  const P = 'assets/previews/';

  // the pure half
  const urls = [
    `${RAW}${P}heroes/a.png`, `${RAW}${P}heroes/a.PNG?x=1#y`, `mm-preview://catalog/${P}x/%D0%96%20b.webp`, `${RAW}${P}x/..%2F..%2Fevil.png`,
    `${RAW}${P}x/%E0%A4%A.png`, `${RAW}${P}x/a.svg`, `${RAW}assets/other/a.png`, `${RAW}${P}x/a.jpeg`, `${RAW}${P}x/a.jpg.txt`,
    'https://cdn.dota2modmanager.com/assets/previews/x/a.png', `${RAW}${P}..\\a.ico`, '', `${RAW}${P}`, `mm-preview://catalog/${P}a.gif`,
  ];
  const sig = (...b: number[]) => [...b, ...Array(12).fill(7)];
  compare([
    { name: 'preview-cache.pictureOf', ts: pc.pictureOf as never, inputs: urls.map((u) => [u]) },
    { name: 'preview-cache.redirectFor', ts: pc.redirectFor as never, inputs: urls.map((u) => [u]) },
    { name: 'preview-cache.pictureType', ts: ((b: number[]) => pc.pictureType(Uint8Array.from(b))) as never, inputs: [
      [sig(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)], [sig(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20)],
      [sig(0x89, 0x50, 0x4e, 0x47)], [sig(0x47, 0x49, 0x46, 0x38)], [sig(0xff, 0xd8, 0xff)], [sig(0, 0, 1, 0)], [[0xff, 0xd8]], [[]], [sig(0x3c, 0x68)],
    ] },
    { name: 'preview-cache.hostsFor', ts: pc.hostsFor as never, inputs: [[`${P}heroes/a.png`], [`${P}x/%D0%96.webp`]] },
    { name: 'preview-cache.picturesIn', ts: pc.picturesIn as never, inputs: [
      [{ modsData: {
        heroes: { groups: [{ id: 'p', mods: [{ name: 'A', preview: 'a.png', styles: [{ preview: 'Ж b.webp' }, { preview: '' }, { preview: 5 }] }] }] },
        sounds: [{ preview: 'https://x/y.png' }, { preview: `${P}other/z.gif` }, null, { deep: { preview: 'a.png' } }, { preview: 'note.txt' }],
        3: [{ preview: 'num.png' }], misc: { preview: { preview: 'inner.jpg' } }, again: [{ preview: 'a.png' }],
      } }, { categories: [{ preview: 'heroes.png' }, { preview: '' }, {}, { preview: 'HTTPS://cdn/x.png' }] }],
      [null, null], [{}, { categories: [] }], [{ modsData: null }, {}],
    ] },
  ]);

  // the store, against one server that is each of the hosts in turn
  const png = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, n, n, n, n]);
  const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 1, 2, 3]);
  const ico = Buffer.from([0, 0, 1, 0, 9, 9]);
  type Answer = { status: number; body?: Buffer | string; delay?: number };
  const hosts: Record<string, Record<string, Answer | ((ims: boolean) => Answer)>> = {
    mirror: {
      'heroes/a.png': { status: 200, body: png(1) }, 'heroes/c.gif': { status: 200, body: '<html>blocked</html>' },
      'heroes/e.ico': (ims) => (ims ? { status: 304 } : { status: 200, body: ico }),
      'heroes/f.png': (ims) => ({ status: 200, body: png(ims ? 3 : 2) }), 'heroes/g.png': { status: 200, body: png(4), delay: 200 },
      'heroes/h.png': { status: 200, body: png(5) }, '%D0%96%20b.png': { status: 200, body: png(6) },
    },
    raw: { 'heroes/b.webp': { status: 200, body: png(7), delay: 1500 }, 'heroes/c.gif': { status: 500 } },
    jsd: { 'heroes/b.webp': { status: 200, body: png(8) }, 'heroes/c.gif': { status: 200, body: gif } },
  };
  const seen: Record<string, string[]> = { ts: [], rs: [] };
  const server = http.createServer((req, res) => {
    const [, side, host, ...rest] = (req.url || '').split('/');
    const rel = rest.join('/').slice(P.length);
    const ims = Boolean(req.headers['if-modified-since']);
    seen[side]?.push(`${host} ${rel}${ims ? ' ims' : ''}`);
    const entry = hosts[host]?.[rel];
    const a: Answer = typeof entry === 'function' ? entry(ims) : entry ?? { status: 404 };
    setTimeout(() => {
      res.writeHead(a.status, a.body ? { 'content-length': Buffer.byteLength(a.body) } : {});
      res.end(a.status === 304 ? undefined : a.body);
    }, a.delay ?? 0);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const mapFor = (side: string) => ({
    'https://cdn.dota2modmanager.com/': `${base}/${side}/mirror/`, [RAW]: `${base}/${side}/raw/`,
    'https://cdn.jsdelivr.net/gh/h6rd/Dota2PornFxWeb@main/': `${base}/${side}/jsd/`,
  });
  const r = (n: string) => `${P}heroes/${n}`;
  const ops: unknown[][] = [
    ['get', r('a.png')], ['get', r('a.png')], ['get', r('b.webp')], ['get', r('c.gif')], ['get', r('d.jpg')], ['both', r('g.png')],
    ['get', r('e.ico')], ['get', r('f.png')], ['age', r('e.ico'), 10], ['age', r('f.png'), 10], ['age', r('a.png'), 3],
    ['get', r('e.ico')], ['get', r('f.png')], ['get', r('a.png')], ['settle'], ['get', r('f.png')],
    ['warm', [r('a.png'), r('h.png'), r('d.jpg'), `${P}%D0%96%20b.png`, r('c.gif')]], ['warm', [r('h.png')]], ['files'],
  ];
  const dirFor = (side: string) => path.join(tmp, side);
  const list = path.join(tmp, 'calls.json');
  fs.writeFileSync(list, JSON.stringify([['preview-cache.script', dirFor('rs'), mapFor('rs'), 100, ops]]));
  // not execFileSync: the server above lives in this process and has to answer it
  const rsRun = new Promise<string>((resolve, reject) => {
    const p = spawn(cli, ['call', list]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`mm-cli exited ${code}`))));
  });
  const run = async () => {
    const map = Object.entries(mapFor('ts'));
    let logs: string[] = [];
    const dir = dirFor('ts');
    const store = pc.createPreviewStore({
      dir, stagger: 100, log: (m) => logs.push(m),
      fetchFn: (url, init) => { const m = map.find(([f]) => url.startsWith(f)); return fetch(m ? m[1] + url.slice(m[0].length) : url, init); },
    });
    const pic = (p: { bytes: Uint8Array; type: string } | null) => (p ? { type: p.type, sha: crypto.createHash('sha256').update(p.bytes).digest('hex') } : null);
    const out: unknown[] = [];
    for (const op of ops) {
      let v: unknown = null;
      const rel = op[1] as string;
      if (op[0] === 'get') v = pic(await store.get(rel));
      else if (op[0] === 'both') v = (await Promise.all([store.get(rel), store.get(rel)])).map(pic);
      else if (op[0] === 'warm') v = await store.warm(op[1] as string[]);
      else if (op[0] === 'age') {
        const at = new Date(Date.now() - (op[2] as number) * 86400000);
        fs.utimesSync(path.join(dir, crypto.createHash('sha1').update(rel).digest('hex')), at, at);
      } else if (op[0] === 'settle') await new Promise((ok) => setTimeout(ok, 600));
      else if (op[0] === 'files') v = fs.readdirSync(dir).sort();
      out.push({ v, logs });
      logs = [];
    }
    return out;
  };
  const want = await run();
  const answers = JSON.parse(await rsRun) as { ok?: unknown[]; error?: string }[];
  assert.ok(answers[0].ok, answers[0].error);
  // a host left behind by a faster one may still be asked by the time the race is over
  await new Promise((ok) => setTimeout(ok, 1700));
  server.closeAllConnections(); server.close();
  ops.forEach((op, j) => assert.deepEqual(answers[0].ok![j], want[j], `${j} ${JSON.stringify(op)}`));
  assert.deepEqual([...seen.rs].sort(), [...seen.ts].sort());
  assert.equal(seen.ts.filter((s) => s === 'mirror heroes/g.png').length, 1, 'two asks share one fetch');
  assert.ok(seen.ts.includes('mirror heroes/e.ico ims') && !seen.ts.some((s) => s.includes('a.png ims')), JSON.stringify(seen.ts));
  for (const f of fs.readdirSync(dirFor('ts'))) assert.deepEqual(fs.readFileSync(path.join(dirFor('rs'), f)), fs.readFileSync(path.join(dirFor('ts'), f)), f);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('release notes and the star count in Rust read and keep what the TypeScript does', { skip }, async () => {
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  const notes = await import('../src/release-notes.ts');
  const starsMod = await import('../src/repo-stars.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-info-'));

  // the changelogs: the repository's own two, and made-up ones with the odd headings
  const real = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const realRu = fs.readFileSync(path.join(root, 'CHANGELOG.ru.md'), 'utf8');
  const odd = [
    '# Changelog', '', '## 3.1.0-beta.1', 'beta', '', '## 3.1.0 (2026-11-01)', '- one', '- two', '', '## 3.0.2', '', '## 3.0.1 - hotfix', 'fix',
    '## 3.0.0', '- big', '## 2.9.9.1', 'four parts', '## 2.9.0', 'old', '## 10.0.0', 'far', '##3.0.0', 'no space',
  ].join('\n');
  const crlf = odd.replace(/\n/g, '\r\n');
  const oddRu = '## 3.1.0\n- один\n## 3.0.0\r\n\r\n- большой\r\n';
  const dirs: Record<string, string> = {};
  for (const [name, en, ru] of [['real', real, realRu], ['odd', odd, oddRu], ['crlf', crlf, null], ['none', null, null]] as const) {
    const d = path.join(tmp, name);
    fs.mkdirSync(d);
    if (en != null) fs.writeFileSync(path.join(d, 'CHANGELOG.md'), en);
    if (ru != null) fs.writeFileSync(path.join(d, 'CHANGELOG.ru.md'), ru);
    dirs[name] = d;
  }
  const realVersions = notes.changelogVersions(real);
  const versionsOf = ['3.1.0', '3.1.0-beta.1', '3.0.2', '3.0.1', '3.0.0', '2.9.9.1', '2.9.0', '10.0.0', '4.0.0', '3', '', 'x.y'];
  compare([
    { name: 'release-notes.changelogSection', ts: notes.changelogSection as never, inputs: [
      ...[odd, crlf, oddRu, ''].flatMap((t) => versionsOf.map((v) => [t, v])),
      ...realVersions.slice(0, 6).map((v) => [real, v]), ...realVersions.slice(0, 3).map((v) => [realRu, v]),
    ] },
    { name: 'release-notes.changelogVersions', ts: notes.changelogVersions as never, inputs: [[odd], [crlf], [oddRu], [real], [realRu], ['']] },
    { name: 'release-notes.notesRange', ts: notes.notesRange as never, inputs: [
      ...[['3.1.0', null], ['3.1.0', '2.9.0'], ['3.0.2', '3.0.0'], ['3.1.0-beta.1', null], ['4.0.0', '3.0.1'], ['3', null], ['3.0.1', '3.0.1']]
        .map(([v, s]) => [notes.changelogVersions(odd), v, s]),
      [realVersions, realVersions[0], null], [realVersions, realVersions[0], realVersions[5]], [[], '1.0.0', null],
    ] },
    { name: 'release-notes.releaseNotes', ts: notes.releaseNotes as never, inputs: [
      ...[['3.1.0', 'en', null], ['3.1.0', 'ru', null], ['3.0.2', 'ru', '2.9.0'], ['3.1.0-beta.1', 'en', null], ['9.9.9', 'en', null], ['3.0.0', 'ru', '3.0.0']]
        .flatMap(([v, l, s]) => ['odd', 'crlf', 'none'].map((d) => [v, l, dirs[d], s])),
      [realVersions[0], 'en', dirs.real, null], [realVersions[0], 'ru', dirs.real, realVersions[4]], [realVersions[2], 'ru', dirs.real, null],
    ] },
  ]);

  // the star count, against a server that answers each side in the same order
  const plan = [
    { status: 200, body: JSON.stringify({ stargazers_count: 262, name: 'x' }) }, { status: 500, body: '' }, { status: 200, body: 'nope' },
    { status: 200, body: JSON.stringify({ stargazers_count: 2.5 }) }, { status: 200, body: 'null' }, { status: 200, body: '{"stargazers_count":300}' },
  ];
  const seen: Record<string, string[]> = { ts: [], rs: [] };
  const server = http.createServer((req, res) => {
    const side = (req.url || '').split('/')[1];
    seen[side].push(`${req.method} ${req.url} ${req.headers.accept}`);
    const a = plan[seen[side].length - 1] ?? { status: 404, body: '' };
    res.writeHead(a.status, { 'content-length': Buffer.byteLength(a.body) });
    res.end(a.body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const H = 3600 * 1000;
  const ops: unknown[][] = [['now', 1000], ['get'], ['now', 2 * H], ['get'], ['now', 7 * H], ['get'], ['get'], ['get'], ['get'], ['get'], ['now', 20 * H], ['get']];
  const caches: [string, string | null][] = [['plain', null], ['fresh', '{"stars":5,"at":0}'], ['broken', '{"stars":"5","at":0}'], ['odd', '[1]']];
  const fileFor = (side: string, c: string) => path.join(tmp, `${side}-${c}.json`);
  for (const side of ['ts', 'rs']) for (const [c, body] of caches) if (body != null) fs.writeFileSync(fileFor(side, c), body);
  const list = path.join(tmp, 'calls.json');
  // the first cache runs the whole plan; the rest only look at what they start from
  const short: unknown[][] = [['now', 1000], ['get']];
  fs.writeFileSync(list, JSON.stringify(caches.map(([c], i) => ['repo-stars.script', `${base}/rs`, fileFor('rs', c), i ? short : ops])));
  const rsRun = new Promise<string>((resolve, reject) => {
    const p = spawn(cli, ['call', list]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`mm-cli exited ${code}`))));
  });
  const run = async (cacheFile: string, steps: unknown[][]) => {
    let clock = 0;
    const s = starsMod.createRepoStars({ cacheFile, now: () => clock, fetch: ((_u: string, init: RequestInit) => fetch(`${base}/ts`, init)) as typeof fetch });
    const out: unknown[] = [];
    for (const op of steps) {
      if (op[0] === 'now') { clock = op[1] as number; out.push(null); } else out.push(await s.get());
    }
    return out;
  };
  const want: unknown[] = [];
  for (const [i, [c]] of caches.entries()) want.push(await run(fileFor('ts', c), i ? short : ops));
  const got = (JSON.parse(await rsRun) as { ok?: unknown[]; error?: string }[]).map((a) => { assert.ok(a.ok, a.error); return a.ok!; });
  server.closeAllConnections(); server.close();
  assert.deepEqual(got, want);
  assert.deepEqual(seen.rs, seen.ts.map((s) => s.replace('/ts', '/rs')));
  for (const [c] of caches) assert.equal(fs.readFileSync(fileFor('rs', c), 'utf8'), fs.readFileSync(fileFor('ts', c), 'utf8'), c);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('finding Steam and Dota in Rust looks where the TypeScript looks', { skip }, async () => {
  const steam = await import('../src/steam.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-steam-'));
  const mk = (...p: string[]) => { const f = path.join(tmp, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); };
  // Steam's root lists two more libraries; the first is what a moved library leaves behind, the
  // second spells SteamApps the old way and has the game; a fallback has it too
  const lib = (n: string) => path.join(tmp, n);
  fs.mkdirSync(path.join(lib('root'), 'steamapps', 'common', 'dota 2 beta', 'game', 'dota'), { recursive: true });
  const vdf = `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${lib('root').replace(/\\/g, '\\\\')}"\n\t}\n\t"1"\n\t{\n\t\t"path"  "${lib('moved').replace(/\\/g, '\\\\')}"\n\t}\n\t"2" { "path" "${lib('real').replace(/\\/g, '\\\\')}" }\n}\n`;
  fs.writeFileSync(path.join(lib('root'), 'steamapps', 'libraryfolders.vdf'), vdf);
  fs.mkdirSync(path.join(lib('moved'), 'steamapps', 'common', 'dota 2 beta', 'game', 'dota'), { recursive: true });
  mk('real', 'SteamApps', 'common', 'dota 2 beta', 'game', 'bin', 'win64', 'dota2.exe');
  mk('fallback', 'steamapps', 'common', 'dota 2 beta', 'game', 'dota', 'pak01_dir.vpk');
  mk('linux', 'steamapps', 'common', 'dota 2 beta', 'game', 'bin', 'linuxsteamrt64', 'dota2');
  fs.mkdirSync(lib('broken-vdf/steamapps/libraryfolders.vdf'), { recursive: true });

  const joins: [boolean, string[]][] = [
    [true, ['C:\\Steam', 'steamapps']], [true, ['C:/Steam/', 'steamapps', 'common']], [true, ['C:', 'x']], [true, ['a', '..', '..', 'b']],
    [true, ['\\\\server\\share', 'x', '..', 'y']], [true, ['C:\\a\\.\\b\\', '']], [true, ['', '']], [true, ['/a//b/', 'c/']], [true, ['C:\\..\\x']],
    [false, ['/home/u', '.steam', 'steam']], [false, ['a/', '../..', 'b']], [false, ['/', '..', 'x']], [false, ['x//', './y/']], [false, []],
  ];
  const win = process.platform === 'win32';
  const reg = [
    '\r\nHKEY_CURRENT_USER\\SOFTWARE\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n\r\n', 'REG_SZ\tD:\\Steam  \n', 'REG_DWORD 0x1', '', 'REG_SZ    \r\n',
  ];
  compare([
    { name: 'steam.join', ts: ((w: boolean, parts: string[]) => (w ? path.win32 : path.posix).join(...parts)) as never, inputs: joins },
    { name: 'steam.regValue', ts: steam.regValue as never, inputs: reg.map((r) => [r]) },
    { name: 'steam.parseLibraryFolders', ts: steam.parseLibraryFolders as never, inputs: [[vdf], [''], ['"path" "C:\\\\a\\\\b" "PATH" "x" "path"\n"y" "path" ""']] },
    { name: 'steam.linuxSteamRoots', ts: ((h: string, x: string | null) => steam.linuxSteamRoots(h, x == null ? {} : { XDG_DATA_HOME: x })) as never, inputs: [['/home/u', null], ['/home/u', '/data'], ['/home/u', '']] },
    { name: 'steam.steamappsDir', ts: steam.steamappsDir as never, inputs: ['root', 'real', 'nothing'].map((n) => [lib(n)]) },
    { name: 'steam.pickSteamRoot', ts: steam.pickSteamRoot as never, inputs: [
      [[null, '', lib('nope'), lib('real').replace(/\\/g, '/'), lib('root')], win], [[null, null], win], [[lib('real').replace(/\\/g, '/')], false],
    ] },
    { name: 'steam.fallbackLibraries', ts: ((w: boolean, h: string, x: string | null) => (x == null ? steam.fallbackLibraries(w, h) : (() => {
      const was = process.env.XDG_DATA_HOME; process.env.XDG_DATA_HOME = x;
      try { return steam.fallbackLibraries(w, h); } finally { if (was === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = was; }
    })())) as never, inputs: [[true, '/home/u', null], [false, '/home/u', null], [false, '/home/u', '/data']] },
    { name: 'steam.findDotaIn', ts: steam.findDotaIn as never, inputs: [
      [lib('root'), [lib('fallback')]], [null, [lib('moved'), lib('MOVED'), lib('fallback')]], [lib('broken-vdf'), [lib('linux')]],
      [lib('nope'), []], ['', ['', lib('real')]], [null, []],
    ] },
  ]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the patch watcher in Rust notices what the TypeScript one notices', { skip }, async (t) => {
  const patcher = await import('../src/patcher.ts');
  const sg = await import('../src/patcher-signatures.ts');
  const pw = await import('../src/patch-watch.ts');
  const { spawn } = await import('node:child_process');
  const src = path.join(sandboxGame, 'dota');
  if (!fs.existsSync(path.join(src, 'gameinfo_branchspecific.gi'))) { t.skip('no sandbox (npm run sandbox:seed)'); return; }
  const branch = fs.readFileSync(path.join(src, 'gameinfo_branchspecific.gi'));
  const bin = process.platform === 'linux' ? ['bin', 'linuxsteamrt64'] : ['bin', 'win64'];
  const sigs = `...\\..\\..\\bin\\win64\\dota2.exe~SHA1:${'A'.repeat(40)};CRC:01234567\r\n${sg.signatureLine(branch)}\r\nDIGEST:ABCDEF\r\n`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-pwatch-'));
  const twin = (side: string) => {
    const g = path.join(tmp, side, 'game');
    fs.mkdirSync(path.join(g, 'dota'), { recursive: true });
    fs.mkdirSync(path.join(g, ...bin), { recursive: true });
    for (const f of ['gameinfo.gi', 'gameinfo_branchspecific.gi']) fs.copyFileSync(path.join(src, f), path.join(g, 'dota', f));
    fs.writeFileSync(path.join(g, 'dota', 'steam.inf'), 'ClientVersion=6900\r\nServerVersion=6900\r\n');
    fs.writeFileSync(path.join(g, ...bin, 'dota.signatures'), sigs);
    fs.copyFileSync(path.join(g, 'dota', 'gameinfo_branchspecific.gi'), path.join(g, 'dota', 'branch.orig'));
    patcher.apply({ gamePath: g, folder: patcher.FOLDER, backupDir: path.join(tmp, side, 'backups') });
    fs.copyFileSync(path.join(g, 'dota', 'gameinfo_branchspecific.gi'), path.join(g, 'dota', 'branch.patched'));
    return g;
  };
  const games = { ts: twin('ts'), rs: twin('rs') };
  const empty = path.join(tmp, 'empty');
  const onlyInf = path.join(tmp, 'inf');
  fs.mkdirSync(path.join(onlyInf, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(onlyInf, 'dota', 'steam.inf'), 'x\nClientVersion=12abc\n');
  compare([
    { name: 'patch-watch.clientVersion', ts: pw.clientVersion as never, inputs: [[games.ts], [empty], [onlyInf]] },
    { name: 'patch-watch.gameStamp', ts: pw.gameStamp as never, inputs: [[games.ts], [empty], [onlyInf], [null], ['']] },
  ]);

  const inf = (n: number) => `ClientVersion=${n}\r\n`;
  const ops: unknown[][] = [
    ['current'], ['start'], ['check'], ['start'], ['expects', true], ['check'],
    ['copy', 'dota/branch.orig', 'dota/gameinfo_branchspecific.gi'], ['check'], ['check'],
    ['write', 'dota/steam.inf', inf(6901)], ['check'], ['fail', true], ['write', 'dota/steam.inf', inf(6902)], ['check'], ['fail', false],
    ['copy', 'dota/branch.patched', 'dota/gameinfo_branchspecific.gi'], ['check'],
    ['write', 'dota/gameinfo.gi', `${fs.readFileSync(path.join(src, 'gameinfo.gi'), 'latin1').replace(/Game_LowViolence/, 'Game_LowViolence2')}\n`], ['check'], ['check'],
    ['game', null], ['rearm'], ['current'], ['game', 'self'], ['rearm'], ['current'],
    ['write', 'dota/steam.inf', inf(6903)], ['wait', 3000], ['current'],
    ['stop'], ['write', 'dota/steam.inf', inf(6904)], ['wait', 1200], ['check'], ['current'],
  ];
  const sideOps = (side: 'ts' | 'rs') => ops.map((op) => (op[0] === 'game' && op[1] === 'self' ? ['game', games[side]] : op));
  const list = path.join(tmp, 'calls.json');
  fs.writeFileSync(list, JSON.stringify([['patch-watch.script', games.rs, 300, sideOps('rs')]]));
  const rsRun = new Promise<string>((resolve, reject) => {
    const p = spawn(cli, ['call', list]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`mm-cli exited ${code}`))));
  });
  const run = async () => {
    let game: string | null = games.ts;
    let expects = false;
    let fail = false;
    let logs: unknown[] = [];
    const w = pw.createPatchWatcher({
      getGamePath: () => game, expectsPatch: () => expects, log: (m) => logs.push(m), debounceMs: 300,
      onPatch: (e) => { logs.push({ patch: e }); if (fail) throw new Error('no'); },
    });
    const out: unknown[] = [];
    for (const op of sideOps('ts')) {
      let v: unknown = null;
      const at = (rel: unknown) => path.join(games.ts, rel as string);
      if (op[0] === 'start') w.start(op[1] as string | undefined);
      else if (op[0] === 'check') w.check();
      else if (op[0] === 'current') v = w.current();
      else if (op[0] === 'rearm') w.rearm();
      else if (op[0] === 'stop') w.stop();
      else if (op[0] === 'expects') expects = op[1] as boolean;
      else if (op[0] === 'fail') fail = op[1] as boolean;
      else if (op[0] === 'game') game = op[1] as string | null;
      else if (op[0] === 'write') fs.writeFileSync(at(op[1]), op[2] as string);
      else if (op[0] === 'copy') fs.copyFileSync(at(op[1]), at(op[2]));
      else if (op[0] === 'wait') await new Promise((ok) => setTimeout(ok, op[1] as number));
      out.push({ v, logs });
      logs = [];
    }
    w.stop();
    return out;
  };
  const want = await run();
  const got = JSON.parse(await rsRun) as { ok?: unknown[]; error?: string }[];
  assert.ok(got[0].ok, got[0].error);
  const norm = (v: unknown, side: 'ts' | 'rs') => JSON.parse(JSON.stringify(v).split(JSON.stringify(games[side]).slice(1, -1)).join('<game>'));
  ops.forEach((op, j) => assert.deepEqual(norm(got[0].ok![j], 'rs'), norm(want[j], 'ts'), `${j} ${JSON.stringify(op)}`));
  // the run went where it was meant to: Steam's check, a patch, a handler that threw, the polled change
  const all = JSON.stringify(want);
  for (const s of ['files-restored', '6901', 'patch handler failed: no', '6903']) assert.ok(all.includes(s), s);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('d2mm:// links and the Linux desktop entry in Rust read and write what the TypeScript does', { skip }, async () => {
  const dl = await import('../src/deep-links.ts');
  const links = [
    'd2mm://mod/heroes/Pudge%20Arcana', 'd2mm://mod/heroes/Pudge%20Arcana/Style%202/', 'D2MM://MOD/a/b', 'd2mm://mod', 'd2mm://mod/', 'd2mm://mod/a',
    'd2mm://mod/a/b/c/d', 'd2mm://mod/a/b?x=1#y', 'd2mm://mod/a/%E0%A4%A', 'd2mm://mod/%20/b', 'd2mm://mod/a/%2F%2F', 'd2mm://modx/a/b', 'd2mm://mod//a//b//',
    'd2mm://mod/a/b#frag/c', 'd2mm://preset/abc', 'd2mm://preset/', 'd2mm://x', 'https://x', '', 'd2mm://mod/a/b?q\nz', 'd2mm://mod/caf%C3%A9/n%20/%20s%20',
  ];
  compare([
    { name: 'deep-links.firstLink', ts: dl.firstLink as never, inputs: [[['app.exe', '--flag', 'd2mm://preset/a', 'd2mm://mod/b/c']], [[5, null, 'D2MM://x']], [[]], [null]] },
    { name: 'deep-links.parseModLink', ts: dl.parseModLink as never, inputs: links.map((l) => [l]) },
    { name: 'deep-links.modLinkUrl', ts: dl.modLinkUrl as never, inputs: [
      [{ cat: 'heroes', name: 'Pudge / Arcana', style: null }], [{ cat: 'a b', name: 'é?#', style: 'Style 2' }], [{ cat: 'c', name: 'n', style: '' }],
    ] },
    { name: 'deep-links.route', ts: ((url: string | null) => {
      let got: unknown = 'nothing';
      dl.handleDeepLink(url, {
        importPresetLink: (code) => ({ parked: code }),
        win: () => ({ isDestroyed: () => false, show() {}, focus() {}, webContents: { send: (channel: string, payload: unknown) => { got = [channel, payload]; } } }),
      });
      return got;
    }) as never, inputs: [...links.map((l) => [l]), [null]] },
    { name: 'deep-links.desktopEntry', ts: dl.desktopEntry as never, inputs: [['/opt/My Apps/D2MM.AppImage'], ['']] },
  ]);

  // the entry on disk: written, left alone when it says the same, rewritten for another program,
  // the icon beside it, nothing off Linux, and a home where the folder cannot be made
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-desktop-'));
  const icon = path.join(tmp, 'icon.png');
  fs.writeFileSync(icon, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  const steps: [string, string, string | null][] = [
    ['linux', '/opt/a.AppImage', icon], ['linux', '/opt/a.AppImage', icon], ['linux', '/opt/b.AppImage', null], ['win32', '/x', icon], ['linux', '/opt/c', path.join(tmp, 'gone.png')],
  ];
  const runTs = (home: string) => steps.map(([platform, exe, ic]) => {
    const logs: string[] = [];
    const refreshed: string[] = [];
    dl.installDesktopEntry({ platform, exe, home, icon: ic ?? undefined, diag: (m) => logs.push(m), refresh: (d) => refreshed.push(d) });
    return { logs, refreshed };
  });
  const homes = { ts: path.join(tmp, 'ts'), rs: path.join(tmp, 'rs') };
  const blocked = { ts: path.join(tmp, 'bts'), rs: path.join(tmp, 'brs') };
  for (const h of Object.values(blocked)) { fs.mkdirSync(path.join(h, '.local'), { recursive: true }); fs.writeFileSync(path.join(h, '.local', 'share'), 'not a folder'); }
  const want = [runTs(homes.ts), runTs(blocked.ts)];
  const list = path.join(tmp, 'calls.json');
  fs.writeFileSync(list, JSON.stringify([['deep-links.installScript', homes.rs, steps], ['deep-links.installScript', blocked.rs, steps]]));
  const got = (JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' })) as { ok?: unknown; error?: string }[]).map((a) => { assert.ok(a.ok, a.error); return a.ok; });
  const norm = (v: unknown, side: 'ts' | 'rs') => JSON.parse(JSON.stringify(v)
    .split(JSON.stringify(homes[side]).slice(1, -1)).join('<home>').split(JSON.stringify(blocked[side]).slice(1, -1)).join('<home>')
    .split(JSON.stringify(tmp).slice(1, -1)).join('<tmp>'), (_k, x) => (typeof x === 'string' && / skipped: /.test(x) ? x.replace(/: .*/s, ': <why>') : x));
  assert.deepEqual(norm(got, 'rs'), norm(want, 'ts'));
  const tree = (h: string) => { const out: Record<string, string> = {}; const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out[path.relative(h, f)] = fs.readFileSync(f, 'base64'); } }; walk(h); return out; };
  assert.deepEqual(tree(homes.rs), tree(homes.ts));
  assert.ok(Object.keys(tree(homes.ts)).length === 2, JSON.stringify(Object.keys(tree(homes.ts))));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('matching wiki pictures to item names in Rust picks what the TypeScript picks', { skip }, async () => {
  const im = await import('../src/icon-match.ts');
  {
    const names = [
      'Alliance HUD Skin', 'Alliance HUD', 'Alliance HUD_skin', 'Loading Screen VI', 'Loading Screen IV', 'Mega-Kills: Axe', 'Weather Rain', 'The Ageless Witness - Loading Screen',
      'Fiery Soul of the Slayer Versus Screen', 'Kunkka LS', 'LS', '  Spaced\u00a0 Name  ', 'Golden ‘Tiny’ Rock', 'Ж Ракета 2', 'Æon Disk', 'Axe', 'Big Bad Wolf', '', 'X-Men 10',
      'Style III of IV', 'İstanbul HUD Skin', 'a_b.c-d', 'Wraith King',
    ];
    const titles = [
      'File:Cosmetic icon Alliance HUD.png', 'Cosmetic_icon_Alliance_HUD_Bundle.png', 'File:Cosmetic_icon_Loading_Screen_IV.png', 'File:Cosmetic icon Loading Screen VI.jpeg',
      'Cosmetic_icon_Mega-Kills-_Axe.webp', 'file:cosmetic icon mega-kills axe.PNG', 'Cosmetic icon Weather Rian.png', 'Cosmetic_icon_Weather_Rain.gif', 'Cosmetic_icon_.png',
      'Cosmetic icon Big Bad Wulf.png', 'Cosmetic icon Big Bad Wolf.png', 'Cosmetic icon X-Men 11.png', 'Cosmetic icon X Men 10.png', 'Cosmetic icon Aeon Disk.png',
    ];
    compare([
      { name: 'icon-match.plain', ts: im.plain as never, inputs: [...names.map((n) => [n]), [5], [null]] },
      { name: 'icon-match.numbering', ts: im.numbering as never, inputs: [...names.map((n) => [n]), [12], ['MIX IVY xi II2 3d']] },
      { name: 'icon-match.editDistance', ts: im.editDistance as never, inputs: [['kitten', 'sitting'], ['', 'abc'], ['abc', ''], ['same', 'same'], ['жук', 'жуки'], ['😀a', 'a']] },
      { name: 'icon-match.stripScreenSuffix', ts: im.stripScreenSuffix as never, inputs: names.map((n) => [n]) },
      { name: 'icon-match.titlePicker', ts: ((n: string, t: string[]) => im.titlePicker(n)(t)) as never, inputs: [...names.map((n) => [n, titles]), ['Alliance HUD', []]] },
      { name: 'icon-match.sniff', ts: ((b: number[]) => im.sniff(Buffer.from(b))) as never, inputs: [
        [[0x89, 0x50, 0x4e, 0x47, 0]], [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]], [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45]], [[0xff, 0xd8]], [[0xff]], [[]],
      ] },
      { name: 'icon-match.cosmeticFileNames', ts: im.cosmeticFileNames as never, inputs: names.map((n) => [n]) },
      { name: 'icon-match.prefixOf', ts: im.prefixOf as never, inputs: [...names.map((n) => [n]), ['!!! ???'], ['Ab: Cd Ef']] },
      { name: 'icon-match.heroFileNames', ts: im.heroFileNames as never, inputs: names.map((n) => [n]) },
    ]);
  }
});

test('removing everything in Rust takes out of the game what the TypeScript takes out', { skip }, async (t) => {
  if (!fs.existsSync(path.join(sandboxGame, 'dota', 'pak01_dir.vpk'))) { t.skip('no sandbox (npm run sandbox:seed)'); return; }
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { Settings } = await import('../src/settings.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const { createSchemaService } = await import('../src/schema-service.ts');
  const { removeEverything } = await import('../src/remove-everything.ts');
  const notice = await import('../src/notice-text.ts');
  const patcher = await import('../src/patcher.ts');
  const { createHash } = await import('node:crypto');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-everything-'));
  const mods = path.join(root, 'sandbox', 'mods');
  type Twin = { game: string; lib: string; ud: string; journal: string };
  const at = (r: string): Twin => ({ game: path.join(r, 'game'), lib: path.join(r, 'lib'), ud: path.join(r, 'ud'), journal: path.join(r, 'journal') });
  // one game with mods in it, one switched off, one whose file is gone, the patch on and the
  // notice written; each run gets two copies of it
  const baseRoot = path.join(tmp, 'base');
  const b0 = at(baseRoot);
  fs.cpSync(sandboxGame, b0.game, { recursive: true });
  for (const d of [b0.lib, b0.ud]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(b0.ud, 'settings.json'), JSON.stringify({ dotaGamePath: b0.game }));
  FileTx.journalDir = b0.journal;
  try {
    const inst = new Installer({ userDataDir: b0.ud, getGamePath: () => b0.game, getLangSuffix: () => 'russian' });
    const lib = new Library(b0.lib);
    for (const [cat, name, file] of [['heroes', 'IO Purple', 'heroes__IO Purple.zip'], ['emblems', 'Emblem', 'emblems__pak28_dir.vpk'], ['terrains', 'Terrain', 'terrains__pak10_dir.vpk']]) {
      const src = path.join(mods, file);
      if (!fs.existsSync(src)) { t.skip(`no ${file} (npm run sandbox:seed)`); return; }
      const files = FileTx.run((tx) => inst.installInto(tx, { categoryId: cat, modName: name, local: src }));
      lib.add({ name, categoryId: cat, styleLabel: null, fileRef: file, files } as never);
    }
    const off = lib.list()[1];
    inst.setEnabled(off.files, false, off.id);
    lib.setEnabled(off.id, false);
    lib.add({ name: 'Gone', categoryId: 'heroes', styleLabel: null, fileRef: 'x', files: [{ root: 'lang', relPath: 'pak77_dir.vpk' }] } as never);
    patcher.apply({ gamePath: b0.game, folder: patcher.FOLDER, backupDir: path.join(b0.ud, 'backups') });
    new Settings(b0.ud).set('schemaPatch' as never, true as never);
    notice.applyNotice({ gamePath: b0.game, langDir: inst.langFolder() });
  } finally { FileTx.journalDir = null; }
  const tree = (g: string) => Object.fromEntries((fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[]).filter((e) => e.isFile())
    .map((e) => { const f = path.join(e.parentPath, e.name); return [path.relative(g, f), createHash('sha1').update(fs.readFileSync(f)).digest('hex')]; }).sort());
  const before = tree(b0.game);

  const runs: [string, Record<string, boolean>][] = [
    ['all', { revert: true, mods: true, notice: true }], ['mods', { revert: false, mods: true, notice: false }], ['patch', { revert: true, mods: false }],
  ];
  const calls: unknown[] = [];
  const want: { name: string; a: Twin; b: Twin; out: unknown }[] = [];
  for (const [name, what] of runs) {
    const [a, b] = ['ts', 'rs'].map((side) => { const r = path.join(tmp, `${name}-${side}`); fs.cpSync(baseRoot, r, { recursive: true }); return at(r); });
    for (const x of [a, b]) {
      const sf = path.join(x.ud, 'settings.json');
      fs.writeFileSync(sf, JSON.stringify({ ...JSON.parse(fs.readFileSync(sf, 'utf8')), dotaGamePath: x.game }));
    }
    FileTx.journalDir = a.journal;
    try {
      const inst = new Installer({ userDataDir: a.ud, getGamePath: () => a.game, getLangSuffix: () => 'russian' });
      const lib = new Library(a.lib);
      const st = new Settings(a.ud);
      const svc = createSchemaService({ settings: st as never, library: lib, installer: inst as never, userDataDir: a.ud, pak: inst as never, modsOff: () => inst.masterIsOff(), onDeployed: () => {} });
      want.push({ name, a, b, out: removeEverything({ settings: st as never, library: lib as never, installer: inst as never, schemaService: svc as never }, what as never) });
    } finally { FileTx.journalDir = null; }
    calls.push(['remove-everything.run', b.game, 'russian', b.journal, b.lib, b.ud, what]);
  }
  const list = path.join(tmp, 'calls.json');
  fs.writeFileSync(list, JSON.stringify(calls));
  const got = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' })) as { ok?: unknown; error?: string }[];
  const libOf = (x: Twin) => JSON.parse(fs.readFileSync(path.join(x.lib, 'manifest.json'), 'utf8'));
  const settingsOf = (x: Twin) => { const s = JSON.parse(fs.readFileSync(path.join(x.ud, 'settings.json'), 'utf8')); delete s.dotaGamePath; return s; };
  for (const [k, w] of want.entries()) {
    assert.ok(got[k].ok, got[k].error);
    assert.deepEqual(got[k].ok, w.out, w.name);
    assert.deepEqual(tree(w.b.game), tree(w.a.game), `${w.name}: the game folder`);
    assert.deepEqual(libOf(w.b), libOf(w.a), `${w.name}: the library`);
    assert.deepEqual(settingsOf(w.b), settingsOf(w.a), `${w.name}: the settings`);
  }
  // the run did take things out
  assert.ok(Object.keys(before).length > Object.keys(tree(want[0].a.game)).length, 'mods came out');
  assert.equal((want[0].out as { removed: number }).removed, 4);
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A copy of an answer as it is now: the TypeScript library hands out the record it keeps changing. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const snap = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));
test('the menu background in Rust builds the layouts, the pak and the record the TypeScript builds', { skip }, async () => {
  const mb = await import('../src/menu-background.ts');
  const { createMenuBackground } = await import('../src/menu-background-service.ts');
  const { buildVpk, entryAt, openVpkIndex } = await import('../src/vpk.ts');
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const { muxWebm } = await import('../renderer/catalog/background/webm.ts');
  const { encodeKv3, resource } = await import('./helpers/kv3-build.ts');
  const { createHash } = await import('node:crypto');
  type V = Parameters<typeof encodeKv3>[0];
  const s = (str: string): V => ({ str });
  const at = (name: string, value: string): V => ({ obj: [['eType', s('PANEL_ATTRIBUTE')], ['name', s(name)], ['child', { obj: [['eType', s('PANEL_ATTRIBUTE_VALUE')], ['name', s(value)]] }]] });
  const panel = (name: string, kids: V[] = [], line = false): V => ({ obj: [['eType', s('PANEL')], ['name', s(name)],
    ...(kids.length === 1 ? [['child', kids[0]] as [string, V]] : kids.length ? [['vecChildren', { arr: kids }] as [string, V]] : []),
    ...(line ? [['sourceLineColumn', { int: 4 }] as [string, V]] : [])] });
  const layout = (...body: V[]): Buffer => resource([['RED2', Buffer.from('editor')], ['DATA', Buffer.alloc(6)],
    ['LaCo', encodeKv3({ obj: [['m_AST', { obj: [['m_pRoot', { obj: [['eType', s('ROOT')], ['vecChildren', { arr: body }]] }]] }]] })]]);
  const L = mb.LAYOUTS;
  const games: Record<string, Map<string, Buffer>> = {
    shaped: new Map([
      [L.dashboard, layout(panel('DOTADashboard', [panel('Panel', [at('id', 'DashboardCore'), panel('DOTADashboardBackgroundManager', [at('id', 'M'), at('override-background', 'X')])])]))],
      [L.manager, layout(panel('DOTADashboardBackgroundManager'))],
      [L.lastMatch, layout(panel('DOTADashboardBackgroundLastMatch', [
        panel('DOTAScenePanel', [at('id', 'BackgroundScene'), at('style', 'x')], true), at('class', 'c'), panel('Panel', [at('id', 'DetailsContainer')]),
      ]))],
    ]),
    // a manager inside a manager, one child stored alone, and a background with no panels of its own
    odd: new Map([
      [L.dashboard, layout(panel('DOTADashboardBackgroundManager', [panel('DOTADashboardBackgroundManager', [at('id', 'inner')])]))],
      [L.manager, layout(panel('DOTADashboardBackgroundManager', [at('id', 'one')]))],
      [L.lastMatch, layout(panel('DOTADashboardBackgroundLastMatch', [at('class', 'only')]))],
    ]),
    'no panel': new Map([[L.dashboard, layout(panel('Panel'))], [L.manager, layout(panel('Panel'))], [L.lastMatch, layout(panel('Panel'))]]),
    'no layouts': new Map([['scripts/x.txt', Buffer.from('x')]]),
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-menu-bg-'));
  const paks: Record<string, string> = {};
  for (const [name, files] of Object.entries(games)) {
    const dir = path.join(tmp, 'paks', name.replace(' ', '-'));
    fs.mkdirSync(dir, { recursive: true });
    paks[name] = path.join(dir, 'pak01_dir.vpk');
    fs.writeFileSync(paks[name], buildVpk([...files].map(([p, b]) => entryAt(p, b))));
  }
  // the game's own layouts, read and never written, when this machine has the game
  if (fs.existsSync(GAME_PAK01)) {
    const real = openVpkIndex(GAME_PAK01);
    const own = Object.values(L).map((p) => [p, real.read(p)] as const).filter(([, b]) => b);
    if (own.length === 3) {
      paks.game = path.join(tmp, 'paks', 'game', 'pak01_dir.vpk');
      fs.mkdirSync(path.dirname(paks.game), { recursive: true });
      fs.writeFileSync(paks.game, buildVpk(own.map(([p, b]) => entryAt(p, b!))));
    }
  }
  const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');
  const looks = [{ dim: 0.2, blur: 0 }, { dim: 0.5, blur: 6 }, { dim: 0, blur: 99 }, { dim: 5, blur: 3.5 }, { dim: -1, blur: 0.4 }];
  const webm = Buffer.from(muxWebm({ width: 64, height: 36, duration: 2_000_000, frames: [
    { data: Uint8Array.from([0x82, 0x49, 0x83, 0x42, 0x00]), time: 0, key: true }, { data: Uint8Array.from([0x86, 0x00]), time: 1_000_000, key: false },
  ] }));
  const files = { webm, gif: Buffer.from('GIF89a'.padEnd(80, '.')), bare: Buffer.concat([webm.subarray(0, 40), Buffer.alloc(200)]), short: webm.subarray(0, 30) };
  const fileArgs: Record<string, { $file: string }> = {};
  for (const [k, b] of Object.entries(files)) { const f = path.join(tmp, `${k}.bin`); fs.writeFileSync(f, b); fileArgs[k] = { $file: f }; }
  const bytes = (x: string) => Buffer.from(x, 'latin1');
  compare([
    { name: 'menu-background.veil', ts: mb.veil, inputs: [[0], [0.2], [0.5], [0.9], [5], [-3], [0.3333]] },
    { name: 'menu-background.webmProblem', ts: ((x: string, max?: number) => mb.webmProblem(bytes(x), max)) as never,
      inputs: [[fileArgs.webm], [fileArgs.gif], [fileArgs.bare], [fileArgs.short], [fileArgs.webm, 10], [fileArgs.webm, 3 * 1024 * 1024]] },
    { name: 'menu-background.layouts', ts: ((pak: string, look: { dim: number; blur: number }) => {
      const ix = openVpkIndex(pak);
      return mb.backgroundLayouts((f) => ix.read(f), look).map((l) => ({ path: l.path, sha1: sha(l.data) }));
    }) as never, inputs: Object.values(paks).flatMap((p) => looks.map((l) => [p, l])) },
  ]);

  setLang('en');
  // the record: twin games and user folders, the same steps on each
  const twin = (side: string) => {
    const r = path.join(tmp, side);
    const game = path.join(r, 'game');
    fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
    fs.mkdirSync(path.join(game, 'dota_russian'), { recursive: true });
    fs.copyFileSync(paks.shaped, path.join(game, 'dota', 'pak01_dir.vpk'));
    return { game, lib: path.join(r, 'lib'), ud: path.join(r, 'ud'), journal: path.join(r, 'journal') };
  };
  const a = twin('ts');
  const b = twin('rs');
  type Op = [string, ...unknown[]];
  const steps: Op[][] = [
    [['state'], ['install', null, 'none', 0.2, 0], ['install', fileArgs.gif, 'gif', 0.2, 0], ['install', fileArgs.webm, 'clip.mp4', 0.5, 6], ['state'],
      ['install', null, 'other', 'abc', 99], ['state'], ['rebuild', []]],
    // a second movie in the first one's slot, the record switched off and kept off through a rebuild
    [['install', fileArgs.bare, '', 1, 1], ['install', bytesArg(webm, 'w2'), '', -1, null], ['state']],
    [['rebuild', ['$id']], ['state'], ['rebuild', ['nope']]],
  ];
  function bytesArg(buf: Buffer, k: string) { const f = path.join(tmp, `${k}.bin`); fs.writeFileSync(f, Buffer.concat([buf, Buffer.from('webm extra')])); return { $file: f }; }
  const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null, (k, x) => (/^(id|installedAt|updatedAt)$/.test(k) ? '<' + k + '>' : UUID.test(String(x)) ? '<uuid>' : x)));
  const libOf = (x: { lib: string }) => norm(JSON.parse(fs.readFileSync(path.join(x.lib, 'manifest.json'), 'utf8')));
  const tree = (g: string) => Object.fromEntries((fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[]).filter((e) => e.isFile())
    .map((e) => { const f = path.join(e.parentPath, e.name); return [path.relative(g, f), sha(fs.readFileSync(f))]; }).sort());
  for (const [k, ops] of steps.entries()) {
    const idOf = (x: { lib: string }) => (JSON.parse(fs.readFileSync(path.join(x.lib, 'manifest.json'), 'utf8')).installed ?? []).find((r: { generated?: { background?: string } }) => r.generated?.background)?.id;
    if (k === 2) {
      // switched off in the app, as My mods would
      for (const x of [a, b]) {
        FileTx.journalDir = x.journal;
        const inst = new Installer({ userDataDir: x.ud, getGamePath: () => x.game, getLangSuffix: () => 'russian' });
        const lib = new Library(x.lib);
        const rec = lib.list().find((r) => (r.generated as { background?: string } | undefined)?.background)!;
        inst.setEnabled(rec.files, false, rec.id);
        lib.setEnabled(rec.id, false);
        FileTx.journalDir = null;
      }
    }
    const fill = (x: { lib: string }) => ops.map((op) => op.map((v) => (Array.isArray(v) ? v.map((i) => (i === '$id' ? idOf(x) : i)) : v)));
    FileTx.journalDir = a.journal;
    const want: unknown[] = [];
    try {
      const inst = new Installer({ userDataDir: a.ud, getGamePath: () => a.game, getLangSuffix: () => 'russian' });
      const lib = new Library(a.lib);
      const svc = createMenuBackground({ gamePath: () => a.game, userDataDir: a.ud, installer: inst as never, library: lib });
      for (const [op, ...args] of fill(a)) {
        try {
          if (op === 'state') want.push(snap(svc.state()));
          else if (op === 'install') want.push(snap(svc.install(args[0] ? new Uint8Array(fs.readFileSync((args[0] as { $file: string }).$file)) : null, args[1], args[2], args[3])));
          else want.push(snap(svc.rebuild(args[0] as string[])));
        } catch (e) { want.push(snap({ error: (e as Error).message })); }
      }
    } finally { FileTx.journalDir = null; }
    const list = path.join(tmp, `service-${k}.json`);
    fs.writeFileSync(list, JSON.stringify([['menu-background.service', b.game, 'russian', b.journal, b.lib, b.ud, fill(b)]]));
    const got = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' }))[0] as { ok?: unknown; error?: string };
    assert.ok(got.ok, got.error);
    assert.deepEqual(norm(got.ok), norm(want), `steps ${k}`);
    assert.deepEqual(tree(b.game), tree(a.game), `steps ${k}: the game folder`);
    assert.deepEqual(libOf(b), libOf(a), `steps ${k}: the library`);
    assert.deepEqual(tree(path.join(b.ud, 'menu-backgrounds')), tree(path.join(a.ud, 'menu-backgrounds')), `steps ${k}: the kept movies`);
  }
  // the steps did make a record, and the last rebuild kept it off
  const last = (libOf(a) as { installed: { enabled?: boolean; generated?: unknown }[] }).installed.filter((r) => r.generated);
  assert.equal(last.length, 1);
  assert.equal(last[0].enabled, false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Panorama styles and the HUD layout in Rust read and write what the TypeScript does', { skip }, async () => {
  const pf = await import('../src/panorama-files.ts');
  const hud = await import('../src/hud-scale.ts');
  const { openVpkIndex } = await import('../src/vpk.ts');
  const { style, script, texture } = await import('./helpers/panorama.ts');
  const { resource } = await import('./helpers/kv3-build.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-panorama-'));
  let n = 0;
  const put = (b: Buffer) => { const f = path.join(tmp, `${n++}.bin`); fs.writeFileSync(f, b); return { $file: f }; };
  const bytes = (x: string) => Buffer.from(x, 'latin1');
  const RANK = 'panorama/images/rank_tier_icons/rank3_psd.vtex';
  const CSS = `.A{background-image: url("s2r://${RANK}");}`;
  const next = `${CSS}.B{background-image: url("s2r://panorama/images/a_png.vtex");}.C{background-image: url( 'file://{images}/b.PNG' );}.D{background-image: url("s2r://panorama/images/gone.vtex");}.E{background-image:url(//x/y.tga)}`;
  const own = style(CSS, [[RANK, 256, 256]]);
  const R = await import('../src/resource.ts');
  const d = R.resourceBlock(own, 'DATA').data;
  // the same list without the four bytes of CRC after the size
  const v2file = R.resourceBlock(own, 'DATA').replace(Buffer.concat([d.subarray(0, 6 + RANK.length + 1 + 4), d.subarray(6 + RANK.length + 1 + 8)]));
  v2file.writeUInt16LE(2, 6);
  const noRerl = resource([['RED2', Buffer.from('editor')], ['DATA', d]]);
  noRerl.writeUInt16LE(3, 6);
  const other = style('', [['panorama/images/a_png.vtex', 40, 20]]);
  const styles = [own, v2file, noRerl, other, resource([['RED2', Buffer.alloc(4)]]), style('é ü \u{1F600}', [])];
  const games: Buffer[] = [];
  if (fs.existsSync(GAME_PAK01)) {
    const real = openVpkIndex(GAME_PAK01);
    for (const p of [hud.STYLE, 'panorama/styles/dashboard.vcss_c']) { const b = real.read(p); if (b) games.push(b); }
  }
  const tex = { 'panorama/images/b_png.vtex_c': put(texture(64, 32)), 'x/y_tga.vtex_c': put(Buffer.from('not a texture')) };
  const latin = (b: Buffer) => b.toString('latin1');
  const texOf = (p: string) => { const t = (tex as Record<string, { $file: string }>)[p]; return t ? fs.readFileSync(t.$file) : null; };
  const parts = [
    null, 'x', [], [null, 3, { id: 'nope' }, { id: 'lower_hud' }], [{ id: 'lower_hud', scale: 87 }, { id: 'lower_hud', scale: '112.5' }],
    [{ id: 'topbar', x: 10.6, y: -5000, opacity: 33, tint: '#ABCDEF', hidden: true }, { id: 'minimap_container', x: -2.5, y: 0.5, opacity: 'z', tint: 'red' }],
    [{ id: 'HudChat', scale: Infinity, opacity: 3, hidden: 'yes' }, { id: 'inventory', scale: -1e9, x: '7', opacity: null }, { id: 'abilities', scale: 52.4, opacity: 102.5 }],
    [{ id: 'lower_hud', x: 4, y: 2, scale: 130 }, { id: 'minimap_container', y: -3 }, { id: 'combat_events', opacity: 72.5 }],
  ];
  const cssIn = [
    '', '.a{}', '\uFEFF/* made by Source 2 Viewer 9 */\n.a{}\n\n', '  /* nothing */ .a{}', '.a{}\n\n/* d2mm: HUD scale */\n#lower_hud\n{\n}\n',
    ...games.map((g) => pf.readStyle(g).css),
  ];
  compare([
    { name: 'panorama.readStyle', ts: ((x: string) => pf.readStyle(bytes(x))) as never, inputs: [...styles, ...games].map((b) => [put(b)]) },
    { name: 'panorama.cssImages', ts: pf.cssImages, inputs: [[CSS], [next], [''], ["a{background-image:url('s2r://x/y.vtex')} b{background-image: url(\"file://{images}/z/w.psd\")}"], ...games.map((g) => [pf.readStyle(g).css])] },
    { name: 'panorama.writeStyle', ts: ((f: string, css: string, known: string[], _t: unknown) => latin(pf.writeStyle(bytes(f), css, pf.imagesOf(known.map((k) => fs.readFileSync((k as unknown as { $file: string }).$file))), texOf))) as never,
      inputs: [[put(own), CSS, [], {}], [put(own), next, [put(other), put(Buffer.from('junk'))], tex], [put(v2file), next, [], tex], [put(noRerl), next, [put(other)], tex],
        [put(own), 'é', [], {}], [put(styles[4]), CSS, [], {}], ...games.map((g) => [put(g), hud.withLayout(pf.readStyle(g).css, parts[7]), [], tex])] },
    { name: 'panorama.writeScript', ts: ((f: string, js: string) => latin(pf.writeScript(bytes(f), js))) as never,
      inputs: [[put(script('old()')), 'new()'], [put((() => { const o = script(); o.writeUInt16LE(3, 6); return o; })()), 'x'], [put(script()), 'é\u{1F600}']] },
    { name: 'hud.clampScale', ts: hud.clampScale, inputs: [[100], [87], [87.5], [62.5], [-1], [1e9], ['95'], [null], ['x'], [true]] },
    { name: 'hud.cleanParts', ts: hud.cleanParts, inputs: parts.map((p) => [p]) },
    { name: 'hud.withLayout', ts: hud.withLayout, inputs: cssIn.flatMap((c) => parts.slice(2).map((p) => [c, p])) },
  ]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the HUD layout record in Rust is built from the style in force, as the TypeScript builds it', { skip }, async () => {
  const { createHudScale } = await import('../src/hud-scale-service.ts');
  const hud = await import('../src/hud-scale.ts');
  const { buildVpk, entryAt } = await import('../src/vpk.ts');
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const { style, texture } = await import('./helpers/panorama.ts');
  const { createHash } = await import('node:crypto');
  setLang('en');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-hud-'));
  const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');
  const icon = 'panorama/images/hud/reborn/x_png.vtex';
  type Twin = { game: string; lib: string; ud: string; journal: string };
  const twin = (side: string): Twin => {
    const r = path.join(tmp, side);
    const game = path.join(r, 'game');
    const lang = path.join(game, 'dota_russian');
    fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
    fs.mkdirSync(lang, { recursive: true });
    fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([
      entryAt(hud.STYLE, style('#lower_hud{}', [])), entryAt(`${icon}_c`, texture(12, 34)),
    ]));
    // a HUD mod the app cannot read, before one it can
    fs.writeFileSync(path.join(lang, 'pak03_dir.vpk'), buildVpk([entryAt(hud.STYLE, Buffer.from('not a style'))]));
    fs.writeFileSync(path.join(lang, 'pak05_dir.vpk'), buildVpk([entryAt(hud.STYLE, style(`.mod{background-image:url("s2r://${icon}")}`, []))]));
    const lib = new Library(path.join(r, 'lib'));
    lib.add({ name: 'Broken HUD', categoryId: 'huds', styleLabel: null, fileRef: 'a', files: [{ root: 'lang', relPath: 'pak03_dir.vpk' }] } as never);
    lib.add({ name: 'Nice HUD', categoryId: 'huds', styleLabel: null, fileRef: 'b', files: [{ root: 'lang', relPath: 'pak05_dir.vpk' }] } as never);
    return { game, lib: path.join(r, 'lib'), ud: path.join(r, 'ud'), journal: path.join(r, 'journal') };
  };
  const a = twin('ts');
  const b = twin('rs');
  // the same ids on both sides, so the steps can name them
  fs.copyFileSync(path.join(a.lib, 'manifest.json'), path.join(b.lib, 'manifest.json'));
  type Op = [string, ...unknown[]];
  const steps: Op[][] = [
    [['state'], ['install', [{ id: 'lower_hud', scale: 87 }, { id: 'topbar', x: 10.6, y: -5000, opacity: 33, tint: '#ABCDEF', hidden: true }, { id: 'nope' }]], ['state'],
      ['install', 'junk'], ['state'], ['rebuild', ['zzz']]],
    // switched off, then rebuilt after an update: it stays off
    [['rebuild', ['$id']], ['state']],
    // a record from before the editor: one scale
    [['state'], ['rebuild', ['$id']], ['state']],
    // the game folder gone from the settings
    [['state'], ['install', []]],
  ];
  const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null, (k, x) => (/^(id|installedAt|updatedAt)$/.test(k) ? `<${k}>` : UUID.test(String(x)) ? '<uuid>' : x)));
  const manifest = (x: Twin) => JSON.parse(fs.readFileSync(path.join(x.lib, 'manifest.json'), 'utf8'));
  const tree = (g: string) => Object.fromEntries((fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[]).filter((e) => e.isFile())
    .map((e) => { const f = path.join(e.parentPath, e.name); return [path.relative(g, f), sha(fs.readFileSync(f))]; }).sort());
  const mineOf = (x: Twin) => manifest(x).installed.find((r: { generated?: { hud?: unknown } }) => typeof r.generated?.hud === 'number');
  for (const [k, ops] of steps.entries()) {
    for (const x of [a, b]) {
      FileTx.journalDir = x.journal;
      const inst = new Installer({ userDataDir: x.ud, getGamePath: () => x.game, getLangSuffix: () => 'russian' });
      const lib = new Library(x.lib);
      const rec = lib.list().find((r) => typeof (r.generated as { hud?: unknown } | undefined)?.hud === 'number');
      if (k === 1 && rec) { inst.setEnabled(rec.files, false, rec.id); lib.setEnabled(rec.id, false); }
      if (k === 2 && rec) lib.update(rec.id, { generated: { hud: 110, base: 'game' } } as never);
      FileTx.journalDir = null;
    }
    const gameOf = (x: Twin) => (k === 3 ? '' : x.game);
    const fill = (x: Twin) => ops.map((op) => op.map((v) => (Array.isArray(v) ? v.map((i) => (i === '$id' ? mineOf(x)?.id : i)) : v)));
    const answers: unknown[] = [];
    const log: string[] = [];
    FileTx.journalDir = a.journal;
    try {
      const inst = new Installer({ userDataDir: a.ud, getGamePath: () => gameOf(a) || null, getLangSuffix: () => 'russian' });
      const lib = new Library(a.lib);
      let rebuilt: string | null = null;
      const svc = createHudScale({ gamePath: () => gameOf(a) || null, installer: inst as never, library: lib, onRebuilt: (id) => { rebuilt = id; }, log: (m) => log.push(m) });
      for (const [op, ...args] of fill(a)) {
        try {
          if (op === 'state') answers.push(snap(svc.state()));
          else if (op === 'install') answers.push(snap(await svc.install(args[0])));
          else {
            rebuilt = null;
            const returned = svc.rebuild(args[0] as string[]);
            await new Promise((r) => setTimeout(r, 30));
            answers.push(snap({ returned, rebuilt }));
          }
        } catch (e) { answers.push(snap({ error: (e as Error).message })); }
      }
    } finally { FileTx.journalDir = null; }
    const list = path.join(tmp, `steps-${k}.json`);
    fs.writeFileSync(list, JSON.stringify([['hud.service', gameOf(b), 'russian', b.journal, b.lib, b.ud, fill(b)]]));
    const got = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' }))[0] as { ok?: { answers: unknown; log: string[] }; error?: string };
    assert.ok(got.ok, got.error);
    assert.deepEqual(norm(got.ok.answers), norm(answers), `steps ${k}`);
    assert.deepEqual(got.ok.log, log, `steps ${k}: the log`);
    assert.deepEqual(tree(b.game), tree(a.game), `steps ${k}: the game folder`);
    assert.deepEqual(norm(manifest(b)), norm(manifest(a)), `steps ${k}: the library`);
  }
  const rec = mineOf(a);
  assert.equal(rec.enabled, false, 'a rebuilt record stays off');
  assert.equal(rec.generated.base, 'Nice HUD', 'built on the mod the app could read');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('towers, trees and the map looks record in Rust build what the TypeScript builds', { skip }, async () => {
  const sandboxPak = path.join(sandboxGame, 'dota', 'pak01_dir.vpk');
  if (!fs.existsSync(sandboxPak)) return;
  const tl = await import('../src/tower-looks.ts');
  const ts = await import('../src/tree-sets.ts');
  const { itemVisuals } = await import('../src/item-visuals.ts');
  const { createMapLooks } = await import('../src/map-looks-service.ts');
  const { buildVpk, entryAt, openVpkIndex } = await import('../src/vpk.ts');
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const { createHash } = await import('node:crypto');
  setLang('en');
  const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-map-'));
  const itemsGame = openVpkIndex(sandboxPak).read('scripts/items/items_game.txt')!;
  const itemsFile = path.join(tmp, 'items_game.txt');
  fs.writeFileSync(itemsFile, itemsGame);
  const text = itemsGame.toString('latin1');
  const looks = tl.towerLooks(text);
  assert.ok(looks.length >= 5, 'the table has tower looks');
  const both = looks.find((l) => l.sides.length === 2)!;
  const radiantOnly = looks.find((l) => l.id !== both.id && l.sides.includes('radiant'))!;
  // a pak01 of the table, the files the looks name (one left out) and a few trees
  const planned = [...new Set(looks.flatMap((l) => (['radiant', 'dire'] as const).flatMap((s) => tl.towerPlan(itemVisuals(text, l.id)!.modifiers, s).files.map((f) => f.from))))];
  const winter = ts.TREE_SETS.find((x) => x.id === 'winter')!.models.map((m) => `${m}_c`);
  const files = new Map<string, Buffer>([['scripts/items/items_game.txt', itemsGame]]);
  for (const [k, f] of [...planned.slice(1), ...winter.slice(1), ...Object.values(tl.DEFAULT_TOWER).map((m) => `${m}_c`)].entries()) files.set(f, Buffer.from(`model ${k} ${f}`));
  const pakDir = path.join(tmp, 'pak');
  fs.mkdirSync(pakDir);
  const pak = path.join(pakDir, 'pak01_dir.vpk');
  fs.writeFileSync(pak, buildVpk([...files].map(([p, b]) => entryAt(p, b))));
  const real = fs.existsSync(GAME_PAK01) ? GAME_PAK01 : null;
  const pick = (r: string | null, d: string | null) => [r, d];
  const builds = [pick(both.id, both.id), pick(both.id, null), pick(null, both.id), pick(radiantOnly.id, null), pick(null, null), pick('999999999', null), pick(radiantOnly.id, radiantOnly.id)];
  compare([
    { name: 'tower-looks.ids', ts: ((x: string) => tl.towerLookIds(Buffer.from(x, 'latin1').toString('latin1'))) as never, inputs: [[{ $file: itemsFile }], ['\n\t\t"5"{ "asset" "npc_dota_goodguys_tower1" }'], ['']] },
    { name: 'tower-looks.looks', ts: ((x: string) => tl.towerLooks(x)) as never, inputs: [[{ $file: itemsFile }]] },
    { name: 'tower-looks.plan', ts: ((x: string, id: string, side: 'radiant' | 'dire') => tl.towerPlan(itemVisuals(x, id)?.modifiers ?? [], side)) as never,
      inputs: looks.flatMap((l) => [[{ $file: itemsFile }, l.id, 'radiant'], [{ $file: itemsFile }, l.id, 'dire']]) },
    { name: 'tower-looks.build', ts: ((p: string, x: string, r: string | null, d: string | null) => {
      const b = tl.buildTowers({ pak01: p, text: x, radiant: r, dire: d });
      return { vpk: sha(b.vpk), names: b.names, files: b.files, missing: b.missing, skipped: b.skipped };
    }) as never, inputs: [...builds.map((b) => [pak, { $file: itemsFile }, ...b]), ...(real ? looks.map((l) => [real, { $file: itemsFile }, l.sides.includes('radiant') ? l.id : null, l.sides.includes('dire') ? l.id : null]) : [])] },
    { name: 'tree-sets.plan', ts: ((side: 'radiant' | 'dire', id: string) => ts.treePlan(side, ts.TREE_SETS.find((x) => x.id === id)!)) as never,
      inputs: ts.TREE_SETS.flatMap((x) => [['radiant', x.id], ['dire', x.id]]) },
    { name: 'tree-sets.build', ts: ((p: string, r: string | null, d: string | null) => { const b = ts.buildTrees({ pak01: p, radiant: r, dire: d }); return { vpk: sha(b.vpk), files: b.files, missing: b.missing }; }) as never,
      inputs: [[pak, 'winter', null], [pak, 'winter', 'winter'], [pak, 'radiant', 'dire'], [pak, null, null], [pak, 'nope', null], [pak, '', 'topiary'],
        ...(real ? ts.TREE_SETS.map((x) => [real, x.id, x.id]) : [])] },
  ]);

  // the records: twin games and libraries, the same steps on each
  type Twin = { game: string; lib: string; ud: string; journal: string };
  const twin = (side: string): Twin => {
    const r = path.join(tmp, side);
    const game = path.join(r, 'game');
    fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
    fs.mkdirSync(path.join(game, 'dota_russian'), { recursive: true });
    fs.copyFileSync(pak, path.join(game, 'dota', 'pak01_dir.vpk'));
    return { game, lib: path.join(r, 'lib'), ud: path.join(r, 'ud'), journal: path.join(r, 'journal') };
  };
  const a = twin('ts');
  const b = twin('rs');
  type Op = unknown[];
  const steps: Op[][] = [
    [['state'], ['install', 'bridges', 'x', null], ['install', 'towers', null, ''], ['install', 'towers', 'nope', null], ['install', 'towers', both.id, both.id],
      ['install', 'trees', 'winter', null], ['state'], ['install', 'towers', radiantOnly.id, null], ['install', 'trees', 'desert-dire', null], ['install', 'trees', 'topiary', 'jungle'], ['state']],
    // switched off, then an update: both built again, the towers still off
    [['rebuild', ['$towers', '$trees', 'zzz']], ['state']],
  ];
  const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null, (k, x) => (/^(id|installedAt|updatedAt)$/.test(k) ? `<${k}>` : UUID.test(String(x)) ? '<uuid>' : x)));
  const manifest = (x: Twin) => JSON.parse(fs.readFileSync(path.join(x.lib, 'manifest.json'), 'utf8'));
  const tree = (g: string) => Object.fromEntries((fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[]).filter((e) => e.isFile())
    .map((e) => { const f = path.join(e.parentPath, e.name); return [path.relative(g, f), sha(fs.readFileSync(f))]; }).sort());
  const idOf = (x: Twin, kind: string) => manifest(x).installed.find((r: { generated?: { map?: string } }) => r.generated?.map === kind)?.id;
  for (const [k, ops] of steps.entries()) {
    if (k === 1) {
      for (const x of [a, b]) {
        FileTx.journalDir = x.journal;
        const inst = new Installer({ userDataDir: x.ud, getGamePath: () => x.game, getLangSuffix: () => 'russian' });
        const lib = new Library(x.lib);
        const rec = lib.list().find((r) => (r.generated as { map?: string } | undefined)?.map === 'towers')!;
        inst.setEnabled(rec.files, false, rec.id);
        lib.setEnabled(rec.id, false);
        FileTx.journalDir = null;
      }
    }
    const fill = (x: Twin) => ops.map((op) => op.map((v) => (Array.isArray(v) ? v.map((i) => (i === '$towers' ? idOf(x, 'towers') : i === '$trees' ? idOf(x, 'trees') : i)) : v)));
    const answers: unknown[] = [];
    const log: string[] = [];
    FileTx.journalDir = a.journal;
    try {
      const inst = new Installer({ userDataDir: a.ud, getGamePath: () => a.game, getLangSuffix: () => 'russian' });
      const lib = new Library(a.lib);
      const svc = createMapLooks({ gamePath: () => a.game, installer: inst as never, library: lib, log: (m) => log.push(m) });
      for (const [op, ...args] of fill(a)) {
        try {
          if (op === 'state') answers.push(snap(svc.state()));
          else if (op === 'install') answers.push(snap(svc.install(args[0], args[1], args[2])));
          else answers.push(snap(svc.rebuild(args[0] as string[])));
        } catch (e) { answers.push(snap({ error: (e as Error).message })); }
      }
    } finally { FileTx.journalDir = null; }
    const list = path.join(tmp, `steps-${k}.json`);
    fs.writeFileSync(list, JSON.stringify([['map-looks.service', b.game, 'russian', b.journal, b.lib, b.ud, fill(b)]]));
    const got = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8', maxBuffer: 1 << 28 }))[0] as { ok?: { answers: unknown; log: string[] }; error?: string };
    assert.ok(got.ok, got.error);
    assert.deepEqual(norm(got.ok.answers), norm(answers), `steps ${k}`);
    assert.deepEqual(got.ok.log, log, `steps ${k}: the log`);
    assert.deepEqual(tree(b.game), tree(a.game), `steps ${k}: the game folder`);
    assert.deepEqual(norm(manifest(b)), norm(manifest(a)), `steps ${k}: the library`);
  }
  const towers = manifest(a).installed.find((r: { generated?: { map?: string } }) => r.generated?.map === 'towers');
  assert.equal(towers.enabled, false, 'the towers stay off through the rebuild');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the map without its decor in Rust finds and blanks the materials the TypeScript does', { skip }, async () => {
  const md = await import('../src/map-decor.ts');
  const { buildVpk, entryAt, openVpkIndex } = await import('../src/vpk.ts');
  const { drain } = await import('../src/steps.ts');
  const { Installer } = await import('../src/installer.ts');
  const { Library } = await import('../src/library.ts');
  const { FileTx } = await import('../src/file-tx.ts');
  const { createHash } = await import('node:crypto');
  setLang('en');
  const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-decor-'));
  const vpkAt = (file: string, files: [string, string | Buffer][]) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buildVpk(files.map(([p, b]) => entryAt(p, Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1')))));
    return file;
  };
  // a map naming materials and models straight and in mixed case, models naming more of them
  const mapFiles = (extra = ''): [string, string][] => [
    ['maps/dota/world.vwrld_c', `\0materials/models/props_nature/grass_01.vmat\0Materials/Nature/Card_Grass_A.VMAT_c models/props_debris/rocks_01.vmdl\0${extra}`],
    ['maps/dota/entities/default_ents.vents_c', 'models/props_tree/tree_pine_01.vmdl models/props_wildlife/frog.vmdl models/heroes/axe/axe.vmdl'],
    ['maps/dota/nodes.vwnod_c', 'materials/overlays/blood/splat.vmat materials/overlays/leaves/pile.vmat materials/terrain/ground.vmat materials/models/props_bones/skull.vmaté'],
  ];
  const pakFiles: [string, string][] = [
    [md.BLANK, 'blank material'],
    ['models/props_debris/rocks_01.vmdl_c', 'x materials/models/props_rock/rock_02.vmat y materials/models/props_magic/orb.vmat'],
    ['models/props_wildlife/frog.vmdl_c', 'materials/models/props_wildlife/frog_skin.vmat'],
    ['models/props_tree/tree_pine_01.vmdl_c', 'materials/models/props_tree/pine.vmat'],
    ...['materials/models/props_nature/grass_01.vmat_c', 'materials/nature/card_grass_a.vmat_c', 'materials/models/props_rock/rock_02.vmat_c',
      'materials/models/props_wildlife/frog_skin.vmat_c', 'materials/overlays/blood/splat.vmat_c', 'materials/models/props_bones/skull.vmat_c',
      'materials/terrain/ground.vmat_c', 'materials/models/props_tree/pine.vmat_c'].map((p) => [p, `material ${p}`] as [string, string]),
  ];
  const map = vpkAt(path.join(tmp, 'm', 'dota.vpk'), mapFiles());
  const pak = vpkAt(path.join(tmp, 'p', 'pak01_dir.vpk'), pakFiles);
  const real = fs.existsSync(GAME_PAK01) && fs.existsSync(path.join(path.dirname(GAME_PAK01), 'maps', 'dota.vpk'))
    ? [[path.join(path.dirname(GAME_PAK01), 'maps', 'dota.vpk'), GAME_PAK01]] : [];
  compare([
    { name: 'map-decor.clampGroups', ts: md.clampGroups, inputs: [[null], ['plants'], [[]], [['debris', 'plants', 'plants', 'x']], [['debris']]] },
    { name: 'map-decor.materials', ts: ((m: string, p: string) => drain(md.decorMaterialsSteps(openVpkIndex(m), openVpkIndex(p)))) as never, inputs: [[map, pak], ...real] },
  ]);

  type Twin = { game: string; lib: string; ud: string; journal: string };
  const twin = (side: string): Twin => {
    const r = path.join(tmp, side);
    const game = path.join(r, 'game');
    vpkAt(path.join(game, 'dota', 'maps', 'dota.vpk'), mapFiles());
    vpkAt(path.join(game, 'dota', 'pak01_dir.vpk'), pakFiles);
    fs.mkdirSync(path.join(game, 'dota_russian'), { recursive: true });
    return { game, lib: path.join(r, 'lib'), ud: path.join(r, 'ud'), journal: path.join(r, 'journal') };
  };
  const a = twin('ts');
  const b = twin('rs');
  const steps: unknown[][][] = [
    [['state'], ['install', []], ['install', 'plants'], ['install', ['plants']], ['state'], ['install', ['debris', 'plants']], ['state'], ['rebuild', ['zzz']]],
    // a whole-map terrain in the language folder, the record switched off, and an update
    [['state'], ['rebuild', ['$id']], ['state']],
    // no game folder
    [['state'], ['install', ['debris']]],
  ];
  const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null, (k, x) => (/^(id|installedAt|updatedAt)$/.test(k) ? `<${k}>` : UUID.test(String(x)) ? '<uuid>' : x)));
  const manifest = (x: Twin) => JSON.parse(fs.readFileSync(path.join(x.lib, 'manifest.json'), 'utf8'));
  const tree = (g: string) => Object.fromEntries((fs.readdirSync(g, { recursive: true, withFileTypes: true }) as fs.Dirent[]).filter((e) => e.isFile())
    .map((e) => { const f = path.join(e.parentPath, e.name); return [path.relative(g, f), sha(fs.readFileSync(f))]; }).sort());
  const mineOf = (x: Twin) => manifest(x).installed.find((r: { generated?: { decor?: unknown } }) => Array.isArray(r.generated?.decor));
  for (const [k, ops] of steps.entries()) {
    if (k === 1) {
      for (const x of [a, b]) {
        vpkAt(path.join(x.game, 'dota_russian', 'maps', 'dota.vpk'), mapFiles('materials/overlays/petals/rose.vmat materials/models/props_rock/rock_02.vmat'));
        FileTx.journalDir = x.journal;
        const inst = new Installer({ userDataDir: x.ud, getGamePath: () => x.game, getLangSuffix: () => 'russian' });
        const lib = new Library(x.lib);
        const rec = lib.list().find((r) => Array.isArray((r.generated as { decor?: unknown } | undefined)?.decor))!;
        inst.setEnabled(rec.files, false, rec.id);
        lib.setEnabled(rec.id, false);
        FileTx.journalDir = null;
      }
    }
    const gameOf = (x: Twin) => (k === 2 ? '' : x.game);
    const fill = (x: Twin) => ops.map((op) => op.map((v) => (Array.isArray(v) ? v.map((i) => (i === '$id' ? mineOf(x)?.id : i)) : v)));
    const answers: unknown[] = [];
    const log: string[] = [];
    FileTx.journalDir = a.journal;
    try {
      const inst = new Installer({ userDataDir: a.ud, getGamePath: () => gameOf(a) || null, getLangSuffix: () => 'russian' });
      const lib = new Library(a.lib);
      let rebuilt: string | null = null;
      const svc = md.createMapDecor({ gamePath: () => gameOf(a) || null, installer: inst as never, library: lib, onRebuilt: (id) => { rebuilt = id; }, log: (m) => log.push(m) });
      for (const [op, ...args] of fill(a)) {
        try {
          if (op === 'state') answers.push(snap(await svc.state()));
          else if (op === 'install') answers.push(snap(await svc.install(args[0])));
          else {
            rebuilt = null;
            const returned = svc.rebuild(args[0] as string[]);
            await new Promise((r) => setTimeout(r, 100));
            answers.push(snap({ returned, rebuilt }));
          }
        } catch (e) { answers.push(snap({ error: (e as Error).message })); }
      }
    } finally { FileTx.journalDir = null; }
    const list = path.join(tmp, `steps-${k}.json`);
    fs.writeFileSync(list, JSON.stringify([['map-decor.service', gameOf(b), 'russian', b.journal, b.lib, b.ud, fill(b)]]));
    const got = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' }))[0] as { ok?: { answers: unknown; log: string[] }; error?: string };
    assert.ok(got.ok, got.error);
    assert.deepEqual(norm(got.ok.answers), norm(answers), `steps ${k}`);
    assert.deepEqual(got.ok.log, log, `steps ${k}: the log`);
    assert.deepEqual(tree(b.game), tree(a.game), `steps ${k}: the game folder`);
    assert.deepEqual(norm(manifest(b)), norm(manifest(a)), `steps ${k}: the library`);
  }
  assert.equal(mineOf(a).enabled, false, 'a rebuilt record stays off');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the pumpkin in Rust reads keys, spends them and fetches the prize as the TypeScript does', { skip }, async () => {
  const pk = await import('../src/pumpkin.ts');
  const { Settings } = await import('../src/settings.ts');
  const { Library } = await import('../src/library.ts');
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-pumpkin-'));
  const typed = ['', '   ', 'short', 'aaaa-aaaa-aaaa-aaaa', 'AAAA AAAA AAAA AAAA', 'фффффффффффффффф', 'АААА ВВВВ СССС ЕЕЕЕ', 'ФЫВА-ФЫВА-ФЫВА-ФЫВА',
    'used-used-used-used', 'a1b2c3d4e5f6g7h8i9', 'straße-straße-1234', 'ńñ00000000000000', '0123456789abcdef', 'ЙЦУКЕНГШЩЗХЪ1234'];
  const nights = [{}, { nightRound: 1, blood: true }, { nightRound: 0, blood: true, theme: 'blood', secret: true }, { theme: 'secret' }, { nightRound: '1', theme: 'dark' }];
  const nightDirs = nights.flatMap((n, i) => ['ts', 'rs'].map((side) => {
    const d = path.join(tmp, `night-${i}-${side}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify(n));
    return d;
  }));
  compare([{ name: 'pumpkin.readings', ts: pk.readings, inputs: typed.map((x) => [x]) }]);
  const listNight = path.join(tmp, 'night.json');
  fs.writeFileSync(listNight, JSON.stringify(nights.map((_, i) => ['pumpkin.beginNightAgain', nightDirs[2 * i + 1]])));
  const rsNight = JSON.parse(execFileSync(cli, ['call', listNight], { encoding: 'utf8' })) as { ok: unknown }[];
  for (const [i] of nights.entries()) {
    const st = new Settings(nightDirs[2 * i]);
    assert.deepEqual(rsNight[i].ok, pk.beginNightAgain(st as never), `night ${i}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(nightDirs[2 * i + 1], 'settings.json'), 'utf8')),
      JSON.parse(fs.readFileSync(path.join(nightDirs[2 * i], 'settings.json'), 'utf8')), `night ${i}: the settings`);
  }

  // the worker: one key that opens, one spent, one the server chokes on, prizes that do not land
  const seen: Record<string, string[]> = { ts: [], rs: [] };
  const server = http.createServer((req, res) => {
    const [, side, ...rest] = (req.url ?? '').split('/');
    const at = `/${rest.join('/')}`;
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen[side]?.push(`${req.method} ${at} ${body}`);
      const u = new URL(at, 'http://x');
      const key = u.searchParams.get('key') ?? (body ? JSON.parse(body).key : '');
      if (u.pathname === '/redeem') {
        const code = key === 'USEDUSEDUSEDUSED' ? 409 : key.startsWith('BROKEN') ? 500 : ['AAAAAAAAAAAAAAAA', 'BADPRIZE00000000', 'BOOM000000000000', 'NOPRIZE000000000'].includes(key) ? 200 : 404;
        res.writeHead(code).end();
      } else if (u.pathname === '/mod') {
        if (key === 'NOPRIZE000000000') res.writeHead(503).end();
        else res.writeHead(200).end(key === 'AAAAAAAAAAAAAAAA' ? `VPK prize ${u.searchParams.get('voice')}` : key === 'BOOM000000000000' ? 'boom' : 'junk');
      } else if (u.pathname === '/mod/preview') {
        if (key === 'AAAAAAAAAAAAAAAA') res.writeHead(200, { 'Content-Type': 'image/webp' }).end(Buffer.from([1, 2, 3, 250]));
        else res.writeHead(404).end();
      } else res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const dead = await new Promise<string>((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as import('node:net').AddressInfo).port; s.close(() => r(`http://127.0.0.1:${p}`)); }); });
  const INSTALL = '0123456789abcdef0123456789abcdef';
  type Run = { name: string; host: (side: string) => string; voice: string | null; seed: Record<string, unknown>; ops: unknown[][] };
  const runs: Run[] = [
    { name: 'night', host: (s) => `${base}/${s}`, voice: 'russian', seed: { pumpkinInstall: INSTALL },
      ops: [['has'], ['again'], ['redeem', null], ['redeem', '  '], ['redeem', 'nope'], ['redeem', 'used-used-used-used'], ['redeem', 'broken-key-12345'],
        ['redeem', '0000-0000-0000-0001'], ['redeem', 'nopr-ize0-0000-0000'], ['redeem', 'BADPRIZE00000000'], ['redeem', 'boom000000000000'],
        ['redeem', 'фффф-фффф-фффф-фффф'], ['has'], ['again'], ['has'], ['install']] },
    { name: 'no voice', host: (s) => `${base}/${s}`, voice: null, seed: { pumpkinInstall: INSTALL, bloodKey: 'AAAAAAAAAAAAAAAA' }, ops: [['again'], ['has']] },
    { name: 'offline', host: () => dead, voice: null, seed: { pumpkinInstall: INSTALL, bloodKey: 'NOPRIZE000000000' }, ops: [['redeem', 'aaaaaaaaaaaaaaaa'], ['again']] },
  ];
  const dirs = (side: string, r: Run) => {
    const d = path.join(tmp, `${r.name}-${side}`);
    fs.mkdirSync(path.join(d, 'ud'), { recursive: true });
    fs.writeFileSync(path.join(d, 'ud', 'settings.json'), JSON.stringify(r.seed));
    return { ud: path.join(d, 'ud'), lib: path.join(d, 'lib') };
  };
  const list = path.join(tmp, 'calls.json');
  fs.writeFileSync(list, JSON.stringify(runs.map((r) => { const d = dirs('rs', r); return ['pumpkin.script', r.host('rs'), d.ud, d.lib, r.voice, r.ops]; })));
  const rsRun = new Promise<string>((resolve, reject) => {
    const p = spawn(cli, ['call', list]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`mm-cli exited ${code}`))));
  });
  const want: unknown[] = [];
  for (const r of runs) {
    const d = dirs('ts', r);
    const settings = new Settings(d.ud);
    const library = new Library(d.lib);
    let n = 90;
    const log: string[] = [];
    const p = pk.createPumpkin({
      settings: settings as never, library: library as never, voice: () => r.voice, host: r.host('ts'), log: (m) => log.push(m),
      importVpkPaths: async (paths: string[]) => {
        const data = fs.readFileSync(paths[0]);
        if (data.subarray(0, 4).toString() === 'boom') return { error: 'boom' };
        if (data.subarray(0, 3).toString() !== 'VPK') return { imported: [], errors: [{ error: 'not a vpk' }] };
        const relPath = `pak${++n}_dir.vpk`;
        const name = path.basename(paths[0], '.vpk');
        library.add({ name, categoryId: 'imported', styleLabel: null, fileRef: null, files: [{ root: 'lang', relPath }] } as never);
        return { imported: [{ name, relPath }], errors: [] };
      },
    });
    const answers: unknown[] = [];
    for (const op of r.ops) {
      if (op[0] === 'redeem') answers.push(snap(await p.redeem(op[1])));
      else if (op[0] === 'again') answers.push(snap(await p.prizeAgain()));
      else if (op[0] === 'has') answers.push(p.hasPrize());
      else answers.push(p.install());
    }
    want.push({ answers, log });
  }
  const got = (JSON.parse(await rsRun) as { ok?: unknown; error?: string }[]).map((a) => { assert.ok(a.ok, a.error); return a.ok; });
  server.closeAllConnections(); server.close();
  // how a refused connection is worded is the platform's
  const calm = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => ((k === 'detail' || k === 'error') && typeof x === 'string' && /fetch failed|os error|refused|connect/i.test(x) ? '<why>' : typeof x === 'string' && x.startsWith('pumpkin: ') && !x.includes('prize') ? 'pumpkin: <why>' : x)));
  const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null, (k, x) => (/^(id|installedAt|updatedAt)$/.test(k) ? `<${k}>` : x)));
  for (const [i, r] of runs.entries()) {
    assert.deepEqual(calm(got[i]), calm(want[i]), r.name);
    const [a, b] = ['ts', 'rs'].map((side) => path.join(tmp, `${r.name}-${side}`));
    const file = (d: string, f: string) => (fs.existsSync(path.join(d, f)) ? JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) : null);
    assert.deepEqual(file(b, 'ud/settings.json'), file(a, 'ud/settings.json'), `${r.name}: the settings`);
    assert.deepEqual(norm(file(b, 'lib/manifest.json')), norm(file(a, 'lib/manifest.json')), `${r.name}: the library`);
  }
  assert.deepEqual(seen.rs, seen.ts, 'the requests');
  const night = (want[0] as { answers: { ok?: boolean; installed?: string }[] }).answers;
  assert.ok(night.some((x) => x.ok && x.installed === pk.PRIZE_NAME), 'a key did open the night');
  // a missing install name is made, 32 hex digits, and kept
  const fresh = path.join(tmp, 'fresh');
  fs.mkdirSync(fresh);
  fs.writeFileSync(list, JSON.stringify([['pumpkin.script', base, fresh, path.join(tmp, 'fresh-lib'), null, [['install'], ['install']]]]));
  const [made] = JSON.parse(execFileSync(cli, ['call', list], { encoding: 'utf8' })) as { ok: { answers: string[] } }[];
  assert.match(made.ok.answers[0], /^[0-9a-f]{32}$/);
  assert.equal(made.ok.answers[1], made.ok.answers[0]);
  fs.rmSync(tmp, { recursive: true, force: true });
});
