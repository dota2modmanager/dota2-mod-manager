/* Finding an effect by hero and ability (src/effect-finder.ts) on a small game. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEffectFinder } from '../src/effect-finder.ts';
import { rerl, resource } from './helpers/kv3-build.ts';
import type { VpkIndex } from '../src/vpk-read.ts';

const system = (...children: string[]) => resource([['RERL', rerl(children)]]);
const script = '"DOTAHeroes" { "npc_dota_hero_axe" { "Ability1" "axe_berserkers_call" "Ability2" "axe_counter_helix" } }';
const names = '"lang" { "Language" "english" "Tokens" { "DOTA_Tooltip_ability_axe_berserkers_call" "Berserker\'s Call" } }';
const files = new Map<string, Buffer>([
  ['scripts/npc/heroes/npc_dota_hero_axe.txt', Buffer.from(script)],
  ['resource/localization/abilities_english.txt', Buffer.from(names)],
  ['particles/units/heroes/hero_axe/axe_berserkers_call.vpcf_c', system('particles/units/heroes/hero_axe/axe_berserkers_call_a.vpcf_c')],
  ['particles/units/heroes/hero_axe/axe_berserkers_call_a.vpcf_c', system()],
  ['particles/econ/items/axe/axe_ti9/axe_ti9_call.vpcf_c', system()],
]);
const index = { read: (p: string) => files.get(p) ?? null, paths: () => files.keys() } as unknown as VpkIndex;
const finder = () => createEffectFinder({ index: () => index, lang: () => 'en', heroes: () => [{ hero: 'axe', name: 'Axe' }] });

test('a hero reads as his abilities, with what an effect brings along left to that effect', () => {
  const groups = finder().hero('axe');
  const call = groups.find((g) => g.ability === 'axe_berserkers_call');
  assert.equal(call?.name, 'Berserker\'s Call');
  assert.deepEqual(call?.paths, ['particles/units/heroes/hero_axe/axe_berserkers_call.vpcf']);
  assert.deepEqual(groups.find((g) => g.kind === 'items')?.paths, ['particles/econ/items/axe/axe_ti9/axe_ti9_call.vpcf']);
});

test('a search finds an ability by its name or its id, and a hero that is not one has nothing', () => {
  assert.deepEqual(finder().abilities('berserker call'), [{ hero: 'axe', ability: 'axe_berserkers_call', name: 'Berserker\'s Call' }]);
  assert.equal(finder().abilities('counter')[0].ability, 'axe_counter_helix');
  assert.deepEqual(finder().abilities('  '), []);
  assert.deepEqual(finder().hero('../evil'), []);
});

test('an ability reads as what it plays and the files it may call on, and a table says what items swap in', () => {
  const table = '"items" { "1" { "visuals" { "asset_modifier1" { "type" "particle" "asset" "particles/units/heroes/hero_axe/axe_berserkers_call_a.vpcf" "modifier" "particles/econ/items/axe/axe_ti9/axe_ti9_call.vpcf" } "asset_modifier2" { "type" "particle_create" "modifier" "particles/econ/items/axe/axe_ti9/none.vpcf" } "asset_modifier3" { "type" "particle" "asset" "particles/units/heroes/hero_axe/axe_berserkers_call.vpcf" "modifier" "particles/econ/items/axe/gone.vpcf" } } } }';
  const f = createEffectFinder({ index: () => index, lang: () => 'en', heroes: () => [], table: () => table });
  const a = f.ability('axe', 'axe_berserkers_call');
  assert.deepEqual(a?.paths, ['particles/units/heroes/hero_axe/axe_berserkers_call.vpcf']);
  assert.equal(a?.files.length, 2);
  // a swap to a file the game does not have is no version
  assert.deepEqual(f.variants(a!.files), ['particles/econ/items/axe/axe_ti9/axe_ti9_call.vpcf']);
  assert.equal(f.ability('axe', 'nothing'), null);
  assert.deepEqual(finder().variants(a!.files), []);
});
