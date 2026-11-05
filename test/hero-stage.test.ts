/* How the 3D preview stages a hero as the game's loadout does: its staging out of the game's files
 * (src/hero-showcase.ts), the clip it plays (src/model-loadout.ts), and how far the camera steps
 * back for a hero wider than the stage (renderer/catalog/preview3d/stage.ts). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forward, heroStage, showcaseEntry, toGlb, LOADOUT_CAMERA } from '../src/hero-showcase.ts';
import { itemActivities, loadoutSequence, modelSequences } from '../src/model-loadout.ts';
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
  assert.ok(Math.abs(widthDistance({ x: 2, z: 0 }, 1, 20, { x: 1, z: 0 }, 1) - 1 / t) < 1e-9);
  assert.ok(widthDistance({ x: 2, z: 0 }, 0.5, 20) > widthDistance({ x: 2, z: 0 }, 1, 20));
  // seen from the side, the hero's depth is its width
  assert.ok(Math.abs(widthDistance({ x: 0, z: 2 }, 1, 20, { x: 0, z: 1 }, 1) - 1 / t) < 1e-9);
});
