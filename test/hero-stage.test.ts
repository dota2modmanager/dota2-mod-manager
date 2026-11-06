/* How the 3D preview stages a hero as the game's loadout does: its staging out of the game's files
 * (src/hero-showcase.ts), the clip it plays (src/model-loadout.ts), and how far the camera steps
 * back for a hero wider than the stage (renderer/catalog/preview3d/stage.ts). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forward, heroStage, showcaseEntry, toGlb, LOADOUT_CAMERA } from '../src/hero-showcase.ts';
import { idleSequence, itemActivities, itemModifiers, loadoutSequence, modelSequences, motionList } from '../src/model-loadout.ts';
import { motionLabels } from '../renderer/catalog/preview3d/motion-label.ts';
import { widthDistance } from '../renderer/catalog/preview3d/stage.ts';

const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

const SHOWCASE = `"Portraits"
{
\t"npc_dota_hero_juggernaut"
\t{
\t\t"PortraitLightPosition"\t\t"100 0 180"
\t\t"PortraitLightColor"\t\t"255 127.5 0"
\t\t"PortraitLightScale"\t\t"2"
\t\t"PortraitAmbientColor"\t\t"51 51 51"
\t\t"PortraitAmbientDirection"\t\t"0 180 0"
\t\t"PortraitBackgroundColor1"\t\t"0.53 0 0.04"
\t\t"PortraitBackgroundModel"\t\t"models/heroes/pedestal/pedestal_1_small.vmdl"
\t}
\t"models/heroes/juggernaut/juggernaut_arcana.vmdl"
\t{
\t\t"PortraitBackgroundColor1"\t\t"0 0 1"
\t\t"PortraitBackgroundModel"\t\t"../not/a/model"
\t}
}
`;

test('Source axes and inches become the GLB’s: forward is +Z, up is +Y', () => {
  assert.deepEqual(toGlb([1, 2, 3]), [2, 3, 1]);
  assert.deepEqual(toGlb([10, 0, 0], 0.5), [0, 0, 5]);
  assert.ok(near(forward([0, 90, 0]), [0, 1, 0]));
  assert.ok(near(forward([90, 0, 0]), [0, 0, -1]));
});

test('a showcase entry is found by the most particular key first, in any spelling of the path', () => {
  assert.equal(showcaseEntry(SHOWCASE, ['Models\\Heroes\\Juggernaut\\Juggernaut_Arcana.vmdl', 'npc_dota_hero_juggernaut'])?.get('PortraitBackgroundColor1'), '0 0 1');
  assert.equal(showcaseEntry(SHOWCASE, ['models/x.vmdl', 'npc_dota_hero_juggernaut'])?.get('PortraitLightScale'), '2');
  assert.equal(showcaseEntry(SHOWCASE, ['npc_dota_hero_pudge']), null);
  assert.equal(showcaseEntry('not a kv file {', ['npc_dota_hero_juggernaut']), null);
});

test('the stage is the hero’s scale, the loadout camera, its light, ambient, background and pedestal', () => {
  const s = heroStage(SHOWCASE, '"LoadoutScale"\t\t"0.85"', ['models/heroes/juggernaut/juggernaut.vmdl', 'npc_dota_hero_juggernaut']);
  assert.equal(s.scale, 0.85);
  assert.ok(near(s.camera, toGlb([LOADOUT_CAMERA.x, LOADOUT_CAMERA.y, LOADOUT_CAMERA.z], 0.0254)));
  // the light at (100, 0, 180) aimed at the hero's middle, 80 up: straight ahead and as high again
  assert.ok(near(s.key!.from, [0, Math.SQRT1_2, Math.SQRT1_2]));
  assert.ok(near(s.key!.color, [2, 1, 0]));
  // the ambient shines toward -X, so it comes from +X: the hero's front
  assert.ok(near(s.ambient!.from, [0, 0, 1]));
  assert.ok(near(s.ambient!.color, [0.2, 0.2, 0.2]));
  assert.deepEqual(s.background, [0.53, 0, 0.04]);
  assert.equal(s.pedestal, 'models/heroes/pedestal/pedestal_1_small.vmdl');
});

test('a hero the game says nothing about stands at scale 1 with no light, colour or pedestal of its own', () => {
  const s = heroStage(null, null, ['npc_dota_hero_juggernaut']);
  assert.deepEqual([s.scale, s.key, s.ambient, s.background, s.pedestal], [1, null, null, null, null]);
  // a pedestal that is not a model path is not handed on
  assert.equal(heroStage(SHOWCASE, null, ['models/heroes/juggernaut/juggernaut_arcana.vmdl']).pedestal, null);
});

const SEQS = [
  { name: 'idle', acts: ['ACT_DOTA_IDLE'] },
  { name: 'loadout', acts: ['ACT_DOTA_LOADOUT'] },
  { name: 'loadout_arcana', acts: ['ACT_DOTA_LOADOUT', 'arcana'] },
  { name: 'loadout_arcana_sword', acts: ['ACT_DOTA_LOADOUT', 'arcana', 'Sword'] },
  { name: 'statue', acts: ['ACT_DOTA_LOADOUT_STATUE'] },
];

test('the loadout clip is the one for what is worn, the plain one otherwise', () => {
  assert.equal(loadoutSequence(SEQS), 'loadout');
  assert.equal(loadoutSequence(SEQS, ['arcana']), 'loadout_arcana');
  assert.equal(loadoutSequence(SEQS, ['arcana', 'sword']), 'loadout_arcana_sword');
  // a modifier the item does not bring rules a sequence out
  assert.equal(loadoutSequence(SEQS, ['sword']), 'loadout');
  assert.equal(loadoutSequence(SEQS.filter((s) => s.name === 'idle')), null);
  assert.deepEqual(modelSequences(null), []);
  assert.deepEqual(modelSequences(Buffer.from('not a model')), []);
});

test('a body of its own writes its loadout as an idle with "loadout", and its idle under its own name (CM arcana)', () => {
  const arcana = [
    { name: 'arcana_idle_anim', acts: ['ACT_DOTA_IDLE'] },
    { name: 'arcana_agg_idle_anim', acts: ['ACT_DOTA_IDLE', 'aggressive'] },
    { name: 'arcana_loadout_spawn', acts: ['ACT_DOTA_SPAWN', 'loadout'] },
    { name: 'arcana_loadout_idle_long', acts: ['ACT_DOTA_IDLE', 'loadout'] },
    { name: 'dplus_arcana_loadout_idle_long', acts: ['ACT_DOTA_IDLE', 'loadout', 'loadout', 'dota_plus'] },
  ];
  assert.equal(loadoutSequence(arcana, ['arcana']), 'arcana_loadout_idle_long');
  assert.equal(idleSequence(arcana), 'arcana_idle_anim');
  assert.equal(idleSequence(SEQS), 'idle', 'a sequence named idle first');
  assert.equal(idleSequence([]), null);
});

test('an item’s activities are its first style’s "activity" modifiers', () => {
  const block = `"visuals"
{
\t"asset_modifier0" { "type" "activity" "modifier" "arcana" }
\t"asset_modifier1" { "type" "activity" "modifier" "odachi" "style" "1" }
\t"asset_modifier2" { "type" "particle" "modifier" "particles/x.vpcf" }
}`;
  assert.deepEqual(itemActivities(block), ['arcana']);
});

test('the camera steps back far enough for the hero’s width, and further for a narrower view', () => {
  const t = Math.tan((20 * Math.PI) / 360);
  assert.ok(Math.abs(widthDistance({ x: 2, z: 0 }, 1, 20, { x: 1, z: 0 }, 0, 1) - 1 / t) < 1e-9);
  assert.ok(widthDistance({ x: 2, z: 0 }, 0.5, 20) > widthDistance({ x: 2, z: 0 }, 1, 20));
  // seen from the side, the hero's depth is its width
  assert.ok(Math.abs(widthDistance({ x: 0, z: 2 }, 1, 20, { x: 0, z: 1 }, 0, 1) - 1 / t) < 1e-9);
});

test('a hero holding a weapon out to one side steps back for its far end', () => {
  const t = Math.tan((20 * Math.PI) / 360);
  const centred = widthDistance({ x: 2, z: 0 }, 1, 20, { x: 1, z: 0 }, 0, 1);
  assert.ok(Math.abs(widthDistance({ x: 2, z: 0 }, 1, 20, { x: 1, z: 0 }, -1, 1) - (centred + 1 / t)) < 1e-9);
});

test('what the hero wears changes every motion it has a variant for, as the loadout', () => {
  const seqs = [
    { name: 'run', acts: ['ACT_DOTA_RUN'] }, { name: 'run_hook', acts: ['ACT_DOTA_RUN', 'whalehook'] },
    { name: 'run_injured', acts: ['ACT_DOTA_RUN', 'injured'] }, { name: 'run_injured_hook', acts: ['ACT_DOTA_RUN', 'injured', 'whalehook'] },
    { name: 'attack', acts: ['ACT_DOTA_ATTACK'] }, { name: 'attack2', acts: ['ACT_DOTA_ATTACK'] },
  ];
  assert.deepEqual(motionList(seqs, ['WhaleHook']).map((m) => m.name), ['run_hook', 'run_injured_hook', 'attack', 'attack2']);
  assert.deepEqual(motionList(seqs).map((m) => m.name), ['run', 'run_hook', 'run_injured', 'run_injured_hook', 'attack', 'attack2']);
});

test('a motion that needs an item the hero does not wear is not on its list', () => {
  const text = '"asset_modifier" { "type" "activity" "modifier" "Whalehook" }\n"asset_modifier" { "type" "activity" "asset" "ACT_DOTA_RUN" "modifier" "harpoon" }\n"attributes" { "activity" "1" }';
  const ofItems = itemModifiers(text);
  assert.deepEqual([...ofItems].sort(), ['harpoon', 'whalehook']);
  assert.equal(itemModifiers(text), ofItems);
  const seqs = [
    { name: 'run', acts: ['ACT_DOTA_RUN'] }, { name: 'run_injured', acts: ['ACT_DOTA_RUN', 'injured'] },
    { name: 'run_hook', acts: ['ACT_DOTA_RUN', 'whalehook'] }, { name: 'run_both', acts: ['ACT_DOTA_RUN', 'whalehook', 'harpoon'] },
  ];
  assert.deepEqual(motionList(seqs, [], ofItems).map((m) => m.name), ['run', 'run_injured']);
  assert.deepEqual(motionList(seqs, ['whalehook'], ofItems).map((m) => m.name), ['run_injured', 'run_hook']);
});

test('a swing, a spell and a taunt have an end; standing, running and being held do not', () => {
  const list = motionList([
    { name: 'idle', acts: ['ACT_DOTA_IDLE'] }, { name: 'run', acts: ['ACT_DOTA_RUN'] }, { name: 'stun', acts: ['ACT_DOTA_DISABLED'] },
    { name: 'channel', acts: ['ACT_DOTA_GENERIC_CHANNEL_1'] }, { name: 'attack', acts: ['ACT_DOTA_ATTACK'] },
    { name: 'spell', acts: ['ACT_DOTA_CAST_ABILITY_4'] }, { name: 'taunt', acts: ['ACT_DOTA_TAUNT'] }, { name: 'death', acts: ['ACT_DOTA_DIE'] },
  ]);
  assert.deepEqual(list.filter((m) => m.once).map((m) => m.name), ['attack', 'spell', 'taunt', 'death']);
});

test('a motion is named for what it does, numbered among its like; one with no word keeps the file\u2019s name', () => {
  const word = (act: string, ability: string | null) => (ability ? `Ability ${ability}` : ({ ATTACK: 'Attack', RUN: 'Run' } as Record<string, string>)[act] ?? null);
  const m = (name: string, act: string, mods: string[] = []) => ({ name, act, mods });
  assert.deepEqual(motionLabels([
    m('attack_main_anim', 'ACT_DOTA_ATTACK'), m('attack_alt_anim', 'ACT_DOTA_ATTACK2'), m('run_injured_anim', 'ACT_DOTA_RUN', ['injured']),
    m('counter_helix_anim', 'ACT_DOTA_CAST_ABILITY_3'), m('berserkers_call', 'ACT_DOTA_OVERRIDE_ABILITY_1'), m('axe_ice_skate_anim', 'ACT_DOTA_ICE_SKATE'),
  ], word), ['Attack 1', 'Attack 2', 'Run (injured)', 'Ability 3', 'Ability 1', 'Axe ice skate']);
});

test('the list of motions has what the hero does, by kind, without its layers and the statue copies', () => {
  const list = motionList([
    { name: 'bindPose', acts: [] }, { name: '@counter_helix', acts: [] },
    { name: 'axe_victory', acts: ['ACT_DOTA_VICTORY'] }, { name: 'attack_main_anim', acts: ['ACT_DOTA_ATTACK'] },
    { name: 'attack_main', acts: ['ACT_DOTA_ATTACK_STATUE'] }, { name: 'run_anim', acts: ['ACT_DOTA_RUN'] },
    { name: 'idle', acts: ['ACT_DOTA_IDLE'] }, { name: 'loadout', acts: ['ACT_DOTA_LOADOUT'] },
    { name: 'counter_helix_anim', acts: ['ACT_DOTA_CAST_ABILITY_3'] }, { name: 'death', acts: ['ACT_DOTA_DIE'] },
  ]);
  assert.deepEqual(list.map((m) => [m.name, m.group]), [
    ['loadout', 'stance'], ['idle', 'idle'], ['run_anim', 'run'], ['attack_main_anim', 'attack'],
    ['counter_helix_anim', 'ability'], ['axe_victory', 'emote'], ['death', 'other'],
  ]);
});
