/* A hero's HUD portrait and minimap icon as item builder picks make them, once for the build
 * (src/item-portraits.ts): the arcana model's camera and lights under the plain model's path, and the
 * minimap's sprite cut where the item's is. Valve's files are built by hand here, in the shapes the
 * game's had on 2026-10-15. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildVpk, entryAt, entryPath } from '../src/vpk.ts';
import { portraitEntries, withPortraits, withSprites } from '../src/item-portraits.ts';

const text = (s: string) => Buffer.from(s.replace(/\n/g, '\r\n'), 'latin1');

const PORTRAITS = `"Portraits"
{
\t"models/heroes/drow/drow_base.vmdl"
\t{
\t\t"PortraitLightFOV"\t\t"90"
\t}
\t"models/items/drow/drow_arcana/drow_arcana.vmdl"
\t{
\t\t"cameras"
\t\t{
\t\t\t"Default"
\t\t\t{
\t\t\t\t"PortraitFOV"\t\t"16"
\t\t\t}
\t\t}
\t\t"PortraitLightFOV"\t\t"25"
\t}
}
`;
const SPRITES = `"sprites"
{
\t"textures"
\t{
\t\t"minimap_heroicon_npc_dota_hero_drow_ranger"
\t\t{
\t\t\t"x"\t\t"32"
\t\t}
\t\t"minimap_heroicon_npc_dota_hero_drow_ranger_alt1"
\t\t{
\t\t\t"x"\t\t"64"
\t\t}
\t}
}
`;

function game(t: { after(fn: () => void): void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-portraits-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  // the hero's own Model first; a summon's comes after it
  const script = '"DOTAHeroes"\n{\n\t"npc_dota_hero_drow_ranger"\n\t{\n\t\t"Model"\t\t"models/heroes/drow/drow_base.vmdl"\n'
    + '\t\t"Summon"\n\t\t{\n\t\t\t"Model"\t\t"models/heroes/drow/wolf.vmdl"\n\t\t}\n\t}\n}\n';
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), buildVpk([
    entryAt('scripts/npc/heroes/npc_dota_hero_drow_ranger.txt', Buffer.from(script)),
    entryAt('scripts/npc/portraits.txt', text(PORTRAITS)),
    entryAt('scripts/mod_textures.txt', text(SPRITES)),
  ]));
  return dir;
}

test("an arcana's portrait camera and lights go under the plain model's path, and the minimap cuts out its icon", (t) => {
  const log: string[] = [];
  const out = portraitEntries(game(t),
    [{ model: 'models/items/drow/drow_arcana/drow_arcana.vmdl', hero: 'npc_dota_hero_drow_ranger' }, { model: 'models/x.vmdl', hero: 'npc_dota_hero_nobody' }],
    [{ sprite: 'minimap_heroicon_npc_dota_hero_drow_ranger', as: 'minimap_heroicon_npc_dota_hero_drow_ranger_alt1' }],
    (m) => log.push(m));
  assert.deepEqual(out.map(entryPath), ['scripts/npc/portraits.txt', 'scripts/mod_textures.txt']);
  const portraits = out[0].data.toString('latin1');
  assert.match(portraits, /"models\/heroes\/drow\/drow_base\.vmdl"\r\n\t\{\r\n\t\t"cameras"[\s\S]*?"PortraitFOV"\t\t"16"[\s\S]*?"PortraitLightFOV"\t\t"25"\r\n\t\}/,
    "the arcana's own camera and lights under the plain model's path, line ends as the game's");
  assert.equal(portraits.match(/"PortraitLightFOV"\t\t"90"/), null, "the plain model's own taken out");
  assert.match(portraits, /"models\/items\/drow\/drow_arcana\/drow_arcana\.vmdl"/, "the arcana's left where it was");
  assert.match(out[1].data.toString('latin1'), /"minimap_heroicon_npc_dota_hero_drow_ranger"\r\n\t\t\{\r\n\t\t\t"x"\t\t"64"/);
  assert.equal(log.length, 1, 'a hero the game has no script for is said, and the rest built');
  assert.match(log[0], /npc_dota_hero_nobody left out of the build/);
});

test('a file nothing changes is not written, and nothing asked reads nothing', (t) => {
  const dir = game(t);
  assert.deepEqual(portraitEntries(dir, [{ model: 'models/no_settings.vmdl', hero: 'npc_dota_hero_drow_ranger' }], []), [],
    "an arcana with no settings of its own: the plain model's stay, and the game's file is not covered");
  assert.deepEqual(portraitEntries(dir, [], []), []);
});

test('portrait settings and sprites go in under names the game has not got as well, and leave the rest of the text as it was', () => {
  const added = withPortraits('"Portraits"\r\n{\r\n\t"models/a.vmdl"\r\n\t{\r\n\t\t"x"\t\t"1"\r\n\t}\r\n}\r\n', [{ from: 'models/a.vmdl', to: 'models/b.vmdl' }]);
  assert.equal(added, '"Portraits"\r\n{\r\n\t"models/a.vmdl"\r\n\t{\r\n\t\t"x"\t\t"1"\r\n\t}\r\n\t"models/b.vmdl"\r\n\t{\r\n\t\t"x"\t\t"1"\r\n\t}\r\n}\r\n');
  assert.equal(withSprites(SPRITES, [{ sprite: 'minimap_heroicon_x', as: 'minimap_heroicon_npc_dota_hero_drow_ranger_alt1' }]), SPRITES, 'a sprite it has not got');
});

test("a persona's portrait is framed as much further off as its body is bigger than Valve's", async () => {
  // the young Invoker's body is 1.351 times Valve's, and the camera Valve set for its own was too close
  const { scaledPortrait } = await import('../src/item-portraits.ts');
  const block = '\n\t{\n\t\t"cameras"\n\t\t{\n\t\t\t"Default"\n\t\t\t{\n\t\t\t\t"PortraitPosition"\t\t"100 -50 20"\n\t\t\t\t"PortraitAngles"\t\t"4 149 0"\n\t\t\t\t"PortraitFOV"\t\t"16"\n\t\t\t}\n\t\t}\n\t\t"PortraitLightPosition"\t\t"10 0 -10"\n\t\t"PortraitLightDistance"\t\t"300"\n\t}';
  const out = scaledPortrait(block, 1.5);
  assert.match(out, /"PortraitPosition"\t\t"150 -75 30"/);
  assert.match(out, /"PortraitLightPosition"\t\t"15 0 -15"/);
  assert.match(out, /"PortraitLightDistance"\t\t"450"/);
  assert.match(out, /"PortraitAngles"\t\t"4 149 0"/, 'the angles and the field of view as they were');
  assert.match(out, /"PortraitFOV"\t\t"16"/);
});
